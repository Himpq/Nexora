"""Split intensive-reading chapters into session blocks with a strict tool loop."""

from __future__ import annotations

import re
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Mapping, Tuple

from .compress import build_llm_compress_func
from .context import Context, ContextPolicy


_MAX_SECTION_READ_CHARS_PER_CALL = 8000


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


def _parse_model_range(value: str, chapter_start: int, chapter_end: int) -> Tuple[int, int]:
    """Parse a model-submitted range string. Accepts both from:to and start:length.

    Heuristic: if right > left and right <= chapter_end, treat as from:to;
    otherwise treat as start:length (legacy).
    Returns (start, length) in internal format.
    """
    text = str(value or "").strip()
    if ":" not in text:
        return 0, 0
    left_str, right_str = text.split(":", 1)
    try:
        left = int(str(left_str).strip())
        right = int(str(right_str).strip())
    except Exception:
        return 0, 0
    if right <= 0:
        return max(0, left), 0
    # If right looks like a valid end offset (right > left and within chapter bounds), treat as from:to
    if right > left and right <= chapter_end:
        return max(0, left), max(0, right - left)
    # Otherwise treat as start:length (legacy)
    return max(0, left), max(0, right)


def _extract_coarse_chapters(bookinfo_xml: str) -> List[Dict[str, Any]]:
    text = str(bookinfo_xml or "")
    if not text.strip():
        return []
    pattern = re.compile(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>\s*"
        r"<chapter_range>\s*(.*?)\s*</chapter_range>\s*"
        r"(?:<chapter_status>\s*(.*?)\s*</chapter_status>\s*)?"
        r"<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    rows: List[Dict[str, Any]] = []
    for match in pattern.finditer(text):
        chapter_name = str(match.group(1) or "").strip()
        chapter_range = str(match.group(2) or "").strip()
        chapter_summary = str(match.group(4) or "").strip()
        start, length = _parse_range(chapter_range)
        if not chapter_name or length <= 0:
            continue
        rows.append(
            {
                "chapter_name": chapter_name,
                "chapter_range": f"{start}:{length}",
                "chapter_summary": chapter_summary,
                "chapter_detail_xml": "",
                "start": start,
                "length": length,
            }
        )
    rows.sort(key=lambda item: int(item.get("start") or 0))
    return rows


def _validate_canonical_chapters(rows: List[Dict[str, Any]], *, total_chars: int) -> List[Dict[str, Any]]:
    if not rows:
        raise ValueError("bookinfo.xml 中没有可用于分节的章节目录，必须先完成有效的粗读章节提取。")

    issues: List[str] = []
    normalized: List[Dict[str, Any]] = []
    previous_end = 0
    seen_ranges = set()
    text_length = max(0, int(total_chars or 0))

    for idx, row in enumerate(rows, start=1):
        chapter_name = str(row.get("chapter_name") or "").strip()
        start = int(row.get("start") or 0)
        length = int(row.get("length") or 0)
        end = start + length
        chapter_range = f"{start}:{length}"

        if not chapter_name:
            issues.append(f"第 {idx} 个章节缺少 chapter_name")

        if length <= 0:
            issues.append(f"{chapter_name or idx} 的 chapter_range 无效: {row.get('chapter_range')}")

        if start < 0 or end > text_length:
            issues.append(f"{chapter_name or idx} 超出正文范围: {chapter_range}, text_chars={text_length}")

        if start < previous_end:
            issues.append(f"{chapter_name or idx} 与前一章节重叠或顺序错误: {chapter_range}")

        if chapter_range in seen_ranges:
            issues.append(f"{chapter_name or idx} 重复 chapter_range: {chapter_range}")

        seen_ranges.add(chapter_range)
        previous_end = max(previous_end, end)

        fixed = dict(row)
        fixed["chapter_name"] = chapter_name
        fixed["chapter_range"] = chapter_range
        fixed["start"] = start
        fixed["length"] = length
        normalized.append(fixed)

    if issues:
        preview = "；".join(issues[:8])
        if len(issues) > 8:
            preview += f"；另有 {len(issues) - 8} 个问题"
        raise ValueError(f"bookinfo.xml 章节目录校验失败，已停止分节: {preview}")

    return normalized


def _detail_range_candidates(raw_range: str, *, total_chars: int) -> List[str]:
    text = str(raw_range or "").strip()
    if ":" not in text:
        return []

    left_text, right_text = text.split(":", 1)

    try:
        left = int(str(left_text).strip())
        right = int(str(right_text).strip())
    except Exception:
        return []

    candidates: List[str] = []
    text_length = max(0, int(total_chars or 0))

    if left >= 0 and right > 0 and left + right <= text_length:
        candidates.append(f"{left}:{right}")

    if left >= 0 and right > left and right <= text_length:
        candidates.append(f"{left}:{right - left}")

    return candidates


def _extract_detail_blocks_by_range(
    bookdetail_xml: str,
    *,
    canonical_ranges: set,
    total_chars: int,
) -> Tuple[Dict[str, str], List[str]]:
    text = str(bookdetail_xml or "")
    if not text.strip():
        return {}, []

    blocks = re.findall(r"<book_detail>\s*.*?\s*</book_detail>", text, flags=re.IGNORECASE | re.DOTALL)
    detail_by_range: Dict[str, str] = {}
    issues: List[str] = []

    for block in blocks:
        name_match = re.search(r"<chapter_name>\s*(.*?)\s*</chapter_name>", block, flags=re.IGNORECASE | re.DOTALL)
        range_match = re.search(r"<chapter_range>\s*(.*?)\s*</chapter_range>", block, flags=re.IGNORECASE | re.DOTALL)
        chapter_name = str(name_match.group(1) or "").strip() if name_match else ""
        raw_range = str(range_match.group(1) or "").strip() if range_match else ""

        matched_range = ""
        for candidate in _detail_range_candidates(raw_range, total_chars=total_chars):
            if candidate in canonical_ranges:
                matched_range = candidate
                break

        if not matched_range:
            issues.append(f"{chapter_name or '(无标题)'}:{raw_range or '(无范围)'}")
            continue

        if matched_range in detail_by_range:
            issues.append(f"{chapter_name or '(无标题)'}:{raw_range} 重复绑定 {matched_range}")
            continue

        detail_by_range[matched_range] = str(block or "").strip()

    return detail_by_range, issues


def _extract_existing_section_blocks(sections_xml: str) -> List[str]:
    text = str(sections_xml or "")
    if not text.strip():
        return []
    pattern = re.compile(r"<chapter_sessions>\s*.*?\s*</chapter_sessions>", flags=re.IGNORECASE | re.DOTALL)
    return [str(block or "").strip() for block in pattern.findall(text) if str(block or "").strip()]


def _extract_section_block_range(block_xml: str) -> str:
    match = re.search(r"<chapter_range>\s*(.*?)\s*</chapter_range>", str(block_xml or ""), flags=re.IGNORECASE | re.DOTALL)
    return str(match.group(1) or "").strip() if match else ""


def _filter_section_blocks_by_catalog(blocks: List[str], canonical_ranges: set) -> Tuple[List[str], List[str]]:
    kept: List[str] = []
    dropped: List[str] = []

    for block in blocks:
        block_text = str(block or "").strip()
        block_range = _extract_section_block_range(block_text)

        if block_range and block_range in canonical_ranges:
            kept.append(block_text)
            continue

        dropped.append(block_range or "(missing chapter_range)")

    return kept, dropped


def _extract_existing_session_lengths(sections_xml: str) -> List[int]:
    matches = re.findall(r"<session_range>\s*(.*?)\s*</session_range>", str(sections_xml or ""), flags=re.IGNORECASE | re.DOTALL)
    lengths: List[int] = []
    for raw in matches:
        _, length = _parse_range(str(raw or ""))
        if length > 0:
            lengths.append(length)
    return lengths


def _merge_section_block(existing_blocks: List[str], new_block: str) -> List[str]:
    incoming = str(new_block or "").strip()
    if not incoming:
        return list(existing_blocks or [])
    incoming_range = _extract_section_block_range(incoming)
    merged = list(existing_blocks or [])
    if not incoming_range:
        merged.append(incoming)
        return merged
    replaced = False
    for idx, old_block in enumerate(merged):
        if _extract_section_block_range(old_block) == incoming_range:
            merged[idx] = incoming
            replaced = True
            break
    if not replaced:
        merged.append(incoming)
    return merged


def _render_sections_root(blocks: List[str]) -> str:
    body = "\n\n".join([str(item or "").strip() for item in blocks if str(item or "").strip()])
    return "<sections>\n" + body + "\n</sections>"


def _normalize_sessions(value: Any) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    if not isinstance(value, list):
        return rows
    for item in value:
        if not isinstance(item, dict):
            continue
        session_name = str(item.get("session_name") or item.get("name") or "").strip()
        session_range = str(item.get("session_range") or item.get("range") or "").strip()
        session_summary = str(item.get("session_summary") or item.get("summary") or "").strip()
        if not session_name or not session_range:
            continue
        rows.append(
            {
                "session_name": session_name,
                "session_range": session_range,
                "session_summary": session_summary,
            }
        )
    return rows


def _validate_sessions(
    sessions: List[Dict[str, str]],
    *,
    chapter_name: str,
    chapter_range: str,
) -> Tuple[bool, str, List[Dict[str, Any]]]:
    chapter_start, chapter_length = _parse_range(chapter_range)
    chapter_end = chapter_start + chapter_length
    if chapter_length <= 0:
        return False, f"chapter_range 无效: {chapter_range}", []
    if not sessions:
        return False, f"{chapter_name} 没有提交任何 session", []

    normalized: List[Dict[str, Any]] = []
    cursor = chapter_start
    for idx, row in enumerate(sessions, start=1):
        session_name = str(row.get("session_name") or "").strip()
        session_range = str(row.get("session_range") or "").strip()
        session_summary = str(row.get("session_summary") or "").strip()
        start, length = _parse_model_range(session_range, chapter_start, chapter_end)
        end = start + length
        if not session_name:
            return False, f"{chapter_name} 第 {idx} 个 session 缺少 session_name", []
        if length <= 0:
            return False, f"{chapter_name} 第 {idx} 个 session_range 无效: {session_range}。格式应为 from:to（如 {chapter_start}:{chapter_end}），from 和 to 都是文件绝对偏移量。", []
        if start != cursor:
            return False, f"{chapter_name} 第 {idx} 个 session 起点应为 {cursor}，实际为 {start}。session_range 格式为 from:to（绝对偏移），当前 chapter 为 {chapter_start}:{chapter_end}。", []
        if end > chapter_end:
            return False, f"{chapter_name} 第 {idx} 个 session 结束于 {end}，超出 chapter 末尾 {chapter_end}。session_range 格式为 from:to（绝对偏移），当前 chapter 为 {chapter_start}:{chapter_end}。", []
        normalized.append(
            {
                "session_index": idx,
                "session_name": session_name,
                "session_range": f"{start}:{length}",
                "session_summary": session_summary,
                "start": start,
                "length": length,
                "end": end,
            }
        )
        cursor = end

    if cursor != chapter_end:
        return False, f"{chapter_name} 最后一个 session 必须在 {chapter_end} 结尾，当前结束于 {cursor}。session_range 格式为 from:to（绝对偏移），当前 chapter 为 {chapter_start}:{chapter_end}。", []
    return True, "", normalized


def _render_session_items_xml(items: List[Dict[str, Any]]) -> str:
    if not items:
        return "  <session_items></session_items>"
    rows: List[str] = []
    for item in items:
        rows.append(
            "    <session_item>\n"
            f"      <session_index>{int(item.get('session_index') or 0)}</session_index>\n"
            f"      <session_name>{_xml_escape(item.get('session_name') or '')}</session_name>\n"
            f"      <session_range>{_xml_escape(item.get('session_range') or '')}</session_range>\n"
            f"      <session_summary>{_xml_escape(item.get('session_summary') or '')}</session_summary>\n"
            "    </session_item>"
        )
    return "  <session_items>\n" + "\n".join(rows) + "\n  </session_items>"


def _build_chapter_sessions_block(chapter_name: str, chapter_range: str, items: List[Dict[str, Any]]) -> str:
    return (
        "<chapter_sessions>\n"
        f"  <chapter_name>{_xml_escape(chapter_name)}</chapter_name>\n"
        f"  <chapter_range>{_xml_escape(chapter_range)}</chapter_range>\n"
        f"  <session_count>{len(items)}</session_count>\n"
        f"{_render_session_items_xml(items)}\n"
        "</chapter_sessions>"
    )


def _exec_read_book_text_tool_in_range(
    *,
    full_text: str,
    chapter_start: int,
    chapter_length: int,
    arguments: Mapping[str, Any],
) -> Dict[str, Any]:
    total_len = len(full_text or "")
    safe_start = max(0, min(int(chapter_start or 0), total_len))
    safe_end = max(safe_start, min(safe_start + max(0, int(chapter_length or 0)), total_len))
    offset = int(arguments.get("offset") or safe_start)
    requested_length = int(arguments.get("length") or 0)
    length = requested_length
    if length < 0:
        length = 0
    if offset < safe_start:
        offset = safe_start
    if offset > safe_end:
        offset = safe_end
    if length == 0:
        length = min(_MAX_SECTION_READ_CHARS_PER_CALL, max(0, safe_end - offset))
    if length > _MAX_SECTION_READ_CHARS_PER_CALL:
        length = _MAX_SECTION_READ_CHARS_PER_CALL
    if offset + length > safe_end:
        length = max(0, safe_end - offset)
    text = str(full_text or "")[offset:offset + length]
    return {
        "ok": True,
        "offset": offset,
        "length": length,
        "requested_length": requested_length,
        "truncated": bool(length < max(0, requested_length)) if requested_length > 0 else bool(length < max(0, safe_end - offset)),
        "max_chars_per_call": _MAX_SECTION_READ_CHARS_PER_CALL,
        "chapter_range": f"{safe_start}:{safe_end}",
        "text": text,
    }


def _exec_find_book_text_tool_in_range(
    *,
    full_text: str,
    chapter_start: int,
    chapter_length: int,
    arguments: Mapping[str, Any],
) -> Dict[str, Any]:
    keyword = str(arguments.get("keyword") or "").strip()
    if not keyword:
        return {"ok": False, "error": "keyword is required"}
    context_range = max(20, min(600, int(arguments.get("context_range") or 80)))
    max_hits = max(1, min(20, int(arguments.get("max_hits") or 5)))
    total_len = len(full_text or "")
    safe_start = max(0, min(int(chapter_start or 0), total_len))
    safe_end = max(safe_start, min(safe_start + max(0, int(chapter_length or 0)), total_len))
    source = str(full_text or "")[safe_start:safe_end]
    cursor = 0
    hits: List[Dict[str, Any]] = []
    while cursor < len(source) and len(hits) < max_hits:
        local_idx = source.find(keyword, cursor)
        if local_idx < 0:
            break
        match_start = safe_start + local_idx
        match_end = match_start + len(keyword)
        block_start = max(safe_start, match_start - context_range)
        block_end = min(safe_end, match_end + context_range)
        snippet = str(full_text or "")[block_start:block_end]
        hits.append(
            {
                "offset": int(match_start),
                "match_start": int(match_start),
                "match_end": int(match_end),
                "range": f"{block_start}:{block_end}",
                "text": snippet,
            }
        )
        cursor = local_idx + max(1, len(keyword))
    return {
        "ok": True,
        "keyword": keyword,
        "chapter_range": f"{safe_start}:{safe_end}",
        "hits_count": len(hits),
        "hits": hits,
        "text": "\n\n".join([f"[offset={row['offset']}, {row['range']}]\n{row['text']}" for row in hits]),
    }


def run_split_chapters_with_tools(
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
    chapter_detail_xml: str,
    historical_avg_session_chars: int,
    target_session_count_hint: int,
    on_delta: Callable[[str], None],
    log_event: Callable[..., None],
    push_book_progress_step: Callable[[str, str, Mapping[str, Any]], None],
    cfg: Mapping[str, Any],
) -> Dict[str, Any]:
    chapter_start, chapter_length = _parse_range(chapter_range)
    prompt_vars = {
        "lecture_name": str(lecture_name or ""),
        "book_name": str(book_name or ""),
        "chapter_name": str(chapter_name or ""),
        "chapter_range": str(chapter_range or ""),
        "chapter_context": str(chapter_context or ""),
        "chapter_detail_xml": str(chapter_detail_xml or ""),
        "historical_avg_session_chars": int(historical_avg_session_chars or 0),
        "target_session_count_hint": int(target_session_count_hint or 1),
        "request": str(request_text or ""),
    }
    context = runner.context_manager.build_context({"lecture_name": lecture_name, "book_name": book_name})
    prompt_pack = runner.get_prompt_templates()
    system_prompt = runner.context_manager.render(prompt_pack["system"], context, prompt_vars)
    user_prompt = runner.context_manager.render(prompt_pack["user"], context, prompt_vars)
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
    llm_compress_func = build_llm_compress_func(runner, cfg)
    ctx = Context(
        max_chars=15000,
        policy=ContextPolicy.LLM_COMPRESS,
        llm_compress_func=llm_compress_func,
        trace_meta={
            "flow": "section_loop",
            "lecture_id": str(lecture_id or ""),
            "book_id": str(book_id or ""),
            "chapter_name": str(chapter_name or ""),
            "chapter_range": str(chapter_range or ""),
        },
    )
    for msg in messages:
        ctx.add(str(msg.get("role") or ""), str(msg.get("content") or ""))
    tools = [
        {
            "type": "function",
            "function": {
                "name": "read",
                "description": "Read raw text inside the current chapter range only.",
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
                "name": "savemem",
                "description": "Save temporary notes before the next tool round.",
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
                "name": "find",
                "description": "Find exact keyword positions inside the current chapter range only.",
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
                "description": "Submit the full session split of the current chapter. Sessions must cover the whole chapter contiguously and the last session must end at chapter end. session_range format is from:to (absolute file offsets, e.g. '907:1400' means from offset 907 to offset 1400). Do not submit chapter_name or chapter_range again; the server will bind this write to the current chapter automatically.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sessions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "session_name": {"type": "string"},
                                    "session_range": {"type": "string"},
                                    "session_summary": {"type": "string"},
                                },
                                "required": ["session_name", "session_range", "session_summary"],
                            },
                        },
                    },
                    "required": ["sessions"],
                },
            },
        },
    ]

    saved_text = ""
    wrote_once = False
    saved_lengths: List[int] = []
    tempmem: List[str] = []
    read_seen: set[tuple[int, int]] = set()
    max_turns = 100
    write_rejected_count = 0
    log_event(
        "section_turn_loop_start",
        "分节章节循环开始",
        payload={
            "lecture_id": lecture_id,
            "book_id": book_id,
            "chapter_name": chapter_name,
            "chapter_range": chapter_range,
            "model_name": str(runner.model_name or ""),
            "max_turns": int(max_turns),
        },
    )
    for turn in range(1, max_turns + 1):
        executed = ctx.prepare()

        if executed:
            log_event(
                "context_operation",
                "上下文压缩",
                payload={
                    "lecture_id": lecture_id,
                    "book_id": book_id,
                    "chapter_name": chapter_name,
                    "chapter_range": chapter_range,
                    "turn": int(turn),
                    "policy": ctx.policy.value,
                    "context_chars": ctx.chars(),
                    "messages_count": ctx.count(),
                },
            )

        messages = ctx.build()
        req_started = time.time()
        log_event(
            "section_turn_request",
            "分节轮次请求发送",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "turn": int(turn),
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
            "section_turn_response",
            "分节轮次收到响应",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
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
            raise RuntimeError("Split chapters returned empty choices")
        msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
        assistant_content = str((msg or {}).get("content") or "")
        tool_calls = msg.get("tool_calls") if isinstance(msg, dict) and isinstance(msg.get("tool_calls"), list) else []
        ctx.add(
            "assistant",
            assistant_content if assistant_content else "",
            tool_calls=tool_calls if tool_calls else None,
        )

        turn_write_reject_error = ""
        if tool_calls:
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                call_id = str(call.get("id") or "")
                func = call.get("function") if isinstance(call.get("function"), dict) else {}
                tool_name = str(func.get("name") or "").strip()
                raw_args = str(func.get("arguments") or "{}")
                try:
                    args = __import__("json").loads(raw_args or "{}")
                except Exception:
                    args = {}
                tool_result: Dict[str, Any]
                if tool_name == "read":
                    requested_offset = int((args if isinstance(args, dict) else {}).get("offset") or chapter_start)
                    requested_length = int((args if isinstance(args, dict) else {}).get("length") or 0)
                    if requested_length <= 0:
                        requested_length = _MAX_SECTION_READ_CHARS_PER_CALL
                    request_signature = (requested_offset, requested_length)
                    if request_signature in read_seen:
                        advanced_offset = min(
                            chapter_start + chapter_length,
                            max(chapter_start, requested_offset) + max(1, requested_length),
                        )
                        args = dict(args if isinstance(args, dict) else {})
                        args["offset"] = int(advanced_offset)
                        args["length"] = int(requested_length)

                    tool_result = _exec_read_book_text_tool_in_range(
                        full_text=full_text,
                        chapter_start=chapter_start,
                        chapter_length=chapter_length,
                        arguments=args if isinstance(args, dict) else {},
                    )
                    read_seen.add(
                        (
                            int(tool_result.get("offset") or 0),
                            int(tool_result.get("length") or 0),
                        )
                    )
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "read",
                            "title": f"读取原文 {tool_result.get('offset')}:{tool_result.get('length')}",
                            "preview": chapter_name[:48],
                        },
                    )
                elif tool_name == "find":
                    tool_result = _exec_find_book_text_tool_in_range(
                        full_text=full_text,
                        chapter_start=chapter_start,
                        chapter_length=chapter_length,
                        arguments=args if isinstance(args, dict) else {},
                    )
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "find",
                            "title": f"定位原文 {chapter_name}",
                            "preview": str((args or {}).get("keyword") or "")[:50],
                        },
                    )
                elif tool_name == "savemem":
                    memory = str((args or {}).get("memory") or "").strip()
                    if memory:
                        tempmem.append(memory)
                    tool_result = {"ok": True, "memory_count": len(tempmem)}
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "savemem",
                            "title": f"记录拆分思路 {chapter_name}",
                            "preview": memory[:50],
                        },
                    )
                elif tool_name == "write":
                    raw_sessions = _normalize_sessions((args or {}).get("sessions"))
                    ok, error_text, normalized_sessions = _validate_sessions(
                        raw_sessions,
                        chapter_name=chapter_name,
                        chapter_range=chapter_range,
                    )

                    if ok:
                        saved_lengths = [int(item.get("length") or 0) for item in normalized_sessions if int(item.get("length") or 0) > 0]
                        saved_text = _build_chapter_sessions_block(chapter_name, chapter_range, normalized_sessions)
                        wrote_once = True
                        write_rejected_count = 0
                        tool_result = {
                            "ok": True,
                            "session_count": len(normalized_sessions),
                            "chapter_range": chapter_range,
                        }
                        push_book_progress_step(
                            lecture_id,
                            book_id,
                            {
                                "type": "write",
                                "title": f"写入 Session 划分 {chapter_range}",
                                "preview": f"{len(normalized_sessions)} 个 Session",
                            },
                        )
                    else:
                        write_rejected_count += 1
                        turn_write_reject_error = error_text
                        tool_result = {"ok": False, "error": error_text, "chapter_range": chapter_range, "hint": f"第一个 session 必须从 {chapter_start} 开始，session_range 格式为 from:to（绝对偏移）"}
                        push_book_progress_step(
                            lecture_id,
                            book_id,
                            {
                                "type": "write_reject",
                                "title": f"Session 划分被拒绝 {chapter_name}",
                                "preview": error_text[:80],
                            },
                        )
                else:
                    tool_result = {"ok": False, "error": f"unsupported tool: {tool_name}"}
                ctx.add(
                    "tool",
                    __import__("json").dumps(tool_result, ensure_ascii=False),
                    tool_call_id=call_id,
                )
                log_event(
                    "section_tool_result",
                    "分节工具结果",
                    payload={
                        "lecture_id": lecture_id,
                        "book_id": book_id,
                        "chapter_name": chapter_name,
                        "chapter_range": chapter_range,
                        "turn": int(turn),
                        "tool_name": tool_name,
                        "ok": bool(tool_result.get("ok")),
                    },
                    content=__import__("json").dumps(tool_result, ensure_ascii=False)[:1200],
                )

        if wrote_once:
            break

        if turn_write_reject_error:
            ctx.add(
                "user",
                f"write 被拒绝: {turn_write_reject_error}\n请根据错误信息修正后立即重新调用 write(sessions=[...])，不要再调用 read/find。session_range 格式为 from:to（绝对偏移），如 '{chapter_start}:{chapter_start + chapter_length}'。",
            )
        else:
            ctx.add(
                "user",
                f"你还没有完成当前章节的 Session 提交。chapter 为 {chapter_start}:{chapter_start + chapter_length}。请调用 write(sessions=[...])，session_range 使用 from:to 格式（绝对偏移），第一个 session 必须从 {chapter_start} 开始。",
            )

    if not str(saved_text or "").strip():
        raise RuntimeError(f"Split chapter model did not complete write within {max_turns} turns (write rejected {write_rejected_count} times)")

    return {
        "sections_xml": saved_text,
        "model_name": runner.model_name,
        "session_count": len(saved_lengths),
        "session_lengths": list(saved_lengths),
        "lecture_id": lecture_id,
        "book_id": book_id,
    }


