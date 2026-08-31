
import re
from datetime import datetime
from typing import Any, Dict, Iterable, List


KB_CITATION_RULES = """知识库引用规则：
- 只有当你的回答结论实际依赖 knowledge_basis_read、search 等知识库工具返回的内容时，才添加 [kb] 引用标记。
- 禁止为了演示引用格式、测试引用能力或随机举例而主动读取用户知识库；用户只问引用格式时，用普通文字或代码块说明格式，不要输出真实 [kb] 引用。
- 每个 [kb] 引用必须紧跟在它支撑的句子后面，格式为：[kb]知识标题或basis_id,原文连续片段[/kb]。
- 原文连续片段必须是工具返回内容里的真实连续子串，不能改写、不能拼接、不能跨越不连续位置；优先选择 6 到 80 个字的短片段。
- 不要引用无语义的测试文本、乱码、随机字符、脏数据片段；如果知识条目本身内容质量不足，直接说明该知识条目内容不可用或需要清理。
- 没有实际读取或检索知识库内容时，不要输出 [kb] 标记。
- 默认不要修改用户知识库文档；如需修改，只提出建议并等待用户明确要求。"""


default_base = """
你是 Nexora 的 AI 助手。
当前模型：{{model_name}}（provider={{provider_name}}），当前用户：{{user}}，权限：{{permission}}。
默认使用中文和 Markdown 回答，除非用户明确要求其他语言。
先给结论，再补充必要细节；不编造事实、来源、URL 或工具结果。
需要核验或执行时，使用当前会话已开放的能力直接处理。

"""


SYSTEM_PROMPT_SEP = "\n\n"
knowledge_citation_tool_hint = "\n\n" + KB_CITATION_RULES
SKILL_INSTRUCTIONS_HEADER = "## Skill Instructions\n以下是当前启用的 Skill 指令；优先级低于基础系统规则，高于普通对话上下文。"
GLOBAL_SKILL_INSTRUCTIONS_HEADER = "### Global Instructions\n以下 Skill 不绑定具体工具，作为全局行为指令生效。"
TOOL_SKILL_INSTRUCTIONS_HEADER = "### Tool Skill Instructions\n以下 Skill 只在相关工具或工具流程中生效。"
GLOBAL_SKILL_BLOCK_TEMPLATE = """<GLOBAL-INSTRUCTION>
[{{title}}]
{{content}}
<END>"""
TOOL_SKILL_BLOCK_TEMPLATE = """<TOOL-SKILL>
[{{title}} 生效于 {{tools}}的工具]
{{content}}
<END>"""

USER_PROFILE_MEMORY_TEMPLATE = """## 用户画像上下文
以下材料用于理解用户偏好与背景，回答时可参考但不要逐字复述。

{{profile_blocks}}
"""


MEMORY_ANALYSIS_SYSTEM_PROMPT = """你负责判断一轮普通对话是否产生了值得保存的用户记忆。

你必须且只能调用一次工具，不得输出普通文本。

可保存：
- 用户明确表达、未来多次对话仍有价值的沟通偏好、长期习惯和长期背景。
- 对接下来数轮对话有帮助的最新状态、近期计划、最近关注点和当前阶段变化。记录这类近期信息时必须保留明确的时间语义，例如“最近”“目前”“本周”或用户给出的日期，不能把它写成永久事实。
- 已有近期信息发生变化、完成、取消或过期时，应更新或移除旧信息，避免画像长期保留失效状态。

不可保存：
- 纯一次性操作步骤、项目或 Workspace 内可直接读取的事实、工具输出、日志、推测、密钥和敏感隐私。
- 助手提出但用户没有确认的信息。
- 仅对当前回答有用、对后续对话没有帮助的临时细节。

工具选择：
- 没有新增或需要修改的记忆：调用 memory_keep，reason 必须简短说明不记录的原因，不得复述敏感内容。
- 新增独立且不冲突的长期或近期记忆：调用 memory_append。
- 新信息会修正、替换、移除或重组已有记忆：调用 memory_overwrite，content 必须是完整的新用户画像。

不要解释决定，不要在工具调用之外输出任何内容。"""

