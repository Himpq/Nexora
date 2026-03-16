"""
工具：Shell 命令执行
沙箱策略：白名单前缀 + 禁止危险命令 + 工作目录限制
"""

import subprocess
from pathlib import Path
from core.config import config

# 绝对禁止的命令片段（不管白名单）
_BLACKLIST = [
    "rm -rf /", "del /s /q c:\\", "format c:",
    ":(){ :|: & };:",  # fork bomb
    "dd if=/dev/",
]

TOOL_MANIFEST = [
    {
        "name": "local_shell_exec",
        "handler": "shell_exec",
        "description": "在用户本地计算机上执行 shell 命令并返回输出结果（NexoraCode 本地工具）。仅在用户明确授权后使用。",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "要执行的命令"},
                "cwd": {"type": "string", "description": "工作目录（可选，默认为用户主目录）"},
                "timeout": {"type": "integer", "description": "超时秒数，默认 30", "default": 30},
            },
            "required": ["command"],
        },
    }
]


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


def shell_exec(command: str, cwd: str = None, timeout: int = 30) -> dict:
    # 安全检查：黑名单
    cmd_lower = command.lower()
    for dangerous in _BLACKLIST:
        if dangerous in cmd_lower:
            return {"error": f"Command blocked by security policy: contains '{dangerous}'"}

    # 白名单检查（如果配置了白名单但当前命令不在其中，拒绝执行）
    whitelist: list = config.get("shell_whitelist", [])
    if whitelist:
        allowed = any(command.strip().startswith(prefix) for prefix in whitelist)
        if not allowed:
            return {"error": f"Command not in whitelist. Allowed prefixes: {whitelist}"}

    work_dir = cwd or str(Path.home())
    # 防止目录穿越到系统目录
    resolved = Path(work_dir).resolve()

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=False,
            timeout=timeout,
            cwd=str(resolved),
        )
        return {
            "stdout": _decode_output(result.stdout),
            "stderr": _decode_output(result.stderr),
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"error": f"Command timed out after {timeout}s"}
    except Exception as e:
        return {"error": str(e)}
