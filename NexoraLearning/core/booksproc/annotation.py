"""Generate AI annotations for intensive-reading chapters.

This module runs after section generation. It reads each chapter's intensive
reading output (bookdetail.xml) and generates annotations (批注) for key
paragraphs. Annotations are stored in annotations.xml.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from .context import Context, ContextPolicy, ToolDef, ToolTask


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


def _extract_detail_chapters(bookdetail_xml: str) -> List[Dict[str, Any]]:
    text = str(bookdetail_xml or "")
    if not text.strip():
        return []
    blocks = re.findall(r"<book_detail>\s*.*?\s*</book_detail>", text, flags=re.IGNORECASE | re.DOTALL)
    rows: List[Dict[str, Any]] = []
    for block in blocks:
        name_match = re.search(r"<chapter_name>\s*(.*?)\s*</chapter_name>", block, flags=re.IGNORECASE | re.DOTALL)
        range_match = re.search(r"<chapter_range>\s*(.*?)\s*</chapter_range>", block, flags=re.IGNORECASE | re.DOTALL)
        if not name_match or not range_match:
            continue
        chapter_name = str(name_match.group(1) or "").strip()
        chapter_range = str(range_match.group(1) or "").strip()
        start, length = _parse_range(chapter_range)
        if not chapter_name or length <= 0:
            continue
        rows.append(
            {
                "chapter_name": chapter_name,
                "chapter_range": f"{start}:{length}",
                "chapter_detail_xml": str(block or "").strip(),
                "start": start,
                "length": length,
            }
        )
    rows.sort(key=lambda item: int(item.get("start") or 0))
    return rows


def _extract_coarse_chapters(bookinfo_xml: str) -> List[Dict[str, Any]]:
    text = str(bookinfo_xml or "")
    if not text.strip():
        return []
    pattern = re.compile(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>\s*"
        r"<chapter_range>\s*(.*?)\s*</chapter_range>\s*"
        r"<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    rows: List[Dict[str, Any]] = []
    for match in pattern.finditer(text):
        chapter_name = str(match.group(1) or "").strip()
        chapter_range = str(match.group(2) or "").strip()
        chapter_summary = str(match.group(3) or "").strip()
        start, length = _parse_range(chapter_range)
        if not chapter_name or length <= 0:
            continue
        rows.append(
            {
                "chapter_name": chapter_name,
                "chapter_range": f"{start}:{length}",
                "chapter_summary": chapter_summary,
                "start": start,
                "length": length,
            }
        )
    rows.sort(key=lambda item: int(item.get("start") or 0))
    return rows


def _extract_existing_annotations(annotations_xml: str) -> List[Dict[str, Any]]:
    text = str(annotations_xml or "")
    if not text.strip():
        return []
    pattern = re.compile(
        r"<annotation>\s*(.*?)\s*</annotation>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    rows: List[Dict[str, Any]] = []
    for match in pattern.finditer(text):
        block = str(match.group(1) or "")
        chapter_match = re.search(r"<chapter_name>\s*(.*?)\s*</chapter_name>", block, flags=re.IGNORECASE)
        offset_match = re.search(r"<offset>\s*(.*?)\s*</offset>", block, flags=re.IGNORECASE)
        length_match = re.search(r"<length>\s*(.*?)\s*</length>", block, flags=re.IGNORECASE)
        type_match = re.search(r"<annotation_type>\s*(.*?)\s*</annotation_type>", block, flags=re.IGNORECASE)
        content_match = re.search(r"<annotation_content>\s*(.*?)\s*</annotation_content>", block, flags=re.IGNORECASE)
        anchor_match = re.search(r"<anchor_text>\s*(.*?)\s*</anchor_text>", block, flags=re.IGNORECASE | re.DOTALL)
        if not chapter_match or not offset_match:
            continue
        anchor_text = _normalize_anchor_text(str(anchor_match.group(1) or "").strip()) if anchor_match else ""
        rows.append({
            "chapter_name": str(chapter_match.group(1) or "").strip(),
            "offset": int(str(offset_match.group(1) or "0").strip() or 0),
            "length": int(str(length_match.group(1) or "0").strip() or 0) if length_match else 0,
            "annotation_type": str(type_match.group(1) or "思考点").strip() if type_match else "思考点",
            "annotation_content": str(content_match.group(1) or "").strip() if content_match else "",
            "anchor_text": anchor_text,
        })
    return rows


def _render_annotation_item(annotation: Dict[str, Any]) -> str:
    return (
        "<annotation>\n"
        f"  <chapter_name>{_xml_escape(annotation.get('chapter_name', ''))}</chapter_name>\n"
        f"  <offset>{int(annotation.get('offset') or 0)}</offset>\n"
        f"  <length>{int(annotation.get('length') or 0)}</length>\n"
        f"  <annotation_type>{_xml_escape(annotation.get('annotation_type', '思考点'))}</annotation_type>\n"
        f"  <annotation_content>{_xml_escape(annotation.get('annotation_content', ''))}</annotation_content>\n"
        f"  <anchor_text>{_xml_escape(annotation.get('anchor_text', ''))}</anchor_text>\n"
        "</annotation>"
    )


def _render_annotations_root(annotations: List[Dict[str, Any]]) -> str:
    items = "\n".join(_render_annotation_item(a) for a in annotations if a)
    return f"<annotations>\n{items}\n</annotations>"


def _parse_model_annotations(raw_text: str, chapter_name: str, chapter_start: int) -> List[Dict[str, Any]]:
    """Parse model output into annotation objects."""
    text = str(raw_text or "").strip()
    if not text:
        return []
    rows: List[Dict[str, Any]] = []
    pattern = re.compile(
        r"<annotation>\s*(.*?)\s*</annotation>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(text):
        block = str(match.group(1) or "")
        offset_match = re.search(r"<offset>\s*(.*?)\s*</offset>", block, flags=re.IGNORECASE)
        length_match = re.search(r"<length>\s*(.*?)\s*</length>", block, flags=re.IGNORECASE)
        type_match = re.search(r"<annotation_type>\s*(.*?)\s*</annotation_type>", block, flags=re.IGNORECASE)
        content_match = re.search(r"<annotation_content>\s*(.*?)\s*</annotation_content>", block, flags=re.IGNORECASE)
        anchor_match = re.search(r"<anchor_text>\s*(.*?)\s*</anchor_text>", block, flags=re.IGNORECASE)
        if not offset_match or not content_match:
            continue
        offset = int(str(offset_match.group(1) or "0").strip() or 0)
        length = int(str(length_match.group(1) or "0").strip() or 0) if length_match else 0
        annotation_type = str(type_match.group(1) or "思考点").strip() if type_match else "思考点"
        annotation_content = str(content_match.group(1) or "").strip()
        anchor_text = str(anchor_match.group(1) or "").strip() if anchor_match else ""
        if not annotation_content:
            continue
        rows.append({
            "chapter_name": chapter_name,
            "offset": chapter_start + offset,
            "length": length,
            "annotation_type": annotation_type,
            "annotation_content": annotation_content,
            "anchor_text": anchor_text,
        })
    return rows


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return int(default)


def _clamp_int(value: int, low: int, high: int) -> int:
    if value < low:
        return low
    if value > high:
        return high
    return value


def _normalize_anchor_text(text: str) -> str:
    return str(text or "").replace("\r", " ").replace("\n", " ").strip()


def _derive_anchor_from_text(
    *,
    full_text: str,
    chapter_start: int,
    chapter_end: int,
    relative_offset: int,
    preferred_len: int,
) -> str:
    if chapter_end <= chapter_start:
        return ""
    abs_start = _clamp_int(chapter_start + relative_offset, chapter_start, max(chapter_start, chapter_end - 1))
    length = _clamp_int(preferred_len, 10, 30)
    raw = str(full_text[abs_start: min(chapter_end, abs_start + length)] or "")
    return _normalize_anchor_text(raw)


def _normalize_chapter_name_key(name: str) -> str:
    text = str(name or "").strip().lower()
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[【】\[\]（）()《》<>「」『』\"'“”‘’`~!@#$%^&*+=|\\/:;,.?！？、。·\-—_]", "", text)
    return text


def _repair_existing_annotations(
    *,
    existing_annotations: List[Dict[str, Any]],
    chapter_rows: List[Dict[str, Any]],
    full_text: str,
) -> List[Dict[str, Any]]:
    if not existing_annotations:
        return []
    chapter_by_exact: Dict[str, Dict[str, Any]] = {}
    chapter_by_norm: Dict[str, Dict[str, Any]] = {}
    for row in chapter_rows:
        if not isinstance(row, dict):
            continue
        chapter_name = str(row.get("chapter_name") or "").strip()
        if not chapter_name:
            continue
        chapter_by_exact[chapter_name] = row
        chapter_by_norm[_normalize_chapter_name_key(chapter_name)] = row

    repaired: List[Dict[str, Any]] = []
    for ann in existing_annotations:
        if not isinstance(ann, dict):
            continue
        chapter_name = str(ann.get("chapter_name") or "").strip()
        annotation_content = str(ann.get("annotation_content") or "").strip()
        if not chapter_name or not annotation_content:
            continue
        chapter = chapter_by_exact.get(chapter_name) or chapter_by_norm.get(_normalize_chapter_name_key(chapter_name))
        if not chapter:
            repaired.append(dict(ann))
            continue
        chapter_start = _safe_int(chapter.get("start"), 0)
        chapter_len = max(0, _safe_int(chapter.get("length"), 0))
        if chapter_len <= 0:
            repaired.append(dict(ann))
            continue
        chapter_end = chapter_start + chapter_len
        abs_offset_raw = _safe_int(ann.get("offset"), chapter_start)
        abs_offset = _clamp_int(abs_offset_raw, chapter_start, max(chapter_start, chapter_end - 1))
        relative_offset = abs_offset - chapter_start
        anchor_text = _normalize_anchor_text(str(ann.get("anchor_text") or ""))
        length = _clamp_int(_safe_int(ann.get("length"), 0), 0, 100)
        if not anchor_text:
            anchor_text = _derive_anchor_from_text(
                full_text=full_text,
                chapter_start=chapter_start,
                chapter_end=chapter_end,
                relative_offset=relative_offset,
                preferred_len=length if length > 0 else 18,
            )
        if length <= 0 and anchor_text:
            length = _clamp_int(len(anchor_text), 10, 30)
        next_row = dict(ann)
        next_row["offset"] = abs_offset
        next_row["anchor_text"] = anchor_text
        next_row["length"] = length
        repaired.append(next_row)
    return repaired


def _sanitize_write_annotations(
    *,
    raw_annotations: Any,
    full_text: str,
    chapter_start: int,
    chapter_len: int,
) -> List[Dict[str, Any]]:
    items = raw_annotations if isinstance(raw_annotations, list) else []
    if chapter_len <= 0:
        return []
    chapter_end = chapter_start + chapter_len
    out: List[Dict[str, Any]] = []
    for row in items:
        if not isinstance(row, dict):
            continue
        annotation_content = str(row.get("annotation_content") or "").strip()
        if not annotation_content:
            continue
        raw_offset = _safe_int(row.get("offset"), 0)
        safe_offset = _clamp_int(raw_offset, 0, max(0, chapter_len - 1))
        raw_length = _safe_int(row.get("length"), 0)
        safe_length = _clamp_int(raw_length, 0, 100)
        anchor_text = _normalize_anchor_text(str(row.get("anchor_text") or ""))
        if not anchor_text:
            anchor_text = _derive_anchor_from_text(
                full_text=full_text,
                chapter_start=chapter_start,
                chapter_end=chapter_end,
                relative_offset=safe_offset,
                preferred_len=safe_length if safe_length > 0 else 18,
            )
        if not anchor_text:
            # 无法生成有效锚点则丢弃，避免写入不可定位批注
            continue
        if safe_length <= 0:
            safe_length = _clamp_int(len(anchor_text), 10, 30)
        annotation_type = str(row.get("annotation_type") or "思考点").strip() or "思考点"
        out.append(
            {
                "offset": safe_offset,
                "length": safe_length,
                "anchor_text": anchor_text,
                "annotation_type": annotation_type,
                "annotation_content": annotation_content,
            }
        )
    return out


def _as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    out: Dict[str, Any] = {}
    for key in ("id", "type", "content", "choices", "message", "tool_calls", "function", "arguments", "name"):
        try:
            item = getattr(value, key, None)
        except Exception:
            item = None
        if item is not None:
            out[key] = item
    return out


def _normalize_tool_calls(raw_tool_calls: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not isinstance(raw_tool_calls, list):
        return rows
    for raw in raw_tool_calls:
        item = _as_dict(raw)
        func = _as_dict(item.get("function"))
        call_id = str(item.get("id") or "").strip()
        func_name = str(func.get("name") or "").strip()
        func_args = str(func.get("arguments") or "")
        if not call_id:
            call_id = f"tool_{len(rows) + 1}"
        if not func_name:
            continue
        rows.append(
            {
                "id": call_id,
                "type": str(item.get("type") or "function"),
                "function": {
                    "name": func_name,
                    "arguments": func_args,
                },
            }
        )
    return rows


def _extract_choice_message(response: Any) -> Dict[str, Any]:
    payload = _as_dict(response)
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = _as_dict(choices[0])
        message = _as_dict(first.get("message") or first)
        return {
            "content": str(message.get("content") or ""),
            "tool_calls": _normalize_tool_calls(message.get("tool_calls")),
        }
    return {
        "content": str(payload.get("content") or ""),
        "tool_calls": _normalize_tool_calls(payload.get("tool_calls")),
    }


def _invoke_runner_completion(
    *,
    runner: Any,
    messages: List[Dict[str, Any]],
    tools: List[Dict[str, Any]],
    temperature: float,
    max_output_tokens: int,
    request_timeout: int,
    stream: bool,
    think: bool,
    on_delta: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    if hasattr(runner, "create_completion") and callable(getattr(runner, "create_completion")):
        return runner.create_completion(
            messages=messages,
            tools=tools,
            temperature=temperature,
            max_tokens=max_output_tokens,
            timeout=request_timeout,
            stream=stream,
            think=think,
        )

    nexora_client = getattr(runner, "nexora_client", None)
    proxy = getattr(nexora_client, "proxy", None)
    if proxy is None or not hasattr(proxy, "complete_raw"):
        raise RuntimeError("annotation runner does not expose completion interface")

    options: Dict[str, Any] = {
        "temperature": float(temperature),
        "max_tokens": int(max_output_tokens),
        "tools": tools,
        "tool_choice": "auto",
        "parallel_tool_calls": False,
        "stream": bool(stream),
        "think": bool(think),
    }
    result = proxy.complete_raw(
        messages=messages,
        model=str(getattr(runner, "model_name", "") or "") or None,
        username=None,
        api_mode="chat",
        options=options,
        request_timeout=request_timeout,
        on_delta=on_delta,
    )
    if not isinstance(result, dict) or not result.get("success"):
        message = ""
        if isinstance(result, dict):
            message = str(result.get("message") or "")
        raise RuntimeError(f"annotation completion failed: {message or 'request failed'}")
    payload = result.get("payload")
    return payload if isinstance(payload, dict) else {}


def run_annotation_with_tools(
    *,
    runner: Any,
    request_text: str,
    lecture_name: str,
    book_name: str,
    full_text: str,
    lecture_id: str,
    book_id: str,
    temperature: float = 0.3,
    max_output_tokens: int = 4000,
    request_timeout: int = 240,
    stream: bool = True,
    think: bool = False,
    chapter_name: str = "",
    chapter_range: str = "",
    chapter_context: str = "",
    chapter_detail_xml: str = "",
    on_delta: Optional[Callable[[str], None]] = None,
    log_event: Optional[Callable[..., None]] = None,
    push_model_output: Optional[Callable[[str, str, str], None]] = None,
    push_tool_call: Optional[Callable[[str, str, str, str, str], None]] = None,
    max_input_chars: int = 15000,
    policy: ContextPolicy = ContextPolicy.LLM_COMPRESS,
    llm_compress_func: Optional[Callable[[str], str]] = None,
) -> Dict[str, Any]:
    """Run annotation generation with tool loop using Context Manager."""
    try:
        from NexoraLearning import prompts as learning_prompts
    except ImportError:
        import prompts as learning_prompts

    # 解析章节范围
    chapter_start, chapter_len = _parse_range(chapter_range)
    chapter_end = chapter_start + max(0, chapter_len)
    max_read_chars_per_call = 2400
    max_tool_payload_chars = 3200
    result_annotations_text = ""

    def _clip_text(text: Any, limit: int) -> str:
        raw = str(text or "")
        safe_limit = max(200, int(limit or 0))
        if len(raw) <= safe_limit:
            return raw
        return f"{raw[:safe_limit]}\n...[truncated:{len(raw) - safe_limit}]"

    # 创建上下文管理器
    ctx = Context(
        max_chars=max_input_chars,
        policy=policy,
        llm_compress_func=llm_compress_func,
    )

    # 设置提示词
    system_prompt = learning_prompts.ANNOTATION_MODEL_SYSTEM_PROMPT
    user_prompt = learning_prompts.ANNOTATION_MODEL_USER_PROMPT.format(
        lecture_name=lecture_name,
        book_name=book_name,
        chapter_name=chapter_name,
        chapter_range=chapter_range,
        chapter_context=chapter_context,
        chapter_detail_xml=chapter_detail_xml,
        request=request_text,
    )
    ctx.add(role="system", content=system_prompt)
    ctx.add(role="user", content=user_prompt)

    # 创建工具定义
    read_tool = ToolDef(
        name="read",
        description="读取教材指定范围的文本内容",
        parameters={
            "offset": {"type": "integer", "description": "起始位置（字符偏移量）"},
            "length": {"type": "integer", "description": "读取长度（字符数）"},
        },
        required=["offset", "length"],
    )

    find_tool = ToolDef(
        name="find",
        description="在教材中搜索指定关键词，返回匹配位置",
        parameters={
            "keyword": {"type": "string", "description": "要搜索的关键词"},
        },
        required=["keyword"],
    )

    write_tool = ToolDef(
        name="write",
        description="提交生成的批注",
        parameters={
            "annotations": {
                "type": "array",
                "description": "批注数组",
                "items": {
                    "type": "object",
                    "properties": {
                        "offset": {"type": "integer", "description": "批注位置（相对于章节起始的偏移量）"},
                        "length": {"type": "integer", "description": "批注锚定文本长度"},
                        "anchor_text": {"type": "string", "description": "批注锚定的原文片段（10-30字）"},
                        "annotation_type": {
                            "type": "string",
                            "enum": ["易错点", "思考点", "方法提醒", "结构观察", "教学提醒"],
                            "description": "批注类型"
                        },
                        "annotation_content": {"type": "string", "description": "批注内容（50-200字）"},
                    },
                    "required": ["offset", "anchor_text", "annotation_type", "annotation_content"],
                },
            },
        },
        required=["annotations"],
    )

    # 创建工具任务
    task = ToolTask(tools=[read_tool, find_tool, write_tool])

    # 注册工具处理器
    def handle_read(args: Dict[str, Any]) -> Dict[str, Any]:
        offset = int(args.get("offset") or 0)
        length = int(args.get("length") or 1000)
        safe_offset = max(chapter_start, min(offset, chapter_end))
        allowed = max(0, chapter_end - safe_offset)
        requested = max(1, length)
        safe_length = min(requested, allowed, max_read_chars_per_call)
        text_content = full_text[safe_offset:safe_offset + safe_length] if safe_length > 0 else ""
        return {
            "content": _clip_text(text_content, max_tool_payload_chars),
            "offset": safe_offset,
            "length": safe_length,
            "requested_length": requested,
            "truncated": bool(allowed > safe_length or requested > safe_length),
        }

    def handle_find(args: Dict[str, Any]) -> Dict[str, Any]:
        keyword = str(args.get("keyword") or "")
        chapter_text = full_text[chapter_start:chapter_start + chapter_len]
        positions = []
        start = 0
        while True:
            pos = chapter_text.find(keyword, start)
            if pos == -1:
                break
            positions.append(chapter_start + pos)
            start = pos + 1
            if len(positions) >= 20:
                break
        return {"keyword": keyword, "positions": positions, "count": len(positions)}

    def handle_write(args: Dict[str, Any]) -> Dict[str, Any]:
        nonlocal result_annotations_text
        if log_event:
            log_event(
                "annotation_write_call",
                "批注写入调用",
                payload={"annotations_count": len(args.get("annotations") or [])},
            )
        annotations = _sanitize_write_annotations(
            raw_annotations=args.get("annotations", []),
            full_text=full_text,
            chapter_start=chapter_start,
            chapter_len=chapter_len,
        )
        result_annotations_text = _format_annotations_xml(annotations, chapter_name)
        return {"status": "ok", "count": len(annotations)}

    task.register("read", handle_read)
    task.register("find", handle_find)
    task.register("write", handle_write)

    # 执行工具循环
    for round_num in range(10):  # max_rounds
        if log_event:
            log_event(
                "annotation_round_start",
                "批注轮次开始",
                payload={
                    "round": round_num + 1,
                    "message_count": ctx.count(),
                    "chapter_name": chapter_name,
                    "chapter_range": chapter_range,
                },
            )

        # 准备上下文（自动截断）
        ctx.prepare()

        # 调用模型
        response = None
        last_error = None
        for retry in range(3):  # max_retries
            try:
                response = _invoke_runner_completion(
                    runner=runner,
                    messages=ctx.build(),
                    tools=task.get_definitions(),
                    temperature=temperature,
                    max_output_tokens=max_output_tokens,
                    request_timeout=request_timeout,
                    stream=stream,
                    think=think,
                    on_delta=on_delta,
                )
                break
            except Exception as e:
                last_error = e
                error_str = str(e).lower()
                if any(keyword in error_str for keyword in ["connection", "timeout", "rate limit", "429", "503"]):
                    if retry < 2:  # max_retries - 1
                        if log_event:
                            log_event(
                                "annotation_retry",
                                "批注生成重试",
                                payload={"round": round_num + 1, "retry": retry + 1, "error": str(e)},
                            )
                        time.sleep(2 * (retry + 1))
                        continue
                if log_event:
                    log_event(
                        "annotation_round_error",
                        "批注生成轮次错误",
                        payload={"round": round_num + 1, "retry": retry + 1, "error": str(e)},
                    )
                raise

        if response is None:
            raise last_error if last_error else Exception("annotation completion failed after retries")

        # 处理响应
        message = _extract_choice_message(response)
        tool_calls = message.get("tool_calls") or []
        assistant_content = str(message.get("content") or "")

        # 推送模型文本输出到活动日志
        if assistant_content.strip() and push_model_output and lecture_id and book_id:
            push_model_output(lecture_id, book_id, assistant_content)

        if log_event:
            log_event(
                "annotation_round_response",
                "批注轮次响应",
                payload={
                    "round": round_num + 1,
                    "tool_calls": len(tool_calls) if isinstance(tool_calls, list) else 0,
                    "assistant_content_chars": len(assistant_content),
                },
            )

        if isinstance(tool_calls, list) and tool_calls:
            # 有工具调用
            ctx.add(
                role="assistant",
                content=assistant_content,
                tool_calls=[
                    {
                        "id": str(tc.get("id") or ""),
                        "type": "function",
                        "function": {
                            "name": str(_as_dict(tc.get("function")).get("name") or ""),
                            "arguments": str(_as_dict(tc.get("function")).get("arguments") or ""),
                        },
                    }
                    for tc in tool_calls
                ],
            )

            # 执行工具
            for tc in tool_calls:
                tc_function = _as_dict(tc.get("function"))
                func_name = str(tc_function.get("name") or "")
                try:
                    func_args = json.loads(str(tc_function.get("arguments") or ""))
                except json.JSONDecodeError:
                    func_args = {}

                if task.has_handler(func_name):
                    try:
                        result = task.execute(func_name, func_args)
                        # 推送工具调用到活动日志
                        if push_tool_call and lecture_id and book_id:
                            tool_title = f"调用 {func_name}"
                            tool_preview = ""
                            if func_name == "read":
                                tool_preview = f"读取 [{func_args.get('offset', 0)}, {func_args.get('offset', 0) + func_args.get('length', 0)}]"
                            elif func_name == "find":
                                tool_preview = f"搜索 \"{func_args.get('keyword', '')}\""
                            elif func_name == "write":
                                tool_preview = f"写入 {len(result_annotations_text)} 字符"
                            push_tool_call(lecture_id, book_id, func_name, tool_title, tool_preview)
                        ctx.add(
                            role="tool",
                            content=json.dumps(result, ensure_ascii=False),
                            tool_call_id=str(tc.get("id") or ""),
                        )
                    except Exception as e:
                        ctx.add(
                            role="tool",
                            content=json.dumps({"error": str(e)}, ensure_ascii=False),
                            tool_call_id=str(tc.get("id") or ""),
                        )
                else:
                    ctx.add(
                        role="tool",
                        content=json.dumps({"error": f"Unknown tool: {func_name}"}, ensure_ascii=False),
                        tool_call_id=str(tc.get("id") or ""),
                    )

            # 如果 write 被调用，结束循环
            if result_annotations_text:
                break
        else:
            # 没有工具调用，检查内容
            if assistant_content and on_delta:
                on_delta(assistant_content)
            break

    return {
        "annotations_text": result_annotations_text,
        "tool_call_count": task.get_history().__len__(),
        "rounds": round_num + 1,
        "context_stats": ctx.stats(),
    }


def _format_annotations_xml(annotations: List[Dict[str, Any]], chapter_name: str) -> str:
    items = []
    for ann in annotations:
        items.append(
            "<annotation>\n"
            f"  <offset>{int(ann.get('offset') or 0)}</offset>\n"
            f"  <length>{int(ann.get('length') or 0)}</length>\n"
            f"  <anchor_text>{_xml_escape(ann.get('anchor_text', ''))}</anchor_text>\n"
            f"  <annotation_type>{_xml_escape(ann.get('annotation_type', '思考点'))}</annotation_type>\n"
            f"  <annotation_content>{_xml_escape(ann.get('annotation_content', ''))}</annotation_content>\n"
            "</annotation>"
        )
    return "\n".join(items)


def run_annotation_generation_once(
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
    load_book_annotations_xml: Callable[..., str],
    save_book_annotations_xml: Callable[..., str],
    update_book: Callable[..., Any],
    resolve_book_text: Callable[..., str],
    get_annotation_settings: Callable[..., Dict[str, Any]],
    build_annotation_runner: Callable[..., Any],
    as_bool: Callable[..., bool],
    log_event: Callable[..., None],
    append_log_text: Callable[[str], None],
    push_model_output: Callable[[str, str, str], None],
    push_tool_call: Callable[[str, str, str, str, str], None],
    policy: ContextPolicy = ContextPolicy.LLM_COMPRESS,
    llm_compress_func: Optional[Callable[[str], str]] = None,
) -> Dict[str, Any]:
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

    model_cfg = dict(get_annotation_settings(resolved_cfg) or {})
    if not as_bool(model_cfg.get("enabled"), default=True):
        raise ValueError("annotation model is disabled.")

    selected_model = str(model_name or model_cfg.get("model_name") or "").strip()
    temperature = float(model_cfg.get("temperature") or 0.3)
    max_output_tokens = int(model_cfg.get("max_output_tokens") or 4000)
    max_input_chars = max(2000, int(model_cfg.get("max_input_chars") or 15000))
    request_timeout = int(model_cfg.get("request_timeout") or 240)
    stream = as_bool(model_cfg.get("stream"), default=True)
    think = as_bool(model_cfg.get("think"), default=False)
    prompt_notes = str(model_cfg.get("prompt_notes") or "").strip()

    runner = build_annotation_runner(resolved_cfg, selected_model)
    bookdetail_xml = str(load_book_detail_xml(resolved_cfg, lecture_key, book_key) or "")
    bookinfo_xml = str(load_book_info_xml(resolved_cfg, lecture_key, book_key) or "")
    chapter_rows = _extract_detail_chapters(bookdetail_xml)
    if not chapter_rows:
        chapter_rows = _extract_coarse_chapters(bookinfo_xml)
    if not chapter_rows:
        chapter_rows = [
            {
                "chapter_name": str(book.get("title") or "正文"),
                "chapter_range": f"0:{len(full_text)}",
                "chapter_detail_xml": "",
                "start": 0,
                "length": len(full_text),
            }
        ]

    existing_xml = str(load_book_annotations_xml(resolved_cfg, lecture_key, book_key) or "")
    existing_annotations = _repair_existing_annotations(
        existing_annotations=_extract_existing_annotations(existing_xml),
        chapter_rows=chapter_rows,
        full_text=full_text,
    )

    total = len(chapter_rows)
    total_annotations = 0

    for idx, chapter in enumerate(chapter_rows, start=1):
        chapter_name = str(chapter.get("chapter_name") or f"第{idx}章").strip() or f"第{idx}章"
        chapter_range = str(chapter.get("chapter_range") or "0:0").strip()
        chapter_detail_xml = str(chapter.get("chapter_detail_xml") or "").strip()
        chapter_start = int(chapter.get("start") or 0)
        chapter_length = int(chapter.get("length") or 0)
        if chapter_length <= 0:
            continue

        # Check if this chapter already has annotations
        chapter_annotations = [a for a in existing_annotations if a.get("chapter_name") == chapter_name]
        if chapter_annotations:
            log_event(
                "annotation_chapter_skip",
                "章节已有批注，跳过",
                payload={
                    "lecture_id": lecture_key,
                    "book_id": book_key,
                    "chapter_index": idx,
                    "chapter_total": total,
                    "chapter_name": chapter_name,
                    "existing_count": len(chapter_annotations),
                },
            )
            continue

        # 批注阶段使用工具 read/find 深挖正文，预载上下文只保留轻量窗口，避免轮次上下文膨胀。
        preload_len = min(chapter_length, max(1500, min(max_input_chars, 4000)))
        chapter_context = full_text[chapter_start:chapter_start + preload_len] if preload_len > 0 else ""

        # 根据章节长度动态计算批注数量
        if chapter_length < 2000:
            annotation_count_hint = "2-4"
        elif chapter_length < 5000:
            annotation_count_hint = "3-6"
        elif chapter_length < 10000:
            annotation_count_hint = "5-10"
        elif chapter_length < 20000:
            annotation_count_hint = "8-15"
        else:
            annotation_count_hint = "12-20"

        request_text = (
            "请为当前章节的关键段落生成学习批注。"
            "批注应聚焦于：易错点、思考点、方法提醒、结构观察。"
            "每个批注必须包含精确的 offset（相对于章节起始的位置）和简短的 anchor_text。"
            f"批注数量控制在 {annotation_count_hint} 个，质量优先。"
            "必须通过工具 write(annotations=[...]) 提交全部批注。"
        )
        if prompt_notes:
            request_text = f"{request_text}\n附加要求：{prompt_notes}"

        log_event(
            "annotation_chapter_start",
            "章节批注生成开始",
            payload={
                "lecture_id": lecture_key,
                "book_id": book_key,
                "chapter_index": idx,
                "chapter_total": total,
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
            },
        )

        try:
            result = run_annotation_with_tools(
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
                on_delta=lambda delta: append_log_text(str(delta or "")),
                log_event=log_event,
                push_model_output=push_model_output,
                push_tool_call=push_tool_call,
                policy=policy,
                llm_compress_func=llm_compress_func,
            )

            model_annotations = _parse_model_annotations(
                str(result.get("annotations_text") or ""),
                chapter_name,
                chapter_start,
            )
            existing_annotations.extend(model_annotations)
            total_annotations += len(model_annotations)

            # Save after each chapter
            merged_xml = _render_annotations_root(existing_annotations)
            save_book_annotations_xml(resolved_cfg, lecture_key, book_key, merged_xml)

            log_event(
                "annotation_chapter_done",
                "章节批注生成完成",
                payload={
                    "lecture_id": lecture_key,
                    "book_id": book_key,
                    "chapter_index": idx,
                    "chapter_total": total,
                    "chapter_name": chapter_name,
                    "annotation_count": len(model_annotations),
                },
            )
        except Exception as e:
            # 单个章节失败不影响其他章节
            log_event(
                "annotation_chapter_error",
                "章节批注生成失败，继续下一章节",
                payload={
                    "lecture_id": lecture_key,
                    "book_id": book_key,
                    "chapter_index": idx,
                    "chapter_total": total,
                    "chapter_name": chapter_name,
                    "error": str(e),
                },
            )
            continue

    final_xml = _render_annotations_root(existing_annotations)
    save_book_annotations_xml(resolved_cfg, lecture_key, book_key, final_xml)
    update_book(
        resolved_cfg,
        lecture_key,
        book_key,
        {
            "annotation_status": "done",
            "annotation_error": "",
            "annotation_model": str(getattr(runner, "model_name", "") or ""),
        },
    )
    return {
        "success": True,
        "status": "done",
        "annotations_chars": len(final_xml),
        "annotation_count": total_annotations,
        "chapter_count": len(chapter_rows),
        "model_name": str(getattr(runner, "model_name", "") or ""),
    }
