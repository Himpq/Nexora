"""精读模型流程模块。

实现目标：
1. 使用工具调用法，不依赖 XML 直接输出。
2. 使用强流程循环约束：必须调用 `write` 才允许完成。
"""

from __future__ import annotations

import re
import time
from typing import Any, Callable, Dict, List, Mapping, Tuple


def _xml_escape(value: Any) -> str:
    """Escape text for XML node content."""
    text = str(value or "")
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _parse_range(value: str) -> Tuple[int, int]:
    """Parse START:LENGTH into integer tuple."""
    text = str(value or "").strip()
    if ":" not in text:
        return 0, 0
    left, right = text.split(":", 1)
    try:
        start = int(str(left).strip())
        length = int(str(right).strip())
    except Exception:
        return 0, 0
    if start < 0:
        start = 0
    if length < 0:
        length = 0
    return start, length


def _parse_bookinfo_chapters(bookinfo_xml: str, total_len: int) -> List[Dict[str, Any]]:
    """Extract chapter skeleton from coarse bookinfo xml."""
    text = str(bookinfo_xml or "")
    chapters: List[Dict[str, Any]] = []
    if not text.strip():
        return chapters

    pattern = re.compile(
        r"<chapter_name>(.*?)</chapter_name>.*?<chapter_range>(.*?)</chapter_range>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(text):
        name = str(match.group(1) or "").strip()
        raw_range = str(match.group(2) or "").strip()
        if not name or not raw_range:
            continue
        start, length = _parse_range(raw_range)
        if length <= 0:
            continue
        if start >= total_len:
            continue
        safe_len = min(length, max(0, total_len - start))
        if safe_len <= 0:
            continue
        chapters.append(
            {
                "chapter_name": name,
                "chapter_range": f"{start}:{safe_len}",
                "start": start,
                "length": safe_len,
            }
        )
    return chapters


def _xml_block(tag: str, inner: str, indent: str = "  ") -> str:
    """Render a simple XML block with preserved indentation."""
    body = str(inner or "").strip()
    if not body:
        return f"{indent}<{tag}></{tag}>"
    lines = body.splitlines()
    padded = "\n".join(f"{indent}  {line}" for line in lines)
    return f"{indent}<{tag}>\n{padded}\n{indent}</{tag}>"


def _normalize_object_list(value: Any, *, title_keys: List[str], content_keys: List[str]) -> List[Dict[str, str]]:
    """Normalize model tool arguments into [{title, content}, ...]."""
    rows: List[Dict[str, str]] = []
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            title = ""
            content = ""
            for key in title_keys:
                if str(item.get(key) or "").strip():
                    title = str(item.get(key) or "").strip()
                    break
            for key in content_keys:
                if str(item.get(key) or "").strip():
                    content = str(item.get(key) or "").strip()
                    break
            if title or content:
                rows.append({"title": title, "content": content})
    elif isinstance(value, dict):
        title = ""
        content = ""
        for key in title_keys:
            if str(value.get(key) or "").strip():
                title = str(value.get(key) or "").strip()
                break
        for key in content_keys:
            if str(value.get(key) or "").strip():
                content = str(value.get(key) or "").strip()
                break
        if title or content:
            rows.append({"title": title, "content": content})
    return rows


def _normalize_vocab_list(value: Any) -> List[Dict[str, str]]:
    """Normalize model tool arguments into [{key, value}, ...]."""
    rows: List[Dict[str, str]] = []
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or item.get("term") or item.get("word") or "").strip()
            val = str(item.get("value") or item.get("definition") or item.get("meaning") or "").strip()
            if key or val:
                rows.append({"key": key, "value": val})
    elif isinstance(value, dict):
        key = str(value.get("key") or value.get("term") or value.get("word") or "").strip()
        val = str(value.get("value") or value.get("definition") or value.get("meaning") or "").strip()
        if key or val:
            rows.append({"key": key, "value": val})
    return rows


def _render_key_points_xml(value: Any) -> str:
    """Render structured key points into nested XML."""
    rows = _normalize_object_list(
        value,
        title_keys=["title", "key_point_title", "point_title", "name"],
        content_keys=["content", "key_point_content", "point_content", "description"],
    )
    if not rows:
        return "  <key_points></key_points>"
    blocks: List[str] = []
    for row in rows:
        blocks.append(
            "    <key_point>\n"
            f"      <key_point_title>{_xml_escape(row.get('title') or '')}</key_point_title>\n"
            f"      <key_point_content>{_xml_escape(row.get('content') or '')}</key_point_content>\n"
            "    </key_point>"
        )
    return "  <key_points>\n" + "\n".join(blocks) + "\n  </key_points>"


