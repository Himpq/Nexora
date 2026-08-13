"""
NexoraCode.local.LongContext — 长文本上下文存储

大输出截断后的全文保存与按需回读：
- 截断工具结果时生成 ctxId，全文写入内存或文件缓存
- 模型用 local_context_read（getContext）按 regex / 行范围 / 关键词回读
- local_context_clear 清理缓存，建议一轮对话结束后执行

对外提供：
- process_large_output: 超长文本截断并返回 ctxId 提示
- get_context_handler: 按 ctxId 回读截断内容
- clear_context: 清理全部缓存
"""

from __future__ import annotations

import re
import uuid

from core.config import config, get_app_root


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
    d = get_cache_dir()

    if d.exists():
        for file in d.glob("*.txt"):
            try:
                file.unlink()
            except Exception:
                pass

    return "长文本上下文缓存已清理。"


def process_large_output(content: str) -> str:
    if len(content) > 10000:
        ctx_id = store_context(content)
        return (
            "[Content truncated due to length. Full content saved with Context ID: "
            f"{ctx_id}. Use tool getContext(ctxId='{ctx_id}', regex=..., range_start=..., "
            "range_end=..., keyword=...) to read it.]\n"
        ) + content[:6000]

    return content


def _coerce_int(value, default=None):
    try:
        if value is None or value == "":
            return default

        return int(value)
    except Exception:
        return default


def _parse_range_arg(value):
    if value is None or value == "":
        return None, None

    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return _coerce_int(value[0]), _coerce_int(value[1])

    if isinstance(value, dict):
        start = value.get("start", value.get("from", value.get("range_start")))
        end = value.get("end", value.get("to", value.get("range_end")))
        return _coerce_int(start), _coerce_int(end)

    text = str(value or "").strip()
    match = re.match(r"^\s*(\d+)\s*[:,-]\s*(\d+)\s*$", text)

    if match:
        return _coerce_int(match.group(1)), _coerce_int(match.group(2))

    return None, None


def get_context_handler(ctxId: str = "", regex: str = None, range_start: int = None, range_end: int = None, keyword: str = None, range=None, ctx_id: str = "", **kwargs):
    if not ctxId:
        ctxId = ctx_id or str(kwargs.get("context_id") or "").strip()

    if (range_start is None or range_end is None) and range is not None:
        parsed_start, parsed_end = _parse_range_arg(range)

        if range_start is None:
            range_start = parsed_start

        if range_end is None:
            range_end = parsed_end

    cache_type = config.get("long_content_cache_type", "file")
    text = ""

    if cache_type == "memory":
        if ctxId not in _mem_cache:
            return "Context not found."

        text = _mem_cache[ctxId]
    else:
        file_path = get_cache_dir() / f"{ctxId}.txt"

        if not file_path.exists():
            return "Context not found."

        text = file_path.read_text(encoding="utf-8")

    lines = text.splitlines()
    res = []

    if range_start is not None and range_end is not None:
        start = max(0, _coerce_int(range_start, 0))
        end = min(len(lines), max(start, _coerce_int(range_end, start)))
        res = lines[start:end]
    elif regex:
        try:
            r = re.compile(regex)
            res = [line for line in lines if r.search(line)]
        except Exception as e:
            return f"Regex error: {e}"
    elif keyword:
        res = [line for line in lines if keyword.lower() in line.lower()]
    else:
        res = lines[:100]
        res.append("... (Specify regex, keyword, or range_start/range_end to see more)")

    return "\n".join(res)


_mem_cache = {}
