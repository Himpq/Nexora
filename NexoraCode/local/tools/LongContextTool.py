"""
NexoraCode.local.tools.LongContextTool — 长上下文回读工具

两个工具：
- local_context_read（别名 getContext）: 按 ctxId 回读被截断的长文本
- local_context_clear（别名 clear_context）: 清理长文本上下文缓存

长上下文存储核心见 local.LongContext。
"""

from __future__ import annotations

from ..LongContext import clear_context, get_context_handler
from ..Tool import LocalTool, ToolContext


class ContextReadTool(LocalTool):
    name = "local_context_read"
    aliases = ("getContext",)
    description = "获取被截断的长文本上下文内容。"
    parameters = {
        "type": "object",
        "properties": {
            "ctxId": {"type": "string", "description": "被截断时返回的上下文ID"},
            "regex": {"type": "string", "description": "要匹配的正则表达式（可选）"},
            "keyword": {"type": "string", "description": "要搜索包含的关键词（可选）"},
            "range": {"type": "string", "description": "行号范围别名（可选），格式如 '10:80'。推荐优先使用 range_start/range_end。"},
            "range_start": {"type": "integer", "description": "起始行号（可选）"},
            "range_end": {"type": "integer", "description": "结束行号（可选）"},
        },
        "required": ["ctxId"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        content = get_context_handler(
            ctxId=str(args.get("ctxId") or ""),
            regex=args.get("regex"),
            keyword=args.get("keyword"),
            range=args.get("range"),
            range_start=args.get("range_start"),
            range_end=args.get("range_end"),
        )

        if content.startswith("Context not found."):
            return {"success": False, "error": content}

        if content.startswith("Regex error"):
            return {"success": False, "error": content}

        return {
            "success": True,
            "content": content,
        }


class ContextClearTool(LocalTool):
    name = "local_context_clear"
    aliases = ("clear_context",)
    description = "清理长文本上下文缓存，建议一轮对话结束后执行。"
    parameters = {
        "type": "object",
        "properties": {},
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return {"success": True, "message": clear_context()}
