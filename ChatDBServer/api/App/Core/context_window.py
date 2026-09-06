"""
Nexora.App.Core.context_window — 模型上下文窗口解析与缓存（自 server.py 分批迁移）

供聊天链路与管理端模型配置共用：
- 按 provider（volcengine/aliyun/dashscope/ollama/通用 openai 系）拉取并缓存
  模型目录中的上下文窗口信息（data/res/models_context_window.json）
- 缓存读取、后台异步刷新节流、按模型 ID 解析 context window

本模块为纯函数集合：provider 配置以参数传入，不持有配置访问依赖。
"""

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, Tuple
from urllib import request as urllib_request

import httpx

from basis.Model.Provider import create_provider_adapter

# 与 server.py 顶部常量同源（ChatDBServer 根 = 本文件向上 3 级：App/Core/...）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA_RES_DIR = os.path.join(BASE_DIR, 'data', 'res')
MODELS_CONTEXT_WINDOW_CACHE_LEGACY_PATH = os.path.join(BASE_DIR, 'models_context_window.json')
MODELS_CONTEXT_WINDOW_CACHE_PATH = os.path.join(DATA_RES_DIR, 'models_context_window.json')

_MODELS_CTX_CACHE_LOCK = threading.Lock()
_PROVIDER_CTX_BG_REFRESH_LOCK = threading.Lock()
_PROVIDER_CTX_BG_LAST_TS: Dict[str, float] = {}
_PROVIDER_CTX_BG_REFRESHING: Dict[str, bool] = {}

# 网络出口（provider 模型目录拉取）由 server 组装层注入，见 configure_context_window
_fetch_aliyun_models_page = None
_fetch_volc_foundation_models_context_map = None


def configure_context_window_fetchers(fetch_aliyun_models_page, fetch_volc_foundation_models_context_map):
    """
    server 组装期注入依赖（仅允许调用一次）。

    fetch_aliyun_models_page:                拉取 DashScope 模型目录单页
    fetch_volc_foundation_models_context_map: 经签名地址拉取火山方舟模型上下文表
    """
    global _fetch_aliyun_models_page, _fetch_volc_foundation_models_context_map

    if _fetch_aliyun_models_page is not None:
        raise RuntimeError('context window fetchers already configured')

    _fetch_aliyun_models_page = fetch_aliyun_models_page
    _fetch_volc_foundation_models_context_map = fetch_volc_foundation_models_context_map


def _normalize_provider_api_type(raw_api_type):
    api_type = str(raw_api_type or '').strip().lower()
    if api_type in {'', 'openaiapi'}:
        return 'openai'
    if api_type in {'openai-compatible', 'openai compatible'}:
        return 'openai_compatible'
    return api_type


def _normalize_keep_alive_value(raw_keep_alive, default='5m'):
    keep_alive = str(raw_keep_alive or '').strip()
    return keep_alive or str(default or '5m').strip() or '5m'


MODEL_CONTEXT_WINDOW_KEYS = (
    'context_window',
    'context_length',
    'max_context_tokens',
    'max_input_tokens',
    'max_prompt_tokens',
)
MODEL_CONTEXT_WINDOW_MAX = 4_000_000


def _safe_context_window_int(raw):
    try:
        n = int(raw)
    except Exception:
        return 0

    if n < 1024:
        return 0

    return min(n, MODEL_CONTEXT_WINDOW_MAX)


def _parse_model_context_window_for_save(raw):
    text = str(raw or '').strip()
    if not text:
        return 0

    try:
        n = int(text)
    except Exception:
        raise ValueError('context_window 必须是 1024 到 4000000 之间的整数，或留空')

    if n < 1024 or n > MODEL_CONTEXT_WINDOW_MAX:
        raise ValueError('context_window 必须是 1024 到 4000000 之间的整数，或留空')

    return n


def _normalize_model_id_for_ctx(raw):
    return str(raw or '').strip().lower()


def _trim_model_id_last_hyphen_number(raw):
    s = _normalize_model_id_for_ctx(raw)
    if not s:
        return ''
    return re.sub(r'-\d+$', '', s).strip()


