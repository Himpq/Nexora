"""
Nexora.app.utils — 应用层基础工具

纯标准库依赖的工具函数，被应用层各模块复用。
- secure.py: 安全工具（文件名/路径/HTML 转义）
- text_patch.py: 文本补丁（diff/apply/range 替换）
- history_sanitizer.py: 历史消息清洗
- runlog.py: 运行日志
- client_tool_bridge.py: 客户端工具桥
"""
from .secure import (
    escape_html_text,
    normalize_text,
    resolve_configured_path,
    safe_filename,
    safe_join_path,
)
from .text_patch import (
    apply_range_replacements,
    apply_structured_edits,
    apply_text_patch,
    apply_unified_diff,
    build_preview_diff,
    line_separator_name,
    parse_unified_diff,
)
from .history_sanitizer import (
    is_history_separator_line,
    is_history_separator_only_text,
    is_history_time_marker_line,
    sanitize_assistant_visible_content,
    strip_history_time_prefix_from_content,
    strip_history_time_prefix_text,
    strip_streamed_history_time_marker_echo,
)
from .runlog import append_log_text, init_run_logger, log_event
from .client_tool_bridge import (
    add_request_listener,
    enqueue_request,
    pull_pending_request,
    request_client_js_execution,
    submit_request_result,
    wait_for_result,
)

__all__ = [n for n in globals() if not n.startswith('_')]
