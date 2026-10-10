"""桌面与远程共用的任务入口：请求去重、同会话串行执行、事件续读。"""
import hashlib
import json
import queue
import re
import threading
import time
import uuid

from flask import Blueprint, Response, jsonify, request, stream_with_context
from core.config import get_app_root
from .ConversationStore import ConversationStore, write_json_atomic
from .StreamRuntime import (
    get_session_meta,
    list_sessions,
    start_session,
    request_cancel,
    subscribe_task_events,
    unsubscribe_task_events,
)


task_bp = Blueprint("local_tasks", __name__)
_LOCK = threading.RLock()
_WORKER_FACTORY = None

# 任务列表最多回看多少个已落盘任务（含运行中的）。
HISTORY_SCAN_LIMIT = 100
# 任务去重记录的保留策略，与事件日志一致：按天过期 + 条数封顶。
REQUEST_RETENTION_DAYS = 7
MAX_REQUEST_RECORDS = 500


def set_worker_factory(factory):
    global _WORKER_FACTORY
    _WORKER_FACTORY = factory


def _purge_request_records(retention_days=REQUEST_RETENTION_DAYS, max_files=MAX_REQUEST_RECORDS):
    """删除过期或超出上限的任务去重记录。

    去重记录与事件日志同生共死：事件被清理后同一个 request_id 的重试本来也拿不
    回结果（会报「执行状态缺失」），留着这条记录只会让目录无界增长。
    必须在 _LOCK 内调用。
    """
    root = get_app_root() / "data" / "task_requests"

    if not root.exists():
        return

    deadline = time.time() - max(0, int(retention_days)) * 86400
    records = list(root.glob("*.json"))

    for path in records:
        if path.stat().st_mtime < deadline:
            path.unlink(missing_ok=True)

    survivors = sorted(
        (path for path in root.glob("*.json") if path.stat().st_mtime >= deadline),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )

    for path in survivors[max(0, int(max_files)):]:
        path.unlink(missing_ok=True)


def start_task(body):
    """相同 request_id 只启动一次；结果不确定时返回原任务，不再次执行。"""
    request_id = str(body.get("request_id") or "")

    if not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", request_id):
        raise ValueError("request_id 必须为 8 至 100 位字母、数字、下划线或连字符")

    if not str(body.get("message") or "").strip():
        raise ValueError("消息不能为空")

    path = get_app_root() / "data" / "task_requests" / (request_id + ".json")
    digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

    with _LOCK:
        _purge_request_records()
        prior = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

        if prior is not None:
            if prior["digest"] != digest:
                raise ValueError("request_id 已被不同请求使用")

            from .SessionJournal import SessionJournal
            _, session = SessionJournal().read(prior["stream_id"], 0, 0)

            if session is None:
                raise ValueError("任务受理后执行状态缺失，未自动重跑；请检查电脑日志")

            return prior

        cid = str(body.get("conversation_id") or "")

        if cid and ConversationStore().get(cid) is None:
            raise ValueError("本地会话不存在")

        if cid and any(row["status"] in {"running", "cancelling"} for row in list_sessions(conversation_ids=[cid])):
            raise ValueError("当前会话已有运行任务，请先等待或停止")

        sid = uuid.uuid4().hex
        worker = _WORKER_FACTORY(body)
        record = {"stream_id": sid, "conversation_id": cid, "digest": digest}
        path.parent.mkdir(parents=True, exist_ok=True)
        write_json_atomic(path, record)
        metadata = dict(body)
        conversation = ConversationStore().get(cid) if cid else None
        metadata["history_user_count"] = sum(message.get("role") == "user" for message in conversation["messages"]) if conversation else 0
        start_session(conversation_id=cid, worker=worker, metadata=metadata, stream_id=sid)
        return record


@task_bp.route("/api/local/tasks", methods=["POST"])
def create_task():
    try:
        record = start_task(request.get_json() or {})
        return jsonify({"success": True, "stream_id": record["stream_id"], "conversation_id": record["conversation_id"]})
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 409


