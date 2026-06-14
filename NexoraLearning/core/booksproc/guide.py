"""Reader guide generation for NexoraLearning.

使用工具调用模式生成导读，避免 JSON 解析错误。
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Mapping, Optional


def _safe_json_obj(raw: str) -> Dict[str, Any]:
    """安全解析 JSON 字符串为字典。"""
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _safe_json_dumps(obj: Any) -> str:
    """安全序列化对象为 JSON 字符串。"""
    try:
        return json.dumps(obj, ensure_ascii=False)
    except Exception:
        return "{}"


def _strip_json_fence(content: str) -> str:
    text = str(content or "").strip()
    fenced = re.search(r"```json\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)

    if fenced:
        return str(fenced.group(1) or "").strip()

    return text


def _parse_json_object(content: str) -> Dict[str, Any]:
    text = _strip_json_fence(content)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)

        if not match:
            raise ValueError("模型未返回 JSON 对象")

        parsed = json.loads(match.group(0))

    if not isinstance(parsed, dict):
        raise ValueError("模型返回内容不是 JSON 对象")

    return parsed


def _normalize_list(value: Any, limit: int) -> List[str]:
    rows: List[str] = []
    items = value if isinstance(value, list) else []

    for item in items:
        text = str(item or "").strip()

        if text:
            rows.append(text[:limit])

    return rows


def _normalize_patch(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {"paragraph": "", "keywords": [], "note": ""}

    paragraph = str(value.get("paragraph") or value.get("text") or value.get("quote") or "").strip()
    keywords = _normalize_list(value.get("keywords"), 40)
    keyword = str(value.get("keyword") or "").strip()

    if keyword and keyword not in keywords:
        keywords.append(keyword[:40])

    return {
        "paragraph": paragraph[:260],
        "keywords": keywords[:3],
        "note": str(value.get("note") or "").strip()[:160],
    }


def _normalize_guide_cards(value: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    items = value if isinstance(value, list) else []

    for item in items:
        if not isinstance(item, dict):
            continue

        stage = str(item.get("stage") or "").strip()
        title = str(item.get("title") or "").strip()
        guidance = str(item.get("guidance") or "").strip()
        anchor = str(item.get("anchor") or "").strip()
        question = str(item.get("question") or "").strip()
        reason = str(item.get("reason") or "").strip()
        patch = _normalize_patch(item.get("patch"))

        if not title or not guidance:
            continue

        rows.append(
            {
                "stage": stage[:24],
                "title": title[:80],
                "guidance": guidance[:420],
                "anchor": anchor[:180],
                "question": question[:260],
                "reason": reason[:260],
                "patch": patch,
            }
        )

    return rows


def _normalize_reader_guide(guide_data: Dict[str, Any]) -> Dict[str, Any]:
    """规范化导读数据（从工具调用参数）。"""
    cards = _normalize_guide_cards(guide_data.get("guide_cards"))

    if not cards:
        raise ValueError("模型未返回有效导读卡")

    return {
        "overview": str(guide_data.get("overview") or "").strip()[:500],
        "reading_strategy": str(guide_data.get("reading_strategy") or "").strip()[:360],
        "focus_points": _normalize_list(guide_data.get("focus_points"), 120),
        "guide_cards": cards[:6],
        "questions": cards[:6],
    }


def _normalize_pre_reading_questions(questions_data: List[Any]) -> List[Dict[str, Any]]:
    """规范化阅读前问题数据（从工具调用参数）。"""
    result = []
    for q in questions_data:
        if not isinstance(q, dict):
            continue

        options = []
        for opt in (q.get("options") or []):
            if isinstance(opt, dict):
                options.append({
                    "id": str(opt.get("id") or "").strip(),
                    "text": str(opt.get("text") or "").strip(),
                })

        result.append({
            "id": str(q.get("id") or "").strip(),
            "type": str(q.get("type") or "").strip(),
            "title": str(q.get("title") or "").strip(),
            "options": options,
        })

    return result


def _render_reader_guide_prompt(
    *,
    lecture_title: str,
    book_title: str,
    chapter_name: str,
    session_name: str,
    guide_context: str,
    user_profile: str = "",
    pre_reading_answers: Optional[Dict[str, Any]] = None,
) -> str:
    """渲染导读提示词，提示词正文统一维护在 prompts.py。"""
    try:
        from NexoraLearning.prompts import READER_GUIDE_PROMPT
    except ImportError:
        from prompts import READER_GUIDE_PROMPT

    safe_session_name = str(session_name or "").strip() or "整章导读"

    # 构建用户画像注入段
    user_profile_section = ""
    if user_profile:
        user_profile_section = f"""## 用户画像
