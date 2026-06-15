"""课程思维导图（知识图谱）生成模块。

思维导图 Agent 作为 booksproc 多智能体体系的一员，基于课程大纲（outline.json）
生成课程级思维导图，并支持按 section 深挖生成更细的子树。

数据结构（JSON 树）：
    {
        "course_title": str,
        "chapters": [
            {
                "section_id": str,
                "name": str,
                "summary": str,
                "concepts": [
                    {
                        "name": str,
                        "detail": str,
                        "children": [ ... ]   # 最多 3 层
                    }
                ]
            }
        ]
    }

输出落盘到 data/lectures/{lecture_id}/solidified/mindmap.json。
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from ..runlog import log_event


_WRITE_LOCK = threading.Lock()


# ==================== 文件路径 ====================

def _mindmap_path(cfg: Mapping[str, Any], lecture_id: str) -> Path:
    """思维导图持久化路径：data/lectures/{lecture_id}/solidified/mindmap.json"""
    data_dir = Path(str(cfg.get("data_dir") or "data"))
    return data_dir / "lectures" / lecture_id / "solidified" / "mindmap.json"


def _write_json(path: Path, data: Any) -> None:
    """线程安全写入 JSON 文件。"""
    with _WRITE_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> Optional[Any]:
    """读取 JSON 文件，不存在或损坏返回 None。"""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


# ==================== JSON / 工具参数解析 ====================

def _safe_json_obj(raw: str) -> Dict[str, Any]:
    """安全解析 JSON 字符串为字典，失败返回空字典。"""
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _safe_json_dumps(obj: Any) -> str:
    """安全序列化对象为 JSON 字符串，失败返回 '{}'。"""
    try:
        return json.dumps(obj, ensure_ascii=False)
    except Exception:
        return "{}"


# ==================== Outline 摘要构建 ====================

def _build_outline_summary(outline: Mapping[str, Any]) -> str:
    """从 outline.json 构建 sections 摘要文本，作为思维导图 Agent 的输入。"""
    sections = outline.get("sections") if isinstance(outline, dict) else None
    if not isinstance(sections, list) or not sections:
        return "（暂无大纲内容）"

    lines: List[str] = []
    for idx, section in enumerate(sections):
        if not isinstance(section, dict):
            continue

        section_id = str(section.get("id") or f"sec_{idx + 1:03d}").strip()
        title = str(section.get("title") or "").strip()
        summary = str(section.get("summary") or "").strip()
        difficulty = str(section.get("difficulty") or "").strip()
        key_concepts = section.get("key_concepts") if isinstance(section.get("key_concepts"), list) else []
        objectives = section.get("objectives") if isinstance(section.get("objectives"), list) else []

        if not title:
            continue

        block_lines = [f"[{section_id}] {title}"]
        if summary:
            block_lines.append(f"  概述：{summary}")
        if difficulty:
            block_lines.append(f"  难度：{difficulty}")
        if key_concepts:
            concepts_text = "、".join(str(c).strip() for c in key_concepts if str(c).strip())
            block_lines.append(f"  核心概念：{concepts_text}")
        if objectives:
            for obj in objectives[:3]:
                block_lines.append(f"  - 目标：{str(obj).strip()}")

        lines.append("\n".join(block_lines))

    return "\n\n".join(lines) if lines else "（暂无大纲内容）"


def _build_profile_summary(cfg: Mapping[str, Any], user_id: str) -> str:
    """构建用户画像摘要，注入到思维导图 prompt（可选）。"""
    if not user_id:
        return ""

    try:
        from core.user.user import read_memory

        profile_content = read_memory(cfg, user_id, "user")
        if not profile_content:
            return ""
        return str(profile_content)[:1500]
    except Exception:
        return ""


# ==================== Prompt 渲染 ====================

def _render_course_mindmap_prompt(
    *,
    lecture_title: str,
    outline_summary: str,
    profile_summary: str = "",
) -> str:
    """渲染课程级思维导图 prompt。"""
    try:
        from NexoraLearning.prompts import KNOWLEDGE_GRAPH_PROMPT
    except ImportError:
        from prompts import KNOWLEDGE_GRAPH_PROMPT

    profile_section = ""
    if profile_summary:
        profile_section = f"""## 用户画像
