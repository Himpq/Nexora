"""
火山引擎大模型封装类 - 重构版
基于 Responses API 最佳实践
参考文档：
- https://www.volcengine.com/docs/82379/1569618 (Responses API)
- https://www.volcengine.com/docs/82379/1262342 (Function Calling)
"""
import os
import json
import time
import re
import base64
import textwrap
import threading
from datetime import datetime
from typing import List, Dict, Any, Optional, Generator
from urllib import request as urllib_request, error as urllib_error, parse as urllib_parse
from email.header import Header
from email.utils import parsedate_to_datetime
from volcenginesdkarkruntime import Ark
from openai import OpenAI
from tools import TOOLS
from tool_executor import ToolExecutor
from database import User
from conversation_manager import ConversationManager

# 配置文件路径
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config.json')
MODELS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models.json')
MODELS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models.json')
SEARCH_ADAPTERS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'search_adapters.json')

DEFAULT_SEARCH_ADAPTER_CONFIG = {
    "version": 1,
    "providers": {},
    "relay_order": []
}

# 加载配置
def load_config():
    config = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            config = json.load(f)
    if os.path.exists(MODELS_PATH):
        with open(MODELS_PATH, 'r', encoding='utf-8') as f:
            models_cfg = json.load(f)
        config["models"] = models_cfg.get("models", models_cfg)
        if "providers" in models_cfg:
            config["providers"] = models_cfg.get("providers", {})
    return config


def load_search_adapter_config() -> Dict[str, Any]:
    """加载搜索适配器配置（providers / relay_order）"""
    cfg = json.loads(json.dumps(DEFAULT_SEARCH_ADAPTER_CONFIG))
    try:
        if os.path.exists(SEARCH_ADAPTERS_PATH):
            with open(SEARCH_ADAPTERS_PATH, 'r', encoding='utf-8') as f:
                file_cfg = json.load(f)
            if isinstance(file_cfg, dict):
                providers_cfg = file_cfg.get("providers")
                if isinstance(providers_cfg, dict):
                    cfg["providers"].update(providers_cfg)
                relay_order = file_cfg.get("relay_order")
                if isinstance(relay_order, list):
                    cfg["relay_order"] = [str(x).strip() for x in relay_order if str(x).strip()]
                elif isinstance(file_cfg.get("adapters"), dict):
                    # 兼容旧格式：adapters 下键即 provider 名
                    cfg["providers"].update(file_cfg.get("adapters", {}))
    except Exception as e:
        print(f"[SEARCH_ADAPTER] 配置加载失败，使用默认配置: {e}")
    return cfg

CONFIG = load_config()

# 清除代理设置
if 'HTTP_PROXY' in os.environ:
    del os.environ['HTTP_PROXY']
if 'HTTPS_PROXY' in os.environ:
    del os.environ['HTTPS_PROXY']

# 全局客户端缓存，实现连接池复用 (Keep-Alive)
_CLIENT_CACHE = {}
_TOOL_USAGE_LOG_LOCK = threading.Lock()

def _ensure_json_serializable(obj):
    """
    递归确保对象可以被 JSON 序列化
    将所有不可序列化的对象转换为字符串
    """
    if isinstance(obj, (str, int, float, bool, type(None))):
        return obj
    elif isinstance(obj, dict):
        return {k: _ensure_json_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_ensure_json_serializable(item) for item in obj]
    else:
        # 对于任何其他类型（包括 SDK 对象），转换为字符串
        return str(obj)

