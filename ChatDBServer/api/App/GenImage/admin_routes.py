"""
Nexora.App.GenImage.admin_routes — 管理端生图接口配置路由（自 server.py 分批迁移）

- /api/admin/gen-image/apis (GET/POST + PUT/upsert)
- /api/admin/gen-image/apis/<api_id>/enabled + /enable (PUT/POST)
- /api/admin/gen-image/enabled-api + /apis/disable (DELETE/POST)
- /api/admin/gen-image/apis/<api_id> + /apis/delete (DELETE/POST)

组装契约：主配置读写（ensure_main_config_defaults / save_main_config，含迁移
钩子的 server 侧包装）经 configure_gen_image_admin_routes() 注入。
"""

import re
import time
from typing import Any, Dict

from flask import Blueprint, jsonify, request

from App.Utils import mask_public_api_key
from basis.Permission import coerce_bool_flag, require_admin

gen_image_admin_bp = Blueprint('gen_image_admin', __name__)

_ensure_main_config_defaults = None
_save_main_config = None


def configure_gen_image_admin_routes(ensure_main_config_defaults, save_main_config):
    """server 组装期注入依赖（仅允许调用一次）。"""
    global _ensure_main_config_defaults, _save_main_config

    if _ensure_main_config_defaults is not None:
        raise RuntimeError('gen image admin routes already configured')

    _ensure_main_config_defaults = ensure_main_config_defaults
    _save_main_config = save_main_config


# ==================== 配置归一化（自 server.py 迁入） ====================

def _normalize_gen_image_api_id(raw: Any) -> str:
    text = str(raw or '').strip()
    text = re.sub(r'\s+', '_', text)
    text = re.sub(r'[^a-zA-Z0-9_.-]', '', text)
    return text[:64]


def _normalize_gen_image_api_type(raw: Any) -> str:
    text = str(raw or '').strip().lower()

    if text in {'dashscope', 'dashscope-native', 'dashscope_native'}:
        return 'dashscope'

    if text in {'openai-compatible', 'openai compatible', 'openai_compatible'}:
        return 'openai_compatible'

    return 'openai'


def _normalize_gen_image_size(raw: Any) -> str:
    text = str(raw or '').strip().lower()

    if not text:
        return '1024x1024'

    if not re.fullmatch(r'\d{2,5}x\d{2,5}', text):
        raise ValueError('图片尺寸格式必须是 1024x1024 这样的 宽x高')

    return text


def _normalize_gen_image_timeout(raw: Any) -> int:
    try:
        value = int(raw or 120)
    except Exception:
        value = 120

    return max(10, min(value, 600))


def _normalize_gen_image_record(api_id: str, raw: Any, enabled_api: str = '') -> Dict[str, Any]:
    item = raw if isinstance(raw, dict) else {}
    safe_id = _normalize_gen_image_api_id(api_id or item.get('api_id') or item.get('id'))

    if not safe_id:
        raise ValueError('接口标识不能为空')

    record = {
        'api_id': safe_id,
        'name': str(item.get('name') or safe_id).strip()[:80] or safe_id,
        'api_type': _normalize_gen_image_api_type(item.get('api_type')),
        'api_key': str(item.get('api_key') or '').strip(),
        'base_url': str(item.get('base_url') or '').strip().rstrip('/'),
        'model': str(item.get('model') or 'gpt-image-1').strip(),
        'size': _normalize_gen_image_size(item.get('size') or '1024x1024'),
        'quality': str(item.get('quality') or 'auto').strip() or 'auto',
        'response_format': str(item.get('response_format') or 'b64_json').strip(),
        'timeout': _normalize_gen_image_timeout(item.get('timeout')),
        'enabled': safe_id == str(enabled_api or '').strip(),
        'updated_at': int(item.get('updated_at') or 0),
        'created_at': int(item.get('created_at') or 0),
    }

    return record


