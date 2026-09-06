"""
Nexora.App.Search.admin_routes — 管理端搜索 API 配置路由（自 server.py 分批迁移）

- /api/admin/search/config (GET/POST)

组装契约：主配置读写（ensure_main_config_defaults / save_main_config，含迁移
钩子的 server 侧包装）经 configure_search_admin_routes() 注入。
说明：原 /api/admin/search/exa/billing 已按需求移除（Exa 无可用 usage 口径 API）。
"""

from typing import Any, Dict

from flask import Blueprint, jsonify, request

from basis.Permission import require_admin
from App.Utils import mask_public_api_key

search_admin_bp = Blueprint('search_admin', __name__)

_ensure_main_config_defaults = None
_save_main_config = None


def configure_search_admin_routes(ensure_main_config_defaults, save_main_config):
    """server 组装期注入依赖（仅允许调用一次）。"""
    global _ensure_main_config_defaults, _save_main_config

    if _ensure_main_config_defaults is not None:
        raise RuntimeError('search admin routes already configured')

    _ensure_main_config_defaults = ensure_main_config_defaults
    _save_main_config = save_main_config


# ==================== 搜索配置归一化（自 server.py 迁入） ====================

SUPPORTED_SEARCH_PROVIDERS = ('exa', 'duckduckgo')
DEFAULT_SEARCH_PROVIDER = 'duckduckgo'


def _normalize_search_provider_name(raw: Any) -> str:
    name = str(raw or '').strip().lower()

    if name in ('exa', 'exa.ai', 'exa_web_search'):
        return 'exa'

    if name in ('duckduckgo', 'ddg', 'duck_duck_go'):
        return 'duckduckgo'

    if name in ('disabled', 'none', 'off', ''):
        return 'disabled'

    return name


def _normalize_web_search_config(raw: Any) -> Dict[str, Any]:
    cfg = raw if isinstance(raw, dict) else {}
    active = _normalize_search_provider_name(cfg.get('active_provider') or DEFAULT_SEARCH_PROVIDER)

    if active not in (*SUPPORTED_SEARCH_PROVIDERS, 'disabled'):
        active = DEFAULT_SEARCH_PROVIDER

    providers_raw = cfg.get('providers') if isinstance(cfg.get('providers'), dict) else {}
    providers: Dict[str, Dict[str, Any]] = {}

    # DuckDuckGo
    ddg_raw = providers_raw.get('duckduckgo', {}) if isinstance(providers_raw.get('duckduckgo'), dict) else {}
    providers['duckduckgo'] = {
        'backend': str(ddg_raw.get('backend') or 'html').strip() or 'html',
        'region': str(ddg_raw.get('region') or 'wt-wt').strip() or 'wt-wt',
        'safesearch': str(ddg_raw.get('safesearch') or 'moderate').strip() or 'moderate',
        'timelimit': str(ddg_raw.get('timelimit') or 'w').strip() or 'w',
        'fetch_content': bool(ddg_raw.get('fetch_content', False)),
        'timeout': max(1, min(int(ddg_raw.get('timeout') or 15), 120)),
    }

    # Exa
    exa_raw = providers_raw.get('exa', {}) if isinstance(providers_raw.get('exa'), dict) else {}
    exa_type = str(exa_raw.get('type') or 'auto').strip().lower()

    if exa_type not in {'auto', 'fast', 'instant', 'deep-lite', 'deep', 'deep-reasoning'}:
        exa_type = 'auto'

    providers['exa'] = {
        'api_key': str(exa_raw.get('api_key') or '').strip(),
        'team_api_key': str(exa_raw.get('team_api_key') or exa_raw.get('teamApiKey') or '').strip(),
        'team_api_key_id': str(exa_raw.get('team_api_key_id') or exa_raw.get('teamApiKeyId') or exa_raw.get('api_key_id') or '').strip(),
        'base_url': str(exa_raw.get('base_url') or 'https://api.exa.ai').strip().rstrip('/') or 'https://api.exa.ai',
        'type': exa_type,
        'num_results': max(1, min(int(exa_raw.get('num_results') or exa_raw.get('numResults') or 10), 20)),
        'contents': exa_raw.get('contents') if isinstance(exa_raw.get('contents'), dict) else {'highlights': True},
        'timeout': max(5, min(int(exa_raw.get('timeout') or 20), 60)),
    }

    # contents 归一
    if not isinstance(providers['exa']['contents'], dict) or not providers['exa']['contents']:
        providers['exa']['contents'] = {'highlights': True}

    return {
        'active_provider': active,
        'default_num_results': max(1, min(int(cfg.get('default_num_results') or 8), 20)),
        'providers': providers,
    }


def _get_web_search_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    raw = cfg.get('web_search') if isinstance(cfg.get('web_search'), dict) else {}
    normalized = _normalize_web_search_config(raw)

    if isinstance(cfg, dict) and cfg.get('web_search') != normalized:
        cfg['web_search'] = normalized

    return normalized