class Model:
    """大模型封装类 - 支持多供应商"""
    
    def __init__(
        self,
        username: str,
        model_name: str = None,
        system_prompt: Optional[str] = None,
        conversation_id: Optional[str] = None,
        auto_create: bool = True
    ):
        """
        初始化Model
        
        Args:
            username: 用户名
            model_name: 模型名称 (None使用配置文件默认值)
            system_prompt: 自定义系统提示词
            conversation_id: 对话ID（None时根据auto_create决定是否创建）
            auto_create: 是否自动创建新对话
        """
        self.username = username
        self.user = User(username)
        
        # 加载配置
        global CONFIG
        CONFIG = load_config()
        self.config = CONFIG
        
        # 确定模型名称（增加黑名单过滤逻辑）
        requested_model = model_name
        
        # 加载权限配置
        blacklist = []
        try:
            perm_path = os.path.join(os.path.dirname(CONFIG_PATH), 'data', 'model_permissions.json')
            if os.path.exists(perm_path):
                with open(perm_path, 'r', encoding='utf-8') as f:
                    perm_data = json.load(f)
                    user_blacklists = perm_data.get('user_blacklists', {})
                    blacklist = user_blacklists.get(username, perm_data.get('default_blacklist', []))
        except Exception as e:
            print(f"Error loading blacklist in Model: {e}")

        if requested_model:
            # 如果请求的模型在黑名单中，或者根本不是有效的模型ID，进行处理
            if requested_model in blacklist or requested_model not in CONFIG.get('models', {}):
                # 寻找第一个真正可用的模型
                available = [m for m in CONFIG.get('models', {}).keys() if m not in blacklist]
                if not available:
                    # 如果一个可用的都没有，且请求的又非法/被禁，强制设为一个非法值以触发后续报错，或抛出异常
                    self.model_name = "NO_AVAILABLE_MODEL"
                else:
                    # 如果请求的是非法ID（如 "Select Model"），则使用第一个可用的合法模型
                    self.model_name = available[0]
            else:
                self.model_name = requested_model
        else:
            # 使用默认模型，如果默认模型被禁，寻找第一个可用的
            default_model = CONFIG.get('default_model', 'doubao-seed-1-6-251015')
            if default_model in blacklist:
                available = [m for m in CONFIG.get('models', {}).keys() if m not in blacklist]
                if available:
                    self.model_name = available[0]
                else:
                    self.model_name = "NO_AVAILABLE_MODEL"
            else:
                self.model_name = default_model
            
        self.conversation_manager = ConversationManager(username)
        
        # 对话ID管理
        if conversation_id:
            self.conversation_id = conversation_id
        elif auto_create:
            self.conversation_id = self.conversation_manager.create_conversation()
        else:
            self.conversation_id = None
        
        # 获取模型配置和供应商信息
        model_info = CONFIG.get('models', {}).get(self.model_name, {})
        self.model_display_name = model_info.get('name', self.model_name)
        self.provider = model_info.get('provider', 'volcengine')
        provider_info = CONFIG.get('providers', {}).get(self.provider, {})
        self.provider_display_name = provider_info.get('name', self.provider)
        
        api_key = provider_info.get('api_key', "")
        base_url = provider_info.get('base_url')

        # 初始化客户端 (使用全局缓存实现连接复用)
        global _CLIENT_CACHE
        cache_key = f"{self.provider}_{api_key}"
        
        if cache_key in _CLIENT_CACHE:
            self.client = _CLIENT_CACHE[cache_key]
        else:
            # 首次连接
            print(f"[INIT] 创建新的 {self.provider} 客户端连接 (Key: ...{api_key[-4:]})")
            
            if self.provider == 'volcengine':
                self.client = Ark(
                    api_key=api_key,
                    base_url=base_url,
                    timeout=120.0,
                    max_retries=2
                )
            else:
                # Stepfun 或其他 OpenAI 兼容接口
                self.client = OpenAI(
                    api_key=api_key,
                    base_url=base_url,
                    timeout=120.0
                )
            _CLIENT_CACHE[cache_key] = self.client
        
        # 系统提示词（支持 {{var}} 模板变量）
        self.system_prompt = self._render_prompt_template(system_prompt) if system_prompt else self._get_default_system_prompt()

        # 搜索适配器（provider 级）配置
        self.search_adapter_config = self._load_search_adapter_runtime_config()
        self.provider_search_adapter = self._get_provider_search_adapter(self.provider)
        self.native_search_tools = self._get_provider_native_tools(self.provider)
        self.native_web_search_enabled = any(
            str(t.get("type", "")).strip() == "web_search"
            for t in self.native_search_tools
        )
        try:
            log_status = str(CONFIG.get("log_status", "silent") or "silent").strip().lower()
            if log_status in {"all", "debug", "verbose"}:
                native_flag = self._adapter_flag(
                    self.provider_search_adapter, "native_enabled", fallback_key="enabled", default=False
                )
                relay_flag = self._adapter_flag(
                    self.provider_search_adapter, "relay_enabled", fallback_key="enabled", default=False
                )
                allowed = self._is_model_allowed_by_adapter(self.provider_search_adapter)
                print(
                    f"[SEARCH_ADAPTER] provider={self.provider} model={self.model_name} "
                    f"native_enabled={native_flag} relay_enabled={relay_flag} "
                    f"allowed={allowed} native_web_search_enabled={self.native_web_search_enabled} "
                    f"native_tools={[str(t.get('type','')) for t in self.native_search_tools]}"
                )
        except Exception:
            pass

        # 工具定义
        self.tools = self._parse_tools(TOOLS)
        self.tool_executor = ToolExecutor(self)
    
    def get_embedding(self, text: str) -> List[float]:
        """获取文本向量 (OpenAI/Alibaba 兼容接口)"""
        embedding_key = CONFIG.get('default_embedding_model', "text-embedding-v3")

        embedding_model = CONFIG.get('embedding_model', {}).get(embedding_key, {}).get('name', embedding_key)
        provider_name = CONFIG.get('embedding_model', {}).get(embedding_key, {}).get('provider')
        if not provider_name:
            provider_name = 'aliyun_embedding' if 'aliyun_embedding' in CONFIG.get('providers', {}) else self.provider
        provider_info = CONFIG.get('providers', {}).get(provider_name, {})
        
        api_key = provider_info.get('api_key')
        base_url = provider_info.get('base_url')

        # 使用 OpenAI 客户端进行调用（大部分厂商均兼容此模式）
        temp_client = OpenAI(
            api_key=api_key,
            base_url=base_url
        )
        
        response = temp_client.embeddings.create(
            model=embedding_model,
            input=text
        )
        return response.data[0].embedding

    def _get_default_system_prompt(self) -> str:
        """获取极简高效的系统提示词"""
        import prompts
        # 检查是否有特定模型的自定义提示词
        if hasattr(prompts, 'others') and self.model_name in prompts.others:
            return self._render_prompt_template(prompts.others[self.model_name])
        return self._render_prompt_template(prompts.default)
    
    def _get_default_web_search_prompt(self) -> str:
        """获取默认的联网搜索系统提示词"""
        import prompts
        return self._render_prompt_template(prompts.web_search_default)

    def _load_search_adapter_runtime_config(self) -> Dict[str, Any]:
        """读取搜索适配器配置（支持运行时热更新）"""
        return load_search_adapter_config()

    def _get_provider_search_adapter(self, provider_name: Optional[str] = None) -> Dict[str, Any]:
        cfg = self._load_search_adapter_runtime_config()
        providers_cfg = cfg.get("providers", {}) if isinstance(cfg, dict) else {}
        if not isinstance(providers_cfg, dict):
            providers_cfg = {}
        p = str(provider_name or self.provider or "").strip()
        adapter = providers_cfg.get(p, {})
        return adapter if isinstance(adapter, dict) else {}

    def _as_bool(self, value: Any, default: bool = False) -> bool:
        if value is None:
            return bool(default)
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "y", "on"}
        return bool(value)

    def _adapter_flag(
        self,
        adapter: Dict[str, Any],
        key: str,
        fallback_key: str = "enabled",
        default: bool = False
    ) -> bool:
        if not isinstance(adapter, dict):
            return bool(default)
        if key in adapter:
            return self._as_bool(adapter.get(key), default=default)
        return self._as_bool(adapter.get(fallback_key), default=default)

    def _provider_use_responses_api(self, provider_name: Optional[str] = None) -> bool:
        """
        是否使用 Responses API。
        - volcengine: 始终使用 Responses API
        - aliyun: 由 search_adapters.providers.aliyun.request_options.search_api 控制
        """
        p = str(provider_name or self.provider or "").strip().lower()
        if p == "volcengine":
            return True
        if p == "aliyun":
            opts = self._get_provider_request_options(p)
            mode = str(
                opts.get("search_api", opts.get("api_mode", "chat_completions"))
            ).strip().lower()
            return mode in {"responses", "responses_api", "openai_responses"}
        return False

    def _normalize_model_keys(self) -> List[str]:
        keys = []
        for raw in [getattr(self, "model_name", ""), getattr(self, "model_display_name", "")]:
            v = str(raw or "").strip()
            if v:
                keys.append(v)
        # 去重并保序
        out = []
        seen = set()
        for k in keys:
            low = k.lower()
            if low in seen:
                continue
            seen.add(low)
            out.append(k)
        return out

    def _normalize_model_token(self, value: Any) -> str:
        s = str(value or "").strip().lower()
        if not s:
            return ""
        return s.replace(" ", "").replace("_", "-")

    def _expand_model_aliases(self, value: Any) -> List[str]:
        """
        扩展模型名别名，兼容以下形式：
        - provider/model-id
        - prefix:model-id
        - 模型快照后缀 / thinking 后缀
        """
        raw = str(value or "").strip()
        if not raw:
            return []
        candidates = [raw]
        if "/" in raw:
            candidates.append(raw.split("/")[-1])
        if ":" in raw:
            candidates.append(raw.split(":")[-1])

        out = []
        seen = set()
        for c in candidates:
            n = self._normalize_model_token(c)
            if not n or n in seen:
                continue
            seen.add(n)
            out.append(n)
        return out

    def _model_rule_match(self, model_token: str, rule_token: str) -> bool:
        if not model_token or not rule_token:
            return False
        if model_token == rule_token:
            return True
        # 兼容快照/思考等后缀：qwen3.5-plus-thinking / qwen-plus-2026-xx
        for sep in ("-", "_", "."):
            if model_token.startswith(rule_token + sep):
                return True
        return False

    def _is_model_allowed_by_adapter(self, adapter: Dict[str, Any]) -> bool:
        """
        基于 adapter 白/黑名单判断当前模型是否允许启用 native search。
        规则：
        - deny_models 命中即禁用
        - allow_models / allows_models:
          * 1/true/"1"/"all"/"*" => 全部允许
          * list => 仅命中列表允许（空列表视为全部允许）
          * 未配置 => 全部允许
        """
        if not isinstance(adapter, dict):
            return False

        model_keys = self._normalize_model_keys()
        expanded_model_tokens = []
        model_token_seen = set()
        for m in model_keys:
            for tk in self._expand_model_aliases(m):
                if tk in model_token_seen:
                    continue
                model_token_seen.add(tk)
                expanded_model_tokens.append(tk)

        deny_models = adapter.get("deny_models", [])
        if isinstance(deny_models, list):
            deny_tokens = []
            for x in deny_models:
                deny_tokens.extend(self._expand_model_aliases(x))
            if any(
                self._model_rule_match(m, d)
                for m in expanded_model_tokens
                for d in deny_tokens
            ):
                return False

        allow_models = adapter.get("allow_models", adapter.get("allows_models"))
        if allow_models is None:
            return True

        if allow_models is True or allow_models == 1:
            return True

        if isinstance(allow_models, str):
            token = allow_models.strip().lower()
            if token in {"1", "all", "*", "true"}:
                return True
            # 兼容逗号分隔字符串
            parts = [p.strip() for p in allow_models.split(",") if p.strip()]
            if not parts:
                return True
            allow_tokens = []
            for p in parts:
                allow_tokens.extend(self._expand_model_aliases(p))
            return any(
                self._model_rule_match(m, a)
                for m in expanded_model_tokens
                for a in allow_tokens
            )

        if isinstance(allow_models, list):
            allow_tokens = []
            for x in allow_models:
                allow_tokens.extend(self._expand_model_aliases(x))
            if not allow_tokens:
                return True
            return any(
                self._model_rule_match(m, a)
                for m in expanded_model_tokens
                for a in allow_tokens
            )

        return bool(allow_models)

    def _get_provider_request_options(self, provider_name: Optional[str] = None) -> Dict[str, Any]:
        adapter = self._get_provider_search_adapter(provider_name)
        if not adapter:
            return {}
        opts = adapter.get("request_options", {})
        return opts if isinstance(opts, dict) else {}

    def _get_provider_native_tools(self, provider_name: Optional[str] = None) -> List[Dict[str, Any]]:
        adapter = self._get_provider_search_adapter(provider_name)
        if not adapter or not self._adapter_flag(adapter, "native_enabled", fallback_key="enabled", default=False):
            return []
        if not self._is_model_allowed_by_adapter(adapter):
            return []
        tools = adapter.get("tools", [])
        if not isinstance(tools, list):
            return []
        normalized = []
        for t in tools:
            if not isinstance(t, dict):
                continue
            if not t.get("type"):
                continue
            normalized.append(json.loads(json.dumps(t)))
        return normalized

    def _provider_native_web_search_enabled(self, provider_name: Optional[str] = None) -> bool:
        tools = self._get_provider_native_tools(provider_name)
        return any(str(t.get("type", "")).strip() == "web_search" for t in tools)

    def _get_provider_client_for_search(self, provider_name: str):
        provider_info = CONFIG.get('providers', {}).get(provider_name, {})
        api_key = str(provider_info.get('api_key', '') or '').strip()
        base_url = str(provider_info.get('base_url', '') or '').strip()
        if not api_key:
            raise ValueError(f"provider {provider_name} 未配置 api_key")

        global _CLIENT_CACHE
        cache_key = f"search_{provider_name}_{api_key}"
        if cache_key in _CLIENT_CACHE:
            return _CLIENT_CACHE[cache_key]

        if provider_name == 'volcengine':
            client = Ark(api_key=api_key, base_url=base_url, timeout=120.0, max_retries=2)
        else:
            client = OpenAI(api_key=api_key, base_url=base_url, timeout=120.0)

        _CLIENT_CACHE[cache_key] = client
        return client

    def _extract_responses_search_payload(self, response) -> Dict[str, Any]:
        text = ""
        references = []

        output_text = getattr(response, "output_text", None)
        if output_text:
            text = str(output_text).strip()

        if not text:
            output_items = getattr(response, "output", None) or []
            text_chunks = []
            for item in output_items:
                item_type = str(getattr(item, "type", "") or "")
                if item_type != "message":
                    continue
                content_list = getattr(item, "content", None) or []
                for content_item in content_list:
                    c_type = str(getattr(content_item, "type", "") or "")
                    if c_type not in ("output_text", "text"):
                        continue
                    piece = (
                        getattr(content_item, "text", None)
                        or getattr(content_item, "content", None)
                        or ""
                    )
                    piece = str(piece).strip()
                    if piece:
                        text_chunks.append(piece)

                    annotations = getattr(content_item, "annotations", None) or []
                    for ann in annotations:
                        url = str(getattr(ann, "url", "") or "").strip()
                        if not url:
                            continue
                        title = str(
                            getattr(ann, "title", "")
                            or getattr(ann, "source_title", "")
                            or "来源"
                        ).strip()
                        references.append({"title": title, "url": url})
            text = "\n".join(text_chunks).strip()

        return {"text": text, "references": references}

    def _execute_local_web_search_relay(self, query: str, args: Dict[str, Any]) -> str:
        """
        本地 web_search 中转：
        - 优先当前模型 provider（若 search_adapters 已启用且允许当前模型）
        - 否则回落到其它已启用且允许的 provider
        """
        models_map = CONFIG.get('models', {}) if isinstance(CONFIG.get('models', {}), dict) else {}
        websearch_model = str(CONFIG.get("websearch_model", "") or "").strip()

        def _adapter_relay_enabled_with_web_search(provider_name: str) -> bool:
            adapter = self._get_provider_search_adapter(provider_name)
            if not adapter or not self._adapter_flag(adapter, "relay_enabled", fallback_key="enabled", default=False):
                return False
            tools = adapter.get("tools", [])
            if not isinstance(tools, list):
                return False
            return any(str((t or {}).get("type", "")).strip() == "web_search" for t in tools if isinstance(t, dict))

        def _pick_model_for_provider(provider_name: str) -> str:
            if provider_name == self.provider:
                adapter = self._get_provider_search_adapter(provider_name)
                if (
                    self.model_name in models_map
                    and str(models_map.get(self.model_name, {}).get("provider", "") or "").strip() == provider_name
                    and self._is_model_allowed_by_adapter(adapter)
                ):
                    return self.model_name

            if (
                websearch_model
                and websearch_model in models_map
                and str(models_map.get(websearch_model, {}).get("provider", "") or "").strip() == provider_name
            ):
                adapter = self._get_provider_search_adapter(provider_name)
                model_backup = self.model_name
                display_backup = self.model_display_name
                try:
                    self.model_name = websearch_model
                    self.model_display_name = str(models_map.get(websearch_model, {}).get("name") or websearch_model)
                    if self._is_model_allowed_by_adapter(adapter):
                        return websearch_model
                finally:
                    self.model_name = model_backup
                    self.model_display_name = display_backup

            adapter = self._get_provider_search_adapter(provider_name)
            for m_id, m_info in models_map.items():
                if str(m_info.get("provider", "") or "").strip() != provider_name:
                    continue
                model_backup = self.model_name
                display_backup = self.model_display_name
                try:
                    self.model_name = m_id
                    self.model_display_name = str(m_info.get("name") or m_id)
                    if self._is_model_allowed_by_adapter(adapter):
                        return m_id
                finally:
                    self.model_name = model_backup
                    self.model_display_name = display_backup
            return ""

        provider_candidates = []
        if _adapter_relay_enabled_with_web_search(self.provider):
            provider_candidates.append(self.provider)

        runtime_cfg = self._load_search_adapter_runtime_config()
        relay_order = runtime_cfg.get("relay_order", []) if isinstance(runtime_cfg, dict) else []
        if isinstance(relay_order, list):
            for p_name in relay_order:
                p = str(p_name or "").strip()
                if not p or p in provider_candidates:
                    continue
                if _adapter_relay_enabled_with_web_search(p):
                    provider_candidates.append(p)

        if websearch_model and websearch_model in models_map:
            wp = str(models_map.get(websearch_model, {}).get("provider", "") or "").strip()
            if wp and wp not in provider_candidates and _adapter_relay_enabled_with_web_search(wp):
                provider_candidates.append(wp)

        all_adapters = runtime_cfg.get("providers", {}) if isinstance(runtime_cfg, dict) else {}
        if isinstance(all_adapters, dict):
            for p_name in all_adapters.keys():
                p = str(p_name or "").strip()
                if not p or p in provider_candidates:
                    continue
                if _adapter_relay_enabled_with_web_search(p):
                    provider_candidates.append(p)

        def _normalize_tool_list(raw_tools: Any) -> List[Dict[str, Any]]:
            out = []
            if not isinstance(raw_tools, list):
                return out
            for t in raw_tools:
                if not isinstance(t, dict):
                    continue
                t_type = str(t.get("type", "")).strip()
                if not t_type:
                    continue
                out.append(json.loads(json.dumps(t)))
            return out

        def _get_req_opt_headers(req_opts: Dict[str, Any]) -> Dict[str, str]:
            if not isinstance(req_opts, dict):
                return {}
            raw = req_opts.get("extra_headers", req_opts.get("extra_head"))
            if not isinstance(raw, dict):
                return {}
            headers = {}
            for k, v in raw.items():
                key = str(k or "").strip()
                if not key:
                    continue
                headers[key] = str(v if v is not None else "")
            return headers

        def _build_relay_tools(provider_name: str, req_opts: Dict[str, Any], mode: str) -> List[Dict[str, Any]]:
            adapter = self._get_provider_search_adapter(provider_name)
            adapter_tools = _normalize_tool_list(adapter.get("tools", []) if isinstance(adapter, dict) else [])

            tools = []
            if mode == "responses":
                tools = _normalize_tool_list(req_opts.get("responses_tools"))
                if not tools:
                    tools = _normalize_tool_list(req_opts.get("tools"))
                if not tools:
                    tools = adapter_tools
                if not tools:
                    tools = [{"type": "web_search"}]
            else:
                tools = _normalize_tool_list(req_opts.get("chat_tools"))
                if not tools and self._as_bool(req_opts.get("chat_use_adapter_tools", False), default=False):
                    tools = adapter_tools
                if not tools and self._as_bool(req_opts.get("chat_use_default_web_search_tool", False), default=False):
                    tools = [{"type": "web_search"}]

            # 将工具参数透传到 web_search 工具项
            for t in tools:
                if str(t.get("type", "")).strip() != "web_search":
                    continue
                for key in ("limit", "sources", "user_location"):
                    if key in args and args.get(key) is not None:
                        t[key] = args.get(key)
            return tools

        def _build_relay_extra_body(req_opts: Dict[str, Any], mode: str) -> Dict[str, Any]:
            extra_body = {}
            base_extra = req_opts.get("extra_body")
            if isinstance(base_extra, dict):
                extra_body.update(json.loads(json.dumps(base_extra)))

            mode_key = "responses_extra_body" if mode == "responses" else "chat_extra_body"
            mode_extra = req_opts.get(mode_key)
            if isinstance(mode_extra, dict):
                extra_body.update(json.loads(json.dumps(mode_extra)))

            if "enable_thinking" in req_opts:
                extra_body["enable_thinking"] = self._as_bool(req_opts.get("enable_thinking"), default=True)

            # 阿里云 chat/completions 主要依赖 enable_search；其余 provider 即使忽略该字段也不会报错
            if mode == "chat_completions":
                extra_body["enable_search"] = self._as_bool(req_opts.get("enable_search", True), default=True)
                search_options = req_opts.get("search_options")
                if isinstance(search_options, dict) and search_options:
                    extra_body["search_options"] = json.loads(json.dumps(search_options))
            else:
                if "enable_search" in req_opts:
                    extra_body["enable_search"] = self._as_bool(req_opts.get("enable_search"), default=True)
                search_options = req_opts.get("search_options")
                if isinstance(search_options, dict) and search_options:
                    extra_body["search_options"] = json.loads(json.dumps(search_options))
            return extra_body

        def _build_relay_debug(
            provider_name: str,
            model_id: str,
            mode: str,
            tools: List[Dict[str, Any]],
            extra_body: Dict[str, Any],
            extra_headers: Dict[str, str]
        ) -> Dict[str, Any]:
            return {
                "provider": provider_name,
                "model": model_id,
                "api_mode": mode,
                "tools": _ensure_json_serializable(tools),
                "extra_body": _ensure_json_serializable(extra_body),
                "extra_headers_keys": sorted(list(extra_headers.keys()))
            }

        def _call_volcengine(provider_name: str, model_id: str) -> Dict[str, Any]:
            client = self._get_provider_client_for_search(provider_name)
            req_opts = self._get_provider_request_options(provider_name)
            tools = _build_relay_tools(provider_name, req_opts, "responses")
            extra_body = _build_relay_extra_body(req_opts, "responses")
            extra_headers = _get_req_opt_headers(req_opts)

            payload = {
                "model": model_id,
                "input": [
                    {"role": "system", "content": [{"type": "input_text", "text": self._get_default_web_search_prompt()}]},
                    {"role": "user", "content": [{"type": "input_text", "text": query}]}
                ],
                "tools": tools,
                "stream": False
            }
            if extra_body:
                payload["extra_body"] = extra_body
            if extra_headers:
                payload["extra_headers"] = extra_headers

            response = client.responses.create(**payload)
            out = self._extract_responses_search_payload(response)
            out["_relay_debug"] = _build_relay_debug(
                provider_name=provider_name,
                model_id=model_id,
                mode="responses",
                tools=tools,
                extra_body=extra_body,
                extra_headers=extra_headers
            )
            return out

        def _call_aliyun(provider_name: str, model_id: str) -> Dict[str, Any]:
            client = self._get_provider_client_for_search(provider_name)
            req_opts = self._get_provider_request_options(provider_name)
            search_api = str(
                req_opts.get("search_api", req_opts.get("api_mode", "chat_completions"))
            ).strip().lower()

            # 方式A: Responses API + tools
            if search_api in {"responses", "responses_api", "openai_responses"}:
                try:
                    mode = "responses"
                    tools = _build_relay_tools(provider_name, req_opts, mode)
                    extra_body = _build_relay_extra_body(req_opts, mode)
                    extra_headers = _get_req_opt_headers(req_opts)

                    payload = {
                        "model": model_id,
                        "input": [
                            {"role": "system", "content": [{"type": "input_text", "text": self._get_default_web_search_prompt()}]},
                            {"role": "user", "content": [{"type": "input_text", "text": query}]}
                        ],
                        "tools": tools,
                        "stream": False
                    }
                    if extra_body:
                        payload["extra_body"] = extra_body
                    if extra_headers:
                        payload["extra_headers"] = extra_headers

                    response = client.responses.create(**payload)
                    out = self._extract_responses_search_payload(response)
                    out["_relay_debug"] = _build_relay_debug(
                        provider_name=provider_name,
                        model_id=model_id,
                        mode=mode,
                        tools=tools,
                        extra_body=extra_body,
                        extra_headers=extra_headers
                    )
                    return out
                except Exception as resp_err:
                    if not self._as_bool(req_opts.get("responses_fallback_to_chat", True), default=True):
                        raise resp_err
                    print(f"[SEARCH][Aliyun] Responses search failed, fallback to chat.completions: {resp_err}")

            # 方式B: Chat Completions + extra_body.enable_search
            mode = "chat_completions"
            extra_body = _build_relay_extra_body(req_opts, mode)
            extra_headers = _get_req_opt_headers(req_opts)
            tools = _build_relay_tools(provider_name, req_opts, mode)

            payload = {
                "model": model_id,
                "messages": [
                    {"role": "system", "content": self._get_default_web_search_prompt()},
                    {"role": "user", "content": query}
                ],
                "stream": False
            }
            if extra_body:
                payload["extra_body"] = extra_body
            if extra_headers:
                payload["extra_headers"] = extra_headers
            sent_tools = []
            # 默认带上 search_adapters 中的 tools；如需关闭可设置 chat_send_tools=false
            send_tools_in_chat = self._as_bool(req_opts.get("chat_send_tools", True), default=True)
            if tools and send_tools_in_chat:
                payload["tools"] = tools
                sent_tools = tools

            try:
                response = client.chat.completions.create(**payload)
            except Exception as chat_err:
                fallback_no_tools = self._as_bool(req_opts.get("chat_tools_fallback_to_no_tools", True), default=True)
                if ("tools" in payload) and fallback_no_tools:
                    print(f"[SEARCH][Aliyun] chat.completions with tools failed, retry without tools: {chat_err}")
                    payload.pop("tools", None)
                    sent_tools = []
                    response = client.chat.completions.create(**payload)
                else:
                    raise
            text = ""
            try:
                text = str(response.choices[0].message.content or "").strip()
            except Exception:
                text = ""
            return {
                "text": text,
                "references": [],
                "_relay_debug": _build_relay_debug(
                    provider_name=provider_name,
                    model_id=model_id,
                    mode=mode,
                    tools=sent_tools,
                    extra_body=extra_body,
                    extra_headers=extra_headers
                )
            }

        last_err = None
        chosen_provider = ""
        chosen_model = ""
        payload = None
        for provider_name in provider_candidates:
            model_id = _pick_model_for_provider(provider_name)
            if not model_id:
                continue
            try:
                if provider_name == "volcengine":
                    payload = _call_volcengine(provider_name, model_id)
                elif provider_name == "aliyun":
                    payload = _call_aliyun(provider_name, model_id)
                else:
                    raise ValueError(f"provider {provider_name} 暂不支持本地 web_search 中转")
                chosen_provider = provider_name
                chosen_model = model_id
                break
            except Exception as e:
                last_err = e
                continue

        if not payload:
            if last_err:
                raise ValueError(f"未找到可用的联网搜索 provider，最后一次错误: {last_err}")
            raise ValueError("未找到可用的联网搜索 provider（请检查 search_adapters 与模型映射）")

        search_result = str(payload.get("text", "") or "").strip()
        references = payload.get("references", [])
        references = references if isinstance(references, list) else []
        relay_debug = payload.get("_relay_debug", {})
        if not isinstance(relay_debug, dict):
            relay_debug = {}

        if not search_result:
            search_result = "联网搜索成功，但模型未返回可解析的正文内容。"

        if references:
            seen = set()
            ref_lines = []
            for ref in references:
                title = str((ref or {}).get("title", "") or "来源").strip()
                url = str((ref or {}).get("url", "") or "").strip()
                if not url:
                    continue
                key = (title, url)
                if key in seen:
                    continue
                seen.add(key)
                ref_lines.append(f"- {title}: {url}")
            if ref_lines:
                search_result = f"{search_result}\n\n参考来源:\n" + "\n".join(ref_lines)

        caller_provider = str(getattr(self, "provider", "") or "")
        caller_model = str(getattr(self, "model_name", "") or "")
        relay_api_mode = str(relay_debug.get("api_mode", "") or "")
        relay_tools_count = len(relay_debug.get("tools", []) or [])
        relay_extra_keys = []
        if isinstance(relay_debug.get("extra_body"), dict):
            relay_extra_keys = sorted(list(relay_debug.get("extra_body", {}).keys()))
        relay_header_keys = relay_debug.get("extra_headers_keys", [])
        relay_header_keys = relay_header_keys if isinstance(relay_header_keys, list) else []

        print(
            f"[SEARCH][RELAY] provider={chosen_provider} model={chosen_model} mode={relay_api_mode} "
            f"tools={relay_tools_count} extra_body_keys={relay_extra_keys} extra_headers_keys={relay_header_keys}"
        )
        return (
            f"联网搜索结果 for '{query}':\n\n{search_result}\n\n"
            f"(adapter=local-relay, provider={chosen_provider}, model={chosen_model}, "
            f"caller_provider={caller_provider}, caller_model={caller_model}, "
            f"relay_api={relay_api_mode or 'unknown'}, relay_tools={relay_tools_count}, "
            f"relay_extra_body_keys={','.join(relay_extra_keys) if relay_extra_keys else '-'}, "
            f"relay_extra_headers_keys={','.join(relay_header_keys) if relay_header_keys else '-'})"
        )

    def _render_prompt_template(self, text: Any) -> str:
        """
        Render prompt template variables:
        - {{model_name}}: display model name from config models.<id>.name
        - {{model_id}}: runtime model id used for API call
        - {{user}}: current username
        - {{provider}} / {{provider_id}}: provider id
        - {{provider_name}}: provider display name (fallback to provider id)
        """
        s = str(text or "")
        mapping = {
            "model_name": str(getattr(self, "model_display_name", self.model_name) or self.model_name),
            "model_id": str(self.model_name or ""),
            "user": str(self.username or ""),
            "provider": str(getattr(self, "provider", "") or ""),
            "provider_id": str(getattr(self, "provider", "") or ""),
            "provider_name": str(getattr(self, "provider_display_name", getattr(self, "provider", "")) or getattr(self, "provider", "")),
        }

        def repl(match):
            key = (match.group(1) or "").strip()
            return mapping.get(key, match.group(0))

        return re.sub(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", repl, s)

    def _estimate_token_count(self, text: str) -> int:
        """估算 token 数（当 provider 不返回 usage 时的兜底）"""
        if not text:
            return 0
        try:
            s = str(text)
            cjk = 0
            for ch in s:
                if '\u4e00' <= ch <= '\u9fff':
                    cjk += 1
            other = max(0, len(s) - cjk)
            # 经验估算：中文约 1.6 token/字，其他字符约 1 token/4字符
            est = int(cjk * 1.6 + other / 4.0)
            return max(1, est)
        except Exception:
            return max(1, len(str(text)) // 4)

    def _prefix_suffix_overlap(self, previous: str, current: str, max_window: int = 12000) -> int:
        """计算 previous 后缀与 current 前缀的最大重叠长度，用于跨轮去重。"""
        prev = str(previous or "")
        cur = str(current or "")
        if not prev or not cur:
            return 0
        max_len = min(len(prev), len(cur), int(max_window or 12000))
        if max_len <= 0:
            return 0
        prev_tail = prev[-max_len:]
        for k in range(max_len, 0, -1):
            if prev_tail[-k:] == cur[:k]:
                return k
        return 0

    def _get_nexora_mail_config(self) -> Dict[str, Any]:
        """读取 NexoraMail 集成配置"""
        mail_cfg = CONFIG.get("nexora_mail", {}) if isinstance(CONFIG, dict) else {}
        host = str(mail_cfg.get("host", "127.0.0.1")).strip() or "127.0.0.1"
        port_raw = mail_cfg.get("port", 17171)
        try:
            port = int(port_raw)
        except Exception:
            port = 17171

        service_url = str(mail_cfg.get("service_url", "") or "").strip()
        if not service_url:
            service_url = f"http://{host}:{port}"

        timeout_raw = mail_cfg.get("timeout", 10)
        try:
            timeout = int(timeout_raw)
        except Exception:
            timeout = 10
        timeout = max(1, timeout)

        send_timeout_raw = mail_cfg.get("send_timeout", 120)
        try:
            send_timeout = int(send_timeout_raw)
        except Exception:
            send_timeout = 120
        send_timeout = max(1, send_timeout)

        return {
            "enabled": bool(mail_cfg.get("nexora_mail_enabled", False)),
            "host": host,
            "port": port,
            "service_url": service_url.rstrip("/"),
            "api_key": str(mail_cfg.get("api_key", "") or "").strip(),
            "timeout": timeout,
            "send_timeout": send_timeout,
            "default_group": str(mail_cfg.get("default_group", "default") or "default").strip() or "default",
        }

    def _nexora_mail_call(
        self,
        path: str,
        method: str = "GET",
        payload: Optional[Dict[str, Any]] = None,
        query: Optional[Dict[str, Any]] = None,
        timeout: Optional[int] = None
    ):
        """调用 NexoraMail API，返回 (ok, status, data)"""
        cfg = self._get_nexora_mail_config()
        if not cfg.get("enabled"):
            return False, 503, {"success": False, "message": "NexoraMail disabled"}

        q = ""
        if query and isinstance(query, dict):
            pairs = []
            for k, v in query.items():
                if v is None:
                    continue
                pairs.append((k, str(v)))
            if pairs:
                q = "?" + urllib_parse.urlencode(pairs)

        url = f"{cfg['service_url']}{path}{q}"
        headers = {"Accept": "application/json"}
        if cfg.get("api_key"):
            headers["X-API-Key"] = cfg["api_key"]

        body = None
        if payload is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        req = urllib_request.Request(url, data=body, method=str(method or "GET").upper(), headers=headers)
        request_timeout = int(timeout) if timeout is not None else int(cfg["timeout"])
        if request_timeout <= 0:
            request_timeout = int(cfg["timeout"])
        try:
            with urllib_request.urlopen(req, timeout=request_timeout) as resp:
                status = int(getattr(resp, "status", 200) or 200)
                raw = resp.read().decode("utf-8", errors="replace")
                data = {}
                if raw.strip():
                    try:
                        data = json.loads(raw)
                    except Exception:
                        data = {"success": 200 <= status < 300, "raw": raw}
                if not isinstance(data, dict):
                    data = {"success": 200 <= status < 300}
                if "success" not in data:
                    data["success"] = 200 <= status < 300
                return 200 <= status < 300, status, data
        except urllib_error.HTTPError as e:
            status = int(getattr(e, "code", 500) or 500)
            try:
                raw = e.read().decode("utf-8", errors="replace")
                data = json.loads(raw) if raw.strip() else {}
            except Exception:
                data = {}
            if not isinstance(data, dict):
                data = {}
            if "message" not in data:
                data["message"] = f"NexoraMail HTTP {status}"
            data["success"] = False
            return False, status, data
        except Exception as e:
            return False, 502, {"success": False, "message": f"NexoraMail connect failed: {str(e)}"}

    def _resolve_local_mail_binding(self):
        """解析当前用户绑定的本地邮箱账号"""
        users_path = os.path.join(os.path.dirname(CONFIG_PATH), "data", "user.json")
        if not os.path.exists(users_path):
            return None, "user database not found"

        try:
            with open(users_path, "r", encoding="utf-8") as f:
                users = json.load(f)
        except Exception as e:
            return None, f"failed to read user database: {str(e)}"

        user = users.get(self.username)
        if not isinstance(user, dict):
            return None, "current user not found"

        local_mail = user.get("local_mail", {}) if isinstance(user.get("local_mail"), dict) else {}
        mail_username = str(local_mail.get("username", "") or "").strip()
        if not mail_username:
            return None, "local mail account is not bound for current user"

        cfg = self._get_nexora_mail_config()
        group = str(local_mail.get("group") or cfg.get("default_group") or "default").strip() or "default"
        return {
            "group": group,
            "mail_username": mail_username,
            "local_mail": local_mail,
        }, None

    def _get_nexora_mail_primary_domain(self, group_name: str) -> Optional[str]:
        ok, _, data = self._nexora_mail_call("/api/groups", method="GET")
        if not ok or not isinstance(data, dict):
            return None
        groups = data.get("groups", [])
        if not isinstance(groups, list):
            return None
        target = str(group_name or "").strip()
        for item in groups:
            if not isinstance(item, dict):
                continue
            if str(item.get("group") or "").strip() != target:
                continue
            domains = item.get("domains", [])
            if isinstance(domains, list):
                for d in domains:
                    domain = str(d or "").strip()
                    if domain:
                        return domain
        return None

    def _build_nexora_sender_address(self, mail_username: str, group_name: str) -> str:
        local = str(mail_username or "").strip()
        if "@" in local:
            local = local.split("@", 1)[0].strip()
        if not local:
            return ""

        cfg = self._get_nexora_mail_config()
        domain = self._get_nexora_mail_primary_domain(group_name) or cfg.get("host") or "localhost"
        domain = str(domain).strip() or "localhost"
        return f"{local}@{domain}"

    def _decode_literal_unicode_escapes(self, text: Any) -> str:
        """
        Decode literal unicode escapes that may come from LLM tool arguments, e.g.
        '\\\\u4f60\\\\u597d' or '\\\\U0001f464' -> actual characters.
        Keep normal text unchanged.
        """
        s = str(text or "")
        if ("\\" not in s) or ("\\u" not in s and "\\U" not in s and "\\x" not in s):
            return s

        # Handle surrogate pairs first: \uD83D\uDC64 -> 😀-style codepoint
        def repl_surrogate_pair(m):
            hi = int(m.group(1), 16)
            lo = int(m.group(2), 16)
            codepoint = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
            try:
                return chr(codepoint)
            except Exception:
                return m.group(0)

        out = re.sub(
            r"\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][cdefCDEF][0-9a-fA-F]{2})",
            repl_surrogate_pair,
            s,
        )

        def repl_u8(m):
            try:
                return chr(int(m.group(1), 16))
            except Exception:
                return m.group(0)

        def repl_u4(m):
            try:
                cp = int(m.group(1), 16)
                # Skip lone surrogates (already handled above).
                if 0xD800 <= cp <= 0xDFFF:
                    return m.group(0)
                return chr(cp)
            except Exception:
                return m.group(0)

        def repl_x2(m):
            try:
                return chr(int(m.group(1), 16))
            except Exception:
                return m.group(0)

        out = re.sub(r"\\U([0-9a-fA-F]{8})", repl_u8, out)
        out = re.sub(r"\\u([0-9a-fA-F]{4})", repl_u4, out)
        out = re.sub(r"\\x([0-9a-fA-F]{2})", repl_x2, out)
        return out

    def _garbled_score_text(self, text: Any) -> int:
        s = str(text or "")
        if not s:
            return 0
        suspicious = ("鎴", "馃", "锛", "锟", "�", "鏄", "鍐", "涓", "鐨")
        score = 0
        for token in suspicious:
            score += s.count(token)
        return score

    def _repair_common_mojibake(self, text: Any) -> str:
        """
        Repair common UTF-8<->GBK mojibake in short text (mainly subject lines).
        """
        src = str(text or "")
        if not src:
            return src
        best = src
        best_score = self._garbled_score_text(src)
        for enc in ("gb18030", "gbk"):
            try:
                cand = src.encode(enc, errors="strict").decode("utf-8", errors="strict")
            except Exception:
                continue
            cand_score = self._garbled_score_text(cand)
            if cand_score < best_score:
                best = cand
                best_score = cand_score
        return best

    def _build_utf8_raw_mail(self, sender: str, recipient: str, subject: str, content: str, is_html: bool) -> str:
        """Build MIME raw email with UTF-8-safe headers/body."""
        ctype = "text/html" if is_html else "text/plain"
        subject_header = Header(subject or "", "utf-8").encode()
        body_bytes = str(content or "").encode("utf-8", errors="replace")
        body_b64 = base64.b64encode(body_bytes).decode("ascii")
        body_lines = "\r\n".join(textwrap.wrap(body_b64, 76)) if body_b64 else ""
        return (
            f"From: <{sender}>\r\n"
            f"To: <{recipient}>\r\n"
            f"Subject: {subject_header}\r\n"
            "MIME-Version: 1.0\r\n"
            f"Content-Type: {ctype}; charset=\"UTF-8\"\r\n"
            "Content-Transfer-Encoding: base64\r\n"
            "\r\n"
            f"{body_lines}\r\n"
        )

    def _tool_send_email(self, args: Dict[str, Any]) -> str:
        """sendEMail 工具执行入口"""
        cfg = self._get_nexora_mail_config()
        if not cfg.get("enabled"):
            return "发送失败：NexoraMail 未启用"

        recipient = str(args.get("recipient") or args.get("to") or "").strip()
        subject = str(args.get("subject") or "").strip() or "(No Subject)"
        content = args.get("content")
        knowledge_title = str(args.get("knowledge_title") or "").strip()
        is_html = bool(args.get("is_html", False))

        if not recipient:
            return "发送失败：缺少 recipient"

        if (content is None or str(content).strip() == "") and knowledge_title:
            try:
                content = self.user.getBasisContent(knowledge_title)
            except Exception as e:
                return f"发送失败：读取知识内容失败 ({str(e)})"
            if not subject or subject == "(No Subject)":
                subject = f"[Knowledge] {knowledge_title}"

        if content is None:
            content = ""
        content = str(content)

        # Normalize escaped unicode from tool-argument text, e.g. "\U0001f464"
        subject = self._decode_literal_unicode_escapes(subject)
        content = self._decode_literal_unicode_escapes(content)
        subject = self._repair_common_mojibake(subject)

        if not content.strip():
            return "发送失败：缺少 content（可提供 content 或 knowledge_title）"

        binding, bind_err = self._resolve_local_mail_binding()
        if bind_err:
            return f"发送失败：{bind_err}"

        sender = self._build_nexora_sender_address(binding["mail_username"], binding["group"])
        if not sender:
            return "发送失败：无法生成发件地址"

        send_body = {
            "group": binding["group"],
            "sender": sender,
            "recipient": recipient,
            "subject": subject,
            "raw": self._build_utf8_raw_mail(
                sender=sender,
                recipient=recipient,
                subject=subject,
                content=content,
                is_html=is_html,
            ),
        }

        ok, status, data = self._nexora_mail_call(
            "/api/send",
            method="POST",
            payload=send_body,
            timeout=int(cfg.get("send_timeout", cfg.get("timeout", 10))),
        )
        if not ok:
            message = data.get("message") if isinstance(data, dict) else ""
            return f"发送失败：{message or f'NexoraMail HTTP {status}'}"

        return f"邮件发送成功：{sender} -> {recipient}，主题：{subject}"

    def _tool_get_email_list(self, args: Dict[str, Any]) -> str:
        """getEMailList 工具执行入口"""
        cfg = self._get_nexora_mail_config()
        if not cfg.get("enabled"):
            return "获取失败：NexoraMail 未启用"

        binding, bind_err = self._resolve_local_mail_binding()
        if bind_err:
            return f"获取失败：{bind_err}"

        group = str(binding.get("group") or "default").strip() or "default"
        username = str(binding.get("mail_username") or "").strip()
        if not username:
            return "获取失败：未绑定本地邮箱用户名"

        q = str(args.get("query") or "").strip()
        try:
            mail_list_type = int(args.get("type", 1) or 1)
        except Exception:
            mail_list_type = 1
        if mail_list_type not in (0, 1):
            mail_list_type = 1
        try:
            date_range_days = int(args.get("date_range", 15) or 15)
        except Exception:
            date_range_days = 15
        # 默认最近15天；允许显式传 <=0 表示不限制
        if date_range_days < 0:
            date_range_days = 15
        try:
            offset = max(int(args.get("offset", 0) or 0), 0)
        except Exception:
            offset = 0
        try:
            limit = int(args.get("limit", 20) or 20)
        except Exception:
            limit = 20
        limit = min(max(limit, 1), 100)

        path = f"/api/mailboxes/{urllib_parse.quote(group)}/{urllib_parse.quote(username)}/mails"
        query = {"offset": offset, "limit": limit}
        if q:
            query["q"] = q

        ok, status, data = self._nexora_mail_call(path, method="GET", query=query)
        if not ok:
            msg = data.get("message") if isinstance(data, dict) else ""
            return f"获取失败：{msg or f'NexoraMail HTTP {status}'}"

        source_mails = data.get("mails") or []

        def _resolve_mail_timestamp(mail_item: Dict[str, Any]) -> int:
            """优先用 timestamp；缺失时解析 date 字段（兼容 RFC822 / 普通日期字符串）。"""
            try:
                ts = int(mail_item.get("timestamp", 0) or 0)
            except Exception:
                ts = 0
            if ts > 0:
                return ts

            date_text_raw = str(mail_item.get("date") or "").strip()
            if not date_text_raw:
                return 0
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    return int(datetime.strptime(date_text_raw, fmt).timestamp())
                except Exception:
                    pass
            try:
                return int(parsedate_to_datetime(date_text_raw).timestamp())
            except Exception:
                return 0

        if date_range_days > 0:
            cutoff_ts = int(time.time()) - int(date_range_days) * 86400
            source_mails = [
                m for m in source_mails
                if isinstance(m, dict) and _resolve_mail_timestamp(m) >= cutoff_ts
            ]
        if mail_list_type == 0:
            source_mails = [m for m in source_mails if isinstance(m, dict) and not bool(m.get("is_read", False))]

        mails = []
        for m in source_mails:
            if not isinstance(m, dict):
                continue
            ts = int(m.get("timestamp", 0) or 0)
            date_text = str(m.get("date") or "").strip()
            if not date_text and ts > 0:
                try:
                    date_text = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    date_text = ""
            mails.append(
                {
                    "id": str(m.get("id") or ""),
                    "title": str(m.get("subject") or ""),
                    "sender": str(m.get("sender") or ""),
                    "date": date_text,
                }
            )

        payload = {
            "success": True,
            "group": group,
            "username": username,
            "type": mail_list_type,
            "date_range": date_range_days,
            "total": len(mails),
            "offset": int(data.get("offset", offset) or offset),
            "limit": int(data.get("limit", limit) or limit),
            "mails": mails,
        }
        return json.dumps(payload, ensure_ascii=False)

    def _tool_get_email(self, args: Dict[str, Any]) -> str:
        """getEMail 工具执行入口"""
        cfg = self._get_nexora_mail_config()
        if not cfg.get("enabled"):
            return "获取失败：NexoraMail 未启用"

        mail_id = str(args.get("mail_id") or "").strip()
        if not mail_id:
            return "获取失败：缺少 mail_id"

        binding, bind_err = self._resolve_local_mail_binding()
        if bind_err:
            return f"获取失败：{bind_err}"

        group = str(binding.get("group") or "default").strip() or "default"
        username = str(binding.get("mail_username") or "").strip()
        if not username:
            return "获取失败：未绑定本地邮箱用户名"

        path = f"/api/mailboxes/{urllib_parse.quote(group)}/{urllib_parse.quote(username)}/mails/{urllib_parse.quote(mail_id)}"
        ok, status, data = self._nexora_mail_call(path, method="GET")
        if not ok:
            msg = data.get("message") if isinstance(data, dict) else ""
            return f"获取失败：{msg or f'NexoraMail HTTP {status}'}"

        mail = data.get("mail") if isinstance(data, dict) else None
        if not isinstance(mail, dict):
            return "获取失败：邮件不存在或格式异常"

        try:
            content_type = int(args.get("content_type", 0) or 0)  # 0: extracted, 1: all
        except Exception:
            content_type = 0
        if content_type not in (0, 1):
            content_type = 0

        raw_truncate = args.get("truncate", True)
        if isinstance(raw_truncate, bool):
            truncate_enabled = raw_truncate
        elif isinstance(raw_truncate, str):
            truncate_enabled = raw_truncate.strip().lower() in ("1", "true", "yes", "y", "on")
        elif isinstance(raw_truncate, (int, float)):
            truncate_enabled = bool(raw_truncate)
        else:
            truncate_enabled = True

        try:
            max_chars = int(args.get("max_chars", 12000) or 12000)
        except Exception:
            max_chars = 12000
        max_chars = min(max(max_chars, 500), 50000)

        def _truncate_text(text: Any, hint: str = "内容"):
            s = str(text or "")
            if not truncate_enabled:
                return s, False
            if len(s) <= max_chars:
                return s, False
            return s[:max_chars] + f"\n\n...[{hint}过长已截断，共{len(s)}字符，当前保留{max_chars}字符]...", True

        text_body_raw = str(mail.get("content_text") or "")
        html_body_raw = str(mail.get("content_html") or "")
        raw_body_raw = str(mail.get("content") or "")

        text_body, text_truncated = _truncate_text(text_body_raw, "文本")
        html_body, html_truncated = _truncate_text(html_body_raw, "HTML")
        raw_body, raw_truncated = _truncate_text(raw_body_raw, "原始邮件")

        payload = {
            "success": True,
            "group": group,
            "username": username,
            "mail": {
                "id": str(mail.get("id") or mail_id),
                "subject": str(mail.get("subject") or ""),
                "sender": str(mail.get("sender") or ""),
                "recipient": str(mail.get("recipient") or ""),
                "date": str(mail.get("date") or ""),
                "timestamp": int(mail.get("timestamp", 0) or 0),
                "is_read": bool(mail.get("is_read", False)),
                "size": int(mail.get("size", 0) or 0),
                "preview_text": str(mail.get("preview_text") or ""),
                "content_type": content_type,
                "truncate": bool(truncate_enabled),
                "max_chars": int(max_chars),
            },
        }

        if content_type == 0:
            # 轻量模式：只返回提取文本
            payload["mail"]["content_text"] = text_body
            payload["mail"]["truncated"] = bool(text_truncated)
        else:
            # 完整模式：返回提取文本 + HTML + 原始内容
            payload["mail"]["content_text"] = text_body
            payload["mail"]["content_html"] = html_body
            payload["mail"]["content_raw"] = raw_body
            payload["mail"]["truncated"] = bool(text_truncated or html_truncated or raw_truncated)
            payload["mail"]["truncate_details"] = {
                "content_text": bool(text_truncated),
                "content_html": bool(html_truncated),
                "content_raw": bool(raw_truncated),
            }
        return json.dumps(payload, ensure_ascii=False)

    def _parse_tools(self, tools_config: List[Dict]) -> List[Dict]:
        """解析工具定义为API格式 - 兼容不同供应商"""
        parsed_tools = []
        rag_cfg = CONFIG.get("rag_database", {}) if isinstance(CONFIG, dict) else {}
        rag_enabled = bool(rag_cfg.get("rag_database_enabled", False))
        mail_cfg = CONFIG.get("nexora_mail", {}) if isinstance(CONFIG, dict) else {}
        mail_enabled = bool(mail_cfg.get("nexora_mail_enabled", False))

        provider = getattr(self, 'provider', 'volcengine')
        use_responses_api = self._provider_use_responses_api(provider)

        # 1) 优先注入 provider 级 native tools（由 search_adapters.json 驱动）
        if getattr(self, "native_search_tools", None):
            for native_tool in self.native_search_tools:
                if use_responses_api:
                    # Responses API 可直接使用 native tools
                    parsed_tools.append(native_tool)
                else:
                    # Chat Completions：仅注入 function 类型，native 搜索走 provider 专属参数
                    if str(native_tool.get("type", "")).strip() == "function":
                        parsed_tools.append(native_tool)
        
        # 2) 解析自定义 function 工具
        for tool in tools_config:
            if tool["type"] == "function":
                func_def = tool["function"]
                if func_def.get("name") == "vectorSearch" and not rag_enabled:
                    continue
                if func_def.get("name") in ["sendEMail", "getEMail", "getEMailList"] and not mail_enabled:
                    continue
                                
                # provider 已具备可直连的 native 搜索能力时，隐藏本地中转 relay_web_search/searchOnline。
                # 当前已接入直连路径：volcengine(原生 web_search tool)、aliyun(extra_body.enable_search)。
                if (
                    func_def["name"] in ["searchOnline", "relay_web_search"]
                    and self.provider in {"volcengine", "aliyun"}
                    and bool(getattr(self, "native_web_search_enabled", False))
                ):
                     continue
                
                if use_responses_api:
                    # Responses API 使用扁平结构
                    parsed_tools.append({
                        "type": "function",
                        "name": func_def["name"],
                        "description": func_def["description"],
                        "parameters": func_def.get("parameters", {})
                    })
                else:
                    # 标准 OpenAI 格式 (Stepfun 等)
                    parsed_tools.append({
                        "type": "function",
                        "function": {
                            "name": func_def["name"],
                            "description": func_def["description"],
                            "parameters": func_def.get("parameters", {})
                        }
                    })
        return parsed_tools
    
    def _execute_function(self, function_name: str, arguments: str) -> str:
        """
        执行函数调用
        
        Args:
            function_name: 函数名
            arguments: 参数JSON字符串或字典
            
        Returns:
            函数执行结果字符串
        """
        start_ts = time.time()
        args = {}
        try:
            # 解析参数
            if isinstance(arguments, str):
                args = json.loads(arguments)
            else:
                args = arguments
            
            # 参数幻觉检测（Deepseek R1问题）
            # 检测类似 city: get_location() 的嵌套函数调用模式
            # 但要排除正常文本中的括号（如中文全角括号、Markdown等）
            for key, value in args.items():
                if isinstance(value, str):
                    # 更精确的检测：函数调用通常是 functionName(...) 的形式
                    # 且前面没有其他字符，后面紧跟括号
                    import re
                    # 匹配函数调用模式：字母开头，后跟字母数字下划线，然后是括号
                    if re.search(r'\b[a-zA-Z_][a-zA-Z0-9_]*\s*\(', value):
                        # 进一步检查：如果包含中文或大量文本，很可能是正常内容
                        if len(value) < 100 and not re.search(r'[\u4e00-\u9fff]', value):
                            msg = f"错误：参数 '{key}' 的值似乎是嵌套函数调用 '{value[:50]}'。请先单独调用该函数获取结果。"
                            self._log_tool_usage(function_name, args, msg, False, start_ts)
                            return msg
            
            # 执行函数
            raw_result = self._execute_function_impl(function_name, args)
            
            # [TOKEN 优化] 智能脱水处理
            result = self._sanitize_function_result(raw_result, function_name)
            success = self._infer_tool_success(result)
            self._log_tool_usage(function_name, args, result, success, start_ts)
            return result
            
        except json.JSONDecodeError as e:
            msg = f"错误：参数JSON解析失败 - {str(e)}"
            self._log_tool_usage(function_name, args, msg, False, start_ts)
            return msg
        except Exception as e:
            msg = f"错误：{str(e)}"
            self._log_tool_usage(function_name, args, msg, False, start_ts)
            return msg

    def _infer_tool_success(self, result: Any) -> bool:
        """根据工具返回文本做轻量成功率判定（无异常但业务失败也计失败）。"""
        text = str(result or "").strip()
        if not text:
            return True
        low = text.lower()
        fail_markers = [
            "错误", "失败", "not found", "invalid", "missing", "exception", "traceback"
        ]
        return not any(m in low for m in fail_markers)

    def _log_tool_usage(
        self,
        tool_name: str,
        args: Dict[str, Any],
        result: Any,
        success: bool,
        start_ts: float
    ) -> None:
        """记录工具调用日志，供管理端统计工具成功率与耗时。"""
        try:
            user_path = getattr(self.user, "path", "")
            if not user_path:
                return
            os.makedirs(user_path, exist_ok=True)
            log_path = os.path.join(user_path, "tool_usage.json")

            now = datetime.now()
            duration_ms = max(0, int((time.time() - float(start_ts)) * 1000))
            result_text = str(result or "")
            args_json = ""
            try:
                args_json = json.dumps(args if isinstance(args, dict) else {}, ensure_ascii=False)
            except Exception:
                args_json = "{}"

            entry = {
                "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
                "conversation_id": str(self.conversation_id or ""),
                "tool_name": str(tool_name or ""),
                "success": bool(success),
                "duration_ms": duration_ms,
                "provider": str(getattr(self, "provider", "") or ""),
                "model": str(getattr(self, "model_name", "") or ""),
                "username": str(self.username or ""),
                "args_size": len(args_json),
                "result_size": len(result_text),
                "error_message": "" if success else result_text[:300],
            }

            with _TOOL_USAGE_LOG_LOCK:
                logs = []
                if os.path.exists(log_path):
                    try:
                        with open(log_path, "r", encoding="utf-8") as f:
                            logs = json.load(f)
                    except Exception:
                        logs = []
                if not isinstance(logs, list):
                    logs = []
                logs.insert(0, entry)
                if len(logs) > 5000:
                    logs = logs[:5000]
                with open(log_path, "w", encoding="utf-8") as f:
                    json.dump(logs, f, ensure_ascii=False, indent=2)
        except Exception as log_err:
            print(f"[TOOL_LOG] failed: {log_err}")

    def _sanitize_function_result(self, result: Any, func_name: str) -> str:
        """对函数输出进行'脱水'处理，防止 Context 溢出"""
        if not isinstance(result, str):
            result = str(result)

        # 读取类工具必须返回完整内容，不能自动缩水
        no_truncate_tools = {
            "getBasisContent",
            "getContext",
            "getContext_findKeyword",
            "getEMail",
            "getEMailList",
            "getKnowledgeGraphStructure",
            "getKnowledgeConnections",
            "findPathBetweenKnowledge",
            "file_read",
            "file_find",
            "file_list",
        }
        if func_name in no_truncate_tools:
            return result

        # 其他工具保留兜底截断，但阈值提高，减少误伤
        limit = 12000
        if len(result) <= limit:
            return result

        # 超过限制，保留头部和尾部，避免单次响应极端膨胀
        print(f"[TOKEN_OPT] 对工具 {func_name} 的结果进行了脱水 (原长度: {len(result)})")
        keep_head = 6000
        keep_tail = 3000
        prefix = result[:keep_head]
        suffix = result[-keep_tail:]
        omitted_len = len(result) - (keep_head + keep_tail)

        return (
            f"{prefix}\n\n"
            f"... [数据过长，已自动省略 {omitted_len} 字符。"
            f"如需完整结果，请缩小查询范围或使用分页参数重试] ...\n\n"
            f"{suffix}"
        )
    
    def _execute_function_impl(self, function_name: str, args: Dict) -> str:
        """函数执行实现（委托给统一工具执行器）"""
        return self.tool_executor.execute(function_name, args)
    
    def upload_file(self, file_path: str):
        """
        上传文件到火山引擎
        """
        try:
            print(f"[FILE] 上传文件: {file_path}")
            # 指定 purpose 为 assistants 以支持上下文缓存等高级功能
            with open(file_path, "rb") as f:
                file_obj = self.client.files.create(
                    file=f,
                    purpose="user_data"
                )
            print(f"[FILE] 上传成功 ID: {file_obj.id}")
            return file_obj
        except Exception as e:
            print(f"[ERROR] 文件上传失败: {e}")
            raise e

    def sendMessage(
        self,
        msg: str,
        stream: bool = True,
        max_rounds: int = 100,
        enable_thinking: bool = True,
        enable_web_search: bool = True,
        enable_tools: bool = True,
        show_token_usage: bool = False,
        file_ids: List[str] = None,
        is_regenerate: bool = False,
        regenerate_index: int = None
    ) -> Generator[Dict[str, Any], None, None]:
        """
        发送消息（支持多轮对话、流式输出、文件和Context Caching）
        """
        if self.model_name == "NO_AVAILABLE_MODEL":
            yield {
                "type": "error",
                "content": "当前账号无可用模型权限，请联系管理员分配。"
            }
            return

        try:
            # 确保对话已创建
            if not self.conversation_id:
                self.conversation_id = self.conversation_manager.create_conversation()
            
            # 发送模型信息（前端显示模型小字提示）
            yield {
                "type": "model_info", 
                "model_name": self.model_name, 
                "provider": self.provider
            }

            # 如果是重新生成，先处理版本保存
            if is_regenerate and regenerate_index is not None:
                # 注意：此时 msg 是触发重新生成的那个 user 消息
                # 我们需要在添加新消息前，先把要覆盖的那个 assistant 消息存为版本
                # 逻辑在 server.py 处理更合适，这里只负责清除 cache 强制重算
                pass

            # 暂存 file_ids 到 metadata
            metadata = {}
            if file_ids:
                metadata["file_ids"] = file_ids
            
            # 重新生成逻辑：不添加新消息，而是使用历史消息
            if not is_regenerate:
                self.conversation_manager.add_message(self.conversation_id, "user", msg, metadata=metadata)
            
            # 构造本次用户消息内容 (多模态)
            # 如果没有文件，直接使用字符串，避免API兼容性问题 (Error: unknown type: text)
            if not file_ids:
                user_content = msg
            else:
                user_content = []
                user_content.append({"type": "text", "text": msg})
                for fid in file_ids:
                    user_content.append({
                        "type": "image_url",
                        "image_url": {
                             "url": fid
                        }
                    })

            # Check Context Cache
            last_response_id = self.conversation_manager.get_last_volc_response_id(
                self.conversation_id, 
                current_model_name=self.model_name
            )
            
            # 如果是重新生成，必须清除 last_response_id，因为上下文已经改变（分支了）
            if is_regenerate:
                print(f"[REGENERATE] Cleared Context Cache for branching.")
                last_response_id = None

            previous_response_id = None
            messages = []

            if last_response_id:
                # Cache Hit: 仅发送新消息
                print(f"[CACHE] Hit! Resuming from: {last_response_id}")
                previous_response_id = last_response_id
                messages = [{"role": "user", "content": user_content}]
            else:
                # Cache Miss: 全量构建
                print(f"[CACHE] Miss. Building full context.")
                # _build_initial_messages 默认只加了文本，我们需要替换最后一条
                messages = self._build_initial_messages(msg)
                if file_ids:
                    messages.pop() # 移除默认纯文本user消息
                    messages.append({"role": "user", "content": user_content})
            
            # 多轮对话循环
            accumulated_content = ""
            accumulated_reasoning = ""  # 累积思维链内容
            process_steps = []  # 记录完整的工具调用过程
            dedupe_after_tool_round = False  # 工具调用后下一轮启用跨轮前缀去重
            
            # previous_response_id 已在上面初始化
            current_function_outputs = []  # 当前轮的function输出
            use_responses_api = self._provider_use_responses_api(self.provider)
            
            try:
                for round_num in range(max_rounds):
                    # [FIX] 增加短暂延迟以提高多轮对话稳定性 (官方建议 100ms)
                    if round_num > 0:
                        time.sleep(0.1)
                        
                    print(f"\n[DEBUG] ===== 第 {round_num + 1} 轮 =====")
                    print(f"[DEBUG] Messages数量: {len(messages)} | Function消息: {len([m for m in messages if m.get('role')=='function'])}")
                    
                    # 构建请求
                    print(f"[DEBUG_REQ] Pkg_ID: {previous_response_id} | Func_Outs: {len(current_function_outputs) if current_function_outputs else 0}")
                    if not previous_response_id and messages:
                        last_msg = messages[-1]
                        print(f"[DEBUG_REQ] Last Msg Role: {last_msg.get('role')} | Content: {str(last_msg.get('content'))[:50]}...")
                        if last_msg.get('role') == 'assistant' and 'tool_calls' in last_msg:
                            print(f"[DEBUG_REQ] Last Msg ToolCalls: {len(last_msg['tool_calls'])}")

                    request_params = self._build_request_params(
                        messages=messages,
                        previous_response_id=previous_response_id,
                        enable_thinking=enable_thinking,
                        enable_web_search=enable_web_search,
                        enable_tools=enable_tools,
                        current_function_outputs=current_function_outputs
                    )
                    
                    # 关键：清除已消耗的函数输出，防止在下一轮中重复发送
                    current_function_outputs = []
                    
                    # 调用API
                    print(f"[DEBUG_API] 发送请求 (Provider: {self.provider})")
                    
                    response_iterator = None
                    try:
                        if use_responses_api:
                            response_iterator = self.client.responses.create(**request_params)
                        else:
                            # Stepfun / OpenAI 兼容接口
                            response_iterator = self.client.chat.completions.create(**request_params)
                    except Exception as e:
                         # 统一错误处理，稍后会由 retry 逻辑捕捉或重抛
                         pass

                    # -------------------------------------------------------------
                    # Robust Retry Logic (主用于火山引擎 Context Mismatch)
                    # -------------------------------------------------------------
                    def safe_iter(iterator):
                        try:
                            for item in iterator:
                                yield item
                        except Exception as e:
                            raise e 
                    
                    is_retry_mode = False
                    try:
                         if response_iterator is None:
                             if use_responses_api:
                                 response_iterator = self.client.responses.create(**request_params)
                             else:
                                 response_iterator = self.client.chat.completions.create(**request_params)
                         chunks = safe_iter(response_iterator)
                    except Exception as e:
                        error_str = str(e)
                        if self.provider == 'volcengine' and "previous_response_id" in error_str and "400" in error_str:
                             print(f"[ERROR] 捕获 Context Mismatch (400). Retrying with FULL context...")
                             # 关键修复：当 resumption 失败时，必须将 input 恢复为完整的 messages 历史，否则模型会丢失上下文
                             request_params["input"] = messages
                             if "previous_response_id" in request_params:
                                 del request_params["previous_response_id"]
                             previous_response_id = None
                             response_iterator = self.client.responses.create(**request_params)
                             chunks = safe_iter(response_iterator)
                             is_retry_mode = True
                        else:
                             raise e

                    # Process Stream
                    print(f"[DEBUG_API] 请求返回，开始处理流... (Round: {round_num + 1}, Retry: {is_retry_mode})")
                    
                    # 处理响应流（直接在这里处理以支持实时yield）
                    round_content = ""
                    raw_round_content = ""
                    emitted_round_content_len = 0
                    function_calls = []
                    has_web_search = False
                    enable_cross_round_dedupe = bool(round_num > 0 and dedupe_after_tool_round and accumulated_content)
                    dedupe_base_text = accumulated_content if enable_cross_round_dedupe else ""
                    
                    # [FIX] 内部去重标志：防止某些模型同时输出 reasoning_text 和 reasoning_summary_text 导致前端重复
                    has_received_detail_reasoning = False
                    
                    # [FIX] 记录本轮最后一次出现的 usage，避免在流中多次记录导致日志爆炸
                    round_usage = None

                    def _append_round_delta(delta_text):
                        nonlocal raw_round_content, round_content, emitted_round_content_len, accumulated_content
                        if delta_text is None:
                            return ""
                        piece = str(delta_text)
                        if not piece:
                            return ""
                        raw_round_content += piece
                        effective_text = raw_round_content
                        if enable_cross_round_dedupe:
                            overlap = self._prefix_suffix_overlap(dedupe_base_text, raw_round_content)
                            if overlap > 0:
                                effective_text = raw_round_content[overlap:]
                        if len(effective_text) <= emitted_round_content_len:
                            round_content = effective_text
                            return ""
                        new_piece = effective_text[emitted_round_content_len:]
                        emitted_round_content_len = len(effective_text)
                        round_content = effective_text
                        accumulated_content += new_piece
                        return new_piece

                    try:
                        for chunk in chunks:
                            # [CHUNK_DEBUG] 每一个 chunk 的详细信息
                            suppress_chunk_debug = os.environ.get("NEXORA_CLI_SUPPRESS_CHUNK_DEBUG", "0") == "1"
                            if CONFIG.get('log_status', 'silent') == 'all' and not suppress_chunk_debug:
                                if use_responses_api:
                                    c_type = getattr(chunk, 'type', 'unknown')
                                    # 提取内容摘要
                                    c_content = ""
                                    if hasattr(chunk, 'delta'): 
                                        c_content = str(chunk.delta)  # 强制转换为字符串，防止 ResponseOutputText 对象
                                    elif hasattr(chunk, 'item') and chunk.item:
                                        if hasattr(chunk.item, 'content'): 
                                            c_content = str(chunk.item.content)  # 强制转换为字符串
                                        elif hasattr(chunk.item, 'type'): 
                                            c_content = f"Item({chunk.item.type})"
                                    
                                    # 统一输出格式 (Type/Content) - 直接使用字符串，不需要 json.dumps
                                    print(f"[CHUNK_DEBUG] type={c_type} content={c_content}")
                                else:
                                    # OpenAI / Stepfun 结构
                                    c_type = "openai_chunk"
                                    delta = chunk.choices[0].delta if chunk.choices else None
                                    c_content = ""
                                    if delta:
                                        if hasattr(delta, 'content') and delta.content: 
                                            c_content = str(delta.content)  # 强制转换为字符串
                                        elif hasattr(delta, 'reasoning_content') and delta.reasoning_content: 
                                            c_content = "[Reasoning] " + str(delta.reasoning_content)  # 强制转换为字符串
                                        elif hasattr(delta, 'tool_calls') and delta.tool_calls:
                                            c_content = "[ToolCalls]"
                                    
                                    # 额外检查 usage
                                    usage_str = ""
                                    if hasattr(chunk, 'usage') and chunk.usage:
                                        usage_str = f" | Usage: {chunk.usage}"
                                    
                                    print(f"[CHUNK_DEBUG] type={c_type} content={c_content}{usage_str}")

                            # --- 处理：火山引擎 (Ark Responses API 专用结构) ---
                            if use_responses_api:
                                chunk_type = getattr(chunk, 'type', None)
                                chunk_type_str = str(chunk_type)
                                
                                # 获取 response_id
                                if hasattr(chunk, 'response'):
                                    response_obj = getattr(chunk, 'response')
                                    if hasattr(response_obj, 'id') and response_obj.id:
                                        # 更新 persistent ID 供下轮使用
                                        previous_response_id = response_obj.id
                                
                                # 文本增量 - 兼容多种可能的 chunk 类型
                                if chunk_type in ['response.output_text.delta', 'response.message.delta']:
                                    delta = getattr(chunk, 'delta', '')
                                    if delta:
                                        delta_str = str(delta) if not isinstance(delta, str) else delta
                                        new_piece = _append_round_delta(delta_str)
                                        if new_piece:
                                            yield {"type": "content", "content": new_piece}
                            
                                # 思考过程增量 (核心修复: 重新兼容 summary 类型，并防止 detail 和 summary 同时出现时的视觉重复)
                                elif 'reasoning' in chunk_type_str and 'delta' in chunk_type_str:
                                    # 优先判断是否是详情型推理
                                    is_detail = 'reasoning_text.delta' in chunk_type_str or 'reasoning.delta' == chunk_type_str
                                    is_summary = 'reasoning_summary_text.delta' in chunk_type_str
                                    
                                    if is_detail:
                                        has_received_detail_reasoning = True
                                        
                                    # 如果已经收到过详情(Detail)，则忽略后续可能的摘要(Summary)，防止重复显示
                                    if is_summary and has_received_detail_reasoning:
                                        continue
                                        
                                    delta = getattr(chunk, 'delta', '')
                                    if delta:
                                        # 关键修复：确保思维链内容也是字符串
                                        delta_str = str(delta) if not isinstance(delta, str) else delta
                                        accumulated_reasoning += delta_str
                                        yield {"type": "reasoning_content", "content": delta_str}

                                # 函数参数增量（用于前端展示工具调用 Delta）
                                elif 'function_call_arguments.delta' in chunk_type_str:
                                    arg_delta = getattr(chunk, 'delta', '')
                                    if arg_delta is None:
                                        arg_delta = ""
                                    fc_obj = getattr(chunk, 'function_call', None) or getattr(chunk, 'item', None) or getattr(chunk, 'output_item', None)
                                    fc_name = ""
                                    fc_call_id = ""
                                    if fc_obj is not None:
                                        fc_name = str(getattr(fc_obj, 'name', '') or '')
                                        fc_call_id = str(getattr(fc_obj, 'call_id', '') or getattr(fc_obj, 'id', '') or '')
                                    yield {
                                        "type": "function_call_delta",
                                        "name": fc_name,
                                        "call_id": fc_call_id,
                                        "arguments_delta": str(arg_delta)
                                    }

                                # 核心修复: 过滤干扰并按序提取
                                elif chunk_type == 'response.output_item.done':
                                    item = getattr(chunk, 'item', None)
                                    if item:
                                        item_type = getattr(item, 'type', '')
                                        # 1. 提取 Search Keyword
                                        if 'web_search' in item_type:
                                            action = getattr(item, 'action', None)
                                            if action and hasattr(action, 'query'):
                                                query = str(action.query)  # 确保转换为字符串
                                                step = {"type": "web_search", "content": f"正在搜索: {query}", "status": "正在搜索", "query": query}
                                                yield step
                                                process_steps.append(step)
                                        
                                        # 2. 只有在没有产生任何 delta 文本的情况下才使用 done 的文本，防止重复
                                        elif item_type == 'text' and not raw_round_content:
                                            # 关键修复：确保 content 被转换为字符串，防止 ResponseOutputText 对象导致 JSON 序列化失败
                                            text_content = getattr(item, 'content', '')
                                            if text_content:
                                                # 如果是对象类型，**立即**转换为字符串，在任何其他操作之前
                                                text_content = str(text_content) if not isinstance(text_content, str) else text_content
                                                new_piece = _append_round_delta(text_content)
                                                if new_piece:
                                                    yield {"type": "content", "content": new_piece}
                                
                                # Web搜索实时状态
                                elif 'web_search_call.searching' in str(chunk_type) or 'web_search_call.completed' in str(chunk_type):
                                    has_web_search = True
                                    status = '正在搜索' if 'searching' in str(chunk_type) else '搜索完成'
                                    query_text = ""
                                    ws_obj = getattr(chunk, 'web_search_call', None) or getattr(chunk, 'web_search', None)
                                    if ws_obj:
                                        query_raw = getattr(ws_obj, 'query', "")
                                        query_text = str(query_raw) if query_raw else ""  # 确保转换为字符串
                                    step = {"type": "web_search", "content": f"{status}: {query_text}" if query_text else status, "status": status, "query": query_text}
                                    yield step
                                    process_steps.append(step)

                                # Token统计
                                elif chunk_type == 'response.completed':
                                    response_obj = getattr(chunk, 'response', None)
                                    if response_obj and hasattr(response_obj, 'output'):
                                        output = response_obj.output
                                        for item in output:
                                            if getattr(item, 'type', None) == 'function_call':
                                                fc_name = str(getattr(item, 'name', '') or '').strip()
                                                # provider 原生联网搜索工具事件，不进入本地函数执行链
                                                if bool(getattr(self, "native_web_search_enabled", False)) and fc_name in {
                                                    "web_search", "web_extractor", "code_interpreter"
                                                }:
                                                    has_web_search = True
                                                    continue
                                                # 确保所有值都是可序列化的基本类型
                                                func_call = {
                                                    "name": fc_name if fc_name else None,
                                                    "arguments": str(getattr(item, 'arguments', '{}')),
                                                    "call_id": str(getattr(item, 'call_id', '')) if getattr(item, 'call_id', None) else None
                                                }
                                                function_calls.append(func_call)
                                    
                                    # Token统计 (暂存，等循环结束一并记录)
                                    if hasattr(response_obj, 'usage'):
                                        round_usage = response_obj.usage
                                        yield {"type": "token_usage", "input_tokens": round_usage.input_tokens, "output_tokens": round_usage.output_tokens, "total_tokens": round_usage.total_tokens}
                                
                                else:
                                    # 未知类型记录 (仅调试)
                                    # print(f"[DEBUG_CHUNK] Unknown Volc chunk type: {chunk_type}")
                                    pass
                            
                            # --- 处理：标准 OpenAI / Stepfun 结构 ---
                            else:
                                if not chunk.choices:
                                    continue
                                
                                delta = chunk.choices[0].delta
                                
                                # 文本内容
                                if hasattr(delta, 'content') and delta.content:
                                    # 关键修复：确保 OpenAI/Stepfun 的 delta.content 也是字符串
                                    content_str = str(delta.content) if not isinstance(delta.content, str) else delta.content
                                    new_piece = _append_round_delta(content_str)
                                    if new_piece:
                                        yield {"type": "content", "content": new_piece}
                                
                                # 思维链 (Stepfun/Kimi/DeepSeek 兼容字段)
                                if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
                                    # 关键修复：确保推理内容是字符串
                                    reasoning_str = str(delta.reasoning_content) if not isinstance(delta.reasoning_content, str) else delta.reasoning_content
                                    accumulated_reasoning += reasoning_str
                                    yield {"type": "reasoning_content", "content": reasoning_str}
                                
                                # 函数调用 (OpenAI 标准流式格式)
                                if hasattr(delta, 'tool_calls') and delta.tool_calls:
                                    for tc in delta.tool_calls:
                                        if tc.index >= len(function_calls):
                                            # 关键修复：确保 call_id 是字符串
                                            call_id_str = str(tc.id) if tc.id else ""
                                            function_calls.append({"name": "", "arguments": "", "call_id": call_id_str})
                                        
                                        f_info = function_calls[tc.index]
                                        if tc.id: f_info["call_id"] = str(tc.id)
                                        name_delta = ""
                                        arguments_delta = ""
                                        if tc.function:
                                            if tc.function.name:
                                                name_delta = str(tc.function.name)
                                                f_info["name"] += name_delta
                                            if tc.function.arguments:
                                                arguments_delta = str(tc.function.arguments)
                                                f_info["arguments"] += arguments_delta
                                        if name_delta or arguments_delta:
                                            yield {
                                                "type": "function_call_delta",
                                                "name": f_info.get("name", "") or name_delta,
                                                "call_id": f_info.get("call_id", ""),
                                                "arguments_delta": arguments_delta,
                                                "name_delta": name_delta,
                                                "index": tc.index
                                            }

                                # Token统计 (部分 OpenAI Provider 在最后一个 chunk 的 usage 字段)
                                if hasattr(chunk, 'usage') and chunk.usage:
                                    round_usage = chunk.usage
                                    yield {
                                        "type": "token_usage", 
                                        "input_tokens": getattr(round_usage, 'prompt_tokens', 0), 
                                        "output_tokens": getattr(round_usage, 'completion_tokens', 0), 
                                        "total_tokens": getattr(round_usage, 'total_tokens', 0)
                                    }
                    
                    except Exception as e:
                        print(f"[ERROR] Stream processing error: {e}")
                        print(f"[ERROR] Error type: {type(e).__name__}")
                        # 额外调试：尝试找出哪个变量包含不可序列化的对象
                        import traceback
                        traceback.print_exc()
                        # 如果是上下文错误，在这里其实很难直接retry，因为已经yield了部分内容
                        # 但至少我们捕获它，防止整个Server崩掉
                        if "previous response" in str(e):
                             print("[CRITICAL] Context consistency error detected.")
                        raise e

                    # [FIX] 在 chunk 循环结束后，统一记录本轮的 Token 消耗
                    if round_usage:
                        self._log_token_usage_safe(
                            round_usage,
                            has_web_search,
                            function_calls,
                            process_steps,
                            msg,
                            round_content
                        )
                    else:
                        # 某些 Provider 不返回 usage，使用估算值，避免 token 全为 0
                        fallback_title = (str(msg).strip()[:30] + "...") if msg and len(str(msg).strip()) > 30 else (str(msg).strip() if msg else "新对话")
                        try:
                            prompt_snapshot = json.dumps(messages, ensure_ascii=False, default=str)
                        except Exception:
                            prompt_snapshot = str(messages)
                        est_input = self._estimate_token_count(prompt_snapshot)
                        est_output = self._estimate_token_count(round_content or accumulated_content)
                        est_total = est_input + est_output
                        has_text_output = bool(str(round_content or "").strip())
                        est_action = "chat"
                        primary_tool = ""
                        if function_calls:
                            primary_tool = str(function_calls[0].get('name', '') or '')
                        elif has_web_search:
                            primary_tool = "web_search"
                        self.user.log_token_usage(
                            self.conversation_id or "unknown",
                            fallback_title or "新对话",
                            est_action,
                            est_input,
                            est_output,
                            total_tokens=est_total,
                            metadata={
                                "provider": self.provider,
                                "model": self.model_name,
                                "token_details": {
                                    "estimated": True,
                                    "estimate_method": "cjk1.6+ascii/4",
                                    "prompt_chars": len(prompt_snapshot),
                                    "output_chars": len(round_content or accumulated_content or "")
                                },
                                "has_web_search": has_web_search,
                                "tool_call_count": len(function_calls or []),
                                "round_kind": "chat" if has_text_output else "tool_assisted",
                                "primary_tool": primary_tool,
                                "has_text_output": has_text_output
                            }
                        )

                    # 检查 previous_response_id 获取情况 (仅针对火山引擎)
                    if use_responses_api:
                        if previous_response_id:
                            print(f"[DEBUG] 已捕获 Response ID: {previous_response_id}")
                        else:
                            print(f"[WARNING] 本轮未能捕获 Response ID，下轮将回退到全量上下文传输 (Token开销增加)")

                    # 本轮文本内容作为步骤加入
                    if round_content:
                        process_steps.append({"type": "content", "content": round_content})
                    
                    # 处理函数调用
                    if function_calls:
                        # -------------------------------------------------------------
                        # [FIX] 核心修复: 构建 Assistant Message (Tool Calls) 并加入历史
                        # 确保多轮对话上下文完整 (User -> Assistant[Call] -> Tool[Output])
                        # 对于 OpenAI/GitHub 等模型，content 必须为 None 或省略，如果只有 tool_calls
                        # -------------------------------------------------------------
                        tool_calls_payload = []
                        for fc in function_calls:
                            tool_calls_payload.append({
                                "id": fc["call_id"],
                                "type": "function",
                                "function": {
                                    "name": fc["name"],
                                    "arguments": fc["arguments"]
                                }
                            })
                        
                        # 构建助手的工具调用消息
                        assistant_tool_msg = {
                            "role": "assistant",
                            "tool_calls": tool_calls_payload
                        }
                        # 对于标准 OpenAI 格式，如果 content 为空字符串，建议设为 None 或完全不传
                        if round_content:
                            assistant_tool_msg["content"] = round_content
                        else:
                            assistant_tool_msg["content"] = None
                            
                        messages.append(assistant_tool_msg)
                        
                        function_outputs = []
                        
                        for func_call in function_calls:
                            func_name = func_call["name"]
                            func_args = func_call["arguments"]
                            call_id = func_call["call_id"]
                            
                            print(f"\n[FUNCTION] 调用: {func_name}")
                            print(f"[FUNCTION] 参数: {func_args}")
                            
                            # 记录调用步骤
                            step_call = {
                                "type": "function_call",
                                "name": func_name,
                                "arguments": func_args,
                                "call_id": call_id
                            }
                            process_steps.append(step_call)
                            yield step_call
                            
                            # 执行函数
                            result = self._execute_function(func_name, func_args)
                            
                            print(f"[FUNCTION] 结果: {result[:100]}..." if len(result) > 100 else f"[FUNCTION] 结果: {result}")
                            
                            # 记录结果步骤
                            step_result = {
                                "type": "function_result",
                                "name": func_name,
                                "result": result,
                                "call_id": call_id
                            }
                            process_steps.append(step_result)
                            yield step_result
                            
                            # 收集函数输出
                            if use_responses_api:
                                current_function_outputs.append({
                                    "type": "function_call_output",
                                    "call_id": call_id,
                                    "output": result
                                })
                            else:
                                # OpenAI 标准格式需要 role: tool
                                current_function_outputs.append({
                                    "role": "tool",
                                    "tool_call_id": call_id,
                                    "content": result
                                })
                        
                        # [FIX] 在工具调用结束后，添加一个隐形的引导提示，防止模型复读或卡住
                        # 仅针对火山引擎 (Ark Responses API)，帮助其更好地从工具结果切换回文本回复
                        if self.provider == 'volcengine':
                            # 提取本次调用的工具名称
                            tool_names = list(set([fc["name"] for fc in function_calls]))
                            # 使用 system 角色提供指令引导，使用中文以符合主要交互语言
                            current_function_outputs.append({
                                "role": "system",
                                "content": f"[系统指令] 你（AI助手）已完成工具调用: {', '.join(tool_names)}。请根据返回的工具结果，继续完成对用户的回答或做出最终总结。"
                            })
                        
                        # 继续下一轮（保持messages累积，但current_function_outputs已重置）
                        messages = self._append_function_outputs(messages, current_function_outputs)
                        
                        # [DEBUG] 打印更新后的历史状态
                        print(f"[DEBUG_HIST] 更新历史后消息数: {len(messages)}")
                        if len(messages) >= 2:
                            print(f"[DEBUG_HIST] 倒数第二条: {messages[-2].get('role')} (Tools: {len(messages[-2].get('tool_calls', []))})")
                            print(f"[DEBUG_HIST] 最后一条: {messages[-1].get('role')} (Type: {messages[-1].get('type', 'text')})")

                        # 继续循环下一轮
                        dedupe_after_tool_round = True
                        continue

                    # 没有函数调用，对话结束
                    yield {"type": "done", "content": accumulated_content}
                    return
                
                # 达到最大轮次
                print(f"[WARNING] 达到最大轮次 {max_rounds}")
                yield {"type": "done", "content": accumulated_content}
            
            finally:
                # 统一保存消息（无论正常结束、Function调用中断、Client中断）
                # 只有当有内容或有步骤时才保存
                if accumulated_content or process_steps:
                    print(f"[DEBUG] 保存助手消息，Steps: {len(process_steps)}")
                    metadata = {
                        "process_steps": process_steps,
                        "model_name": self.model_name
                    }
                    
                    # 自动生成对话标题（根据配置决定是否每轮都总结）
                    if accumulated_content:
                        try:
                            # 仅在第一轮或开启 continuous_summary 时生成标题
                            should_generate = True
                            if not CONFIG.get("continuous_summary", False):
                                is_first_round = self.conversation_manager.get_message_count(self.conversation_id) <= 2 # user + assistant=2
                                should_generate = is_first_round
                            
                            if should_generate:
                                title = self._generate_conversation_title(msg, accumulated_content)
                                metadata["exchange_summary"] = title
                                # 更新对话标题
                                self.conversation_manager.update_conversation_title(self.conversation_id, title)
                        except Exception as e:
                            print(f"[ERROR] 自动生成标题失败: {e}")
                    
                    # 保存思维链内容（如果有）
                    if accumulated_reasoning:
                        metadata["reasoning_content"] = accumulated_reasoning
                    
                    self.conversation_manager.add_message(
                        self.conversation_id,
                        "assistant",
                        accumulated_content,
                        metadata=metadata,
                        index=regenerate_index if is_regenerate else None
                    )
                
                # 保存 Context Cache ID
                if previous_response_id:
                    self.conversation_manager.update_volc_response_id(
                        self.conversation_id, 
                        previous_response_id,
                        model_name=self.model_name
                    )
                    print(f"[CACHE] Saved Response ID: {previous_response_id}")
                else: 
                     # Case: 模型可能在最后一轮 function execution 后，返回空内容结束了
                     # 此时应该检查是否有未保存的 process_steps，但通常 accumulated_content 会为空
                     # 如果 accumulated_content 为空，但有 steps，上面已经保存了
                     # 唯一的问题是：如果模型在最后一次响应里只输出了 function_call 却没有 text content
                     # 并且 tool loop 结束了（例如 max rounds），那么 accumulated_content 为空
                     # 已经在上面保存了。
                     
                     # 但用户遇到的情况是： json里 content: ""，但是有 process_steps。
                     # 这说明前端如果不显示 process_steps，就什么都看不到。
                     # 或者 accumulated_content 本来就是空的。
                     
                     # 修正：当流式输出结束后，如果 accumulated_content 为空，尝试给一个默认值
                     # 或者前端应该渲染 process_steps。
                     
                     # 实际上，如果 content 为空，前端可能就什么都不显示，只显示了一个空白的气泡？
                     # 或者前端根本没渲染？
                     
                     # 如果是 function_call 导致的中断，那么此时 content 确实可能为空，等待下一轮
                     # 但这里是 finally 块，意味着 sendMessage 彻底结束
                     
                     pass
            
        except Exception as e:
            error_msg = f"错误: {str(e)}"
            print(f"[ERROR] {error_msg}")
            yield {"type": "error", "content": error_msg}

    def _log_token_usage_safe(self, usage, has_web_search, function_calls, process_steps, user_message=None, round_content=None):
        """安全记录Token日志（不影响主流程）"""
        try:
            def _safe_int(v, default=0):
                try:
                    if v is None:
                        return default
                    if isinstance(v, bool):
                        return int(v)
                    if isinstance(v, (int, float)):
                        return int(v)
                    s = str(v).strip()
                    if not s:
                        return default
                    if s.isdigit() or (s.startswith('-') and s[1:].isdigit()):
                        return int(s)
                    return int(float(s))
                except Exception:
                    return default

            def _uv(obj, key, default=0):
                if isinstance(obj, dict):
                    return obj.get(key, default)
                return getattr(obj, key, default)

            has_text_output = bool(str(round_content or "").strip())
            action_type = "chat"
            primary_tool = ""
            if function_calls:
                primary_tool = str(function_calls[0].get('name', '') or '')
            elif has_web_search:
                primary_tool = "web_search"
            elif len(process_steps) > 0:
                for step in process_steps:
                    if step.get('type') == 'function_call':
                        primary_tool = str(step.get('name', '') or '')
                        break
                    if step.get('type') == 'web_search':
                        primary_tool = "web_search"
                        break

            if user_message:
                clean_msg = str(user_message).strip()
                conv_title = clean_msg[:30] + "..." if len(clean_msg) > 30 else clean_msg
            else:
                conv_title = "新对话"
                if self.conversation_id:
                    try:
                        conv_data = self.conversation_manager.get_conversation(self.conversation_id)
                        conv_title = conv_data.get("title", conv_title)
                    except:
                        pass

            input_tokens = _uv(usage, 'input_tokens', _uv(usage, 'prompt_tokens', 0))
            output_tokens = _uv(usage, 'output_tokens', _uv(usage, 'completion_tokens', 0))
            usage_total = _uv(usage, 'total_tokens', 0)
            usage_total_int = _safe_int(usage_total, 0)
            input_tokens_int = _safe_int(input_tokens, 0)
            output_tokens_int = _safe_int(output_tokens, 0)
            if usage_total_int > 0:
                total_tokens = usage_total_int
            else:
                total_tokens = input_tokens_int + output_tokens_int

            prompt_details = _uv(usage, 'prompt_tokens_details', {}) or {}
            completion_details = _uv(usage, 'completion_tokens_details', {}) or {}
            token_details = {
                "cached_tokens": _safe_int(_uv(prompt_details, 'cached_tokens', 0), 0),
                "reasoning_tokens": _safe_int(_uv(completion_details, 'reasoning_tokens', 0), 0),
                "audio_input_tokens": _safe_int(_uv(prompt_details, 'audio_tokens', 0), 0),
                "audio_output_tokens": _safe_int(_uv(completion_details, 'audio_tokens', 0), 0)
            }

            log_status = CONFIG.get('log_status', 'silent')
            suppress_token_debug = os.environ.get("NEXORA_CLI_SUPPRESS_CHUNK_DEBUG", "0") == "1"
            if log_status == 'all' and not suppress_token_debug:
                print(f"[TOKEN_DEBUG] ==================== Token Usage Info ====================")
                print(f"[TOKEN_DEBUG] Model: {self.model_name} | Provider: {self.provider}")
                print(f"[TOKEN_DEBUG] Action: {action_type} | Input: {input_tokens_int} | Output: {output_tokens_int}")
                print(f"[TOKEN_DEBUG] Total: {total_tokens}")
                print(f"[TOKEN_DEBUG] ==========================================================")

            self.user.log_token_usage(
                self.conversation_id or "unknown",
                conv_title,
                action_type,
                input_tokens_int,
                output_tokens_int,
                total_tokens=total_tokens,
                metadata={
                    "provider": self.provider,
                    "model": self.model_name,
                    "token_details": token_details,
                    "has_web_search": has_web_search,
                    "tool_call_count": len(function_calls or []),
                    "round_kind": "chat" if has_text_output else "tool_assisted",
                    "primary_tool": primary_tool,
                    "has_text_output": has_text_output
                }
            )
        except Exception as e:
            print(f"[WARNING] 记录 Token 日志失败: {e}")

    def _build_initial_messages(self, user_msg: str) -> List[Dict]:
        """构建初始消息列表（真实上下文模式）"""
        messages = [{"role": "system", "content": self.system_prompt}]

        # 真实上下文：注入当前会话历史 user/assistant 消息
        history_messages: List[Dict[str, Any]] = []
        if self.conversation_id:
            try:
                history_messages = self.conversation_manager.get_messages(self.conversation_id)
            except Exception:
                history_messages = []

        for item in history_messages:
            role = str(item.get("role", "") or "").strip()
            if role not in ("user", "assistant"):
                continue
            content = item.get("content", "")
            if content is None:
                continue
            if isinstance(content, str):
                if not content.strip():
                    continue
                normalized = content
            else:
                normalized = str(content)
                if not normalized.strip():
                    continue
            messages.append({"role": role, "content": normalized})

        # 去重：sendMessage 在非 regenerate 路径已经先写入了当前 user 消息
        if not messages or messages[-1].get("role") != "user" or str(messages[-1].get("content", "")) != str(user_msg):
            messages.append({"role": "user", "content": user_msg})

        # 重要：剔除历史对话中的 reasoning_content 字段
        # 根据文档：模型版本在251228之前需要剔除，避免影响推理逻辑
        return self._strip_reasoning_content(messages)
    
    def _strip_reasoning_content(self, messages: List[Dict]) -> List[Dict]:
        """剔除消息中的reasoning_content字段（符合文档要求）"""
        cleaned = []
        for msg in messages:
            # [FIX] 增加安全性：检查 role 字段是否存在
            # 针对火山引擎 (Ark)，某些消息可能是 OutputItem (如 function_call_output)，没有 role
            if "role" not in msg:
                cleaned.append(dict(msg)) # 直接保留副本
                continue
                
            cleaned_msg = {"role": msg["role"], "content": msg.get("content", "")}
            # 保留其他必要字段（如tool_calls等），但排除reasoning_content
            for key in msg:
                if key not in ["role", "content", "reasoning_content", "metadata"]:
                    cleaned_msg[key] = msg[key]
            cleaned.append(cleaned_msg)
        return cleaned
    
    def _generate_conversation_title(self, user_message: str, assistant_response: str) -> str:
        """使用conclusion_model生成对话标题"""
        try:
            conclusion_model = CONFIG.get('conclusion_model', 'doubao-seed-1-6-flash-250828')
            model_info = CONFIG.get('models', {}).get(conclusion_model, {})
            provider_name = model_info.get('provider', 'volcengine')
            provider_info = CONFIG.get('providers', {}).get(provider_name, {})
            
            api_key = provider_info.get('api_key', "")
            base_url = provider_info.get('base_url')
            
            # 使用统一的缓存逻辑
            global _CLIENT_CACHE
            cache_key = f"{provider_name}_{api_key}"
            
            if cache_key in _CLIENT_CACHE:
                client = _CLIENT_CACHE[cache_key]
            else:
                if provider_name == 'volcengine':
                    client = Ark(api_key=api_key, base_url=base_url, timeout=30.0)
                else:
                    client = OpenAI(api_key=api_key, base_url=base_url, timeout=30.0)
                _CLIENT_CACHE[cache_key] = client
            
            # 构建prompt
            prompt = f"""根据以下对话内容，生成一个简洁准确的标题（10-20字）。

用户问题：{user_message[:100]}
助手回答：{assistant_response[:100]}

要求：
1. 准确概括对话核心内容
2. 简洁明了，10-20字
3. 只输出标题，不要其他内容
4. 避免使用"用户询问"、"提供信息"等冗余词汇

你只用快速输出标题："""
            
            # 调用API
            if provider_name == 'volcengine':
                response = client.chat.completions.create(
                    model=conclusion_model,
                    messages=[{"role": "user", "content": prompt}],
                    stream=False
                )
            else:
                response = client.chat.completions.create(
                    model=conclusion_model,
                    messages=[{"role": "user", "content": prompt}],
                    stream=False
                )
            
            title = response.choices[0].message.content.strip()
            # 清理可能的引号
            title = title.strip('"').strip("'").strip()
            
            print(f"[TITLE] 生成标题: {title}")
            return title[:50]  # 限制最大长度
            
        except Exception as e:
            print(f"[ERROR] 生成标题失败: {e}")
            # 降级方案：使用用户消息前30字
            return user_message[:30] + ("..." if len(user_message) > 30 else "")
    
    def _build_request_params(
        self,
        messages: List[Dict],
        previous_response_id: Optional[str],
        enable_thinking: bool,
        enable_web_search: bool,
        enable_tools: bool,
        current_function_outputs: List[Dict] = None
    ) -> Dict:
        """构建API请求参数 - 兼容不同供应商"""
        
        # 基础参数
        params = {
            "model": self.model_name,
            "stream": True
        }

        use_responses_api = self._provider_use_responses_api(self.provider)

        # Chat Completions 才需要 stream_options（含 usage）
        if not use_responses_api:
            params["stream_options"] = {"include_usage": True}

        # --- Responses API 逻辑（volcengine + 可选 aliyun） ---
        if use_responses_api:
            tools_payload = []
            if enable_tools and isinstance(self.tools, list):
                tools_payload = list(self.tools)

            # Responses API 下允许“仅联网搜索开关”生效（即使 enable_tools=false）
            if enable_web_search and bool(getattr(self, "native_web_search_enabled", False)):
                native_tools = list(getattr(self, "native_search_tools", []) or [])
                for nt in native_tools:
                    if not isinstance(nt, dict):
                        continue
                    ntype = str(nt.get("type", "")).strip()
                    if not ntype or ntype == "function":
                        continue
                    if not any(
                        isinstance(x, dict) and str(x.get("type", "")).strip() == ntype
                        for x in tools_payload
                    ):
                        tools_payload.append(json.loads(json.dumps(nt)))

            # 用户关闭联网搜索时，移除 native web_* 工具，避免误触发
            if not enable_web_search and tools_payload:
                filtered_tools = []
                for t in tools_payload:
                    if not isinstance(t, dict):
                        filtered_tools.append(t)
                        continue
                    t_type = str(t.get("type", "")).strip()
                    if t_type in {"web_search", "web_extractor"}:
                        continue
                    filtered_tools.append(t)
                tools_payload = filtered_tools

            if self.provider == 'volcengine':
                if enable_thinking:
                    params["thinking"] = {"type": "enabled"}
                else:
                    params["thinking"] = {"type": "disabled"}
            elif self.provider == 'aliyun':
                # DashScope Responses API: thinking 通过 extra_body 传递
                extra_body = params.get("extra_body", {})
                if not isinstance(extra_body, dict):
                    extra_body = {}
                if enable_thinking:
                    extra_body["enable_thinking"] = True
                    print(f"[DEBUG] [Aliyun-Responses] 已为 {self.model_name} 开启思维链模式 (extra_body)")
                if extra_body:
                    params["extra_body"] = extra_body

            if tools_payload:
                params["tools"] = tools_payload

            if previous_response_id is None:
                params["input"] = messages
            else:
                params["previous_response_id"] = previous_response_id
                if current_function_outputs:
                    params["input"] = current_function_outputs
                elif messages:
                    params["input"] = messages
                else:
                    params["input"] = [{"role": "user", "content": ""}]
                    
        # --- 通用 OpenAI / Stepfun 逻辑 ---
        else:
            # Stepfun / OpenAI 标准参数
            # [FIX] 对于 OpenAI o1/o3 或 GPT-5 等新模型，'max_tokens' 被替换为 'max_completion_tokens'
            is_new_reasoning_model = any(x in self.model_name.lower() for x in ["o1", "o3", "gpt-5", "gpt5", "reasoning"])
            
            # if is_new_reasoning_model:
            #     params["max_completion_tokens"] = 8192
            # else:
            #     params["max_tokens"] = 8192  # 标准模型通常限制在 4k 或 8k，除非特定长文本模型
            
            if enable_tools:
                # [FIX] GitHub Inference 的 Phi-4-reasoning 和 DeepSeek-R1 等模型不支持工具调用
                # 即使提供了 tools，后端也会报错: "auto" tool choice requires --enable-auto-tool-choice
                # 因此我们需要彻底剥离这些模型在特定 Provider 下的工具参数
                is_reasoning_only = any(x in self.model_name.lower() for x in ["-reasoning", "deepseek-r1", "qwq-32b"])
                
                # 如果是这类模型，我们强制不开启 tools
                if is_reasoning_only and self.provider in ["github", "suanli"]:
                     print(f"[DEBUG] [Phi-4-FIX] 模型 {self.model_name} 在 {self.provider} 下检测到 Reasoning，屏蔽 tools 以避免 400 错误。")
                else:
                    params["tools"] = self.tools
                    # provider 级 native tools（来自 search_adapters）
                    native_tools = list(getattr(self, "native_search_tools", []) or [])
                    if native_tools and self.provider != "aliyun":
                        existing = params.get("tools", []) if isinstance(params.get("tools"), list) else []
                        # 非 function 的 native tool 直接附加（是否生效由 provider 决定）
                        for nt in native_tools:
                            if not isinstance(nt, dict):
                                continue
                            if str(nt.get("type", "")).strip() == "function":
                                continue
                            existing.append(nt)
                        params["tools"] = existing
                    # [FIX] 针对 GitHub 上的普通 Phi-4 模型，不要传 tool_choice，否则可能 400
                    if "phi-4" in self.model_name.lower() and self.provider == "github":
                        pass
                    else:
                        # 只有非 Phi-4/Reasoning 模型才显式设置或允许 auto 行为（由 API 默认控制）
                        pass
            
            # 标准 OpenAI 格式使用 messages 数组
            # 注意：对于非火山引擎模型，messages 列表已经由 sendMessage 循环维护好了正确的 role
            # 剔除可能存在的 reasoning_content 或其他非标准字段，确保兼容性
            params["messages"] = self._strip_reasoning_content(list(messages))

            # --- 阿里云 / DashScope 专用逻辑 ---
            if self.provider == "aliyun":
                extra_body = params.get("extra_body", {})
                if not isinstance(extra_body, dict):
                    extra_body = {}
                if enable_thinking:
                    extra_body["enable_thinking"] = True
                    print(f"[DEBUG] [Aliyun-Thinking] 已为 {self.model_name} 开启思维链模式 (extra_body)")
                if enable_web_search and bool(getattr(self, "native_web_search_enabled", False)):
                    req_opts = self._get_provider_request_options(self.provider)
                    enable_search_cfg = req_opts.get("enable_search", True)
                    if bool(enable_search_cfg):
                        extra_body["enable_search"] = True
                        search_options = req_opts.get("search_options")
                        if isinstance(search_options, dict) and search_options:
                            extra_body["search_options"] = search_options
                if extra_body:
                    params["extra_body"] = extra_body

        return params
    
    def _append_function_outputs(
        self,
        messages: List[Dict],
        function_outputs: List[Dict]
    ) -> List[Dict]:
        """追加函数输出到消息列表"""
        return messages + function_outputs
    
    def _process_response_stream(
        self,
        response,
        round_num: int,
        show_token_usage: bool
    ) -> Dict:
        """
        处理响应流
        
        Returns:
            {
                "content": str,
                "function_calls": List[Dict],
                "has_web_search": bool,
                "response_id": str
            }
        """
        content = ""
        function_calls = []
        has_web_search = False
        response_id = None
        
        for chunk in response:
            chunk_type = getattr(chunk, 'type', None)
            
            # 获取 response_id
            if hasattr(chunk, 'response'):
                response_obj = getattr(chunk, 'response')
                if hasattr(response_obj, 'id'):
                    response_id = response_obj.id
            
            # 处理不同事件类型
            if chunk_type == 'response.output_text.delta':
                # 文本增量
                delta = getattr(chunk, 'delta', '')
                content += delta
                # 只在控制台显示调试信息，不输出完整文本
                # print(delta, end='', flush=True)
            
            elif chunk_type == 'response.function_call_arguments.delta':
                # 函数参数增量（静默处理，done时才处理完整参数）
                pass
            
            elif chunk_type in ['response.web_search_call.in_progress',
                               'response.web_search_call.searching',
                               'response.web_search_call.completed']:
                # Web搜索事件
                has_web_search = True
                status_map = {
                    'response.web_search_call.in_progress': '准备搜索',
                    'response.web_search_call.searching': '正在搜索',
                    'response.web_search_call.completed': '搜索完成'
                }
                print(f"[WEB_SEARCH] {status_map.get(chunk_type, chunk_type)}")
            
            elif chunk_type == 'response.completed':
                # 响应完成，提取函数调用
                response_obj = getattr(chunk, 'response', None)
                if response_obj and hasattr(response_obj, 'output'):
                    output = response_obj.output
                    for item in output:
                        item_type = getattr(item, 'type', None)
                        if item_type == 'function_call':
                            function_calls.append({
                                "name": getattr(item, 'name', None),
                                "arguments": getattr(item, 'arguments', '{}'),
                                "call_id": getattr(item, 'call_id', None)
                            })
                
                # Token统计
                if show_token_usage and hasattr(response_obj, 'usage'):
                    usage = response_obj.usage
                    print(f"[TOKEN] Input: {usage.input_tokens}, Output: {usage.output_tokens}, Total: {usage.total_tokens}")
        
        return {
            "content": content,
            "function_calls": function_calls,
            "has_web_search": has_web_search,
            "response_id": response_id
        }
    
    def reset_conversation(self):
        """重置对话"""
        self.conversation_id = self.conversation_manager.create_conversation()
    
    def get_conversation_history(self):
        """获取对话历史"""
        if not self.conversation_id:
            return []
        return self.conversation_manager.get_messages(self.conversation_id)
    
    def analyzeConnections(self, title: str) -> str:
        """分析知识连接（简化实现）"""
        return f"知识 '{title}' 的连接分析功能尚未完整实现"


