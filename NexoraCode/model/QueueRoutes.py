"""HTTP endpoints for durable NexoraCode queue and guide messages."""

from flask import Blueprint, jsonify, request

from .ConversationStore import ConversationStore
from .MessageQueue import MessageQueue
from .StreamRuntime import append_chunk_to_conversation, list_sessions


queue_bp = Blueprint("local_message_queue", __name__)
_QUEUE_ERROR_MESSAGES = {
    "conversation is not streaming": "本轮生成已结束，请重新发送。",
    "conversation is not actively streaming": "当前对话已不在生成中，请重新发送。",
    "message is required": "消息不能为空。",
    "enable_thinking must be boolean or null": "思考选项无效。",
    "queue item not found": "队列消息已开始执行或已移除。",
}


def _queue_error(error: Exception, status: int):
    message = _QUEUE_ERROR_MESSAGES.get(str(error))

    if message is None and str(error).startswith("message exceeds "):
        message = "消息太长，请缩短后重试。"

    if message is None:
        return jsonify({"success": False, "message": "队列操作失败，请重试。"}), 500

    return jsonify({"success": False, "message": message}), status


def _queue_snapshot(conversation_id: str) -> dict:
    queue_store = MessageQueue()
    committed_item_ids = queue_store.committed_item_ids_from_history(
        ConversationStore().get(conversation_id)
    )
    active_stream_ids = {
        str(row.get("stream_id") or "")
        for row in list_sessions(conversation_ids=[conversation_id])
        if row.get("status") in {"running", "cancelling"}
    }
    return queue_store.reconcile(
        conversation_id,
        active_stream_ids,
        committed_item_ids=committed_item_ids,
    )


def _publish_queue_state(conversation_id: str, state: dict) -> None:
    if state.get("busy"):
        append_chunk_to_conversation(conversation_id, {"type": "queue_state", **state})


def _conversation_exists(conversation_id: str) -> bool:
    return bool(conversation_id and ConversationStore().get(conversation_id) is not None)


@queue_bp.route("/api/chat/queue", methods=["GET", "POST"])
def message_queue():
    conversation_id = str(request.args.get("conversation_id") or "").strip()

    if not _conversation_exists(conversation_id):
        return jsonify({"success": False, "message": "对话不存在。"}), 404

    queue_store = MessageQueue()

    if request.method == "GET":
        return jsonify({"success": True, **_queue_snapshot(conversation_id)})

    body = request.get_json(silent=True)
    body = body if isinstance(body, dict) else {}

    try:
        queue_store.enqueue(conversation_id, body.get("message"), body.get("enable_thinking"))
        state = queue_store.snapshot(conversation_id)
        _publish_queue_state(conversation_id, state)
        return jsonify({"success": True, **state})
    except ValueError as exc:
        status = 409 if str(exc) == "conversation is not streaming" else 400
        return _queue_error(exc, status)


@queue_bp.route("/api/chat/queue/<item_id>", methods=["PATCH", "DELETE"])
def message_queue_item(item_id: str):
    conversation_id = str(request.args.get("conversation_id") or "").strip()

    if not _conversation_exists(conversation_id):
        return jsonify({"success": False, "message": "对话不存在。"}), 404

    queue_store = MessageQueue()

    try:
        if request.method == "DELETE":
            state = queue_store.remove(conversation_id, item_id)
        else:
            body = request.get_json(silent=True)
            body = body if isinstance(body, dict) else {}

            if "enable_thinking" in body:
                state = queue_store.update(
                    conversation_id,
                    item_id,
                    body.get("message"),
                    body.get("enable_thinking"),
                )
            else:
                state = queue_store.update(conversation_id, item_id, body.get("message"))

        _publish_queue_state(conversation_id, state)
        return jsonify({"success": True, **state})
    except KeyError as exc:
        return _queue_error(exc, 404)
    except ValueError as exc:
        return _queue_error(exc, 400)


@queue_bp.route("/api/chat/queue/<item_id>/steer", methods=["POST"])
def steer_queue_item(item_id: str):
    conversation_id = str(request.args.get("conversation_id") or "").strip()

    if not _conversation_exists(conversation_id):
        return jsonify({"success": False, "message": "对话不存在。"}), 404

    try:
        state = MessageQueue().steer(conversation_id, item_id)
        _publish_queue_state(conversation_id, state)
        return jsonify({"success": True, **state})
    except KeyError as exc:
        return _queue_error(exc, 404)
    except ValueError as exc:
        return _queue_error(exc, 409)

