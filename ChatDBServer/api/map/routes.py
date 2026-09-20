"""
Nexora.Map.routes — 地图 provider 配置路由（自 server.py 分批迁移）

- /api/map/provider (GET)：登录用户读取渲染摘要
- /api/admin/map/provider (GET/POST/PUT)：管理员读取与保存配置

组装契约：配置读写（ensure_main_config_defaults / save_main_config）与默认
map_service 配置经 configure_map_config_routes() 注入；未装配即处理请求视为
组装顺序错误。
"""

from typing import Any, Dict

from flask import Blueprint, jsonify, request

from basis.Permission import coerce_bool_flag, require_admin, require_login

map_config_bp = Blueprint('map_config', __name__)

# ==================== provider 常量（自 server.py 迁入） ====================

MAP_PROVIDER_BAIDU = 'baidu'
MAP_PROVIDER_TIANDITU = 'tianditu'
SUPPORTED_MAP_PROVIDERS = (MAP_PROVIDER_BAIDU, MAP_PROVIDER_TIANDITU)
MAP_PROVIDER_EDITABLE_FIELDS = {
    MAP_PROVIDER_BAIDU: (
        'browser_ak',
        'browser_version',
        'server_ak',
        'server_sk',
        'auth_mode',
        'timeout',
        'coord_type',
        'ret_coordtype',
        'direction_base_url',
        'geocoding_url',
        'place_search_url',
    ),
    MAP_PROVIDER_TIANDITU: (
        'tk',
        'browser_tk',
        'server_tk',
        'browser_version',
        'timeout',
        'coord_type',
        'driving_style',
        'transit_linetype',
        'drive_url',
        'transit_url',
        'geocoding_url',
        'place_search_url',
    ),
}

_ensure_main_config_defaults = None
_save_main_config = None
_default_map_service_config = None


def configure_map_config_routes(ensure_main_config_defaults, save_main_config, default_map_service_config):
    """
    server 组装期注入依赖（仅允许调用一次）。

    ensure_main_config_defaults: 读取主配置并合并默认值
    save_main_config:            保存主配置
    default_map_service_config:  Map.config 中的 map_service 默认值
    """
    global _ensure_main_config_defaults, _save_main_config, _default_map_service_config

    if _ensure_main_config_defaults is not None:
        raise RuntimeError('map config routes already configured')

    _ensure_main_config_defaults = ensure_main_config_defaults
    _save_main_config = save_main_config
    _default_map_service_config = default_map_service_config


# ==================== 配置归一化与校验 ====================

def _normalize_map_provider_value(value: Any) -> str:
    """校验并规范化地图 provider 配置值。"""
    provider = str(value or '').strip().lower()

    if provider not in SUPPORTED_MAP_PROVIDERS:
        raise ValueError('地图 provider 必须是 baidu 或 tianditu')

    return provider


def _map_cfg_node(cfg: Dict[str, Any]) -> Dict[str, Any]:
    map_cfg = cfg.get('map_service') if isinstance(cfg.get('map_service'), dict) else {}

    return map_cfg


def _map_provider_default_config(provider: str) -> Dict[str, Any]:
    default_provider_cfg = _default_map_service_config.get(provider, {}) if isinstance(_default_map_service_config, dict) else {}

    return default_provider_cfg if isinstance(default_provider_cfg, dict) else {}


def _map_provider_text_value(source: Dict[str, Any], defaults: Dict[str, Any], field: str) -> str:
    if field in source:
        raw_value = source.get(field)
    else:
        raw_value = defaults.get(field, '')

    if raw_value is None:
        return ''

    return str(raw_value).strip()


def _coerce_map_provider_timeout(raw: Any, default: int = 12) -> int:
    try:
        value = int(raw)
    except Exception:
        value = default

    return max(1, min(value, 120))


def _parse_map_provider_timeout(raw: Any) -> int:
    text = str(raw if raw is not None else '').strip()

    if not text:
        raise ValueError('地图 API timeout 不能为空')

    try:
        value = int(text)
    except Exception:
        raise ValueError('地图 API timeout 必须是整数')

    if value < 1 or value > 120:
        raise ValueError('地图 API timeout 必须在 1 到 120 秒之间')

    return value


def _normalize_map_auth_mode(raw: Any) -> str:
    auth_mode = str(raw or '').strip().lower()

    if auth_mode not in {'ak', 'sn'}:
        raise ValueError('百度地图 auth_mode 必须是 ak 或 sn')

    return auth_mode


