"""
Nexora.basis.Config — 配置基础层

职责：主配置（config.json）与模型配置（models.json）的读写、默认值合并、
      缓存读取、模型配置同步载荷构建。从 server.py 迁移，与 Flask / 业务逻辑解耦。

对外提供：
- DEFAULT_MAIN_CONFIG / DEFAULT_MODELS_CONFIG: 默认值
- merge_defaults / coerce_bool_flag: 基础工具
- ensure_main_config_defaults: 主配置默认值合并
- get_config_all: 带 mtime 缓存读取
- save_main_config / load_models_config / save_models_config
- models_config_sync_file_payload / extract_ollama_provider_names
- is_archived_model_entry / filter_archived_models
- set_config_paths: 注入配置文件路径（由 server 层调用）
"""
from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, List, Optional, Tuple

from Map.config import DEFAULT_MAP_SERVICE_CONFIG

# 配置文件路径（由 server 层通过 set_config_paths 注入，避免硬编码）
CONFIG_PATH = ""
MODELS_PATH = ""

_CONFIG_CACHE: Optional[Dict[str, Any]] = None
_CONFIG_CACHE_MTIME: Optional[Tuple[float, float]] = None
_CONFIG_LOCK = threading.Lock()

_RETIRED_API_FIELDS = {
    "public_api_key",
    "public_api_keys_file",
    "public_api_key_created_at",
    "public_api_key_expires_at",
    "public_api_key_last_regenerated_at",
    "public_api_key_permissions",
}


def set_config_paths(config_path: str, models_path: str) -> None:
    """注入配置文件路径（server 层启动时调用）。"""
    global CONFIG_PATH, MODELS_PATH
    CONFIG_PATH = str(config_path or "")
    MODELS_PATH = str(models_path or "")


DEFAULT_MAIN_CONFIG: Dict[str, Any] = {
    "port": 5000,
    "debug": False,
    "public_base_url": "",
    "trusted_proxy_cidrs": [],
    "default_model": "doubao-seed-1-6-250615",
    "conclusion_model": "doubao-seed-1-6-flash-250828",
    "organization_model": "doubao-seed-1-6-flash-250828",
    "websearch_model": "doubao-seed-1-6-flash-250828",
    "continuous_summary": False,
    "log_status": "silent",
    "log_retention_count": 5,
    "recent_dialogue_memory_count": 3,
    "recent_dialogue_item_max_chars": 12000,
    "user_knowledge_prompt_max_items": 24,
    "user_knowledge_prompt_max_chars": 6000,
    "api": {
        "public_api_enabled": False,
    },
    "rag_database": {
        "host": "127.0.0.1",
        "port": 8100,
        "api_key": "nexoradb-123456",
        "rag_database_enabled": False,
        "mode": "service",
        "path": "./data/chroma",
        "collection_prefix": "knowledge",
        "distance": "cosine",
        "service_url": "http://127.0.0.1:8100",
        "chunk_size": 200,
        "chunk_overlap": 40,
    },
    "nexora_mail": {
        "host": "127.0.0.1",
        "port": 17171,
        "api_key": "",
        "nexora_mail_enabled": False,
        "service_url": "http://127.0.0.1:17171",
        "timeout": 10,
        "send_timeout": 120,
        "cache_enabled": True,
        "cache_list_ttl": 180,
        "cache_detail_ttl": 3600,
        "cache_max_entries": 800,
        "default_group": "default",
    },
    "nexora_search": {
        "host": "127.0.0.1",
        "port": 45678,
        "api_key": "",
        "nexora_search_enabled": False,
        "service_url": "http://127.0.0.1:45678",
        "timeout": 15,
    },
    "map_service": DEFAULT_MAP_SERVICE_CONFIG,
    "gen_image": {
        "enabled_api": "",
        "apis": {},
    },
    "temp_context_cache": {
        "enabled": True,
        "trigger_chars": 1000,
        "expire_seconds": 0,
        "storage": "memory",
        "file_path": "./data/temp/ContextTemp.tmp",
    },
    "nexora_learning": {
        "enabled": True,
        "host": "127.0.0.1",
        "port": 5001,
        "frontend_url": "http://127.0.0.1:5001",
        "api_key": "",
        "request_timeout": 30,
    },
}


def coerce_bool_flag(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def merge_defaults(dst: Dict[str, Any], src: Dict[str, Any]) -> bool:
    changed = False
    for k, v in src.items():
        if k not in dst:
            dst[k] = v
            changed = True
        elif isinstance(v, dict) and isinstance(dst.get(k), dict):
            if merge_defaults(dst[k], v):
                changed = True
    return changed


def load_main_config() -> Dict[str, Any]:
    """读取 config.json 原始内容（不存在/损坏时返回空字典）。"""
    if not CONFIG_PATH or not os.path.exists(CONFIG_PATH):
        return {}
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        if not isinstance(cfg, dict):
            return {}
        return cfg
    except Exception:
        return {}


def apply_defaults(cfg: Dict[str, Any]) -> bool:
    """合并唯一默认值，并删除已退役的配置字段。"""
    changed = merge_defaults(cfg, json.loads(json.dumps(DEFAULT_MAIN_CONFIG, ensure_ascii=False)))
    api_cfg = cfg.get("api")

    if isinstance(api_cfg, dict):
        for field_name in _RETIRED_API_FIELDS:
            if field_name in api_cfg:
                del api_cfg[field_name]
                changed = True

    return changed


def persist_main_config(cfg: Dict[str, Any]) -> None:
    """写回 config.json。"""
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=4, ensure_ascii=False)


