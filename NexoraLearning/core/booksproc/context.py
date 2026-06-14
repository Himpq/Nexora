"""通用上下文管理器 - 使用策略模式管理上下文。

策略模式：
- LLM_Compress: 使用 LLM 压缩上下文
- Truncate: 直接截断
- Sliding_Window: 滑动窗口截断
- None: 不处理

用户选择一个策略后，必须走这条路，不要回退。
"""

from __future__ import annotations

import json
import random
import time
from enum import Enum
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple, Union

from ..runlog import append_llm_compress_log


class ContextPolicy(Enum):
    """上下文管理策略"""
    LLM_COMPRESS = "llm_compress"  # 使用 LLM 压缩
    TRUNCATE = "truncate"  # 直接截断
    SLIDING_WINDOW = "sliding_window"  # 滑动窗口截断
    NONE = "none"  # 不处理


class Message:
    """消息对象"""

    def __init__(self, role: str, content: str = "", **kwargs):
        self.role = role
        self.content = content
        self.extra = kwargs  # tool_calls, tool_call_id 等

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        msg = {"role": self.role, "content": self.content}
        msg.update(self.extra)
        return msg

    def __repr__(self) -> str:
        content_preview = self.content[:50] + "..." if len(self.content) > 50 else self.content
        return f"Message(role={self.role!r}, content={content_preview!r})"

    def __len__(self) -> int:
        return len(self.content)


