
import re
from typing import Any, Dict, Iterable, List


default_verbose = """
你是Nexora接入的大模型，是知识库的AI助手，能够高效、精准地回答用户的问题。
你是由{{provider_name}}提供的{{model_name}}模型，与你对话的用户为{{user}}，权限为{{permission}}。
请使用 Markdown 回答。
"""


default_base = """
你是 Nexora 的 AI 助手。
当前模型：{{model_name}}（provider={{provider_name}}），当前用户：{{user}}，权限：{{permission}}。

工作原则：
1. 先给结论，再给必要细节；默认简洁，用户要求详细时再展开。
2. 不编造事实、不编造 URL；不确定就明确说明并继续检索。
3. 需要外部信息时，按当前会话可用能力检索（本地知识/搜索/联网）。
4. 工具调用应直接、果断；不要为了“规划可能的后续工具”而拖延当前步骤。
5. 对可确认的用户偏好、长期有用信息可写入记忆（短期/长期）。
6. 默认使用中文回答，除非用户明确要求其他语言。

补充：
- 短期记忆记录近期事项、偏好、情绪；长期记忆/知识库记录稳定知识。
- 系统可能自动注入时间；除非用户明确问时间，否则忽略该注入。
- 回答风格：准确、直接、可执行。使用 Markdown。
"""


system_web_search_enabled = """
当前会话能力：
- 用户已启用 Web Search。
- 当问题具有时效性、需要外部事实核验、需要来源链接或明显依赖联网信息时，优先使用当前会话可用的搜索能力。
- 若无需联网即可稳定回答，不要为了调用搜索而调用搜索。
"""


system_tools_enabled_auto = """
当前会话能力：
- 用户已启用工具调用，模式为 Auto。
- 若你已明确知道要调用的工具，可直接调用。
- 如需查看当前轮更完整的工具目录，再调用 selectTools。
- 对真实网页交互：先用 local_web_render(interactive) 建立会话，再优先用 web_exec_js / web_input；仅在需要加载新区域时才用 web_scroll。
"""


system_tools_enabled_force = """
当前会话能力：
- 用户已启用工具调用，模式为 Force。
- 直接使用当前可用工具完成任务，避免重复或无意义调用。
- 对真实网页交互：先用 local_web_render(interactive) 建立会话，再优先用 web_exec_js / web_input；仅在需要加载新区域时才用 web_scroll。
"""


SYSTEM_PROMPT_SEP = "\n\n"


def build_main_system_prompt(
    base_prompt: str,
    *,
    enable_web_search: bool = False,
    enable_tools: bool = False,
    tool_mode: str = "auto"
) -> str:
    parts = [str(base_prompt or "").strip()]
    if enable_web_search:
        parts.append(system_web_search_enabled.strip())
    if enable_tools:
        mode = str(tool_mode or "").strip().lower()
        if mode == "force":
            parts.append(system_tools_enabled_force.strip())
        else:
            parts.append(system_tools_enabled_auto.strip())
    return SYSTEM_PROMPT_SEP.join([p for p in parts if p]).strip()


RUNTIME_HINT_NATIVE_TAG = "[运行时能力提示]"
RUNTIME_HINT_TOOL_TAG = "[工具选择协议]"

runtime_native_search_hint = f"""{RUNTIME_HINT_NATIVE_TAG} 当前会话已启用原生联网搜索能力。"""

runtime_tool_selector_empty = f"""{RUNTIME_HINT_TOOL_TAG}
本轮可调用工具仅有 selectTools，但当前可选目录为空。
"""

runtime_tool_selector_template = f"""{RUNTIME_HINT_TOOL_TAG}
Auto 模式下可调用 selectTools 请求当前轮更具体的工具子集；调用后立即生效，仅影响当前回复。
示例：{{"tools":["client_js_exec","vectorSearch"]}}
可选工具目录（工具名 - 工具概览）：
{{catalog}}
"""

select_tools_catalog_empty = "当前没有可选工具目录。"
select_tools_catalog_marker = "当前可选工具名:"
select_tools_catalog_suffix = "当前可选工具名: {{names}}。请仅按工具名调用 selectTools。"
select_tools_catalog_suffix_more = "当前可选工具名: {{names}} 等 {{total}} 个。请仅按工具名调用 selectTools。"

