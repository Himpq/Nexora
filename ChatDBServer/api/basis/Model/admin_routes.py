"""Nexora.basis.Model.admin_routes — 管理端模型写入路由。"""

from typing import Any, Callable, Dict, Optional

from flask import Blueprint, jsonify, request

from basis.Permission import require_admin
from App.Core.context_window import (
    MODEL_CONTEXT_WINDOW_DEFAULT,
    MODEL_CONTEXT_WINDOW_KEYS,
    _parse_model_context_window_for_save,
)
from basis.TokenUsage.billing import normalize_model_pricing


model_admin_bp = Blueprint("model_admin", __name__)

_load_models_config: Optional[Callable[[], Dict[str, Any]]] = None
_save_models_config: Optional[Callable[..., Any]] = None


def configure_model_admin_routes(
    load_models_config: Callable[[], Dict[str, Any]],
    save_models_config: Callable[..., Any],
) -> None:
    """注入 models.json 读写能力，保持路由层不依赖 server.py 全局对象。"""
    global _load_models_config, _save_models_config

    if _load_models_config is not None or _save_models_config is not None:
        raise RuntimeError("model admin routes already configured")

    _load_models_config = load_models_config
    _save_models_config = save_models_config


def _normalize_model_status_text(raw_status: Any) -> str:
    status = str(raw_status or "normal").strip().lower()

    if not status:
        return "normal"

    aliases = {
        "enable": "normal",
        "enabled": "normal",
        "active": "normal",
        "ok": "normal",
        "on": "normal",
        "disable": "disabled",
        "ban": "disabled",
        "banned": "disabled",
        "forbidden": "disabled",
        "inactive": "disabled",
        "禁用": "disabled",
        "停用": "disabled",
        "关闭": "off",
        "已关闭": "off",
        "停止": "stopped",
        "stop": "stopped",
        "quota-disabled": "quota_disabled",
        "quota disabled": "quota_disabled",
        "quota_exhausted": "quota_exhausted",
        "quota exhausted": "quota_exhausted",
        "已停用": "disabled",
        "已禁用": "disabled",
    }
    return aliases.get(status, status)


def _parse_model_pricing_for_save(raw_pricing: Any) -> Optional[Dict[str, Any]]:
    if raw_pricing is None:
        return None

    if not isinstance(raw_pricing, dict):
        raise ValueError("pricing 必须是对象")

    values = [raw_pricing.get(field) for field in ("input_per_million", "output_per_million", "cache_hit_per_million")]
    has_any_value = any(value is not None and str(value).strip() for value in values)

    if not has_any_value:
        return None

    if any(value is None or not str(value).strip() for value in values):
        raise ValueError("Input、Output、Cache Hit 三项价格需要全部填写，或全部留空")

    normalized = normalize_model_pricing(raw_pricing)

    if normalized is None:
        raise ValueError("模型价格必须是大于等于 0 的数字")

    return normalized


@model_admin_bp.route("/api/admin/models", methods=["POST"])
@model_admin_bp.route("/api/admin/models/<path:target_model_id>", methods=["PUT"])
@model_admin_bp.route("/api/admin/models/model/upsert", methods=["POST"])
@require_admin
def admin_upsert_model(target_model_id=None):
    """新增或更新模型，模型基础字段与计费字段在同一次写入中保存。"""
    if _load_models_config is None or _save_models_config is None:
        raise RuntimeError("model admin routes are not configured")

    data = request.get_json(silent=True) or {}
    model_id = (data.get("model_id") or "").strip()
    original_model_id = (target_model_id or data.get("original_model_id") or "").strip()
    name = (data.get("name") or "").strip()
    provider = (data.get("provider") or "").strip()
    status = _normalize_model_status_text(data.get("status") or "normal")
    has_context_window_input = "context_window" in data
    has_pricing_input = "pricing" in data

    try:
        context_window = _parse_model_context_window_for_save(data.get("context_window"))
        pricing = _parse_model_pricing_for_save(data.get("pricing")) if has_pricing_input else None
    except ValueError as error:
        return jsonify({"success": False, "message": str(error)}), 400

    if not model_id:
        return jsonify({"success": False, "message": "model_id 不能为空"}), 400

    if not provider:
        return jsonify({"success": False, "message": "provider 不能为空"}), 400

    try:
        config = _load_models_config()
        providers = config.setdefault("providers", {})
        models = config.setdefault("models", {})

        if provider not in providers:
            return jsonify({"success": False, "message": f"Provider 不存在: {provider}"}), 400

        is_rename = bool(original_model_id and original_model_id != model_id)
        existing_key = original_model_id if is_rename else model_id
        is_new_model = not is_rename and model_id not in models
        existing_model = models.get(existing_key, {})

        if not isinstance(existing_model, dict):
            existing_model = {}

        if is_rename:
            if original_model_id not in models:
                return jsonify({"success": False, "message": f"原模型不存在: {original_model_id}"}), 404

            if model_id in models:
                return jsonify({"success": False, "message": f"目标模型ID已存在: {model_id}"}), 400

            del models[original_model_id]

        model_record = dict(existing_model)
        model_record["name"] = name or model_id
        model_record["provider"] = provider
        model_record["status"] = status or "normal"

        if is_new_model and (not has_context_window_input or context_window <= 0):
            model_record["context_window"] = MODEL_CONTEXT_WINDOW_DEFAULT
        elif has_context_window_input:
            if context_window > 0:
                model_record["context_window"] = context_window
            else:
                for key in MODEL_CONTEXT_WINDOW_KEYS:
                    model_record.pop(key, None)

        if has_pricing_input:
            if pricing is None:
                model_record.pop("pricing", None)
            else:
                model_record["pricing"] = pricing

        models[model_id] = model_record
        _save_models_config(config, sync_source="admin_model_upsert")

        if is_rename:
            return jsonify({"success": True, "message": f"模型 {original_model_id} 已重命名为 {model_id}"})

        return jsonify({"success": True, "message": f"模型 {model_id} 已保存"})
    except Exception as error:
        return jsonify({"success": False, "message": str(error)})


@model_admin_bp.route("/api/admin/models/<path:target_model_id>", methods=["DELETE"])
@model_admin_bp.route("/api/admin/models/model/delete", methods=["POST"])
@require_admin
def admin_delete_model(target_model_id=None):
    """归档模型但保留完整配置，尤其是历史计费所需的 pricing。"""
    if _load_models_config is None or _save_models_config is None:
        raise RuntimeError("model admin routes are not configured")

    data = request.get_json(silent=True) or {}
    model_id = (target_model_id or data.get("model_id") or "").strip()
    confirm_text = data.get("confirm_text")

    if not model_id:
        return jsonify({"success": False, "message": "model_id 不能为空"}), 400

    if confirm_text != "确认修改":
        return jsonify({"success": False, "message": "确认文本错误"}), 400

    try:
        config = _load_models_config()
        models = config.setdefault("models", {})
        model_record = models.get(model_id)

        if not isinstance(model_record, dict):
            return jsonify({"success": False, "message": "模型不存在"}), 404

        archived_record = dict(model_record)
        archived_record["status"] = "archived"
        models[model_id] = archived_record
        _save_models_config(config, sync_source="admin_model_archive")

        return jsonify({
            "success": True,
            "message": f"模型 {model_id} 已归档，计费信息已保留",
        })
    except Exception as error:
        return jsonify({"success": False, "message": str(error)})