def _map_provider_admin_config(map_cfg: Dict[str, Any], provider: str) -> Dict[str, Any]:
    provider_cfg = map_cfg.get(provider) if isinstance(map_cfg.get(provider), dict) else {}
    defaults = _map_provider_default_config(provider)
    fields = MAP_PROVIDER_EDITABLE_FIELDS.get(provider, ())
    editable: Dict[str, Any] = {}

    for field in fields:

        if field == 'timeout':
            raw_timeout = provider_cfg.get(field) if field in provider_cfg else defaults.get(field, 12)
            editable[field] = _coerce_map_provider_timeout(raw_timeout)
            continue

        editable[field] = _map_provider_text_value(provider_cfg, defaults, field)

    return editable


def _extract_map_provider_config_payload(payload: Dict[str, Any], provider: str) -> Dict[str, Any]:
    fields = MAP_PROVIDER_EDITABLE_FIELDS.get(provider, ())

    if 'config' in payload:
        config_data = payload.get('config')
    elif 'provider_config' in payload:
        config_data = payload.get('provider_config')
    else:
        config_data = {
            field: payload.get(field)
            for field in fields
            if field in payload
        }

    if config_data is None:
        return {}

    if not isinstance(config_data, dict):
        raise ValueError('地图 provider 配置必须是对象')

    return config_data


def _apply_map_provider_config_payload(map_cfg: Dict[str, Any], provider: str, payload: Dict[str, Any]) -> None:
    fields = MAP_PROVIDER_EDITABLE_FIELDS.get(provider, ())
    config_data = _extract_map_provider_config_payload(payload, provider)

    if not config_data:
        return

    provider_cfg = map_cfg.get(provider) if isinstance(map_cfg.get(provider), dict) else {}
    updated = dict(provider_cfg)

    for field in fields:

        if field not in config_data:
            continue

        if field == 'timeout':
            updated[field] = _parse_map_provider_timeout(config_data.get(field))
            continue

        if field == 'auth_mode':
            updated[field] = _normalize_map_auth_mode(config_data.get(field))
            continue

        raw_value = config_data.get(field)
        updated[field] = str(raw_value if raw_value is not None else '').strip()

    map_cfg[provider] = updated


def _map_provider_readiness(map_cfg: Dict[str, Any], provider: str) -> Dict[str, Any]:
    """检查 provider 是否具备前端渲染和后端地图服务调用所需配置。"""
    normalized_provider = _normalize_map_provider_value(provider)
    missing = []
    details: Dict[str, Any] = {}

    if normalized_provider == MAP_PROVIDER_BAIDU:
        baidu_cfg = map_cfg.get('baidu') if isinstance(map_cfg.get('baidu'), dict) else {}
        auth_mode = str(baidu_cfg.get('auth_mode') or 'ak').strip().lower()
        details['auth_mode'] = auth_mode
        details['browser_configured'] = bool(str(baidu_cfg.get('browser_ak') or '').strip())
        details['server_configured'] = bool(str(baidu_cfg.get('server_ak') or '').strip())
        details['coord_type'] = str(baidu_cfg.get('ret_coordtype') or baidu_cfg.get('coord_type') or 'bd09ll').strip()
        details['browser_version'] = str(baidu_cfg.get('browser_version') or '1.0').strip()

        if auth_mode not in {'ak', 'sn'}:
            missing.append('map_service.baidu.auth_mode 必须是 ak 或 sn')

        if not details['browser_configured']:
            missing.append('map_service.baidu.browser_ak')

        if not details['server_configured']:
            missing.append('map_service.baidu.server_ak')

        if auth_mode == 'sn' and not str(baidu_cfg.get('server_sk') or '').strip():
            missing.append('map_service.baidu.server_sk')

    if normalized_provider == MAP_PROVIDER_TIANDITU:
        tianditu_cfg = map_cfg.get('tianditu') if isinstance(map_cfg.get('tianditu'), dict) else {}
        tk = str(tianditu_cfg.get('tk') or '').strip()
        browser_tk = str(tianditu_cfg.get('browser_tk') or '').strip()
        server_tk = str(tianditu_cfg.get('server_tk') or '').strip()
        details['browser_configured'] = bool(browser_tk or tk)
        details['server_configured'] = bool(server_tk or tk)
        details['coord_type'] = str(tianditu_cfg.get('coord_type') or 'cgcs2000').strip()
        details['browser_version'] = str(tianditu_cfg.get('browser_version') or '4.0').strip()

        if not details['browser_configured']:
            missing.append('map_service.tianditu.browser_tk')

        if not details['server_configured']:
            missing.append('map_service.tianditu.server_tk')

    return {
        'provider': normalized_provider,
        'ready': len(missing) == 0,
        'missing': missing,
        **details,
    }