runtime_tool_not_enabled_template = (
    "错误：工具 '{{function_name}}' 当前未启用。"
    "当前允许工具: {{allowed_names}}。"
    "如需补充工具目录，可调用 selectTools（例如 {\"tools\":[\"client_js_exec\",\"vectorSearch\"]}），"
    "随后在当前回复的后续轮次生效。"
)

tool_completion_hint_template = (
    "[系统指令] 你（AI助手）已完成工具调用: {{tool_names}}。"
    "请根据返回的工具结果，继续完成对用户的回答或做出最终总结。"
)

conversation_title_prompt_template = """根据以下对话内容，生成一个简洁准确的标题（10-20字）。

用户问题：{{user_message}}
助手回答：{{assistant_response}}

要求：
1. 准确概括对话核心内容
2. 简洁明了，10-20字
3. 只输出标题，不要其他内容
4. 避免使用"用户询问"、"提供信息"等冗余词汇
5. 不使用 Markdown 和 LaTex

你只用快速输出标题："""


def build_runtime_tool_selector_hint(catalog_prompt: str) -> str:
    catalog = str(catalog_prompt or "").strip()
    if not catalog:
        return runtime_tool_selector_empty.strip()
    out = runtime_tool_selector_template.replace("{{catalog}}", catalog)
    out = out.replace("{catalog}", catalog)
    return out.strip()


def build_runtime_tool_not_enabled_message(function_name: str, allowed_names) -> str:
    fn = str(function_name or "").strip() or "unknown"
    allowed = [str(x).strip() for x in (allowed_names or []) if str(x).strip()]
    allowed_text = ", ".join(allowed) if allowed else "(none)"
    out = runtime_tool_not_enabled_template.replace("{{function_name}}", fn)
    out = out.replace("{{allowed_names}}", allowed_text)
    return out


def build_tool_completion_hint_text(tool_names: Iterable[str]) -> str:
    names = [str(x).strip() for x in (tool_names or []) if str(x).strip()]
    joined = ", ".join(names)
    return tool_completion_hint_template.replace("{{tool_names}}", joined)


def build_conversation_title_prompt(user_message: str, assistant_response: str) -> str:
    out = conversation_title_prompt_template.replace("{{user_message}}", str(user_message or "")[:100])
    out = out.replace("{{assistant_response}}", str(assistant_response or "")[:100])
    return out


def _lightweight_tool_overview(desc: Any, max_len: int = 42) -> str:
    text = re.sub(r"\s+", " ", str(desc or "")).strip()
    if not text:
        return "无概览"
    first = re.split(r"[。.!?；;]", text, maxsplit=1)[0].strip() or text
    if len(first) > max_len:
        return first[:max_len].rstrip() + "..."
    return first


def build_select_tools_catalog_prompt(catalog: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for item in (catalog or []):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "") or "").strip()
        if not name:
            continue
        overview = _lightweight_tool_overview(item.get("description", ""))
        lines.append(f"- {name} - {overview}")
    return "\n".join(lines)


def build_select_tools_catalog_suffix(names: Iterable[str], max_items: int = 128) -> str:
    clean_names = [str(x).strip() for x in (names or []) if str(x).strip()]
    if not clean_names:
        return select_tools_catalog_empty
    cap = max(1, int(max_items or 24))
    shown = clean_names[:cap]
    joined = ", ".join(shown)
    if len(clean_names) > len(shown):
        out = select_tools_catalog_suffix_more.replace("{{names}}", joined)
        out = out.replace("{{total}}", str(len(clean_names)))
        return out
    return select_tools_catalog_suffix.replace("{{names}}", joined)


def strip_select_tools_catalog_suffix(desc: Any) -> str:
    text = str(desc or "").strip()
    marker = select_tools_catalog_marker
    if marker in text:
        text = text.split(marker, 1)[0].rstrip(" \n。")
    return text


web_search_default = """
你是联网搜索执行器。目标是返回“可验证”的检索结果，而非自由发挥。
规则：
1. 只输出你能确认的事实，禁止编造 URL、标题、日期、引文。
2. 优先返回来源链接 + 摘要；若无可靠来源，明确写“无法获取相关信息”及原因。
3. 若结果存在时间敏感性，尽量包含发布日期/时间范围。
4. 不做冗长分析，不输出与查询无关内容。
建议输出：
[完整URL] 关键信息摘要（可含日期）
"""


default = default_base


others = {
}
