"""Run scheduled prompts through ChatDBServer's existing model and tools."""

import threading
import time
import traceback

from .store import claim_due_task, finish_run, renew_run_lease, set_run_conversation


_start_lock = threading.Lock()
_worker_thread = None
_wake_event = threading.Event()
_poll_seconds = 20
_conversation_wait_seconds = 2
_lease_renew_seconds = 60


def _ensure_output_conversation(task):
    """Reuse the task's output conversation, creating a new one after deletion."""
    from basis.Conversation.errors import ConversationNotFoundError
    from basis.Conversation.service import ConversationService

    conversation_service = ConversationService(task["username"])
    conversation_id = str(task.get("output_conversation_id") or "").strip()

    if conversation_id:
        try:
            conversation_service.get_conversation(conversation_id)
        except ConversationNotFoundError:
            conversation_id = ""

    if not conversation_id:
        conversation_id = conversation_service.create_conversation(
            title=f"定时任务 · {task['title']} · {task['task_id'][-6:]}",
            tags=["scheduled_task"],
        )

    set_run_conversation(task, conversation_id)
    task["conversation_id"] = conversation_id
    task["output_conversation_id"] = conversation_id
    return conversation_id


def _wait_for_conversation_idle(task, conversation_id):
    """Wait until the bound conversation's current assistant reply is complete."""
    from basis.Conversation.errors import ConversationNotFoundError
    from basis.Conversation.service import ConversationService

    conversation_service = ConversationService(task["username"])
    waiting = False
    next_lease_renewal = time.monotonic() + _lease_renew_seconds

    while True:
        try:
            messages = conversation_service.get_messages(conversation_id, limit=1)
        except ConversationNotFoundError:
            return False

        latest_message = messages[-1] if messages else {}
        is_streaming = (
            str(latest_message.get("role") or "") == "assistant"
            and str(latest_message.get("status") or "") == "streaming"
        )

        if not is_streaming:
            if waiting:
                print(f"[ScheduledTasks] conversation idle task_id={task['task_id']} run_id={task['run_id']}")

            return True

        if not waiting:
            print(f"[ScheduledTasks] waiting for conversation stream task_id={task['task_id']} run_id={task['run_id']}")
            waiting = True

        if time.monotonic() >= next_lease_renewal:
            renew_run_lease(task)
            next_lease_renewal = time.monotonic() + _lease_renew_seconds

        time.sleep(_conversation_wait_seconds)


def _extract_summary(report):
    """Read the last short summary section so progress text cannot replace the result."""
    summary_heading = "## 本次摘要"
    details_heading = "## 完整结果"
    summary_start = report.rfind(summary_heading)

    if summary_start < 0:
        return ""

    summary_content_start = summary_start + len(summary_heading)
    details_start = report.find(details_heading, summary_content_start)
    summary_end = details_start if details_start >= 0 else len(report)
    summary_text = report[summary_content_start:summary_end]
    return " ".join(summary_text.split())[:500]


def _generate_report(task, conversation_id):
    """Execute the user's prompt and persist the exchange in its task channel."""
    from App.Core.model import Model
    from basis.Conversation.message_display import persisted_user_message_display

    model = Model(
        task["username"],
        conversation_id=conversation_id,
        auto_create=False,
        persist_conversation=True,
    )
    # Keep task-management and destructive knowledge tools out of unattended runs.
    model._runtime_project_excluded_tool_names = {
        "scheduled_task_create",
        "scheduled_task_list",
        "scheduled_task_update",
        "scheduled_task_delete",
        "knowledge_basis_delete",
    }
    prompt = (
        "你正在执行用户预先设置的定时任务。可以按需使用当前可用工具，包括搜索、查看、新增或更新知识库；"
        "不要删除知识条目或修改定时任务。任务完成后，应用会自动发送站内摘要通知；无需调用工具发送站内通知，"
        "也不要声称无法发送该站内通知。若任务另要求邮件、短信等站外通知，只能在当前可用工具确实支持时发送，并如实报告结果。"
        "请先完成全部任务操作，再用 1 到 3 句话概括已完成结果，最后给出完整结果，格式为："
        "\n\n## 本次摘要\n（简短总结）\n\n## 完整结果\n（完整结果）\n\n"
        + task["prompt"]
    )
    content = ""
    error = ""

    display_message = f"开始执行定时任务：{str(task.get('title') or '').strip()}".strip("：")

    with persisted_user_message_display(display_message):
        for chunk in model.sendMessage(
            prompt,
            stream=True,
            enable_web_search=True,
            enable_tools=True,
            include_context=False,
        ):
            if not isinstance(chunk, dict):
                continue

            chunk_type = str(chunk.get("type") or "")

            if chunk_type == "done":
                content = str(chunk.get("content") or "").strip()

            if chunk_type == "error":
                error = str(chunk.get("content") or "模型执行失败").strip()

            if chunk_type == "warning":
                error = str(chunk.get("content") or "模型执行未完成").strip()

    if error:
        raise RuntimeError(error)

    if not content:
        raise RuntimeError("模型未生成报告正文")

    return content


def _run_task(task):
    """Run one task in its output conversation and notify its owner."""
    from App.Observability.notification import create_user_notification

    conversation_id = ""
    summary = ""

    try:
        while True:
            conversation_id = _ensure_output_conversation(task)

            if _wait_for_conversation_idle(task, conversation_id):
                break

        report = _generate_report(task, conversation_id)
        summary = _extract_summary(report)

        if not summary:
            print(f"[ScheduledTasks] report summary missing task_id={task['task_id']} run_id={task['run_id']}")

        task["summary"] = summary
    except Exception as exc:
        print(f"[ScheduledTasks] run failed task_id={task['task_id']} run_id={task['run_id']}: {exc}")
        traceback.print_exc()
        finish_run(task, "failed", error=str(exc)[:500])

        try:
            create_user_notification(task["username"], {
                "title": "定时任务执行失败",
                "content": f"{task['title']} 执行失败，请在定时任务栏目查看原因。",
                "source": "定时任务",
                "level": "error",
                "meta": {"task_id": task["task_id"]},
            })
        except Exception as notification_error:
            print(f"[ScheduledTasks] failure notification failed run_id={task['run_id']}: {notification_error}")

        return

    finish_run(task, "success")

    try:
        create_user_notification(task["username"], {
            "title": "定时任务已完成",
            "content": f"{task['title']} 已完成。摘要：{summary}",
            "source": "定时任务",
            "level": "success",
            "meta": {
                "task_id": task["task_id"],
                "conversation_id": conversation_id,
                "summary": summary,
            },
        })
    except Exception as exc:
        print(f"[ScheduledTasks] run completed but notification failed run_id={task['run_id']}: {exc}")


def _poll_forever():
    """Keep polling after individual task failures; claims are database atomic."""
    while True:
        _wake_event.clear()

        try:
            task = claim_due_task()

            if task is not None:
                _run_task(task)
                continue
        except Exception as exc:
            print(f"[ScheduledTasks] scheduler failed: {exc}")
            traceback.print_exc()

        _wake_event.wait(_poll_seconds)


def wake_worker():
    """Wake the local poller after a user requests an immediate run."""
    _wake_event.set()


def start_worker():
    """Start one poller in each process; SQLite assigns each run once."""
    global _worker_thread

    with _start_lock:
        if _worker_thread is not None and _worker_thread.is_alive():
            return

        _worker_thread = threading.Thread(target=_poll_forever, name="ScheduledTasks", daemon=True)
        _worker_thread.start()
