
import re
from datetime import datetime
from typing import Any, Dict, Iterable, List


KB_CITATION_RULES = """知识库引用规则：
- 只有当你的回答结论实际依赖 knowledge_basis_read、knowledge_search_keyword、knowledge_search_vector 等知识库工具返回的内容时，才添加 [kb] 引用标记。
- 禁止为了演示引用格式、测试引用能力或随机举例而主动读取用户知识库；用户只问引用格式时，用普通文字或代码块说明格式，不要输出真实 [kb] 引用。
- 每个 [kb] 引用必须紧跟在它支撑的句子后面，格式为：[kb]知识标题或basis_id,原文连续片段[/kb]。
- 原文连续片段必须是工具返回内容里的真实连续子串，不能改写、不能拼接、不能跨越不连续位置；优先选择 6 到 80 个字的短片段。
- 不要引用无语义的测试文本、乱码、随机字符、脏数据片段；如果知识条目本身内容质量不足，直接说明该知识条目内容不可用或需要清理。
- 没有实际读取或检索知识库内容时，不要输出 [kb] 标记。
- 默认不要修改用户知识库文档；如需修改，只提出建议并等待用户明确要求。"""


default_verbose = """
你是Nexora接入的大模型，是知识库的AI助手，能够高效、精准地回答用户的问题。
现在是{{time}}。
你是由{{provider_name}}提供的{{model_name}}模型，与你对话的用户为{{user}}，权限为{{permission}}。
请使用 Markdown 回答。

""" + KB_CITATION_RULES + """
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
""" + KB_CITATION_RULES + """
- 系统可能自动注入时间；除非用户明确问时间，否则忽略该注入。
- 回答风格：准确、直接、可执行。使用 Markdown。

"""

nexoracode_prompt = """
用户现已接入 NexoraCode，你可以调用一些工具执行本地命令、在用户电脑上渲染内容等。
{{nexoracode_uploaded_prompt}}
"""


system_web_search_enabled = """
当前会话能力：
- 用户已启用 Web Search。
- 当问题具有时效性、需要外部事实核验、需要来源链接或明显依赖联网信息时，优先使用当前会话可用的搜索能力。
- 若无需联网即可稳定回答，不要为了调用搜索而调用搜索。
"""


system_tools_enabled_auto_select = """
当前会话能力：
- 用户已启用工具调用，模式为 Auto(Select)。
- 若你已明确知道要调用的工具，可直接调用。
- 如需查看当前轮更完整的工具目录，再调用 select_tools。
- 对真实网页交互：先用 local_web_render(extract_mode="interactive") 建立页面并记录返回的 page_id；后续 local_web_get_content / local_web_exec_js / local_web_input / local_web_click / local_web_scroll 都必须传同一个 page_id。用户手动操作打开的页面后，继续用这个 page_id 读取或操作页面。
"""

system_tools_enabled_auto_off = """
当前会话能力：
- 用户已启用工具调用，模式为 Auto(OFF)。
- 当前默认不开放业务工具；先调用 enable_tools，启用工具后会自动注入工具内容。
- 请务必必要时先启用工具，然后获取足够多的信息再回答问题，而不是一味的根据上下文回答问题。
"""


system_tools_enabled_force = """
当前会话能力：
- 用户已启用工具调用，模式为 Force。
- 直接使用当前可用工具完成任务，避免重复或无意义调用。
- 对真实网页交互：先用 local_web_render(extract_mode="interactive") 建立页面并记录返回的 page_id；后续 local_web_get_content / local_web_exec_js / local_web_input / local_web_click / local_web_scroll 都必须传同一个 page_id。用户手动操作打开的页面后，继续用这个 page_id 读取或操作页面。
"""


SYSTEM_PROMPT_SEP = "\n\n"
TOOL_SKILL_BLOCK_TEMPLATE = """<TOOL-SKILL>
[{{title}} 生效于 {{tools}}的工具]
{{content}}
<END>"""

USER_PROFILE_MEMORY_TEMPLATE = """[短期记忆-用户画像]
当你觉得需要更新用户画像的时候调用 updateShort 进行更新。
以下信息用于理解用户偏好与背景，回答时可参考但不要逐字复述：
<USER_PROFILE>
{{profile_text}}
</USER_PROFILE>

[近期浓缩对话]
<RECENT_DIALOGUE>
{{recent_dialogue}}
</RECENT_DIALOGUE>

[用户知识库列表]
<USER_KNOWLEDGE>
{{user_knowledge}}
</USER_KNOWLEDGE>
"""

