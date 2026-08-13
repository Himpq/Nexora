"""
Nexora.basis.TokenUsage — 用量与配额基础层

职责：Token 用量日志、配额/限额、用量明细展示、PAPI token 记录。
- quota.py: 配额/限额（server_quota）
- usage_logs.py: 用量日志读写
- details.py: 用量明细展示（TokenUsageDetailPresenter）
- token_logger.py: PAPI token 记录

对外提供（re-export 常用 API）：
"""
from .quota import (
    adjust_model_quota_total,
    get_generation_quota_gate,
    get_model_quota_change_logs,
    get_server_quota_config,
    get_server_quota_status,
    is_quota_stopped,
    is_stopped,
    set_model_quota_total,
    update_server_quota_config,
)
from .usage_logs import (
    append_usage_log_record,
    compact_usage_log_records,
    is_usage_log_path,
    maybe_compact_usage_log_async,
    read_usage_log_records,
    replace_usage_log_records,
    usage_jsonl_path,
)
from .details import TokenUsageDetailPresenter
from .token_logger import (
    build_image_generation_log_context,
    build_papi_log_context,
    build_papi_token_log_context,
    extract_usage_from_payload,
    infer_papi_action,
    iter_papi_image_log_entries,
    iter_papi_token_log_entries,
    normalize_papi_usage,
    record_papi_image_generation,
    record_papi_token_usage,
    token_log_path_for_context,
)

__all__ = [n for n in globals() if not n.startswith('_')]
