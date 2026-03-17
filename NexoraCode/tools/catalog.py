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
        "module": "renderer",
        "name": "local_web_render",
        "handler": "web_render",
        "description": "使用用户本地浏览器渲染指定 URL，提取正文文本内容，支持 JS 渲染的动态页面（NexoraCode 本地工具）。可以进行搜索、爬取网页等操作。",
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
                    "description": "提取模式：readability(正文), full_text(全文), html(源码), interactive(驻留交互模式)",
                },
            },
            "required": ["url"],
        },
    },
    {
        "module": "renderer",
        "name": "web_click",
        "handler": "handle_web_click",
        "description": "在 interactive 模式下点击目标网页上的元素节点。",
        "parameters": {
            "type": "object",
            "properties": {
                "node_id": {"type": "integer", "description": "要点击的元素的 data-nexora-id"},
            },
            "required": ["node_id"],
        },
    },
    {
        "module": "renderer",
        "name": "web_input",
        "handler": "handle_web_input",
        "description": "在 interactive 模式下向目标输入框注入文本。优先使用 local_web_render(interactive) 返回的 selector 信息来定位元素。",
        "parameters": {
            "type": "object",
            "properties": {
                "selector": {"type": "string", "description": "目标 input/textarea/select/contenteditable 的 CSS 定位器"},
                "text": {"type": "string", "description": "要注入的文本内容"},
                "submit": {"type": "boolean", "description": "是否在输入后尝试提交回车/表单提交", "default": False},
            },
            "required": ["selector", "text"],
        },
    },
    {
        "module": "renderer",
        "name": "web_exec_js",
        "handler": "handle_web_exec_js",
        "description": "在 interactive 模式下向目标被代理网页注入、执行自定义纯 JS 代码。执行完毕会返回最新的交互 DOM。",
        "parameters": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "要注入执行的 JavaScript 代码内容。内部需要包含 return 或者直接进行 DOM 操作。"},
            },
            "required": ["code"],
        },
    },
    {
        "module": "renderer",
        "name": "web_scroll",
        "handler": "handle_web_scroll",
        "description": "在 interactive 模式下向下或向上滚动页面。",
        "parameters": {
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["down", "up", "bottom", "top"], "description": "滚动方向"},
            },
            "required": ["direction"],
        },
    },
    {
        "module": "long_context",
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
                "range_end": {"type": "integer", "description": "结束行号（可选）"},
            },
            "required": ["ctxId"],
        },
    },
    {
        "module": "long_context",
        "name": "clear_context",
        "handler": "clear_context",
        "description": "清理长文本上下文缓存，建议一轮对话结束后执行。",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
]


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
