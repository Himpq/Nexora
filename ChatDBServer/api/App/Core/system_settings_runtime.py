"""
系统设置保存后的进程内同步器。

职责边界：
- 刷新模型模块的运行时配置引用。
- 清理当前进程内的客户端连接缓存。
- 通知需要重连的后台监听线程。
"""
import importlib
import sys
from typing import Any, Callable, Dict, List, Optional


class SystemSettingsRuntimeSyncer:
    """将管理员系统设置同步到当前 Python 进程。"""

    def __init__(self, model_module_name: str = "App.Core.model"):
        self.model_module_name = model_module_name

    def sync_after_save(
        self,
        *,
        saved_config: Dict[str, Any],
        previous_config: Optional[Dict[str, Any]] = None,
        server_client_cache: Optional[Dict[str, Any]] = None,
        start_mail_event_stream: Optional[Callable[[], None]] = None,
        notify_mail_event_stream_config_changed: Optional[Callable[[], int]] = None,
        invalidate_all_mail_cache: Optional[Callable[[], int]] = None,
    ) -> Dict[str, Any]:
        """
        系统设置落盘后执行当前进程可立即完成的同步动作。

        返回 actions 供前端展示；发生异常时直接抛出，由接口层返回明确错误。
        """
        actions: List[str] = []

        model_module = self._reload_model_runtime_config()
        actions.append("模型运行时配置")

        cleared_count = self._clear_client_caches(model_module, server_client_cache)
        if cleared_count > 0:
            actions.append(f"客户端连接缓存({cleared_count})")

        mail_changed = self._mail_settings_changed(previous_config, saved_config)

        if mail_changed and notify_mail_event_stream_config_changed:
            version = notify_mail_event_stream_config_changed()
            actions.append(f"邮件事件监听重连信号(v{version})")

        if mail_changed and invalidate_all_mail_cache:
            invalidated_count = invalidate_all_mail_cache()
            actions.append(f"邮件缓存({invalidated_count})")

        if self._mail_event_stream_should_run(saved_config) and start_mail_event_stream:
            start_mail_event_stream()
            actions.append("邮件事件监听线程")

        return {
            "success": True,
            "actions": actions,
        }

    def _reload_model_runtime_config(self):
        module = sys.modules.get(self.model_module_name)

        if module is None:
            module = importlib.import_module(self.model_module_name)

        load_config = getattr(module, "load_config", None)

        if not callable(load_config):
            raise RuntimeError(f"{self.model_module_name}.load_config 不存在，无法同步模型运行时配置")

        runtime_config = load_config()

        if not isinstance(runtime_config, dict):
            raise RuntimeError(f"{self.model_module_name}.load_config 返回值不是配置对象")

        setattr(module, "CONFIG", runtime_config)
        return module

    def _clear_client_caches(self, model_module: Any, server_client_cache: Optional[Dict[str, Any]]) -> int:
        cleared_count = 0

        model_client_cache = getattr(model_module, "_CLIENT_CACHE", None)
        if isinstance(model_client_cache, dict):
            cleared_count += len(model_client_cache)
            model_client_cache.clear()

        if isinstance(server_client_cache, dict):
            cleared_count += len(server_client_cache)
            server_client_cache.clear()

        return cleared_count

    def _mail_settings_changed(
        self,
        previous_config: Optional[Dict[str, Any]],
        saved_config: Dict[str, Any],
    ) -> bool:
        if not isinstance(previous_config, dict):
            return True

        previous_mail = previous_config.get("nexora_mail")
        saved_mail = saved_config.get("nexora_mail")

        if not isinstance(previous_mail, dict) or not isinstance(saved_mail, dict):
            return previous_mail != saved_mail

        watched_keys = (
            "nexora_mail_enabled",
            "host",
            "port",
            "api_key",
            "service_url",
            "timeout",
            "send_timeout",
            "default_group",
        )

        for key in watched_keys:
            if previous_mail.get(key) != saved_mail.get(key):
                return True

        return False

    def _mail_event_stream_should_run(self, saved_config: Dict[str, Any]) -> bool:
        mail_config = saved_config.get("nexora_mail") if isinstance(saved_config, dict) else {}

        if not isinstance(mail_config, dict):
            return False

        enabled = bool(mail_config.get("nexora_mail_enabled", False))
        api_key = str(mail_config.get("api_key", "") or "").strip()

        return enabled and bool(api_key)