def _load_models_context_window_cache():
    path = MODELS_CONTEXT_WINDOW_CACHE_PATH
    if (not os.path.exists(path)) and os.path.exists(MODELS_CONTEXT_WINDOW_CACHE_LEGACY_PATH):
        path = MODELS_CONTEXT_WINDOW_CACHE_LEGACY_PATH
    if not os.path.exists(path):
        return {"providers": {}, "updated_at": 0}
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            return {"providers": {}, "updated_at": 0}
        providers = data.get("providers", {})
        if not isinstance(providers, dict):
            providers = {}
        return {
            "providers": providers,
            "updated_at": int(data.get("updated_at", 0) or 0),
        }
    except Exception:
        return {"providers": {}, "updated_at": 0}


def _save_models_context_window_cache(cache_obj):
    payload = cache_obj if isinstance(cache_obj, dict) else {"providers": {}, "updated_at": 0}
    providers = payload.get("providers", {})
    if not isinstance(providers, dict):
        providers = {}
    payload["providers"] = providers
    payload["updated_at"] = int(time.time())
    try:
        os.makedirs(os.path.dirname(MODELS_CONTEXT_WINDOW_CACHE_PATH), exist_ok=True)
        Path(MODELS_CONTEXT_WINDOW_CACHE_PATH).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding='utf-8'
        )
    except Exception:
        pass


def _extract_context_window_from_provider_row(row_obj):
    row = row_obj if isinstance(row_obj, dict) else {}
    for key in MODEL_CONTEXT_WINDOW_KEYS:
        n = _safe_context_window_int(row.get(key))
        if n > 0:
            return n

    raw = row.get("raw") if isinstance(row.get("raw"), dict) else {}
    for key in MODEL_CONTEXT_WINDOW_KEYS:
        n = _safe_context_window_int(raw.get(key))
        if n > 0:
            return n

    # DashScope / 百炼模型目录常把上下文信息放在 model_info 节点
    model_info = row.get("model_info") if isinstance(row.get("model_info"), dict) else {}
    for key in MODEL_CONTEXT_WINDOW_KEYS:
        n = _safe_context_window_int(model_info.get(key))
        if n > 0:
            return n

    return 0


def _extract_context_map_from_provider_models_result(result_obj):
    result = result_obj if isinstance(result_obj, dict) else {}
    rows = result.get('models', [])
    fresh_map = {}

    if not isinstance(rows, list):
        return fresh_map

    for item in rows:
        if not isinstance(item, dict):
            continue

        model_id = _normalize_model_id_for_ctx(
            item.get('id') or item.get('model_id') or item.get('model') or item.get('name') or ''
        )
        if not model_id:
            continue

        ctx = _extract_context_window_from_provider_row(item)
        if ctx > 0:
            fresh_map[model_id] = ctx

    return fresh_map


def _build_provider_models_context_diagnostics(result_obj):
    result = result_obj if isinstance(result_obj, dict) else {}
    rows = result.get('models', [])
    diagnostic = {
        'total_models': 0,
        'with_context_window': 0,
        'missing_context_window': 0,
        'context_window_keys': list(MODEL_CONTEXT_WINDOW_KEYS),
        'message': '',
    }

    if not bool(result.get('ok', False)):
        diagnostic['message'] = str(result.get('error') or result.get('message') or '模型列表拉取失败')
        return diagnostic

    if not isinstance(rows, list):
        diagnostic['message'] = '模型列表返回结构中没有 models 数组'
        return diagnostic

    diagnostic['total_models'] = len(rows)
    for item in rows:
        if _extract_context_window_from_provider_row(item) > 0:
            diagnostic['with_context_window'] += 1

    diagnostic['missing_context_window'] = max(
        0,
        diagnostic['total_models'] - diagnostic['with_context_window']
    )

    if diagnostic['total_models'] and diagnostic['with_context_window'] <= 0:
        diagnostic['message'] = '远端模型列表没有提供上下文窗口字段，请在模型配置里填写 context_window，或配置包含上下文字段的 models_catalog_url'
    elif diagnostic['missing_context_window'] > 0:
        diagnostic['message'] = '部分模型缺少上下文窗口字段'

    return diagnostic


