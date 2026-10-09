"""
NexoraCode.model.ShortRequest — 一次性短请求通用架构

本地 Agent 除主对话循环外，还有若干「发一次提示、收一段文本」的辅助调用：
自动审批判断、上下文摘要、会话标题生成等。它们共用同一套流式协议，但各自
重复实现了「累加 content / 捕获 usage / 处理取消 / 校验 finish_reason」的循环。

本模块把这套模式收敛为 run_short_request()：调用方只提供 messages 与参数，
即可拿到拼接后的文本、usage 与结束原因；取消、工具调用判错、usage 提取
统一在此处理，避免各调用点口径漂移。

对外提供：
- ShortRequestResult: 短请求结果（text / usage / finish_reason / tool_call_name）
- run_short_request(): 执行一次短请求并返回结果
- ShortRequestError: 短请求失败（含被取消、返回工具调用、输出被截断等）
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .Provider import ProviderClient, _extract_usage_io


class ShortRequestError(RuntimeError):
    """短请求失败：取消、返回工具调用、输出截断或空响应。"""


@dataclass
class ShortRequestResult:
    """一次短请求的归一化结果。"""

    text: str = ""
    usage: dict = field(default_factory=dict)
    finish_reason: str = ""
    tool_call_name: str = ""

    @property
    def has_usage(self) -> bool:
        return bool(self.usage)


def run_short_request(
    client: ProviderClient,
    messages: list[dict],
    *,
    tools: Optional[list[dict]] = None,
    tool_choice: Any = None,
    max_tokens: Optional[int] = None,
    cancel_checker: Optional[Callable[[], bool]] = None,
    reject_tool_calls: bool = True,
    cancel_message: str = "短请求已取消",
    tool_call_message: str = "短请求返回了工具调用",
) -> ShortRequestResult:
    """执行一次短请求，返回拼接文本与 usage。

    - cancel_checker: 每个事件前检查一次，命中即关闭上游流并抛 ShortRequestError。
    - reject_tool_calls: 为真时，模型若返回工具调用直接判错（短请求不应触发工具）。
    - usage: 取最后一次 usage 事件（Provider 在流结束时返回整次请求快照）。
    """
    result = ShortRequestResult()
    stream = client.stream_chat(messages, tools=tools, tool_choice=tool_choice, max_tokens=max_tokens)

    try:
        for event in stream:
            if callable(cancel_checker) and cancel_checker():
                client.cancel()
                raise ShortRequestError(cancel_message)

            event_type = str(event.get("type") or "")

            if event_type == "content":
                result.text += str(event.get("delta") or "")
            elif event_type == "usage":
                result.usage = _extract_usage_io(event.get("usage"))
            elif event_type == "tool_call":
                result.tool_call_name = str(event.get("name") or "")

                if reject_tool_calls:
                    raise ShortRequestError(tool_call_message)
            elif event_type == "finish":
                result.finish_reason = str(event.get("finish_reason") or "")
    finally:
        stream.close()

    if callable(cancel_checker) and cancel_checker():
        raise ShortRequestError(cancel_message)

    return result