def ensure_main_config_defaults() -> Dict[str, Any]:
    """读取主配置并合并唯一的基础默认值。"""
    cfg = load_main_config()
    changed = apply_defaults(cfg)

    if changed or not (CONFIG_PATH and os.path.exists(CONFIG_PATH)):
        persist_main_config(cfg)

    return cfg


def get_config_all() -> Dict[str, Any]:
    """
    获取配置（带 mtime 缓存，文件未变时直接返回内存副本）。
    """
    global _CONFIG_CACHE, _CONFIG_CACHE_MTIME
    try:
        cfg_mtime = os.path.getmtime(CONFIG_PATH) if CONFIG_PATH and os.path.exists(CONFIG_PATH) else 0.0
        mdl_mtime = os.path.getmtime(MODELS_PATH) if MODELS_PATH and os.path.exists(MODELS_PATH) else 0.0
        if _CONFIG_CACHE is not None and (cfg_mtime, mdl_mtime) == _CONFIG_CACHE_MTIME:
            return dict(_CONFIG_CACHE)
    except OSError:
        pass

    try:
        config = ensure_main_config_defaults()
    except Exception as e:
        print(f"Error loading/ensuring config defaults: {e}")
        config = {}

    if MODELS_PATH and os.path.exists(MODELS_PATH):
        try:
            with open(MODELS_PATH, "r", encoding="utf-8") as f:
                models_cfg = json.load(f)
            config["models"] = models_cfg.get("models", models_cfg)
            if "providers" in models_cfg:
                config["providers"] = models_cfg.get("providers", {})
        except Exception as e:
            print(f"Error loading models config: {e}")

    try:
        cfg_mtime = os.path.getmtime(CONFIG_PATH) if CONFIG_PATH and os.path.exists(CONFIG_PATH) else 0.0
        mdl_mtime = os.path.getmtime(MODELS_PATH) if MODELS_PATH and os.path.exists(MODELS_PATH) else 0.0
        _CONFIG_CACHE = config
        _CONFIG_CACHE_MTIME = (cfg_mtime, mdl_mtime)
    except OSError:
        _CONFIG_CACHE = config

    return dict(config)


def save_main_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    global _CONFIG_CACHE
    if not isinstance(cfg, dict):
        cfg = {}
    payload = json.loads(json.dumps(cfg, ensure_ascii=False))
    payload = {k: v for k, v in payload.items() if k not in {"models", "providers"}}
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=4, ensure_ascii=False)
    _CONFIG_CACHE = None
    return payload


def load_models_config() -> Dict[str, Any]:
    """读取 models.json，返回标准结构。"""
    if not MODELS_PATH or not os.path.exists(MODELS_PATH):
        return {"models": {}, "providers": {}}
    with open(MODELS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        return {"models": {}, "providers": {}}
    models = data.get("models", {})
    providers = data.get("providers", {})
    if not isinstance(models, dict):
        models = {}
    if not isinstance(providers, dict):
        providers = {}
    return {"models": models, "providers": providers}


def is_archived_model_entry(model_info: Any) -> bool:
    """判断模型是否已归档；归档模型仍保留在配置中供历史计费读取。"""
    if not isinstance(model_info, dict):
        return False

    return str(model_info.get("status") or "").strip().lower() == "archived"


def filter_archived_models(models: Any) -> Dict[str, Any]:
    """过滤对外展示的归档模型，不影响内部配置和历史计费解析。"""
    if not isinstance(models, dict):
        return {}

    return {
        model_id: model_info
        for model_id, model_info in models.items()
        if not is_archived_model_entry(model_info)
    }


def save_models_config(models_cfg: Dict[str, Any], sync_hook: Optional[Callable[[str], None]] = None, sync_source: str = "models_config_save") -> None:
    """保存 models.json。"""
    global _CONFIG_CACHE
    payload = {
        "models": models_cfg.get("models", {}),
        "providers": models_cfg.get("providers", {}),
    }
    with open(MODELS_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=4, ensure_ascii=False)
    _CONFIG_CACHE = None
    if callable(sync_hook):
        sync_hook(sync_source)


def models_config_sync_file_payload() -> Tuple[bytes, Dict[str, Any], int, int]:
    if not MODELS_PATH or not os.path.exists(MODELS_PATH):
        return b"", {"models": {}, "providers": {}}, 0, 0
    stat = os.stat(MODELS_PATH)
    with open(MODELS_PATH, "rb") as f:
        raw = f.read()
    data = json.loads(raw.decode("utf-8-sig")) if raw else {}
    if not isinstance(data, dict):
        data = {"models": {}, "providers": {}}
    return raw, data, int(stat.st_mtime), int(stat.st_mtime_ns)


def extract_ollama_provider_names(models_cfg: Dict[str, Any]) -> List[str]:
    cfg = models_cfg if isinstance(models_cfg, dict) else {}
    providers = cfg.get("providers", {}) if isinstance(cfg.get("providers"), dict) else {}
    names: List[str] = []
    for provider_name, provider_cfg in providers.items():
        if not isinstance(provider_cfg, dict):
            continue
        api_type = str(provider_cfg.get("api_type", "") or "").strip().lower()
        if api_type == "ollama":
            names.append(str(provider_name or "").strip())
    return sorted([name for name in names if name], key=lambda item: item.lower())
