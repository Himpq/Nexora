"""
NexoraCode 本地工具定义目录。

单一事实来源：
- 工具描述/参数定义统一写在这里
- 具体实现仍保留在各模块中
"""

TOOL_CATALOG = [
    {
        "module": "shell",
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
    },

    {
        "module": "shell",
        "name": "local_shell_session",
        "handler": "handle_shell_session",
        "description": (
            "创建持久化交互式终端会话，支持连续交互、cd 保持目录、长任务、分段输出。"
            "action 取值：create | exec | status | close"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "动作：create(创建) | exec(执行命令) | status(查询状态) | close(关闭)",
                    "enum": ["create", "exec", "status", "close"]
                },
                "session_id": {"type": "string", "description": "会话ID（exec/status/close必须传）"},
                "command": {"type": "string", "description": "要执行的命令（仅exec）"},
                "cwd": {"type": "string", "description": "工作目录（仅create）"},
            },
            "required": ["action"],
        },
    },


    {
        "module": "file_ops",
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
        "module": "file_ops",
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
        "module": "file_ops",
        "name": "local_file_patch",
        "handler": "file_patch",
        "description": (
            "对用户本地计算机上的单个文件执行精确 patch（NexoraCode 本地工具）。"
            "必须且只能提供 patch 或 edits 其中一种输入：patch 使用统一 diff 格式；"
            "edits 使用结构化精确编辑，支持 replace、insert_before、insert_after、delete。"
            "所有上下文或 target 必须与文件内容完全匹配，适合代码修改。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件绝对路径"},
                "patch": {
                    "type": "string",
                    "description": "统一 diff 内容。提供 patch 时不能同时提供 edits。",
                },
                "edits": {
                    "type": "array",
                    "description": "结构化精确编辑列表。提供 edits 时不能同时提供 patch。",
                    "items": {
                        "type": "object",
                        "properties": {
                            "action": {
                                "type": "string",
                                "enum": ["replace", "insert_before", "insert_after", "delete"],
                                "description": "编辑动作",
                            },
                            "target": {"type": "string", "description": "文件中必须精确匹配的目标文本"},
                            "replacement": {"type": "string", "description": "replace 动作使用的新文本"},
                            "content": {"type": "string", "description": "insert_before/insert_after 动作插入的文本"},
                            "occurrence": {
                                "type": "integer",
                                "description": "当 target 出现多次时，指定第几处，1 表示第一处。",
                            },
                        },
                        "required": ["action", "target"],
                    },
                },
                "encoding": {"type": "string", "description": "文件编码，默认 utf-8", "default": "utf-8"},
                "expected_sha256": {
                    "type": "string",
                    "description": "可选。修改前文件内容的 SHA256，不一致时拒绝修改。",
                },
            },
            "required": ["path"],
        },
    },
    {
        "module": "file_ops",
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
    {
        "module": "image_search",
        "name": "image_search",
        "handler": "image_search",
        "description": (
            "在用户本地计算机上搜索图片并返回结构化图片结果。"
            "source 可选 bing_crawlee、bing、commons；bing_crawlee 使用 Python Crawlee + Playwright，"
            "bing 使用直接 Playwright，commons 使用 Wikimedia Commons API。"
            "返回结果会包含 markdown_prompt，模型可直接用其中的描述和图片链接按 Markdown 展示图片。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "图片搜索关键词"},
                "source": {
                    "type": "string",
                    "enum": ["bing_crawlee", "bing", "commons"],
                    "default": "bing_crawlee",
                    "description": "图片搜索来源。不会在失败时自动切换来源。",
                },
                "limit": {"type": "integer", "description": "最多返回图片数量，范围 1-50，默认 10", "default": 10},
                "proxy": {"type": "string", "description": "可选代理，例如 http://127.0.0.1:15555"},
                "headless": {"type": "boolean", "description": "Bing 浏览器搜索是否使用无界面模式，默认 true", "default": True},
                "channel": {"type": "string", "description": "Chromium 通道，默认 msedge", "default": "msedge"},
                "user_data_dir": {"type": "string", "description": "可选浏览器持久化用户目录"},
                "timeout": {"type": "integer", "description": "超时秒数，默认 45", "default": 45},
                "scrolls": {"type": "integer", "description": "Bing 搜索滚动加载次数，默认 4", "default": 4},
            },
            "required": ["query"],
        },
    },
    {
        "module": "renderer",
        "name": "browser_page_open",
        "handler": "web_render",
        "description": "用本地真实浏览器打开并渲染网页。interactive 模式会创建或导航驻留页面，并返回稳定 page_id 与当前视窗交互节点；后续所有 browser_page_* 页面操作都必须传这个 page_id。",
        "parameters": {
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
        },
    },
    {
        "module": "renderer",
        "name": "browser_page_read",
        "handler": "handle_web_get_content",
        "description": "读取指定驻留页面当前真实内容。用户手动操作页面后，用这个工具传入同一个 page_id 重新获取页面正文和当前 DOM 节点。",
        "parameters": {
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
        },
    },
    {
        "module": "renderer",
        "name": "browser_page_click",
        "handler": "handle_web_click",
        "description": "在指定驻留页面中点击网页元素。必须传 browser_page_open 返回的 page_id 和当前快照里的 node_id。",
        "parameters": {
            "type": "object",
            "properties": {
                "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
                "node_id": {"type": "integer", "description": "要点击的元素的 data-nexora-id"},
            },
            "required": ["page_id", "node_id"],
        },
    },
    {
        "module": "renderer",
        "name": "browser_page_input",
        "handler": "handle_web_input",
        "description": "在指定驻留页面中向 input/textarea 等元素写入文本。适合登录、搜索、表单填写。必须传 page_id，并优先使用页面快照返回的 selector。",
        "parameters": {
            "type": "object",
            "properties": {
                "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
                "selector": {"type": "string", "description": "目标 input/textarea/select/contenteditable 的 CSS 定位器"},
                "text": {"type": "string", "description": "要注入的文本内容"},
                "submit": {"type": "boolean", "description": "是否在输入后尝试提交回车/表单提交", "default": False},
            },
            "required": ["page_id", "selector", "text"],
        },
    },
    {
        "module": "renderer",
        "name": "browser_page_eval",
        "handler": "handle_web_exec_js",
        "description": "在指定驻留页面的真实网页 DOM 中执行 JS。网页交互时用它读取状态、筛选元素、触发站内脚本；必须传 page_id。",
        "parameters": {
            "type": "object",
            "properties": {
                "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
                "code": {"type": "string", "description": "要注入执行的 JavaScript 代码内容。内部需要包含 return 或者直接进行 DOM 操作。"},
            },
            "required": ["page_id", "code"],
        },
    },
    {
        "module": "renderer",
        "name": "browser_page_scroll",
        "handler": "handle_web_scroll",
        "description": "在指定驻留页面中滚动页面。仅在必须暴露新内容、触发懒加载或翻到目标区域时使用；必须传 page_id。",
        "parameters": {
            "type": "object",
            "properties": {
                "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
                "direction": {"type": "string", "enum": ["down", "up", "bottom", "top"], "description": "滚动方向"},
            },
            "required": ["page_id", "direction"],
        },
    },
    {
        "module": "renderer",
        "name": "browser_page_list",
        "handler": "handle_web_list_pages",
        "description": "列出当前 NexoraCode 驻留网页页面及其 page_id，用于确认后续 browser_page_* 操作的目标页面。",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "module": "renderer",
        "name": "browser_page_close",
        "handler": "handle_web_close_page",
        "description": "关闭指定 page_id 的驻留网页页面。",
        "parameters": {
            "type": "object",
            "properties": {
                "page_id": {"type": "integer", "description": "browser_page_open(interactive) 返回的页面 ID"},
            },
            "required": ["page_id"],
        },
    },
    {
        "module": "long_context",
        "name": "local_context_read",
        "handler": "get_context_handler",
        "description": "获取被截断的长文本上下文内容。",
        "parameters": {
            "type": "object",
            "properties": {
                "ctxId": {"type": "string", "description": "被截断时返回的上下文ID"},
                "regex": {"type": "string", "description": "要匹配的正则表达式（可选）"},
                "keyword": {"type": "string", "description": "要搜索包含的关键词（可选）"},
                "range_start": {"type": "integer", "description": "起始行号（可选）"},
                "range_end": {"type": "integer", "description": "结束行号（可选）"},
            },
            "required": ["ctxId"],
        },
    },
    {
        "module": "long_context",
        "name": "local_context_clear",
        "handler": "clear_context",
        "description": "清理长文本上下文缓存，建议一轮对话结束后执行。",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
]


TOOL_NAME_ALIASES = {
    "local_web_render": "browser_page_open",
    "local_web_get_content": "browser_page_read",
    "local_web_click": "browser_page_click",
    "local_web_input": "browser_page_input",
    "local_web_exec_js": "browser_page_eval",
    "local_web_scroll": "browser_page_scroll",
    "local_web_list_pages": "browser_page_list",
    "local_web_close_page": "browser_page_close",
    "getContext": "local_context_read",
    "clear_context": "local_context_clear",
}


def get_tool_modules():
    modules = []
    seen = set()
    for item in TOOL_CATALOG:
        mod = str(item.get("module", "") or "").strip()
        if not mod or mod in seen:
            continue
        seen.add(mod)
        modules.append(mod)
    return modules
