import os
import uuid
import re
from pathlib import Path
from core.config import config, get_app_root

TOOL_MANIFEST = [
    {
        "name": "getContext",
        "handler": "get_context_handler",
        "description": "获取被截断的长文本上下文内容。",
        "parameters": {
            "type": "object",
            "properties": {
                "ctxId": {"type": "string", "description": "被截断时返回的上下文ID"},
                "regex": {"type": "string", "description": "要匹配的正则表达式（可选）"},
                "keyword": {"type": "string", "description": "要搜索包含的关键词（可选）"},
                "range_start": {"type": "integer", "description": "起始行号（可选）"},
                "range_end": {"type": "integer", "description": "结束行号（可选）"}
            },
            "required": ["ctxId"]
        }
    },
    {
        "name": "clear_context",
        "handler": "clear_context",
        "description": "清理长文本上下文缓存，建议一轮对话结束后执行。",
        "parameters": {
            "type": "object",
            "properties": {}
        }
    }
]

_mem_cache = {}

def get_cache_dir():
    d = get_app_root() / "temp" / "longcontent"
    d.mkdir(parents=True, exist_ok=True)
    return d

def store_context(content: str) -> str:
    cache_type = config.get("long_content_cache_type", "file")
    max_bytes = config.get("long_content_max_bytes", 1048576)
    
    encoded = content.encode("utf-8")
    if len(encoded) > max_bytes:
        encoded = encoded[:max_bytes]
    content = encoded.decode("utf-8", errors="ignore")
    
    ctx_id = f"ctx_{uuid.uuid4().hex[:8]}"
    if cache_type == "memory":
        _mem_cache[ctx_id] = content
    else:
        file_path = get_cache_dir() / f"{ctx_id}.txt"
        file_path.write_text(content, encoding="utf-8")
    return ctx_id

def clear_context(**kwargs):
    _mem_cache.clear()
    d = get_app_root() / "temp" / "longcontent"
    if d.exists():
        for file in d.glob("*.txt"):
            try: file.unlink()
            except: pass
    return "长文本上下文缓存已清理。"

def process_large_output(content: str) -> str:
    if len(content) > 10000:
        ctx_id = store_context(content)
        return f"[Content truncated due to length. Full content saved with Context ID: {ctx_id}. Use tool getContext(ctxId='{ctx_id}', regex=..., range_start=..., range_end=..., keyword=...) to read it.]\n" + content[:6000]
    return content

def get_context_handler(ctxId: str, regex: str = None, range_start: int = None, range_end: int = None, keyword: str = None):
    cache_type = config.get("long_content_cache_type", "file")
    text = ""
    if cache_type == "memory":
        if ctxId not in _mem_cache: return "Context not found."
        text = _mem_cache[ctxId]
    else:
        file_path = get_cache_dir() / f"{ctxId}.txt"
        if not file_path.exists(): return "Context not found."
        text = file_path.read_text(encoding="utf-8")
        
    lines = text.splitlines()
    res = []
    if range_start is not None and range_end is not None:
        res = lines[max(0, range_start):min(len(lines), range_end)]
    elif regex:
        try:
            r = re.compile(regex)
            res = [l for l in lines if r.search(l)]
        except Exception as e: return f"Regex error: {e}"
    elif keyword:
        res = [l for l in lines if keyword.lower() in l.lower()]
    else:
        res = lines[:100]
        res.append('... (Specify regex, keyword, or range_start/range_end to see more)')
        
    return "\n".join(res)
