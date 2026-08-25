"""请求性能开销记录工具。"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Mapping, Optional

from flask import Flask, Response, g, request

from core.runlog import log_event


@dataclass(frozen=True)
class PerformanceProfileConfig:
    """NexoraLearning 请求级性能记录配置。"""

    enabled: bool
    log_all_requests: bool
    slow_request_ms: float
    profiled_methods: tuple[str, ...]
    exclude_exact_paths: tuple[str, ...]
    exclude_path_prefixes: tuple[str, ...]
    exclude_path_keywords: tuple[str, ...]


def init_performance_profiler(app: Flask, cfg: Mapping[str, Any]) -> None:
    """注册 Flask 请求生命周期钩子，统一记录每个业务路由的耗时。"""
    profile_cfg = _load_performance_config(cfg)
    app.config["NEXORA_PERFORMANCE_PROFILE"] = profile_cfg

    @app.before_request
    def _profile_request_start() -> None:
        active_cfg = app.config["NEXORA_PERFORMANCE_PROFILE"]

        if not _should_profile_request(active_cfg, request.method, request.path):
            g.nexora_performance_profile = None
            return

        g.nexora_performance_profile = {
            "started_wall": time.perf_counter(),
            "started_cpu": time.process_time(),
            "logged": False,
        }

    @app.after_request
    def _profile_request_finish(response: Response) -> Response:
        active_cfg = app.config["NEXORA_PERFORMANCE_PROFILE"]
        profile = getattr(g, "nexora_performance_profile", None)

        if profile:
            _record_request_performance(active_cfg, profile, response=response, error=None)

        return response

    @app.teardown_request
    def _profile_request_error(exc: Optional[BaseException]) -> None:
        active_cfg = app.config["NEXORA_PERFORMANCE_PROFILE"]
        profile = getattr(g, "nexora_performance_profile", None)

        if profile and exc is not None:
            _record_request_performance(active_cfg, profile, response=None, error=exc)


def _load_performance_config(cfg: Mapping[str, Any]) -> PerformanceProfileConfig:
    """读取并校验性能记录配置。"""
    raw_cfg = (cfg or {}).get("performance_profile")

    if not isinstance(raw_cfg, Mapping):
        raise ValueError("performance_profile 必须是对象")

    return PerformanceProfileConfig(
        enabled=_config_bool(raw_cfg, "enabled"),
        log_all_requests=_config_bool(raw_cfg, "log_all_requests"),
        slow_request_ms=_positive_number(raw_cfg, "slow_request_ms"),
        profiled_methods=_method_tuple(raw_cfg, "profiled_methods"),
        exclude_exact_paths=_string_tuple(raw_cfg, "exclude_exact_paths"),
        exclude_path_prefixes=_string_tuple(raw_cfg, "exclude_path_prefixes"),
        exclude_path_keywords=_lower_string_tuple(raw_cfg, "exclude_path_keywords"),
    )


def _config_bool(raw_cfg: Mapping[str, Any], key: str) -> bool:
    value = raw_cfg.get(key)

    if isinstance(value, bool):
        return value

    raise ValueError(f"performance_profile.{key} 必须是布尔值")


def _positive_number(raw_cfg: Mapping[str, Any], key: str) -> float:
    value = raw_cfg.get(key)

    if isinstance(value, bool):
        raise ValueError(f"performance_profile.{key} 必须是正数")

    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"performance_profile.{key} 必须是正数") from exc

    if number <= 0:
        raise ValueError(f"performance_profile.{key} 必须大于 0")

    return number


def _string_tuple(raw_cfg: Mapping[str, Any], key: str) -> tuple[str, ...]:
    value = raw_cfg.get(key)

    if not isinstance(value, list):
        raise ValueError(f"performance_profile.{key} 必须是字符串数组")

    rows: list[str] = []

    for item in value:
        if not isinstance(item, str):
            raise ValueError(f"performance_profile.{key} 只能包含字符串")

        text = item.strip()

        if text:
            rows.append(text)

    return tuple(rows)


def _method_tuple(raw_cfg: Mapping[str, Any], key: str) -> tuple[str, ...]:
    methods = tuple(item.upper() for item in _string_tuple(raw_cfg, key))

    if not methods:
        raise ValueError(f"performance_profile.{key} 至少需要配置一个方法")

    return methods


def _lower_string_tuple(raw_cfg: Mapping[str, Any], key: str) -> tuple[str, ...]:
    return tuple(item.lower() for item in _string_tuple(raw_cfg, key))


def _should_profile_request(profile_cfg: PerformanceProfileConfig, method: str, path: str) -> bool:
    clean_path = str(path or "").strip() or "/"
    clean_method = str(method or "").strip().upper()
    path_for_match = clean_path.lower()

    if not profile_cfg.enabled:
        return False

    if clean_method not in profile_cfg.profiled_methods:
        return False

    if clean_path in profile_cfg.exclude_exact_paths:
        return False

    for prefix in profile_cfg.exclude_path_prefixes:
        if clean_path.startswith(prefix):
            return False

    for keyword in profile_cfg.exclude_path_keywords:
        if keyword in path_for_match:
            return False

    return True


def _record_request_performance(
    profile_cfg: PerformanceProfileConfig,
    profile: Mapping[str, Any],
    *,
    response: Optional[Response],
    error: Optional[BaseException],
) -> None:
    if profile.get("logged"):
        return

    profile["logged"] = True
    duration_ms = round((time.perf_counter() - float(profile.get("started_wall") or 0.0)) * 1000, 2)
    cpu_ms = round((time.process_time() - float(profile.get("started_cpu") or 0.0)) * 1000, 2)
    status_code = _status_code(response, error)
    is_error = error is not None or status_code >= 500
    is_slow = duration_ms >= profile_cfg.slow_request_ms

    if not profile_cfg.log_all_requests and not is_slow and not is_error:
        return

    event_type = _performance_event_type(is_slow, is_error)
    log_event(
        event_type,
        _performance_event_title(event_type),
        payload={
            "source": "performance",
            "method": str(request.method or "").strip(),
            "path": str(request.path or "").strip(),
            "endpoint": str(request.endpoint or "").strip(),
            "blueprint": str(request.blueprint or "").strip(),
            "rule": str(request.url_rule or "").strip(),
            "status_code": status_code,
            "duration_ms": duration_ms,
            "cpu_ms": cpu_ms,
            "request_bytes": _request_content_length(),
            "response_bytes": _response_content_length(response),
            "streaming": bool(response.is_streamed) if response is not None else False,
            "slow": bool(is_slow),
            "slow_request_ms": profile_cfg.slow_request_ms,
            "error_type": error.__class__.__name__ if error is not None else "",
        },
    )


def _performance_event_type(is_slow: bool, is_error: bool) -> str:
    if is_error:
        return "request_performance_error"

    if is_slow:
        return "request_performance_slow"

    return "request_performance"


def _performance_event_title(event_type: str) -> str:
    if event_type == "request_performance_error":
        return "请求性能记录：异常响应"

    if event_type == "request_performance_slow":
        return "请求性能记录：慢请求"

    return "请求性能记录"


def _status_code(response: Optional[Response], error: Optional[BaseException]) -> int:
    if response is not None:
        return int(response.status_code or 0)

    if error is not None:
        return 500

    return 0


def _request_content_length() -> int:
    content_length = request.content_length

    if content_length is None:
        return 0

    return int(content_length)


def _response_content_length(response: Optional[Response]) -> int:
    if response is None:
        return 0

    raw_length = response.headers.get("Content-Length")

    if raw_length is None:
        return 0

    try:
        return int(raw_length)
    except (TypeError, ValueError):
        return 0