def _render_vocab_xml(value: Any) -> str:
    """Render vocabulary key/value rows into nested XML."""
    rows = _normalize_vocab_list(value)
    if not rows:
        return "  <specialized_vocabulary></specialized_vocabulary>"
    blocks: List[str] = []
    for row in rows:
        blocks.append(
            "    <vocabulary_item>\n"
            f"      <vocabulary_key>{_xml_escape(row.get('key') or '')}</vocabulary_key>\n"
            f"      <vocabulary_value>{_xml_escape(row.get('value') or '')}</vocabulary_value>\n"
            "    </vocabulary_item>"
        )
    return "  <specialized_vocabulary>\n" + "\n".join(blocks) + "\n  </specialized_vocabulary>"


def _render_notes_xml(value: Any) -> str:
    """Render chapter notes into nested XML."""
    rows = _normalize_object_list(
        value,
        title_keys=["type", "note_type", "title", "label"],
        content_keys=["content", "note_content", "description"],
    )
    if not rows:
        return "  <chapter_notes></chapter_notes>"
    blocks: List[str] = []
    for row in rows:
        blocks.append(
            "    <chapter_note>\n"
            f"      <note_type>{_xml_escape(row.get('title') or '')}</note_type>\n"
            f"      <note_content>{_xml_escape(row.get('content') or '')}</note_content>\n"
            "    </chapter_note>"
        )
    return "  <chapter_notes>\n" + "\n".join(blocks) + "\n  </chapter_notes>"


def _extract_book_detail_blocks(bookdetail_xml: str) -> List[str]:
    """Extract `<book_detail>...</book_detail>` blocks from merged XML."""
    text = str(bookdetail_xml or "")
    if not text.strip():
        return []
    pattern = re.compile(r"<book_detail>\s*.*?\s*</book_detail>", flags=re.IGNORECASE | re.DOTALL)
    return [str(item or "").strip() for item in pattern.findall(text) if str(item or "").strip()]


def _extract_chapter_range_from_detail_block(block_xml: str) -> str:
    """Extract chapter_range from a single book_detail block."""
    text = str(block_xml or "")
    match = re.search(r"<chapter_range>\s*(.*?)\s*</chapter_range>", text, flags=re.IGNORECASE | re.DOTALL)
    return str(match.group(1) or "").strip() if match else ""


def _merge_detail_block(existing_blocks: List[str], new_block: str) -> List[str]:
    """Upsert one chapter detail block by chapter_range; append if not found."""
    incoming = str(new_block or "").strip()
    if not incoming:
        return list(existing_blocks or [])
    incoming_range = _extract_chapter_range_from_detail_block(incoming)
    merged = list(existing_blocks or [])
    if not incoming_range:
        merged.append(incoming)
        return merged
    replaced = False
    for idx, old_block in enumerate(merged):
        old_range = _extract_chapter_range_from_detail_block(old_block)
        if old_range and old_range == incoming_range:
            merged[idx] = incoming
            replaced = True
            break
    if not replaced:
        merged.append(incoming)
    return merged


def _render_book_details_xml(blocks: List[str]) -> str:
    """Render merged book_detail blocks into root XML."""
    body = "\n\n".join([str(item or "").strip() for item in (blocks or []) if str(item or "").strip()])
    return "<book_details>\n" + body + "\n</book_details>"