class Context:
    """上下文管理器 - 使用策略模式

    Example:
        # 使用 LLM 压缩策略
        ctx = Context(
            max_chars=15000,
            policy=ContextPolicy.LLM_COMPRESS,
            llm_compress_func=my_compress_func
        )

        # 使用截断策略
        ctx = Context(max_chars=15000, policy=ContextPolicy.TRUNCATE)

        # 使用滑动窗口策略
        ctx = Context(max_chars=15000, policy=ContextPolicy.SLIDING_WINDOW)
    """

    def __init__(
        self,
        max_chars: int = 15000,
        max_messages: int = 100,
        policy: ContextPolicy = ContextPolicy.LLM_COMPRESS,
        llm_compress_func: Optional[Callable[[str], str]] = None,
        trace_meta: Optional[Mapping[str, Any]] = None,
    ):
        self.max_chars = max_chars
        self.max_messages = max_messages
        self.policy = policy
        self._messages: List[Message] = []
        self._tempmem: List[str] = []
        self._llm_compress_func = llm_compress_func
        self._trace_meta = dict(trace_meta or {})
        self._stats = {
            "total_input_chars": 0,
            "total_output_chars": 0,
            "compression_count": 0,
            "truncation_count": 0,
        }
        self._request_nonce_counter = 0

    def _select_active_tail_messages(self, messages: List[Message]) -> List[Message]:
        """选择压缩后必须保留的极少量活动尾巴。

        目标不是保留最近很多轮历史，而是只保留下一轮继续工作所必需的原始消息：
        - 最新 user 指令
        - 最新 assistant tool_calls 及其后续 tool 结果
        其他历史都应交给 LLM 压缩为摘要。
        """
        if not messages:
            return []

        last_msg = messages[-1]

        if last_msg.role == "user":
            return [last_msg]

        if last_msg.role == "assistant" and bool(last_msg.extra.get("tool_calls")):
            return [last_msg]

        if last_msg.role == "tool":
            tail_start = len(messages) - 1

            while tail_start - 1 >= 0 and messages[tail_start - 1].role == "tool":
                tail_start -= 1

            if tail_start - 1 >= 0:
                prev_msg = messages[tail_start - 1]
                if prev_msg.role == "assistant" and bool(prev_msg.extra.get("tool_calls")):
                    tail_start -= 1

            return messages[tail_start:]

        return []

    def _normalize_tail_messages(self, messages: List[Message]) -> List[Message]:
        """清理尾巴消息，避免压缩后出现无前置 assistant 的孤立 tool 消息。"""
        normalized = list(messages or [])

        while normalized and normalized[0].role == "tool":
            normalized.pop(0)

        return normalized

    def add(self, role: str, content: str, **kwargs) -> Message:
        """添加消息"""
        msg = Message(role=role, content=content, **kwargs)
        self._messages.append(msg)
        return msg

    def get(self, index: int) -> Optional[Message]:
        """获取消息"""
        try:
            return self._messages[index]
        except IndexError:
            return None

    def remove(self, index: int) -> Optional[Message]:
        """移除消息"""
        try:
            return self._messages.pop(index)
        except IndexError:
            return None

    def insert(self, index: int, role: str, content: str, **kwargs) -> Message:
        """插入消息"""
        msg = Message(role=role, content=content, **kwargs)
        self._messages.insert(index, msg)
        return msg

    def replace(self, index: int, role: str = None, content: str = None, **kwargs) -> Optional[Message]:
        """替换消息"""
        msg = self.get(index)
        if msg is None:
            return None
        if role is not None:
            msg.role = role
        if content is not None:
            msg.content = content
        if kwargs:
            msg.extra.update(kwargs)
        return msg

    def clean(self) -> None:
        """清空所有消息"""
        self._messages.clear()

    def clear(self) -> None:
        """清空所有消息（别名）"""
        self.clean()

    def build(self) -> List[Dict[str, Any]]:
        """构建消息列表（用于 API 调用）"""
        messages = [msg.to_dict() for msg in self._messages]
        nonce = self._build_request_nonce_message()

        if nonce:
            messages.append(nonce.to_dict())

        return messages

    def _build_request_nonce_message(self) -> Optional[Message]:
        """为每次模型请求注入短扰动，打破同上下文下的重复轨迹。"""
        self._request_nonce_counter += 1
        now_ms = int(time.time() * 1000)
        random_salt = f"{random.getrandbits(32):08x}"
        flow = str(self._trace_meta.get("flow") or "booksproc").strip()
        content = (
            "[运行扰动]\n"
            f"flow={flow}\n"
            f"request_nonce={now_ms}-{self._request_nonce_counter}-{random_salt}\n"
            "该值只用于打破重复上下文导致的固定输出轨迹；不得写入业务结果，不得改变工具参数结构。"
        )
        return Message(role="user", content=content)

    def chars(self) -> int:
        """估算当前消息列表的字符数"""
        return sum(len(msg) for msg in self._messages)

    def count(self) -> int:
        """获取消息数量"""
        return len(self._messages)

    def is_empty(self) -> bool:
        """是否为空"""
        return len(self._messages) == 0

    def last(self) -> Optional[Message]:
        """获取最后一条消息"""
        return self.get(-1)

    def first(self) -> Optional[Message]:
        """获取第一条消息"""
        return self.get(0)

    def find_by_role(self, role: str) -> List[Message]:
        """按角色查找消息"""
        return [msg for msg in self._messages if msg.role == role]

    def find_last_by_role(self, role: str) -> Optional[Message]:
        """查找最后一条指定角色的消息"""
        for msg in reversed(self._messages):
            if msg.role == role:
                return msg
        return None

    # ==================== TempMem 暂存记忆 ====================

    def tempmem_add(self, text: str) -> None:
        """添加暂存记忆"""
        if text and text.strip():
            self._tempmem.append(text.strip())

    def tempmem_get(self) -> str:
        """获取暂存记忆文本"""
        return "\n".join(self._tempmem) if self._tempmem else ""

    def tempmem_clear(self) -> None:
        """清空暂存记忆"""
        self._tempmem.clear()

    def tempmem_count(self) -> int:
        """获取暂存记忆数量"""
        return len(self._tempmem)

    # ==================== 策略执行 ====================

    def _get_system_and_other_msgs(self, keep_system: bool = True) -> Tuple[List[Message], List[Message]]:
        """分离系统消息和其他消息"""
        if keep_system:
            system_msgs = [m for m in self._messages if m.role == "system"]
            other_msgs = [m for m in self._messages if m.role != "system"]
        else:
            system_msgs = []
            other_msgs = list(self._messages)
        return system_msgs, other_msgs

    def _find_split_index(self, system_msgs: List[Message], other_msgs: List[Message]) -> int:
        """从后往前找到分割点"""
        system_chars = sum(len(m) for m in system_msgs)
        remaining_chars = self.max_chars - system_chars
        split_index = len(other_msgs)

        accumulated = 0
        for i in range(len(other_msgs) - 1, -1, -1):
            accumulated += len(other_msgs[i])
            if accumulated > remaining_chars:
                split_index = i + 1
                break
        else:
            # 所有消息都能放下
            return -1

        # 至少保留最后一条消息
        if split_index >= len(other_msgs):
            split_index = len(other_msgs) - 1

        return split_index

    def _build_compress_text(self, msgs: List[Message]) -> str:
        """构建压缩文本"""
        return "\n".join(
            f"[{msg.role}]: {msg.content}" for msg in msgs if msg.content
        )

    def _serialize_messages(self, msgs: List[Message]) -> List[Dict[str, Any]]:
        """序列化消息列表用于日志记录。"""
        return [msg.to_dict() for msg in msgs]

    def _execute_llm_compress(self, keep_system: bool = True) -> bool:
        """执行 LLM 压缩策略 - 将旧消息压缩为摘要并插入对话

        压缩后的摘要以消息形式插入到对话历史中，取代被压缩的旧消息。
        这样下次压缩时会连同摘要一起处理，避免系统提示词无限增长。
        """
        if not self._llm_compress_func:
            raise RuntimeError("LLM compress function is not set. Cannot execute LLM compression.")

        if self.chars() <= self.max_chars:
            return False

        before_messages = self._serialize_messages(self._messages)
        before_chars = self.chars()
        before_count = len(self._messages)
        system_msgs, other_msgs = self._get_system_and_other_msgs(keep_system)
        if len(other_msgs) <= 1:
            return False

        # 保存第一条 user 消息，防止压缩后丢失
        original_user_msg = None
        for m in other_msgs:
            if m.role == "user":
                original_user_msg = m
                break

        retained_tail = self._normalize_tail_messages(self._select_active_tail_messages(other_msgs))
        retained_tail_count = len(retained_tail)
        if retained_tail_count > 0:
            msgs_to_compress = other_msgs[:-retained_tail_count]
        else:
            msgs_to_compress = list(other_msgs)

        msgs_to_keep = list(retained_tail)

        if not msgs_to_compress:
            return False

        compress_text = self._build_compress_text(msgs_to_compress)
        if not compress_text.strip():
            return False

        # 调用 LLM 压缩 - 必须成功
        compressed = self._llm_compress_func(compress_text)
        if not compressed or not compressed.strip():
            raise RuntimeError("LLM compression returned empty result.")

        # 将压缩结果作为普通消息插入到对话中，替代被压缩的旧消息
        # 使用 assistant 角色以便下次压缩时被一并处理，避免系统提示词无限增长
        summary_msg = Message(
            role="assistant",
            content=f"[上下文压缩摘要]\n{compressed}",
        )
        self._messages = system_msgs + [summary_msg] + msgs_to_keep

        # 确保压缩后至少保留一条 user 消息（Chat API 要求）
        if original_user_msg:
            has_user_after = any(m.role == "user" for m in self._messages if m not in system_msgs)
            if not has_user_after:
                insert_index = len(system_msgs) + 1  # system 之后、summary 之后
                self._messages.insert(insert_index, original_user_msg)

        # 如果插入摘要后仍超出限制，只允许继续丢弃保留尾巴，直到变成真正的小上下文。
        while self.chars() > self.max_chars and len(msgs_to_keep) > 0:
            msgs_to_keep.pop(0)
            msgs_to_keep = self._normalize_tail_messages(msgs_to_keep)
            self._messages = system_msgs + [summary_msg] + msgs_to_keep
            # 再次检查 user 消息
            if original_user_msg:
                has_user_after = any(m.role == "user" for m in self._messages if m not in system_msgs)
                if not has_user_after:
                    insert_index = len(system_msgs) + 1
                    self._messages.insert(insert_index, original_user_msg)

        self._stats["compression_count"] += 1
        append_llm_compress_log(
            {
                "trace_meta": dict(self._trace_meta),
                "policy": self.policy.value,
                "max_chars": int(self.max_chars),
                "before": {
                    "chars": int(before_chars),
                    "messages_count": int(before_count),
                    "messages": before_messages,
                },
                "compress_scope": {
                    "split_index": -1,
                    "system_messages_count": int(len(system_msgs)),
                    "compressed_messages_count": int(len(msgs_to_compress)),
                    "kept_messages_count": int(len(msgs_to_keep)),
                    "tail_strategy": "system + summary + minimal_active_tail",
                    "messages": self._serialize_messages(msgs_to_compress),
                    "text": compress_text,
                },
                "compressed_summary": str(compressed),
                "after": {
                    "chars": int(self.chars()),
                    "messages_count": int(len(self._messages)),
                    "messages": self._serialize_messages(self._messages),
                },
                "stats": self.stats(),
            }
        )
        return True

    def _execute_truncate(self, keep_system: bool = True) -> bool:
        """执行直接截断策略"""
        if self.chars() <= self.max_chars:
            return False

        system_msgs, other_msgs = self._get_system_and_other_msgs(keep_system)

        # 从最早的消息开始截断
        while other_msgs and (sum(len(m) for m in system_msgs) + sum(len(m) for m in other_msgs)) > self.max_chars:
            if len(other_msgs) <= 1:
                break
            other_msgs.pop(0)

        self._messages = system_msgs + other_msgs
        self._stats["truncation_count"] += 1
        return True

    def _execute_sliding_window(self, keep_system: bool = True) -> bool:
        """执行滑动窗口截断策略"""
        if self.chars() <= self.max_chars:
            return False

        system_msgs, other_msgs = self._get_system_and_other_msgs(keep_system)
        if len(other_msgs) <= 1:
            return False

        split_index = self._find_split_index(system_msgs, other_msgs)
        if split_index < 0:
            return False

        # 移除分割点之前的消息
        other_msgs = other_msgs[split_index:]
        self._messages = system_msgs + other_msgs
        self._stats["truncation_count"] += 1
        return True

    def execute_policy(self) -> bool:
        """执行当前策略

        Returns:
            是否进行了处理
        """
        if self.policy == ContextPolicy.LLM_COMPRESS:
            return self._execute_llm_compress()
        elif self.policy == ContextPolicy.TRUNCATE:
            return self._execute_truncate()
        elif self.policy == ContextPolicy.SLIDING_WINDOW:
            return self._execute_sliding_window()
        elif self.policy == ContextPolicy.NONE:
            return False
        else:
            raise ValueError(f"Unknown policy: {self.policy}")

    def inject_tempmem(self) -> None:
        """将 TempMem 内容注入到系统提示词中

        TempMem 内容会作为历史上下文摘要注入到第一条系统消息之后。
        注入后清空 TempMem，避免下一轮重复注入。
        """
        if not self._tempmem:
            return

        tempmem_text = self.tempmem_get()
        injection = f"\n[历史上下文摘要]\n以下是之前对话的压缩摘要，请结合这些上下文继续工作：\n{tempmem_text}\n"

        # 注入后立即清空，避免下一轮重复注入
        self._tempmem.clear()

        # 找到第一条系统消息并在其后注入
        for i, msg in enumerate(self._messages):
            if msg.role == "system":
                self._messages[i].content += injection
                return

        # 如果没有系统消息，在最前面插入一条
        self.insert(0, role="system", content=injection.strip())

    def inject_policy_notice(self) -> None:
        """注入策略通知提示词"""
        if self.policy == ContextPolicy.LLM_COMPRESS:
            notice = "[系统提示] 由于上下文长度限制，部分早期内容已被压缩，请参考上文中 [上下文压缩摘要] 中的历史上下文继续工作。"
        elif self.policy == ContextPolicy.TRUNCATE:
            notice = "[系统提示] 由于上下文长度限制，部分早期内容已被截断。请基于当前可见的内容继续工作。"
        elif self.policy == ContextPolicy.SLIDING_WINDOW:
            notice = "[系统提示] 由于上下文长度限制，使用滑动窗口策略移除了部分早期内容。请基于当前可见的内容继续工作。"
        else:
            return

        # 在最后一条用户消息之前插入通知
        for i in range(len(self._messages) - 1, -1, -1):
            if self._messages[i].role == "user":
                self.insert(i, role="user", content=notice)
                break

    def prepare(self) -> bool:
        """准备请求前的上下文处理

        1. 执行策略（压缩/截断）
        2. 注入策略通知（如果进行了处理）

        Returns:
            是否进行了处理
        """
        # 执行策略
        executed = self.execute_policy()

        if executed:
            self.inject_policy_notice()

        self._stats["total_input_chars"] += self.chars()
        return executed

    # ==================== 统计 ====================

    def stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            **self._stats,
            "current_chars": self.chars(),
            "current_messages": self.count(),
            "tempmem_count": self.tempmem_count(),
            "policy": self.policy.value,
        }

    def __repr__(self) -> str:
        return f"Context(messages={len(self._messages)}, chars={self.chars()}, max_chars={self.max_chars}, policy={self.policy.value})"

    def __len__(self) -> int:
        return len(self._messages)

    def __iter__(self):
        return iter(self._messages)

    def __getitem__(self, index):
        return self._messages[index]