def _build_map_provider_config_payload(cfg: Dict[str, Any], include_admin_config: bool = False) -> Dict[str, Any]:
    """构建地图 provider 配置摘要；管理员编辑模式会附带可保存配置值。"""
    map_cfg = _map_cfg_node(cfg)
    provider = str(map_cfg.get('provider') or '').strip().lower()
    config_errors = []

    if not provider:
        config_errors.append('map_service.provider 不能为空')
    elif provider not in SUPPORTED_MAP_PROVIDERS:
        config_errors.append('map_service.provider 必须是 baidu 或 tianditu')

    provider_status = {
        item: _map_provider_readiness(map_cfg, item)
        for item in SUPPORTED_MAP_PROVIDERS
    }

    if include_admin_config:

        for item, status in provider_status.items():
            status['config'] = _map_provider_admin_config(map_cfg, item)

    active_provider_ready = provider_status.get(provider, {}).get('ready') if provider in provider_status else False

    # 前端地图渲染器所需配置(与旧版 chat.html 注入 window.NEXORA_MAP_RENDERER_CONFIG 一致):
    # browser_ak/browser_tk 本身就是面向浏览器侧的访问键,旧版已对登录用户全量下发。
    baidu_map_cfg = map_cfg.get('baidu', {}) if isinstance(map_cfg.get('baidu'), dict) else {}
    tianditu_map_cfg = map_cfg.get('tianditu', {}) if isinstance(map_cfg.get('tianditu'), dict) else {}

    return {
        'provider': provider,
        'provider_ready': bool(active_provider_ready),
        'config_errors': config_errors,
        'supported_providers': list(SUPPORTED_MAP_PROVIDERS),
        'providers': provider_status,
        'map_renderer_config': {
            'provider': provider or 'baidu',
            'baiduMapAk': str(baidu_map_cfg.get('browser_ak') or '').strip(),
            'baiduMapVersion': str(baidu_map_cfg.get('browser_version') or '1.0').strip() or '1.0',
            'tiandituMapTk': str(tianditu_map_cfg.get('browser_tk') or tianditu_map_cfg.get('tk') or '').strip(),
            'tiandituMapVersion': str(tianditu_map_cfg.get('browser_version') or '4.0').strip() or '4.0'
        },
        'history_policy': {
            'mode': 'scene_provider_pinned',
            'summary': '历史地图记录保留 scene.provider，新默认 provider 只影响之后生成的地图。',
            'baidu_records': '历史百度地图继续按 baidu 渲染，保留 bd09ll 等原始坐标系。',
            'tianditu_records': '历史天地图继续按 tianditu 渲染，保留 cgcs2000 等原始坐标系。',
        },
    }


# ==================== 路由（D1 批次迁入） ====================

@map_config_bp.route('/api/map/provider', methods=['GET'])
@require_login
def get_map_provider_config():
    """读取当前地图 provider 配置摘要。"""
    try:
        cfg = _ensure_main_config_defaults()

        return jsonify({
            'success': True,
            'map_provider': _build_map_provider_config_payload(cfg),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@map_config_bp.route('/api/admin/map/provider', methods=['GET'])
@require_admin
def admin_get_map_provider_config():
    """管理员读取当前地图 provider 配置摘要。"""
    try:
        cfg = _ensure_main_config_defaults()

        return jsonify({
            'success': True,
            'map_provider': _build_map_provider_config_payload(cfg, include_admin_config=True),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@map_config_bp.route('/api/admin/map/provider', methods=['POST', 'PUT'])
@require_admin
def admin_update_map_provider_config():
    """管理员保存地图 provider 配置，并按请求切换全局默认 provider。"""
    payload = request.get_json(silent=True) or {}
    requested_provider = payload.get('provider', payload.get('map_provider'))
    set_default_requested = coerce_bool_flag(payload.get('set_default'), 'config' not in payload and 'provider_config' not in payload)

    try:
        provider = _normalize_map_provider_value(requested_provider)
        cfg = _ensure_main_config_defaults()
        map_cfg = cfg.get('map_service') if isinstance(cfg.get('map_service'), dict) else {}
        _apply_map_provider_config_payload(map_cfg, provider, payload)
        cfg['map_service'] = map_cfg
        readiness = _map_provider_readiness(map_cfg, provider)

        if set_default_requested and not readiness.get('ready'):
            missing = readiness.get('missing') if isinstance(readiness.get('missing'), list) else []
            saved = _save_main_config(cfg)

            return jsonify({
                'success': False,
                'message': '目标地图 provider 配置不完整，无法切换',
                'provider': provider,
                'missing': missing,
                'map_provider': _build_map_provider_config_payload(saved, include_admin_config=True),
            }), 400

        if set_default_requested:
            map_cfg['provider'] = provider

        cfg['map_service'] = map_cfg
        saved = _save_main_config(cfg)
        message = f'地图 provider 已切换为 {provider}' if set_default_requested else f'地图 provider {provider} 配置已保存'

        return jsonify({
            'success': True,
            'message': message,
            'map_provider': _build_map_provider_config_payload(saved, include_admin_config=True),
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
