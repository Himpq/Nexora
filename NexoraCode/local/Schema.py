"""
NexoraCode.local.Schema — 轻量 JSON Schema 子集校验器

本地工具 parameters 定义统一走这里校验，保证：
- 缺失必填参数、类型错误、enum 越界、数值越界都返回精确错误
- 模型传入 schema 之外的参数会被忽略，不再触发 handler TypeError
- schema 中带 default 的参数会在缺失时自动补默认值

对外提供：
- validate_parameters(value, schema): 校验并归一化，返回 (normalized, errors)
- build_parameters_schema(properties, required): 便捷构造 object 级参数 schema
"""

from __future__ import annotations

from typing import Any


def build_parameters_schema(properties: dict, required: list[str] | None = None) -> dict:
    """便捷构造一个 object 级参数 schema。"""

    return {
        "type": "object",
        "properties": properties,
        "required": [str(item) for item in (required or [])],
    }


def _type_name(value: Any) -> str:
    if value is None:
        return "null"

    if isinstance(value, bool):
        return "boolean"

    if isinstance(value, int):
        return "integer"

    if isinstance(value, float):
        return "number"

    if isinstance(value, str):
        return "string"

    if isinstance(value, list):
        return "array"

    if isinstance(value, dict):
        return "object"

    return type(value).__name__


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "null":
        return value is None

    if expected == "boolean":
        return isinstance(value, bool)

    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)

    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    if expected == "string":
        return isinstance(value, str)

    if expected == "array":
        return isinstance(value, list)

    if expected == "object":
        return isinstance(value, dict)

    return True


def _short_repr(value: Any) -> str:
    text = repr(value)

    if len(text) > 60:
        text = text[:57] + "..."

    return text


def _coerce_expected(value: Any, expected_type: str):
    """对数字 / 布尔期望做温和类型转换，减少模型传字符串导致的误伤。"""

    if expected_type in {"integer", "number"}:
        if isinstance(value, bool):
            return None

        if isinstance(value, str):
            text = value.strip()

            try:
                if expected_type == "integer":
                    return int(text)

                return float(text)
            except ValueError:
                return None

        if expected_type == "integer" and isinstance(value, float) and value.is_integer():
            return int(value)

        return value if _matches_type(value, expected_type) else None

    if expected_type == "boolean":
        if isinstance(value, str):
            text = value.strip().lower()

            if text in {"1", "true", "yes", "y", "on"}:
                return True

            if text in {"0", "false", "no", "n", "off"}:
                return False

            return None

        return value if isinstance(value, bool) else None

    return None


def _validate_value(value: Any, rule: dict, path: str, errors: list[str]) -> Any:
    """递归校验单个属性并返回归一化值（类型转换后写回），default 已在此前注入。"""

    expected_type = str(rule.get("type") or "").strip()

    if expected_type and not _matches_type(value, expected_type):
        coerced = _coerce_expected(value, expected_type)

        if coerced is None:
            errors.append(f"参数 {path} 必须是 {expected_type}，实际为 {_type_name(value)}")
            return value

        value = coerced

    if expected_type in {"integer", "number"}:
        minimum = rule.get("minimum")

        if minimum is not None and value < minimum:
            errors.append(f"参数 {path} 不能小于 {minimum}")

        maximum = rule.get("maximum")

        if maximum is not None and value > maximum:
            errors.append(f"参数 {path} 不能大于 {maximum}")

    enum_values = rule.get("enum")

    if isinstance(enum_values, list) and enum_values and value not in enum_values:
        errors.append(f"参数 {path} 必须为 {_short_repr(enum_values)} 之一，实际为 {_short_repr(value)}")

    if expected_type == "array":
        item_rule = rule.get("items")

        if isinstance(item_rule, dict):
            for index, item in enumerate(value):
                value[index] = _validate_value(item, item_rule, f"{path}[{index}]", errors)

    if expected_type == "object":
        _validate_object_fields(value, rule, path, errors)

    return value


def _validate_object_fields(value: dict, rule: dict, path: str, errors: list[str]) -> None:
    properties = rule.get("properties")

    if not isinstance(properties, dict):
        return

    for key, child_rule in properties.items():

        if not isinstance(child_rule, dict):
            continue

        if key not in value or value.get(key) is None:
            default = child_rule.get("default")

            if default is not None:
                value[key] = default

            continue

        value[key] = _validate_value(value.get(key), child_rule, f"{path}.{key}", errors)


def validate_parameters(value: Any, schema: dict) -> tuple[dict, list[str]]:
    """校验并归一化模型传入的参数。

    Args:
        value: 模型传入的参数（应为 dict）
        schema: object 级参数定义（JSON Schema 子集）

    Returns:
        (normalized, errors)：errors 非空表示校验失败
    """

    schema = schema if isinstance(schema, dict) else {}
    rule = dict(schema)
    rule.setdefault("type", "object")

    if not isinstance(value, dict):
        return {}, [f"参数必须是 object，实际为 {_type_name(value)}"]

    normalized = dict(value)
    errors: list[str] = []
    required = rule.get("required")

    if isinstance(required, list):
        for key in required:
            key_text = str(key or "").strip()

            if not key_text:
                continue

            if key_text not in normalized or normalized.get(key_text) is None:
                errors.append(f"缺少必填参数 '{key_text}'")

    if errors:
        return normalized, errors

    _validate_object_fields(normalized, rule, "参数", errors)
    return normalized, errors
