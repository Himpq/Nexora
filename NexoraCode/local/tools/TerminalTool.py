"""
NexoraCode.local.tools.TerminalTool — 面向模型的简洁终端工具

local_terminal：统一运行本地命令，尤其用于服务器、监听器、开发服务等长任务。
- run 默认观察 10 秒，观察窗口结束返回已有输出并保留进程
- 之后用 terminal_id 通过 read 读取新增输出，或 terminate 终止
- 不提供 stdin 写入

底层复用 ProcessCore 的进程状态表，与 local_process_manager 一致。
"""

from __future__ import annotations

import threading
import time

from ..Tool import LocalTool, ToolContext
from . import ProcessCore


DEFAULT_WAIT_SECONDS = 10
_OUTPUT_CHUNK_CHARS = 8000
_TERMINATION_GRACE_SECONDS = 5
_POLL_INTERVAL_SECONDS = 0.05
_TERMINAL_CURSOR_LOCK = threading.RLock()
_TERMINAL_OUTPUT_CURSORS: dict[str, int] = {}


class TerminalTool(LocalTool):
    name = "local_terminal"
    description = (
        "统一运行本地命令，尤其用于服务器、监听器、开发服务和其他持续时间不确定的任务。"
        "run 默认观察 10 秒；观察窗口结束时返回已有输出并保留进程。"
        "之后使用 terminal_id 通过 read 读取新增输出，或通过 terminate 终止进程。"
        "action 取值：run | read | terminate。"
        "本工具不支持向 stdin 写入内容。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["run", "read", "terminate"],
                "description": "run(运行命令) | read(读取当前输出) | terminate(终止进程并读取最终输出)",
            },
            "command": {"type": "string", "description": "要运行的命令，仅 run 使用"},
            "terminal_id": {"type": "string", "description": "read/terminate 必须传入"},
            "cwd": {"type": "string", "description": "工作目录，仅 run 使用"},
            "wait_seconds": {
                "type": "integer",
                "default": 10,
                "minimum": 0,
                "maximum": 86400,
                "description": "run 在返回前观察命令的秒数，默认 10；窗口结束不会终止进程",
            },
        },
        "required": ["action"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        action = str(args.get("action") or "").strip().lower()

        if action == "run":
            return self._run_terminal(
                command=str(args.get("command") or ""),
                cwd=str(args.get("cwd") or ""),
                wait_seconds=args.get("wait_seconds", DEFAULT_WAIT_SECONDS),
            )

        if action == "read":
            return self._read_terminal(str(args.get("terminal_id") or ""))

        if action == "terminate":
            return self._terminate_terminal(str(args.get("terminal_id") or ""))

        return {
            "success": False,
            "error": "action must be run, read, or terminate.",
        }

    def _run_terminal(self, command: str, cwd: str, wait_seconds: int) -> dict:
        wait_seconds, wait_error = _validate_wait_seconds(wait_seconds)

        if wait_error:
            return wait_error

        started = ProcessCore.process_manager(
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

        result = self._read_terminal(terminal_id)

        if not result.get("success"):
            return result

        result["wait_expired"] = wait_expired
        return result

    def _read_terminal(self, terminal_id: str) -> dict:
        clean_id = str(terminal_id or "").strip()

        if not clean_id:
            return {"success": False, "error": "terminal_id is required."}

        with _TERMINAL_CURSOR_LOCK:
            if clean_id not in _TERMINAL_OUTPUT_CURSORS:
                return {"success": False, "error": f"Unknown terminal_id: {clean_id}."}

            output_from_byte = _TERMINAL_OUTPUT_CURSORS[clean_id]
            snapshot = ProcessCore.process_manager(
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

    def _terminate_terminal(self, terminal_id: str) -> dict:
        clean_id = str(terminal_id or "").strip()

        if not clean_id:
            return {"success": False, "error": "terminal_id is required."}

        with _TERMINAL_CURSOR_LOCK:
            if clean_id not in _TERMINAL_OUTPUT_CURSORS:
                return {"success": False, "error": f"Unknown terminal_id: {clean_id}."}

        stopped = ProcessCore.process_manager(
            action="stop",
            process_id=clean_id,
            grace_seconds=_TERMINATION_GRACE_SECONDS,
        )

        if not stopped.get("success"):
            return stopped

        result = self._read_terminal(clean_id)

        if not result.get("success"):
            return result

        result["status"] = "terminated" if stopped.get("status") == "stopped" else "exited"
        result["stopped_by"] = stopped.get("stopped_by")
        return result


def _wait_for_exit(terminal_id: str, wait_seconds: int) -> bool:
    deadline = time.monotonic() + wait_seconds

    while True:
        status = ProcessCore.process_manager(action="status", process_id=terminal_id)

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
