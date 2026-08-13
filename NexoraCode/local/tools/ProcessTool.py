"""
NexoraCode.local.tools.ProcessTool — 通用本地进程管理工具

local_process_manager：启动并管理由本工具创建的本地进程。
- 支持 start / list / status / read / stop 五个动作
- 与 local_terminal 共享同一份进程状态表
"""

from __future__ import annotations

from ..Tool import LocalTool, ToolContext
from . import ProcessCore


class ProcessManagerTool(LocalTool):
    name = "local_process_manager"
    description = (
        "Start and manage generic local processes created by this tool only. It does not discover projects, "
        "does not run project scripts by convention, and cannot manage unrelated system processes."
    )
    parameters = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["start", "list", "status", "read", "stop"],
                "description": "Process action.",
            },
            "process_id": {"type": "string", "description": "Required for status, read, and stop."},
            "command": {"type": "string", "description": "Command to start."},
            "cwd": {"type": "string", "description": "Working directory for start."},
            "timeout": {"type": "integer", "default": 0, "description": "Optional auto-stop timeout in seconds."},
            "encoding": {"type": "string", "default": "utf-8", "description": "Output decoding encoding."},
            "max_output_chars": {"type": "integer", "default": 20000},
            "grace_seconds": {"type": "integer", "default": 5},
        },
        "required": ["action"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return ProcessCore.process_manager(
            action=str(args.get("action") or ""),
            process_id=str(args.get("process_id") or ""),
            command=str(args.get("command") or ""),
            cwd=str(args.get("cwd") or ""),
            timeout=args.get("timeout", 0),
            encoding=str(args.get("encoding") or "utf-8"),
            max_output_chars=args.get("max_output_chars"),
            grace_seconds=args.get("grace_seconds", 5),
            output_from_byte=args.get("output_from_byte"),
        )
