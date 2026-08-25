"""
NexoraCode.local.tools.BrowserTool — 本地真实浏览器工具

browser_page_* 系列 8 个工具，操作驻留真实浏览器页面：
- browser_page_open: 打开 / 导航页面（interactive 模式返回 page_id 与交互节点）
- browser_page_read / click / input / eval / scroll / list / close

实现见 BrowserCore，本模块只定义工具类与参数 schema。
"""

from __future__ import annotations

from ..Tool import LocalTool, ToolContext
from . import BrowserCore


class BrowserOpenTool(LocalTool):
    name = "browser_page_open"
    aliases = ("local_web_render",)
    description = "用本地真实浏览器打开并渲染网页。interactive 模式会创建或导航驻留页面，并返回稳定 page_id 与当前视窗交互节点；后续所有 browser_page_* 页面操作都必须传这个 page_id。"
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "目标页面 URL"},
            "wait_for": {
                "type": "string",
                "enum": ["load", "networkidle", "domcontentloaded"],
                "default": "networkidle",
                "description": "等待策略",
            },
            "extract_mode": {
                "type": "string",
                "enum": ["readability", "full_text", "html", "interactive"],
                "default": "readability",
                "description": "提取模式：readability(正文), full_text(全文), html(源码), interactive(驻留交互模式；返回 page_id)",
            },
            "page_id": {
                "type": "integer",
                "description": "可选。传入已有 page_id 时在该驻留页面导航到新 URL；不传则新建页面并分配 0、1、2 递增 ID。",
            },
        },
        "required": ["url"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return BrowserCore.web_render(
            url=str(args.get("url") or ""),
            wait_for=str(args.get("wait_for") or "networkidle"),
            extract_mode=str(args.get("extract_mode") or "readability"),
            page_id=args.get("page_id"),
        )


class BrowserReadTool(LocalTool):
    name = "browser_page_read"
    aliases = ("local_web_get_content",)
    description = "读取指定驻留页面当前真实内容。用户手动操作页面后，用这个工具传入同一个 page_id 重新获取页面正文和当前 DOM 节点。"
    parameters = {
        "type": "object",
        "properties": {
            "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
            "extract_mode": {
                "type": "string",
                "enum": ["readability", "full_text", "html"],
                "default": "readability",
                "description": "读取模式：readability(正文), full_text(页面可见全文), html(当前 DOM 源码)",
            },
        },
        "required": ["page_id"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return BrowserCore.handle_web_get_content(
            page_id=args.get("page_id"),
            extract_mode=str(args.get("extract_mode") or "readability"),
        )


class BrowserClickTool(LocalTool):
    name = "browser_page_click"
    aliases = ("local_web_click",)
    description = "在指定驻留页面中点击网页元素。必须传 browser_page_open 返回的 page_id 和当前快照里的 node_id。"
    parameters = {
        "type": "object",
        "properties": {
            "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
            "node_id": {"type": "integer", "description": "要点击的元素的 data-nexora-id"},
        },
        "required": ["page_id", "node_id"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return BrowserCore.handle_web_click(
            page_id=args.get("page_id"),
            node_id=args.get("node_id"),
        )


class BrowserInputTool(LocalTool):
    name = "browser_page_input"
    aliases = ("local_web_input",)
    description = "在指定驻留页面中向 input/textarea 等元素写入文本。适合登录、搜索、表单填写。必须传 page_id，并优先使用页面快照返回的 selector。"
    parameters = {
        "type": "object",
        "properties": {
            "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
            "selector": {"type": "string", "description": "目标 input/textarea/select/contenteditable 的 CSS 定位器"},
            "text": {"type": "string", "description": "要注入的文本内容"},
            "submit": {"type": "boolean", "description": "是否在输入后尝试提交回车/表单提交", "default": False},
        },
        "required": ["page_id", "selector", "text"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return BrowserCore.handle_web_input(
            page_id=args.get("page_id"),
            selector=str(args.get("selector") or ""),
            text=str(args.get("text") or ""),
            submit=bool(args.get("submit", False)),
        )


class BrowserEvalTool(LocalTool):
    name = "browser_page_eval"
    aliases = ("local_web_exec_js",)
    description = "在指定驻留页面的真实网页 DOM 中执行 JS。网页交互时用它读取状态、筛选元素、触发站内脚本；必须传 page_id。"
    parameters = {
        "type": "object",
        "properties": {
            "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
            "code": {"type": "string", "description": "要注入执行的 JavaScript 代码内容。内部需要包含 return 或者直接进行 DOM 操作。"},
        },
        "required": ["page_id", "code"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return BrowserCore.handle_web_exec_js(
            page_id=args.get("page_id"),
            code=str(args.get("code") or ""),
        )


class BrowserScrollTool(LocalTool):
    name = "browser_page_scroll"
    aliases = ("local_web_scroll",)
    description = "在指定驻留页面中滚动页面。仅在必须暴露新内容、触发懒加载或翻到目标区域时使用；必须传 page_id。"
    parameters = {
        "type": "object",
        "properties": {
            "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
            "direction": {"type": "string", "enum": ["down", "up", "bottom", "top"], "description": "滚动方向"},
        },
        "required": ["page_id", "direction"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return BrowserCore.handle_web_scroll(
            page_id=args.get("page_id"),
            direction=str(args.get("direction") or ""),
        )


class BrowserListTool(LocalTool):
    name = "browser_page_list"
    aliases = ("local_web_list_pages",)
    description = "列出当前 NexoraCode 驻留网页页面及其 page_id，用于确认后续 browser_page_* 操作的目标页面。"
    parameters = {
        "type": "object",
        "properties": {},
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return BrowserCore.handle_web_list_pages()


class BrowserCloseTool(LocalTool):
    name = "browser_page_close"
    aliases = ("local_web_close_page",)
    description = "关闭指定 page_id 的驻留网页页面。"
    parameters = {
        "type": "object",
        "properties": {
            "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
        },
        "required": ["page_id"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        return BrowserCore.handle_web_close_page(page_id=args.get("page_id"))
