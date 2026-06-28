import copy
import threading
import time
import uuid
from typing import Any, Callable, Dict, Generator, List, Optional, Tuple


_SESSIONS_LOCK = threading.Lock()
_SESSIONS: Dict[str, Dict[str, Any]] = {}

_MAX_CHUNKS_PER_SESSION = 12000
_DONE_TTL_SEC = 900
_STALE_RUNNING_TTL_SEC = 7200
_CANCEL_SENTINEL = "__STREAM_CANCELLED__"
_ACCUMULATED_RENDER_CHUNK_TYPES = {
    "content",
    "reasoning_content",
    "web_search",
    "search_meta",
    "context_compression_status",
    "function_call_delta",
    "function_call",
    "function_call_running",
    "function_result",
    "learning_card",
    "question",
    "puzzle",
    "model_info",
    "token_usage",
}


class StreamCancelled(RuntimeError):
    """Raised inside the stream worker after the server accepts a user cancel."""


def is_stream_cancelled_error(error: BaseException) -> bool:
    return isinstance(error, StreamCancelled) or _CANCEL_SENTINEL in str(error or "")


def _new_session(username: str, conversation_id: str = "", metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    meta = metadata if isinstance(metadata, dict) else {}

    return {
        "stream_id": uuid.uuid4().hex,
        "username": str(username or "").strip(),
        "conversation_id": str(conversation_id or "").strip(),
        "is_regenerate": bool(meta.get("is_regenerate", False)),
        "assistant_index": meta.get("assistant_index"),
        "regenerate_index": meta.get("regenerate_index"),
        "created_at": time.time(),
        "updated_at": time.time(),
        "status": "running",  # running | done
        "head_seq": 1,
        "last_seq": 0,
        "chunks": [],  # list[dict]
        "error": "",
        "stage": "created",
        "stage_detail": "",
        "stage_updated_at": time.time(),
        "last_chunk_type": "",
        "cancel_requested": False,
        "cancel_reason": "",
        "cond": threading.Condition(threading.Lock()),
    }


def cleanup_sessions() -> None:
    now = time.time()
    with _SESSIONS_LOCK:
        remove_ids = []
        for sid, s in list(_SESSIONS.items()):
            status = str(s.get("status") or "done")
            updated_at = float(s.get("updated_at") or 0)
            age = max(0.0, now - updated_at)
            if status == "running":
                if age > _STALE_RUNNING_TTL_SEC:
                    remove_ids.append(sid)
            else:
                if age > _DONE_TTL_SEC:
                    remove_ids.append(sid)
        for sid in remove_ids:
            _SESSIONS.pop(sid, None)


def start_session(
    username: str,
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
) -> str:
    cleanup_sessions()
    session = _new_session(username=username, conversation_id=conversation_id, metadata=metadata)
    stream_id = session["stream_id"]
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

    def _push_chunk(chunk: Dict[str, Any]) -> None:
        payload = copy.deepcopy(chunk) if isinstance(chunk, dict) else {"type": "message", "content": str(chunk)}
        cid = str(payload.get("conversation_id") or "").strip()
        chunk_type = str(payload.get("type") or "").strip()
        cond = session["cond"]
        with cond:
            if bool(session.get("cancel_requested", False)):
                raise StreamCancelled(_CANCEL_SENTINEL)
            if cid:
                session["conversation_id"] = cid
            if chunk_type:
                session["last_chunk_type"] = chunk_type
            if chunk_type == "stream_session":
                payload["stream_id"] = str(payload.get("stream_id") or session.get("stream_id") or "")

                if not cid:
                    payload["conversation_id"] = str(session.get("conversation_id") or "")

                if "assistant_index" in payload:
                    session["assistant_index"] = payload.get("assistant_index")

                if "regenerate_index" in payload:
                    session["regenerate_index"] = payload.get("regenerate_index")

                if "is_regenerate" in payload:
                    session["is_regenerate"] = bool(payload.get("is_regenerate", False))

            session["last_seq"] = int(session["last_seq"]) + 1
            payload["_stream_seq"] = int(session["last_seq"])
            session["chunks"].append(payload)
            if len(session["chunks"]) > _MAX_CHUNKS_PER_SESSION:
                session["chunks"].pop(0)
                session["head_seq"] = int(session["head_seq"]) + 1
            session["updated_at"] = time.time()
            cond.notify_all()

    def _finish(status: str = "done", error: str = "") -> None:
        cond = session["cond"]
        with cond:
            if bool(session.get("cancel_requested", False)):
                session["status"] = "done"
                session["error"] = str(session.get("error") or "cancelled")
                session["stage"] = "cancelled"
                session["stage_detail"] = str(session.get("cancel_reason") or "user_abort")
                session["stage_updated_at"] = time.time()
                session["updated_at"] = time.time()
                cond.notify_all()
                return

            session["status"] = str(status or "done")
            session["error"] = str(error or "")
            session["stage"] = "finished"
            session["stage_detail"] = str(error or "")
            session["stage_updated_at"] = time.time()
            session["updated_at"] = time.time()
            cond.notify_all()

    def _run():
        try:
            _set_stage("worker_started")
            worker(_push_chunk, _set_conversation_id, _set_stage, _is_cancel_requested)
            _finish("done", "")
        except RuntimeError as e:
            if is_stream_cancelled_error(e):
                _finish("done", "cancelled")
                return
            try:
                _push_chunk({
                    "type": "error",
                    "content": f"stream runtime worker error: {str(e)}"
                })
            except Exception:
                pass
            _finish("done", str(e))
        except Exception as e:
            try:
                _push_chunk({
                    "type": "error",
                    "content": f"stream runtime worker error: {str(e)}"
                })
            except Exception:
                pass
            _finish("done", str(e))

    t = threading.Thread(target=_run, name=f"stream-runtime-{stream_id[:8]}", daemon=True)
    t.start()
    return stream_id


def get_session_meta(stream_id: str, username: Optional[str] = None) -> Optional[Dict[str, Any]]:
    sid = str(stream_id or "").strip()
    if not sid:
        return None
    with _SESSIONS_LOCK:
        s = _SESSIONS.get(sid)
    if not s:
        return None
    if username is not None and str(s.get("username") or "").strip() != str(username or "").strip():
        return None
    cond = s["cond"]
    with cond:
        return {
            "stream_id": sid,
            "username": str(s.get("username") or "").strip(),
            "conversation_id": str(s.get("conversation_id") or "").strip(),
            "is_regenerate": bool(s.get("is_regenerate", False)),
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


def get_accumulated_content(
    stream_id: str,
    username: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Return accumulated visible stream content and replayable render chunks."""
    sid = str(stream_id or "").strip()
    if not sid:
        return None
    with _SESSIONS_LOCK:
        s = _SESSIONS.get(sid)
    if not s:
        return None
    if username is not None and str(s.get("username") or "").strip() != str(username or "").strip():
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
        if ctype == "content":
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
    username: Optional[str] = None,
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
        meta = get_session_meta(sid, username=username)
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


def request_cancel(stream_id: str, username: Optional[str] = None, reason: str = "user_abort") -> bool:
    sid = str(stream_id or "").strip()
    if not sid:
        return False
    with _SESSIONS_LOCK:
        s = _SESSIONS.get(sid)
    if not s:
        return False
    if username is not None and str(s.get("username") or "").strip() != str(username or "").strip():
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
                s["chunks"].pop(0)
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
    username: Optional[str] = None,
    from_seq: int = 0,
    heartbeat_sec: int = 12
) -> Generator[Tuple[Optional[int], Dict[str, Any]], None, None]:
    sid = str(stream_id or "").strip()
    if not sid:
        return
    with _SESSIONS_LOCK:
        session = _SESSIONS.get(sid)
    if not session:
        return
    if username is not None and str(session.get("username") or "").strip() != str(username or "").strip():
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
        should_break = False
        now = time.time()

        with cond:
            head_seq = int(session.get("head_seq") or 1)
            last_seq = int(session.get("last_seq") or 0)
            status = str(session.get("status") or "done")
            if cursor < head_seq:
                cursor = head_seq

            if cursor <= last_seq:
                idx = cursor - head_seq
                chunks = session.get("chunks") or []
                if 0 <= idx < len(chunks):
                    payload = chunks[idx]
                    emit_seq = int(payload.get("_stream_seq") or cursor)
                    emit_payload = copy.deepcopy(payload)
                    cursor = emit_seq + 1
                    session["updated_at"] = time.time()
                else:
                    cursor = max(cursor + 1, head_seq)
            elif status != "running":
                should_break = True
            else:
                timeout = min(1.0, float(max(0.2, heartbeat - (now - last_ping_ts))))
                cond.wait(timeout=timeout)

        if emit_payload is not None:
            yield emit_seq, emit_payload
            continue

        if should_break:
            break

        if time.time() - last_ping_ts >= heartbeat:
            last_ping_ts = time.time()
            yield None, {"type": "ping"}