class ToolDef:
    """工具定义"""

    def __init__(
        self,
        name: str,
        description: str,
        parameters: Dict[str, Any],
        required: List[str] = None,
    ):
        self.name = name
        self.description = description
        self.parameters = parameters
        self.required = required or []

    def to_dict(self) -> Dict[str, Any]:
        """转换为 API 格式"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": self.parameters,
                    "required": self.required,
                },
            },
        }

    def __repr__(self) -> str:
        return f"ToolDef(name={self.name!r})"


class ToolTask:
    """工具任务 - 定义和执行工具调用"""

    def __init__(self, tools: List[ToolDef] = None):
        self.tools = tools or []
        self._handlers: Dict[str, Callable] = {}
        self._history: List[Dict[str, Any]] = []

    def add(self, tool: ToolDef) -> None:
        """添加工具定义"""
        self.tools.append(tool)

    def register(self, name: str, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """注册工具处理器"""
        self._handlers[name] = handler

    def execute(self, name: str, args: Dict[str, Any]) -> Any:
        """执行工具调用"""
        if name not in self._handlers:
            return {"error": f"Unknown tool: {name}"}

        start_time = time.time()
        try:
            result = self._handlers[name](args)
            elapsed = time.time() - start_time
            self._history.append({
                "tool": name,
                "args": args,
                "result": result,
                "elapsed": elapsed,
                "success": True,
            })
            return result
        except Exception as e:
            elapsed = time.time() - start_time
            self._history.append({
                "tool": name,
                "args": args,
                "error": str(e),
                "elapsed": elapsed,
                "success": False,
            })
            raise

    def get_definitions(self) -> List[Dict[str, Any]]:
        """获取所有工具定义（用于 API 调用）"""
        return [tool.to_dict() for tool in self.tools]

    def get_history(self) -> List[Dict[str, Any]]:
        """获取工具调用历史"""
        return list(self._history)

    def clear_history(self) -> None:
        """清空工具调用历史"""
        self._history.clear()

    def has_handler(self, name: str) -> bool:
        """检查是否有指定工具的处理器"""
        return name in self._handlers

    def __repr__(self) -> str:
        return f"ToolTask(tools={[t.name for t in self.tools]})"


# ==================== 便捷函数 ====================

def create_context(
    max_chars: int = 15000,
    policy: ContextPolicy = ContextPolicy.LLM_COMPRESS,
    llm_compress_func: Optional[Callable[[str], str]] = None,
    trace_meta: Optional[Mapping[str, Any]] = None,
) -> Context:
    """创建上下文管理器"""
    return Context(
        max_chars=max_chars,
        policy=policy,
        llm_compress_func=llm_compress_func,
        trace_meta=trace_meta,
    )


def create_tool_task() -> ToolTask:
    """创建工具任务"""
    return ToolTask()


def create_read_tool() -> ToolDef:
    """创建 read 工具定义"""
    return ToolDef(
        name="read",
        description="读取指定范围的文本内容",
        parameters={
            "offset": {"type": "integer", "description": "起始位置（字符偏移量）"},
            "length": {"type": "integer", "description": "读取长度（字符数）"},
        },
        required=["offset", "length"],
    )


def create_find_tool() -> ToolDef:
    """创建 find 工具定义"""
    return ToolDef(
        name="find",
        description="搜索关键词，返回匹配位置",
        parameters={
            "keyword": {"type": "string", "description": "要搜索的关键词"},
        },
        required=["keyword"],
    )


def create_write_tool(description: str = "提交结果") -> ToolDef:
    """创建 write 工具定义"""
    return ToolDef(
        name="write",
        description=description,
        parameters={
            "content": {"type": "string", "description": "提交的内容"},
        },
        required=["content"],
    )
