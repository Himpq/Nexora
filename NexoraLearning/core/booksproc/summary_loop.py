"""粗读第二阶段摘要工具循环模块 - 使用 Context Manager 管理上下文。

解决的问题：
- turn_history 无限累积导致 token 超限
- 自动截断避免 400 错误
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from .context import Context, ContextPolicy


def _safe_json_dumps(obj: Any) -> str:
    """安全的 JSON 序列化"""
    try:
        return json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        return str(obj)


def _safe_json_obj(raw: str) -> Dict[str, Any]:
    """安全的 JSON 解析"""
    try:
        result = json.loads(raw)
        return result if isinstance(result, dict) else {}
    except Exception:
        return {}


def _clamp_to_section(args: Dict[str, Any], start: int, end: int) -> Dict[str, Any]:
    """将参数限制在章节范围内"""
    safe = dict(args or {})
    try:
        offset = int(safe.get("offset") or start)
    except Exception:
        offset = start
    try:
        length = int(safe.get("length") or min(1500, max(1, end - start)))
    except Exception:
        length = min(1500, max(1, end - start))
    offset = max(start, min(max(start, end - 1), offset))
    max_len = max(1, end - offset)
    length = max(1, min(length, max_len))
    safe["offset"] = offset
    safe["length"] = length
    try:
        range_start = int(safe.get("range_start") or start)
    except Exception:
        range_start = start
    try:
        range_end = int(safe.get("range_end") or end)
    except Exception:
        range_end = end
    range_start = max(start, min(end, range_start))
    range_end = max(range_start, min(end, range_end))
    safe["range_start"] = range_start
    safe["range_end"] = range_end
    return safe


def run_summary_tool_loop(
    *,
    runner: Any,
    system_prompt: str,
    user_prompt_template: str,
    tools: List[Dict[str, Any]],
    full_text: str,
    total_len: int,
    chunk_start: int,
    chunk_end: int,
    chapter_name: str,
    chapter_range: str,
    chapter_preload_text: str,
    preload_start: int,
    preload_end: int,
    max_input_chars: int = 15000,
    max_turns: int = 40,
    temperature: float = 0.2,
    max_output_tokens: int = 4000,
    request_timeout: int = 240,
    stream: bool = True,
    think: bool = False,
    on_delta: Optional[Callable[[str], None]] = None,
    on_update_summary: Optional[Callable] = None,
    on_read: Optional[Callable] = None,
    on_index: Optional[Callable] = None,
    on_savemem: Optional[Callable] = None,
    log_event: Optional[Callable] = None,
    is_cancelled: Optional[Callable[[], bool]] = None,
    push_book_progress_step: Optional[Callable] = None,
    resume_round: int = 1,
    section_index: int = 0,
    lecture_id: str = "",
    book_id: str = "",
    policy: ContextPolicy = ContextPolicy.LLM_COMPRESS,
    llm_compress_func: Optional[Callable[[str], str]] = None,
) -> Dict[str, Any]:
    """使用 Context Manager 执行第二阶段摘要工具循环"""
    
    # 创建上下文管理器
    ctx = Context(
        max_chars=max_input_chars,
        policy=policy,
        llm_compress_func=llm_compress_func,
        trace_meta={
            "flow": "summary_loop",
            "lecture_id": str(lecture_id or ""),
            "book_id": str(book_id or ""),
            "resume_round": int(resume_round),
            "section_index": int(section_index),
            "chapter_name": str(chapter_name or ""),
            "chapter_range": str(chapter_range or ""),
            "preload_range": f"{int(preload_start)}:{max(1, int(preload_end) - int(preload_start))}",
        },
    )
    ctx.add(role="system", content=system_prompt)
    
    # 状态变量
    section_done = False
    turn = 0
    latest_quality_feedback = ""
    queried_ranges: List[Tuple[int, int]] = []
    
    # 第一轮添加 preload 文本
    if chapter_preload_text:
        preload_range = f"{preload_start}:{max(1, preload_end - preload_start)}"
        initial_user_prompt = user_prompt_template.format(
            request="请为当前章节生成摘要。",
            chapter_name=chapter_name,
            chapter_range=chapter_range,
            preload_range=preload_range,
            quality_feedback=latest_quality_feedback,
        )
        initial_user_prompt += f"\n\n<CHAPTER_PRELOAD>\n{chapter_preload_text}\n</CHAPTER_PRELOAD>"
        ctx.add(role="user", content=initial_user_prompt)
    
    while not section_done and turn < max_turns:
        turn += 1
        
        # 检查是否被取消
        if is_cancelled and is_cancelled():
            raise RuntimeError("cancelled by admin")
        
        # 如果不是第一轮，添加新的 user prompt
        if turn > 1:
            user_prompt = user_prompt_template.format(
                request="请继续生成摘要。",
                chapter_name=chapter_name,
                chapter_range=chapter_range,
                preload_range="",
                quality_feedback=latest_quality_feedback,
            )
            # 替换或添加 user 消息
            last_msg = ctx.last()
            if last_msg and last_msg.role == "user":
                ctx.replace(-1, content=user_prompt)
            else:
                ctx.add(role="user", content=user_prompt)
        
        # 准备上下文（执行策略）
        executed = ctx.prepare()
        if executed and log_event:
            log_event(
                "context_operation",
                f"上下文{('压缩' if policy == ContextPolicy.LLM_COMPRESS else '截断')}",
                payload={"resume_round": resume_round, "section_index": section_index, "turn": turn, "policy": policy.value},
            )
        
        round_delta_parts: List[str] = []
        round_merge_key = f"summary:{resume_round}:{section_index}:{turn}"

        def _on_turn_delta(delta_text: str) -> None:
            piece = str(delta_text or "")
            if not piece:
                return

            round_delta_parts.append(piece)

            if on_delta:
                on_delta(piece)

            if push_book_progress_step and lecture_id and book_id:
                push_book_progress_step(
                    lecture_id,
                    book_id,
                    {
                        "type": "model_text",
                        "title": f"模型输出（第 {resume_round}-{section_index + 1}-{turn} 轮）",
                        "preview": piece,
                        "merge_key": round_merge_key,
                    },
                )

        # 调用模型
        try:
            response = runner.nexora_client.proxy.chat_completions(
                messages=ctx.build(),
                model=runner.model_name,
                username=None,
                options={
                    "temperature": temperature,
                    "max_tokens": max_output_tokens,
                    "stream": bool(stream),
                    "think": bool(think),
                    "tools": tools,
                    "tool_choice": "auto",
                },
                use_chat_path=False,
                request_timeout=request_timeout,
                on_delta=_on_turn_delta,
            )
        except Exception as e:
            if log_event:
                log_event(
                    "model_call_error",
                    "模型调用错误",
                    payload={"resume_round": resume_round, "section_index": section_index, "turn": turn, "error": str(e)},
                )
            raise
        
        if not bool(response.get("ok")):
            raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")
        
        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        if not choices:
            break
        
        msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
        assistant_content = str((msg or {}).get("content") or "")
        raw_tool_calls = (msg or {}).get("tool_calls") if isinstance((msg or {}).get("tool_calls"), list) else []
        round_model_text = assistant_content if assistant_content.strip() else "".join(round_delta_parts).strip()

        # 推送模型文本输出到活动日志：一个摘要轮次只占一个模型块。
        if round_model_text and not round_delta_parts and push_book_progress_step and lecture_id and book_id:
            push_book_progress_step(
                lecture_id,
                book_id,
                {
                    "type": "model_text",
                    "title": f"模型输出（第 {resume_round}-{section_index + 1}-{turn} 轮）",
                    "preview": round_model_text,
                    "merge_key": round_merge_key,
                },
            )

        # 处理工具调用
        tool_calls = []
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
        
        if not tool_calls:
            # 没有工具调用，检查是否有纯文本摘要
            plain_summary = str(assistant_content or "").strip()
            if plain_summary and on_update_summary:
                result_obj = on_update_summary(
                    chapter_range=chapter_range,
                    chapter_summary=plain_summary,
                )
                if log_event:
                    log_event(
                        "section_summary_plain_commit",
                        "第二阶段无工具直出摘要提交",
                        payload={"resume_round": resume_round, "section_index": section_index, "turn": turn},
                    )
                if bool(result_obj.get("ok")):
                    section_done = True
                    continue
                latest_quality_feedback = str(result_obj.get("quality_feedback") or result_obj.get("error") or "").strip()
                if latest_quality_feedback:
                    ctx.add(role="user", content=f"summary quality rejected. feedback: {latest_quality_feedback}. rewrite with concrete details and call update_summary again.")
            continue
        
        # 添加助手消息到上下文
        ctx.add(
            role="assistant",
            content=assistant_content,
            tool_calls=tool_calls,
        )
        
        # 执行工具调用
        turn_has_update = False
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            call_id = str(call.get("id") or "")
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            args_obj = _safe_json_obj(str(func.get("arguments") or "{}"))

            if push_book_progress_step and lecture_id and book_id:
                push_book_progress_step(
                    lecture_id,
                    book_id,
                    {
                        "type": "tool_call",
                        "title": f"工具调用：{tool_name or 'unknown'}",
                        "preview": _safe_json_dumps(args_obj),
                    },
                )
            
            # 执行工具
            result_obj = None
            if tool_name in {"read", "read_book_text"}:
                args_obj = _clamp_to_section(args_obj, chunk_start, chunk_end)
                try:
                    req_len = int(args_obj.get("length") or 0)
                except Exception:
                    req_len = 0
                if (chunk_end - chunk_start) >= 2000 and req_len < 2000:
                    args_obj["length"] = 2000
                    args_obj = _clamp_to_section(args_obj, chunk_start, chunk_end)

                read_offset = int(args_obj.get("offset") or chunk_start)
                read_length = int(args_obj.get("length") or 0)
                read_key = (read_offset, read_length)

                if read_key in queried_ranges:
                    next_offset = max(read_offset + max(1, read_length), max((start + length for start, length in queried_ranges), default=chunk_start))

                    if next_offset < chunk_end:
                        args_obj["offset"] = next_offset
                        args_obj["length"] = min(max(2000, read_length), chunk_end - next_offset)
                        args_obj = _clamp_to_section(args_obj, chunk_start, chunk_end)

                        if log_event:
                            log_event(
                                "section_summary_read_guard_shift",
                                "第二阶段检测到重复读取同一区间，已推进读取窗口",
                                payload={
                                    "resume_round": resume_round,
                                    "section_index": section_index,
                                    "turn": turn,
                                    "from_offset": read_offset,
                                    "from_length": read_length,
                                    "to_offset": int(args_obj.get("offset") or 0),
                                    "to_length": int(args_obj.get("length") or 0),
                                },
                            )

                queried_ranges.append((int(args_obj.get("offset") or 0), int(args_obj.get("length") or 0)))

                if on_read:
                    result_obj = on_read(args_obj)
                else:
                    result_obj = {"ok": True, "text": "", "offset": args_obj.get("offset", 0), "length": args_obj.get("length", 0)}
                # 更新进度
                if push_book_progress_step and lecture_id and book_id:
                    read_start = int(result_obj.get("offset") or 0)
                    read_len = int(result_obj.get("length") or 0)
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "read",
                            "title": f"读取内容 [{read_start}, {read_start + max(0, read_len)}]",
                            "preview": (str(result_obj.get("text", ""))[:50] + "...") if len(str(result_obj.get("text", ""))) > 50 else str(result_obj.get("text", "")),
                        },
                    )
            elif tool_name in {"index", "index_book_text"}:
                args_obj = _clamp_to_section(args_obj, chunk_start, chunk_end)
                if on_index:
                    result_obj = on_index(args_obj)
                else:
                    result_obj = {"ok": True, "positions": [], "count": 0}
                # 更新进度
                if push_book_progress_step and lecture_id and book_id:
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "index",
                            "title": f"检索关键词 [{args_obj.get('keyword', '')}]",
                            "preview": f"找到 {result_obj.get('count', 0)} 个匹配位置",
                        },
                    )
            elif tool_name in {"savemem", "save_tempmem"}:
                if on_savemem:
                    result_obj = on_savemem(args_obj)
                else:
                    result_obj = {"ok": True, "saved": True}
                # 更新进度
                if push_book_progress_step and lecture_id and book_id:
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "savemem",
                            "title": "保存临时记忆",
                            "preview": str(args_obj.get("note", ""))[:50],
                        },
                    )
            elif tool_name == "update_summary":
                if on_update_summary:
                    result_obj = on_update_summary(
                        chapter_range=chapter_range,
                        chapter_summary=str(args_obj.get("chapter_summary") or "").strip(),
                    )
                    if bool(result_obj.get("ok")):
                        turn_has_update = True
                        section_done = True
                        latest_quality_feedback = ""
                    else:
                        quality_feedback = str(result_obj.get("quality_feedback") or "")
                        if quality_feedback:
                            latest_quality_feedback = quality_feedback
                            ctx.add(role="user", content=f"summary quality rejected. feedback: {quality_feedback}. rewrite with concrete events and人物, then call update_summary again.")
                else:
                    result_obj = {"ok": False, "error": "on_update_summary not configured"}
                # 更新进度
                if push_book_progress_step and lecture_id and book_id:
                    push_book_progress_step(
                        lecture_id,
                        book_id,
                        {
                            "type": "update_summary",
                            "title": f"写入章节摘要 {chapter_range}",
                            "preview": str(args_obj.get("chapter_summary", ""))[:50],
                        },
                    )
            else:
                result_obj = {"ok": True, "skipped": True, "tool_name": tool_name}
            
            # 添加工具结果到上下文
            if tool_name in {"read", "find", "index", "update_summary"}:
                ctx.add(
                    role="tool",
                    content=_safe_json_dumps(result_obj),
                    tool_call_id=call_id,
                )
            
            if log_event:
                log_event(
                    "section_summary_tool_result",
                    "第二阶段章节摘要工具结果",
                    payload={
                        "resume_round": resume_round,
                        "section_index": section_index,
                        "turn": turn,
                        "tool_name": tool_name,
                        "tool_call_id": call_id,
                        "chapter_range": chapter_range,
                    },
                    content=_safe_json_dumps(result_obj)[:2400],
                )
        
        if section_done:
            continue
    
    return {
        "section_done": section_done,
        "turns": turn,
        "context_chars": ctx.chars(),
    }
