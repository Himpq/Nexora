"""
面向模型的简洁终端工具。

命令默认观察 10 秒。观察窗口结束后返回已经产生的输出，进程继续运行，
之后可以读取新增输出或显式终止。工具不提供 stdin 写入。
"""

import threading
import time

from tools.process_manager import local_process_manager


DEFAULT_WAIT_SECONDS = 10
_OUTPUT_CHUNK_CHARS = 8000
_TERMINATION_GRACE_SECONDS = 5
_POLL_INTERVAL_SECONDS = 0.05
_TERMINAL_CURSOR_LOCK = threading.RLock()
_TERMINAL_OUTPUT_CURSORS: dict[str, int] = {}


def local_terminal(
    action: str,
    command: str = "",
    terminal_id: str = "",
    cwd: str = "",
    wait_seconds: int = DEFAULT_WAIT_SECONDS,
) -> dict:
    """运行、读取或终止由本工具创建的终端进程。"""
    normalized_action = str(action or "").strip().lower()

    if normalized_action == "run":
        return _run_terminal(
            command=command,
            cwd=cwd,
            wait_seconds=wait_seconds,
        )

    if normalized_action == "read":
        return _read_terminal(terminal_id)

    if normalized_action == "terminate":
        return _terminate_terminal(terminal_id)

    return {
        "success": False,
        "error": "action must be run, read, or terminate.",
    }


def _run_terminal(
    command: str,
    cwd: str,
    wait_seconds: int,
) -> dict:
    wait_seconds, wait_error = _validate_wait_seconds(wait_seconds)

    if wait_error:
        return wait_error

    started = local_process_manager(
        action="start",
        command=command,
        cwd=cwd,
        timeout=0,
        encoding="utf-8",
    )

    if not started.get("success"):
        return started

    terminal_id = str(started.get("process_id") or "")
    _register_terminal_cursor(terminal_id)
    wait_expired = _wait_for_exit(terminal_id, wait_seconds)

    result = _read_terminal(terminal_id)

    if not result.get("success"):
        return result

    result["wait_expired"] = wait_expired

    return result


def _read_terminal(terminal_id: str) -> dict:
    clean_id = str(terminal_id or "").strip()

    if not clean_id:
        return {"success": False, "error": "terminal_id is required."}

    with _TERMINAL_CURSOR_LOCK:
        if clean_id not in _TERMINAL_OUTPUT_CURSORS:
            return {"success": False, "error": f"Unknown terminal_id: {clean_id}."}

        output_from_byte = _TERMINAL_OUTPUT_CURSORS[clean_id]
        snapshot = local_process_manager(
            action="read",
            process_id=clean_id,
            max_output_chars=_OUTPUT_CHUNK_CHARS,
            output_from_byte=output_from_byte,
        )

        if snapshot.get("success"):
            _TERMINAL_OUTPUT_CURSORS[clean_id] = int(
                snapshot.get("next_output_byte", output_from_byte) or output_from_byte
            )

    if not snapshot.get("success"):
        return snapshot

    return {
        "success": True,
        "terminal_id": clean_id,
        "status": snapshot.get("status"),
        "returncode": snapshot.get("returncode"),
        "output": snapshot.get("output", ""),
        "truncated": bool(snapshot.get("truncated")),
        "has_more": bool(snapshot.get("has_more")),
        "buffer_bytes": snapshot.get("buffer_bytes", 0),
    }


def _terminate_terminal(terminal_id: str) -> dict:
    clean_id = str(terminal_id or "").strip()

    if not clean_id:
        return {"success": False, "error": "terminal_id is required."}

    with _TERMINAL_CURSOR_LOCK:
        if clean_id not in _TERMINAL_OUTPUT_CURSORS:
            return {"success": False, "error": f"Unknown terminal_id: {clean_id}."}

    stopped = local_process_manager(
        action="stop",
        process_id=clean_id,
        grace_seconds=_TERMINATION_GRACE_SECONDS,
    )

    if not stopped.get("success"):
        return stopped

    result = _read_terminal(clean_id)

    if not result.get("success"):
        return result

    result["status"] = "terminated" if stopped.get("status") == "stopped" else "exited"
    result["stopped_by"] = stopped.get("stopped_by")

    return result


def _wait_for_exit(terminal_id: str, wait_seconds: int) -> bool:
    deadline = time.monotonic() + wait_seconds

    while True:
        status = local_process_manager(action="status", process_id=terminal_id)

        if not status.get("success"):
            return False

        process = status.get("process") or {}

        if process.get("status") == "exited":
            return False

        remaining = deadline - time.monotonic()

        if remaining <= 0:
            return True

        time.sleep(min(_POLL_INTERVAL_SECONDS, remaining))


def _register_terminal_cursor(terminal_id: str) -> None:
    with _TERMINAL_CURSOR_LOCK:
        _TERMINAL_OUTPUT_CURSORS[terminal_id] = 0


def _validate_wait_seconds(wait_seconds) -> tuple[int, dict | None]:
    if isinstance(wait_seconds, bool):
        return 0, {"success": False, "error": "wait_seconds must be an integer from 0 to 86400."}

    try:
        parsed = int(wait_seconds)
    except (TypeError, ValueError):
        return 0, {"success": False, "error": "wait_seconds must be an integer from 0 to 86400."}

    if parsed < 0 or parsed > 24 * 60 * 60:
        return 0, {"success": False, "error": "wait_seconds must be an integer from 0 to 86400."}

    return parsed, None
