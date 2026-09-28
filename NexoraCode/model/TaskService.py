"""桌面与远程共用的任务入口：请求去重、同会话串行执行、事件续读。"""
import hashlib
import json
import re
import threading
import time
import uuid

from flask import Blueprint, jsonify, request
from core.config import get_app_root
from .ConversationStore import ConversationStore, write_json_atomic
from .StreamRuntime import get_session_meta, list_sessions, start_session, request_cancel


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
    # 只回看最近的落盘任务：电脑连开数月后事件目录会积累上万文件，
    # 全量扫描会让这个列表接口越来越慢，而近期任务之外的历史没有查询价值。
    archived = max(0, HISTORY_SCAN_LIMIT - len(live))

    for path in journal.recent_files(archived):
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
