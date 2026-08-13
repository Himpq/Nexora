"""
Nexora.basis.Config — 配置基础层

职责：主配置（config.json）与模型配置（models.json）的读写、默认值合并、
      缓存读取、模型配置同步载荷构建。从 server.py 迁移，与 Flask / 业务迁移
      逻辑解耦（迁移逻辑由调用方通过回调注入）。

对外提供：
- DEFAULT_MAIN_CONFIG / DEFAULT_MODELS_CONFIG: 默认值
- merge_defaults / coerce_bool_flag: 基础工具
- ensure_main_config_defaults: 主配置默认值合并（支持迁移回调）
- get_config_all: 带 mtime 缓存读取
- save_main_config / load_models_config / save_models_config
- models_config_sync_file_payload / extract_ollama_provider_names
- set_config_paths: 注入配置文件路径（由 server 层调用）
"""
from __future__ import annotations

import json
import os
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple

# 配置文件路径（由 server 层通过 set_config_paths 注入，避免硬编码）
CONFIG_PATH = ""
MODELS_PATH = ""

_CONFIG_CACHE: Optional[Dict[str, Any]] = None
_CONFIG_CACHE_MTIME: Optional[Tuple[float, float]] = None
_CONFIG_LOCK = threading.Lock()


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
        "public_api_key": "",
        "public_api_enabled": False,
        "public_api_keys_file": "./data/papikey.jsonl",
        "public_api_key_created_at": "",
        "public_api_key_expires_at": "",
        "public_api_key_last_regenerated_at": "",
        "public_api_key_permissions": {
            "model_inference": True,
            "image_generation": True,
            "knowledge_read": True,
            "conversations_read": True,
            "token_stats_read": True,
        },
    },
    "rag_database": {
        "host": "127.0.0.1",
        "port": 8100,
        "api_key": "nexoradb-123456",
        "rag_database_enabled": False,
        "mode": "service",
        "path": "./data/chroma",
    },
    "nexora_mail": {},
    "nexora_learning": {},
    "map_service": {},
    "gen_image": {},
    "temp_context_cache": {},
    "nexora_search": {},
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
    """将 DEFAULT_MAIN_CONFIG 深合并进 cfg，返回是否有变更。"""
    return merge_defaults(cfg, json.loads(json.dumps(DEFAULT_MAIN_CONFIG, ensure_ascii=False)))


def persist_main_config(cfg: Dict[str, Any]) -> None:
    """写回 config.json。"""
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=4, ensure_ascii=False)


def ensure_main_config_defaults(
    *migration_hooks: Callable[[Dict[str, Any]], bool],
) -> Dict[str, Any]:
    """
    读取主配置并合并默认值，可选执行迁移回调。
    迁移回调返回是否变更；若有变更或文件缺失，将结果写回。
    """
    cfg = load_main_config()
    changed = apply_defaults(cfg)

    for hook in migration_hooks:
        if not callable(hook):
            continue
        try:
            if hook(cfg):
                changed = True
        except Exception:
            pass

    if changed or not (CONFIG_PATH and os.path.exists(CONFIG_PATH)):
        persist_main_config(cfg)

    return cfg


def get_config_all(*migration_hooks: Callable[[Dict[str, Any]], bool]) -> Dict[str, Any]:
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
        config = ensure_main_config_defaults(*migration_hooks)
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