def _web_search_config_public_payload(web_cfg: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_web_search_config(web_cfg)
    providers_pub: Dict[str, Any] = {}

    for name, pcfg in normalized.get('providers', {}).items():
        row = dict(pcfg)

        if name == 'exa':
            row['api_key_masked'] = mask_public_api_key(row.get('api_key'))
            row['team_api_key_masked'] = mask_public_api_key(row.get('team_api_key'))
            # 前端不直接展示明文，保留长度提示
            row['has_api_key'] = bool(str(row.get('api_key') or '').strip())
            row['has_team_api_key'] = bool(str(row.get('team_api_key') or '').strip())

        providers_pub[name] = row

    return {
        'active_provider': normalized.get('active_provider', DEFAULT_SEARCH_PROVIDER),
        'default_num_results': normalized.get('default_num_results', 8),
        'providers': providers_pub,
        'supported_providers': list(SUPPORTED_SEARCH_PROVIDERS),
    }


def _assert_web_search_ready(web_cfg: Dict[str, Any]) -> None:
    active = str(web_cfg.get('active_provider') or '').strip().lower()

    if active == 'exa':
        api_key = str(web_cfg.get('providers', {}).get('exa', {}).get('api_key') or '').strip()

        if not api_key:
            raise ValueError('启用 Exa Web Search 前必须填写 API Key')


# ==================== 路由 ====================

@search_admin_bp.route('/api/admin/search/config', methods=['GET'])
@require_admin
def admin_get_search_config():
    """管理员读取搜索 API 配置"""
    try:
        cfg = _ensure_main_config_defaults()
        web_cfg = _get_web_search_config(cfg)
        _save_main_config(cfg)
        return jsonify({
            'success': True,
            **_web_search_config_public_payload(web_cfg),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@search_admin_bp.route('/api/admin/search/config', methods=['POST'])
@require_admin
def admin_update_search_config():
    """管理员保存搜索 API 配置"""
    data = request.get_json(silent=True) or {}

    try:
        cfg = _ensure_main_config_defaults()
        web_cfg = _get_web_search_config(cfg)

        # active_provider
        if 'active_provider' in data:
            web_cfg['active_provider'] = _normalize_search_provider_name(data.get('active_provider'))

        if 'default_num_results' in data:
            try:
                web_cfg['default_num_results'] = max(1, min(int(data.get('default_num_results') or 8), 20))
            except Exception:
                pass

        # providers
        providers_data = data.get('providers') if isinstance(data.get('providers'), dict) else None

        if providers_data is None and any(k in data for k in ('exa', 'duckduckgo', 'exa_api_key', 'api_key')):
            # 兼容扁平传入
            providers_data = data

        if isinstance(providers_data, dict):
            # Exa
            exa_in = providers_data.get('exa') if isinstance(providers_data.get('exa'), dict) else {}

            # 兼容直接传 exa_api_key / api_key
            if not exa_in and ('exa_api_key' in providers_data or 'api_key' in providers_data):
                exa_in = {
                    'api_key': providers_data.get('exa_api_key', providers_data.get('api_key')),
                }

            if isinstance(exa_in, dict) and exa_in:
                cur = web_cfg.setdefault('providers', {}).setdefault('exa', {})

                if 'api_key' in exa_in:
                    # 空字符串表示清空，前端未改动时传 masked 时不覆盖
                    new_key = str(exa_in.get('api_key') or '').strip()

                    # 前端若传的是 masked（如 exa-****abcd），则视为未修改
                    if new_key and '****' in new_key:
                        pass
                    else:
                        cur['api_key'] = new_key

                if 'base_url' in exa_in:
                    cur['base_url'] = str(exa_in.get('base_url') or 'https://api.exa.ai').strip().rstrip('/') or 'https://api.exa.ai'

                if 'type' in exa_in:
                    t = str(exa_in.get('type') or 'auto').strip().lower()

                    if t in {'auto', 'fast', 'instant', 'deep-lite', 'deep', 'deep-reasoning'}:
                        cur['type'] = t

                if 'timeout' in exa_in:
                    try:
                        cur['timeout'] = max(5, min(int(exa_in.get('timeout') or 20), 60))
                    except Exception:
                        pass

                if 'num_results' in exa_in or 'numResults' in exa_in:
                    try:
                        cur['num_results'] = max(1, min(int(exa_in.get('num_results') or exa_in.get('numResults') or 10), 20))
                    except Exception:
                        pass

                # Team 管理 Key（独立于搜索 Key）
                for team_field in ('team_api_key', 'teamApiKey'):
                    if team_field in exa_in:
                        new_team = str(exa_in.get(team_field) or '').strip()
                        if new_team and '****' in new_team:
                            pass
                        else:
                            cur['team_api_key'] = new_team
                        break

                for team_id_field in ('team_api_key_id', 'teamApiKeyId', 'api_key_id', 'apiKeyId'):
                    if team_id_field in exa_in:
                        cur['team_api_key_id'] = str(exa_in.get(team_id_field) or '').strip()
                        break

            # DuckDuckGo
            ddg_in = providers_data.get('duckduckgo') if isinstance(providers_data.get('duckduckgo'), dict) else {}

            if isinstance(ddg_in, dict) and ddg_in:
                cur = web_cfg.setdefault('providers', {}).setdefault('duckduckgo', {})

                for field in ('backend', 'region', 'safesearch', 'timelimit'):
                    if field in ddg_in:
                        cur[field] = str(ddg_in.get(field) or '').strip()

                if 'timeout' in ddg_in:
                    try:
                        cur['timeout'] = max(1, min(int(ddg_in.get('timeout') or 15), 120))
                    except Exception:
                        pass

        # 校验：若要启用 exa，必须有 key
        if str(web_cfg.get('active_provider') or '').strip().lower() == 'exa':
            _assert_web_search_ready(web_cfg)

        web_cfg = _normalize_web_search_config(web_cfg)
        cfg['web_search'] = web_cfg
        _save_main_config(cfg)

        return jsonify({
            'success': True,
            'message': '搜索 API 配置已保存',
            **_web_search_config_public_payload(web_cfg),
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
