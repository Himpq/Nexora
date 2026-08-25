"""
NexoraCode.local.tools.ShellTool — 一次性短命令执行工具

local_shell_exec：执行能在 timeout 内完成的一次性短命令。
- 沙箱策略：黑名单硬拦截 + 白名单前缀 + 工作目录限制
- Python 命令自动注入 -u 关闭缓冲，避免管道模式输出丢失
- Windows 下 python -c 多行脚本自动改写为临时文件执行

长任务必须使用 local_terminal，本工具不用于服务器 / 监听类任务。
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path

from core.config import config
from ..Tool import LocalTool, ToolContext


_BLACKLIST = (
    "rm -rf /",
    "del /s /q c:\\",
    "format c:",
    ":(){ :|: & };:",
    "dd if=/dev/",
)


class ShellExecTool(LocalTool):
    name = "local_shell_exec"
    description = (
        "执行能在指定 timeout 内完成的一次性短命令，并分别返回 stdout、stderr 和退出码。"
        "不要用于服务器、监听器、开发服务或其他持续运行任务；这些任务必须使用 local_terminal。"
        "仅在用户明确授权后使用。"
        "注意：Python 命令会自动注入 -u 参数以关闭缓冲，确保输出不被丢失。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "要执行的命令"},
            "cwd": {"type": "string", "description": "工作目录（可选，默认为用户主目录）"},
            "timeout": {"type": "integer", "description": "超时秒数，默认 30", "default": 30},
        },
        "required": ["command"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        command = str(args.get("command") or "").strip()

        if not command:
            return {"success": False, "error": "command is required."}

        cmd_lower = command.lower()

        for marker in _BLACKLIST:
            if marker in cmd_lower:
                return {"success": False, "error": f"Command blocked by security policy: contains '{marker}'"}

        whitelist: list = config.get("shell_whitelist", [])

        if whitelist:
            allowed = any(command.startswith(prefix) for prefix in whitelist)

            if not allowed:
                return {"success": False, "error": f"Command not in whitelist. Allowed prefixes: {whitelist}"}

        work_dir = str(args.get("cwd") or "").strip() or str(Path.home())
        resolved = Path(work_dir).resolve()

        try:
            timeout = int(args.get("timeout") or 30)
        except (TypeError, ValueError):
            timeout = 30

        patched_command = _patch_python_unbuffered(command)
        patched_command = _fix_python_inline_script(patched_command)

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"

        try:
            result = subprocess.run(
                patched_command,
                shell=True,
                capture_output=True,
                text=False,
                timeout=timeout,
                cwd=str(resolved),
                env=env,
            )

            stdout = _decode_output(result.stdout)
            stderr = _decode_output(result.stderr)

            ret: dict = {
                "success": True,
                "stdout": stdout,
                "stderr": stderr,
                "returncode": result.returncode,
            }

            if not stdout.strip() and stderr.strip():
                ret["_hint"] = "stdout is empty but stderr has content — check stderr for errors or warnings."

            return ret
        except subprocess.TimeoutExpired:
            return {"success": False, "error": f"Command timed out after {timeout}s"}
        except Exception as e:
            return {"success": False, "error": str(e)}


def _decode_output(raw: bytes) -> str:
    if raw is None:
        return ""

    if isinstance(raw, str):
        return raw

    for enc in ("utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(enc)
        except Exception:
            continue

    return raw.decode("utf-8", errors="replace")


def _patch_python_unbuffered(command: str) -> str:
    """对行首的 python / python3 / py 自动注入 -u，强制关闭 stdout/stderr 缓冲。"""

    return re.sub(
        r'^(python3?|py)(\s)',
        r'\1 -u\2',
        command.strip(),
        count=1,
    )


def _fix_python_inline_script(command: str) -> str:
    """修复 python -c 多行脚本在 Windows 下的解析问题，改用临时文件执行。"""

    cmd_stripped = command.strip()
    match = re.match(
        r'^(python3?|py)\s+(-u\s+)?-c\s+(.+)$',
        cmd_stripped,
        re.DOTALL | re.IGNORECASE,
    )

    if not match:
        return command

    python_exe = match.group(1)
    script_part = match.group(3)

    if (script_part.startswith('"') and script_part.endswith('"')) or (
        script_part.startswith("'") and script_part.endswith("'")
    ):
        script_content = script_part[1:-1]
    else:
        script_content = script_part

    has_real_newline = "\n" in script_content
    has_literal_newline = "\\n" in script_content

    if not (has_real_newline or has_literal_newline):
        return command

    if has_literal_newline:
        script_content = script_content.replace("\\n", "\n")

    script_content = _fix_windows_paths(script_content)
    temp_file = os.path.join(tempfile.gettempdir(), f"_nexora_shell_{os.getpid()}.py")

    try:
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(script_content)
    except Exception:
        return command

    return f'{python_exe} -u "{temp_file}"'


def _fix_windows_paths(script: str) -> str:
    """修复脚本中形如 'C:\\PKData\\x.txt' 的单反斜杠，避免 Python 3.12+ 警告。"""

    valid_escapes = {"n", "t", "r", '"', "'", "\\", "0", "x", "u", "U"}

    def fix_path_in_string(match):
        quote = match.group(1)
        content = match.group(2)

        if "\\\\" in content:
            return match.group(0)

        result = []
        i = 0

        while i < len(content):
            if content[i] == "\\" and i + 1 < len(content):
                next_char = content[i + 1]

                if next_char in valid_escapes:
                    result.append(content[i:i + 2])
                else:
                    result.append("\\\\")
                    result.append(next_char)

                i += 2
            else:
                result.append(content[i])
                i += 1

        return quote + "".join(result) + quote

    return re.sub(
        r"(['\"])([A-Za-z]:\\[^'\"]*)\1",
        fix_path_in_string,
        script,
    )
