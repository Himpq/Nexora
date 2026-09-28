"""Outline generation for NexoraLearning.

使用工具调用模式生成大纲，避免 JSON 解析错误。
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple


_WRITE_LOCK = threading.Lock()


def _write_json(path: Path, data: Any) -> None:
    """线程安全写入 JSON 文件。"""
    with _WRITE_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> Optional[Any]:
    """读取 JSON 文件，不存在返回 None。"""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def build_outline_source_book_ids(books: List[Mapping[str, Any]]) -> List[str]:
    """返回参与课程大纲生成的已完成概述教材 ID。"""
    return sorted(
        str(book.get("id") or "").strip()
        for book in books
        if str(book.get("id") or "").strip()
        and str(book.get("summary_status") or "").strip().lower() == "done"
    )


def outline_coverage_gap(sections: List[Mapping[str, Any]], books: List[Mapping[str, Any]]) -> Dict[str, Any]:
    """大纲必须覆盖每一本源教材：返回 {missing: [book_id...], unknown: [book_id...]}。

    历史故障（2026-09-19，课程 l_d5a6…）：两本书都 summary_status=done，模型只引用了第二本，
    大纲 13 节全是向量数据库，认知层把所有概念都挂到那本书，备份还原那本书的题永远绑不到概念。
    """
    known = {str(book.get("id") or "").strip() for book in books if str(book.get("id") or "").strip()}
    required = set(build_outline_source_book_ids(books))
    covered = set()
    unknown = set()
    for section in sections or []:
        for source in (section.get("sources") if isinstance(section, Mapping) else None) or []:
            if not isinstance(source, Mapping):
                continue
            book_id = str(source.get("book_id") or "").strip()
            if not book_id:
                continue
            if book_id in known:
                covered.add(book_id)
            else:
                unknown.add(book_id)
    return {"missing": sorted(required - covered), "unknown": sorted(unknown)}


def _format_chapters_for_prompt(all_chapters: List[Mapping[str, Any]], *, limit: int = 12000) -> str:
    """按教材分组、每本书都完整列出章名（摘要截短），避免 JSON 整体截断时把后面的书截掉。"""
    by_book: Dict[str, List[Mapping[str, Any]]] = {}
    titles: Dict[str, str] = {}
    for row in all_chapters or []:
        bid = str(row.get("book_id") or "").strip()
        by_book.setdefault(bid, []).append(row)
        titles.setdefault(bid, str(row.get("book_title") or "").strip())
    if not by_book:
        return "[]"
    per_book_budget = max(800, limit // max(1, len(by_book)))
    blocks: List[str] = []
    for bid, rows in by_book.items():
        lines = [f"### 教材 {titles.get(bid) or bid}（book_id={bid}，{len(rows)} 章）"]
        summary_cap = max(40, min(160, per_book_budget // max(1, len(rows)) - 20))
        for row in rows:
            summary = str(row.get("chapter_summary") or "").strip().replace("\n", " ")[:summary_cap]
            lines.append(f"- {row.get('chapter_name')}" + (f"：{summary}" if summary else ""))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)[:limit]


def _format_details_for_prompt(all_details: List[Mapping[str, Any]], *, limit: int = 8000) -> str:
    """精读关键点：按教材分组，只带标题，保证每本书都有配额。"""
    by_book: Dict[str, List[Mapping[str, Any]]] = {}
    titles: Dict[str, str] = {}
    for row in all_details or []:
        bid = str(row.get("book_id") or "").strip()
        by_book.setdefault(bid, []).append(row)
        titles.setdefault(bid, str(row.get("book_title") or "").strip())
    if not by_book:
        return "（暂无精读关键点）"
    per_book_budget = max(600, limit // max(1, len(by_book)))
    blocks: List[str] = []
    for bid, rows in by_book.items():
        lines = [f"### 教材 {titles.get(bid) or bid}（book_id={bid}）"]
        for row in rows:
            points = [str(p.get("title") or "").strip() for p in (row.get("key_points") or []) if isinstance(p, Mapping)]
            points = [p for p in points if p][:8]
            if points:
                lines.append(f"- {row.get('chapter_name')}：" + "；".join(points))
        blocks.append("\n".join(lines)[:per_book_budget])
    return "\n\n".join(blocks)[:limit]


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


def _extract_chapter_summaries(bookinfo_xml: str) -> List[Dict[str, str]]:
    """从 bookinfo.xml 提取章节摘要列表。"""
    import re

    text = str(bookinfo_xml or "")
    if not text.strip():
        return []
    pattern = re.compile(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>\s*"
        r"<chapter_range>\s*(.*?)\s*</chapter_range>\s*"
        r"(?:<chapter_status>\s*.*?\s*</chapter_status>\s*)?"
        r"<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    rows: List[Dict[str, str]] = []
    for match in pattern.finditer(text):
        chapter_name = str(match.group(1) or "").strip()
        chapter_range = str(match.group(2) or "").strip()
        chapter_summary = str(match.group(3) or "").strip()
        if not chapter_name:
            continue
        rows.append(
            {
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "chapter_summary": chapter_summary,
            }
        )
    return rows


def _extract_key_points(bookdetail_xml: str) -> Dict[str, List[Dict[str, str]]]:
    """从 bookdetail.xml 提取章节关键点。"""
    import re

    text = str(bookdetail_xml or "")
    result: Dict[str, List[Dict[str, str]]] = {}

    blocks = re.findall(r"<book_detail>\s*.*?\s*</book_detail>", text, flags=re.IGNORECASE | re.DOTALL)
    for block in blocks:
        name_match = re.search(r"<chapter_name>\s*(.*?)\s*</chapter_name>", block, flags=re.IGNORECASE | re.DOTALL)
        chapter_name = str(name_match.group(1) or "").strip() if name_match else ""
        if not chapter_name:
            continue

        kp_blocks = re.findall(r"<key_point>\s*(.*?)\s*</key_point>", block, flags=re.IGNORECASE | re.DOTALL)
        key_points: List[Dict[str, str]] = []
        for kp in kp_blocks:
            title_match = re.search(r"<key_point_title>\s*(.*?)\s*</key_point_title>", kp, flags=re.IGNORECASE | re.DOTALL)
            content_match = re.search(r"<key_point_content>\s*(.*?)\s*</key_point_content>", kp, flags=re.IGNORECASE | re.DOTALL)
            kp_title = str(title_match.group(1) or "").strip() if title_match else ""
            kp_content = str(content_match.group(1) or "").strip() if content_match else ""
            if kp_title:
                key_points.append({"title": kp_title, "content": kp_content[:200]})

        if key_points:
            result[chapter_name] = key_points

    return result


def _collect_all_books_data(
    cfg: Mapping[str, Any],
    lecture_id: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """收集课程下所有教材的章节结构和精读结果。"""
    from core.lectures import list_books, load_book_info_xml, load_book_detail_xml

    books = list_books(cfg, lecture_id)
    all_chapters: List[Dict[str, Any]] = []
    all_details: List[Dict[str, Any]] = []

    for book in books:
        bid = str(book.get("id") or "").strip()
        btitle = str(book.get("title") or "").strip()
        if not bid:
            continue

        bookinfo = load_book_info_xml(cfg, lecture_id, bid)
        bookdetail = load_book_detail_xml(cfg, lecture_id, bid)

        chapters = _extract_chapter_summaries(bookinfo)
        for ch in chapters:
            ch["book_id"] = bid
            ch["book_title"] = btitle
        all_chapters.extend(chapters)

        details = _extract_key_points(bookdetail)
        for chapter_name, key_points in details.items():
            all_details.append({
                "book_id": bid,
                "book_title": btitle,
                "chapter_name": chapter_name,
                "key_points": key_points,
            })

    return all_chapters, all_details


def _build_profile_summary(
    cfg: Mapping[str, Any],
    user_id: str,
) -> str:
    """构建用户画像摘要。"""
    if not user_id:
        return "暂无用户画像"

    try:
        from core.user.user import read_memory
        from core.memory.profile_extract import parse_profile_dimensions

        profile_content = read_memory(cfg, user_id, "user")
        if not profile_content:
            return "暂无用户画像"

        dimensions = parse_profile_dimensions(profile_content)
        if not dimensions:
            return profile_content[:1500]

        lines = []
        for dim_name, dim_value in dimensions.items():
            if dim_value:
                lines.append(f"- {dim_name}: {dim_value}")
        return "\n".join(lines)[:1500] if lines else profile_content[:1500]
    except Exception:
        return "暂无用户画像"


def _build_books_summary(books: List[Dict[str, Any]]) -> str:
    """构建教材列表摘要。"""
    lines = []
    for book in books:
        btitle = str(book.get("title") or "").strip()
        chapter_count = len(_extract_chapter_summaries(
            book.get("_bookinfo", "")
        )) if book.get("_bookinfo") else 0
        if btitle:
            lines.append(f"- {btitle}（{chapter_count} 章）")
    return "\n".join(lines) if lines else "暂无教材信息"


def _build_outline_tools() -> List[Dict[str, Any]]:
    """构建大纲生成工具定义。"""
    return [
        {
            "type": "function",
            "function": {
                "name": "submit_outline",
                "description": "Submit the final course outline. Call this tool to submit the generated outline sections.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "course_title": {
                            "type": "string",
                            "description": "Course title"
                        },
                        "course_summary": {
                            "type": "string",
                            "description": "课程简介：一两句话概括这门课程是什么、适合谁、学完能收获什么（80-150字）"
                        },
                        "course_long_summary": {
                            "type": "string",
                            "description": "课程长简介：面向课程知识领域本身的泛化性介绍，不绑定具体教材章节，阐述课程背景、核心内容脉络与价值（300-500字）"
                        },
                        "learning_objectives": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "学习目标：学完本课程后应具备的知识与能力（3-6条，泛化性表述）"
                        },
                        "learning_tasks": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "学习任务：为达成学习目标需要完成的关键学习任务（3-6条，泛化性表述）"
                        },
                        "sections": {
                            "type": "array",
                            "description": "List of learning sections",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "string", "description": "Section ID, e.g. sec_001"},
                                    "title": {"type": "string", "description": "Section title"},
                                    "summary": {"type": "string", "description": "Section summary (50-100 chars)"},
                                    "objectives": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                        "description": "Learning objectives"
                                    },
                                    "key_concepts": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                        "description": "Core concepts"
                                    },
                                    "difficulty": {
                                        "type": "string",
                                        "enum": ["基础", "中等", "进阶"],
                                        "description": "Difficulty level"
                                    },
                                    "estimated_minutes": {
                                        "type": "integer",
                                        "description": "Estimated study time in minutes (15-60)"
                                    },
                                    "prerequisites": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                        "description": "Prerequisite section IDs"
                                    },
                                    "sources": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "book_id": {"type": "string"},
                                                "book_title": {"type": "string"},
                                                "chapter_name": {"type": "string"},
                                                "chapter_summary": {"type": "string"}
                                            },
                                            "required": ["book_id", "chapter_name"]
                                        },
                                        "description": "Source references"
                                    },
                                    "exploration": {
                                        "type": "object",
                                        "properties": {
                                            "agent_prompt": {"type": "string", "description": "Exploration prompt for students"},
                                            "search_keywords": {
                                                "type": "array",
                                                "items": {"type": "string"},
                                                "description": "Search keywords"
                                            }
                                        }
                                    }
                                },
                                "required": ["id", "title", "summary", "estimated_minutes", "sources"]
                            }
                        }
                    },
                    "required": ["course_title", "sections"]
                }
            }
        }
    ]


def _normalize_outline_sections(raw_sections: Any) -> List[Dict[str, Any]]:
    """规范化 submit_outline 返回的 sections。"""
    parsed_sections: List[Dict[str, Any]] = []
    if not isinstance(raw_sections, list):
        return parsed_sections

    for row in raw_sections:
        if not isinstance(row, dict):
            continue

        section_id = str(row.get("id") or "").strip()
        title = str(row.get("title") or "").strip()
        summary = str(row.get("summary") or "").strip()

        try:
            estimated_minutes = int(row.get("estimated_minutes") or 30)
        except Exception:
            estimated_minutes = 30

        if not title:
            continue

        objectives = row.get("objectives") if isinstance(row.get("objectives"), list) else []
        key_concepts = row.get("key_concepts") if isinstance(row.get("key_concepts"), list) else []
        difficulty = str(row.get("difficulty") or "中等").strip()
        prerequisites = row.get("prerequisites") if isinstance(row.get("prerequisites"), list) else []
        sources = row.get("sources") if isinstance(row.get("sources"), list) else []
        exploration = row.get("exploration") if isinstance(row.get("exploration"), dict) else {}

        parsed_sections.append(
            {
                "id": section_id or f"sec_{len(parsed_sections) + 1:03d}",
                "title": title,
                "summary": summary,
                "objectives": [str(item) for item in objectives if str(item).strip()],
                "key_concepts": [str(item) for item in key_concepts if str(item).strip()],
                "difficulty": difficulty,
                "estimated_minutes": max(15, min(60, estimated_minutes)),
                "prerequisites": [str(item) for item in prerequisites if str(item).strip()],
                "sources": [item for item in sources if isinstance(item, dict)],
                "exploration": exploration,
            }
        )

    return parsed_sections


def _normalize_str_list(raw: Any) -> List[str]:
    """把模型返回的字符串数组字段规范化为非空字符串列表。"""
    if not isinstance(raw, list):
        return []

    return [str(item).strip() for item in raw if str(item).strip()]


def generate_outline(
    cfg: Mapping[str, Any],
    lecture_id: str,
    *,
    user_id: str = "",
    on_status: Optional[callable] = None,
    on_delta: Optional[callable] = None,
) -> Dict[str, Any]:
    """生成课程大纲（使用工具调用模式）。"""
    from core.lectures import get_lecture, list_books, load_book_info_xml
    from core.models import NexoraCompletionClient, load_scheduler_models_config
    from core.runlog import append_log_text, log_event

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
        piece = str(delta_text or "")
        if not piece:
            return
        # 大纲生成可能走队列或 SSE，模型 delta 统一在核心流程实时落日志。
        append_log_text(piece)
        if callable(on_delta):
            try:
                on_delta(piece)
            except Exception:
                pass

    lecture = get_lecture(cfg, safe_lecture_id)
    if lecture is None:
        raise ValueError(f"Lecture not found: {safe_lecture_id}")

    lecture_title = str(lecture.get("title") or "").strip()

    # 收集所有教材数据
    books = list_books(cfg, safe_lecture_id)
    if not books:
        raise ValueError("No books found for this lecture.")
    emit_status("已读取课程与教材列表")

    # 为每本书加载 bookinfo
    for book in books:
        bid = str(book.get("id") or "").strip()
        if bid:
            book["_bookinfo"] = load_book_info_xml(cfg, safe_lecture_id, bid)

    all_chapters, all_details = _collect_all_books_data(cfg, safe_lecture_id)
    books_summary = _build_books_summary(books)
    profile_summary = _build_profile_summary(cfg, user_id)
    emit_status("已整理教材章节、关键点与用户画像")

    # 构造 prompt
    try:
        from NexoraLearning.prompts import OUTLINE_GENERATION_PROMPT
    except ImportError:
        from prompts import OUTLINE_GENERATION_PROMPT

    system_prompt = str(OUTLINE_GENERATION_PROMPT or "")
    values = {
        "lecture_title": lecture_title,
        "books_summary": books_summary,
        "all_chapters": _format_chapters_for_prompt(all_chapters, limit=12000),
        "all_details": _format_details_for_prompt(all_details, limit=8000),
        "profile_summary": profile_summary,
    }

    for key, value in values.items():
        system_prompt = system_prompt.replace("{{" + key + "}}", value)

    user_prompt = "请根据课程信息生成学习大纲，使用 submit_outline 工具提交。"

    log_event(
        "outline_start",
        "课程大纲生成开始",
        payload={"lecture_id": safe_lecture_id},
    )
    emit_status("已构建大纲生成提示词，准备调用模型")

    # 获取模型配置
    models_cfg = load_scheduler_models_config(cfg)
    model_name = str(models_cfg.get("default_nexora_model") or "").strip()
    temperature = 0.3
    max_output_tokens = 8000
    # 双跳(123->154 主站->隧道)路径单轮最长 240s;154 直连约 20-30s/轮
    request_timeout = 240

    # 工具定义
    tools = _build_outline_tools()

    # 多轮对话调用
    client = NexoraCompletionClient(cfg)
    proxy = client.proxy

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    turn_history: List[Dict[str, Any]] = []
    outline_submitted = False
    result_outline: Dict[str, Any] = {}
    max_turns = 5

    for turn in range(1, max_turns + 1):
        request_messages = list(messages)
        if turn_history:
            request_messages.extend(turn_history)
        emit_status(f"模型第 {turn} 轮生成中")

        log_event(
            "outline_round",
            "大纲生成轮次",
            payload={
                "turn": turn,
                "messages_count": len(request_messages),
                "model_stream": False,
                "tool_choice": "submit_outline",
                "request_timeout": request_timeout,
            },
        )

        round_fragments: List[str] = []
        round_reasoning_fragments: List[str] = []
        round_reasoning_started = False

        def _on_round_delta(delta_text: str) -> None:
            piece = str(delta_text or "")
            if not piece:
                return
            round_fragments.append(piece)
            emit_delta(piece)

        def _on_round_reasoning_delta(delta_text: str) -> None:
            nonlocal round_reasoning_started

            piece = str(delta_text or "")
            if not piece:
                return

            round_reasoning_fragments.append(piece)

            if not round_reasoning_started:
                append_log_text(f"\n[outline_reasoning turn={turn}]\n")
                round_reasoning_started = True

            append_log_text(piece)

        response = proxy.chat_completions(
            messages=request_messages,
            model=model_name or None,
            options={
                "temperature": temperature,
                "max_tokens": max_output_tokens,
                # 双跳(nested papi)下 DeepSeek 默认开启思考会耗尽输出预算导致
                # 工具调用缺失/超时;显式关闭思考与 154 直连隧道行为对齐
                "think": False,
                # PAPI 上游在工具调用开启时不会返回有效流式增量；浏览器 SSE
                # 仍由 generate-stream 路由持续发送状态，模型工具请求固定非流式。
                "stream": False,
                "tools": tools,
                "tool_choice": {"type": "function", "function": {"name": "submit_outline"}},
            },
            use_chat_path=False,
            request_timeout=request_timeout,
            on_delta=_on_round_delta,
            on_reasoning_delta=_on_round_reasoning_delta,
        )

        if not bool(response.get("ok")):
            raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")

        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        if not choices:
            raise RuntimeError("Model returned no choices")

        msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
        finish_reason = str(choices[0].get("finish_reason") or "").strip() if isinstance(choices[0], dict) else ""
        stream_debug = payload.get("_stream_debug") if isinstance(payload.get("_stream_debug"), dict) else {}
        content = str((msg or {}).get("content") or "")
        reasoning_content = str((msg or {}).get("reasoning_content") or payload.get("reasoning_content") or "")

        # 推送模型输出到日志
        if content.strip():
            log_event(
                "outline_model_output",
                "大纲模型输出",
                payload={"turn": turn, "content_len": len(content)},
                content=content[:2000],
            )
            emit_status(f"模型第 {turn} 轮返回文本输出")
        elif round_fragments:
            streamed_text = "".join(round_fragments)
            log_event(
                "outline_model_stream",
                "大纲模型流式输出",
                payload={"turn": turn, "content_len": len(streamed_text)},
                content=streamed_text[:4000],
            )
        if reasoning_content.strip():
            log_event(
                "outline_model_reasoning_output",
                "大纲模型推理输出",
                payload={"turn": turn, "content_len": len(reasoning_content)},
                content=reasoning_content[:4000],
            )
            emit_status(f"模型第 {turn} 轮返回推理输出")
        elif round_reasoning_fragments:
            streamed_reasoning_text = "".join(round_reasoning_fragments)
            log_event(
                "outline_model_reasoning_stream",
                "大纲模型推理流式输出",
                payload={"turn": turn, "content_len": len(streamed_reasoning_text)},
                content=streamed_reasoning_text[:4000],
            )
            emit_status(f"模型第 {turn} 轮返回推理输出")

        raw_tool_calls = (msg or {}).get("tool_calls") if isinstance((msg or {}).get("tool_calls"), list) else []
        tool_calls: List[Dict[str, Any]] = []
        for raw_call in raw_tool_calls:
            if not isinstance(raw_call, dict):
                continue
            raw_func = raw_call.get("function") if isinstance(raw_call.get("function"), dict) else {}
            normalized_name = str(raw_func.get("name") or "").strip()
            normalized_args_obj = _safe_json_obj(str(raw_func.get("arguments") or "{}"))
            normalized_call: Dict[str, Any] = {
                "id": str(raw_call.get("id") or ""),
                "type": "function",
                "function": {
                    "name": normalized_name,
                    "arguments": _safe_json_dumps(normalized_args_obj),
                },
            }
            tool_calls.append(normalized_call)

        if not content.strip() and not reasoning_content.strip() and not tool_calls:
            log_event(
                "outline_model_empty_stream",
                "大纲模型流未解析出正文、推理或工具调用",
                payload={
                    "turn": turn,
                    "finish_reason": finish_reason,
                    "stream_debug": stream_debug,
                },
                content=json.dumps(stream_debug, ensure_ascii=False, indent=2)[:4000],
            )

        log_event(
            "outline_tool_calls",
            "大纲工具调用检测",
            payload={
                "turn": turn,
                "has_tool_calls": bool(tool_calls),
                "tool_names": [tc.get("function", {}).get("name", "") for tc in tool_calls],
                "finish_reason": finish_reason,
                "content_len": len(content),
                "reasoning_len": len(reasoning_content),
                "stream_debug": stream_debug,
            },
            content=_safe_json_dumps(tool_calls)[:2400] if tool_calls else "",
        )

        turn_history.append(
            {
                "role": "assistant",
                "content": content if content else None,
                "tool_calls": tool_calls if tool_calls else None,
            }
        )

        if not tool_calls:
            log_event(
                "outline_no_tool",
                "模型未调用工具，要求重试",
                payload={"turn": turn},
            )
            # 没有工具调用，要求模型重试
            turn_history.append({
                "role": "user",
                "content": "You must call submit_outline(sections=[...]) to submit the outline. Do not output plain text JSON.",
            })
            emit_status("模型未提交 submit_outline，已要求重试")
            continue

        # 处理工具调用
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            call_id = str(call.get("id") or "")
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            args_obj = _safe_json_obj(str(func.get("arguments") or "{}"))

            log_event(
                "outline_tool_process",
                "处理工具调用",
                payload={
                    "turn": turn,
                    "tool_name": tool_name,
                    "call_id": call_id,
                    "args_keys": list(args_obj.keys()) if isinstance(args_obj, dict) else [],
                },
            )

            if tool_name == "submit_outline":
                emit_status("模型已调用 submit_outline，正在校验大纲结构")
                course_title = str(args_obj.get("course_title") or lecture_title).strip()
                parsed_sections = _normalize_outline_sections(args_obj.get("sections"))
                course_summary = str(args_obj.get("course_summary") or "").strip()
                course_long_summary = str(args_obj.get("course_long_summary") or "").strip()
                learning_objectives = _normalize_str_list(args_obj.get("learning_objectives"))
                learning_tasks = _normalize_str_list(args_obj.get("learning_tasks"))

                if parsed_sections:
                    gap = outline_coverage_gap(parsed_sections, books)
                    if gap["missing"] or gap["unknown"]:
                        title_by_id = {str(b.get("id") or ""): str(b.get("title") or "") for b in books}
                        problems = []
                        if gap["missing"]:
                            problems.append("以下教材没有被任何 section 的 sources 引用，必须为它们安排学习单元（可与主题相近的章合并到同一 section）："
                                            + "；".join(f"{title_by_id.get(b, b)}（book_id={b}）" for b in gap["missing"]))
                        if gap["unknown"]:
                            problems.append("sources 里出现了不存在的 book_id，必须使用章节结构中给出的原值：" + "、".join(gap["unknown"]))
                        log_event("outline_coverage_rejected", "大纲未覆盖全部教材，要求重试",
                                  payload={"turn": turn, "missing": gap["missing"], "unknown": gap["unknown"]})
                        emit_status("大纲没有覆盖全部教材，已要求模型补齐")
                        turn_history.append({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": json.dumps({"ok": False, "error": "\n".join(problems)}, ensure_ascii=False),
                        })
                        continue
                    result_outline = {
                        "course_title": course_title,
                        "course_summary": course_summary,
                        "course_long_summary": course_long_summary,
                        "learning_objectives": learning_objectives,
                        "learning_tasks": learning_tasks,
                        "sections": parsed_sections,
                    }
                    outline_submitted = True

                    log_event(
                        "outline_submit_success",
                        "大纲提交成功",
                        payload={
                            "turn": turn,
                            "sections_count": len(parsed_sections),
                            "course_title": course_title,
                        },
                    )
                    emit_status(f"已接收 {len(parsed_sections)} 个大纲章节，准备固化")

                    # 返回成功结果给模型
                    turn_history.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": json.dumps({
                            "ok": True,
                            "sections_count": len(parsed_sections),
                            "message": f"Outline submitted successfully with {len(parsed_sections)} sections.",
                        }, ensure_ascii=False),
                    })
                else:
                    turn_history.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": json.dumps({
                            "ok": False,
                            "error": "No valid sections found. Please provide at least one section.",
                        }, ensure_ascii=False),
                    })
            else:
                turn_history.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": json.dumps({"ok": False, "error": f"Unknown tool: {tool_name}"}),
                })

        if outline_submitted:
            log_event(
                "outline_loop_break",
                "大纲循环结束",
                payload={
                    "turn": turn,
                    "outline_submitted": outline_submitted,
                    "result_outline_keys": list(result_outline.keys()) if isinstance(result_outline, dict) else [],
                },
            )
            break

    log_event(
        "outline_loop_end",
        "大纲生成循环结束",
        payload={
            "outline_submitted": outline_submitted,
            "result_outline_keys": list(result_outline.keys()) if isinstance(result_outline, dict) else [],
            "sections_count": len(result_outline.get("sections", [])),
        },
    )

    if not outline_submitted or not result_outline:
        raise RuntimeError("Model failed to submit outline via tool call after multiple attempts")

    # 验证和规范化
    sections = result_outline.get("sections")
    if not isinstance(sections, list) or not sections:
        raise ValueError("模型未返回有效的 sections")

    # 补充元数据
    result_outline["lecture_id"] = safe_lecture_id
    result_outline["lecture_title"] = lecture_title
    result_outline["source_book_ids"] = build_outline_source_book_ids(books)
    result_outline["generated_at"] = int(time.time())
    result_outline["total_sections"] = len(sections)
    result_outline["total_estimated_minutes"] = sum(
        int(s.get("estimated_minutes") or 0) for s in sections if isinstance(s, dict)
    )

    # 保存大纲
    _save_outline(cfg, safe_lecture_id, result_outline)
    emit_status("大纲文件已保存")

    log_event(
        "outline_done",
        "课程大纲生成完成",
        payload={
            "lecture_id": safe_lecture_id,
            "section_count": len(sections),
        },
    )
    emit_status("课程大纲生成完成")

    return result_outline


def _save_outline(
    cfg: Mapping[str, Any],
    lecture_id: str,
    outline: Dict[str, Any],
) -> None:
    """保存大纲到文件。"""
    data_dir = Path(str(cfg.get("data_dir") or "data"))
    outline_dir = data_dir / "lectures" / lecture_id / "solidified"
    outline_dir.mkdir(parents=True, exist_ok=True)
    _write_json(outline_dir / "outline.json", outline)


def load_outline(
    cfg: Mapping[str, Any],
    lecture_id: str,
) -> Optional[Dict[str, Any]]:
    """加载课程大纲。"""
    data_dir = Path(str(cfg.get("data_dir") or "data"))
    outline_path = data_dir / "lectures" / lecture_id / "solidified" / "outline.json"
    return _read_json(outline_path)