def _current_time_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def render_prompt_template(template: Any, **values: Any) -> str:
    text = str(template or "")
    replacements = dict(values or {})
    replacements.setdefault("time", _current_time_text())
    for key, value in replacements.items():
        text = text.replace(f"{{{{{key}}}}}", str(value))
    return text


def _render_xml_text_block(tag: str, content: Any, attrs: Dict[str, Any] = None) -> str:
    """仅在正文有内容时渲染 XML 风格上下文块，避免 debug 中出现空标签。"""
    tag_text = str(tag or "").strip()
    content_text = str(content or "").strip()

    if not tag_text or not content_text:
        return ""

    attr_parts: List[str] = []

    if isinstance(attrs, dict):

        for key, value in attrs.items():
            key_text = str(key or "").strip()
            value_text = str(value or "").strip()

            if key_text and value_text:
                attr_parts.append(f'{key_text}="{value_text}"')

    attr_text = f" {' '.join(attr_parts)}" if attr_parts else ""
    return f"<{tag_text}{attr_text}>\n{content_text}\n</{tag_text}>"

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
    return render_prompt_template(SYSTEM_PROMPT_SEP.join([p for p in parts if p]).strip())


def _normalize_skill_tool_list(tools) -> List[str]:
    if isinstance(tools, (list, tuple, set)):
        return [str(x).strip() for x in tools if str(x).strip()]

    raw = str(tools or "")
    return [seg.strip() for seg in raw.replace("，", ",").split(",") if seg.strip()]


def build_global_skill_block(title: Any, content: Any) -> str:
    title_text = str(title or "").strip() or "Unnamed Skill"
    content_text = str(content or "").strip()
    if not content_text:
        return ""
    out = GLOBAL_SKILL_BLOCK_TEMPLATE.replace("{{title}}", title_text)
    out = out.replace("{{content}}", content_text)
    return out.strip()


def build_tool_skill_block(title: Any, tools, content: Any) -> str:
    title_text = str(title or "").strip() or "Unnamed Skill"
    tool_list = _normalize_skill_tool_list(tools)
    tools_text = ", ".join(tool_list) if tool_list else "any"
    content_text = str(content or "").strip()
    if not content_text:
        return ""
    out = TOOL_SKILL_BLOCK_TEMPLATE.replace("{{title}}", title_text)
    out = out.replace("{{tools}}", tools_text)
    out = out.replace("{{content}}", content_text)
    return out.strip()