def _read_cached_provider_context_window_map_with_meta(provider_key):
    provider = str(provider_key or '').strip().lower()
    if not provider:
        return {}, 0
    with _MODELS_CTX_CACHE_LOCK:
        cache = _load_models_context_window_cache()
    providers = cache.get("providers", {}) if isinstance(cache, dict) else {}
    node = providers.get(provider, {}) if isinstance(providers, dict) else {}
    models_map = node.get("models", {}) if isinstance(node, dict) else {}
    updated_at = 0
    try:
        updated_at = int(node.get("updated_at") or 0) if isinstance(node, dict) else 0
    except Exception:
        updated_at = 0
    out = {}
    if isinstance(models_map, dict):
        for k, v in models_map.items():
            key = _normalize_model_id_for_ctx(k)
            if not key:
                continue
            if isinstance(v, dict):
                n = _safe_context_window_int(v.get("context_window"))
            else:
                n = _safe_context_window_int(v)
            if n > 0:
                out[key] = n
    return out, updated_at


def _read_cached_provider_context_window_map(provider_key):
    models_map, _ = _read_cached_provider_context_window_map_with_meta(provider_key)
    return models_map


def _write_cached_provider_context_window_map(provider_key, models_map):
    provider = str(provider_key or '').strip().lower()
    if not provider:
        return
    src = models_map if isinstance(models_map, dict) else {}
    normalized = {}
    for k, v in src.items():
        key = _normalize_model_id_for_ctx(k)
        n = _safe_context_window_int(v)
        if key and n > 0:
            normalized[key] = {"context_window": n, "ts": int(time.time())}
    with _MODELS_CTX_CACHE_LOCK:
        cache = _load_models_context_window_cache()
        providers = cache.get("providers", {}) if isinstance(cache.get("providers"), dict) else {}
        providers[provider] = {
            "models": normalized,
            "updated_at": int(time.time())
        }
        cache["providers"] = providers
        _save_models_context_window_cache(cache)


def _read_cached_volc_context_window_map():
    return _read_cached_provider_context_window_map('volcengine')


def _write_cached_volc_context_window_map(models_map):
    _write_cached_provider_context_window_map('volcengine', models_map)


def _read_cached_aliyun_context_window_map():
    return _read_cached_provider_context_window_map('aliyun')


def _write_cached_aliyun_context_window_map(models_map):
    _write_cached_provider_context_window_map('aliyun', models_map)


def _launch_provider_context_refresh_bg(provider_key, refresh_fn, min_interval_sec=45.0):
    provider = str(provider_key or '').strip().lower()
    if not provider or not callable(refresh_fn):
        return False
    now = time.time()
    with _PROVIDER_CTX_BG_REFRESH_LOCK:
        if _PROVIDER_CTX_BG_REFRESHING.get(provider):
            return False
        last = float(_PROVIDER_CTX_BG_LAST_TS.get(provider) or 0.0)
        if (now - last) < max(5.0, float(min_interval_sec or 45.0)):
            return False
        _PROVIDER_CTX_BG_REFRESHING[provider] = True
        _PROVIDER_CTX_BG_LAST_TS[provider] = now

    def _runner():
        try:
            refresh_fn()
        except Exception:
            pass
        finally:
            with _PROVIDER_CTX_BG_REFRESH_LOCK:
                _PROVIDER_CTX_BG_REFRESHING[provider] = False
                _PROVIDER_CTX_BG_LAST_TS[provider] = time.time()

    t = threading.Thread(target=_runner, daemon=True, name=f'ctx-refresh-{provider}')
    t.start()
    return True


