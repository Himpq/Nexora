"""出题模型流程模块。"""

from __future__ import annotations

import re
import time
from typing import Any, Callable, Dict, List, Mapping, Tuple


def _xml_escape(value: Any) -> str:
    text = str(value or "")
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _parse_range(value: str) -> Tuple[int, int]:
    text = str(value or "").strip()
    if ":" not in text:
        return 0, 0
    left, right = text.split(":", 1)
    try:
        start = int(str(left).strip())
        length = int(str(right).strip())
    except Exception:
        return 0, 0
    return max(0, start), max(0, length)


def _extract_chapter_summaries(bookinfo_xml: str) -> Dict[str, Dict[str, str]]:
    """按 chapter_range 提取概读摘要。"""
    text = str(bookinfo_xml or "")
    result: Dict[str, Dict[str, str]] = {}
    pattern = re.compile(
        r"<chapter_name>(.*?)</chapter_name>.*?<chapter_range>(.*?)</chapter_range>.*?<chapter_summary>(.*?)</chapter_summary>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(text):
        chapter_name = str(match.group(1) or "").strip()
        chapter_range = str(match.group(2) or "").strip()
        chapter_summary = str(match.group(3) or "").strip()
        if not chapter_range:
            continue
        result[chapter_range] = {
            "chapter_name": chapter_name,
            "chapter_summary": chapter_summary,
        }
    return result


def _extract_book_details(bookdetail_xml: str) -> Dict[str, str]:
    """按 chapter_range 提取精读详情块。"""
    text = str(bookdetail_xml or "")
    result: Dict[str, str] = {}
    block_pattern = re.compile(r"<book_detail>\s*.*?\s*</book_detail>", flags=re.IGNORECASE | re.DOTALL)
    range_pattern = re.compile(r"<chapter_range>\s*(.*?)\s*</chapter_range>", flags=re.IGNORECASE | re.DOTALL)
    for block in block_pattern.findall(text):
        block_text = str(block or "").strip()
        if not block_text:
            continue
        match = range_pattern.search(block_text)
        if not match:
            continue
        result[str(match.group(1) or "").strip()] = block_text
    return result


def _render_questions_root(blocks: List[str]) -> str:
    body = "\n\n".join([str(item or "").strip() for item in blocks if str(item or "").strip()])
    return "<questions>\n" + body + "\n</questions>"


def _extract_question_block_range(block_xml: str) -> str:
    match = re.search(r"<chapter_range>\s*(.*?)\s*</chapter_range>", str(block_xml or ""), flags=re.IGNORECASE | re.DOTALL)
    return str(match.group(1) or "").strip() if match else ""


def _merge_question_block(existing_blocks: List[str], new_block: str) -> List[str]:
    incoming = str(new_block or "").strip()
    if not incoming:
        return list(existing_blocks or [])
    incoming_range = _extract_question_block_range(incoming)
    merged = list(existing_blocks or [])
    if not incoming_range:
        merged.append(incoming)
        return merged
    replaced = False
    for idx, old_block in enumerate(merged):
        if _extract_question_block_range(old_block) == incoming_range:
            merged[idx] = incoming
            replaced = True
            break
    if not replaced:
        merged.append(incoming)
    return merged


def _extract_existing_question_blocks(questions_xml: str) -> List[str]:
    text = str(questions_xml or "")
    if not text.strip():
        return []
    pattern = re.compile(r"<chapter_questions>\s*.*?\s*</chapter_questions>", flags=re.IGNORECASE | re.DOTALL)
    return [str(block or "").strip() for block in pattern.findall(text) if str(block or "").strip()]


def _normalize_questions(value: Any) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    if not isinstance(value, list):
        return rows
    for item in value:
        if not isinstance(item, dict):
            continue
        title = str(item.get("question_title") or item.get("title") or "").strip()
        difficulty = str(item.get("question_difficulty") or item.get("difficulty") or "").strip()
        content = str(item.get("question_content") or item.get("content") or "").strip()
        hint = str(item.get("question_hint") or item.get("hint") or "").strip()
        answer = str(item.get("question_answer") or item.get("answer") or "").strip()
        if not (title or content or answer):
            continue
        rows.append(
            {
                "question_title": title,
                "question_difficulty": difficulty,
                "question_content": content,
                "question_hint": hint,
                "question_answer": answer,
            }
        )
    return rows


def _render_question_items_xml(items: List[Dict[str, str]]) -> str:
    if not items:
        return "  <question_items></question_items>"
    blocks: List[str] = []
    for item in items:
        blocks.append(
            "    <question_item>\n"
            f"      <question_title>{_xml_escape(item.get('question_title') or '')}</question_title>\n"
            f"      <question_difficulty>{_xml_escape(item.get('question_difficulty') or '')}</question_difficulty>\n"
            f"      <question_content>{_xml_escape(item.get('question_content') or '')}</question_content>\n"
            f"      <question_hint>{_xml_escape(item.get('question_hint') or '')}</question_hint>\n"
            f"      <question_answer>{_xml_escape(item.get('question_answer') or '')}</question_answer>\n"
            "    </question_item>"
        )
    return "  <question_items>\n" + "\n".join(blocks) + "\n  </question_items>"


def _exec_read_book_text_tool_in_range(
    *,
    full_text: str,
    chapter_start: int,
    chapter_length: int,
    arguments: Mapping[str, Any],
) -> Dict[str, Any]:
    """Read tool wrapper constrained to the current chapter range."""
    total_len = len(full_text or "")
    safe_start = max(0, min(int(chapter_start or 0), total_len))
    safe_end = max(safe_start, min(safe_start + max(0, int(chapter_length or 0)), total_len))
    offset = int(arguments.get("offset") or safe_start)
    length = int(arguments.get("length") or 0)
    if length < 0:
        length = 0
    if offset < safe_start:
        offset = safe_start
    if offset > safe_end:
        offset = safe_end
    if offset + length > safe_end:
        length = max(0, safe_end - offset)
    text = str(full_text or "")[offset:offset + length]
    return {
        "ok": True,
        "offset": offset,
        "length": length,
        "chapter_range": f"{safe_start}:{max(0, safe_end - safe_start)}",
        "text": text,
    }


def run_question_generation_once(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    actor: str = "",
    model_name: str = "",
    get_lecture: Callable[..., Any],
    get_book: Callable[..., Any],
    load_book_info_xml: Callable[..., str],
    load_book_detail_xml: Callable[..., str],
    load_book_questions_xml: Callable[..., str],
    save_book_questions_xml: Callable[..., None],
    update_book: Callable[..., None],
    resolve_book_text: Callable[..., str],
    get_question_generation_settings: Callable[[Mapping[str, Any]], Dict[str, Any]],
    build_question_generation_runner: Callable[[Mapping[str, Any], str], Any],
    as_bool: Callable[[Any, bool], bool],
    log_event: Callable[..., None],
    append_log_text: Callable[[str], None],
    log_tool_flow: Callable[..., None],
    push_book_progress_step: Callable[[str, str, Mapping[str, Any]], None],
    run_question_with_tools: Callable[..., Dict[str, Any]],
) -> Dict[str, Any]:
    """逐章出题并实时写入 questions.xml。"""
    resolved_cfg = dict(cfg or {})
    lecture = get_lecture(resolved_cfg, lecture_id)
    book = get_book(resolved_cfg, lecture_id, book_id)
    if lecture is None or book is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")

    text = resolve_book_text(resolved_cfg, lecture_id, book_id, book, force=False)
    if not text.strip():
        raise ValueError("Book text is empty.")

    bookinfo_xml = str(load_book_info_xml(resolved_cfg, lecture_id, book_id) or "")
    if not bookinfo_xml.strip():
        raise ValueError("bookinfo.xml is empty.")
    bookdetail_xml = str(load_book_detail_xml(resolved_cfg, lecture_id, book_id) or "")
    if not bookdetail_xml.strip():
        raise ValueError("bookdetail.xml is empty.")

    settings = get_question_generation_settings(resolved_cfg)
    if not bool(settings.get("enabled", True)):
        raise ValueError("question_generation is disabled")

    selected_model_name = str(model_name or "").strip() or str(settings.get("model_name") or "").strip()
    runner = build_question_generation_runner(resolved_cfg, model_name=selected_model_name)
    try:
        temperature = float(settings.get("temperature") or 0.2)
    except Exception:
        temperature = 0.2
    max_output_tokens = max(128, int(settings.get("max_output_tokens") or 4000))
    request_timeout = max(30, int(settings.get("request_timeout") or 240))
    stream = as_bool(settings.get("stream", True), True)
    think = as_bool(settings.get("think", False), False)
    max_input_chars = max(1000, int(settings.get("max_input_chars") or 10000))

    coarse_map = _extract_chapter_summaries(bookinfo_xml)
    detail_map = _extract_book_details(bookdetail_xml)
    chapter_ranges = [key for key in coarse_map.keys() if key in detail_map]
    if not chapter_ranges:
        raise ValueError("No overlapped chapter data between bookinfo.xml and bookdetail.xml.")

    existing_blocks = _extract_existing_question_blocks(str(load_book_questions_xml(resolved_cfg, lecture_id, book_id) or ""))
    total = len(chapter_ranges)
    request_text = (
        "请基于当前章节原文、概读摘要与精读内容出题。"
        "题目必须结合原文与精读分析，不要只照搬摘要。"
        "你可以先 read 原文细节，再通过 write 提交结构化题目，最后 done。"
    )

    for idx, chapter_range in enumerate(chapter_ranges, start=1):
        coarse_row = coarse_map.get(chapter_range) or {}
        chapter_name = str(coarse_row.get("chapter_name") or f"第{idx}章").strip()
        chapter_summary = str(coarse_row.get("chapter_summary") or "").strip()
        detail_xml = str(detail_map.get(chapter_range) or "").strip()
        start, length = _parse_range(chapter_range)
        preload_len = min(max(0, length), max_input_chars)
        chapter_context = text[start:start + preload_len] if preload_len > 0 else ""
        log_event(
            "question_chapter_start",
            "章节出题开始",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_index": idx,
                "chapter_total": total,
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "preload_chars": len(chapter_context),
            },
        )
        result = run_question_with_tools(
            runner=runner,
            request_text=request_text,
            lecture_name=str(lecture.get("title") or ""),
            book_name=str(book.get("title") or ""),
            full_text=text,
            lecture_id=lecture_id,
            book_id=book_id,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            request_timeout=request_timeout,
            stream=stream,
            think=think,
            chapter_name=chapter_name,
            chapter_range=chapter_range,
            chapter_context=chapter_context,
            chapter_summary=chapter_summary,
            chapter_detail_xml=detail_xml,
            on_delta=lambda delta: append_log_text(str(delta or "")),
            log_tool_flow=log_tool_flow,
            push_book_progress_step=push_book_progress_step,
        )
        chapter_xml = str(result.get("questions_xml") or "").strip()
        if chapter_xml:
            existing_blocks = _merge_question_block(existing_blocks, chapter_xml)
            merged_xml = _render_questions_root(existing_blocks)
            save_book_questions_xml(resolved_cfg, lecture_id, book_id, merged_xml)
        log_event(
            "question_chapter_done",
            "章节出题完成",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_index": idx,
                "chapter_total": total,
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "chars": len(chapter_xml),
            },
        )

    final_xml = _render_questions_root(existing_blocks)
    save_book_questions_xml(resolved_cfg, lecture_id, book_id, final_xml)
    update_book(
        resolved_cfg,
        lecture_id,
        book_id,
        {
            "question_status": "done",
            "question_error": "",
            "question_model": str(runner.model_name or ""),
        },
    )
    log_event(
        "book_question_done",
        "教材出题完成",
        payload={"lecture_id": lecture_id, "book_id": book_id, "actor": actor},
        content=str(final_xml or "")[:12000],
    )
    return {
        "success": True,
        "lecture_id": lecture_id,
        "book_id": book_id,
        "model_name": str(runner.model_name or ""),
        "questions_chars": len(str(final_xml or "")),
    }


