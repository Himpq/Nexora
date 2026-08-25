"""
Nexora.app.Agent — Agent 层

承载 Agent 隧道与权限：
- agent_tunnel.py: Agent WSS 隧道（注册/心跳/工具转发）
- agent_permissions.py: Agent 权限

对外提供：
- register_agent / update_agent_tools / handle_agent_result 等
- grant_agent_permission
"""
from .agent_tunnel import (
    add_agent_status_listener,
    call_local_tool_sync,
    get_agent_prompt,
    get_agent_tools,
    handle_agent_result,
    is_agent_online,
    register_agent,
    unregister_agent,
    update_agent_prompt,
    update_agent_tools,
    update_ping,
)
from .agent_permissions import agent_permissions_bp, grant_agent_permission

__all__ = [n for n in globals() if not n.startswith('_')]