以下是学生的学习画像，请根据其背景和偏好调整导读的重点和深度：
{user_profile[:1500]}"""

    # 构建阅读前回答注入段
    pre_reading_answers_section = ""
    if pre_reading_answers and isinstance(pre_reading_answers, dict):
        answers = pre_reading_answers.get("answers", {})
        skipped = pre_reading_answers.get("skipped", False)

        if skipped:
            pre_reading_answers_section = """## 阅读前问答
学生跳过了阅读前问答，请根据用户画像自动生成个性化导读。"""
        elif answers:
            answer_lines = []
            for q_id, answer in answers.items():
                if isinstance(answer, dict):
                    question_title = str(answer.get("question_title") or "").strip()
                    answer_text = str(answer.get("answer_text") or "").strip()
                    if question_title and answer_text:
                        answer_lines.append(f"- {question_title}：{answer_text}")

            if answer_lines:
                pre_reading_answers_section = f"""## 阅读前问答
以下是学生在阅读前的自我评估，请据此调整导读的深度和侧重点：
{chr(10).join(answer_lines)}"""

    values = {
        "lecture_title": str(lecture_title or ""),
        "book_title": str(book_title or ""),
        "chapter_name": str(chapter_name or ""),
        "session_name": safe_session_name,
        "guide_context": str(guide_context or "")[:9000],
        "user_profile_section": user_profile_section,
        "pre_reading_answers_section": pre_reading_answers_section,
    }
    prompt = str(READER_GUIDE_PROMPT or "")

    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)

    return prompt


def _build_guide_tools() -> List[Dict[str, Any]]:
    """构建导读工具定义。"""
    return [
        {
            "type": "function",
            "function": {
                "name": "submit_guide",
                "description": "Submit the reader guide. Call this tool to submit the generated guide cards.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "overview": {
                            "type": "string",
                            "description": "One sentence describing the core reading objective"
                        },
                        "reading_strategy": {
                            "type": "string",
                            "description": "Specific reading strategy"
                        },
                        "focus_points": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "3-5 short labels for key points"
                        },
                        "guide_cards": {
                            "type": "array",
                            "description": "4-6 reading guide cards",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "stage": {
                                        "type": "string",
                                        "enum": ["进入前", "阅读中", "回顾"],
                                        "description": "Reading stage"
                                    },
                                    "title": {
                                        "type": "string",
                                        "description": "Card title (not a question)"
                                    },
                                    "guidance": {
                                        "type": "string",
                                        "description": "Main guidance content"
                                    },
                                    "anchor": {
                                        "type": "string",
                                        "description": "Keywords or paragraph clues"
                                    },
                                    "question": {
                                        "type": "string",
                                        "description": "One follow-up question at the end"
                                    },
                                    "reason": {
                                        "type": "string",
                                        "description": "Why this reading approach is recommended"
                                    },
                                    "patch": {
                                        "type": "object",
                                        "properties": {
                                            "paragraph": {
                                                "type": "string",
                                                "description": "A short continuous fragment from the original text"
                                            },
                                            "keywords": {
                                                "type": "array",
                                                "items": {"type": "string"},
                                                "description": "1-3 keywords from the original text"
                                            },
                                            "note": {
                                                "type": "string",
                                                "description": "Why this location is worth marking"
                                            }
                                        },
                                        "required": ["paragraph", "keywords"]
                                    }
                                },
                                "required": ["stage", "title", "guidance", "patch"]
                            }
                        }
                    },
                    "required": ["overview", "guide_cards"]
                }
            }
        }
    ]


def _build_pre_reading_tools() -> List[Dict[str, Any]]:
    """构建阅读前问题工具定义。"""
    return [
        {
            "type": "function",
            "function": {
                "name": "submit_questions",
                "description": "Submit pre-reading questions. Call this tool to submit the generated questions.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "questions": {
                            "type": "array",
                            "description": "2-3 pre-reading questions",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "string", "description": "Question ID"},
                                    "type": {
                                        "type": "string",
                                        "enum": ["knowledge_level", "learning_goal", "learning_style"],
                                        "description": "Question type"
                                    },
                                    "title": {"type": "string", "description": "Question title"},
                                    "options": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "id": {"type": "string"},
                                                "text": {"type": "string"}
                                            },
                                            "required": ["id", "text"]
                                        },
                                        "description": "3-4 options"
                                    }
                                },
                                "required": ["id", "type", "title", "options"]
                            }
                        }
                    },
                    "required": ["questions"]
                }
            }
        }
    ]


def generate_pre_reading_questions(
    cfg: Mapping[str, Any],
    *,
    lecture_id: str,
    book_id: str,
    chapter_name: str,
    session_name: str,
    guide_context: str,
    stream: bool = False,
    on_delta: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Generate pre-reading questions using tool calls."""
    from .modeling import build_pre_reading_question_runner
    from .modeling import get_pre_reading_question_settings
    from ..lectures import get_book
    from ..lectures import get_lecture
    from ..lectures import list_books
    from ..runlog import log_event

    try:
        from NexoraLearning.prompts import PRE_READING_QUESTIONS_PROMPT
    except ImportError:
        from prompts import PRE_READING_QUESTIONS_PROMPT

    resolved_cfg = dict(cfg or {})
    safe_lecture_id = str(lecture_id or "").strip()
    safe_book_id = str(book_id or "").strip()
    safe_context = str(guide_context or "").strip()
    scope = "course" if not safe_book_id else "book"

    if not safe_lecture_id:
        raise ValueError("lecture_id is required.")

    if not safe_context:
        raise ValueError("guide_context is required.")

    log_event(
        "pre_reading_questions_start",
        "阅读前问答生成开始",
        payload={
            "lecture_id": safe_lecture_id,
            "book_id": safe_book_id,
            "chapter_name": str(chapter_name or ""),
            "session_name": str(session_name or ""),
            "scope": scope,
        },
    )

    lecture = get_lecture(resolved_cfg, safe_lecture_id)
    if lecture is None:
        raise ValueError(f"Lecture not found: {safe_lecture_id}")

    book = None
    course_books: List[Dict[str, Any]] = []
    if safe_book_id:
        book = get_book(resolved_cfg, safe_lecture_id, safe_book_id)
        if book is None:
            raise ValueError(f"Book not found: {safe_lecture_id}/{safe_book_id}")
    else:
        course_books = list_books(resolved_cfg, safe_lecture_id) or []

    settings = get_pre_reading_question_settings(resolved_cfg)
    runner = build_pre_reading_question_runner(resolved_cfg)

    safe_session_name = str(session_name or "").strip() or "整章导读"
    system_prompt = str(PRE_READING_QUESTIONS_PROMPT or "")
    course_book_titles = [
        str((row or {}).get("title") or (row or {}).get("id") or "").strip()
        for row in course_books[:6]
        if isinstance(row, dict)
    ]
    book_title = (
        str((book or {}).get("title") or "").strip()
        or "、".join([title for title in course_book_titles if title])
        or "课程整体"
    )
    values = {
        "lecture_title": str(lecture.get("title") or ""),
        "book_title": book_title,
        "chapter_name": str(chapter_name or ""),
        "session_name": safe_session_name,
        "guide_context": safe_context[:9000],
    }

    for key, value in values.items():
        system_prompt = system_prompt.replace("{{" + key + "}}", value)

    log_event(
        "pre_reading_questions_context",
        "阅读前问答上下文已注入",
        payload={
            "lecture_id": safe_lecture_id,
            "book_id": safe_book_id,
            "book_title": book_title,
            "chapter_name": str(chapter_name or ""),
            "session_name": safe_session_name,
            "scope": scope,
            "guide_context_chars": len(safe_context),
            "system_prompt_chars": len(system_prompt),
        },
        content=safe_context[:1600],
    )

    if scope == "course":
        user_prompt = (
            "请根据系统提示里的课程信息、教材清单、课程大纲和教材内容摘录生成阅读前问题，"
            "使用 submit_questions 工具提交。问题必须帮助学生进入这门课和这些教材的核心内容，"
            "选项要直接关联课程主题、教材主题、关键人物、关键概念或主要矛盾。"
            "不要把“课程整体导读”“阅读前内容定位”“学习路线规划”本身当作被学习的主题，"
            "不要生成只询问学习规划方法、学习效率或泛泛学习方式的问题。"
        )
    else:
        user_prompt = "请根据章节内容生成阅读前问题，使用 submit_questions 工具提交。"

    # 工具调用模式
    tools = _build_pre_reading_tools()
    proxy = runner.nexora_client.proxy
    model_name = runner.model_name

    def emit_stream_text(delta_text: str) -> None:
        piece = str(delta_text or "")

        if not piece or not bool(stream) or not callable(on_delta):
            return

        on_delta(piece)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    turn_history: List[Dict[str, Any]] = []
    questions_submitted = False
    result_questions: List[Dict[str, Any]] = []

    emit_stream_text("已构建阅读前问答上下文，正在请求模型生成问题...\n")

    for turn in range(1, 4):
        request_messages = list(messages) + turn_history
        round_deltas: List[str] = []

        def _on_round_delta(delta_text: str) -> None:
            piece = str(delta_text or "")
            if not piece:
                return
            round_deltas.append(piece)
            emit_stream_text(piece)

        emit_stream_text(f"\n[阅读前问答第 {turn} 轮] 模型开始输出...\n")

        response = proxy.chat_completions(
            messages=request_messages,
            model=model_name or None,
            options={
                "temperature": float(settings.get("temperature") or 0.3),
                "max_tokens": 1000,
                "stream": bool(stream),
                "tools": tools,
                "tool_choice": "auto",
            },
            use_chat_path=False,
            request_timeout=float(settings.get("request_timeout") or 120),
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
            "pre_reading_questions_round",
            "阅读前问答轮次响应",
            payload={
                "lecture_id": safe_lecture_id,
                "book_id": safe_book_id,
                "chapter_name": str(chapter_name or ""),
                "session_name": str(session_name or ""),
                "turn": turn,
                "tool_calls": len((msg or {}).get("tool_calls") or []) if isinstance((msg or {}).get("tool_calls"), list) else 0,
                "content_len": len(content or "".join(round_deltas)),
            },
            content=(content or "".join(round_deltas))[:2400],
        )

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

        if not tool_calls:
            turn_history.append({
                "role": "user",
                "content": "You must call submit_questions(questions=[...]) to submit. Do not output plain text JSON.",
            })
            continue

        for call in tool_calls:
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            args_obj = _safe_json_obj(str(func.get("arguments") or "{}"))
            call_id = str(call.get("id") or "")

            if tool_name == "submit_questions":
                raw_questions = args_obj.get("questions")
                if isinstance(raw_questions, list):
                    result_questions = _normalize_pre_reading_questions(raw_questions)
                    if result_questions:
                        questions_submitted = True
                        turn_history.append({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": _safe_json_dumps({"ok": True, "count": len(result_questions)}),
                        })
                    else:
                        turn_history.append({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": _safe_json_dumps({"ok": False, "error": "No valid questions."}),
                        })
            else:
                turn_history.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": _safe_json_dumps({"ok": False, "error": f"Unknown tool: {tool_name}"}),
                })

        if questions_submitted:
            break

    if not questions_submitted or not result_questions:
        raise RuntimeError("Model failed to submit questions via tool call")

    log_event(
        "pre_reading_questions_done",
        "阅读前问答生成完成",
        payload={
            "lecture_id": safe_lecture_id,
            "book_id": safe_book_id,
            "chapter_name": str(chapter_name or ""),
            "session_name": str(session_name or ""),
            "scope": scope,
            "questions_count": len(result_questions),
        },
    )

    return {
        "questions": result_questions,
        "model_name": str(runner.model_name or ""),
        "chapter_name": str(chapter_name or ""),
        "session_name": str(session_name or ""),
    }