def _refresh_volc_context_window_map(config_obj, timeout=8.0, force_remote=False):
    cfg = config_obj if isinstance(config_obj, dict) else {}
    providers = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}
    provider_cfg = providers.get("volcengine")
    cached, cached_updated_at = _read_cached_provider_context_window_map_with_meta('volcengine')
    if not isinstance(provider_cfg, dict):
        return cached
    api_key = str(provider_cfg.get('api_key', '') or '').strip()
    if not api_key:
        return cached

    cache_ttl_sec = 900
    try:
        cache_ttl_sec = max(0, int(provider_cfg.get('models_catalog_cache_ttl_sec', 900) or 900))
    except Exception:
        cache_ttl_sec = 900

    bg_refresh_enabled = bool(provider_cfg.get('models_catalog_async_refresh', True))
    wait_on_miss = bool(provider_cfg.get('models_catalog_wait_on_miss', False))
    bg_min_interval = 30
    try:
        bg_min_interval = max(5, int(provider_cfg.get('models_catalog_async_min_interval_sec', 30) or 30))
    except Exception:
        bg_min_interval = 30

    if cached and not force_remote:
        age = max(0, int(time.time()) - int(cached_updated_at or 0))
        if cache_ttl_sec > 0 and age <= cache_ttl_sec:
            return cached
        if bg_refresh_enabled:
            cfg_snapshot = json.loads(json.dumps(cfg))
            _launch_provider_context_refresh_bg(
                'volcengine',
                lambda: _refresh_volc_context_window_map(cfg_snapshot, timeout=timeout, force_remote=True),
                min_interval_sec=bg_min_interval
            )
            return cached
    if (not cached) and (not force_remote) and bg_refresh_enabled and (not wait_on_miss):
        cfg_snapshot = json.loads(json.dumps(cfg))
        _launch_provider_context_refresh_bg(
            'volcengine',
            lambda: _refresh_volc_context_window_map(cfg_snapshot, timeout=timeout, force_remote=True),
            min_interval_sec=bg_min_interval
        )
        return cached

    try:
        adapter = create_provider_adapter('volcengine', provider_cfg)
        client = adapter.create_client(
            api_key=api_key,
            base_url=str(provider_cfg.get('base_url', '') or '').strip(),
            timeout=max(2.0, float(timeout or 8.0))
        )
        result = adapter.list_models(
            client=client,
            capability='',
            request_options={}
        )
        fresh_map = {}
        if isinstance(result, dict) and bool(result.get('ok', False)):
            models = result.get('models', [])
            if isinstance(models, list):
                for item in models:
                    if not isinstance(item, dict):
                        continue
                    model_id = _normalize_model_id_for_ctx(
                        item.get('id') or item.get('model_id') or item.get('name') or ''
                    )
                    if not model_id:
                        continue
                    ctx = _extract_context_window_from_provider_row(item)
                    if ctx <= 0:
                        continue
                    fresh_map[model_id] = ctx
        if not fresh_map:
            extra = _fetch_volc_foundation_models_context_map(provider_cfg, timeout=timeout)
            if isinstance(extra, dict) and extra:
                fresh_map.update(extra)
        if not fresh_map:
            return cached
        merged = dict(cached)
        merged.update(fresh_map)
        _write_cached_volc_context_window_map(merged)
        return merged
    except Exception:
        return cached


def _extract_aliyun_models_from_payload(payload):
    src = payload if isinstance(payload, dict) else {}
    out_node = src.get('output') if isinstance(src.get('output'), dict) else {}
    rows = []
    for key in ('models', 'data', 'items'):
        v = out_node.get(key)
        if isinstance(v, list):
            rows = v
            break
    total = 0
    page_no = 1
    page_size = len(rows) if rows else 0
    try:
        total = int(out_node.get('total') or 0)
    except Exception:
        total = 0
    try:
        page_no = int(out_node.get('page_no') or 1)
    except Exception:
        page_no = 1
    try:
        page_size = int(out_node.get('page_size') or page_size or 0)
    except Exception:
        page_size = page_size or 0
    return rows if isinstance(rows, list) else [], total, page_no, page_size


