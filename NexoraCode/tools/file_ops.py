"""
工具：文件操作（读取、写入、列目录）
安全策略：只允许操作 config 中 allowed_dirs 内的路径
"""

import os
from pathlib import Path
from core.config import config

TOOL_MANIFEST = [
    {
        "name": "local_file_read",
        "handler": "file_read",
        "description": "读取用户本地计算机上指定文件的内容（NexoraCode 本地工具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件绝对路径"},
                "encoding": {"type": "string", "default": "utf-8"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "local_file_write",
        "handler": "file_write",
        "description": "将内容写入用户本地计算机上的指定文件，会覆盖原有内容（NexoraCode 本地工具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件绝对路径"},
                "content": {"type": "string", "description": "写入内容"},
                "encoding": {"type": "string", "default": "utf-8"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "local_file_list",
        "handler": "file_list",
        "description": "列出用户本地计算机指定目录下的文件和子目录（NexoraCode 本地工具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "目录绝对路径"},
            },
            "required": ["path"],
        },
    },
]


def _check_allowed(target: Path) -> bool:
    allowed_dirs: list = config.get("allowed_dirs", [])
    if not allowed_dirs:
        # 未配置白名单：拒绝，提示用户在设置中添加
        return False
    resolved = target.resolve()
    for d in allowed_dirs:
        if str(resolved).startswith(str(Path(d).resolve())):
            return True
    return False


def file_read(path: str, encoding: str = "utf-8") -> dict:
    p = Path(path)
    if not _check_allowed(p):
        return {"error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}
    if not p.exists():
        return {"error": f"File not found: {path}"}
    if not p.is_file():
        return {"error": f"Not a file: {path}"}
    try:
        content = p.read_text(encoding=encoding)
        return {"content": content, "size": p.stat().st_size}
    except Exception as e:
        return {"error": str(e)}


def file_write(path: str, content: str, encoding: str = "utf-8") -> dict:
    p = Path(path)
    if not _check_allowed(p):
        return {"error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding=encoding)
        return {"success": True, "bytes_written": len(content.encode(encoding))}
    except Exception as e:
        return {"error": str(e)}


def file_list(path: str) -> dict:
    p = Path(path)
    if not _check_allowed(p):
        return {"error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}
    if not p.is_dir():
        return {"error": f"Not a directory: {path}"}
    try:
        entries = []
        for item in sorted(p.iterdir()):
            entries.append({
                "name": item.name,
                "type": "dir" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else None,
            })
        return {"entries": entries, "count": len(entries)}
    except Exception as e:
        return {"error": str(e)}