def run_section_generation_once(
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
    load_book_sections_xml: Callable[..., str],
    save_book_sections_xml: Callable[..., str],
    update_book: Callable[..., Any],
    resolve_book_text: Callable[..., str],
    get_split_chapters_settings: Callable[..., Dict[str, Any]],
    build_split_chapters_runner: Callable[..., Any],
    as_bool: Callable[..., bool],
    log_event: Callable[..., None],
    append_log_text: Callable[[str], None],
    push_book_progress_step: Callable[[str, str, Mapping[str, Any]], None],
) -> Dict[str, Any]:
    _ = actor
    resolved_cfg = dict(cfg or {})
    lecture_key = str(lecture_id or "").strip()
    book_key = str(book_id or "").strip()
    if not lecture_key or not book_key:
        raise ValueError("lecture_id and book_id are required.")

    lecture = get_lecture(resolved_cfg, lecture_key)
    if lecture is None:
        raise ValueError(f"Lecture not found: {lecture_key}")
    book = get_book(resolved_cfg, lecture_key, book_key)
    if book is None:
        raise ValueError(f"Book not found: {lecture_key}/{book_key}")

    full_text = str(resolve_book_text(resolved_cfg, lecture_key, book_key, book) or "")
    if not full_text:
        raise ValueError("book text is empty.")

    model_cfg = dict(get_split_chapters_settings(resolved_cfg) or {})
    if not as_bool(model_cfg.get("enabled"), default=True):
        raise ValueError("split_chapters model is disabled.")

    selected_model = str(model_name or model_cfg.get("model_name") or "").strip()
    temperature = float(model_cfg.get("temperature") or 0.2)
    max_output_tokens = int(model_cfg.get("max_output_tokens") or 4000)
    max_input_chars = max(2000, int(model_cfg.get("max_input_chars") or 12000))
    request_timeout = int(model_cfg.get("request_timeout") or 240)
    stream = as_bool(model_cfg.get("stream"), default=True)
    think = as_bool(model_cfg.get("think"), default=False)
    prompt_notes = str(model_cfg.get("prompt_notes") or "").strip()

    runner = build_split_chapters_runner(resolved_cfg, selected_model)
    bookdetail_xml = str(load_book_detail_xml(resolved_cfg, lecture_key, book_key) or "")
    bookinfo_xml = str(load_book_info_xml(resolved_cfg, lecture_key, book_key) or "")
    chapter_rows = _validate_canonical_chapters(
        _extract_coarse_chapters(bookinfo_xml),
        total_chars=len(full_text),
    )
    canonical_ranges = {str(row.get("chapter_range") or "").strip() for row in chapter_rows}
    detail_by_range, detail_issues = _extract_detail_blocks_by_range(
        bookdetail_xml,
        canonical_ranges=canonical_ranges,
        total_chars=len(full_text),
    )

    for row in chapter_rows:
        row["chapter_detail_xml"] = detail_by_range.get(str(row.get("chapter_range") or "").strip(), "")

    if detail_issues:
        log_event(
            "section_detail_catalog_mismatch",
            "分节忽略不属于粗读目录的精读详情",
            payload={
                "lecture_id": lecture_key,
                "book_id": book_key,
                "ignored_count": len(detail_issues),
                "samples": detail_issues[:8],
            },
        )

    existing_xml = str(load_book_sections_xml(resolved_cfg, lecture_key, book_key) or "")
    existing_blocks, dropped_existing_ranges = _filter_section_blocks_by_catalog(
        _extract_existing_section_blocks(existing_xml),
        canonical_ranges,
    )

    if dropped_existing_ranges:
        log_event(
            "section_existing_catalog_mismatch",
            "分节移除不属于粗读目录的历史 Session 块",
            payload={
                "lecture_id": lecture_key,
                "book_id": book_key,
                "dropped_count": len(dropped_existing_ranges),
                "samples": dropped_existing_ranges[:8],
            },
        )

    historical_lengths = _extract_existing_session_lengths(_render_sections_root(existing_blocks))
    total = len(chapter_rows)
    request_text = (
        "请把当前精读章节拆成若干学习 Session。"
        "每个 Session 必须逻辑完整、长度尽量均匀，并完整覆盖整个 chapter。"
        "最后一个 Session 的结尾必须严格等于 chapter end。"
        "必须通过工具 write(sessions=[...]) 提交全部 Session。"
    )
    if prompt_notes:
        request_text = f"{request_text}\n附加要求：{prompt_notes}"

    total_sessions = 0
    for idx, chapter in enumerate(chapter_rows, start=1):
        chapter_name = str(chapter.get("chapter_name") or f"第{idx}章").strip() or f"第{idx}章"
        chapter_range = str(chapter.get("chapter_range") or "0:0").strip()
        chapter_detail_xml = str(chapter.get("chapter_detail_xml") or "").strip()
        chapter_start = int(chapter.get("start") or 0)
        chapter_length = int(chapter.get("length") or 0)
        if chapter_length <= 0:
            continue
        historical_avg = int(sum(historical_lengths) / len(historical_lengths)) if historical_lengths else max(600, min(1600, chapter_length // 3 or 600))
        target_session_count_hint = max(1, round(chapter_length / max(1, historical_avg)))
        preload_len = min(chapter_length, max_input_chars)
        chapter_context = full_text[chapter_start:chapter_start + preload_len] if preload_len > 0 else ""

        log_event(
            "section_chapter_start",
            "章节分节开始",
            payload={
                "lecture_id": lecture_key,
                "book_id": book_key,
                "chapter_index": idx,
                "chapter_total": total,
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "historical_avg_session_chars": historical_avg,
                "target_session_count_hint": target_session_count_hint,
            },
        )

        result = run_split_chapters_with_tools(
            runner=runner,
            request_text=request_text,
            lecture_name=str(lecture.get("title") or ""),
            book_name=str(book.get("title") or ""),
            full_text=full_text,
            lecture_id=lecture_key,
            book_id=book_key,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            request_timeout=request_timeout,
            stream=stream,
            think=think,
            chapter_name=chapter_name,
            chapter_range=chapter_range,
            chapter_context=chapter_context,
            chapter_detail_xml=chapter_detail_xml,
            historical_avg_session_chars=historical_avg,
            target_session_count_hint=target_session_count_hint,
            on_delta=lambda delta: append_log_text(str(delta or "")),
            log_event=log_event,
            push_book_progress_step=push_book_progress_step,
            cfg=resolved_cfg,
        )

        chapter_xml = str(result.get("sections_xml") or "").strip()
        if chapter_xml:
            existing_blocks = _merge_section_block(existing_blocks, chapter_xml)
            merged_xml = _render_sections_root(existing_blocks)
            save_book_sections_xml(resolved_cfg, lecture_key, book_key, merged_xml)
        chapter_lengths = [int(x) for x in list(result.get("session_lengths") or []) if int(x or 0) > 0]
        historical_lengths.extend(chapter_lengths)
        total_sessions += int(result.get("session_count") or len(chapter_lengths) or 0)

        log_event(
            "section_chapter_done",
            "章节分节完成",
            payload={
                "lecture_id": lecture_key,
                "book_id": book_key,
                "chapter_index": idx,
                "chapter_total": total,
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "session_count": int(result.get("session_count") or 0),
            },
        )

    final_xml = _render_sections_root(existing_blocks)
    save_book_sections_xml(resolved_cfg, lecture_key, book_key, final_xml)
    update_book(
        resolved_cfg,
        lecture_key,
        book_key,
        {
            "section_status": "done",
            "section_error": "",
            "section_model": str(getattr(runner, "model_name", "") or ""),
        },
    )
    return {
        "success": True,
        "status": "done",
        "sections_chars": len(final_xml),
        "chapter_count": len(chapter_rows),
        "session_count": total_sessions,
        "model_name": str(getattr(runner, "model_name", "") or ""),
    }