def _refresh_aliyun_context_window_map(config_obj, timeout=8.0, force_remote=False):
    cfg = config_obj if isinstance(config_obj, dict) else {}
    providers = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}
    provider_cfg = providers.get("aliyun")
    if not isinstance(provider_cfg, dict):
        provider_cfg = providers.get("dashscope")
    cached, cached_updated_at = _read_cached_provider_context_window_map_with_meta('aliyun')
    if not isinstance(provider_cfg, dict):
        return cached
    api_key = str(provider_cfg.get('api_key', '') or '').strip()
    if not api_key:
        return cached

    cache_ttl_sec = 1800
    try:
        cache_ttl_sec = max(0, int(provider_cfg.get('models_catalog_cache_ttl_sec', 1800) or 1800))
    except Exception:
        cache_ttl_sec = 1800

    bg_refresh_enabled = bool(provider_cfg.get('models_catalog_async_refresh', True))
    wait_on_miss = bool(provider_cfg.get('models_catalog_wait_on_miss', False))
    bg_min_interval = 45
    try:
        bg_min_interval = max(5, int(provider_cfg.get('models_catalog_async_min_interval_sec', 45) or 45))
    except Exception:
        bg_min_interval = 45

    if cached and not force_remote:
        age = max(0, int(time.time()) - int(cached_updated_at or 0))
        if cache_ttl_sec > 0 and age <= cache_ttl_sec:
            return cached
        if bg_refresh_enabled:
            cfg_snapshot = json.loads(json.dumps(cfg))
            _launch_provider_context_refresh_bg(
                'aliyun',
                lambda: _refresh_aliyun_context_window_map(cfg_snapshot, timeout=timeout, force_remote=True),
                min_interval_sec=bg_min_interval
            )
            return cached
    if (not cached) and (not force_remote) and bg_refresh_enabled and (not wait_on_miss):
        cfg_snapshot = json.loads(json.dumps(cfg))
        _launch_provider_context_refresh_bg(
            'aliyun',
            lambda: _refresh_aliyun_context_window_map(cfg_snapshot, timeout=timeout, force_remote=True),
            min_interval_sec=bg_min_interval
        )
        return cached

    max_pages = 6
    try:
        max_pages = max(1, min(30, int(provider_cfg.get('models_catalog_max_pages', 6) or 6)))
    except Exception:
        max_pages = 6
    page_size = 100
    try:
        page_size = max(1, min(500, int(provider_cfg.get('models_catalog_page_size', 100) or 100)))
    except Exception:
        page_size = 100

    target_model_ids = []
    try:
        all_models = cfg.get('models', {}) if isinstance(cfg.get('models'), dict) else {}
        for mid, info in all_models.items():
            if not isinstance(info, dict):
                continue
            p = str(info.get('provider', '') or '').strip().lower()
            if p in {'aliyun', 'dashscope'}:
                target_model_ids.append(str(mid or '').strip())
    except Exception:
        target_model_ids = []

    def _all_targets_hit(cur_map):
        if not target_model_ids:
            return False
        for mid in target_model_ids:
            if _resolve_context_window_by_model_id(mid, cur_map) <= 0:
                return False
        return True

    fresh_map = {}
    first_payload = _fetch_aliyun_models_page(provider_cfg, page_no=1, page_size=page_size, timeout=timeout)
    rows, total, _, remote_page_size = _extract_aliyun_models_from_payload(first_payload)
    for item in rows:
        if not isinstance(item, dict):
            continue
        model_id = _normalize_model_id_for_ctx(
            item.get('model') or item.get('id') or item.get('model_id') or item.get('name') or ''
        )
        if not model_id:
            continue
        ctx = _extract_context_window_from_provider_row(item)
        if ctx > 0:
            fresh_map[model_id] = ctx
    if _all_targets_hit(fresh_map):
        total = 0

    total_pages = 1
    if total and remote_page_size:
        try:
            total_pages = max(1, (int(total) + int(remote_page_size) - 1) // int(remote_page_size))
        except Exception:
            total_pages = 1
    total_pages = min(total_pages, max_pages)

    for p in range(2, total_pages + 1):
        payload = _fetch_aliyun_models_page(provider_cfg, page_no=p, page_size=page_size, timeout=timeout)
        rows, _, _, _ = _extract_aliyun_models_from_payload(payload)
        if not rows:
            break
        for item in rows:
            if not isinstance(item, dict):
                continue
            model_id = _normalize_model_id_for_ctx(
                item.get('model') or item.get('id') or item.get('model_id') or item.get('name') or ''
            )
            if not model_id:
                continue
            ctx = _extract_context_window_from_provider_row(item)
            if ctx > 0:
                fresh_map[model_id] = ctx
        if _all_targets_hit(fresh_map):
            break

    if not fresh_map:
        return cached
    merged = dict(cached)
    merged.update(fresh_map)
    _write_cached_aliyun_context_window_map(merged)
    return merged


def _refresh_ollama_context_window_map(config_obj, timeout=8.0, force_remote=False):
    cfg = config_obj if isinstance(config_obj, dict) else {}
    providers = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}
    merged: Dict[str, int] = {}

    for provider_name, provider_cfg in providers.items():
        if not isinstance(provider_cfg, dict):
            continue
        if str(provider_cfg.get("api_type", "") or "").strip().lower() != "ollama":
            continue

        cached, cached_updated_at = _read_cached_provider_context_window_map_with_meta(provider_name)
        cache_ttl_sec = 900
        try:
            cache_ttl_sec = max(0, int(provider_cfg.get("models_catalog_cache_ttl_sec", 900) or 900))
        except Exception:
            cache_ttl_sec = 900
        bg_refresh_enabled = bool(provider_cfg.get("models_catalog_async_refresh", True))
        wait_on_miss = bool(provider_cfg.get("models_catalog_wait_on_miss", False))
        bg_min_interval = 30
        try:
            bg_min_interval = max(5, int(provider_cfg.get("models_catalog_async_min_interval_sec", 30) or 30))
        except Exception:
            bg_min_interval = 30

        age = max(0, int(time.time()) - int(cached_updated_at or 0))
        if cached and (not force_remote):
            merged.update(cached)
            if cache_ttl_sec <= 0 or age > cache_ttl_sec:
                if bg_refresh_enabled:
                    cfg_snapshot = json.loads(json.dumps(cfg))
                    _launch_provider_context_refresh_bg(
                        provider_name,
                        lambda: _refresh_ollama_context_window_map(cfg_snapshot, timeout=timeout, force_remote=True),
                        min_interval_sec=bg_min_interval
                    )
            continue

        if (not cached) and (not force_remote) and bg_refresh_enabled and (not wait_on_miss):
            cfg_snapshot = json.loads(json.dumps(cfg))
            _launch_provider_context_refresh_bg(
                provider_name,
                lambda: _refresh_ollama_context_window_map(cfg_snapshot, timeout=timeout, force_remote=True),
                min_interval_sec=bg_min_interval
            )
            continue

        try:
            adapter = create_provider_adapter(provider_name, provider_cfg)
            adapter.list_models(client=None, capability="", request_options={})
            refreshed, _ = _read_cached_provider_context_window_map_with_meta(provider_name)
            if isinstance(refreshed, dict) and refreshed:
                merged.update(refreshed)
                continue
        except Exception:
            pass

        merged.update(cached)

    return merged


