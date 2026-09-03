# -*- coding: utf-8 -*-
"""
Append 式上下文压缩。

旧方案：把持久化消息拍平成纯文本，独立发起 [system, user] 两次消息的压缩请求。
问题：总结器看不到构建期注入的 diff 事件块（丢数据），且拍平文本与主请求
前缀完全不同，provider prefix cache 全灭。

本方案：直接复用当轮主请求的完整上下文消息（head + 历史 + tail 注入块），
仅截掉最后一条 user 消息（当前轮的活跃提问不参与摘要），在末尾追加一条
压缩指令消息。前缀与此前各轮请求逐字节一致从而命中缓存，注入块也天然
进入总结视野。压缩完成后由调用方全量重建上下文（新 head + 摘要 + 新历史）。
"""

from typing import Any, Dict, Generator, List, Tuple

import prompts

# 压缩指令固定用 user 角色追加在消息序列末尾：
# system 角色会被 Provider 的 _coalesce_system_messages_to_front 归位到
# 最后一条 user 之前，位置不可控；user 角色保持原位且所有 Provider 均合法。
COMPRESSION_INSTRUCTION_ROLE = "user"


def build_append_compression_messages(
    full_messages: List[Dict[str, Any]],
    instruction_text: str,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    从当轮完整请求消息构建压缩请求消息。

    返回 (compress_messages, last_user_pos)：
    - compress_messages：截掉最后一条 user（当前轮提问）后的消息 + 末尾压缩指令；
    - last_user_pos：最后一条 user 在 full_messages 中的下标；无 user 或无前置
      上下文时返回 -1，调用方据此中止压缩（无边界则无法确定截断点）。
    """

    last_user_pos = -1
    for idx, item in enumerate(full_messages or []):
        if isinstance(item, dict) and str(item.get("role") or "").strip().lower() == "user":
            last_user_pos = idx

    if last_user_pos <= 0:
        return [], -1

    compress_messages = list(full_messages[:last_user_pos])
    compress_messages.append({
        "role": COMPRESSION_INSTRUCTION_ROLE,
        "content": str(instruction_text or ""),
    })
    return compress_messages, last_user_pos


def run_append_compression_round(
    model: Any,
    compress_messages: List[Dict[str, Any]],
    max_chars: int,
    use_responses_api: bool,
) -> Generator[Dict[str, Any], None, Dict[str, Any]]:
    """
    执行 append 式压缩轮次：复用主请求同构的请求参数发起流式调用，
    模型输出即摘要。yield 进度事件（model_reply_delta / error），
    return 汇总 dict {summary, model_reply, error, message_count, chars, max_chars}。
    """

    safe_max_chars = max(600, min(120000, int(max_chars or 6000)))
    out: Dict[str, Any] = {
        "summary": "",
        "model_reply": "",
        "error": "",
        "message_count": int(len(compress_messages or [])),
        "chars": 0,
        "max_chars": int(safe_max_chars),
        "use_responses_api": bool(use_responses_api),
    }

    if not compress_messages:
        out["error"] = "empty_compression_context"
        return out

    # 与主请求同一构建器：chat.completions / responses 两种协议的载荷形状
    # 与主请求保持一致，前缀才可能逐字节命中 provider prefix cache
    request_params = model._build_request_params(
        messages=list(compress_messages),
        previous_response_id=None,
        enable_thinking=False,
        enable_web_search=False,
        enable_tools=False,
        thinking_level="",
        current_function_outputs=None,
        runtime_function_tool_names=set(),
    )

    stream_text = ""

    try:
        response_iterator = model.provider_adapter.create_stream_iterator(
            client=model.client,
            request_params=request_params,
            use_responses_api=use_responses_api,
        )
        stream_events = model.provider_adapter.iter_stream_events(
            response_iterator,
            use_responses_api=use_responses_api,
            native_web_search_enabled=False,
        )

        for event in stream_events:
            if not isinstance(event, dict):
                continue

            ev_type = str(event.get("type", "") or "").strip()

            if ev_type != "content_delta":
                continue

            delta = str(event.get("delta", "") or "")

            if not delta:
                continue

            stream_text += delta
            yield {
                "type": "model_reply_delta",
                "delta": delta,
                "model_reply": stream_text,
                "chars": int(len(stream_text)),
                "from_stream": True,
            }
    except Exception as exc:
        out["error"] = str(exc or "")
        print(f"[CTX_COMPRESS] append compression round failed: {exc}")
        yield {"type": "error", "error": out["error"], "from_stream": True}
        return out

    final_text = str(stream_text or "").strip()
    out["model_reply"] = final_text
    out["chars"] = int(len(final_text))

    if final_text:
        out["summary"] = final_text[:safe_max_chars]

    return out
