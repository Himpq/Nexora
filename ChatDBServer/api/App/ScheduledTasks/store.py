"""Persistent weekly schedules and execution records."""

import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATABASE_PATH = os.path.join(BASE_DIR, "data", "scheduled_tasks.sqlite3")
TIME_ZONE = ZoneInfo("Asia/Shanghai")
RUN_LEASE_SECONDS = 4 * 60 * 60


class TaskRunConflictError(Exception):
    """Raised when a task already has an active or queued execution."""


def _ensure_columns(connection, table_name, required_columns):
    """Apply missing additive columns without racing other worker processes."""
    columns = {
        row["name"]
        for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    missing = {name: definition for name, definition in required_columns.items() if name not in columns}

    if not missing:
        return

    connection.execute("BEGIN IMMEDIATE")

    try:
        columns = {
            row["name"]
            for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
        }

        for name, definition in required_columns.items():
            if name not in columns:
                connection.execute(
                    f"ALTER TABLE {table_name} ADD COLUMN {name} {definition}"
                )

        connection.commit()
    except Exception:
        connection.rollback()
        raise


@contextmanager
def _connection():
    """Open the shared task database; SQLite transactions coordinate web workers."""
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=30, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 30000")
    connection.execute("""
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            task_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            title TEXT NOT NULL,
            prompt TEXT NOT NULL,
            weekdays TEXT NOT NULL,
            hour INTEGER NOT NULL,
            minute INTEGER NOT NULL,
            enabled INTEGER NOT NULL,
            next_run_at INTEGER NOT NULL,
            running_until INTEGER NOT NULL DEFAULT 0,
            last_status TEXT NOT NULL DEFAULT '',
            last_error TEXT NOT NULL DEFAULT '',
            last_knowledge_title TEXT NOT NULL DEFAULT '',
            output_conversation_id TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS scheduled_task_runs (
            run_id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            scheduled_at INTEGER NOT NULL,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            status TEXT NOT NULL,
            trigger_type TEXT NOT NULL DEFAULT 'scheduled',
            knowledge_title TEXT NOT NULL DEFAULT '',
            conversation_id TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            error TEXT NOT NULL DEFAULT ''
        )
    """)

    _ensure_columns(
        connection,
        "scheduled_tasks",
        {"output_conversation_id": "TEXT NOT NULL DEFAULT ''"},
    )
    _ensure_columns(
        connection,
        "scheduled_task_runs",
        {
            "trigger_type": "TEXT NOT NULL DEFAULT 'scheduled'",
            "conversation_id": "TEXT NOT NULL DEFAULT ''",
            "summary": "TEXT NOT NULL DEFAULT ''",
        },
    )

    _migrate_run_schedule_uniqueness(connection)
    connection.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS scheduled_task_runs_schedule_slot
        ON scheduled_task_runs(task_id, scheduled_at)
        WHERE trigger_type = 'scheduled'
    """)
    connection.execute("CREATE INDEX IF NOT EXISTS scheduled_tasks_due ON scheduled_tasks(enabled, next_run_at)")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _has_legacy_schedule_unique_constraint(connection):
    indexes = connection.execute("PRAGMA index_list(scheduled_task_runs)").fetchall()

    for index in indexes:
        if not bool(index["unique"]) or str(index["origin"] or "") != "u":
            continue

        index_name = str(index["name"] or "").replace('"', '""')
        columns = connection.execute(f'PRAGMA index_info("{index_name}")').fetchall()
        column_names = [str(column["name"] or "") for column in columns]

        if column_names == ["task_id", "scheduled_at"]:
            return True

    return False


def _migrate_run_schedule_uniqueness(connection):
    """Keep scheduled-slot deduplication while allowing manual runs at the same time."""
    if not _has_legacy_schedule_unique_constraint(connection):
        return

    connection.execute("BEGIN IMMEDIATE")

    try:
        if not _has_legacy_schedule_unique_constraint(connection):
            connection.commit()
            return

        connection.execute("""
            CREATE TABLE scheduled_task_runs_new (
                run_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                scheduled_at INTEGER NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                status TEXT NOT NULL,
                trigger_type TEXT NOT NULL DEFAULT 'scheduled',
                knowledge_title TEXT NOT NULL DEFAULT '',
                conversation_id TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL DEFAULT '',
                error TEXT NOT NULL DEFAULT ''
            )
        """)
        connection.execute("""
            INSERT INTO scheduled_task_runs_new (
                run_id, task_id, scheduled_at, started_at, finished_at, status,
                trigger_type, knowledge_title, conversation_id, summary, error
            )
            SELECT
                run_id, task_id, scheduled_at, started_at, finished_at, status,
                trigger_type, knowledge_title, conversation_id, summary, error
            FROM scheduled_task_runs
        """)
        connection.execute("DROP TABLE scheduled_task_runs")
        connection.execute("ALTER TABLE scheduled_task_runs_new RENAME TO scheduled_task_runs")
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _validate_schedule(weekdays, hour, minute):
    """Require an explicit weekly schedule in Beijing time."""
    if not isinstance(weekdays, list) or not weekdays or len(weekdays) > 7:
        raise ValueError("weekdays 必须包含至少一个星期数字，周一为 0、周日为 6")

    if any(type(day) is not int or day < 0 or day > 6 for day in weekdays):
        raise ValueError("weekdays 只能使用 0 到 6 的整数")

    days = sorted(set(weekdays))

    if type(hour) is not int or hour < 0 or hour > 23:
        raise ValueError("hour 必须是 0 到 23 的整数")

    if type(minute) is not int or minute < 0 or minute > 59:
        raise ValueError("minute 必须是 0 到 59 的整数")

    return days


def _next_run_at(days, hour, minute, after):
    local_now = datetime.fromtimestamp(after, TIME_ZONE)

    for offset in range(8):
        date = (local_now + timedelta(days=offset)).date()

        if date.weekday() not in days:
            continue

        candidate = datetime(date.year, date.month, date.day, hour, minute, tzinfo=TIME_ZONE)

        if candidate.timestamp() > after:
            return int(candidate.timestamp())

    raise ValueError("无法计算下次执行时间")


def _validate_text(title, prompt):
    title = str(title or "").strip()
    prompt = str(prompt or "").strip()

    if not title or len(title) > 120:
        raise ValueError("任务标题不能为空且不能超过 120 字")

    if not prompt or len(prompt) > 12000:
        raise ValueError("提示词不能为空且不能超过 12000 字")

    return title, prompt


def _task_dict(row):
    value = dict(row)
    value["weekdays"] = [int(day) for day in value["weekdays"].split(",")]
    value["enabled"] = bool(value["enabled"])
    value.pop("running_until", None)
    return value


def create_task(username, title, prompt, weekdays, hour, minute, output_conversation_id=""):
    """Create one schedule owned by the authenticated user."""
    username = str(username or "").strip()
    output_conversation_id = str(output_conversation_id or "").strip()

    if not username:
        raise ValueError("用户不能为空")

    if output_conversation_id:
        from basis.Conversation.errors import ConversationError
        from basis.Conversation.service import ConversationService

        try:
            ConversationService(username).get_conversation(output_conversation_id)
        except ConversationError as exc:
            raise ValueError("指定的输出会话不存在") from exc

    title, prompt = _validate_text(title, prompt)
    days = _validate_schedule(weekdays, hour, minute)
    now = int(time.time())
    task_id = "task_" + uuid.uuid4().hex
    next_run_at = _next_run_at(days, hour, minute, now)

    with _connection() as connection:
        connection.execute("""
            INSERT INTO scheduled_tasks (
                task_id, username, title, prompt, weekdays, hour, minute,
                enabled, next_run_at, output_conversation_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        """, (
            task_id,
            username,
            title,
            prompt,
            ",".join(map(str, days)),
            hour,
            minute,
            next_run_at,
            output_conversation_id,
            now,
            now,
        ))
        row = connection.execute("SELECT * FROM scheduled_tasks WHERE task_id = ?", (task_id,)).fetchone()

    return _task_dict(row)


def list_tasks(username):
    with _connection() as connection:
        rows = connection.execute("""
            SELECT * FROM scheduled_tasks WHERE username = ? ORDER BY created_at DESC
        """, (username,)).fetchall()

    return [_task_dict(row) for row in rows]


def update_task(username, task_id, changes):
    """Update an owned task without changing a run already in progress."""
    allowed = {"title", "prompt", "weekdays", "hour", "minute", "enabled"}

    if not isinstance(changes, dict) or not changes or set(changes) - allowed:
        raise ValueError("任务更新字段无效")

    with _connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM scheduled_tasks WHERE username = ? AND task_id = ?", (username, task_id)).fetchone()

        if row is None:
            raise LookupError("定时任务不存在")

        current = _task_dict(row)
        title, prompt = _validate_text(changes.get("title", current["title"]), changes.get("prompt", current["prompt"]))
        days = _validate_schedule(changes.get("weekdays", current["weekdays"]), changes.get("hour", current["hour"]), changes.get("minute", current["minute"]))
        enabled = changes.get("enabled", current["enabled"])

        if type(enabled) is not bool:
            raise ValueError("enabled 必须是布尔值")

        now = int(time.time())
        next_run_at = _next_run_at(days, changes.get("hour", current["hour"]), changes.get("minute", current["minute"]), now)
        connection.execute("""
            UPDATE scheduled_tasks SET title = ?, prompt = ?, weekdays = ?, hour = ?, minute = ?,
                enabled = ?, next_run_at = ?, updated_at = ? WHERE username = ? AND task_id = ?
        """, (title, prompt, ",".join(map(str, days)), changes.get("hour", current["hour"]), changes.get("minute", current["minute"]), int(enabled), next_run_at, now, username, task_id))
        updated = connection.execute("SELECT * FROM scheduled_tasks WHERE task_id = ?", (task_id,)).fetchone()

    return _task_dict(updated)


def delete_task(username, task_id):
    with _connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT running_until FROM scheduled_tasks WHERE username = ? AND task_id = ?", (username, task_id)).fetchone()

        if row is None:
            raise LookupError("定时任务不存在")

        if row["running_until"] > int(time.time()):
            raise ValueError("任务正在执行，请等待本次执行结束后删除")

        connection.execute("""
            UPDATE scheduled_task_runs SET status = 'cancelled', finished_at = ?,
                error = '任务已删除，取消待执行的手动运行'
            WHERE task_id = ? AND trigger_type = 'manual' AND status = 'queued'
        """, (int(time.time()), task_id))
        cursor = connection.execute("DELETE FROM scheduled_tasks WHERE username = ? AND task_id = ?", (username, task_id))

        if cursor.rowcount != 1:
            raise LookupError("定时任务不存在")


def list_runs(username, task_id, limit=20):
    with _connection() as connection:
        owner = connection.execute("SELECT 1 FROM scheduled_tasks WHERE username = ? AND task_id = ?", (username, task_id)).fetchone()

        if owner is None:
            raise LookupError("定时任务不存在")

        rows = connection.execute("""
            SELECT * FROM scheduled_task_runs
            WHERE task_id = ? ORDER BY scheduled_at DESC, started_at DESC, run_id DESC LIMIT ?
        """, (task_id, limit)).fetchall()

    return [dict(row) for row in rows]


def queue_manual_run(username, task_id):
    """Queue one immediate run without moving the task's recurring schedule."""
    now = int(time.time())
    run_id = "run_" + uuid.uuid4().hex

    with _connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        task = connection.execute(
            "SELECT task_id, running_until FROM scheduled_tasks WHERE username = ? AND task_id = ?",
            (username, task_id),
        ).fetchone()

        if task is None:
            raise LookupError("定时任务不存在")

        if int(task["running_until"] or 0) > now:
            raise TaskRunConflictError("任务正在执行，请完成后再触发")

        queued_run = connection.execute("""
            SELECT run_id FROM scheduled_task_runs
            WHERE task_id = ? AND trigger_type = 'manual' AND status = 'queued'
            LIMIT 1
        """, (task_id,)).fetchone()

        if queued_run is not None:
            raise TaskRunConflictError("任务已在等待执行")

        connection.execute("""
            INSERT INTO scheduled_task_runs (
                run_id, task_id, scheduled_at, started_at, status, trigger_type
            ) VALUES (?, ?, ?, 0, 'queued', 'manual')
        """, (run_id, task_id, now))

    return {
        "run_id": run_id,
        "task_id": task_id,
        "scheduled_at": now,
        "started_at": 0,
        "finished_at": None,
        "status": "queued",
        "trigger_type": "manual",
        "knowledge_title": "",
        "conversation_id": "",
        "summary": "",
        "error": "",
    }


def claim_due_task():
    """Atomically claim one due slot across all ChatDBServer processes."""
    now = int(time.time())

    with _connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("""
            UPDATE scheduled_task_runs SET status = 'failed', finished_at = ?, error = '执行进程未在租约时间内完成'
            WHERE status = 'running' AND started_at < ?
        """, (now, now - RUN_LEASE_SECONDS))
        connection.execute("""
            UPDATE scheduled_tasks SET last_status = 'failed', last_error = '执行进程未在租约时间内完成'
            WHERE last_status = 'running' AND running_until < ?
        """, (now,))

        queued_run = connection.execute("""
            SELECT run.run_id, run.task_id, run.scheduled_at
            FROM scheduled_task_runs AS run
            INNER JOIN scheduled_tasks AS task ON task.task_id = run.task_id
            WHERE run.trigger_type = 'manual' AND run.status = 'queued'
                AND task.running_until <= ?
            ORDER BY run.scheduled_at, run.run_id
            LIMIT 1
        """, (now,)).fetchone()

        if queued_run is not None:
            task_row = connection.execute(
                "SELECT * FROM scheduled_tasks WHERE task_id = ?",
                (queued_run["task_id"],),
            ).fetchone()
            task = _task_dict(task_row)
            connection.execute("""
                UPDATE scheduled_task_runs SET status = 'running', started_at = ?
                WHERE run_id = ? AND status = 'queued'
            """, (now, queued_run["run_id"]))
            connection.execute("""
                UPDATE scheduled_tasks SET running_until = ?, last_status = 'running',
                    last_error = '', updated_at = ? WHERE task_id = ?
            """, (now + RUN_LEASE_SECONDS, now, task["task_id"]))
            task["run_id"] = queued_run["run_id"]
            task["scheduled_at"] = queued_run["scheduled_at"]
            task["trigger_type"] = "manual"
            return task

        row = connection.execute("""
            SELECT * FROM scheduled_tasks
            WHERE enabled = 1 AND next_run_at <= ? AND running_until <= ?
            ORDER BY next_run_at LIMIT 1
        """, (now, now)).fetchone()

        if row is None:
            return None

        task = _task_dict(row)
        scheduled_at = task["next_run_at"]
        next_run_at = _next_run_at(task["weekdays"], task["hour"], task["minute"], now)

        run_id = "run_" + uuid.uuid4().hex
        connection.execute("""
            UPDATE scheduled_tasks SET next_run_at = ?, running_until = ?,
                last_status = 'running', last_error = '', updated_at = ? WHERE task_id = ?
        """, (next_run_at, now + RUN_LEASE_SECONDS, now, task["task_id"]))
        connection.execute("""
            INSERT INTO scheduled_task_runs (
                run_id, task_id, scheduled_at, started_at, status, trigger_type
            ) VALUES (?, ?, ?, ?, 'running', 'scheduled')
        """, (run_id, task["task_id"], scheduled_at, now))

    task["run_id"] = run_id
    task["scheduled_at"] = scheduled_at
    task["trigger_type"] = "scheduled"
    return task


def finish_run(task, status, knowledge_title="", error=""):
    now = int(time.time())

    with _connection() as connection:
        connection.execute("""
            UPDATE scheduled_task_runs SET finished_at = ?, status = ?, knowledge_title = ?,
                conversation_id = ?, summary = ?, error = ?
            WHERE run_id = ?
        """, (
            now,
            status,
            knowledge_title,
            task.get("conversation_id", ""),
            task.get("summary", ""),
            error,
            task["run_id"],
        ))
        connection.execute("""
            UPDATE scheduled_tasks SET running_until = 0, last_status = ?, last_error = ?,
                last_knowledge_title = ?, updated_at = ? WHERE task_id = ?
        """, (status, error, knowledge_title, now, task["task_id"]))


def set_run_conversation(task, conversation_id):
    now = int(time.time())
    conversation_id = str(conversation_id or "").strip()

    with _connection() as connection:
        connection.execute("""
            UPDATE scheduled_tasks SET output_conversation_id = ?, updated_at = ?
            WHERE task_id = ?
        """, (conversation_id, now, task["task_id"]))
        connection.execute("""
            UPDATE scheduled_task_runs SET conversation_id = ? WHERE run_id = ?
        """, (conversation_id, task["run_id"]))


def renew_run_lease(task):
    """Keep a task locked while it waits for a bound conversation to finish streaming."""
    now = int(time.time())

    with _connection() as connection:
        cursor = connection.execute("""
            UPDATE scheduled_tasks SET running_until = ?, updated_at = ?
            WHERE task_id = ? AND EXISTS (
                SELECT 1 FROM scheduled_task_runs
                WHERE run_id = ? AND status = 'running'
            )
        """, (now + RUN_LEASE_SECONDS, now, task["task_id"], task["run_id"]))

        if cursor.rowcount != 1:
            raise RuntimeError("定时任务执行租约已失效")