def _build_skill_instruction_blocks(skills: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    global_blocks: List[str] = []
    tool_blocks: List[str] = []

    for item in (skills or []):
        if not isinstance(item, dict):
            continue

        required_tools = _normalize_skill_tool_list(item.get("required_tools", []))
        if required_tools:
            block = build_tool_skill_block(
                item.get("title", ""),
                required_tools,
                item.get("main_content", "")
            )
            if block:
                tool_blocks.append(block)
            continue

        block = build_global_skill_block(
            item.get("title", ""),
            item.get("main_content", "")
        )
        if block:
            global_blocks.append(block)

    return {
        "global": global_blocks,
        "tool": tool_blocks,
    }


def build_skill_instructions_prompt(skills: List[Dict[str, Any]]) -> str:
    """将启用的 Skill 分成全局指令和工具指令两个段落，作为独立 system message 注入。"""
    blocks = _build_skill_instruction_blocks(skills)
    global_blocks = blocks.get("global", [])
    tool_blocks = blocks.get("tool", [])
    sections: List[str] = []

    if global_blocks:
        sections.append(f"{GLOBAL_SKILL_INSTRUCTIONS_HEADER}\n" + "\n\n".join(global_blocks))

    if tool_blocks:
        sections.append(f"{TOOL_SKILL_INSTRUCTIONS_HEADER}\n" + "\n\n".join(tool_blocks))

    if not sections:
        return ""

    return f"{SKILL_INSTRUCTIONS_HEADER}\n\n" + "\n\n".join(sections)


def build_tool_skills_prompt(skills: List[Dict[str, Any]]) -> str:
    blocks = _build_skill_instruction_blocks(skills)
    return "\n\n".join(blocks.get("tool", [])).strip()


def build_longdoc_skill_catalog_prompt(skills: List[Dict[str, Any]]) -> str:
    rows: List[str] = []

    for item in (skills or []):

        if not isinstance(item, dict):
            continue

        sid = str(item.get("id", "") or "").strip()
        title = str(item.get("title", "") or "").strip()
        description = str(item.get("description", "") or "").strip()
        aliases_raw = item.get("aliases", [])
        aliases = []

        if isinstance(aliases_raw, list):
            aliases = [str(x).strip() for x in aliases_raw if str(x).strip()]

        if not sid or not title or not description:
            continue

        alias_sep = " 别名：" if description.endswith(("。", "！", "？", ".", "!", "?")) else "；别名："
        alias_text = f"{alias_sep}{', '.join(aliases)}" if aliases else ""
        rows.append(f"- {sid}｜{title}：{description}{alias_text}")

    if not rows:
        return ""

    return (
        "## Longdoc Skill Catalog\n"
        "- 以下长文档默认不注入正文。\n"
        "- 问题涉及对应产品、流程、配置、操作指南或排障时，先调用 `skill(name=\"文档ID或别名\")` 读取正文。\n"
        "- 工具未开放时先调用 `runtime_tool_enable`。\n\n"
        "### Available Longdoc Skills\n"
        + "\n".join(rows)
    ).strip()


RUNTIME_HINT_NATIVE_TAG = "[运行时能力提示]"
RUNTIME_HINT_TOOL_TAG = "[工具选择协议]"

runtime_tool_not_enabled_template = (
    "错误：工具 '{{function_name}}' 当前未启用。"
    "当前允许工具: {{allowed_names}}。"
    "如需继续启用工具，请调用 {{selector_tool}}，"
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

learning_context_injection_header = "## Learning Context\n当前对话处于 NexoraLearning 学习模式。以下学习上下文是本轮回答的参考材料，请优先参考。"

learning_context_block_template = """<LEARNING_CONTEXT_BLOCK type="{{block_type}}" title="{{block_title}}">
{{block_content}}
</LEARNING_CONTEXT_BLOCK>"""

workspace_operating_contract_header = (
    "## Workspace Operating Contract\n"
    "当前对话已进入 Workspace 专用工作模式。以下规则用于决定回答视角和任务优先级。"
)

workspace_operating_contract_template = """<WORKSPACE_CONTRACT workspace_id="{{workspace_id}}" title="{{workspace_title}}">
- 当前 Workspace 是本轮项目边界；回答优先围绕其目标、资源、记忆和任务。
- Workspace 自定义提示、记忆、知识库索引和文件只作为本项目材料；在不违背上层规则时按项目规则使用，不扩散为用户全局偏好，不无意义复述。
- 记忆写入遵循 Memory Write Policy；未获明确授权不主动写入。
{{workspace_prompt_section}}
</WORKSPACE_CONTRACT>"""

workspace_prompt_contract_section_template = """
<WORKSPACE_CUSTOM_INSTRUCTIONS>
{{prompt_content}}
</WORKSPACE_CUSTOM_INSTRUCTIONS>"""

workspace_memory_injection_header = "## Workspace Memory Context\n以下是当前 Workspace 自动记忆，请作为项目事实参考。"

workspace_memory_block_template = """<WORKSPACE_MEMORY workspace_id="{{workspace_id}}" title="{{workspace_title}}">
{{memory_content}}
</WORKSPACE_MEMORY>"""

workspace_prompt_injection_header = "## Workspace Custom Instructions\n以下是当前 Workspace 自定义提示词；在不违背上层系统与工具规则的前提下优先遵循。"

workspace_prompt_block_template = """<WORKSPACE_PROMPT workspace_id="{{workspace_id}}" title="{{workspace_title}}">
{{prompt_content}}
</WORKSPACE_PROMPT>"""

workspace_knowledge_injection_header = (
    "## Workspace Knowledge Index\n"
    "以下是当前 Workspace 绑定的知识库索引，仅作为资料目录。"
    "当回答结论依赖知识正文时，先调用 knowledge_basis_read 或知识库搜索工具读取内容。"
)

workspace_knowledge_block_template = """<WORKSPACE_KNOWLEDGE_INDEX workspace_id="{{workspace_id}}" title="{{workspace_title}}">
{{knowledge_rows}}
</WORKSPACE_KNOWLEDGE_INDEX>"""

workspace_resource_injection_header = "## Workspace Resource Index"

workspace_resource_block_template = """<WORKSPACE_RESOURCE_INDEX>
{{resource_rows}}
</WORKSPACE_RESOURCE_INDEX>"""

workspace_draft_injection_header = (
    "## Workspace Drafts\n"
    "以下是当前 Workspace 草稿板的已有条目（workspace_draft_add 工具写入或用户手动添加），"
    "是供用户直接查看的关键资料。回答可直接引用其内容；已有草稿覆盖的信息不要重复写入。"
)

workspace_draft_block_template = """<WORKSPACE_DRAFTS workspace_id="{{workspace_id}}" title="{{workspace_title}}">
{{draft_rows}}
</WORKSPACE_DRAFTS>"""

memory_write_policy_prompt_template = """## Memory Write Policy
原则：透明、可解释、可拒绝，不静默写入。

触发：
- 用户明确要求记住、保存偏好、以后按此执行、更新或删除记忆时，才调用记忆工具。
- 用户只是表达可能有长期价值的信息时，只询问是否记住。

归属：
- 用户画像：个人偏好、长期背景、沟通风格。
- Workspace 记忆：项目事实、稳定约束、决策、术语、待办、反复问题。

禁止：
- 不写入一次性任务、临时日志、工具输出细节、未经确认的推测。
- 不把项目事实写入用户画像。
- 敏感信息、密钥、隐私标识必须先获明确同意。

回执：
- 写入前说明将记录、更新或删除的摘要。
- 写入后只反馈结果和简短摘要。
- 用户要求修改或删除已有记忆时，优先编辑或删除原记录，避免追加冲突记忆。"""

learning_mode_tool_nudge_prompt = (
    "当前为 NexoraLearning 学习模式。不要只输出思考。"
    "请直接调用一个最相关的 Learning 或知识库读取工具，"
    "再基于工具结果继续回答用户。"
)

workspace_draft_policy_prompt_template = """## Workspace Draft Policy
草稿板（workspace_draft_add 工具）用于沉淀用户之后可能重复查看的信息，避免用户翻找历史对话。
触发：对话中产生规划、方案、执行步骤、结论、决策记录、关键数据与参数、清单或汇总结果时，主动写入草稿。
写法：一条草稿只放一个主题；title 概括主题，content 用 Markdown 组织正文。
禁止：过程性输出（工具日志、中间推理、寒暄）不写入；与已有草稿重复的内容不重复写入。
回执：写入后简要告知用户已存为草稿即可，不要在回复中重复正文。"""

cloud_file_sandbox_paths_prompt_template = """## Sandbox Files
已上传文件到用户沙箱，请优先使用 cloud_file_list/cloud_file_create/cloud_file_read/cloud_file_find/cloud_file_write/cloud_doc_write/cloud_file_remove 工具操作以下路径。
如果需要在回答中手动引用某个云端文件，只输出 [file]文件路径[/file]，不要手写文件大小、下载链接或摘要，这些信息由系统自动补全。

<SANDBOX_FILES>
{{paths}}
</SANDBOX_FILES>
"""

cloud_file_reference_tool_hint = (
    "当回答需要手动引用用户云端文件时，只输出 [file]文件路径[/file]，"
    "不要手写文件大小、下载链接或摘要，这些信息由系统自动补全。"
)

cloud_file_read_tool_description = (
    "读取用户云端文件区文件的模型可读文本内容。上传文件已由系统完成文本提取并存为 UTF-8 文本，"
    "本工具返回转换后的正文，不返回原始二进制内容。三种读取方式三选一：不传范围参数读全文；"
    "传 from_line/to_line 按行读取；传 offset/length 按字符切片读取。单次最多返回500行且10000字符。"
    + cloud_file_reference_tool_hint
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

context_compression_prompt_template = """## Context Compression Task
你需要把给定历史对话压缩为后续回复仍可直接复用的稳定上下文记忆。

注意：最终输出只能是压缩后的上下文摘要，不要输出解释过程。
<CONVERSATION_HISTORY> 是上下文摘要的主体；用户画像和近期摘要只能作为辅助参考，不能替代 <CONVERSATION_HISTORY>。

输入信息：
{{auxiliary_context_blocks}}

<CONVERSATION_HISTORY>
{{history_text}}
</CONVERSATION_HISTORY>

上下文压缩输出要求：
1. 只输出压缩结果，不要解释过程。
2. 使用中文，保持信息密度。
3. 保留：用户目标、偏好、关键事实、已确认约束、未完成事项、近期事项、关键术语映射、情感交流细节、用户个人细节、对话风格与倾向。
4. 删除：寒暄、重复表达、无关细节、冗长推理过程、工具中间日志。
5. 按以下结构组织：
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
6. 最大长度约 {{max_chars}} 字；如果 <CONVERSATION_HISTORY> 信息量足够，不要为了简短而丢弃可复用细节。
7. 对于关键信息直接照搬，有必要保留的上下文直接执行输出进行保留。
"""

context_compression_system_prompt = "你是对话上下文压缩器，只输出压缩后的上下文摘要。"

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


def build_runtime_tool_not_enabled_message(function_name: str, allowed_names, selector_tool: str = "runtime_tool_enable") -> str:
    fn = str(function_name or "").strip() or "unknown"
    allowed = [str(x).strip() for x in (allowed_names or []) if str(x).strip()]
    allowed_text = ", ".join(allowed) if allowed else "(none)"
    selector = str(selector_tool or "runtime_tool_enable").strip() or "runtime_tool_enable"
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


def _workspace_context_text(context: Any, key: str) -> str:
    if not isinstance(context, dict):
        return ""

    return str(context.get(key) or "").strip()


def _workspace_text_block_content(context: Any, key: str) -> str:
    if not isinstance(context, dict):
        return ""

    block = context.get(key)

    if not isinstance(block, dict):
        return ""

    if block.get("enabled") is False:
        return ""

    return str(block.get("content") or "").strip()


def _workspace_knowledge_documents(context: Any) -> List[Dict[str, Any]]:
    if not isinstance(context, dict):
        return []

    raw_documents = context.get("knowledge_documents", [])

    if not isinstance(raw_documents, list):
        return []

    return [item for item in raw_documents if isinstance(item, dict)]


def _workspace_draft_entries(context: Any) -> List[Dict[str, Any]]:
    if not isinstance(context, dict):
        return []

    raw_drafts = context.get("workspace_drafts", [])

    if not isinstance(raw_drafts, list):
        return []

    return [item for item in raw_drafts if isinstance(item, dict)]


def _workspace_knowledge_field(value: Any, limit: int = 160) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) > limit:
        text = text[:limit].rstrip() + "..."
    return text


def build_workspace_mode_prompt(workspace_context: Dict[str, Any]) -> str:
    """构建兼容旧调用点的 Workspace 模式规则。"""
    return build_workspace_operating_contract_prompt(workspace_context).strip()


def build_workspace_operating_contract_prompt(workspace_context: Dict[str, Any]) -> str:
    """构建 Workspace 独立运行契约，和 Nexora/Learning 通用提示词分层注入。"""
    workspace_id = _workspace_context_text(workspace_context, "workspace_id")
    workspace_title = _workspace_context_text(workspace_context, "workspace_title") or "Workspace"
    prompt_content = _workspace_text_block_content(workspace_context, "workspace_prompt")

    if not workspace_id:
        return ""

    prompt_section = ""

    if prompt_content:
        prompt_section = workspace_prompt_contract_section_template.replace("{{prompt_content}}", prompt_content)

    block = workspace_operating_contract_template.replace("{{workspace_id}}", workspace_id)
    block = block.replace("{{workspace_title}}", workspace_title)
    block = block.replace("{{workspace_prompt_section}}", prompt_section)

    return f"{workspace_operating_contract_header}\n{block.strip()}\n"


def build_workspace_memory_injection_prompt(workspace_context: Dict[str, Any]) -> str:
    """构建当前轮 Workspace 自动记忆注入，供模型参考项目事实。"""
    workspace_id = _workspace_context_text(workspace_context, "workspace_id")
    workspace_title = _workspace_context_text(workspace_context, "workspace_title") or "Workspace"
    memory_content = _workspace_text_block_content(workspace_context, "workspace_memory")

    if not workspace_id or not memory_content:
        return ""

    block = workspace_memory_block_template.replace("{{workspace_id}}", workspace_id)
    block = block.replace("{{workspace_title}}", workspace_title)
    block = block.replace("{{memory_content}}", memory_content)

    return f"{workspace_memory_injection_header}\n{block}\n"


WORKSPACE_DRAFT_INJECTION_MAX_ITEMS = 20
WORKSPACE_DRAFT_INJECTION_CONTENT_LIMIT = 200


def build_workspace_draft_injection_prompt(workspace_context: Dict[str, Any]) -> str:
    """构建当前轮 Workspace 草稿索引注入，让模型感知已有草稿、避免重复记录。"""
    workspace_id = _workspace_context_text(workspace_context, "workspace_id")
    workspace_title = _workspace_context_text(workspace_context, "workspace_title") or "Workspace"
    drafts = _workspace_draft_entries(workspace_context)

    if not workspace_id or not drafts:
        return ""

    rows: List[str] = []

    for item in drafts[-WORKSPACE_DRAFT_INJECTION_MAX_ITEMS:]:
        if not isinstance(item, dict):
            continue

        draft_id = _workspace_context_text(item, "draft_id")
        title = _workspace_context_text(item, "title")

        if not draft_id or not title:
            continue

        content = _workspace_context_text(item, "content")

        if len(content) > WORKSPACE_DRAFT_INJECTION_CONTENT_LIMIT:
            content = content[:WORKSPACE_DRAFT_INJECTION_CONTENT_LIMIT].rstrip() + "…"

        rows.append(f"- [{draft_id}] {title}\n  {content}" if content else f"- [{draft_id}] {title}")

    if not rows:
        return ""

    block = workspace_draft_block_template.replace("{{workspace_id}}", workspace_id)
    block = block.replace("{{workspace_title}}", workspace_title)
    block = block.replace("{{draft_rows}}", "\n".join(rows))

    return f"{workspace_draft_injection_header}\n{block}\n"


def build_workspace_prompt_injection_prompt(workspace_context: Dict[str, Any]) -> str:
    """构建当前轮 Workspace 自定义提示词注入，放在记忆之后强化项目约束。"""
    workspace_id = _workspace_context_text(workspace_context, "workspace_id")
    workspace_title = _workspace_context_text(workspace_context, "workspace_title") or "Workspace"
    prompt_content = _workspace_text_block_content(workspace_context, "workspace_prompt")

    if not workspace_id or not prompt_content:
        return ""

    block = workspace_prompt_block_template.replace("{{workspace_id}}", workspace_id)
    block = block.replace("{{workspace_title}}", workspace_title)
    block = block.replace("{{prompt_content}}", prompt_content)

    return f"{workspace_prompt_injection_header}\n{block}\n"


def build_workspace_draft_policy_prompt(workspace_context: Dict[str, Any]) -> str:
    """构建 Workspace 草稿写入策略提示，让模型主动沉淀用户可能重复查看的规划与记录。"""
    if not _workspace_context_text(workspace_context, "workspace_id"):
        return ""

    return workspace_draft_policy_prompt_template.strip() + "\n"


def build_workspace_knowledge_injection_prompt(
    workspace_context: Dict[str, Any],
    max_items: int = 80
) -> str:
    """构建当前 Workspace 绑定知识库索引，不注入知识正文。"""
    workspace_id = _workspace_context_text(workspace_context, "workspace_id")
    workspace_title = _workspace_context_text(workspace_context, "workspace_title") or "Workspace"
    documents = _workspace_knowledge_documents(workspace_context)

    if not workspace_id or not documents:
        return ""

    limit = max(1, min(200, int(max_items or 80)))
    rows: List[str] = []

    for item in documents[:limit]:
        title = _workspace_knowledge_field(item.get("title") or item.get("name"), 160)

        if not title:
            continue

        meta_parts: List[str] = []
        knowledge_type = _workspace_knowledge_field(item.get("knowledge_type") or item.get("type") or "basis", 32)
        basis_id = _workspace_knowledge_field(item.get("basis_id"), 80)
        added_by = _workspace_knowledge_field(item.get("added_by"), 80)
        visibility = _workspace_knowledge_field(item.get("visibility"), 32)
        updated_at = _workspace_knowledge_field(item.get("updated_at"), 64)

        if basis_id:
            meta_parts.append(f"basis_id={basis_id}")

        if knowledge_type:
            meta_parts.append(f"type={knowledge_type}")

        if added_by:
            meta_parts.append(f"added_by={added_by}")

        if visibility:
            meta_parts.append(f"visibility={visibility}")

        if item.get("pin") is True:
            meta_parts.append("pinned=true")

        if updated_at:
            meta_parts.append(f"updated_at={updated_at}")

        meta_text = f" ({'; '.join(meta_parts)})" if meta_parts else ""
        rows.append(f"- {title}{meta_text}")

    remaining = max(0, len(documents) - limit)

    if remaining > 0:
        rows.append(f"- ... 还有 {remaining} 条 Workspace 知识索引未列出。")

    if not rows:
        return ""

    block = workspace_knowledge_block_template.replace("{{workspace_id}}", workspace_id)
    block = block.replace("{{workspace_title}}", workspace_title)
    block = block.replace("{{knowledge_rows}}", "\n".join(rows))

    return f"{workspace_knowledge_injection_header}\n{block}\n"


def _workspace_resource_items(context: Any, key: str) -> List[Dict[str, Any]]:
    if not isinstance(context, dict):
        return []

    raw_items = context.get(key, [])

    if not isinstance(raw_items, list):
        return []

    return [item for item in raw_items if isinstance(item, dict)]


def _build_workspace_file_resource_rows(files: List[Dict[str, Any]], limit: int) -> List[str]:
    rows: List[str] = []

    for item in files[:limit]:
        file_ref = _workspace_knowledge_field(item.get("file_ref") or item.get("sandbox_path"), 260)

        if not file_ref:
            continue

        try:
            size = int(item.get("size") or 0)
        except Exception:
            size = 0

        rows.append(f"- file: {file_ref}; size={size}")

    return rows


def _build_workspace_task_resource_rows(tasks: List[Dict[str, Any]], limit: int) -> List[str]:
    rows: List[str] = []

    for item in tasks[:limit]:
        title = _workspace_knowledge_field(item.get("title"), 160)

        if not title:
            continue

        meta_parts: List[str] = []
        status = _workspace_knowledge_field(item.get("status"), 32)
        start_date = _workspace_knowledge_field(item.get("start_date"), 32)
        due_date = _workspace_knowledge_field(item.get("due_date"), 32)

        if status:
            meta_parts.append(f"status={status}")

        if start_date:
            meta_parts.append(f"from={start_date}")

        if due_date:
            meta_parts.append(f"to={due_date}")

        if meta_parts:
            rows.append(f"- task: {title}; {'; '.join(meta_parts)}")
        else:
            rows.append(f"- task: {title}")

    return rows


def build_workspace_resource_index_prompt(
    workspace_context: Dict[str, Any],
    max_files: int = 40,
    max_tasks: int = 40,
) -> str:
    """构建当前 Workspace 的文件与任务轻量索引，不注入正文。"""
    workspace_id = _workspace_context_text(workspace_context, "workspace_id")
    files = _workspace_resource_items(workspace_context, "workspace_files")
    tasks = _workspace_resource_items(workspace_context, "workspace_tasks")

    if not workspace_id or (not files and not tasks):
        return ""

    file_limit = max(1, min(100, int(max_files or 40)))
    task_limit = max(1, min(100, int(max_tasks or 40)))
    rows: List[str] = []
    file_rows = _build_workspace_file_resource_rows(files, file_limit)
    task_rows = _build_workspace_task_resource_rows(tasks, task_limit)

    if file_rows:
        rows.append("Files:")
        rows.extend(file_rows)
        remaining_files = max(0, len(files) - file_limit)

        if remaining_files > 0:
            rows.append(f"- ... 还有 {remaining_files} 个 Workspace 文件索引未列出。")

    if task_rows:
        if rows:
            rows.append("")

        rows.append("Tasks:")
        rows.extend(task_rows)
        remaining_tasks = max(0, len(tasks) - task_limit)

        if remaining_tasks > 0:
            rows.append(f"- ... 还有 {remaining_tasks} 个 Workspace 任务索引未列出。")

    if not rows:
        return ""

    block = workspace_resource_block_template.replace("{{resource_rows}}", "\n".join(rows))

    return f"{workspace_resource_injection_header}\n{block}\n"


def build_memory_write_policy_prompt(workspace_context: Dict[str, Any] = None) -> str:
    """构建透明记忆写入规则，避免模型静默写入记忆。"""
    return memory_write_policy_prompt_template.strip()


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
    blocks = [
        _render_xml_text_block("USER_PROFILE_MEMORY", profile_text),
        _render_xml_text_block("RECENT_DIALOGUE_SUMMARY", recent_dialogue),
        _render_xml_text_block("USER_KNOWLEDGE_INDEX", user_knowledge),
    ]
    profile_blocks = "\n\n".join([block for block in blocks if block]).strip()

    if not profile_blocks:
        return ""

    out = template.replace("{{profile_blocks}}", profile_blocks)
    return out.strip()


def build_context_compression_prompt(
    history_text: str,
    *,
    profile_text: str = "",
    recent_dialogue: str = "",
    max_chars: int = 6000
) -> str:
    limit = max(600, min(120000, int(max_chars or 6000)))
    auxiliary_blocks = [
        _render_xml_text_block("USER_PROFILE_MEMORY", profile_text),
        _render_xml_text_block("RECENT_DIALOGUE_SUMMARY", recent_dialogue),
    ]
    auxiliary_context = "\n\n".join([block for block in auxiliary_blocks if block]).strip()

    out = context_compression_prompt_template.replace("{{history_text}}", str(history_text or "").strip())
    out = out.replace("{{auxiliary_context_blocks}}", auxiliary_context)
    out = out.replace("{{max_chars}}", str(limit))
    return out


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