@task_bp.route("/api/local/tasks", methods=["GET"])
def tasks():
    from .SessionJournal import SessionJournal
    journal = SessionJournal()
    live = {row["stream_id"]: row for row in list_sessions()}

    # 活动任务把本轮输入交给远端界面用于恢复缺失的用户气泡；输入只留在内存中，
    # SessionJournal 不落盘保存请求正文。
    for stream_id, row in live.items():
        if row.get("status") not in {"running", "cancelling"}:
            continue

        meta = get_session_meta(stream_id, include_request_message=True)

        if meta and meta.get("status") in {"running", "cancelling"}:
            row["message"] = meta.get("message", "")

    # 只回看最近的落盘任务：电脑连开数月后事件目录会积累上万文件，
    # 全量扫描会让这个列表接口越来越慢，而近期任务之外的历史没有查询价值。
    archived = max(0, HISTORY_SCAN_LIMIT - len(live))

    for path in journal.recent_files(archived):
        if path.stem not in live:
            _, metadata = journal.read(path.stem, 0, 0)
            live[path.stem] = metadata

    return jsonify({"sessions": sorted(live.values(), key=lambda row: row.get("updated_at", 0), reverse=True)})


@task_bp.route("/api/local/tasks/watch", methods=["GET"])
def watch_tasks():
    """任务生命周期事件流（SSE）。

    本地前端订阅后，可实时感知「电脑上正在运行哪些会话」——包括云端下发的任务，
    这些任务本地前端没有流句柄，只能靠本事件流发现并在侧栏标出运行状态。
    连接建立时先推一份当前活动任务快照（避免订阅前已启动的任务被漏掉），
    之后增量推送 task_started / task_finished。
    """
    events: "queue.Queue" = queue.Queue()

    def listener(payload):
        events.put(payload)

    subscribe_task_events(listener)

    def generate():
        try:
            # 建连快照：当前仍在运行的任务一次性补齐，订阅前的任务不丢。
            for row in list_sessions():
                if str(row.get("status") or "") in {"running", "cancelling"}:
                    meta = get_session_meta(row.get("stream_id"), include_request_message=True) or {}
                    yield _sse_pack({
                        "type": "task_started",
                        "stream_id": str(row.get("stream_id") or ""),
                        "conversation_id": str(row.get("conversation_id") or ""),
                        "message": str(meta.get("message") or ""),
                        "skip_user_message": bool(meta.get("skip_user_message", False)),
                        "is_regenerate": bool(meta.get("is_regenerate", False)),
                        "history_user_count": meta.get("history_user_count"),
                        "snapshot": True,
                    })

            while True:
                try:
                    payload = events.get(timeout=15)
                except queue.Empty:
                    # 心跳：保持连接并让前端能感知服务端仍在线。
                    yield ": keep-alive\n\n"
                    continue

                yield _sse_pack(payload)
        finally:
            unsubscribe_task_events(listener)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


def _sse_pack(payload):
    """把任务事件序列化为一条 SSE 帧。"""

    return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"


@task_bp.route("/api/local/tasks/<stream_id>/events", methods=["GET"])
def events(stream_id):
    from .SessionJournal import SessionJournal

    try:
        cursor = int(request.args.get("after", 0))

        if cursor < 0:
            raise ValueError("事件序号必须大于或等于零")

        chunks, meta = SessionJournal().read(stream_id, cursor, 200)

        if meta is None:
            return jsonify({"message": "任务不存在"}), 404

        live = get_session_meta(stream_id)
        return jsonify({"events": chunks, "session": live if live else meta})
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400


@task_bp.route("/api/local/tasks/<stream_id>/cancel", methods=["POST"])
def cancel(stream_id):
    if not request_cancel(stream_id):
        return jsonify({"message": "运行任务不存在"}), 404

    return jsonify({"success": True, "cancel_requested": True})
