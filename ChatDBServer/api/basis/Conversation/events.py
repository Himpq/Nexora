"""
Nexora.basis.Conversation.events — 会话列表变更的实时事件出口

会话列表本身没有推送通道：创建、改标题、删除之后，其他窗口与云端浏览器要等
用户手动刷新才看到变化。本模块把变更交给组装层注入的浏览器 WSS 通道。

为什么由组装层注入：server.py 以 __main__ 启动，域模块 `from server import`
会二次执行整个模块并拿到另一套全局状态，广播必然失效。

未装配实时通道的宿主（单元测试、离线脚本）直接跳过——会话读写主链路不依赖推送。
"""

from __future__ import annotations

from typing import Any, Callable, Dict

Publisher = Callable[[str, str, Dict[str, Any]], None]

_conversation_publisher: Publisher | None = None


def configure_conversation_realtime(publisher: Publisher) -> None:
    """注入浏览器实时通道（username, event_type, payload）。"""
    if not callable(publisher):
        raise ValueError("conversation realtime publisher must be callable")

    global _conversation_publisher
    _conversation_publisher = publisher


def publish_conversation_changed(username: str, action: str, conversation_id: str, title: str = "") -> None:
    """广播会话列表变更：created / updated / deleted。

    只带会话 id、标题与动作，不含任何对话内容；接收方据此重拉会话列表，
    列表渲染自带签名去重，内容没变时不会重建视图。
    """
    publisher = _conversation_publisher
    owner = str(username or "").strip()

    if publisher is None or not owner:
        return

    publisher(owner, "conversation_changed", {
        "action": str(action or "").strip(),
        "conversation_id": str(conversation_id or "").strip(),
        "title": str(title or "").strip(),
    })
