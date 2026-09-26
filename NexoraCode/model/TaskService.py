"""桌面与远程共用的任务入口：请求去重、同会话串行执行、事件续读。"""
import hashlib
import json
import re
import threading
import uuid

from flask import Blueprint, jsonify, request
from core.config import get_app_root
from .ConversationStore import ConversationStore
from .StreamRuntime import get_session_meta, list_sessions, start_session, request_cancel


task_bp = Blueprint("local_tasks", __name__)
_LOCK = threading.RLock()
_WORKER_FACTORY = None


def set_worker_factory(factory):
    global _WORKER_FACTORY
    _WORKER_FACTORY = factory


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
        if path.exists():
            prior = json.loads(path.read_text(encoding="utf-8"))

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
        ConversationStore._write_json(path, record)
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

    if journal.root.exists():
        for path in journal.root.glob("*.json"):
            if path.stem not in live:
                _, metadata = journal.read(path.stem, 0, 0)
                live[path.stem] = metadata

    return jsonify({"sessions": sorted(live.values(), key=lambda row: row.get("updated_at", 0), reverse=True)})


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
