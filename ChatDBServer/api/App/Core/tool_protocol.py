"""工具调用协议的纯函数辅助逻辑。"""

import json
from typing import Any, Callable, Dict, List, Optional


INVALID_TOOL_ARGUMENTS_KEY = "__nexora_invalid_tool_arguments__"


class ToolLoopRoundCounter:
    """记录已经完成的模型响应轮次，并统一控制最大轮次。"""

    def __init__(self, max_rounds: int):
        self.max_rounds = max(0, int(max_rounds))
        self.current_index = 0

    def has_budget(self) -> bool:
        """当前是否仍允许发起一次新的模型请求。"""
        return self.current_index < self.max_rounds

    def complete_round(self) -> int:
        """在响应与工具执行完成后推进轮次，并返回一基轮次号。"""
        if not self.has_budget():
            raise RuntimeError("工具循环轮次已经耗尽")

        self.current_index += 1

        return self.current_index


def build_invalid_tool_arguments_payload(raw_arguments: Any, error: Any) -> str:
    """把非法工具参数转换为显式错误信封，保留原文供模型纠正。"""
    if isinstance(raw_arguments, str):
        raw_text = raw_arguments
    else:
        try:
            raw_text = json.dumps(raw_arguments, ensure_ascii=False, default=str)
        except Exception:
            raw_text = str(raw_arguments)

    payload = {
        INVALID_TOOL_ARGUMENTS_KEY: {
            "raw_arguments": raw_text,
            "parse_error": str(error or "工具参数不是有效 JSON"),
        }
    }

    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def sanitize_tool_calls_in_messages(
    messages: List[Dict[str, Any]],
    logger: Optional[Callable[[str], None]] = None,
) -> List[Dict[str, Any]]:
    """规范历史工具参数，并显式保留所有无法解析的原始参数。"""
    sanitized: List[Dict[str, Any]] = []

    for message in messages or []:
        if not isinstance(message, dict):
            sanitized.append(message)
            continue

        normalized_message = dict(message)
        tool_calls = normalized_message.get("tool_calls")

        if not isinstance(tool_calls, list) or not tool_calls:
            sanitized.append(normalized_message)
            continue

        normalized_tool_calls: List[Dict[str, Any]] = []

        for tool_call in tool_calls:
            if not isinstance(tool_call, dict):
                continue

            function = tool_call.get("function")

            if not isinstance(function, dict):
                normalized_tool_calls.append(tool_call)
                continue

            raw_arguments = function.get("arguments")

            if isinstance(raw_arguments, str):
                arguments_text = raw_arguments
            elif raw_arguments is None:
                arguments_text = ""
            else:
                try:
                    arguments_text = json.dumps(raw_arguments, ensure_ascii=False, default=str)
                except Exception as error:
                    arguments_text = build_invalid_tool_arguments_payload(raw_arguments, error)

            parse_error: Optional[Exception] = None

            if not arguments_text.strip():
                parse_error = ValueError("工具参数为空")
            else:
                try:
                    json.loads(arguments_text)
                except Exception as error:
                    parse_error = error

            normalized_function = dict(function)

            if parse_error is None:
                normalized_function["arguments"] = arguments_text
            else:
                normalized_function["arguments"] = build_invalid_tool_arguments_payload(
                    arguments_text,
                    parse_error,
                )

                if callable(logger):
                    logger(
                        "[TOOL_PROTOCOL] invalid historical tool arguments preserved "
                        f"name={str(function.get('name') or '')} "
                        f"error={str(parse_error)} raw_chars={len(arguments_text)}"
                    )

            normalized_tool_call = dict(tool_call)
            normalized_tool_call["function"] = normalized_function
            normalized_tool_calls.append(normalized_tool_call)

        normalized_message["tool_calls"] = normalized_tool_calls
        sanitized.append(normalized_message)

    return sanitized


def canonical_tool_call_signature(function_calls: List[Dict[str, Any]]) -> str:
    """生成与 call_id 无关的工具调用签名，用于识别语义重复。"""
    normalized_calls: List[Dict[str, str]] = []

    for function_call in function_calls or []:
        if not isinstance(function_call, dict):
            continue

        raw_arguments = str(function_call.get("arguments") or "").strip()

        try:
            parsed_arguments = json.loads(raw_arguments)
            canonical_arguments = json.dumps(
                parsed_arguments,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
        except Exception:
            canonical_arguments = raw_arguments

        normalized_calls.append({
            "name": str(function_call.get("name") or "").strip(),
            "arguments": canonical_arguments,
        })

    if not normalized_calls:
        return ""

    return json.dumps(
        normalized_calls,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def build_tool_json_error_message(function_name: str, arguments: Any, error: Any) -> str:
    """构建可供模型直接定位并修正的 JSON 解析错误。"""
    raw_text = str(arguments or "")
    position = int(getattr(error, "pos", 0) or 0)
    excerpt_start = max(0, position - 80)
    excerpt_end = min(len(raw_text), position + 80)
    excerpt = raw_text[excerpt_start:excerpt_end]
    pointer_offset = max(0, position - excerpt_start)
    pointer = " " * pointer_offset + "^"

    return (
        f"错误：工具 '{str(function_name or 'unknown')}' 的参数JSON解析失败 - {str(error)}\n"
        "下面是模型原始参数在错误位置附近的内容：\n"
        f"{excerpt}\n"
        f"{pointer}\n"
        "请根据工具参数 schema 修复 JSON 语法后重新调用；不要重复原参数。"
    )
