"""Run scheduled prompts through ChatDBServer's existing model and tools."""

import threading
import traceback
from datetime import datetime
from zoneinfo import ZoneInfo

from .store import claim_due_task, finish_run


_start_lock = threading.Lock()
_worker_thread = None
_poll_seconds = 20


def _generate_report(task):
    """Execute the user's prompt without creating a conversation file."""
    from App.Core.model import Model

    model = Model(
        task["username"],
        auto_create=False,
        persist_conversation=False,
    )
    # sendMessage 会重建工具列表；使用它现有的运行时排除集合，确保报告只由执行器保存一次。
    model._runtime_project_excluded_tool_names = {
        "scheduled_task_create",
        "scheduled_task_list",
        "scheduled_task_update",
        "scheduled_task_delete",
        "knowledge_basis_create",
        "knowledge_basis_update",
        "knowledge_basis_delete",
    }
    prompt = (
        "你正在执行用户预先设置的定时任务。完成以下提示词并给出最终的完整 Markdown 报告。"
        "可以使用当前可用的检索和其他工具。不要创建知识库条目、发送通知或修改定时任务；"
        "执行器会在你完成后统一保存和通知。\n\n"
        + task["prompt"]
    )
    content = ""
    error = ""

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
    """Save one report and notify its owner after generation succeeds."""
    from App.Observability.notification import create_user_notification
    from basis.User import User

    try:
        report = _generate_report(task)
        local_time = datetime.now(ZoneInfo("Asia/Shanghai"))
        knowledge_title = f"{task['title']} · {local_time:%Y-%m-%d %H:%M} · {task['run_id'][-6:]}"
        user = User(task["username"])
        user.addBasis(
            knowledge_title,
            report,
            "",
            timeline_actor={
                "actor_type": "scheduled_task",
                "actor_name": task["title"],
                "task_id": task["task_id"],
            },
        )
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

    finish_run(task, "success", knowledge_title=knowledge_title)

    try:
        create_user_notification(task["username"], {
            "title": "定时任务已完成",
            "content": f"{task['title']} 的报告已保存到知识库：{knowledge_title}",
            "source": "定时任务",
            "level": "success",
            "meta": {"task_id": task["task_id"], "knowledge_title": knowledge_title},
        })
    except Exception as exc:
        print(f"[ScheduledTasks] report saved but notification failed run_id={task['run_id']}: {exc}")


def _poll_forever():
    """Keep polling after individual task failures; claims are database atomic."""
    while True:
        try:
            task = claim_due_task()

            if task is not None:
                _run_task(task)
                continue
        except Exception as exc:
            print(f"[ScheduledTasks] scheduler failed: {exc}")
            traceback.print_exc()

        threading.Event().wait(_poll_seconds)


def start_worker():
    """Start one poller in each process; SQLite assigns each run once."""
    global _worker_thread

    with _start_lock:
        if _worker_thread is not None and _worker_thread.is_alive():
            return

        _worker_thread = threading.Thread(target=_poll_forever, name="ScheduledTasks", daemon=True)
        _worker_thread.start()