def _is_generic_context_provider(provider_name, provider_cfg):
    provider = str(provider_name or '').strip().lower()
    if provider in {'volcengine', 'aliyun', 'dashscope'}:
        return False

    cfg = provider_cfg if isinstance(provider_cfg, dict) else {}
    api_type = _normalize_provider_api_type(cfg.get('api_type'))
    if api_type in {'volcengine', 'dashscope', 'ollama'}:
        return False

    return True


def _refresh_generic_provider_context_window_map(config_obj, provider_key, timeout=8.0, force_remote=False):
    cfg = config_obj if isinstance(config_obj, dict) else {}
    provider_name = str(provider_key or '').strip()
    if not provider_name:
        return {}

    providers = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}
    provider_cfg = providers.get(provider_name)
    cached, cached_updated_at = _read_cached_provider_context_window_map_with_meta(provider_name)

    if not isinstance(provider_cfg, dict):
        return cached
    if not _is_generic_context_provider(provider_name, provider_cfg):
        return cached

    api_key = str(provider_cfg.get('api_key', '') or '').strip()
    if not api_key:
        return cached

    cache_ttl_sec = 1800
    try:
        cache_ttl_sec = max(0, int(provider_cfg.get('models_catalog_cache_ttl_sec', 1800) or 1800))
    except Exception:
        cache_ttl_sec = 1800

    bg_refresh_enabled = bool(provider_cfg.get('models_catalog_async_refresh', True))
    wait_on_miss = bool(provider_cfg.get('models_catalog_wait_on_miss', False))
    bg_min_interval = 45
    try:
        bg_min_interval = max(5, int(provider_cfg.get('models_catalog_async_min_interval_sec', 45) or 45))
    except Exception:
        bg_min_interval = 45

    if cached_updated_at and not force_remote:
        age = max(0, int(time.time()) - int(cached_updated_at or 0))
        if cache_ttl_sec > 0 and age <= cache_ttl_sec:
            return cached

        if bg_refresh_enabled:
            cfg_snapshot = json.loads(json.dumps(cfg))
            _launch_provider_context_refresh_bg(
                provider_name,
                lambda: _refresh_generic_provider_context_window_map(
                    cfg_snapshot,
                    provider_name,
                    timeout=timeout,
                    force_remote=True
                ),
                min_interval_sec=bg_min_interval
            )
            return cached

    if (not force_remote) and bg_refresh_enabled and (not wait_on_miss):
        cfg_snapshot = json.loads(json.dumps(cfg))
        _launch_provider_context_refresh_bg(
            provider_name,
            lambda: _refresh_generic_provider_context_window_map(
                cfg_snapshot,
                provider_name,
                timeout=timeout,
                force_remote=True
            ),
            min_interval_sec=bg_min_interval
        )
        return cached

    try:
        adapter = create_provider_adapter(provider_name, provider_cfg)
        client = adapter.create_client(
            api_key=api_key,
            base_url=str(provider_cfg.get('base_url', '') or '').strip(),
            timeout=max(2.0, float(timeout or 8.0))
        )
        result = adapter.list_models(
            client=client,
            capability='',
            request_options={}
        )
        fresh_map = _extract_context_map_from_provider_models_result(result)

        if not fresh_map:
            _write_cached_provider_context_window_map(provider_name, cached)
            return cached

        merged = dict(cached)
        merged.update(fresh_map)
        _write_cached_provider_context_window_map(provider_name, merged)
        return merged
    except Exception:
        return cached


