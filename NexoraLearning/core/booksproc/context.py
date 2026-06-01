"""通用上下文管理器 - 用于 booksproc 中所有模型调用的上下文管理。

提供：
1. Context 类 - 消息列表管理（add/get/remove/insert/replace/clean/build）
2. ToolTask 类 - 工具任务定义和执行
3. 滑动窗口截断策略
4. 工具调用结果保留策略
5. TempMem 暂存记忆功能
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple, Union


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
    """上下文管理器
    
    Example:
        ctx = Context(max_chars=15000)
        ctx.add(role="system", content="你是一个助手")
        ctx.add(role="user", content="你好")
        print(ctx.build())  # 构建消息列表
        print(ctx.get(-1))  # 获取最后一条消息
        ctx.remove(-1)      # 移除最后一条消息
        ctx.clean()         # 清空所有消息
    """

    def __init__(self, max_chars: int = 15000, max_messages: int = 100):
        self.max_chars = max_chars
        self.max_messages = max_messages
        self._messages: List[Message] = []
        self._tempmem: List[str] = []
        self._stats = {
            "total_input_chars": 0,
            "total_output_chars": 0,
            "truncation_count": 0,
        }

    def add(self, role: str, content: str, **kwargs) -> Message:
        """添加消息
        
        Args:
            role: 消息角色 (system/user/assistant/tool)
            content: 消息内容
            **kwargs: 额外参数 (tool_calls, tool_call_id 等)
            
        Returns:
            创建的 Message 对象
        """
        msg = Message(role=role, content=content, **kwargs)
        self._messages.append(msg)
        return msg

    def get(self, index: int) -> Optional[Message]:
        """获取消息
        
        Args:
            index: 消息索引，支持负数（-1 表示最后一条）
            
        Returns:
            Message 对象，如果索引无效则返回 None
        """
        try:
            return self._messages[index]
        except IndexError:
            return None

    def remove(self, index: int) -> Optional[Message]:
        """移除消息
        
        Args:
            index: 消息索引，支持负数
            
        Returns:
            被移除的 Message 对象，如果索引无效则返回 None
        """
        try:
            return self._messages.pop(index)
        except IndexError:
            return None

    def insert(self, index: int, role: str, content: str, **kwargs) -> Message:
        """插入消息
        
        Args:
            index: 插入位置索引
            role: 消息角色
            content: 消息内容
            **kwargs: 额外参数
            
        Returns:
            创建的 Message 对象
        """
        msg = Message(role=role, content=content, **kwargs)
        self._messages.insert(index, msg)
        return msg

    def replace(self, index: int, role: str = None, content: str = None, **kwargs) -> Optional[Message]:
        """替换消息
        
        Args:
            index: 消息索引
            role: 新角色（如果为 None 则保持原角色）
            content: 新内容（如果为 None 则保持原内容）
            **kwargs: 新的额外参数
            
        Returns:
            更新后的 Message 对象，如果索引无效则返回 None
        """
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
        """构建消息列表（用于 API 调用）
        
        Returns:
            消息字典列表
        """
        return [msg.to_dict() for msg in self._messages]

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

    # ==================== 截断策略 ====================

    def truncate_sliding_window(self, keep_system: bool = True) -> bool:
        """滑动窗口截断策略
        
        当消息列表超过 max_chars 时，截断最早的消息。
        
        Args:
            keep_system: 是否保留系统提示词
            
        Returns:
            是否进行了截断
        """
        if self.chars() <= self.max_chars:
            return False

        if keep_system:
            system_msgs = [m for m in self._messages if m.role == "system"]
            other_msgs = [m for m in self._messages if m.role != "system"]
        else:
            system_msgs = []
            other_msgs = list(self._messages)

        # 从最早的消息开始截断
        while other_msgs and (sum(len(m) for m in system_msgs) + sum(len(m) for m in other_msgs)) > self.max_chars:
            if len(other_msgs) <= 1:
                break
            other_msgs.pop(0)

        self._messages = system_msgs + other_msgs
        self._stats["truncation_count"] += 1
        return True

    def truncate_keep_recent_tools(self, keep_count: int = 3) -> bool:
        """保留最近N个工具调用的截断策略
        
        Args:
            keep_count: 保留的最近工具调用数量
            
        Returns:
            是否进行了截断
        """
        if self.chars() <= self.max_chars:
            return False

        # 找出所有工具结果消息的索引
        tool_indices = [i for i, msg in enumerate(self._messages) if msg.role == "tool"]

        # 如果工具调用数量超过保留数量，移除最早的
        if len(tool_indices) > keep_count:
            indices_to_remove = tool_indices[:-keep_count]
            # 从后往前移除，避免索引变化
            for idx in reversed(indices_to_remove):
                self._messages.pop(idx)
            self._stats["truncation_count"] += 1
            return True

        return False

    def auto_truncate(self) -> str:
        """自动截断，使用多种策略
        
        Returns:
            截断操作的描述，如果没有截断则返回空字符串
        """
        # 首先尝试滑动窗口
        if self.truncate_sliding_window():
            return "sliding_window"

        # 然后尝试保留最近工具
        if self.truncate_keep_recent_tools():
            return "keep_recent_tools"

        return ""

    def inject_truncation_notice(self) -> None:
        """注入截断通知提示词"""
        notice = "[系统提示] 由于上下文长度限制，部分早期内容已被截断。请基于当前可见的内容继续工作。"
        # 在最后一条用户消息之前插入通知
        for i in range(len(self._messages) - 1, -1, -1):
            if self._messages[i].role == "user":
                self.insert(i, role="user", content=notice)
                break

    def prepare(self) -> str:
        """准备请求前的上下文处理
        
        Returns:
            截断操作的描述
        """
        truncation_type = self.auto_truncate()
        if truncation_type:
            self.inject_truncation_notice()
        self._stats["total_input_chars"] += self.chars()
        return truncation_type

    # ==================== 统计 ====================

    def stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            **self._stats,
            "current_chars": self.chars(),
            "current_messages": self.count(),
            "tempmem_count": self.tempmem_count(),
        }

    def __repr__(self) -> str:
        return f"Context(messages={len(self._messages)}, chars={self.chars()}, max_chars={self.max_chars})"

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
    """工具任务 - 定义和执行工具调用
    
    Example:
        read_tool = ToolDef(
            name="read",
            description="读取文本",
            parameters={
                "offset": {"type": "integer", "description": "起始位置"},
                "length": {"type": "integer", "description": "读取长度"},
            },
            required=["offset", "length"],
        )
        
        task = ToolTask(tools=[read_tool])
        task.register("read", lambda args: {"content": "..."})
        result = task.execute("read", {"offset": 0, "length": 100})
    """

    def __init__(self, tools: List[ToolDef] = None):
        self.tools = tools or []
        self._handlers: Dict[str, Callable] = {}
        self._history: List[Dict[str, Any]] = []

    def add(self, tool: ToolDef) -> None:
        """添加工具定义"""
        self.tools.append(tool)

    def register(self, name: str, handler: Callable[[Dict[str, Any]], Any]) -> None:
        """注册工具处理器
        
        Args:
            name: 工具名称
            handler: 处理函数，接收参数字典，返回结果
        """
        self._handlers[name] = handler

    def execute(self, name: str, args: Dict[str, Any]) -> Any:
        """执行工具调用
        
        Args:
            name: 工具名称
            args: 工具参数
            
        Returns:
            工具执行结果
            
        Raises:
            ValueError: 未知的工具名称
            Exception: 工具执行错误
        """
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

def create_context(max_chars: int = 15000) -> Context:
    """创建上下文管理器"""
    return Context(max_chars=max_chars)


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


# ==================== 测试代码 ====================

if __name__ == "__main__":
    print("=" * 60)
    print("Context Manager 测试")
    print("=" * 60)

    # 创建上下文
    ctx = Context(max_chars=1000)
    print(f"\n1. 创建上下文: {ctx}")

    # 添加消息
    ctx.add(role="system", content="你是一个AI助手")
    ctx.add(role="user", content="你好")
    ctx.add(role="assistant", content="你好！有什么可以帮助你的吗？")
    print(f"\n2. 添加3条消息后: {ctx}")
    print(f"   消息数量: {ctx.count()}")
    print(f"   字符数: {ctx.chars()}")

    # 获取消息
    msg = ctx.get(-1)
    print(f"\n3. 获取最后一条消息: {msg}")

    msg = ctx.get(0)
    print(f"   获取第一条消息: {msg}")

    # 构建消息列表
    messages = ctx.build()
    print(f"\n4. 构建消息列表: {json.dumps(messages, ensure_ascii=False, indent=2)}")

    # 插入消息
    ctx.insert(1, role="user", content="这是插入的消息")
    print(f"\n5. 在位置1插入消息后: {ctx}")
    print(f"   消息列表:")
    for i, msg in enumerate(ctx):
        print(f"     [{i}] {msg}")

    # 替换消息
    ctx.replace(-1, role="system", content="这是替换后的系统消息")
    print(f"\n6. 替换最后一条消息后:")
    for i, msg in enumerate(ctx):
        print(f"     [{i}] {msg}")

    # 移除消息
    removed = ctx.remove(1)
    print(f"\n7. 移除位置1的消息: {removed}")
    print(f"   移除后的消息列表:")
    for i, msg in enumerate(ctx):
        print(f"     [{i}] {msg}")

    # 按角色查找
    system_msgs = ctx.find_by_role("system")
    print(f"\n8. 查找所有system消息: {system_msgs}")

    last_user = ctx.find_last_by_role("user")
    print(f"   查找最后一条user消息: {last_user}")

    # TempMem 测试
    ctx.tempmem_add("这是一条暂存记忆")
    ctx.tempmem_add("这是另一条暂存记忆")
    print(f"\n9. TempMem: {ctx.tempmem_get()}")
    print(f"   TempMem数量: {ctx.tempmem_count()}")

    # 清空
    ctx.clean()
    print(f"\n10. 清空后: {ctx}")
    print(f"    是否为空: {ctx.is_empty()}")

    # 统计信息
    print(f"\n11. 统计信息: {ctx.stats()}")

    print("\n" + "=" * 60)
    print("ToolTask 测试")
    print("=" * 60)

    # 创建工具任务
    task = ToolTask()
    print(f"\n1. 创建工具任务: {task}")

    # 添加工具定义
    read_tool = create_read_tool()
    find_tool = create_find_tool()
    write_tool = create_write_tool("提交批注")

    task.add(read_tool)
    task.add(find_tool)
    task.add(write_tool)
    print(f"\n2. 添加工具后: {task}")
    print(f"   工具定义: {json.dumps(task.get_definitions(), ensure_ascii=False, indent=2)}")

    # 注册处理器
    def handle_read(args):
        offset = args.get("offset", 0)
        length = args.get("length", 100)
        return {"content": f"读取的内容[{offset}:{offset+length}]", "offset": offset, "length": length}

    def handle_find(args):
        keyword = args.get("keyword", "")
        return {"keyword": keyword, "positions": [10, 20, 30], "count": 3}

    def handle_write(args):
        content = args.get("content", "")
        return {"status": "ok", "count": len(content)}

    task.register("read", handle_read)
    task.register("find", handle_find)
    task.register("write", handle_write)
    print(f"\n3. 注册处理器后: {task}")

    # 执行工具
    result = task.execute("read", {"offset": 0, "length": 100})
    print(f"\n4. 执行 read 工具: {result}")

    result = task.execute("find", {"keyword": "测试"})
    print(f"   执行 find 工具: {result}")

    result = task.execute("write", {"content": "这是批注内容"})
    print(f"   执行 write 工具: {result}")

    # 工具历史
    print(f"\n5. 工具调用历史:")
    for h in task.get_history():
        print(f"   {h['tool']}: success={h['success']}, elapsed={h['elapsed']:.3f}s")

    print("\n" + "=" * 60)
    print("完整流程测试")
    print("=" * 60)

    # 模拟一个完整的工具循环
    ctx = Context(max_chars=500)
    ctx.add(role="system", content="你是一个批注生成助手")
    ctx.add(role="user", content="请为以下文本生成批注：这是一段测试文本...")

    print(f"\n1. 初始上下文: {ctx}")

    # 模拟模型响应（包含工具调用）
    ctx.add(
        role="assistant",
        content="我需要先读取文本内容",
        tool_calls=[{"id": "call_1", "function": {"name": "read", "arguments": '{"offset":0,"length":50}'}}],
    )

    # 模拟工具结果
    ctx.add(role="tool", content=json.dumps({"content": "这是一段测试文本..."}, ensure_ascii=False), tool_call_id="call_1")

    print(f"\n2. 添加工具调用后: {ctx}")
    print(f"   消息列表:")
    for i, msg in enumerate(ctx):
        print(f"     [{i}] {msg}")

    # 准备请求
    truncation = ctx.prepare()
    print(f"\n3. 准备请求: truncation={truncation}")
    print(f"   统计信息: {ctx.stats()}")

    print("\n" + "=" * 60)
    print("测试完成!")
    print("=" * 60)