def run_intensive_reading_once(
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
    save_book_detail_xml: Callable[..., None],
    update_book: Callable[..., None],
    resolve_book_text: Callable[..., str],
    get_intensive_reading_settings: Callable[[Mapping[str, Any]], Dict[str, Any]],
    build_intensive_reading_runner: Callable[[Mapping[str, Any], str], Any],
    as_bool: Callable[[Any, bool], bool],
    log_event: Callable[..., None],
    append_log_text: Callable[[str], None],
    log_tool_flow: Callable[..., None],
    push_book_progress_step: Callable[[str, str, Mapping[str, Any]], None],
    run_intensive_with_tools: Callable[..., Dict[str, Any]],
) -> Dict[str, Any]:
    """手动触发精读：按章节 Chunk 逐章精读并实时合并写入。"""
    resolved_cfg = dict(cfg or {})
    lecture = get_lecture(resolved_cfg, lecture_id)
    book = get_book(resolved_cfg, lecture_id, book_id)
    if lecture is None or book is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")

    text = resolve_book_text(resolved_cfg, lecture_id, book_id, book, force=False)
    if not text.strip():
        raise ValueError("Book text is empty.")

    intensive_cfg = get_intensive_reading_settings(resolved_cfg)
    if not bool(intensive_cfg.get("enabled", True)):
        raise ValueError("intensive_reading is disabled")

    selected_model_name = str(model_name or "").strip() or str(intensive_cfg.get("model_name") or "").strip()
    runner = build_intensive_reading_runner(resolved_cfg, model_name=selected_model_name)
    try:
        intensive_temperature = float(intensive_cfg.get("temperature") or 0.2)
    except Exception:
        intensive_temperature = 0.2
    intensive_max_tokens = max(128, int(intensive_cfg.get("max_output_tokens") or 4000))
    intensive_timeout = max(30, int(intensive_cfg.get("request_timeout") or 240))
    intensive_stream = as_bool(intensive_cfg.get("stream", True), True)
    intensive_think = as_bool(intensive_cfg.get("think", False), False)
    intensive_max_input_chars = max(1000, int(intensive_cfg.get("max_input_chars") or 10000))
    chapters_xml = load_book_info_xml(resolved_cfg, lecture_id, book_id)
    chapters = _parse_bookinfo_chapters(chapters_xml, len(text))
    if not chapters:
        chapters = [
            {
                "chapter_name": "全文",
                "chapter_range": f"0:{len(text)}",
                "start": 0,
                "length": len(text),
            }
        ]

    request_text = (
        "请对当前章节执行精读。"
        "你只能聚焦当前章节范围，不要跳章。"
        "必须通过工具 write 提交结构化精读字段；"
        "如果信息不足，先 read/grep，再 write，最后 done。"
    )
    existing_detail_xml = str(load_book_detail_xml(resolved_cfg, lecture_id, book_id) or "")
    chapter_fragments: List[str] = _extract_book_detail_blocks(existing_detail_xml)
    total = len(chapters)
    for idx, chapter in enumerate(chapters, start=1):
        chapter_name = str(chapter.get("chapter_name") or f"第{idx}章").strip()
        chapter_range = str(chapter.get("chapter_range") or "0:0").strip()
        start = int(chapter.get("start") or 0)
        length = int(chapter.get("length") or 0)
        preload_len = min(max(0, length), intensive_max_input_chars)
        chapter_context = text[start:start + preload_len] if preload_len > 0 else ""
        log_event(
            "intensive_chapter_start",
            "精读章节开始",
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
        result = run_intensive_with_tools(
            runner=runner,
            request_text=request_text,
            lecture_name=str(lecture.get("title") or ""),
            book_name=str(book.get("title") or ""),
            full_text=text,
            chapters_xml=chapters_xml,
            lecture_id=lecture_id,
            book_id=book_id,
            temperature=intensive_temperature,
            max_output_tokens=intensive_max_tokens,
            request_timeout=intensive_timeout,
            stream=intensive_stream,
            think=intensive_think,
            chapter_name=chapter_name,
            chapter_range=chapter_range,
            chapter_context=chapter_context,
            on_delta=lambda delta: append_log_text(str(delta or "")),
            log_tool_flow=log_tool_flow,
            push_book_progress_step=push_book_progress_step,
        )
        chapter_xml = str(result.get("bookdetail_xml") or "").strip()
        if chapter_xml:
            chapter_fragments = _merge_detail_block(chapter_fragments, chapter_xml)
            merged_xml = _render_book_details_xml(chapter_fragments)
            save_book_detail_xml(resolved_cfg, lecture_id, book_id, merged_xml)
        log_event(
            "intensive_chapter_done",
            "精读章节完成",
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
    merged_final_xml = _render_book_details_xml(chapter_fragments)
    save_book_detail_xml(resolved_cfg, lecture_id, book_id, merged_final_xml)
    update_book(
        resolved_cfg,
        lecture_id,
        book_id,
        {
            "refinement_status": "done",
            "refinement_error": "",
            "refined_at": int(time.time()),
            "intensive_status": "done",
            "intensive_error": "",
            "intensive_model": str(runner.model_name or ""),
        },
    )
    log_event(
        "book_intensive_done",
        "教材精读完成",
        payload={"lecture_id": lecture_id, "book_id": book_id, "actor": actor},
        content=str(merged_final_xml or "")[:12000],
    )
    return {
        "success": True,
        "lecture_id": lecture_id,
        "book_id": book_id,
        "model_name": str(runner.model_name or ""),
        "bookdetail_chars": len(str(merged_final_xml or "")),
    }


def run_intensive_with_tools_strict(
    *,
    runner: Any,
    request_text: str,
    lecture_name: str,
    book_name: str,
    full_text: str,
    chapters_xml: str,
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
    on_delta: Callable[[str], None],
    log_tool_flow: Callable[..., None],
    push_book_progress_step: Callable[[str, str, Mapping[str, Any]], None],
    safe_json_obj: Callable[[str], Dict[str, Any]],
    exec_read_book_text_tool: Callable[..., Dict[str, Any]],
    exec_search_book_text_tool: Callable[..., Dict[str, Any]],
    log_event: Callable[..., None],
) -> Dict[str, Any]:
    """强循环版精读流程：未调用 write 时继续循环，最多 24 轮。"""
    prompt_vars = {
        "lecture_name": str(lecture_name or ""),
        "book_name": str(book_name or ""),
        "chapter_name": str(chapter_name or "当前章节"),
        "chapter_range": str(chapter_range or f"0:{len(full_text)}"),
        "chapter_context": str(chapter_context or ""),
        "request": request_text,
        "coarse_bookinfo": str(chapters_xml or ""),
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
                "description": "Read full-book text by global offset and length.",
                "parameters": {
                    "type": "object",
                    "properties": {"offset": {"type": "integer"}, "length": {"type": "integer"}},
                    "required": ["offset", "length"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "grep",
                "description": "Search keyword in full book text and return matched ranges with snippets.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "keyword": {"type": "string"},
                        "context_range": {"type": "integer"},
                        "max_hits": {"type": "integer"},
                    },
                    "required": ["keyword"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write",
                "description": "Write structured intensive-reading fields. key_points must be an array of {key_point_title, key_point_content}; specialized_vocabulary must be an array of {key, value}; chapter_notes must be an array of {note_type, note_content}. Required to finish the chapter.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chapter_name": {"type": "string"},
                        "chapter_range": {"type": "string"},
                        "key_points": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "key_point_title": {"type": "string"},
                                    "key_point_content": {"type": "string"},
                                },
                                "required": ["key_point_title", "key_point_content"],
                            },
                        },
                        "specialized_vocabulary": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "key": {"type": "string"},
                                    "value": {"type": "string"},
                                },
                                "required": ["key", "value"],
                            },
                        },
                        "chapter_notes": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "note_type": {"type": "string"},
                                    "note_content": {"type": "string"},
                                },
                                "required": ["note_type", "note_content"],
                            },
                        },
                        "chapter_summary": {"type": "string"},
                    },
                    "required": [
                        "chapter_name",
                        "chapter_range",
                        "key_points",
                        "specialized_vocabulary",
                        "chapter_notes",
                        "chapter_summary",
                    ],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "savemem",
                "description": "Save temporary memory for current chapter processing progress.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "memory": {"type": "string"},
                    },
                    "required": ["memory"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "done",
                "description": "Mark current chapter done after write has succeeded.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                },
            },
        },
    ]

    saved_text = ""
    wrote_once = False
    tempmem: List[str] = []
    max_turns = 24
    log_event(
        "intensive_loop_start",
        "精读循环开始",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "model_name": str(runner.model_name or ""),
            "stream": bool(stream),
            "think": bool(think),
            "request_timeout": int(request_timeout),
            "max_turns": int(max_turns),
            "message_count": len(messages),
        },
    )
    for turn in range(1, max_turns + 1):
        req_started = time.time()
        log_event(
            "intensive_turn_request",
            "精读轮次请求发送",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "turn": int(turn),
                "model_name": str(runner.model_name or ""),
                "messages_count": len(messages),
                "stream": bool(stream),
                "think": bool(think),
                "request_timeout": int(request_timeout),
            },
        )
        try:
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
        except Exception as exc:
            cost_ms = int((time.time() - req_started) * 1000)
            log_event(
                "intensive_turn_request_error",
                "精读轮次请求异常",
                payload={
                    "lecture_id": lecture_id,
                    "book_id": book_id,
                    "turn": int(turn),
                    "cost_ms": cost_ms,
                },
                content=str(exc),
            )
            raise
        cost_ms = int((time.time() - req_started) * 1000)
        log_event(
            "intensive_turn_response",
            "精读轮次收到响应",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "turn": int(turn),
                "cost_ms": cost_ms,
                "ok": bool(response.get("ok")),
            },
        )
        if not bool(response.get("ok")):
            raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")
        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        if not choices:
            raise RuntimeError("Intensive reading returned empty choices")
        msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
        assistant_content = str((msg or {}).get("content") or "")
        tool_calls = msg.get("tool_calls") if isinstance(msg, dict) and isinstance(msg.get("tool_calls"), list) else []
        messages.append({"role": "assistant", "content": assistant_content if assistant_content else None, "tool_calls": tool_calls if tool_calls else None})

        wrote = False
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
                    out_chapter_name = str(args.get("chapter_name") or chapter_name).strip() or str(chapter_name or "")
                    out_chapter_range = str(args.get("chapter_range") or chapter_range).strip() or str(chapter_range or "")
                    out_key_points = args.get("key_points")
                    out_vocab = args.get("specialized_vocabulary")
                    out_notes = args.get("chapter_notes")
                    out_summary = str(args.get("chapter_summary") or "").strip()
                    xml_text = (
                        "<book_detail>\n"
                        f"  <chapter_name>{_xml_escape(out_chapter_name)}</chapter_name>\n"
                        f"  <chapter_range>{_xml_escape(out_chapter_range)}</chapter_range>\n"
                        f"{_render_key_points_xml(out_key_points)}\n"
                        f"{_render_vocab_xml(out_vocab)}\n"
                        f"{_render_notes_xml(out_notes)}\n"
                        f"  <chapter_summary>{_xml_escape(out_summary)}</chapter_summary>\n"
                        "</book_detail>"
                    )
                    saved_text = xml_text
                    wrote_once = True
                    wrote = True
                    tool_result = {"ok": True, "chars": len(xml_text)}
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "write",
                            "title": f"写入精读章节 {out_chapter_range}",
                            "preview": str(out_summary or "")[:50],
                        },
                    )
                elif tool_name == "savemem":
                    memory = str(args.get("memory") or "").strip()
                    if memory:
                        tempmem.append(memory)
                    tool_result = {"ok": True, "tempmem_count": len(tempmem)}
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "savemem",
                            "title": "保存临时记忆",
                            "preview": str(memory or "")[:50],
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
                            "title": "章节处理完成",
                            "preview": "",
                        },
                    )
                elif tool_name in {"read", "read_book_text"}:
                    tool_result = exec_read_book_text_tool(full_text=full_text, total_len=len(full_text), arguments=args)
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
                elif tool_name in {"grep", "search_book_text"}:
                    tool_result = exec_search_book_text_tool(full_text=full_text, total_len=len(full_text), arguments=args)
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "grep",
                            "title": "检索关键词",
                            "preview": str(args.get("keyword") or "")[:50],
                        },
                    )
                else:
                    tool_result = {"ok": False, "error": f"unsupported tool: {tool_name}"}
                log_tool_flow(
                    tool_name=str(tool_name or ""),
                    arguments=args,
                    tool_output=tool_result,
                    model_output=assistant_content[:800],
                )
                messages.append({"role": "tool", "tool_call_id": call_id, "content": str(tool_result)})
            if wrote_once and turn_has_done:
                break

        log_event(
            "intensive_tool_round",
            "精读工具轮次",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "turn": int(turn),
                "wrote": bool(wrote),
                "done": bool(turn_has_done),
                "tempmem_count": len(tempmem),
            },
            content=assistant_content[:1200],
        )
        if not (wrote_once and turn_has_done):
            messages.append(
                {
                    "role": "user",
                    "content": "你还没有完成章节提交。下一轮必须按顺序调用：write(...) 然后 done(...)；必要时先 read/grep/savemem。",
                }
            )

    if not str(saved_text or "").strip():
        raise RuntimeError("Intensive model did not complete write+done within strict loop")

    return {
        "bookdetail_xml": saved_text,
        "model_name": runner.model_name,
        "lecture_id": lecture_id,
        "book_id": book_id,
    }
