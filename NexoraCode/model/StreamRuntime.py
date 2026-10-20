"""
NexoraCode.model.StreamRuntime — 本地流式会话运行时

本地 AgentLoop 的 stream session 管理，复刻云端 ChatDBServer 的并行对话能力：
- 每次 /api/chat/stream 请求创建独立 stream session（stream_id + chunk 队列）
- AgentLoop 在后台 worker 线程跑，chunks 写入 session；SSE 只是消费者
- 客户端断开（切页面 / 导航）只断开 SSE 消费者，worker 继续跑完并落盘
- 通过 /reconnect 从 from_seq 续读、/content 取累积内容、/cancel 真正中断

对外提供：
- start_session(...): 启动后台 worker，返回 stream_id
- get_session_meta / list_sessions / get_accumulated_content
- request_cancel / is_cancel_requested
- iter_session_chunks: SSE 消费者（含心跳）
"""

from __future__ import annotations

import copy
import logging
import threading
import time
import uuid
from .SessionJournal import SessionJournal
from typing import Any, Callable, Dict, Generator, List, Optional, Tuple


_LOGGER = logging.getLogger(__name__)


_SESSIONS_LOCK = threading.Lock()
_SESSIONS: Dict[str, Dict[str, Any]] = {}
# stream_id -> SessionJournal：worker 外部（如标题生成回调）也要能落盘事件，
# 但 journal 不能塞进 session（save_meta 会序列化 session 内容）。
_JOURNALS: Dict[str, Any] = {}

# 任务生命周期事件监听器：任务启动/结束时广播，供本地前端实时感知
# 「电脑上正在运行哪些会话」。云端下发的任务本地前端没有流句柄，
# 靠这套事件才能及时在侧栏标出运行状态并按需接管。
_TASK_EVENT_LOCK = threading.Lock()
_TASK_EVENT_LISTENERS: set = set()


def subscribe_task_events(listener: Callable[[Dict[str, Any]], None]) -> None:
    """注册任务生命周期事件监听器（回调需自行保证线程安全）。"""

    with _TASK_EVENT_LOCK:
        _TASK_EVENT_LISTENERS.add(listener)


def unsubscribe_task_events(listener: Callable[[Dict[str, Any]], None]) -> None:
    """注销任务生命周期事件监听器。"""

    with _TASK_EVENT_LOCK:
        _TASK_EVENT_LISTENERS.discard(listener)


def _broadcast_task_event(payload: Dict[str, Any]) -> None:
    """向所有监听器广播一条任务事件；单个监听器异常不影响其他监听器。"""

    with _TASK_EVENT_LOCK:
        listeners = list(_TASK_EVENT_LISTENERS)

    for listener in listeners:
        try:
            listener(payload)
        except Exception:
            _LOGGER.exception("[LocalTaskEvent] listener_failed")


def broadcast_conversation_changed(action: str, conversation_id: str, title: str = "") -> None:
    """广播会话列表变更（创建/删除/改标题）。

    会话列表本身没有推送通道，本地前端要等用户手动刷新才看到新会话。
    复用任务事件流（/api/local/tasks/watch）：前端收到后重拉 /api/conversations，
    列表渲染自带签名去重，内容没变时不会重建 DOM。
    """
    _broadcast_task_event({
        "type": "conversation_changed",
        "action": str(action or "").strip(),
        "conversation_id": str(conversation_id or "").strip(),
        "title": str(title or "").strip(),
    })

_MAX_CHUNKS_PER_SESSION = 12000
# 攒批落盘阈值：攒够这么多事件或任务收尾时写一次文件。
_JOURNAL_FLUSH_CHUNKS = 64
_DONE_TTL_SEC = 900
# cancelling 兜底 TTL：正常取消后 worker 会很快走完 _finish 转 done；
# 若 worker 因任何原因（provider 卡死、线程异常）没能退出，session 会永久停在
# cancelling，导致该会话既发不出新消息也无法再次终止。超过此 TTL 强制回收，
# 让会话恢复可用。取值远大于正常取消耗时，不会误伤真正在收尾的任务。
_CANCELLING_TTL_SEC = 120
_CANCEL_SENTINEL = "__STREAM_CANCELLED__"
_ACCUMULATED_RENDER_CHUNK_TYPES = {
    "content",
    "reasoning_content",
    "web_search",
    "search_meta",
    "context_compression_status",
    "context_injection",
    "function_call_delta",
    "function_call",
    "function_call_running",
    "function_result",
    "learning_card",
    "question",
    "puzzle",
    "model_info",
    "token_usage",
    "queue_turn_start",
    "queue_turn_end",
}
_CANCEL_ALLOWED_CHUNK_TYPES = frozenset({
    "queue_state",
    "queue_guide_rollback",
    "queue_turn_start",
    "queue_turn_end",
})