def _refresh_generic_context_window_maps(config_obj, timeout=8.0):
    cfg = config_obj if isinstance(config_obj, dict) else {}
    providers = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}
    models = cfg.get("models", {}) if isinstance(cfg.get("models"), dict) else {}
    target_providers = set()

    for model_info in models.values():
        if not isinstance(model_info, dict):
            continue

        provider_name = str(model_info.get('provider') or '').strip()
        if provider_name:
            target_providers.add(provider_name)

    out = {}
    for provider_name in sorted(target_providers):
        provider_cfg = providers.get(provider_name)
        if not isinstance(provider_cfg, dict):
            continue
        if not _is_generic_context_provider(provider_name, provider_cfg):
            continue

        out[provider_name.strip().lower()] = _refresh_generic_provider_context_window_map(
            cfg,
            provider_name,
            timeout=timeout,
            force_remote=False
        )

    return out


def _normalize_context_refresh_mode(raw: Any) -> str:
    token = str(raw or '').strip().lower()

    if token in {'0', 'false', 'off', 'no', 'none', 'cache', 'cached'}:
        return 'cache'

    if token in {'force', 'remote', 'live'}:
        return 'force'

    return 'async'


def _cached_context_window_maps_for_config(config_obj: Dict[str, Any]) -> Tuple[Dict[str, int], Dict[str, int], Dict[str, int], Dict[str, Dict[str, int]]]:
    """Read context-window cache without starting remote model catalog refresh."""
    cfg = config_obj if isinstance(config_obj, dict) else {}
    providers = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}
    models = cfg.get("models", {}) if isinstance(cfg.get("models"), dict) else {}

    volc_context_map = _read_cached_provider_context_window_map('volcengine')
    aliyun_context_map = _read_cached_provider_context_window_map('aliyun')
    ollama_context_map: Dict[str, int] = {}
    generic_context_maps: Dict[str, Dict[str, int]] = {}
    target_providers = set()

    for model_info in models.values():

        if not isinstance(model_info, dict):
            continue

        provider_name = str(model_info.get('provider') or '').strip()

        if provider_name:
            target_providers.add(provider_name)

    for provider_name, provider_cfg in providers.items():

        if not isinstance(provider_cfg, dict):
            continue

        api_type = str(provider_cfg.get("api_type", "") or "").strip().lower()

        if api_type == 'ollama':
            ollama_context_map.update(_read_cached_provider_context_window_map(provider_name))

    for provider_name in sorted(target_providers):
        provider_cfg = providers.get(provider_name)

        if not isinstance(provider_cfg, dict):
            continue

        if not _is_generic_context_provider(provider_name, provider_cfg):
            continue

        generic_context_maps[provider_name.strip().lower()] = _read_cached_provider_context_window_map(provider_name)

    return volc_context_map, aliyun_context_map, ollama_context_map, generic_context_maps


