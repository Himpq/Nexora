"""全书概述生成模块。

职责：
基于粗读章节摘要（bookinfo.xml）与精读关键点（bookdetail.xml），
调用 AI 模型生成一份面向学习者的全书概述，保存为 summary.xml。

触发条件：粗读完成（coarse_status=done）后即可执行。

summary.xml 结构：
<book_summary>
  <summary_brief>精要总结（80-150字）</summary_brief>
  <summary_detail>详细总结（400-800字）</summary_detail>
</book_summary>
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Callable, Dict, List, Mapping, Optional


def _parse_range(value: str) -> tuple[int, int]:
    """解析 START:LENGTH 格式的范围字符串。"""
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


def _extract_chapter_summaries(bookinfo_xml: str) -> List[Dict[str, str]]:
    """从 bookinfo.xml 提取章节摘要列表。"""
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
        start, length = _parse_range(chapter_range)
        if not chapter_name or length <= 0:
            continue
        rows.append(
            {
                "chapter_name": chapter_name,
                "chapter_range": f"{start}:{length}",
                "chapter_summary": chapter_summary,
            }
        )
    rows.sort(key=lambda item: _parse_range(item.get("chapter_range", "0:0"))[0])
    return rows


def _extract_intensive_key_points(bookdetail_xml: str) -> str:
    """从 bookdetail.xml 提取全部章节 key_points 的纯文本摘要。"""
    text = str(bookdetail_xml or "")
    if not text.strip():
        return ""
    blocks = re.findall(r"<book_detail>\s*.*?\s*</book_detail>", text, flags=re.IGNORECASE | re.DOTALL)
    lines: List[str] = []
    for block in blocks:
        name_match = re.search(r"<chapter_name>\s*(.*?)\s*</chapter_name>", block, flags=re.IGNORECASE | re.DOTALL)
        chapter_name = str(name_match.group(1) or "").strip() if name_match else "未知章节"
        kp_blocks = re.findall(r"<key_point>\s*(.*?)\s*</key_point>", block, flags=re.IGNORECASE | re.DOTALL)
        for kp in kp_blocks:
            title_match = re.search(r"<key_point_title>\s*(.*?)\s*</key_point_title>", kp, flags=re.IGNORECASE | re.DOTALL)
            content_match = re.search(r"<key_point_content>\s*(.*?)\s*</key_point_content>", kp, flags=re.IGNORECASE | re.DOTALL)
            kp_title = str(title_match.group(1) or "").strip() if title_match else ""
            kp_content = str(content_match.group(1) or "").strip() if content_match else ""
            if kp_title or kp_content:
                lines.append(f"[{chapter_name}] {kp_title}: {kp_content}")
    return "\n".join(lines[:80])


def _render_chapter_summaries_prompt(chapters: List[Dict[str, str]]) -> str:
    """将章节摘要列表渲染为 prompt 注入文本。"""
    lines: List[str] = []
    for idx, ch in enumerate(chapters, start=1):
        name = str(ch.get("chapter_name") or f"第{idx}章").strip()
        summary = str(ch.get("chapter_summary") or "").strip()
        if not summary:
            summary = "(该章节暂无摘要)"
        lines.append(f"【{name}】{summary}")
    return "\n\n".join(lines)


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
    """调用模型完成接口，兼容 create_completion 和 proxy.complete_raw 两种方式。"""
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
        raise RuntimeError("book_summary runner does not expose completion interface")

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
        raise RuntimeError(f"book_summary completion failed: {message or 'request failed'}")
    payload = result.get("payload")
    return payload if isinstance(payload, dict) else {}


def run_summary_with_tools(
    *,
    runner: Any,
    request_text: str,
    lecture_name: str,
    book_name: str,
    chapter_summaries: str,
    intensive_key_points: str,
    chapter_count: int,
    temperature: float = 0.3,
    max_output_tokens: int = 4000,
    request_timeout: int = 240,
    stream: bool = True,
    think: bool = False,
    on_delta: Optional[Callable[[str], None]] = None,
    append_log_text: Optional[Callable[[str], None]] = None,
    log_event: Optional[Callable[..., None]] = None,
) -> Dict[str, Any]:
    """使用 write 工具循环调用模型生成全书总结（模拟 annotation 的工具链模式）。"""
    try:
        from NexoraLearning import prompts as learning_prompts
    except ImportError:
        import prompts as learning_prompts

    system_prompt = learning_prompts.BOOK_SUMMARY_SYSTEM_PROMPT
    user_prompt = learning_prompts.BOOK_SUMMARY_USER_PROMPT.format(
        lecture_name=lecture_name,
        book_name=book_name,
        chapter_summaries=chapter_summaries,
        intensive_key_points=intensive_key_points or "(暂无精读数据)",
        chapter_count=chapter_count,
        request=request_text,
    )

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    tools = [
        {
            "type": "function",
            "function": {
                "name": "write",
                "description": "提交生成的全书总结",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "summary_brief": {
                            "type": "string",
                            "description": "书籍简介（200-400字）：概括本书内容 + 简要大纲，用于教材介绍页展示"
                        },
                    },
                    "required": ["summary_brief"],
                },
            },
        },
    ]

    max_rounds = 3
    max_retries = 3
    result_brief = ""
    result_detail = ""
    tool_call_count = 0

    for round_num in range(max_rounds):
        if log_event:
            log_event(
                "summary_round_start",
                "概述轮次开始",
                payload={
                    "round": round_num + 1,
                    "message_count": len(messages),
                },
            )

        last_error = None
        response = None
        for retry in range(max_retries):
            try:
                response = _invoke_runner_completion(
                    runner=runner,
                    messages=messages,
                    tools=tools,
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
                if any(k in error_str for k in ("connection", "timeout", "rate limit", "429", "503")):
                    if retry < max_retries - 1:
                        if log_event:
                            log_event(
                                "summary_retry",
                                "概述生成重试",
                                payload={"round": round_num + 1, "retry": retry + 1, "error": str(e)},
                            )
                        time.sleep(2 * (retry + 1))
                        continue
                raise

        if response is None:
            raise last_error if last_error else Exception("summary completion failed after retries")

        message = _extract_choice_message(response)
        tool_calls = message.get("tool_calls") or []

        if log_event:
            log_event(
                "summary_round_response",
                "概述轮次响应",
                payload={
                    "round": round_num + 1,
                    "tool_calls": len(tool_calls) if isinstance(tool_calls, list) else 0,
                },
            )

        if isinstance(tool_calls, list) and tool_calls:
            tool_call_count += len(tool_calls)
            messages.append({
                "role": "assistant",
                "content": str(message.get("content") or ""),
                "tool_calls": [
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
            })

            for tc in tool_calls:
                tc_function = _as_dict(tc.get("function"))
                func_name = str(tc_function.get("name") or "")
                try:
                    func_args = json.loads(str(tc_function.get("arguments") or ""))
                except json.JSONDecodeError:
                    func_args = {}

                if func_name == "write":
                    if log_event:
                        log_event(
                            "summary_write_call",
                            "概述写入调用",
                            payload={
                                "round": round_num + 1,
                                "brief_chars": len(str(func_args.get("summary_brief") or "")),
                                "detail_chars": len(str(func_args.get("summary_detail") or "")),
                            },
                        )
                    result_brief = str(func_args.get("summary_brief") or "").strip()
                    result_detail = str(func_args.get("summary_detail") or "").strip()
                    tool_result = {"status": "ok"}
                else:
                    tool_result = {"error": f"Unknown tool: {func_name}"}

                messages.append({
                    "role": "tool",
                    "tool_call_id": str(tc.get("id") or ""),
                    "content": json.dumps(tool_result, ensure_ascii=False),
                })

            if result_brief or result_detail:
                break
        else:
            content = str(message.get("content") or "")
            if content and on_delta:
                on_delta(content)
            break

    return {
        "summary_brief": result_brief,
        "summary_detail": result_detail,
        "tool_call_count": tool_call_count,
        "rounds": round_num + 1,
    }


def run_book_summary_once(
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
    save_book_summary: Callable[..., str],
    update_book: Callable[..., Any],
    get_book_summary_settings: Callable[..., Dict[str, Any]],
    build_book_summary_runner: Callable[..., Any],
    as_bool: Callable[..., bool],
    log_event: Callable[..., None],
    append_log_text: Callable[[str], None],
) -> Dict[str, Any]:
    """执行一次全书概述生成。

    流程：
    1. 读取 bookinfo.xml 中的章节摘要。
    2. 读取 bookdetail.xml 中的精读关键点（可选）。
    3. 构造 prompt，通过 write 工具让模型生成精简总结和详细总结。
    4. 将结果封装为 summary.xml 保存。
    """
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

    model_cfg = dict(get_book_summary_settings(resolved_cfg) or {})
    if not as_bool(model_cfg.get("enabled"), default=True):
        raise ValueError("book_summary model is disabled.")

    selected_model = str(model_name or model_cfg.get("model_name") or "").strip()
    temperature = float(model_cfg.get("temperature") or 0.2)
    max_output_tokens = int(model_cfg.get("max_output_tokens") or 4000)
    request_timeout = int(model_cfg.get("request_timeout") or 240)
    stream = as_bool(model_cfg.get("stream"), default=True)
    think = as_bool(model_cfg.get("think"), default=False)
    prompt_notes = str(model_cfg.get("prompt_notes") or "").strip()

    runner = build_book_summary_runner(resolved_cfg, selected_model)

    bookinfo_xml = str(load_book_info_xml(resolved_cfg, lecture_key, book_key) or "")
    bookdetail_xml = str(load_book_detail_xml(resolved_cfg, lecture_key, book_key) or "")

    chapter_rows = _extract_chapter_summaries(bookinfo_xml)
    if not chapter_rows:
        raise ValueError("bookinfo.xml 无章节摘要，请先完成粗读。")

    chapter_summaries_text = _render_chapter_summaries_prompt(chapter_rows)
    intensive_key_points = _extract_intensive_key_points(bookdetail_xml)

    request_text = (
        "请根据各章节摘要和精读关键点，提炼一份简明扼要的书籍简介。"
        "不完全照抄粗读章节摘要，重新组织语言、提炼核心脉络。"
        "简介包含一段概述 + 简要大纲，200-400字，第三人称客观视角。"
    )
    if prompt_notes:
        request_text = f"{request_text}\n附加要求：{prompt_notes}"

    log_event(
        "book_summary_start",
        "全书概述生成开始",
        payload={
            "lecture_id": lecture_key,
            "book_id": book_key,
            "model_name": selected_model or str(getattr(runner, "model_name", "") or ""),
            "chapter_count": len(chapter_rows),
            "has_intensive": bool(intensive_key_points),
        },
    )

    try:
        result = run_summary_with_tools(
            runner=runner,
            request_text=request_text,
            lecture_name=str(lecture.get("title") or ""),
            book_name=str(book.get("title") or ""),
            chapter_summaries=chapter_summaries_text,
            intensive_key_points=intensive_key_points,
            chapter_count=len(chapter_rows),
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            request_timeout=request_timeout,
            stream=stream,
            think=think,
            on_delta=lambda delta: append_log_text(str(delta or "")) if append_log_text else None,
            append_log_text=append_log_text,
            log_event=log_event,
        )
    except Exception as exc:
        raise RuntimeError(f"全书概述模型调用失败: {exc}") from exc

    brief_text = str(result.get("summary_brief") or "").strip()
    detail_text = str(result.get("summary_detail") or "").strip()

    if not brief_text:
        raise RuntimeError("全书概述模型未返回有效总结")

    log_event(
        "summary_model_output",
        "概述模型输出",
        payload={
            "model_type": "book_summary",
            "model_name": str(getattr(runner, "model_name", "") or ""),
            "lecture_id": lecture_key,
            "book_id": book_key,
            "brief_chars": len(brief_text),
            "detail_chars": len(detail_text),
        },
        content=brief_text[:500],
    )

    summary_xml = _render_summary_xml(brief_text, detail_text)
    save_book_summary(resolved_cfg, lecture_key, book_key, summary_xml)

    update_book(
        resolved_cfg,
        lecture_key,
        book_key,
        {
            "summary_status": "done",
            "summary_error": "",
            "summary_model": str(getattr(runner, "model_name", "") or ""),
            "summary_at": int(time.time()),
        },
    )

    log_event(
        "book_summary_done",
        "全书概述生成完成",
        payload={
            "lecture_id": lecture_key,
            "book_id": book_key,
            "model_name": str(getattr(runner, "model_name", "") or ""),
            "summary_chars": len(summary_xml),
        },
    )
    return {
        "success": True,
        "status": "done",
        "summary_chars": len(summary_xml),
        "chapter_count": len(chapter_rows),
        "model_name": str(getattr(runner, "model_name", "") or ""),
        "summary_brief": brief_text,
        "summary_detail": detail_text,
    }


def load_book_summary(data_dir: str, lecture_id: str, book_id: str) -> Dict[str, str]:
    """从 summary.xml 加载概述数据。"""
    from pathlib import Path

    path = Path(data_dir) / "lectures" / lecture_id / "books" / book_id / "summary.xml"
    if not path.exists():
        return {"summary_brief": "", "summary_detail": ""}
    try:
        content = path.read_text(encoding="utf-8")
    except Exception:
        return {"summary_brief": "", "summary_detail": ""}
    brief, detail = _extract_summary_parts(content)
    return {"summary_brief": brief, "summary_detail": detail}


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
        rows.append({
            "id": call_id,
            "type": str(item.get("type") or "function"),
            "function": {
                "name": func_name,
                "arguments": func_args,
            },
        })
    return rows


def _render_summary_xml(brief_text: str, detail_text: str) -> str:
    """将精要总结和详细总结封装为 summary.xml 格式。"""
    def _escape(value: str) -> str:
        text = str(value or "").strip()
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

    return (
        "<book_summary>\n"
        f"  <summary_brief>{_escape(brief_text)}</summary_brief>\n"
        f"  <summary_detail>{_escape(detail_text)}</summary_detail>\n"
        "</book_summary>"
    )


def _extract_summary_parts(raw_output: str) -> tuple[str, str]:
    """从模型输出中提取 <summary_brief> 和 <summary_detail> 两部分。"""
    text = str(raw_output or "").strip()

    brief_match = re.search(r"<summary_brief>\s*(.*?)\s*</summary_brief>", text, flags=re.IGNORECASE | re.DOTALL)
    detail_match = re.search(r"<summary_detail>\s*(.*?)\s*</summary_detail>", text, flags=re.IGNORECASE | re.DOTALL)

    brief_text = str(brief_match.group(1) or "").strip() if brief_match else ""
    detail_text = str(detail_match.group(1) or "").strip() if detail_match else ""
    return brief_text, detail_text
