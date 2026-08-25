"""
Nexora.app.Workspace — 工作区

承载工作区协作与存储：
- routes.py: 工作区路由（workspace_bp）
- storage.py: 工作区存储

对外提供：
- workspace_bp / find_workspace_* 等
"""
from .routes import workspace_bp
from .storage import (
    find_store_for_visible_workspace,
    message_content_to_text,
    normalize_workspace_markdown,
    validate_workspace_id,
    validate_workspace_markdown,
)

__all__ = [n for n in globals() if not n.startswith('_')]
