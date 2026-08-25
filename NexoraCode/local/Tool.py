"""
NexoraCode.local.Tool — 本地工具基类

工具 = 一个类，schema 与实现合一：
- name / description / parameters 作为类属性（单一事实来源，杜绝 catalog 漂移）
- run() 实现具体逻辑
- 继承本基类的工具由 ToolExecutor 统一注册、校验、执行

对外提供：
- ToolContext: 单次工具调用上下文（task_id / conversation_id / username / 取消检测）
- LocalTool: 工具基类
"""

from __future__ import annotations

from typing import Any, Callable, ClassVar


class ToolContext:
    """单次工具调用的执行上下文。"""

    def __init__(
        self,
        *,
        task_id: str = "",
        conversation_id: str = "",
        username: str = "",
        cancel_checker: Callable[[], bool] | None = None,
        project_root: str = "",
    ):
        self.task_id = str(task_id or "").strip()
        self.conversation_id = str(conversation_id or "").strip()
        self.username = str(username or "").strip()
        self.project_root = str(project_root or "").strip()
        self._cancel_checker = cancel_checker

    def cancelled(self) -> bool:
        """用户是否已中断当前生成流程。工具可在耗时循环中主动检查并终止。"""

        if callable(self._cancel_checker):
            try:
                return bool(self._cancel_checker())
            except Exception:
                return False

        return False

    def as_dict(self) -> dict:
        """转 dict，供既有共享逻辑（如权限守卫）读取。"""

        return {
            "task_id": self.task_id,
            "conversation_id": self.conversation_id,
            "username": self.username,
            "project_root": self.project_root,
            "is_cancelled": self.cancelled,
        }

    @classmethod
    def from_dict(cls, data: Any) -> "ToolContext":
        payload = data if isinstance(data, dict) else {}
        cancel_checker = payload.get("is_cancelled")

        return cls(
            task_id=str(payload.get("task_id") or "").strip(),
            conversation_id=str(
                payload.get("conversation_id")
                or payload.get("conversationId")
                or ""
            ).strip(),
            username=str(payload.get("username") or "").strip(),
            project_root=str(payload.get("project_root") or "").strip(),
            cancel_checker=cancel_checker if callable(cancel_checker) else None,
        )


class LocalTool:
    """NexoraCode 本地工具基类。子类必须实现 run()。

    返回约定：run() 返回 dict，必须带 success 布尔字段；
    失败时附带 error 字符串字段说明原因。
    """

    name: ClassVar[str] = ""
    description: ClassVar[str] = ""
    parameters: ClassVar[dict] = {"type": "object", "properties": {}, "required": []}
    aliases: ClassVar[tuple[str, ...]] = ()
    hidden: ClassVar[bool] = False
    timeout_seconds: ClassVar[float] = 0
    max_output_chars: ClassVar[int] = 0

    def run(self, args: dict, context: ToolContext) -> dict:
        raise NotImplementedError