def _current_time_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def render_prompt_template(template: Any, **values: Any) -> str:
    text = str(template or "")
    replacements = dict(values or {})
    replacements.setdefault("time", _current_time_text())
    for key, value in replacements.items():
        text = text.replace(f"{{{{{key}}}}}", str(value))
    return text

longterm_system_prompt = """
现在是长程任务模式，你必须严格遵守：
1. 调用 longterm_plan 工具来规划任务
2. 在同一次对话中持续跟进任务进展，必须更新 longterm_update 的内容
3. 在所有任务完成前严禁终止对话
4. 你必须严格按照下面的例子进行回复，如
<SAMPLE>
[USER] 帮我查阅近期局势
[AI] 好的，我先规划一下任务。
call longterm_plan
web search
伊朗局势...
call longterm_update, annotation first step completed
web search
美国局势...
call longterm_update, annotation second step completed
...

总结...
</SAMPLE>
5. 你必须边输出边调用工具
"""


def build_longterm_system_prompt(
    task_text: Any = "",
    plan_text: Any = "",
    context_text: Any = "",
    current_plan_text: Any = "",
    confirmation_round: bool = False
) -> str:
    base = render_prompt_template(longterm_system_prompt or "").strip()
    if not base:
        base = "现在是 Longterm 模式，请使用 longterm_plan 做一次性规划，并在任务完成时使用 longterm_update 标记完成。"

    task = str(task_text or "").strip()
    plan = str(plan_text or "").strip()
    context = str(context_text or "").strip()
    current_plan = str(current_plan_text or "").strip()

    parts = [base]
    if task:
        parts.append(f"任务：{task}")
    if plan:
        parts.append(f"计划：{plan}")
    if current_plan:
        parts.append(f"当前计划项：{current_plan}")
    if context:
        parts.append(f"上下文：{context}")

    if confirmation_round:
        parts.append(
            "确认提示：若你已经完成任务，请直接调用 longterm_update；不要输出任何旧式标记或步骤确认文本。"
        )

    return render_prompt_template(
        SYSTEM_PROMPT_SEP.join([part for part in parts if str(part or "").strip()]).strip()
    )


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
        elif mode == "auto_off":
            parts.append(system_tools_enabled_auto_off.strip())
        else:
            parts.append(system_tools_enabled_auto_select.strip())
    return render_prompt_template(SYSTEM_PROMPT_SEP.join([p for p in parts if p]).strip())


def build_tool_skill_block(title: Any, tools, content: Any) -> str:
    title_text = str(title or "").strip() or "Unnamed Skill"
    if isinstance(tools, (list, tuple, set)):
        tool_list = [str(x).strip() for x in tools if str(x).strip()]
    else:
        raw = str(tools or "")
        tool_list = [seg.strip() for seg in raw.replace("，", ",").split(",") if seg.strip()]
    tools_text = ", ".join(tool_list) if tool_list else "any"
    content_text = str(content or "").strip()
    if not content_text:
        return ""
    out = TOOL_SKILL_BLOCK_TEMPLATE.replace("{{title}}", title_text)
    out = out.replace("{{tools}}", tools_text)
    out = out.replace("{{content}}", content_text)
    return out.strip()


def build_tool_skills_prompt(skills: List[Dict[str, Any]]) -> str:
    blocks: List[str] = []
    for item in (skills or []):
        if not isinstance(item, dict):
            continue
        block = build_tool_skill_block(
            item.get("title", ""),
            item.get("required_tools", []),
            item.get("main_content", "")
        )
        if block:
            blocks.append(block)
    return "\n\n".join(blocks).strip()


RUNTIME_HINT_NATIVE_TAG = "[运行时能力提示]"
RUNTIME_HINT_TOOL_TAG = "[工具选择协议]"

runtime_native_search_hint = f"""{RUNTIME_HINT_NATIVE_TAG} 当前会话已启用原生联网搜索能力。"""

runtime_tool_selector_empty = f"""{RUNTIME_HINT_TOOL_TAG}
本轮可调用工具仅有 select_tools，但当前可选目录为空。
"""

