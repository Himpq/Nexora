"""Model instance initialization for the Core domain."""

import json
import os
from typing import Any, Dict, List, Optional, Set

from App.Executor import ToolExecutor
from basis.Tool import ToolResultPresenter, get_tools_for_config
from basis.User import User
from basis.Conversation import ConversationManager, ConversationService
from basis.Model.Context import ChatContextManager
from basis.Model.Provider import create_provider_adapter


class ModelInitializationMixin:
    def __init__(
        self,
        username: str,
        model_name: str = None,
        system_prompt: Optional[str] = None,
        conversation_id: Optional[str] = None,
        auto_create: bool = True,
        persist_conversation: bool = True,
        include_profile_context: bool = True
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
        self._last_context_diagnostics = {}
        self._cache_attribution = {}
        self._context_degraded = False
        self._telemetry = {}
        self.persist_conversation = bool(persist_conversation)
        self._include_profile_context = bool(include_profile_context)
        self._runtime_conversation_mode = "chat"
        self._runtime_conversation_mode_payload = {}
        self._runtime_longterm_prompt_block = ""
        self._runtime_longterm_hook_payload = {}
        self._runtime_longterm_task_text = ""
        self._runtime_longterm_plan_text = ""
        self._runtime_longterm_context_text = ""
        self._runtime_longterm_current_plan_text = ""
        self._runtime_learning_prompt_block = ""

        # 加载配置
        from . import model as model_runtime

        CONFIG = model_runtime.load_config()
        model_runtime.CONFIG = CONFIG
        MODEL_PERMISSIONS_PATH = model_runtime.MODEL_PERMISSIONS_PATH
        _CONTEXT_COMPRESSION_MAX_CHARS_DEFAULT = model_runtime._CONTEXT_COMPRESSION_MAX_CHARS_DEFAULT
        _CONTEXT_COMPRESSION_MAX_CHARS_MIN = model_runtime._CONTEXT_COMPRESSION_MAX_CHARS_MIN
        _CONTEXT_COMPRESSION_MAX_CHARS_MAX = model_runtime._CONTEXT_COMPRESSION_MAX_CHARS_MAX
        self.config = CONFIG

        # 确定模型名称（增加黑名单过滤逻辑）
        requested_model = model_name

        # 加载权限配置
        blacklist = []
        try:
            perm_path = MODEL_PERMISSIONS_PATH
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

        self.conversation_service = ConversationService(username)
        self.conversation_manager = ConversationManager(username)
        # 让代理与 service 共享同一底层，避免双实例状态不一致
        try:
            self.conversation_manager._svc = self.conversation_service
            self.conversation_manager.username = self.conversation_service.username
            from basis.Conversation.repository import conversation_base_path, conversation_index_path
            self.conversation_manager.base_path = conversation_base_path(self.conversation_service.username)
            self.conversation_manager.index_path = conversation_index_path(self.conversation_service.username)
        except Exception:
            pass
        self.chat_context_manager = ChatContextManager(self)

        # 对话ID管理
        if conversation_id:
            self.conversation_id = conversation_id
        elif auto_create and self.persist_conversation:
            self.conversation_id = self.conversation_service.create_conversation()
        else:
            self.conversation_id = None

        # 获取模型配置和供应商信息
        model_info = CONFIG.get('models', {}).get(self.model_name, {})
        self.model_display_name = model_info.get('name', self.model_name)
        self.provider = model_info.get('provider', 'volcengine')
        provider_info = CONFIG.get('providers', {}).get(self.provider, {})
        self.provider_display_name = provider_info.get('name', self.provider)
        self._context_window_limit_source = "unknown"
        self._context_window_limit_from_fallback_default = False
        cfg_compress_chars = self.config.get("context_compression_max_chars", _CONTEXT_COMPRESSION_MAX_CHARS_DEFAULT)
        env_compress_chars = os.environ.get("NEXORA_CONTEXT_COMPRESSION_MAX_CHARS", "").strip()
        if env_compress_chars:
            cfg_compress_chars = env_compress_chars
        try:
            cfg_compress_chars = int(cfg_compress_chars or _CONTEXT_COMPRESSION_MAX_CHARS_DEFAULT)
        except Exception:
            cfg_compress_chars = _CONTEXT_COMPRESSION_MAX_CHARS_DEFAULT
        self._context_compression_max_chars = int(max(
            _CONTEXT_COMPRESSION_MAX_CHARS_MIN,
            min(_CONTEXT_COMPRESSION_MAX_CHARS_MAX, cfg_compress_chars)
        ))

        self._provider_adapter_cache = {}
        self.provider_adapter = create_provider_adapter(self.provider, provider_info)
        self._provider_adapter_cache[self.provider] = self.provider_adapter

        api_key = provider_info.get('api_key', "")
        base_url = provider_info.get('base_url')

        # 初始化客户端 (使用全局缓存实现连接复用)
        _CLIENT_CACHE = model_runtime._CLIENT_CACHE
        cache_key = self.provider_adapter.client_cache_key(api_key, scope="primary", base_url=base_url)

        if cache_key in _CLIENT_CACHE:
            self.client = _CLIENT_CACHE[cache_key]
        else:
            # 首次连接
            print(f"[INIT] Creating new {self.provider} client connection")

            self.client = self.provider_adapter.create_client(
                api_key=api_key,
                base_url=base_url,
                timeout=120.0
            )
            _CLIENT_CACHE[cache_key] = self.client

        # 系统提示词模板（支持 {{var}} 模板变量），按请求期开关动态拼接。
        # NexoraCode 项目上下文由 server 层写入此 runtime block，随每次请求重建拼接。
        self._runtime_project_context_block = ""
        self._runtime_nexoracode_project_path = ""
        self._runtime_project_excluded_tool_names: Set[str] = set()
        self._runtime_project_force_tools = False
        self.system_prompt_template = str(system_prompt or "").strip() if system_prompt else self._get_default_system_prompt_template()
        self.system_prompt = self._build_effective_system_prompt()

        # 模型适配器（provider 级）配置
        self.model_adapter_config = self._load_model_adapter_runtime_config()
        self.provider_model_adapter = self._get_provider_model_adapter(self.provider)
        self.native_search_tools = self._get_provider_native_tools(self.provider)
        self.native_web_search_enabled = any(
            str(t.get("type", "")).strip() == "web_search"
            for t in self.native_search_tools
        )
        try:
            log_status = str(CONFIG.get("log_status", "silent") or "silent").strip().lower()
            if log_status in {"all", "debug", "verbose"}:
                native_flag = self._adapter_flag(
                    self.provider_model_adapter, "native_enabled", fallback_key="enabled", default=False
                )
                relay_flag = self._adapter_flag(
                    self.provider_model_adapter, "relay_enabled", fallback_key="enabled", default=False
                )
                allowed = self._is_model_allowed_by_adapter(self.provider_model_adapter)
                print(
                    f"[MODEL_ADAPTER] provider={self.provider} model={self.model_name} "
                    f"native_enabled={native_flag} relay_enabled={relay_flag} "
                    f"allowed={allowed} native_web_search_enabled={self.native_web_search_enabled} "
                    f"native_tools={[str(t.get('type','')) for t in self.native_search_tools]}"
                )
        except Exception:
            pass

        # 工具定义
        self.tools = self._parse_tools(get_tools_for_config(self.config))
        self.tool_executor = ToolExecutor(self)
        self.tool_result_presenter = ToolResultPresenter()
        self._external_tool_definitions: List[Dict[str, Any]] = []
        self._external_tool_names: Set[str] = set()
        self._exclusive_external_tool_names: Set[str] = set()
        self._require_function_tool_call = False
        self._usage_action_type = "chat"
        self._usage_metadata: Dict[str, Any] = {}
        self._usage_observer = None
        self._runtime_tool_catalog = []
        self._runtime_selected_tool_names = set()
        self._runtime_tool_mode = "force"
        self._runtime_bootstrap_tool_name = "runtime_tool_enable"
        # Select Tools 已下线：以下旧状态字段保留注释，避免误以为仍有精确选工具链路。
        # self._runtime_selector_enabled = False
        # self._runtime_tool_catalog_by_id = {}
        # self._runtime_tool_catalog_by_name = {}
        # self._runtime_tool_selector_hint = ""
        # self._runtime_selected_tool_ids = []
        # self._runtime_tool_selection_changed = False
        # self._runtime_hints_injected_in_request = False
        self._longdoc_skill_catalog: List[Dict[str, Any]] = []
        self._temp_context_store = None
        self._temp_context_scope_id = ""
        self._temp_context_settings = {}
        # 工具结果展示：文本与媒体分轨保存，供前端分别渲染
        self._pending_display_results: Dict[str, str] = {}
        self._pending_display_media: Dict[str, Dict[str, Any]] = {}
        # 工具图片只在当前回复的下一轮请求中使用，不进入工具结果字符串或会话历史。
        self._pending_tool_image_inputs: Dict[str, List[Dict[str, Any]]] = {}
        self._model_vision_input_capability: Optional[bool] = None