def _resolve_context_window_maps_for_config(config_obj: Dict[str, Any], refresh_mode: str) -> Tuple[Dict[str, int], Dict[str, int], Dict[str, int], Dict[str, Dict[str, int]]]:
    cfg = config_obj if isinstance(config_obj, dict) else {}
    mode = _normalize_context_refresh_mode(refresh_mode)

    if mode == 'cache':
        return _cached_context_window_maps_for_config(cfg)

    has_volcengine_model = any(
        isinstance(info, dict) and str(info.get('provider', 'volcengine')).strip().lower() == 'volcengine'
        for info in (cfg.get('models', {}) or {}).values()
    )
    has_aliyun_model = any(
        isinstance(info, dict) and str(info.get('provider', '')).strip().lower() in {'aliyun', 'dashscope'}
        for info in (cfg.get('models', {}) or {}).values()
    )
    has_ollama_model = any(
        isinstance(provider_cfg, dict) and str(provider_cfg.get('api_type', '')).strip().lower() == 'ollama'
        for provider_cfg in (cfg.get('providers', {}) or {}).values()
    )
    force_remote = mode == 'force'

    volc_context_map = (
        _refresh_volc_context_window_map(cfg, timeout=8.0, force_remote=force_remote)
        if has_volcengine_model else {}
    )
    aliyun_context_map = (
        _refresh_aliyun_context_window_map(cfg, timeout=8.0, force_remote=force_remote)
        if has_aliyun_model else {}
    )
    ollama_context_map = (
        _refresh_ollama_context_window_map(cfg, timeout=8.0, force_remote=force_remote)
        if has_ollama_model else {}
    )

    if force_remote:
        generic_context_maps = {}
        providers = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}
        models = cfg.get("models", {}) if isinstance(cfg.get("models"), dict) else {}
        target_providers = {
            str(info.get('provider') or '').strip()
            for info in models.values()
            if isinstance(info, dict) and str(info.get('provider') or '').strip()
        }

        for provider_name in sorted(target_providers):
            provider_cfg = providers.get(provider_name)

            if not isinstance(provider_cfg, dict):
                continue

            if not _is_generic_context_provider(provider_name, provider_cfg):
                continue

            generic_context_maps[provider_name.strip().lower()] = _refresh_generic_provider_context_window_map(
                cfg,
                provider_name,
                timeout=8.0,
                force_remote=True
            )
    else:
        generic_context_maps = _refresh_generic_context_window_maps(cfg, timeout=8.0)

    return volc_context_map, aliyun_context_map, ollama_context_map, generic_context_maps


def _resolve_context_window_by_model_id(model_id, models_map):
    sid = _normalize_model_id_for_ctx(model_id)
    if not sid or not isinstance(models_map, dict):
        return 0
    trimmed_target = _trim_model_id_last_hyphen_number(sid)
    if trimmed_target:
        for remote_id, ctx in models_map.items():
            if _trim_model_id_last_hyphen_number(remote_id) == trimmed_target:
                n = _safe_context_window_int(ctx)
                if n > 0:
                    return n
    n = _safe_context_window_int(models_map.get(sid))
    if n > 0:
        return n
    return 0


def _resolve_volc_context_window_by_model_id(model_id, models_map):
    return _resolve_context_window_by_model_id(model_id, models_map)


def _resolve_aliyun_context_window_by_model_id(model_id, models_map):
    return _resolve_context_window_by_model_id(model_id, models_map)