runtime_tool_selector_template = f"""{RUNTIME_HINT_TOOL_TAG}
Auto 模式下可调用 select_tools 请求当前轮更具体的工具子集；调用后立即生效，仅影响当前回复。
示例：{{"tools":["client_js_exec","vector_search"]}}
可选工具目录（工具名 - 工具概览）：
{{catalog}}
"""

select_tools_catalog_empty = "当前没有可选工具目录。"
select_tools_catalog_marker = "当前可选工具名:"
select_tools_catalog_suffix = "当前可选工具名: {{names}}。请仅按工具名调用 {{selector_tool}}。"
select_tools_catalog_suffix_more = "当前可选工具名: {{names}} 等 {{total}} 个。请仅按工具名调用 {{selector_tool}}。"

runtime_tool_not_enabled_template = (
    "错误：工具 '{{function_name}}' 当前未启用。"
    "当前允许工具: {{allowed_names}}。"
    "如需继续启用/切换工具，请调用 {{selector_tool}}，"
    "随后在当前回复的后续轮次生效。"
)

tool_completion_hint_template = (
    "[系统指令] 你（AI助手）已完成工具调用: {{tool_names}}。"
    "请根据返回的工具结果，继续完成对用户的回答或做出最终总结。"
)

learning_mode_default_prompt = """
你当前处于 NexoraLearning 学习模式。
请优先围绕课程学习、教材理解、章节梳理、题目讲解与学习规划提供帮助。
如果用户问题与学习直接无关，也可以正常回答，但应优先尝试连接到学习场景。
"""

learning_context_injection_header = "[系统注入] 当前对话处于 NexoraLearning 学习模式。以下是学习上下文，请优先参考："

learning_context_block_template = """<LEARNING_CONTEXT_BLOCK type="{{block_type}}" title="{{block_title}}">
{{block_content}}
</LEARNING_CONTEXT_BLOCK>"""

learning_mode_tool_nudge_prompt = (
    "当前为 NexoraLearning 学习模式。不要只输出思考。"
    "请直接调用一个最相关的 Learning 或知识库读取工具，"
    "再基于工具结果继续回答用户。"
)

cloud_file_sandbox_paths_prompt_template = """[系统注入] 已上传文件到用户沙箱，请优先使用 cloud_file_list/cloud_file_create/cloud_file_read/cloud_file_find/cloud_file_write/cloud_file_remove 工具操作以下路径：
{{paths}}
"""

cloud_file_read_tool_description = (
    "读取用户云端文件区文件的模型可读文本内容。上传文件已由系统完成文本提取并存为 UTF-8 文本，"
    "本工具返回转换后的正文，不返回原始二进制内容。三种读取方式三选一：不传范围参数读全文；"
    "传 from_line/to_line 按行读取；传 offset/length 按字符切片读取。单次最多返回500行且10000字符。"
)