class StreamCancelled(RuntimeError):
    """后台 worker 在收到用户取消后抛出，用于快速终止 AgentLoop。"""


def is_stream_cancelled_error(error: BaseException) -> bool:
    return isinstance(error, StreamCancelled) or _CANCEL_SENTINEL in str(error or "")


def _new_session(conversation_id: str = "", metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    meta = metadata if isinstance(metadata, dict) else {}

    return {
        "stream_id": uuid.uuid4().hex,
        "conversation_id": str(conversation_id or "").strip(),
        "_request_message": str(meta.get("message") or "").strip(),
        "is_regenerate": bool(meta.get("is_regenerate", False)),
        # 权限授权后的自动续跑不落盘用户消息：前端据此跳过补用户气泡，
        # 否则会把「用户已允许...请继续」这段内部文案当成用户发言渲染出来。
        "skip_user_message": bool(meta.get("skip_user_message", False)),
        "history_user_count": meta.get("history_user_count"),
        "assistant_index": meta.get("assistant_index"),
        "regenerate_index": meta.get("regenerate_index"),
        "created_at": time.time(),
        "updated_at": time.time(),
        "status": "running",
        "head_seq": 1,
        "last_seq": 0,
        "chunks": [],
        "tool_chunk_push_times": {},
        "journal_pending": [],
        "error": "",
        "stage": "created",
        "stage_detail": "",
        "stage_updated_at": time.time(),
        "last_chunk_type": "",
        "cancel_requested": False,
        "cancel_reason": "",
        "cond": threading.Condition(threading.Lock()),
    }


def _flush_session_journal(session: Dict[str, Any], force: bool = False) -> None:
    """把 session 攒下的事件批量落盘。

    逐条开文件写会在持有 session 条件锁时做文件 I/O，长回复几千个 chunk
    就是几千次 open/write/close。攒到阈值或任务收尾时一次写完，
    代价是进程异常退出最多丢最后未落盘的那一批（该任务本就会标记 interrupted）。
    """
    lock = session["cond"]

    with lock:
        pending = session["journal_pending"]
        should_flush = bool(pending) and (force or len(pending) >= _JOURNAL_FLUSH_CHUNKS)

        if should_flush:
            session["journal_pending"] = []

    if should_flush:
        journal = _JOURNALS.get(str(session.get("stream_id") or ""))

        if journal is not None:
            journal.append(str(session.get("stream_id") or ""), pending)


def _append_chunk_to_session(session: Dict[str, Any], payload: Dict[str, Any]) -> None:
    """把已构造好的 chunk 追加进 session（调用方需已持有 session["cond"]）。

    抽取自 _push_chunk 的核心追加逻辑，供 worker 推送与外部按会话推送共用，
    避免两处各写一遍序号/裁剪/落盘待写队列。
    """
    chunk_type = str(payload.get("type") or "").strip()
    cid = str(payload.get("conversation_id") or "").strip()

    if cid:
        session["conversation_id"] = cid

    if chunk_type:
        session["last_chunk_type"] = chunk_type

    if chunk_type in {"stream_session", "queue_turn_start"} and "assistant_index" in payload:
        session["assistant_index"] = payload.get("assistant_index")

    if chunk_type == "stream_session":
        payload["stream_id"] = str(payload.get("stream_id") or session.get("stream_id") or "")

        if not cid:
            payload["conversation_id"] = str(session.get("conversation_id") or "")

        if "regenerate_index" in payload:
            session["regenerate_index"] = payload.get("regenerate_index")

        if "is_regenerate" in payload:
            session["is_regenerate"] = bool(payload.get("is_regenerate", False))

    session["last_seq"] = int(session["last_seq"]) + 1
    payload["_stream_seq"] = int(session["last_seq"])
    session["chunks"].append(payload)

    if chunk_type in {"function_call", "function_result"}:
        session["tool_chunk_push_times"][int(session["last_seq"])] = time.monotonic()

    if len(session["chunks"]) > _MAX_CHUNKS_PER_SESSION:
        dropped = session["chunks"].pop(0)
        dropped_seq = int(dropped.get("_stream_seq") or 0)
        session["tool_chunk_push_times"].pop(dropped_seq, None)
        session["head_seq"] = int(session["head_seq"]) + 1

    session["updated_at"] = time.time()
    # 收尾帧先落盘，保证「完成」这件事不会因为攒批而延后到下一个 chunk。
    session["journal_pending"].append(payload)
    session["cond"].notify_all()


def append_chunk_to_conversation(conversation_id: str, chunk: Dict[str, Any]) -> bool:
    """向该会话当前活跃的 session 追加一个 chunk（标题生成等异步事件的即时推送）。

    标题在独立后台线程生成，此时可能已晚于 worker 的收尾帧；只要 session 仍在
    内存中就把事件追加进去，SSE 读取端会照常带出。找不到活跃 session 时返回 False，
    调用方据此回退到「下次拉列表」的常规刷新。
    """
    clean_id = str(conversation_id or "").strip()

    if not clean_id or not isinstance(chunk, dict):
        return False

    cleanup_sessions()

    with _SESSIONS_LOCK:
        sessions = list(_SESSIONS.values())

    target = None

    for session in sessions:
        if str(session.get("conversation_id") or "").strip() != clean_id:
            continue

        # 同一会话可能有多个历史 session，取最近更新的那个。
        if target is None or float(session.get("updated_at") or 0) > float(target.get("updated_at") or 0):
            target = session

    if target is None:
        return False

    payload = copy.deepcopy(chunk)
    payload["conversation_id"] = clean_id
    cond = target["cond"]

    with cond:
        if bool(target.get("cancel_requested", False)):
            return False

        _append_chunk_to_session(target, payload)

    _flush_session_journal(target, force=True)

    return True


def cleanup_sessions() -> None:
    now = time.time()

    with _SESSIONS_LOCK:
        remove_ids = []

        for sid, s in list(_SESSIONS.items()):
            status = str(s.get("status") or "done")
            updated_at = float(s.get("updated_at") or 0)
            age = max(0.0, now - updated_at)

            # running 一律不回收：长任务超过任何 TTL 仍在执行，
            # 强制清理会让仍在跑的 worker 失去可续读的 session。worker 结束必经 _finish。
            if status == "running":
                continue

            # cancelling 已进入终止流程，正常很快转 done；但若 worker 卡死
            # （如 provider 连接阶段不响应取消），会永久滞留并锁死会话。
            # 用兜底 TTL 强制回收，让会话恢复可用。
            if status == "cancelling":
                if age > _CANCELLING_TTL_SEC:
                    remove_ids.append(sid)

                continue

            if age > _DONE_TTL_SEC:
                remove_ids.append(sid)

        for sid in remove_ids:
            _SESSIONS.pop(sid, None)
            _JOURNALS.pop(sid, None)


def start_session(
    conversation_id: str,
    worker: Callable[
        [
            Callable[[Dict[str, Any]], None],
            Callable[[str], None],
            Callable[[str, str], None],
            Callable[[], bool],
        ],
        None,
    ],
    metadata: Optional[Dict[str, Any]] = None,
    stream_id: Optional[str] = None,
) -> str:
    cleanup_sessions()
    session = _new_session(conversation_id=conversation_id, metadata=metadata)

    if stream_id:
        session["stream_id"] = stream_id

    stream_id = session["stream_id"]
    journal = SessionJournal()
    # 每次开新任务顺带清一次过期事件日志：电脑长时间不关时目录会一直涨。
    journal.purge_expired()
    journal.save_meta(session)
    # 外部按会话推送（如标题生成）需要复用同一个 journal 落盘；journal 不可放进
    # session（save_meta 会序列化 session 内容），故单独登记在模块级映射里。
    with _SESSIONS_LOCK:
        _JOURNALS[stream_id] = journal

    with _SESSIONS_LOCK:
        _SESSIONS[stream_id] = session

    def _set_conversation_id(cid: str) -> None:
        val = str(cid or "").strip()

        if not val:
            return

        cond = session["cond"]

        with cond:
            session["conversation_id"] = val
            session["updated_at"] = time.time()
            journal.save_meta(session)
            cond.notify_all()

    def _set_stage(stage: str, detail: str = "") -> None:
        stage_text = str(stage or "").strip()

        if not stage_text:
            return

        cond = session["cond"]

        with cond:
            session["stage"] = stage_text
            session["stage_detail"] = str(detail or "").strip()
            session["stage_updated_at"] = time.time()
            session["updated_at"] = time.time()
            cond.notify_all()

    def _is_cancel_requested() -> bool:
        cond = session["cond"]

        with cond:
            return bool(session.get("cancel_requested", False))

    def _flush_journal(force: bool = False) -> None:
        _flush_session_journal(session, force=force)

    def _push_chunk(chunk: Dict[str, Any]) -> None:
        payload = copy.deepcopy(chunk) if isinstance(chunk, dict) else {"type": "message", "content": str(chunk)}
        chunk_type = str(payload.get("type") or "").strip()
        cond = session["cond"]

        with cond:
            if bool(session.get("cancel_requested", False)) and chunk_type not in _CANCEL_ALLOWED_CHUNK_TYPES:
                raise StreamCancelled(_CANCEL_SENTINEL)

            _append_chunk_to_session(session, payload)

        _flush_journal(force=chunk_type == "finish")

    def _finish(status: str = "done", error: str = "") -> None:
        cond = session["cond"]

        # 事件先落盘，元数据后标记：读者看到 status=finished/done 时，
        # 事件日志一定已经完整，否则回放会得到一个「已完成但没有事件」的任务。
        _flush_journal(force=True)

        with cond:
            if bool(session.get("cancel_requested", False)):
                session["status"] = "done"
                session["error"] = str(session.get("error") or "cancelled")
                session["stage"] = "cancelled"
                session["stage_detail"] = str(session.get("cancel_reason") or "user_abort")
            else:
                session["status"] = str(status or "done")
                session["error"] = str(error or "")
                session["stage"] = "finished"
                session["stage_detail"] = str(error or "")

            session["_request_message"] = ""
            session["stage_updated_at"] = time.time()
            session["updated_at"] = time.time()
            journal.save_meta(session)
            cond.notify_all()
            final_status = str(session.get("status") or "done")
            final_conversation_id = str(session.get("conversation_id") or "").strip()

        # 锁外广播：监听器可能做 IO，不应持有会话条件锁。
        _broadcast_task_event({
            "type": "task_finished",
            "stream_id": str(session.get("stream_id") or ""),
            "conversation_id": final_conversation_id,
            "status": final_status,
        })

    def _report_worker_error(error: BaseException) -> None:
        """业务 worker 已推送 error 事件时不再重复上报，只补记失败状态。"""
        cond = session["cond"]

        _LOGGER.error(
            "[LocalStream] worker_failed stream_id=%s",
            session.get("stream_id"),
            exc_info=(type(error), error, error.__traceback__),
        )

        with cond:
            already_reported = session["last_chunk_type"] == "error"

        if not already_reported:
            try:
                _push_chunk({"type": "error", "content": f"stream runtime worker error: {str(error)}"})
            except Exception:
                pass

        _finish("done", str(error))

    def _run() -> None:
        try:
            _set_stage("worker_started")
            worker(_push_chunk, _set_conversation_id, _set_stage, _is_cancel_requested)
            _finish("done", "")
        except RuntimeError as e:
            if is_stream_cancelled_error(e):
                _finish("done", "cancelled")
                return

            _report_worker_error(e)
        except Exception as e:
            _report_worker_error(e)

    thread = threading.Thread(target=_run, name=f"nc-stream-{stream_id[:8]}", daemon=True)
    thread.start()
    # 任务已进入运行态，广播给本地前端：侧栏据此标出运行中的会话。
    # 带上请求正文与 skip_user_message，本地接管时据此决定是否补用户气泡
    # （云端下发的普通任务有用户消息；权限续跑这类内部任务没有）。
    _broadcast_task_event({
        "type": "task_started",
        "stream_id": stream_id,
        "conversation_id": str(conversation_id or "").strip(),
        "message": str(session.get("_request_message") or ""),
        "skip_user_message": bool(session.get("skip_user_message", False)),
        "is_regenerate": bool(session.get("is_regenerate", False)),
        "history_user_count": session.get("history_user_count"),
    })
    return stream_id


def get_session_meta(stream_id: str, *, include_request_message: bool = False) -> Optional[Dict[str, Any]]:
    sid = str(stream_id or "").strip()

    if not sid:
        return None

    with _SESSIONS_LOCK:
        s = _SESSIONS.get(sid)

    if not s:
        return None

    cond = s["cond"]

    with cond:
        meta = {
            "stream_id": sid,
            "conversation_id": str(s.get("conversation_id") or "").strip(),
            "is_regenerate": bool(s.get("is_regenerate", False)),
            "skip_user_message": bool(s.get("skip_user_message", False)),
            "history_user_count": s.get("history_user_count"),
            "assistant_index": s.get("assistant_index"),
            "regenerate_index": s.get("regenerate_index"),
            "status": str(s.get("status") or "done"),
            "head_seq": int(s.get("head_seq") or 1),
            "last_seq": int(s.get("last_seq") or 0),
            "created_at": float(s.get("created_at") or 0),
            "updated_at": float(s.get("updated_at") or 0),
            "idle_seconds": max(0.0, time.time() - float(s.get("updated_at") or 0)),
            "stage": str(s.get("stage") or ""),
            "stage_detail": str(s.get("stage_detail") or ""),
            "stage_updated_at": float(s.get("stage_updated_at") or 0),
            "stage_idle_seconds": max(0.0, time.time() - float(s.get("stage_updated_at") or 0)),
            "last_chunk_type": str(s.get("last_chunk_type") or ""),
            "error": str(s.get("error") or ""),
            "cancel_requested": bool(s.get("cancel_requested", False)),
            "cancel_reason": str(s.get("cancel_reason") or ""),
        }

        if include_request_message:
            meta["message"] = str(s.get("_request_message") or "")

        return meta


def read_session_chunks(stream_id: str, after_seq: int = 0, limit: int = 200):
    """按游标读取 session 内存事件，供远程断线补读和日志攒批期间读取。"""
    sid = str(stream_id or "").strip()

    if not sid:
        return [], None, False

    with _SESSIONS_LOCK:
        session = _SESSIONS.get(sid)

    if not session:
        return [], None, False

    cursor = max(0, int(after_seq))
    safe_limit = max(0, int(limit))
    cond = session["cond"]

    with cond:
        head_seq = int(session.get("head_seq") or 1)
        chunks = [
            copy.deepcopy(chunk)
            for chunk in session.get("chunks", [])
            if int(chunk.get("_stream_seq") or 0) > cursor
        ][:safe_limit]
        has_gap = cursor < head_seq - 1

    return chunks, get_session_meta(sid), has_gap


def get_accumulated_content(stream_id: str) -> Optional[Dict[str, Any]]:
    """返回 session 累积的可见内容与可重放的 render chunks（reconnect 前补渲染用）。"""

    sid = str(stream_id or "").strip()

    if not sid:
        return None

    with _SESSIONS_LOCK:
        s = _SESSIONS.get(sid)

    if not s:
        return None

    cond = s["cond"]

    with cond:
        chunks = list(s.get("chunks") or [])
        last_seq = int(s.get("last_seq") or 0)
        status = str(s.get("status") or "done")

    content_parts: List[str] = []
    reasoning_parts: List[str] = []
    render_chunks: List[Dict[str, Any]] = []

    for chunk in chunks:
        ctype = str(chunk.get("type") or "").strip()

        if ctype == "queue_turn_start":
            content_parts.clear()
            reasoning_parts.clear()
        elif ctype == "content":
            content_parts.append(str(chunk.get("content") or ""))
        elif ctype == "reasoning_content":
            reasoning_parts.append(str(chunk.get("content") or ""))

        if ctype in _ACCUMULATED_RENDER_CHUNK_TYPES:
            render_chunks.append(copy.deepcopy(chunk))

    return {
        "stream_id": sid,
        "conversation_id": str(s.get("conversation_id") or "").strip(),
        "content": "".join(content_parts).rstrip(),
        "reasoning_content": "".join(reasoning_parts).rstrip(),
        "render_chunks": render_chunks,
        "last_seq": last_seq,
        "status": status,
    }


def list_sessions(
    *,
    stream_ids: Optional[List[str]] = None,
    conversation_ids: Optional[List[str]] = None,
    include_done: bool = True,
) -> List[Dict[str, Any]]:
    cleanup_sessions()
    requested_ids = {
        str(item or "").strip()
        for item in (stream_ids or [])
        if str(item or "").strip()
    }
    requested_conversation_ids = {
        str(item or "").strip()
        for item in (conversation_ids or [])
        if str(item or "").strip()
    }

    with _SESSIONS_LOCK:
        ids = list(_SESSIONS.keys())

    rows: List[Dict[str, Any]] = []

    for sid in ids:
        if requested_ids and sid not in requested_ids:
            continue

        meta = get_session_meta(sid)

        if not meta:
            continue

        if requested_conversation_ids:
            meta_cid = str(meta.get("conversation_id") or "").strip()

            if meta_cid not in requested_conversation_ids:
                continue

        if not include_done and str(meta.get("status") or "") != "running":
            continue

        rows.append(meta)

    rows.sort(key=lambda item: float(item.get("updated_at") or 0), reverse=True)
    return rows


def request_cancel(stream_id: str, reason: str = "user_abort") -> bool:
    sid = str(stream_id or "").strip()

    if not sid:
        return False

    with _SESSIONS_LOCK:
        s = _SESSIONS.get(sid)

    if not s:
        return False

    cond = s["cond"]

    with cond:
        if str(s.get("status") or "done") != "running":
            return True

        already_requested = bool(s.get("cancel_requested", False))
        s["cancel_requested"] = True
        s["cancel_reason"] = str(reason or "user_abort")
        s["status"] = "cancelling"
        s["stage"] = "cancelling"
        s["stage_detail"] = str(reason or "user_abort")
        s["stage_updated_at"] = time.time()
        s["updated_at"] = time.time()

        if not already_requested:
            s["last_seq"] = int(s.get("last_seq") or 0) + 1
            payload = {
                "type": "stream_cancel_requested",
                "stream_id": sid,
                "conversation_id": str(s.get("conversation_id") or "").strip(),
                "reason": str(reason or "user_abort"),
                "_stream_seq": int(s["last_seq"]),
            }
            s["last_chunk_type"] = "stream_cancel_requested"
            s["chunks"].append(payload)

            if len(s["chunks"]) > _MAX_CHUNKS_PER_SESSION:
                dropped = s["chunks"].pop(0)
                dropped_seq = int(dropped.get("_stream_seq") or 0)
                s["tool_chunk_push_times"].pop(dropped_seq, None)
                s["head_seq"] = int(s.get("head_seq") or 1) + 1

        cond.notify_all()

    return True


def is_cancel_requested(stream_id: str) -> bool:
    sid = str(stream_id or "").strip()

    if not sid:
        return False

    with _SESSIONS_LOCK:
        s = _SESSIONS.get(sid)

    if not s:
        return False

    cond = s["cond"]

    with cond:
        return bool(s.get("cancel_requested", False))


def iter_session_chunks(
    stream_id: str,
    *,
    from_seq: int = 0,
    heartbeat_sec: int = 12,
    strict_cursor: bool = False,
) -> Generator[Tuple[Optional[int], Dict[str, Any]], None, None]:
    sid = str(stream_id or "").strip()

    if not sid:
        return

    with _SESSIONS_LOCK:
        session = _SESSIONS.get(sid)

    if not session:
        return

    try:
        cursor = int(from_seq) + 1
    except Exception:
        cursor = 1

    cursor = max(1, cursor)
    heartbeat = max(2, int(heartbeat_sec or 12))
    last_ping_ts = time.time()
    cond = session["cond"]

    while True:
        emit_seq = None
        emit_payload = None
        tool_push_at = None
        should_break = False
        gap_payload = None
        now = time.time()

        with cond:
            head_seq = int(session.get("head_seq") or 1)
            last_seq = int(session.get("last_seq") or 0)
            status = str(session.get("status") or "done")

            if cursor < head_seq:
                if strict_cursor:
                    gap_payload = {"type": "task_stream_gap", "head_seq": head_seq}
                else:
                    cursor = head_seq

            if gap_payload is not None:
                should_break = True
            elif cursor <= last_seq:
                idx = cursor - head_seq
                chunks = session.get("chunks") or []

                if 0 <= idx < len(chunks):
                    payload = chunks[idx]
                    emit_seq = int(payload.get("_stream_seq") or cursor)
                    emit_payload = copy.deepcopy(payload)
                    tool_push_at = session["tool_chunk_push_times"].pop(emit_seq, None)
                    cursor = emit_seq + 1
                    session["updated_at"] = time.time()
                else:
                    cursor = max(cursor + 1, head_seq)
            elif status not in {"running", "cancelling"}:
                should_break = True
            else:
                timeout = min(1.0, float(max(0.2, heartbeat - (now - last_ping_ts))))
                cond.wait(timeout=timeout)

        if gap_payload is not None:
            yield None, gap_payload
            return

        if emit_payload is not None:
            if tool_push_at is not None:
                event_type = str(emit_payload.get("type") or "")
                print(
                    f"[LocalAgentTiming] event={event_type} "
                    f"push_to_sse_yield_ms={(time.monotonic() - tool_push_at) * 1000:.1f}"
                )

            yield emit_seq, emit_payload
            continue

        if should_break:
            break

        if time.time() - last_ping_ts >= heartbeat:
            last_ping_ts = time.time()
            yield None, {"type": "ping"}
