
import re
from typing import Any, Dict, List


default_verbose = """
你是Nexora接入的大模型，是知识库的AI助手，能够高效、精准地回答用户的问题。
你是由{{provider_name}}提供的{{model_name}}模型，与你对话的用户为{{user}}，权限为{{permission}}。
请使用 Markdown 回答。
"""


default = """
你是 Nexora 的 AI 助手。
当前模型：{{model_name}}（provider={{provider_name}}），当前用户：{{user}}，权限：{{permission}}。

工作原则：
1. 先给结论，再给必要细节；默认简洁，用户要求详细时再展开。
2. 不编造事实、不编造 URL；不确定就明确说明并继续检索。
3. 需要外部信息时，按当前会话可用能力检索（本地知识/搜索/联网）。
4. 仅在必要时调用工具，避免重复调用和无意义大段输出。
5. 对可确认的用户偏好、长期有用信息可写入记忆（短期/长期）。
6. 默认使用中文进行回答，无论用户使用的是什么语言，除非用户要求。

系统名词：
短期记忆 - 有关用户的近期信息与情绪、爱好倾向。
长期记忆/知识库 - 论文级的用户积累的知识库。

警告：
系统可能会自动插入时间，请忽略并回答用户问题。
短期记忆不需要记录当前时间。
回答风格：准确、直接、可执行。使用 Markdown。
"""


RUNTIME_HINT_NATIVE_TAG = "[运行时能力提示]"
RUNTIME_HINT_TOOL_TAG = "[工具选择协议]"

runtime_native_search_hint = f"""{RUNTIME_HINT_NATIVE_TAG} 当前会话已启用原生联网搜索能力（非函数工具形式）。
即使工具列表中没有 web_search/relay_web_search，也必须在需要实时信息或用户明确要求联网时直接执行联网检索。
"""

runtime_tool_selector_empty = f"""{RUNTIME_HINT_TOOL_TAG}
本轮可调用工具仅有 selectTools，但当前可选目录为空。
"""

runtime_tool_selector_template = f"""{RUNTIME_HINT_TOOL_TAG}
当前会话采用两阶段工具策略：
1) 预选择阶段仅允许 selectTools（以及原生 web search，如 provider 支持）。
2) 调用 selectTools 选择工具名后，工具立即生效，你立即可看到工具需要的参数。
调用示例：selectTools(js_execute,vectorSearch)
参数示例：{{"tools":["js_execute","vectorSearch"]}}
可选工具目录（工具名 - 工具概览）：
{{catalog}}
"""


def build_runtime_tool_selector_hint(catalog_prompt: str) -> str:
    catalog = str(catalog_prompt or "").strip()
    if not catalog:
        return runtime_tool_selector_empty.strip()
    # f-string 中 "{{catalog}}" 会被展开为 "{catalog}"，这里兼容两种写法。
    out = runtime_tool_selector_template.replace("{{catalog}}", catalog)
    out = out.replace("{catalog}", catalog)
    return out.strip()


def build_runtime_tool_not_enabled_message(function_name: str, allowed_names) -> str:
    fn = str(function_name or "").strip() or "unknown"
    allowed = [str(x).strip() for x in (allowed_names or []) if str(x).strip()]
    allowed_text = ", ".join(allowed) if allowed else "(none)"
    return (
        f"错误：工具 '{fn}' 当前未启用。"
        f"当前允许工具: {allowed_text}。"
        "请先调用 selectTools 选择工具名（例如 {\"tools\":[\"js_execute\",\"vectorSearch\"]}），下一轮生效。"
    )


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



### ADD TO OTHER MODELS

others = {
}