def _normalize_gen_image_config(raw: Any) -> Dict[str, Any]:
    cfg = raw if isinstance(raw, dict) else {}
    apis_raw = cfg.get('apis', {}) if isinstance(cfg.get('apis'), dict) else {}
    enabled_api = _normalize_gen_image_api_id(cfg.get('enabled_api'))
    apis: Dict[str, Dict[str, Any]] = {}

    for api_id, item in apis_raw.items():
        safe_id = _normalize_gen_image_api_id(api_id)

        if not safe_id:
            continue

        try:
            apis[safe_id] = _normalize_gen_image_record(safe_id, item, enabled_api)
        except ValueError:
            continue

    if enabled_api not in apis:
        enabled_api = ''

    for api_id, item in apis.items():
        item['enabled'] = api_id == enabled_api

    return {
        'enabled_api': enabled_api,
        'apis': apis,
    }


def _get_gen_image_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    gen_cfg = cfg.get('gen_image') if isinstance(cfg, dict) else {}
    normalized = _normalize_gen_image_config(gen_cfg)

    if isinstance(cfg, dict) and cfg.get('gen_image') != normalized:
        cfg['gen_image'] = normalized

    return normalized


def _assert_gen_image_record_ready(record: Dict[str, Any]) -> None:
    if not str(record.get('api_key') or '').strip():
        raise ValueError('启用生图接口前必须填写 API Key')

    if not str(record.get('base_url') or '').strip():
        raise ValueError('启用生图接口前必须填写 Base URL')

    if not str(record.get('model') or '').strip():
        raise ValueError('启用生图接口前必须填写模型 ID')


