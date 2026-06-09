"""NexoraSearch 上下文管理器

严格的消息格式规范：
- [SYSTEM_PROMPT] - 系统提示词
- [USER] - 用户消息
- [AI] - 模型输出
- [TOOLCALL] - 工具调用
- [TOOL_RESULT] - 工具返回结果
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple


class SearchContext:
    """NexoraSearch 上下文管理器"""

    def __init__(self, max_chars: int = 100000):
        self.max_chars = max_chars
        self._messages: List[Dict[str, Any]] = []

    def add_system(self, content: str) -> None:
        """添加系统消息"""
        self._messages.append({"role": "system", "content": content})

    def add_user(self, content: str) -> None:
        """添加用户消息"""
        self._messages.append({"role": "user", "content": content})

    def add_assistant(self, content: str, tool_calls: Optional[List[Dict]] = None) -> None:
        """添加助手消息"""
        msg = {"role": "assistant", "content": content}
        if tool_calls:
            msg["tool_calls"] = tool_calls
        self._messages.append(msg)

    def add_tool_call(self, name: str, arguments: Dict[str, Any], result: str) -> None:
        """添加工具调用及结果（作为一轮对话）"""
        # 助手发起工具调用
        call_content = f"[TOOLCALL] {json.dumps({'name': name, 'arguments': arguments}, ensure_ascii=False)}"
        self._messages.append({"role": "assistant", "content": call_content})

        # 工具返回结果
        result_content = f"[TOOL_RESULT] Tool call done: {result}"
        self._messages.append({"role": "user", "content": result_content})

    def add_tool_calls_batch(self, calls: List[Tuple[str, Dict[str, Any], str]]) -> None:
        """批量添加工具调用及结果

        格式：
        助手：<tool_call>{...}</tool_call>\n<tool_call>{...}</tool_call>
        用户：[工具结果]
        工具 search_bilibili 返回：
        ...
        ---
        工具 search_web 返回：
        ...
        """
        # 助手发起多个工具调用（保持原始格式）
        call_parts = []
        for name, arguments, _ in calls:
            call_parts.append(f'<tool_call>\n{{"name": "{name}", "arguments": {json.dumps(arguments, ensure_ascii=False)}}}\n</tool_call>')
        self._messages.append({"role": "assistant", "content": "\n".join(call_parts)})

        # 工具返回结果（清晰分隔）
        result_parts = []
        for name, _, result in calls:
            result_parts.append(f"【工具 {name} 返回结果】\n{result}")
        self._messages.append({"role": "user", "content": "\n\n---\n\n".join(result_parts)})

    def build(self) -> List[Dict[str, Any]]:
        """构建消息列表（用于 API 调用）"""
        return list(self._messages)

    def chars(self) -> int:
        """估算当前消息列表的字符数"""
        return sum(len(str(msg.get("content", ""))) for msg in self._messages)

    def count(self) -> int:
        """获取消息数量"""
        return len(self._messages)

    def is_empty(self) -> bool:
        """是否为空"""
        return len(self._messages) == 0

    def last(self) -> Optional[Dict[str, Any]]:
        """获取最后一条消息"""
        return self._messages[-1] if self._messages else None

    def clear(self) -> None:
        """清空所有消息"""
        self._messages.clear()

    def truncate_if_needed(self) -> bool:
        """如果超出限制，截断早期消息（保留系统消息和最近的消息）"""
        if self.chars() <= self.max_chars:
            return False

        # 分离系统消息和其他消息
        system_msgs = [m for m in self._messages if m["role"] == "system"]
        other_msgs = [m for m in self._messages if m["role"] != "system"]

        # 从最早的消息开始截断
        while other_msgs and (sum(len(str(m.get("content", ""))) for m in system_msgs) + sum(len(str(m.get("content", ""))) for m in other_msgs)) > self.max_chars:
            if len(other_msgs) <= 2:  # 至少保留最后一轮对话
                break
            other_msgs.pop(0)

        self._messages = system_msgs + other_msgs
        return True

    def format_debug(self) -> str:
        """格式化调试信息"""
        lines = []
        for i, msg in enumerate(self._messages):
            role = msg["role"]
            content = str(msg.get("content", ""))
            preview = content[:100] + "..." if len(content) > 100 else content
            lines.append(f"[{i}] {role}: {preview}")
        return "\n".join(lines)


def parse_tool_calls(text: str) -> List[Dict[str, Any]]:
    """从模型输出中解析工具调用

    只支持标准格式：<tool_call>{"name": "...", "arguments": {...}}</tool_call>
    """
    calls = []
    for m in re.finditer(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", text, re.DOTALL):
        try:
            obj = json.loads(m.group(1))
            name = str(obj.get("name") or "").strip()
            args = obj.get("arguments") or {}
            if name:
                calls.append({"name": name, "arguments": args, "raw": m.group(0)})
        except json.JSONDecodeError:
            pass
    return calls


def strip_tool_calls(text: str) -> str:
    """从文本中移除工具调用块"""
    return re.sub(r"<tool_call>[\s\S]*?</tool_call>", "", text).strip()