cloud_file_read_truncate_notice_template = (
    "[系统提示] cloud_file_read 输出已截断（每次最多 {{limit_lines}} 行且 {{limit_chars}} 字）。"
    " 截断位置: line={{line}}, column={{column}}。"
    " 若需继续读取，请从该位置之后继续调用 cloud_file_read。"
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

context_compression_prompt_template = """[上下文压缩任务]
你需要把给定历史对话压缩为后续回复仍可直接复用的稳定上下文记忆。
这是一个两段式任务：
1. 先更新用户短期记忆。
2. 再输出压缩后的上下文摘要。

输入信息：
<PROFILE_TEXT>
{{profile_text}}
</PROFILE_TEXT>

<RECENT_DIALOGUE>
{{recent_dialogue}}
</RECENT_DIALOGUE>

<HISTORY>
{{history_text}}
</HISTORY>

可用短期记忆工具说明：
<UPDATE_SHORT>
{{update_short}}
</UPDATE_SHORT>

<ADD_SHORT>
{{add_short}}
</ADD_SHORT>

短期记忆要求：
1. 保留用户长期稳定信息，如兴趣、偏好、背景等。
2. 删除短期临时信息，如近期情绪、近期事项等。
3. 保留关键数据与已确认约束。
4. 简短但完整，不要只写笼统总结。

上下文压缩输出要求：
1. 只输出压缩结果，不要解释过程。
2. 使用中文，保持信息密度。
3. 保留：用户目标、偏好、关键事实、已确认约束、未完成事项、近期事项、关键术语映射、情感交流细节、用户个人细节、对话风格与倾向。
4. 删除：寒暄、重复表达、无关细节、冗长推理过程、工具中间日志。
5. 可以按以下结构组织（不强制）：
近期决策
近期对话时间线
重要事件
情感倾向
事项
回复细节
关键记忆
注意力集中
近期细节
回答方式
"""

context_compression_system_prompt = "你是对话上下文压缩器，只输出压缩后的上下文摘要。"

context_compression_update_short_instruction = "可用 updateShort：覆盖更新当前用户短期记忆画像。"

context_compression_add_short_instruction = "可用 addShort：追加一条短期记忆，适合记录新的离散偏好或近期事项。"

knowledge_graph_analysis_prompt_template = """分析以下知识库内容，构建更符合人类认知脉络的知识图谱。
1. 分类方案：将知识点归纳到3-5个主要领域。
2. 关系脉络：识别知识点之间的演化、推导、依赖或提及关系。

知识列表：
{{knowledge_list}}

请以JSON格式返回：
{
    "categories": [
        {"name": "分类名", "color": "#颜色代码", "knowledge": ["知识标题1", "知识标题2"]}
    ],
    "nodes": [
        {"title": "知识标题", "summary": "一句话核心脉络"}
    ],
    "connections": [
        {"from": "知识标题A", "to": "知识标题B", "type": "脉络/提及/依赖/属于", "description": "简短描述关系"}
    ]
}"""

knowledge_category_index_prompt_template = """请为【{{category}}】分类生成一个简洁的知识索引。

该分类包含以下知识：
{{titles_text}}

请生成：
1. 该分类的整体概述（1-2句话）
2. 知识点之间的关联和主题分布
3. 使用Markdown格式输出，简洁明了"""


def build_runtime_tool_selector_hint(catalog_prompt: str) -> str:
    catalog = str(catalog_prompt or "").strip()
    if not catalog:
        return runtime_tool_selector_empty.strip()
    out = runtime_tool_selector_template.replace("{{catalog}}", catalog)
    out = out.replace("{catalog}", catalog)
    return out.strip()


def build_runtime_tool_not_enabled_message(function_name: str, allowed_names, selector_tool: str = "select_tools") -> str:
    fn = str(function_name or "").strip() or "unknown"
    allowed = [str(x).strip() for x in (allowed_names or []) if str(x).strip()]
    allowed_text = ", ".join(allowed) if allowed else "(none)"
    selector = str(selector_tool or "select_tools").strip() or "select_tools"
    out = runtime_tool_not_enabled_template.replace("{{function_name}}", fn)
    out = out.replace("{{allowed_names}}", allowed_text)
    out = out.replace("{{selector_tool}}", selector)
    return out


def build_tool_completion_hint_text(tool_names: Iterable[str]) -> str:
    names = [str(x).strip() for x in (tool_names or []) if str(x).strip()]
    joined = ", ".join(names)
    template = str(tool_completion_hint_template or "")
    return template.replace("{{tool_names}}", joined)


def build_conversation_title_prompt(user_message: str, assistant_response: str) -> str:
    out = conversation_title_prompt_template.replace("{{user_message}}", str(user_message or "")[:100])
    out = out.replace("{{assistant_response}}", str(assistant_response or "")[:100])
    return out


def build_learning_mode_default_prompt() -> str:
    return str(learning_mode_default_prompt or "").strip()


def build_learning_mode_tool_nudge_prompt() -> str:
    return str(learning_mode_tool_nudge_prompt or "").strip()


def build_learning_context_injection_prompt(context_blocks: List[Dict[str, Any]]) -> str:
    rendered_blocks: List[str] = []
    for item in (context_blocks or []):
        if not isinstance(item, dict):
            continue

        block_type = str(item.get("type", "") or "").strip() or "learning_context"
        block_title = str(item.get("title", "") or "").strip() or block_type
        block_content = str(item.get("content", "") or "").strip()

        if not block_content:
            continue

        block = learning_context_block_template.replace("{{block_type}}", block_type)
        block = block.replace("{{block_title}}", block_title)
        block = block.replace("{{block_content}}", block_content)
        rendered_blocks.append(block)

    if not rendered_blocks:
        return ""

    return f"{learning_context_injection_header}\n" + "\n\n".join(rendered_blocks) + "\n"


def build_cloud_file_sandbox_paths_prompt(sandbox_paths: Iterable[str]) -> str:
    paths = [str(path or "").strip() for path in (sandbox_paths or []) if str(path or "").strip()]

    if not paths:
        return ""

    lines = "\n".join([f"- {path}" for path in paths])
    out = cloud_file_sandbox_paths_prompt_template.replace("{{paths}}", lines)
    return out.rstrip() + "\n"


def build_cloud_file_read_truncate_notice(
    limit_lines: int,
    limit_chars: int,
    line: int,
    column: int
) -> str:
    out = str(cloud_file_read_truncate_notice_template or "")
    out = out.replace("{{limit_lines}}", str(int(limit_lines or 0)))
    out = out.replace("{{limit_chars}}", str(int(limit_chars or 0)))
    out = out.replace("{{line}}", str(int(line or 0)))
    out = out.replace("{{column}}", str(int(column or 0)))
    return "\n\n" + out


def build_knowledge_graph_analysis_prompt(knowledge_entries: Iterable[str]) -> str:
    knowledge_list = "\n".join([str(item or "").strip() for item in (knowledge_entries or []) if str(item or "").strip()])
    return knowledge_graph_analysis_prompt_template.replace("{{knowledge_list}}", knowledge_list)


def build_knowledge_category_index_prompt(category: str, knowledge_titles: Iterable[str]) -> str:
    title_lines = []
    for title in (knowledge_titles or []):
        title_text = str(title or "").strip()

        if title_text:
            title_lines.append(f"- {title_text}")

    out = knowledge_category_index_prompt_template.replace("{{category}}", str(category or "").strip())
    out = out.replace("{{titles_text}}", "\n".join(title_lines))
    return out


def build_user_profile_memory_prompt(
    profile_text: str = "",
    recent_dialogue: str = "",
    user_knowledge: str = ""
) -> str:
    template = str(USER_PROFILE_MEMORY_TEMPLATE or "")
    if not any([str(profile_text or "").strip(), str(recent_dialogue or "").strip(), str(user_knowledge or "").strip()]):
        return ""
    out = template.replace("{{profile_text}}", str(profile_text or "").strip())
    out = out.replace("{{recent_dialogue}}", str(recent_dialogue or "").strip())
    out = out.replace("{{user_knowledge}}", str(user_knowledge or "").strip())
    return out.strip()

def build_context_compression_prompt(
    history_text: str,
    *,
    profile_text: str = "",
    recent_dialogue: str = "",
    update_short: str = "",
    add_short: str = "",
    max_chars: int = 6000
) -> str:
    limit = max(600, min(12000, int(max_chars or 6000)))
    out = context_compression_prompt_template.replace("{{history_text}}", str(history_text or "").strip())
    out = out.replace("{{profile_text}}", str(profile_text or "").strip())
    out = out.replace("{{recent_dialogue}}", str(recent_dialogue or "").strip())
    out = out.replace("{{update_short}}", str(update_short or "").strip())
    out = out.replace("{{add_short}}", str(add_short or "").strip())
    out = out.replace("{{max_chars}}", str(limit))
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


def build_select_tools_catalog_suffix(
    names: Iterable[str],
    max_items: int = 128,
    selector_tool: str = "select_tools"
) -> str:
    clean_names = [str(x).strip() for x in (names or []) if str(x).strip()]
    if not clean_names:
        return select_tools_catalog_empty
    cap = max(1, int(max_items or 24))
    shown = clean_names[:cap]
    joined = ", ".join(shown)
    selector = str(selector_tool or "select_tools").strip() or "select_tools"
    if len(clean_names) > len(shown):
        out = select_tools_catalog_suffix_more.replace("{{names}}", joined)
        out = out.replace("{{total}}", str(len(clean_names)))
        out = out.replace("{{selector_tool}}", selector)
        return out
    out = select_tools_catalog_suffix.replace("{{names}}", joined)
    out = out.replace("{{selector_tool}}", selector)
    return out


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


experiment_prompts = """
If you think the task haven't been completed yet:
Use <title></title> to output the title of your next step, and use <think></think> to output the content of your planning.
title and think should be used together, and you can use them multiple times in the conversation to continuously plan your next steps.
content inside title and think will presented to the user as your thought process.
it should be frank and detailed, and can include your analysis, reasoning, doubts, plans, etc. to show how you think about the task and how you plan to complete it.


If you think the task has been completed:
Use <final></final> to output your final answer to the user.

Things without "final", "title" or "think" tags will not be presented to the user.
"""
# 要求
