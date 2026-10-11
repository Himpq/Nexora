"""Run queued conversation turns serially inside one StreamRuntime session."""

from __future__ import annotations

import threading

from .StreamRuntime import StreamCancelled


def run_queue_worker(
    *,
    push_chunk,
    set_conversation_id,
    is_cancel_requested,
    loop,
    store,
    queue_store,
    conversation_id,
    stream_id,
    message,
    system_prompt,
    injection_sources,
    enable_thinking,
    body,
    normalize_messages,
    translate_event,
):
    """Execute the initial turn and every queued turn without parallel streams."""
    finished = threading.Event()
    active_conversation_id = [str(conversation_id or "").strip()]

    def watch_cancel():
        while not finished.wait(0.2):
            if is_cancel_requested():
                loop.cancel()
                return

    threading.Thread(target=watch_cancel, daemon=True).start()

    def queue_state():
        conversation_key = active_conversation_id[0]

        if conversation_key:
            push_chunk({"type": "queue_state", **queue_store.snapshot(conversation_key)})

    def normalized_history():
        conversation = store.get(active_conversation_id[0]) if active_conversation_id[0] else None
        raw_messages = conversation.get("messages", []) if isinstance(conversation, dict) else []
        return normalize_messages(raw_messages)

    def current_turn_final_assistant():
        """取本轮最后一条「已收尾」的 assistant 消息。

        只有正文非空才算收尾:工具调用轮的 assistant 正文为空(或只带 tool_calls),
        那是中间态。把它推给前端会让 applyFinalMessage 用空正文覆盖正在流式的
        气泡,所以返回 None(前端有守卫会忽略)。
        """
        rows = normalized_history()
        latest_user_index = -1

        for index in range(len(rows) - 1, -1, -1):
            if str(rows[index].get("role") or "") == "user":
                latest_user_index = index
                break

        for index in range(len(rows) - 1, latest_user_index, -1):
            message = rows[index]

            if str(message.get("role") or "") != "assistant":
                continue

            tool_calls = message.get("tool_calls")

            if isinstance(tool_calls, list) and tool_calls:
                return None, -1

            if not str(message.get("content") or "").strip():
                return None, -1

            return message, index

        return None, -1

    def start_following(item, guided=False):
        item_id = str(item.get("id") or "")
        text = str(item.get("message") or "")
        assistant_message, assistant_index = current_turn_final_assistant()
        push_chunk({
            "type": "queue_turn_end",
            "conversation_id": active_conversation_id[0],
            "final_message": assistant_message,
            "assistant_index": assistant_index,
        })
        queue_state()
        return text, item_id, False, {"item_id": item_id, "message": text, "guided": guided}

    def restore_after_stop(reason):
        if not active_conversation_id[0]:
            return

        guides, _ = queue_store.rollback_guidance(
            active_conversation_id[0],
            pause_reason=reason,
        )

        for item in guides:
            push_chunk({
                "type": "queue_guide_rollback",
                "conversation_id": active_conversation_id[0],
                "item_id": str(item.get("id") or ""),
                "message": str(item.get("message") or ""),
                "reason": reason,
            })

        queue_state()

    try:
        permission_item = (
            queue_store.permission_resume_item(active_conversation_id[0])
            if active_conversation_id[0] and body.get("queue_resume") is True
            else None
        )
        permission_item_kind = (
            queue_store.snapshot(active_conversation_id[0]).get("permission_item_kind")
            if permission_item
            else ""
        )

        if active_conversation_id[0]:
            queue_store.activate(
                active_conversation_id[0],
                stream_id,
                resume=body.get("skip_user_message") is not True,
                resume_permission=body.get("queue_resume") is True,
            )

        queue_state()
        current_message = str(message or "")
        current_item_id = str(permission_item.get("id") or "") if permission_item else ""
        current_is_guided = permission_item_kind == "guided"
        current_skip_user = body.get("skip_user_message") is True

        if current_skip_user and current_item_id and active_conversation_id[0]:
            queue_store.mark_committed(
                active_conversation_id[0],
                current_item_id,
                item_kind="guided" if current_is_guided else "queued",
            )

        current_thinking = enable_thinking
        is_initial_turn = True
        pending_turn = None
        awaiting_permission = False

        while True:
            if is_cancel_requested():
                restore_after_stop("cancelled")
                return

            turn_error = False
            turn_done = False
            guidance_checkpoint = False
            turn_events = []
            awaiting_permission = False
            user_committed = current_skip_user or not bool(current_item_id)

            for event in loop.stream_send(
                active_conversation_id[0],
                current_message,
                system_prompt=system_prompt,
                injection_sources=injection_sources,
                cancel_checker=is_cancel_requested,
                force_context_compression=body.get("force_context_compression") is True and is_initial_turn,
                skip_user_message=current_skip_user,
                enable_thinking=current_thinking,
                queue_item_id=current_item_id,
                should_yield_for_guidance=(
                    lambda: bool(active_conversation_id[0])
                    and queue_store.has_pending_guidance(active_conversation_id[0])
                ),
            ):
                event_type = str(event.get("type") or "")
                print(f"[LocalAgent] sse event: {event_type}")

                if event_type == "conversation_id" and event.get("conversation_id"):
                    active_conversation_id[0] = str(event.get("conversation_id") or "")
                    set_conversation_id(active_conversation_id[0])

                    snapshot = queue_store.snapshot(active_conversation_id[0])

                    if not snapshot.get("busy"):
                        queue_store.activate(active_conversation_id[0], stream_id, resume=True)

                    queue_state()
                    continue

                if event_type == "queue_guidance_checkpoint":
                    guidance_checkpoint = True
                    continue

                if event_type == "queue_user_committed":
                    user_committed = True

                    if current_item_id:
                        committed_item_id = str(event.get("item_id") or "")

                        if committed_item_id != current_item_id:
                            raise ValueError("committed queue item does not match the active item")

                        queue_store.mark_committed(
                            active_conversation_id[0],
                            current_item_id,
                            item_kind="guided" if current_is_guided else "queued",
                        )

                    if pending_turn:
                        rows = normalized_history()
                        user_index = len(rows) - 1
                        push_chunk({
                            "type": "queue_turn_start",
                            "conversation_id": active_conversation_id[0],
                            **pending_turn,
                            "user_index": user_index,
                            "assistant_index": user_index + 1,
                        })

                    for buffered_event in turn_events:
                        push_chunk(translate_event(buffered_event))

                    turn_events.clear()
                    pending_turn = None
                    continue

                if event_type == "done":
                    turn_done = True
                    awaiting_permission = event.get("awaiting_permission") is True
                    continue

                if event_type == "queue_cancelled":
                    continue

                if event_type == "error":
                    turn_error = True

                if not user_committed:
                    turn_events.append(event)
                    continue

                push_chunk(translate_event(event))

            if is_cancel_requested() or turn_error:
                restore_after_stop("cancelled" if is_cancel_requested() else "error")
                return

            if awaiting_permission:
                if active_conversation_id[0]:
                    queue_store.wait_for_permission(
                        active_conversation_id[0],
                        item_id=current_item_id,
                        item_kind="guided" if current_is_guided else "queued" if current_item_id else "",
                    )
                    queue_state()

                break

            if guidance_checkpoint or turn_done:
                advance = queue_store.advance(
                    active_conversation_id[0],
                    completed_item_id=current_item_id if current_item_id and not current_is_guided else "",
                    completed_guidance_id=current_item_id if current_item_id and current_is_guided else "",
                ) if active_conversation_id[0] else {"item": None, "kind": "", "finished": True}
                queue_state()
                next_item = advance.get("item")

                if next_item is not None:
                    guided = advance.get("kind") == "guided"
                    current_message, current_item_id, current_skip_user, pending_turn = start_following(next_item, guided=guided)
                    current_is_guided = guided
                    current_thinking = next_item.get("enable_thinking")
                    is_initial_turn = False
                    continue

                break

            break

        if active_conversation_id[0]:
            queue_state()
        push_chunk({"type": "done", "conversation_id": active_conversation_id[0], **({"awaiting_permission": True} if awaiting_permission else {})})

        if active_conversation_id[0]:
            from .TitleGenerator import wait_for_title
            wait_for_title(active_conversation_id[0], timeout=8.0)
    except StreamCancelled:
        restore_after_stop("cancelled")
        return
    except Exception as exc:
        print(f"[LocalAgent] stream error: {type(exc).__name__}: {exc}")
        if active_conversation_id[0]:
            restore_after_stop("cancelled" if is_cancel_requested() else "error")

        if is_cancel_requested():
            return

        try:
            push_chunk({"type": "error", "message": f"local conversation failed: {exc}"})
        except StreamCancelled:
            return

        raise
    finally:
        finished.set()