def run_question_with_tools_strict(
    *,
    runner: Any,
    request_text: str,
    lecture_name: str,
    book_name: str,
    full_text: str,
    lecture_id: str,
    book_id: str,
    temperature: float,
    max_output_tokens: int,
    request_timeout: int,
    stream: bool,
    think: bool,
    chapter_name: str,
    chapter_range: str,
    chapter_context: str,
    chapter_summary: str,
    chapter_detail_xml: str,
    on_delta: Callable[[str], None],
    log_tool_flow: Callable[..., None],
    push_book_progress_step: Callable[[str, str, Mapping[str, Any]], None],
    safe_json_obj: Callable[[str], Dict[str, Any]],
    exec_read_book_text_tool: Callable[..., Dict[str, Any]],
    log_event: Callable[..., None],
) -> Dict[str, Any]:
    """严格工具流：read -> write -> done。"""
    range_start, range_length = _parse_range(chapter_range)
    prompt_vars = {
        "lecture_name": str(lecture_name or ""),
        "book_name": str(book_name or ""),
        "chapter_name": str(chapter_name or ""),
        "chapter_range": str(chapter_range or ""),
        "chapter_context": str(chapter_context or ""),
        "chapter_summary": str(chapter_summary or ""),
        "chapter_detail_xml": str(chapter_detail_xml or ""),
        "request": str(request_text or ""),
    }
    context = runner.context_manager.build_context({"lecture_name": lecture_name, "book_name": book_name})
    prompt_pack = runner.get_prompt_templates()
    system_prompt = runner.context_manager.render(prompt_pack["system"], context, prompt_vars)
    user_prompt = runner.context_manager.render(prompt_pack["user"], context, prompt_vars)
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
    tools = [
        {
            "type": "function",
            "function": {
                "name": "read",
                "description": "Read chapter raw text by offset and length. Reads must stay inside the current chapter range.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "offset": {"type": "integer"},
                        "length": {"type": "integer"},
                    },
                    "required": ["offset", "length"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write",
                "description": "Write structured questions for current chapter.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_name": {"type": "string"},
                        "chapter_range": {"type": "string"},
                        "questions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "question_title": {"type": "string"},
                                    "question_difficulty": {"type": "string"},
                                    "question_content": {"type": "string"},
                                    "question_hint": {"type": "string"},
                                    "question_answer": {"type": "string"},
                                },
                                "required": [
                                    "question_title",
                                    "question_difficulty",
                                    "question_content",
                                    "question_hint",
                                    "question_answer",
                                ],
                            },
                        },
                    },
                    "required": ["chapter_name", "chapter_range", "questions"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "done",
                "description": "Mark current chapter question generation done after write.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]
    saved_text = ""
    wrote_once = False
    max_turns = 24
    log_event(
        "question_loop_start",
        "出题循环开始",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "model_name": str(runner.model_name or ""),
            "stream": bool(stream),
            "think": bool(think),
            "request_timeout": int(request_timeout),
            "max_turns": int(max_turns),
            "message_count": len(messages),
            "chapter_name": chapter_name,
            "chapter_range": chapter_range,
        },
    )
    for turn in range(1, max_turns + 1):
        req_started = time.time()
        log_event(
            "question_turn_request",
            "出题轮次请求发送",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "turn": int(turn),
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "messages_count": len(messages),
                "stream": bool(stream),
                "think": bool(think),
            },
        )
        response = runner.nexora_client.proxy.chat_completions(
            messages=messages,
            model=runner.model_name,
            username=None,
            options={
                "temperature": float(temperature),
                "max_tokens": int(max_output_tokens),
                "stream": bool(stream),
                "think": bool(think),
                "tools": tools,
                "tool_choice": "auto",
            },
            use_chat_path=False,
            request_timeout=int(request_timeout),
            on_delta=on_delta,
        )
        cost_ms = int((time.time() - req_started) * 1000)
        log_event(
            "question_turn_response",
            "出题轮次收到响应",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "turn": int(turn),
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "cost_ms": cost_ms,
                "ok": bool(response.get("ok")),
            },
        )
        if not bool(response.get("ok")):
            raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")
        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        if not choices:
            raise RuntimeError("Question generation returned empty choices")
        msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
        assistant_content = str((msg or {}).get("content") or "")
        tool_calls = msg.get("tool_calls") if isinstance(msg, dict) and isinstance(msg.get("tool_calls"), list) else []
        messages.append({"role": "assistant", "content": assistant_content if assistant_content else None, "tool_calls": tool_calls if tool_calls else None})

        turn_has_done = False
        if tool_calls:
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                call_id = str(call.get("id") or "")
                func = call.get("function") if isinstance(call.get("function"), dict) else {}
                tool_name = str(func.get("name") or "")
                args = safe_json_obj(str(func.get("arguments") or "{}"))
                if tool_name == "write":
                    question_items = _normalize_questions(args.get("questions"))
                    if len(question_items) != 9:
                        tool_result = {"ok": False, "error": f"questions count must be 9, got {len(question_items)}"}
                        log_tool_flow(
                            tool_name=str(tool_name or ""),
                            arguments=args,
                            tool_output=tool_result,
                            model_output=assistant_content[:800],
                            source="question_generation",
                        )
                        messages.append({"role": "tool", "tool_call_id": call_id, "content": str(tool_result)})
                        continue
                    xml_text = (
                        "<chapter_questions>\n"
                        f"  <chapter_name>{_xml_escape(chapter_name)}</chapter_name>\n"
                        f"  <chapter_range>{_xml_escape(chapter_range)}</chapter_range>\n"
                        f"{_render_question_items_xml(question_items)}\n"
                        "</chapter_questions>"
                    )
                    saved_text = xml_text
                    wrote_once = True
                    tool_result = {
                        "ok": True,
                        "chars": len(xml_text),
                        "questions_count": len(question_items),
                        "chapter_name": chapter_name,
                        "chapter_range": chapter_range,
                    }
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "write",
                            "title": f"写入题目 {chapter_range}",
                            "preview": (question_items[0].get("question_title") if question_items else "")[:50],
                        },
                    )
                elif tool_name == "done":
                    turn_has_done = True
                    tool_result = {"ok": True, "done": True, "wrote": bool(wrote_once)}
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "done",
                            "title": "章节题目生成完成",
                            "preview": "",
                        },
                    )
                elif tool_name == "read":
                    tool_result = _exec_read_book_text_tool_in_range(
                        full_text=full_text,
                        chapter_start=range_start,
                        chapter_length=range_length,
                        arguments=args,
                    )
                    r_off = int(tool_result.get("offset") or 0)
                    r_len = int(tool_result.get("length") or 0)
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "read",
                            "title": f"读取内容 [{r_off}, {r_off + max(0, r_len)}]",
                            "preview": str(tool_result.get("text") or "")[:50],
                        },
                    )
                else:
                    tool_result = {"ok": False, "error": f"unsupported tool: {tool_name}"}
                log_tool_flow(
                    tool_name=str(tool_name or ""),
                    arguments=args,
                    tool_output=tool_result,
                    model_output=assistant_content[:800],
                    source="question_generation",
                )
                messages.append({"role": "tool", "tool_call_id": call_id, "content": str(tool_result)})
            if wrote_once and turn_has_done:
                break
        log_event(
            "question_tool_round",
            "出题工具轮次",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "turn": int(turn),
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "done": bool(turn_has_done),
                "wrote": bool(wrote_once),
            },
            content=assistant_content[:1200],
        )
        if not (wrote_once and turn_has_done):
            messages.append(
                {
                    "role": "user",
                    "content": "你还没有完成章节题目提交。下一轮必须按顺序调用：write(...) 然后 done(...)；必要时先 read(...) 查看原文细节。",
                }
            )
    if not str(saved_text or "").strip():
        raise RuntimeError("Question model did not complete write+done within strict loop")
    return {
        "questions_xml": saved_text,
        "model_name": runner.model_name,
        "lecture_id": lecture_id,
        "book_id": book_id,
    }