以下是学生的学习画像，请据此调整知识点的深度和侧重点：
{profile_summary}"""

    values = {
        "lecture_title": str(lecture_title or ""),
        "outline_summary": str(outline_summary or "")[:12000],
        "profile_section": profile_section,
    }

    prompt = str(KNOWLEDGE_GRAPH_PROMPT or "")
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)

    return prompt


def _render_section_mindmap_prompt(
    *,
    lecture_title: str,
    section_id: str,
    section_title: str,
    section_summary: str,
    section_key_concepts: List[str],
    section_objectives: List[str],
    section_sources: str,
) -> str:
    """渲染 section 级思维导图 prompt。"""
    try:
        from NexoraLearning.prompts import SECTION_MINDMAP_PROMPT
    except ImportError:
        from prompts import SECTION_MINDMAP_PROMPT

    values = {
        "lecture_title": str(lecture_title or ""),
        "section_id": str(section_id or ""),
        "section_title": str(section_title or ""),
        "section_summary": str(section_summary or ""),
        "section_key_concepts": "、".join(str(c).strip() for c in section_key_concepts if str(c).strip()) or "（无）",
        "section_objectives": "\n".join(f"- {str(o).strip()}" for o in section_objectives if str(o).strip()) or "（无）",
        "section_sources": str(section_sources or "")[:6000],
    }

    prompt = str(SECTION_MINDMAP_PROMPT or "")
    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)

    return prompt


# ==================== 工具定义 ====================

def _build_mindmap_tools() -> List[Dict[str, Any]]:
    """构建 submit_mindmap 工具定义。"""
    return [
        {
            "type": "function",
            "function": {
                "name": "submit_mindmap",
                "description": "Submit the knowledge graph mindmap. Call this tool to submit the chapter/concept tree.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "course_title": {
                            "type": "string",
                            "description": "Course or section title",
                        },
                        "chapters": {
                            "type": "array",
                            "description": "Learning units (chapters/sections)",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "section_id": {
                                        "type": "string",
                                        "description": "Section id from outline",
                                    },
                                    "name": {
                                        "type": "string",
                                        "description": "Unit name",
                                    },
                                    "summary": {
                                        "type": "string",
                                        "description": "Unit summary",
                                    },
                                    "concepts": {
                                        "type": "array",
                                        "description": "3-6 core concepts",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "name": {
                                                    "type": "string",
                                                    "description": "Concept short title",
                                                },
                                                "detail": {
                                                    "type": "string",
                                                    "description": "One-sentence explanation",
                                                },
                                                "children": {
                                                    "type": "array",
                                                    "description": "Sub-concepts (same structure, max 3 levels)",
                                                    "items": {
                                                        "type": "object",
                                                        "properties": {
                                                            "name": {"type": "string"},
                                                            "detail": {"type": "string"},
                                                            "children": {"type": "array"},
                                                        },
                                                        "required": ["name", "detail"],
                                                    },
                                                },
                                            },
                                            "required": ["name", "detail"],
                                        },
                                    },
                                },
                                "required": ["name", "concepts"],
                            },
                        },
                    },
                    "required": ["course_title", "chapters"],
                },
            },
        }
    ]


# ==================== 结果规范化 ====================

def _normalize_concept(raw: Any, depth: int = 0) -> Optional[Dict[str, Any]]:
    """规范化单个知识点，递归处理 children，限制最大深度 3 层。"""
    if not isinstance(raw, dict):
        return None

    name = str(raw.get("name") or "").strip()
    detail = str(raw.get("detail") or "").strip()

    if not name:
        return None

    node: Dict[str, Any] = {
        "name": name[:60],
        "detail": detail[:200],
    }

    # 递归处理 children，深度限制 3 层（depth 从 0 开始）
    if depth < 2:
        raw_children = raw.get("children")
        if isinstance(raw_children, list) and raw_children:
            children: List[Dict[str, Any]] = []
            for child in raw_children:
                normalized = _normalize_concept(child, depth + 1)
                if normalized:
                    children.append(normalized)
            if children:
                node["children"] = children

    return node


def _normalize_chapter(raw: Any) -> Optional[Dict[str, Any]]:
    """规范化单个章节（学习单元）。"""
    if not isinstance(raw, dict):
        return None

    name = str(raw.get("name") or raw.get("title") or "").strip()
    if not name:
        return None

    section_id = str(raw.get("section_id") or "").strip()
    summary = str(raw.get("summary") or "").strip()

    raw_concepts = raw.get("concepts")
    if not isinstance(raw_concepts, list):
        return None

    concepts: List[Dict[str, Any]] = []
    for concept in raw_concepts:
        normalized = _normalize_concept(concept, depth=0)
        if normalized:
            concepts.append(normalized)

    if not concepts:
        return None

    return {
        "section_id": section_id[:40],
        "name": name[:80],
        "summary": summary[:300],
        "concepts": concepts[:8],   # 每章最多保留 8 个知识点
    }


def _normalize_mindmap(mindmap_data: Dict[str, Any]) -> Dict[str, Any]:
    """规范化 submit_mindmap 返回的完整思维导图结构。"""
    raw_chapters = mindmap_data.get("chapters")
    if not isinstance(raw_chapters, list):
        raise ValueError("模型未返回有效的 chapters 数组")

    chapters: List[Dict[str, Any]] = []
    for raw in raw_chapters:
        normalized = _normalize_chapter(raw)
        if normalized:
            chapters.append(normalized)

    if not chapters:
        raise ValueError("模型未返回有效的章节知识点")

    return {
        "course_title": str(mindmap_data.get("course_title") or "").strip()[:120],
        "chapters": chapters,
    }


# ==================== 核心生成函数 ====================

def _run_mindmap_agent(
    *,
    system_prompt: str,
    user_prompt: str,
    runner: Any,
    settings: Mapping[str, Any],
    stream: bool,
    on_delta: Optional[Callable[[str], None]],
    log_scope: str,
) -> Dict[str, Any]:
    """思维导图 Agent 的工具调用主循环。

    多轮重试直到模型调用 submit_mindmap 工具，最多 4 轮。
    返回规范化后的思维导图字典。
    """
    tools = _build_mindmap_tools()
    proxy = runner.nexora_client.proxy
    model_name = runner.model_name

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    turn_history: List[Dict[str, Any]] = []
    mindmap_submitted = False
    result_mindmap: Dict[str, Any] = {}

    def emit_stream_text(delta_text: str) -> None:
        piece = str(delta_text or "")
        if not piece or not bool(stream) or not callable(on_delta):
            return
        on_delta(piece)

    for turn in range(1, 5):
        request_messages = list(messages) + turn_history
        round_deltas: List[str] = []

        def _on_round_delta(delta_text: str) -> None:
            piece = str(delta_text or "")
            if not piece:
                return
            round_deltas.append(piece)
            emit_stream_text(piece)

        emit_stream_text(f"\n[{log_scope} 第 {turn} 轮] 模型开始输出...\n")

        response = proxy.chat_completions(
            messages=request_messages,
            model=model_name or None,
            options={
                "temperature": float(settings.get("temperature") or 0.3),
                "max_tokens": int(settings.get("max_output_tokens") or 6000),
                "stream": bool(stream),
                "tools": tools,
                "tool_choice": "auto",
            },
            use_chat_path=False,
            request_timeout=float(settings.get("request_timeout") or 300),
            on_delta=_on_round_delta,
        )

        if not bool(response.get("ok")):
            raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")

        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        if not choices:
            raise RuntimeError("Model returned no choices")

        msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
        content = str((msg or {}).get("content") or "")

        log_event(
            f"{log_scope}_round",
            f"{log_scope} 轮次响应",
            payload={
                "turn": turn,
                "tool_calls": len((msg or {}).get("tool_calls") or []) if isinstance((msg or {}).get("tool_calls"), list) else 0,
                "content_len": len(content or "".join(round_deltas)),
            },
            content=(content or "".join(round_deltas))[:2400],
        )

        # 解析工具调用
        raw_tool_calls = (msg or {}).get("tool_calls") if isinstance((msg or {}).get("tool_calls"), list) else []
        tool_calls: List[Dict[str, Any]] = []
        streamed_text = "".join(round_deltas)

        for raw_call in raw_tool_calls:
            if not isinstance(raw_call, dict):
                continue

            raw_func = raw_call.get("function") if isinstance(raw_call.get("function"), dict) else {}
            normalized_name = str(raw_func.get("name") or "").strip()
            raw_arguments = str(raw_func.get("arguments") or "")

            if raw_arguments and raw_arguments not in streamed_text:
                emit_stream_text(f"\n[Tool Call] {normalized_name or 'unknown'}\n{raw_arguments}\n")

            normalized_args_obj = _safe_json_obj(str(raw_func.get("arguments") or "{}"))
            tool_calls.append({
                "id": str(raw_call.get("id") or ""),
                "type": "function",
                "function": {
                    "name": normalized_name,
                    "arguments": _safe_json_dumps(normalized_args_obj),
                },
            })

        turn_history.append({
            "role": "assistant",
            "content": content if content else None,
            "tool_calls": tool_calls if tool_calls else None,
        })

        # 未调用工具则要求重试
        if not tool_calls:
            turn_history.append({
                "role": "user",
                "content": "You must call submit_mindmap(course_title=..., chapters=[...]) to submit. Do not output plain text JSON.",
            })
            continue

        # 处理工具调用
        for call in tool_calls:
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            args_obj = _safe_json_obj(str(func.get("arguments") or "{}"))
            call_id = str(call.get("id") or "")

            if tool_name == "submit_mindmap":
                try:
                    result_mindmap = _normalize_mindmap(args_obj)
                    mindmap_submitted = True
                    turn_history.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": _safe_json_dumps({
                            "ok": True,
                            "chapters_count": len(result_mindmap.get("chapters") or []),
                        }),
                    })
                except Exception as exc:
                    turn_history.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": _safe_json_dumps({"ok": False, "error": str(exc)}),
                    })
            else:
                turn_history.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": _safe_json_dumps({"ok": False, "error": f"Unknown tool: {tool_name}"}),
                })

        if mindmap_submitted:
            break

    if not mindmap_submitted or not result_mindmap:
        raise RuntimeError("Model failed to submit mindmap via tool call after multiple attempts")

    return result_mindmap


def generate_mindmap(
    cfg: Mapping[str, Any],
    lecture_id: str,
    *,
    user_id: str = "",
    on_status: Optional[Callable[[str], None]] = None,
    on_delta: Optional[Callable[[str], None]] = None,
    stream: bool = False,
) -> Dict[str, Any]:
    """生成课程级思维导图（基于已有 outline.json）。

    Args:
        cfg: 配置字典
        lecture_id: 课程 id
        user_id: 用户 id（可选，用于注入画像）
        on_status: 状态回调
        on_delta: 流式输出回调
        stream: 是否流式

    Returns:
        规范化后的思维导图字典
    """
    from .outline import load_outline
    from .modeling import build_mindmap_runner, get_mindmap_settings
    from ..lectures import get_lecture

    safe_lecture_id = str(lecture_id or "").strip()
    if not safe_lecture_id:
        raise ValueError("lecture_id is required.")

    def emit_status(message: str) -> None:
        if callable(on_status):
            try:
                on_status(str(message or "").strip())
            except Exception:
                pass

    def emit_delta(delta_text: str) -> None:
        if callable(on_delta):
            try:
                on_delta(str(delta_text or ""))
            except Exception:
                pass

    # 校验课程
    lecture = get_lecture(cfg, safe_lecture_id)
    if lecture is None:
        raise ValueError(f"Lecture not found: {safe_lecture_id}")

    lecture_title = str(lecture.get("title") or "").strip()
    emit_status("已读取课程信息")

    # 加载大纲
    outline = load_outline(cfg, safe_lecture_id)
    if not outline or not isinstance(outline.get("sections"), list):
        raise ValueError("课程大纲尚未生成，请先生成大纲")

    outline_summary = _build_outline_summary(outline)
    profile_summary = _build_profile_summary(cfg, user_id)
    emit_status("已加载课程大纲与用户画像")

    # 构建 prompt
    system_prompt = _render_course_mindmap_prompt(
        lecture_title=lecture_title,
        outline_summary=outline_summary,
        profile_summary=profile_summary,
    )
    user_prompt = "请根据课程大纲生成课程级思维导图，使用 submit_mindmap 工具提交。"

    log_event(
        "mindmap_start",
        "课程级思维导图生成开始",
        payload={
            "lecture_id": safe_lecture_id,
            "lecture_title": lecture_title,
            "sections_count": len(outline.get("sections") or []),
            "outline_summary_chars": len(outline_summary),
        },
    )
    emit_status("已构建思维导图提示词，准备调用模型")

    # 调用 Agent
    settings = get_mindmap_settings(cfg)
    runner = build_mindmap_runner(cfg)

    result_mindmap = _run_mindmap_agent(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        runner=runner,
        settings=settings,
        stream=stream,
        on_delta=emit_delta,
        log_scope="mindmap",
    )

    # 补充元数据并落盘
    result_mindmap["lecture_id"] = safe_lecture_id
    result_mindmap["lecture_title"] = lecture_title
    result_mindmap["generated_at"] = __import__("time").time()

    _save_mindmap(cfg, safe_lecture_id, result_mindmap)
    emit_status("思维导图已生成并保存")

    log_event(
        "mindmap_done",
        "课程级思维导图生成完成",
        payload={
            "lecture_id": safe_lecture_id,
            "chapters_count": len(result_mindmap.get("chapters") or []),
        },
    )

    return result_mindmap


def generate_section_mindmap(
    cfg: Mapping[str, Any],
    lecture_id: str,
    section_id: str,
    *,
    on_status: Optional[Callable[[str], None]] = None,
    on_delta: Optional[Callable[[str], None]] = None,
    stream: bool = False,
) -> Dict[str, Any]:
    """生成指定 section 的详细思维导图子树。

    基于 outline 中该 section 的 key_concepts/objectives/sources 生成更细的知识点树。
    Section 级结果不单独持久化，每次按需生成。
    """
    from .outline import load_outline
    from .modeling import build_mindmap_runner, get_mindmap_settings
    from ..lectures import get_lecture

    safe_lecture_id = str(lecture_id or "").strip()
    safe_section_id = str(section_id or "").strip()

    if not safe_lecture_id or not safe_section_id:
        raise ValueError("lecture_id and section_id are required.")

    def emit_status(message: str) -> None:
        if callable(on_status):
            try:
                on_status(str(message or "").strip())
            except Exception:
                pass

    def emit_delta(delta_text: str) -> None:
        if callable(on_delta):
            try:
                on_delta(str(delta_text or ""))
            except Exception:
                pass

    lecture = get_lecture(cfg, safe_lecture_id)
    if lecture is None:
        raise ValueError(f"Lecture not found: {safe_lecture_id}")

    lecture_title = str(lecture.get("title") or "").strip()

    outline = load_outline(cfg, safe_lecture_id)
    if not outline:
        raise ValueError("课程大纲尚未生成")

    sections = outline.get("sections") if isinstance(outline.get("sections"), list) else []
    target_section: Optional[Dict[str, Any]] = None

    for section in sections:
        if isinstance(section, dict) and str(section.get("id") or "").strip() == safe_section_id:
            target_section = section
            break

    if target_section is None:
        raise ValueError(f"Section not found in outline: {safe_section_id}")

    section_title = str(target_section.get("title") or "").strip()
    section_summary = str(target_section.get("summary") or "").strip()
    section_key_concepts = target_section.get("key_concepts") if isinstance(target_section.get("key_concepts"), list) else []
    section_objectives = target_section.get("objectives") if isinstance(target_section.get("objectives"), list) else []

    # 构建 sources 文本
    sources = target_section.get("sources") if isinstance(target_section.get("sources"), list) else []
    sources_lines: List[str] = []
    for src in sources:
        if not isinstance(src, dict):
            continue
        book_title = str(src.get("book_title") or "").strip()
        chapter_name = str(src.get("chapter_name") or "").strip()
        chapter_summary = str(src.get("chapter_summary") or "").strip()
        if book_title or chapter_name:
            line = f"- 《{book_title}》{chapter_name}"
            if chapter_summary:
                line += f"：{chapter_summary}"
            sources_lines.append(line)
    section_sources = "\n".join(sources_lines) or "（无来源章节摘要）"

    emit_status(f"已加载学习单元：{section_title}")

    system_prompt = _render_section_mindmap_prompt(
        lecture_title=lecture_title,
        section_id=safe_section_id,
        section_title=section_title,
        section_summary=section_summary,
        section_key_concepts=section_key_concepts,
        section_objectives=section_objectives,
        section_sources=section_sources,
    )
    user_prompt = f"请为学习单元「{section_title}」生成详细思维导图，使用 submit_mindmap 工具提交。"

    log_event(
        "section_mindmap_start",
        "Section 级思维导图生成开始",
        payload={
            "lecture_id": safe_lecture_id,
            "section_id": safe_section_id,
            "section_title": section_title,
        },
    )
    emit_status("已构建 section 提示词，准备调用模型")

    settings = get_mindmap_settings(cfg)
    runner = build_mindmap_runner(cfg)

    result_mindmap = _run_mindmap_agent(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        runner=runner,
        settings=settings,
        stream=stream,
        on_delta=emit_delta,
        log_scope="section_mindmap",
    )

    # 补充元数据
    result_mindmap["lecture_id"] = safe_lecture_id
    result_mindmap["section_id"] = safe_section_id
    result_mindmap["section_title"] = section_title
    result_mindmap["generated_at"] = __import__("time").time()

    log_event(
        "section_mindmap_done",
        "Section 级思维导图生成完成",
        payload={
            "lecture_id": safe_lecture_id,
            "section_id": safe_section_id,
            "chapters_count": len(result_mindmap.get("chapters") or []),
        },
    )

    return result_mindmap


# ==================== 持久化 ====================

def _save_mindmap(cfg: Mapping[str, Any], lecture_id: str, mindmap: Dict[str, Any]) -> None:
    """保存课程级思维导图到文件。"""
    _write_json(_mindmap_path(cfg, lecture_id), mindmap)


def load_mindmap(cfg: Mapping[str, Any], lecture_id: str) -> Optional[Dict[str, Any]]:
    """读取已生成的课程级思维导图，不存在返回 None。"""
    return _read_json(_mindmap_path(cfg, lecture_id))