def _gen_image_config_public_payload(gen_cfg: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_gen_image_config(gen_cfg)
    apis = []

    for api_id, item in sorted(normalized.get('apis', {}).items(), key=lambda row: row[0].lower()):
        row = dict(item)
        row['api_key_masked'] = mask_public_api_key(row.get('api_key'))
        apis.append(row)

    return {
        'enabled_api': normalized.get('enabled_api', ''),
        'apis': apis,
    }


# ==================== 路由 ====================

@gen_image_admin_bp.route('/api/admin/gen-image/apis', methods=['GET'])
@require_admin
def admin_get_gen_image_apis():
    """管理员读取生图接口配置"""
    try:
        cfg = _ensure_main_config_defaults()
        gen_cfg = _get_gen_image_config(cfg)
        _save_main_config(cfg)
        return jsonify({
            'success': True,
            **_gen_image_config_public_payload(gen_cfg),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@gen_image_admin_bp.route('/api/admin/gen-image/apis', methods=['POST'])
@gen_image_admin_bp.route('/api/admin/gen-image/apis/<path:api_id>', methods=['PUT'])
@gen_image_admin_bp.route('/api/admin/gen-image/apis/upsert', methods=['POST'])
@require_admin
def admin_upsert_gen_image_api(api_id=None):
    """新增或更新生图接口配置"""
    data = request.get_json(silent=True) or {}
    api_id = _normalize_gen_image_api_id(data.get('api_id') or data.get('id') or api_id)
    original_api_id = _normalize_gen_image_api_id(data.get('original_api_id') or api_id)

    if not api_id:
        return jsonify({'success': False, 'message': '接口标识不能为空'}), 400

    try:
        cfg = _ensure_main_config_defaults()
        gen_cfg = _get_gen_image_config(cfg)
        apis = gen_cfg.setdefault('apis', {})

        if original_api_id and original_api_id != api_id:

            if original_api_id not in apis:
                return jsonify({'success': False, 'message': '原接口不存在'}), 404

            if api_id in apis:
                return jsonify({'success': False, 'message': f'接口已存在: {api_id}'}), 400

            existing = apis.pop(original_api_id)

            if gen_cfg.get('enabled_api') == original_api_id:
                gen_cfg['enabled_api'] = api_id
        else:
            existing = apis.get(api_id, {})

        now_ts = int(time.time())
        merged = dict(existing if isinstance(existing, dict) else {})
        merged.update({
            'api_id': api_id,
            'name': str(data.get('name') or api_id).strip(),
            'api_type': data.get('api_type'),
            'api_key': data.get('api_key'),
            'base_url': data.get('base_url'),
            'model': data.get('model'),
            'size': data.get('size'),
            'quality': data.get('quality'),
            'response_format': data.get('response_format'),
            'timeout': data.get('timeout'),
            'created_at': int(merged.get('created_at') or now_ts),
            'updated_at': now_ts,
        })

        record = _normalize_gen_image_record(api_id, merged, gen_cfg.get('enabled_api', ''))
        enable_requested = coerce_bool_flag(data.get('enabled'), False)

        if enable_requested:
            _assert_gen_image_record_ready(record)
            gen_cfg['enabled_api'] = api_id
        elif gen_cfg.get('enabled_api') == api_id:
            gen_cfg['enabled_api'] = ''

        apis[api_id] = record
        gen_cfg = _normalize_gen_image_config(gen_cfg)
        cfg['gen_image'] = gen_cfg
        _save_main_config(cfg)
        return jsonify({
            'success': True,
            'message': f'生图接口 {api_id} 已保存',
            **_gen_image_config_public_payload(gen_cfg),
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@gen_image_admin_bp.route('/api/admin/gen-image/apis/<path:api_id>/enabled', methods=['PUT'])
@gen_image_admin_bp.route('/api/admin/gen-image/apis/enable', methods=['POST'])
@require_admin
def admin_enable_gen_image_api(api_id=None):
    """启用指定生图接口，保证同一时间仅一个接口可用"""
    data = request.get_json(silent=True) or {}
    api_id = _normalize_gen_image_api_id(api_id or data.get('api_id') or data.get('id'))

    if not api_id:
        return jsonify({'success': False, 'message': '接口标识不能为空'}), 400

    try:
        cfg = _ensure_main_config_defaults()
        gen_cfg = _get_gen_image_config(cfg)
        apis = gen_cfg.setdefault('apis', {})
        record = apis.get(api_id)

        if not isinstance(record, dict):
            return jsonify({'success': False, 'message': '接口不存在'}), 404

        _assert_gen_image_record_ready(record)
        gen_cfg['enabled_api'] = api_id
        gen_cfg = _normalize_gen_image_config(gen_cfg)
        cfg['gen_image'] = gen_cfg
        _save_main_config(cfg)
        return jsonify({
            'success': True,
            'message': f'已启用生图接口 {api_id}',
            **_gen_image_config_public_payload(gen_cfg),
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@gen_image_admin_bp.route('/api/admin/gen-image/enabled-api', methods=['DELETE'])
@gen_image_admin_bp.route('/api/admin/gen-image/apis/disable', methods=['POST'])
@require_admin
def admin_disable_gen_image_api():
    """关闭当前生图接口"""
    try:
        cfg = _ensure_main_config_defaults()
        gen_cfg = _get_gen_image_config(cfg)
        gen_cfg['enabled_api'] = ''
        gen_cfg = _normalize_gen_image_config(gen_cfg)
        cfg['gen_image'] = gen_cfg
        _save_main_config(cfg)
        return jsonify({
            'success': True,
            'message': '生图接口已关闭',
            **_gen_image_config_public_payload(gen_cfg),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@gen_image_admin_bp.route('/api/admin/gen-image/apis/<path:api_id>', methods=['DELETE'])
@gen_image_admin_bp.route('/api/admin/gen-image/apis/delete', methods=['POST'])
@require_admin
def admin_delete_gen_image_api(api_id=None):
    """删除生图接口"""
    data = request.get_json(silent=True) or {}
    api_id = _normalize_gen_image_api_id(api_id or data.get('api_id') or data.get('id'))

    if not api_id:
        return jsonify({'success': False, 'message': '接口标识不能为空'}), 400

    try:
        cfg = _ensure_main_config_defaults()
        gen_cfg = _get_gen_image_config(cfg)
        apis = gen_cfg.setdefault('apis', {})

        if api_id not in apis:
            return jsonify({'success': False, 'message': '接口不存在'}), 404

        apis.pop(api_id, None)

        if gen_cfg.get('enabled_api') == api_id:
            gen_cfg['enabled_api'] = ''

        gen_cfg = _normalize_gen_image_config(gen_cfg)
        cfg['gen_image'] = gen_cfg
        _save_main_config(cfg)
        return jsonify({
            'success': True,
            'message': f'生图接口 {api_id} 已删除',
            **_gen_image_config_public_payload(gen_cfg),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
