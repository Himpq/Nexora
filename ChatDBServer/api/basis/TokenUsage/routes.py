"""
Nexora.basis.TokenUsage.routes — 管理端配额路由（自 server.py 分批迁移）

- /api/admin/quota (GET/PUT)：服务器统一额度配置与用量概览
- /api/admin/quota/overage-alert (GET)：超额模型聚合
- /api/admin/quota/model (POST)：单模型额度调整（set/adjust）

组装契约：恢复被超额停用模型的逻辑依赖模型配置访问（server 组装层），
经 configure_quota_admin_routes() 注入；未装配即处理请求视为组装顺序错误。
"""

import time
from typing import Any

from flask import Blueprint, jsonify, request, session

from basis.Permission import require_admin

from . import (
    adjust_model_quota_total,
    get_server_quota_status,
    set_model_quota_total,
    update_server_quota_config,
)

quota_admin_bp = Blueprint('token_usage_admin', __name__)

_recover_quota_disabled_models = None


def configure_quota_admin_routes(recover_quota_disabled_models):
    """
    server 组装期注入依赖（仅允许调用一次）。

    recover_quota_disabled_models: 重新检查并恢复因超额被停用的模型
    （依赖模型配置读写，当前仍留在 server 组装层）。
    """
    global _recover_quota_disabled_models

    if _recover_quota_disabled_models is not None:
        raise RuntimeError('quota admin routes already configured')

    _recover_quota_disabled_models = recover_quota_disabled_models


def _normalize_quota_on_exhausted_action(raw_value: Any) -> str:
    raw = str(raw_value or '').strip().lower()
    if raw in {'stop_model', 'stop', 'block'}:
        return 'disable_model'
    if raw in {'none', 'noop', 'no-op'}:
        return 'no_op'
    if raw in {'no_op', 'disable_model', 'notify_admin', 'disable_and_notify'}:
        return raw
    return 'disable_model'


@quota_admin_bp.route('/api/admin/quota', methods=['GET', 'PUT'])
@require_admin
def admin_server_quota():
    """获取或更新服务器统一额度配置与用量概览"""
    try:
        if request.method == 'PUT':
            payload = request.get_json(silent=True) or {}
            quota_payload = {}
            for key in ('enabled', 'total_tokens', 'warn_threshold_tokens', 'on_exhausted', 'provider', 'provider_overage_actions'):
                if key in payload:
                    quota_payload[key] = payload.get(key)
            update_server_quota_config(quota_payload)
            _recover_quota_disabled_models(quota_payload.get('provider'))
        return jsonify({'success': True, 'quota': get_server_quota_status()})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@quota_admin_bp.route('/api/admin/quota/overage-alert', methods=['GET'])
@require_admin
def admin_server_quota_overage_alert():
    """管理员刷新页面时查询一次超额模型聚合信息。"""
    try:
        quota = get_server_quota_status()
        default_action = _normalize_quota_on_exhausted_action(quota.get('on_exhausted'))
        provider_action_map = quota.get('provider_overage_actions', {}) if isinstance(quota.get('provider_overage_actions'), dict) else {}

        def _resolve_provider_action(provider_name: Any) -> str:
            provider = str(provider_name or '').strip()
            if provider in provider_action_map:
                return _normalize_quota_on_exhausted_action(provider_action_map.get(provider))
            provider_lower = provider.lower()
            for key, value in provider_action_map.items():
                if str(key or '').strip().lower() == provider_lower:
                    return _normalize_quota_on_exhausted_action(value)
            return default_action

        model_status_map = quota.get('model_status_map', {}) if isinstance(quota.get('model_status_map'), dict) else {}
        exhausted_models = []
        notify_targets = []
        for row in model_status_map.values():
            if not isinstance(row, dict):
                continue
            overage_tokens = int(row.get('overage_tokens', 0) or 0)
            if overage_tokens <= 0 and not bool(row.get('is_exhausted')):
                continue
            provider = str(row.get('provider') or '').strip()
            action = _resolve_provider_action(provider)
            exhausted_models.append({
                'provider': provider,
                'model': str(row.get('name') or '').strip(),
                'used_tokens': int(row.get('tokens', 0) or 0),
                'quota_total_tokens': int(row.get('quota_total_tokens', 0) or 0),
                'overage_tokens': overage_tokens,
                'action': action,
            })
            if action in {'notify_admin', 'disable_and_notify'}:
                notify_targets.append(row)

        exhausted_models.sort(key=lambda item: (int(item.get('overage_tokens', 0) or 0), int(item.get('used_tokens', 0) or 0)), reverse=True)
        should_popup = bool(len(notify_targets) > 0)

        return jsonify({
            'success': True,
            'action': default_action,
            'should_popup': should_popup,
            'models': exhausted_models,
            'count': len(exhausted_models),
            'queried_at': int(time.time()),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@quota_admin_bp.route('/api/admin/quota/model', methods=['POST'])
@require_admin
def admin_model_quota_update():
    """调整单个模型额度（支持 set/adjust），并写入 data/model_quota.jsonl 记录。"""
    try:
        payload = request.get_json(silent=True) or {}
        provider = str(payload.get('provider') or '').strip()
        model = str(payload.get('model') or '').strip()
        op = str(payload.get('op') or 'adjust').strip().lower()
        actor = str(session.get('username') or 'admin').strip() or 'admin'
        reason = str(payload.get('reason') or '').strip() or ('manual_set' if op == 'set' else 'manual_adjust')

        if not provider:
            return jsonify({'success': False, 'message': 'provider 不能为空'}), 400
        if not model:
            return jsonify({'success': False, 'message': 'model 不能为空'}), 400

        if op == 'set':
            change = set_model_quota_total(
                provider_name=provider,
                model_name=model,
                total_tokens=payload.get('total_tokens', 0),
                actor=actor,
                reason=reason,
            )
        elif op == 'adjust':
            change = adjust_model_quota_total(
                provider_name=provider,
                model_name=model,
                delta_tokens=payload.get('delta_tokens', 0),
                actor=actor,
                reason=reason,
            )
        else:
            return jsonify({'success': False, 'message': '不支持的 op，允许 set / adjust'}), 400

        _recover_quota_disabled_models(provider)
        return jsonify({'success': True, 'change': change, 'quota': get_server_quota_status()})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
