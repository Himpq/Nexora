"""
Nexora.basis.TokenUsage.billing — 模型费用计算与价格快照。

价格按模型保存，单位为每百万 Token。输入价格只计算未命中缓存的输入，
缓存命中价格单独计算，避免把同一批输入 Token 重复计费。
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Optional


DEFAULT_CURRENCY = "CNY"
PRICE_FIELDS = (
    "input_per_million",
    "output_per_million",
    "cache_hit_per_million",
)


def _safe_int(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError, OverflowError):
        return 0


def _parse_decimal(value: Any) -> Optional[Decimal]:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None

    if not number.is_finite() or number < 0:
        return None

    return number


def normalize_model_pricing(raw_pricing: Any) -> Optional[Dict[str, Any]]:
    """规范化模型价格；未配置时返回 None，0 价格表示免费模型。"""
    if not isinstance(raw_pricing, dict):
        return None

    values = {}
    for field in PRICE_FIELDS:
        raw_value = raw_pricing.get(field)

        if raw_value is None or not str(raw_value).strip():
            return None

        value = _parse_decimal(raw_value)

        if value is None:
            return None

        values[field] = float(value.quantize(Decimal("0.00000001")))

    currency = str(raw_pricing.get("currency") or DEFAULT_CURRENCY).strip().upper()

    if len(currency) != 3 or not currency.isalpha():
        currency = DEFAULT_CURRENCY

    return {
        "currency": currency,
        **values,
    }


def resolve_model_pricing(
    model: Any,
    provider: Any = "",
    models_config: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """从模型目录按 model/provider 查找价格配置。"""
    model_id = str(model or "").strip()
    provider_name = str(provider or "").strip().lower()

    if not model_id:
        return None

    config = models_config

    if not isinstance(config, dict):
        from basis.Config import load_models_config

        config = load_models_config()

    models = config.get("models", {}) if isinstance(config, dict) else {}

    if not isinstance(models, dict):
        return None

    candidates = []
    direct = models.get(model_id)

    if isinstance(direct, dict):
        candidates.append(direct)

    model_lower = model_id.lower()

    for model_key, info in models.items():
        if str(model_key or "").strip().lower() == model_lower and isinstance(info, dict):
            if info not in candidates:
                candidates.append(info)

    for info in candidates:
        info_provider = str(info.get("provider") or "").strip().lower()

        if provider_name and info_provider and info_provider != provider_name:
            continue

        pricing = normalize_model_pricing(info.get("pricing"))

        if pricing is not None:
            return pricing

    return None


def build_billing_snapshot(
    *,
    input_tokens: Any,
    output_tokens: Any,
    pricing: Optional[Dict[str, Any]],
    token_details: Optional[Dict[str, Any]] = None,
    raw_input_tokens: Any = None,
    cached_tokens: Any = None,
    source: str = "snapshot",
) -> Dict[str, Any]:
    """根据 Token 口径生成费用快照。"""
    details = token_details if isinstance(token_details, dict) else {}
    effective_input = _safe_int(input_tokens)
    output = _safe_int(output_tokens)
    raw_input = _safe_int(
        raw_input_tokens if raw_input_tokens is not None else details.get("raw_input_tokens")
    )
    cached = _safe_int(
        cached_tokens if cached_tokens is not None else details.get("cached_tokens")
    )

    if raw_input <= 0:
        raw_input = effective_input + cached

    cached = min(cached, raw_input)
    uncached_input = max(0, raw_input - cached)

    normalized_pricing = normalize_model_pricing(pricing)
    result = {
        "configured": bool(normalized_pricing),
        "estimated": str(source or "snapshot") != "snapshot",
        "source": str(source or "snapshot"),
        "currency": str((normalized_pricing or {}).get("currency") or DEFAULT_CURRENCY),
        "input_per_million": (normalized_pricing or {}).get("input_per_million"),
        "output_per_million": (normalized_pricing or {}).get("output_per_million"),
        "cache_hit_per_million": (normalized_pricing or {}).get("cache_hit_per_million"),
        "raw_input_tokens": raw_input,
        "uncached_input_tokens": uncached_input,
        "cached_tokens": cached,
        "output_tokens": output,
        "cost": None,
    }

    if normalized_pricing is None:
        return result

    input_cost = Decimal(uncached_input) * Decimal(str(normalized_pricing["input_per_million"])) / Decimal(1000000)
    output_cost = Decimal(output) * Decimal(str(normalized_pricing["output_per_million"])) / Decimal(1000000)
    cache_cost = Decimal(cached) * Decimal(str(normalized_pricing["cache_hit_per_million"])) / Decimal(1000000)
    total_cost = (input_cost + output_cost + cache_cost).quantize(Decimal("0.00000001"))
    result["cost"] = float(total_cost)
    result["input_cost"] = float(input_cost.quantize(Decimal("0.00000001")))
    result["output_cost"] = float(output_cost.quantize(Decimal("0.00000001")))
    result["cache_hit_cost"] = float(cache_cost.quantize(Decimal("0.00000001")))
    return result


def build_log_billing(
    log: Dict[str, Any],
    *,
    models_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """为新旧日志统一生成费用结果；旧日志按当前配置标记为历史估算。"""
    row = log if isinstance(log, dict) else {}
    snapshot = row.get("billing")

    if isinstance(snapshot, dict) and snapshot.get("cost") is not None:
        result = dict(snapshot)
        result["estimated"] = bool(snapshot.get("estimated", False))
        result["source"] = str(snapshot.get("source") or "snapshot")
        return result

    pricing = resolve_model_pricing(
        row.get("model"),
        row.get("provider"),
        models_config=models_config,
    )
    token_details = row.get("token_details") if isinstance(row.get("token_details"), dict) else {}
    return build_billing_snapshot(
        input_tokens=row.get("input_tokens", 0),
        output_tokens=row.get("output_tokens", 0),
        pricing=pricing,
        token_details=token_details,
        raw_input_tokens=row.get("raw_input_tokens"),
        cached_tokens=row.get("cached_tokens"),
        source="current_config" if pricing is not None else "unpriced",
    )


def merge_billing_totals(target: Dict[str, Any], billing: Dict[str, Any]) -> None:
    """将单条费用结果合并到统计累计值。"""
    target["records"] = int(target.get("records", 0) or 0) + 1

    if not bool(billing.get("configured")) or billing.get("cost") is None:
        target["unpriced_records"] = int(target.get("unpriced_records", 0) or 0) + 1
        return

    target["cost"] = float(target.get("cost", 0.0) or 0.0) + float(billing.get("cost", 0.0) or 0.0)
    target["input_cost"] = float(target.get("input_cost", 0.0) or 0.0) + float(billing.get("input_cost", 0.0) or 0.0)
    target["output_cost"] = float(target.get("output_cost", 0.0) or 0.0) + float(billing.get("output_cost", 0.0) or 0.0)
    target["cache_hit_cost"] = float(target.get("cache_hit_cost", 0.0) or 0.0) + float(billing.get("cache_hit_cost", 0.0) or 0.0)
