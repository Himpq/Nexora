"""
Nexora.app.Search.config — 联网搜索独立配置

设计目标：
- 与 NexoraSearch (self-hosted playwright) 解耦，单独演进
- 后续可直接挂到 设置-搜索设置 面板，无需改结构
- 支持多厂商并存：active_provider 指向当前生效者

配置文件落点：主 config.json -> web_search
"""

from __future__ import annotations

import os
from typing import Any, Dict, List


# ---------------------------------------------------------------------------
# 默认配置（将合并到 basis.Config.DEFAULT_MAIN_CONFIG）
# ---------------------------------------------------------------------------

DEFAULT_WEB_SEARCH_CONFIG: Dict[str, Any] = {
    # 当前生效的搜索提供方：duckduckgo / exa / disabled
    "active_provider": "duckduckgo",

    # 全局默认条数
    "default_num_results": 8,

    # 各厂商独立配置
    "providers": {
        "duckduckgo": {
            "backend": "html",
            "region": "wt-wt",
            "safesearch": "moderate",
            "timelimit": "w",
            "fetch_content": False,
            "timeout": 15,
        },
        "exa": {
            # 鉴权：优先读取此处，其次环境变量 EXA_API_KEY
            "api_key": "",
            "base_url": "https://api.exa.ai",
            "type": "auto",
            "num_results": 10,
            "contents": {
                "highlights": True
            },
            "timeout": 20,
        },
    },
}


# ---------------------------------------------------------------------------
# 读写辅助
# ---------------------------------------------------------------------------

def get_web_search_config(main_config: Dict[str, Any]) -> Dict[str, Any]:
    """从主配置提取 web_search 段，未配置时返回默认值副本"""
    import json

    raw = main_config.get("web_search") if isinstance(main_config, dict) else None

    if not isinstance(raw, dict):
        return json.loads(json.dumps(DEFAULT_WEB_SEARCH_CONFIG))

    # 深拷贝后合并默认值（不污染传入对象）
    merged: Dict[str, Any] = json.loads(json.dumps(DEFAULT_WEB_SEARCH_CONFIG))

    for key, value in raw.items():
        if key == "providers" and isinstance(value, dict):
            for p_name, p_cfg in value.items():
                if not isinstance(p_cfg, dict):
                    continue

                if p_name not in merged["providers"]:
                    merged["providers"][p_name] = {}

                merged["providers"][p_name].update(p_cfg)
        else:
            merged[key] = value

    return merged


def get_active_provider_name(main_config: Dict[str, Any]) -> str:
    """获取当前生效提供方名称"""
    cfg = get_web_search_config(main_config)

    return str(cfg.get("active_provider") or "duckduckgo").strip().lower()


def get_provider_config(main_config: Dict[str, Any], provider_name: str) -> Dict[str, Any]:
    """获取指定提供方的配置"""
    cfg = get_web_search_config(main_config)
    providers = cfg.get("providers") if isinstance(cfg.get("providers"), dict) else {}
    raw = providers.get(str(provider_name or "").strip().lower(), {})

    return raw if isinstance(raw, dict) else {}


def resolve_exa_api_key(provider_config: Dict[str, Any]) -> str:
    """解析 Exa API Key：配置优先，其次环境变量"""
    key = str(provider_config.get("api_key") or "").strip()

    if key:
        return key

    return str(os.environ.get("EXA_API_KEY") or "").strip()


def list_configured_providers(main_config: Dict[str, Any]) -> List[str]:
    """列出已配置的提供方名称"""
    cfg = get_web_search_config(main_config)
    providers = cfg.get("providers") if isinstance(cfg.get("providers"), dict) else {}

    return [str(k) for k in providers.keys() if str(k).strip()]


def is_web_search_enabled(main_config: Dict[str, Any]) -> bool:
    """是否启用联网搜索（active_provider != disabled）"""
    active = get_active_provider_name(main_config)

    return active not in {"", "disabled", "none", "off"}