def generate_reader_guide(
    cfg: Mapping[str, Any],
    *,
    lecture_id: str,
    book_id: str,
    chapter_name: str,
    session_name: str,
    guide_context: str,
    stream: bool = False,
    on_delta: Optional[Callable[[str], None]] = None,
    user_profile: str = "",
    pre_reading_answers: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Generate reader guide using tool calls."""
    from .modeling import build_question_generation_runner
    from .modeling import get_question_generation_settings
    from ..lectures import get_book
    from ..lectures import get_lecture
    from ..runlog import log_event

    resolved_cfg = dict(cfg or {})
    safe_lecture_id = str(lecture_id or "").strip()
    safe_book_id = str(book_id or "").strip()
    safe_context = str(guide_context or "").strip()

    if not safe_lecture_id or not safe_book_id:
        raise ValueError("lecture_id and book_id are required.")

    if not safe_context:
        raise ValueError("guide_context is required.")

    lecture = get_lecture(resolved_cfg, safe_lecture_id)
    book = get_book(resolved_cfg, safe_lecture_id, safe_book_id)

    if lecture is None or book is None:
        raise ValueError(f"Book not found: {safe_lecture_id}/{safe_book_id}")

    settings = get_question_generation_settings(resolved_cfg)
    runner = build_question_generation_runner(resolved_cfg)
    system_prompt = _render_reader_guide_prompt(
        lecture_title=str(lecture.get("title") or ""),
        book_title=str(book.get("title") or ""),
        chapter_name=str(chapter_name or ""),
        session_name=str(session_name or ""),
        guide_context=safe_context,
        user_profile=user_profile,
        pre_reading_answers=pre_reading_answers,
    )

    user_prompt = "请根据阅读内容生成导读卡，使用 submit_guide 工具提交。"

    log_event(
        "reader_guide_start",
        "Reader 导读生成开始",
        payload={
            "lecture_id": safe_lecture_id,
            "book_id": safe_book_id,
            "chapter_name": str(chapter_name or ""),
            "session_name": str(session_name or ""),
            "stream": bool(stream),
        },
    )

    # 工具调用模式
    tools = _build_guide_tools()
    proxy = runner.nexora_client.proxy
    model_name = runner.model_name

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    turn_history: List[Dict[str, Any]] = []
    guide_submitted = False
    result_guide: Dict[str, Any] = {}

    for turn in range(1, 4):
        request_messages = list(messages) + turn_history
        round_deltas: List[str] = []

        def _on_round_delta(delta_text: str) -> None:
            piece = str(delta_text or "")
            if not piece:
                return
            round_deltas.append(piece)
            if callable(on_delta):
                on_delta(piece)

        response = proxy.chat_completions(
            messages=request_messages,
            model=model_name or None,
            options={
                "temperature": float(settings.get("temperature") or 0.3),
                "max_tokens": 2000,
                "stream": bool(stream),
                "tools": tools,
                "tool_choice": "auto",
            },
            use_chat_path=False,
            request_timeout=float(settings.get("request_timeout") or 240),
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
            "reader_guide_round",
            "Reader 导读轮次响应",
            payload={
                "lecture_id": safe_lecture_id,
                "book_id": safe_book_id,
                "chapter_name": str(chapter_name or ""),
                "session_name": str(session_name or ""),
                "turn": turn,
                "tool_calls": len((msg or {}).get("tool_calls") or []) if isinstance((msg or {}).get("tool_calls"), list) else 0,
                "content_len": len(content or "".join(round_deltas)),
            },
            content=(content or "".join(round_deltas))[:2400],
        )

        raw_tool_calls = (msg or {}).get("tool_calls") if isinstance((msg or {}).get("tool_calls"), list) else []
        tool_calls: List[Dict[str, Any]] = []
        for raw_call in raw_tool_calls:
            if not isinstance(raw_call, dict):
                continue
            raw_func = raw_call.get("function") if isinstance(raw_call.get("function"), dict) else {}
            normalized_name = str(raw_func.get("name") or "").strip()
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

        if not tool_calls:
            turn_history.append({
                "role": "user",
                "content": "You must call submit_guide(guide_cards=[...]) to submit. Do not output plain text JSON.",
            })
            continue

        for call in tool_calls:
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            args_obj = _safe_json_obj(str(func.get("arguments") or "{}"))
            call_id = str(call.get("id") or "")

            if tool_name == "submit_guide":
                try:
                    result_guide = _normalize_reader_guide(args_obj)
                    guide_submitted = True
                    turn_history.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": _safe_json_dumps({
                            "ok": True,
                            "cards_count": len(result_guide.get("guide_cards") or []),
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

        if guide_submitted:
            break

    if not guide_submitted or not result_guide:
        raise RuntimeError("Model failed to submit guide via tool call")

    log_event(
        "reader_guide_done",
        "Reader 导读生成完成",
        payload={
            "lecture_id": safe_lecture_id,
            "book_id": safe_book_id,
            "chapter_name": str(chapter_name or ""),
            "session_name": str(session_name or ""),
            "guide_cards_count": len(result_guide.get("guide_cards") or []),
        },
    )

    return {
        "guide": result_guide,
        "model_name": str(runner.model_name or ""),
        "chapter_name": str(chapter_name or ""),
        "session_name": str(session_name or ""),
    }
