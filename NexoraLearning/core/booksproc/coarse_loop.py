"""粗读工具循环模块 - 使用 Context Manager 管理上下文。

重构要点：
1. 使用 Context 类管理消息列表，支持策略模式
2. 支持 LLM_Compress, Truncate, Sliding_Window 等策略
3. 支持 rolling_read_window 模式
4. 支持 hard_constraint_round 强制写入机制
"""

from __future__ import annotations

import json
import time
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


def _is_read_tool_message(msg: Dict[str, Any]) -> bool:
    """检查是否为 read 工具消息"""
    if msg.get("role") == "tool":
        return True
    if msg.get("role") == "assistant":
        tool_calls = msg.get("tool_calls") or []
        if isinstance(tool_calls, list):
            for tc in tool_calls:
                if isinstance(tc, dict):
                    func = tc.get("function") or {}
                    name = str(func.get("name") or "").strip()
                    if name in {"read", "read_book_text"}:
                        return True
    return False


def run_tool_driven_round_with_context(
    *,
    runner: Any,
    tools: List[Dict[str, Any]],
    system_prompt: str,
    user_prompt: str,
    full_text: str,
    total_len: int,
    chunk_start: int,
    chunk_end: int,
    max_input_chars: int = 15000,
    max_turns: int = 18,
    force_write_trigger_turns: int = 4,
    temperature: float = 0.2,
    max_output_tokens: int = 4000,
    request_timeout: int = 240,
    stream: bool = True,
    think: bool = False,
    on_delta: Optional[Callable[[str], None]] = None,
    on_save_chapter: Optional[Callable] = None,
    on_update_chapter: Optional[Callable] = None,
    log_event: Optional[Callable] = None,
    log_model_text: Optional[Callable] = None,
    log_tool_flow: Optional[Callable] = None,
    push_book_progress_step: Optional[Callable] = None,
    rolling_read_window: bool = True,
    resume_round: int = 1,
    tempmem_key: str = "",
    is_cancelled: Optional[Callable[[], bool]] = None,
    lecture_id: str = "",
    book_id: str = "",
    policy: ContextPolicy = ContextPolicy.LLM_COMPRESS,
    llm_compress_func: Optional[Callable[[str], str]] = None,
) -> Dict[str, Any]:
    """使用 Context Manager 执行工具驱动的粗读轮次"""
    
    # 创建上下文管理器（使用指定策略）
    ctx = Context(
        max_chars=max_input_chars,
        policy=policy,
        llm_compress_func=llm_compress_func,
        trace_meta={
            "flow": "coarse_loop",
            "lecture_id": str(lecture_id or ""),
            "book_id": str(book_id or ""),
            "resume_round": int(resume_round),
            "chunk_start": int(chunk_start),
            "chunk_end": int(chunk_end),
        },
    )
    ctx.add(role="system", content=system_prompt)
    ctx.add(role="user", content=user_prompt)
    
    # 状态变量
    output_text = ""
    assistant_concat: List[str] = []
    saved_chapter_calls = 0
    total_tool_calls = 0
    chunk_done = False
    no_write_turn_streak = 0
    force_write_injected = False
    read_seen: Dict[str, int] = {}
    last_read_end = 0
    context_rolled = False
    
    # 工具处理器
    def handle_read(args: Dict[str, Any]) -> Dict[str, Any]:
        nonlocal last_read_end
        req_offset = int(args.get("offset") or 0)
        req_length = int(args.get("length") or 0)
        allow_out_of_chunk = bool(args.get("allow_out_of_chunk") is True)
        
        if not allow_out_of_chunk:
            if req_offset < chunk_start:
                req_offset = chunk_start
            if req_offset >= chunk_end:
                req_offset = max(chunk_start, chunk_end - 1)
            max_len_in_chunk = max(1, chunk_end - req_offset)
            if req_length > max_len_in_chunk:
                req_length = max_len_in_chunk
        
        # 检测重复读取
        read_key = f"{req_offset}:{req_length}"
        read_seen[read_key] = int(read_seen.get(read_key) or 0) + 1
        if read_seen[read_key] >= 2:
            safe_next_offset = max(last_read_end, req_offset + max(1, min(req_length, 5000)))
            if safe_next_offset < total_len:
                req_offset = safe_next_offset
                if log_event:
                    log_event(
                        "model_read_guard_shift",
                        "检测到重复读取同一区间，后端自动推进 offset",
                        payload={"from_offset": int(args.get("offset") or 0), "to_offset": safe_next_offset},
                    )
        
        # 执行读取
        safe_offset = max(0, min(req_offset, total_len))
        safe_length = max(0, min(req_length, total_len - safe_offset))
        text_content = full_text[safe_offset:safe_offset + safe_length] if safe_length > 0 else ""
        
        last_read_end = max(last_read_end, safe_offset + safe_length)
        
        # 更新进度
        if push_book_progress_step and lecture_id and book_id:
            push_book_progress_step(
                lecture_id,
                book_id,
                {
                    "type": "read",
                    "title": f"读取内容 [{safe_offset}, {safe_offset + max(0, safe_length)}]",
                    "preview": (text_content[:50] + "...") if len(text_content) > 50 else text_content,
                },
            )
        
        return {
            "text": text_content,
            "offset": safe_offset,
            "length": safe_length,
            "remaining": max(0, total_len - (safe_offset + safe_length)),
        }
    
    def handle_savemem(args: Dict[str, Any]) -> Dict[str, Any]:
        memory = str(args.get("memory") or args.get("note") or "").strip()
        # 这里应该调用 tempmem 相关的函数
        # 更新进度
        if push_book_progress_step and lecture_id and book_id:
            push_book_progress_step(
                lecture_id,
                book_id,
                {
                    "type": "savemem",
                    "title": "保存临时记忆",
                    "preview": (memory[:50] + "...") if len(memory) > 50 else memory,
                },
            )
        return {"ok": True, "saved": bool(memory)}
    
    def handle_write(args: Dict[str, Any]) -> Dict[str, Any]:
        nonlocal saved_chapter_calls, chunk_done
        if on_save_chapter:
            result = on_save_chapter(
                str(args.get("chapter_name") or ""),
                str(args.get("chapter_range") or ""),
                str(args.get("chapter_summary") or ""),
            )
            if bool(result.get("ok")):
                saved_chapter_calls += 1
                chunk_done = True
            # 更新进度
            if push_book_progress_step and lecture_id and book_id:
                push_book_progress_step(
                    lecture_id,
                    book_id,
                    {
                        "type": "write",
                        "title": f"写入章节 {args.get('chapter_name', '')}",
                        "preview": str(args.get("chapter_summary", ""))[:50],
                    },
                )
            return result
        return {"ok": False, "error": "on_save_chapter not configured"}
    
    def handle_update_chapter(args: Dict[str, Any]) -> Dict[str, Any]:
        nonlocal saved_chapter_calls, chunk_done
        if on_update_chapter:
            result = on_update_chapter(
                str(args.get("chapter_range") or ""),
                str(args.get("chapter_name") or ""),
                str(args.get("chapter_summary") or ""),
                str(args.get("old_chapter_name") or ""),
            )
            if bool(result.get("ok")):
                saved_chapter_calls += 1
                chunk_done = True
            # 更新进度
            if push_book_progress_step and lecture_id and book_id:
                push_book_progress_step(
                    lecture_id,
                    book_id,
                    {
                        "type": "update_chapter",
                        "title": f"更新章节 {args.get('chapter_name', '')}",
                        "preview": str(args.get("chapter_summary", ""))[:50],
                    },
                )
            return result
        return {"ok": False, "error": "on_update_chapter not configured"}
    
    tool_handlers = {
        "read": handle_read,
        "read_book_text": handle_read,
        "savemem": handle_savemem,
        "save_tempmem": handle_savemem,
        "write": handle_write,
        "save_chapter": handle_write,
        "update_chapter": handle_update_chapter,
    }
    
    for turn in range(1, max_turns + 1):
        # 检查是否被取消
        if is_cancelled and is_cancelled():
            raise RuntimeError("cancelled by admin")
        
        # 检查是否需要强制写入
        force_round_active = (no_write_turn_streak >= force_write_trigger_turns) and (not force_write_injected)
        if force_round_active:
            force_write_injected = True
            hard_constraint = (
                "\n\n[HARD_CONSTRAINT_ROUND]\n"
                "你已经连续多轮未完成有效写入。"
                "本轮你必须立刻完成以下两项工具调用并结束：\n"
                "1) savemem(...)\n"
                "2) write(...)\n"
                "严禁仅输出计划文本；严禁只读不写；本轮未满足将视为失败。"
            )
            ctx.add(role="user", content=hard_constraint)
            if log_event:
                log_event(
                    "model_hard_constraint_round",
                    "触发硬约束回合（必须 savemem + write）",
                    payload={"resume_round": resume_round, "turn": turn, "streak": no_write_turn_streak},
                )
        
        # 准备上下文（执行策略）
        executed = ctx.prepare()
        if executed:
            context_rolled = True
            if log_event:
                log_event(
                    "context_operation",
                    f"上下文{('压缩' if policy == ContextPolicy.LLM_COMPRESS else '截断')}",
                    payload={"resume_round": resume_round, "turn": turn, "policy": policy.value},
                )
        
        if log_event:
            log_event(
                "model_tool_round",
                "粗读工具轮次",
                payload={
                    "resume_round": resume_round,
                    "turn": turn,
                    "context_chars": ctx.chars(),
                    "messages_count": ctx.count(),
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
                on_delta=on_delta,
            )
        except Exception as e:
            if log_event:
                log_event(
                    "model_call_error",
                    "模型调用错误",
                    payload={"resume_round": resume_round, "turn": turn, "error": str(e)},
                )
            raise
        
        if not bool(response.get("ok")):
            raise RuntimeError(f"Nexora API Error: {response.get('message') or 'request failed'}")
        
        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            break
        
        msg = choices[0].get("message") if isinstance(choices[0].get("message"), dict) else {}
        assistant_content = str(msg.get("content") or "")
        raw_tool_calls = msg.get("tool_calls") if isinstance(msg.get("tool_calls"), list) else []

        # 记录助手内容
        if assistant_content.strip():
            assistant_concat.append(assistant_content)
            if log_model_text:
                log_model_text(assistant_content, source="rough_reading")
            # 推送模型文本输出到活动日志
            if push_book_progress_step and lecture_id and book_id:
                push_book_progress_step(
                    lecture_id,
                    book_id,
                    {
                        "type": "model_text",
                        "title": "模型输出",
                        "preview": assistant_content[:200],
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
            # 没有工具调用
            if assistant_content.strip():
                if log_event:
                    log_event(
                        "model_no_tool_progress",
                        "模型未调用工具，仅返回规划文本",
                        payload={"resume_round": resume_round, "turn": turn},
                    )
            continue
        
        # 添加助手消息到上下文
        ctx.add(
            role="assistant",
            content=assistant_content,
            tool_calls=tool_calls,
        )
        
        # 执行工具调用
        turn_has_write = False
        turn_has_savemem = False
        
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            total_tool_calls += 1
            call_id = str(call.get("id") or "")
            func = call.get("function") if isinstance(call.get("function"), dict) else {}
            tool_name = str(func.get("name") or "").strip()
            args_raw = str(func.get("arguments") or "{}")
            args_obj = _safe_json_obj(args_raw)
            
            if log_event:
                log_event(
                    "model_tool_call",
                    "粗读模型工具调用",
                    payload={"resume_round": resume_round, "turn": turn, "tool_name": tool_name},
                )
            
            # 执行工具
            if tool_name in tool_handlers:
                try:
                    result_obj = tool_handlers[tool_name](args_obj)
                except Exception as e:
                    result_obj = {"ok": False, "error": str(e)}
            else:
                result_obj = {"ok": False, "error": f"unsupported tool: {tool_name}"}
            
            # 记录工具结果
            if log_tool_flow:
                log_tool_flow(
                    tool_name=tool_name,
                    arguments=args_obj,
                    tool_output=result_obj,
                    model_output=assistant_content,
                    source="rough_reading",
                )
            
            # 添加工具结果到上下文
            ctx.add(
                role="tool",
                content=_safe_json_dumps(result_obj),
                tool_call_id=call_id,
            )
            
            # 更新状态
            if tool_name in {"write", "save_chapter"}:
                turn_has_write = True
            if tool_name in {"savemem", "save_tempmem"}:
                turn_has_savemem = True
        
        # 检查是否需要强制写入
        if force_round_active:
            if not (turn_has_savemem and turn_has_write):
                no_write_turn_streak += 1
                continue
        
        # 更新 streak
        if chunk_done:
            no_write_turn_streak = 0
        else:
            no_write_turn_streak += 1
        
        # 如果 chunk 完成，退出循环
        if chunk_done:
            break
    
    # 构建输出
    assistant_text = "\n".join([part for part in assistant_concat if str(part or "").strip()]).strip()
    return {
        "assistant_text": assistant_text,
        "context_rolled": context_rolled,
        "saved_chapter_calls": saved_chapter_calls,
        "tool_calls": total_tool_calls,
        "context_chars": ctx.chars(),
        "chunk_done": bool(chunk_done),
    }
