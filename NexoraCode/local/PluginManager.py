"""NexoraCode local plugin host.

Plugins are installed as directories below ``<app_root>/plugins/<plugin_id>``.
Each directory contains a manifest and may contribute Python tools/routes, UI
assets/pages, and a JSON-Schema-like settings form. Python plugins run in the
NexoraCode process and therefore must be trusted by the user.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import types
from pathlib import Path
from typing import Any, Callable

from core.config import get_app_root, get_bundle_root
from .Tool import LocalTool


PLUGIN_API_VERSION = 1
_PLUGIN_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{1,63}$")
_VALID_OPERATIONS = {"read", "write", "command", "network"}


def _safe_relative_file(root: Path, relative: Any) -> Path | None:
    text = str(relative or "").strip().replace("\\", "/")
    if not text or text.startswith("/") or ".." in text.split("/"):
        return None
    try:
        root_resolved = root.resolve()
        target = (root / text).resolve()
        if target != root_resolved and root_resolved not in target.parents:
            return None
        return target
    except Exception:
        return None


def _normalize_schema(value: Any) -> dict:
    schema = value if isinstance(value, dict) else {}
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        properties = {}
    return {
        "type": "object",
        "title": str(schema.get("title") or "插件设置")[:120],
        "description": str(schema.get("description") or "")[:500],
        "properties": {
            str(key): dict(rule)
            for key, rule in properties.items()
            if isinstance(key, str) and isinstance(rule, dict)
        },
        "required": [str(item) for item in schema.get("required", []) if str(item)]
        if isinstance(schema.get("required", []), list)
        else [],
    }


class PluginAPI:
    """Capabilities handed to one plugin's ``register(api)`` entry point."""

    def __init__(self, plugin: dict):
        self.plugin = plugin
        self.tools: list[LocalTool] = []
        self.routes: list[dict] = []
        ui = plugin["manifest"].get("ui", {})
        self.pages = [dict(item) for item in ui.get("pages", []) if isinstance(item, dict)]
        self.settings_schema = _normalize_schema(plugin["manifest"].get("settings", {}))

    def register_tool(self, tool: LocalTool) -> None:
        if not isinstance(tool, LocalTool):
            raise TypeError("plugin tools must inherit LocalTool")
        if not str(getattr(tool, "name", "") or "").strip():
            raise ValueError("plugin tool needs a name")
        capabilities = set(self.plugin["manifest"].get("capabilities", []))
        operation = str(getattr(tool, "permission_operation", "write") or "write").lower()
        if operation not in _VALID_OPERATIONS:
            raise ValueError(f"unsupported plugin tool permission operation: {operation}")
        if operation in {"network", "command"} and operation not in capabilities:
            raise ValueError(f"plugin manifest must declare the {operation} capability")
        declared_surfaces = self.plugin["manifest"].get("surfaces", ["local"])
        if not isinstance(declared_surfaces, list):
            declared_surfaces = ["local"]
        surfaces = tuple(
            surface for surface in declared_surfaces
            if surface in {"local", "remote"}
        ) or ("local",)
        tool.plugin_id = self.plugin["id"]
        tool.surfaces = surfaces
        self.tools.append(tool)

    def register_page(self, page: dict) -> None:
        if not isinstance(page, dict):
            raise TypeError("plugin page must be an object")
        self.pages.append(dict(page))

    def register_settings(self, schema: dict) -> None:
        self.settings_schema = _normalize_schema(schema)

    def register_route(
        self,
        rule: str,
        handler: Callable,
        *,
        methods: tuple[str, ...] | list[str] = ("GET",),
    ) -> None:
        route = str(rule or "").strip()
        if not route.startswith("/") or ".." in route.split("/"):
            raise ValueError("plugin route must be an absolute path without '..'")
        if not callable(handler):
            raise TypeError("plugin route handler must be callable")
        clean_methods = tuple(
            str(method).upper() for method in methods
            if str(method).upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}
        )
        if not clean_methods:
            raise ValueError("plugin route needs an allowed HTTP method")
        self.routes.append({"rule": route, "handler": handler, "methods": clean_methods})

    def get_settings(self) -> dict:
        return self.plugin["manager"].get_runtime_settings(self.plugin["id"])


class PluginManager:
    """Discovers installed plugins and exposes their registered contributions."""

    def __init__(self, plugins_root: Path | None = None, data_root: Path | None = None):
        app_root = get_app_root()
        self.plugins_root = (plugins_root or app_root / "plugins").resolve()
        bundled_root = (get_bundle_root() / "plugins").resolve()
        self.plugin_roots = list(dict.fromkeys((self.plugins_root, bundled_root)))
        self.data_root = (data_root or app_root / "data" / "plugins").resolve()
        self.state_path = self.data_root / "registry.json"
        self._state = self._read_state()
        self._plugins: dict[str, dict] = {}
        self._discover()

    def _read_state(self) -> dict:
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and isinstance(payload.get("plugins"), dict):
                return payload
        except (OSError, ValueError):
            pass
        return {"plugins": {}}

    def _write_state(self) -> None:
        self.data_root.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self._state, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.state_path)

    def _is_enabled(self, plugin_id: str, manifest: dict) -> bool:
        stored = self._state["plugins"].get(plugin_id)
        if isinstance(stored, dict) and isinstance(stored.get("enabled"), bool):
            return stored["enabled"]
        return bool(manifest.get("enabled_by_default", False))

    def _discover(self) -> None:
        for plugin_root in self.plugin_roots:
            if not plugin_root.is_dir():
                continue
            for directory in sorted(plugin_root.iterdir(), key=lambda item: item.name.casefold()):
                if (
                    not directory.is_dir()
                    or not _PLUGIN_ID_RE.fullmatch(directory.name)
                    or directory.name in self._plugins
                ):
                    continue
                try:
                    resolved_root = directory.resolve()
                    if resolved_root.parent != plugin_root:
                        continue
                    manifest_path = resolved_root / "manifest.json"
                    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                    if not isinstance(manifest, dict):
                        raise ValueError("manifest must be a JSON object")
                    plugin_id = str(manifest.get("id") or "").strip()
                    if plugin_id != directory.name or not _PLUGIN_ID_RE.fullmatch(plugin_id):
                        raise ValueError("manifest id must match its plugin directory")
                    api_version = int(manifest.get("api_version", 0))
                    if api_version != PLUGIN_API_VERSION:
                        raise ValueError(f"plugin API version {api_version} is unsupported")
                    ui = manifest.get("ui", {})
                    if not isinstance(ui, dict):
                        raise ValueError("manifest ui must be an object")
                    self._validate_ui_contributions(resolved_root, ui)
                    record = {
                        "id": plugin_id,
                        "name": str(manifest.get("name") or plugin_id)[:120],
                        "version": str(manifest.get("version") or "0.0.0")[:64],
                        "description": str(manifest.get("description") or "")[:500],
                        "root": resolved_root,
                        "manifest": manifest,
                        "enabled": self._is_enabled(plugin_id, manifest),
                        "active": False,
                        "error": "",
                        "api": None,
                        "manager": self,
                        "tools": [],
                        "routes": [],
                    }
                    self._plugins[plugin_id] = record
                except Exception as exc:
                    plugin_id = directory.name
                    self._plugins[plugin_id] = {
                        "id": plugin_id,
                        "name": plugin_id,
                        "version": "",
                        "description": "",
                        "root": directory,
                        "manifest": {},
                        "enabled": False,
                        "active": False,
                        "error": str(exc)[:500],
                        "api": None,
                        "manager": self,
                        "tools": [],
                        "routes": [],
                    }

    def _validate_ui_contributions(self, root: Path, ui: dict) -> None:
        for key in ("scripts", "styles"):
            entries = ui.get(key, [])
            if not isinstance(entries, list):
                raise ValueError(f"manifest ui.{key} must be a list")
            for entry in entries:
                path = _safe_relative_file(root, entry)
                if (
                    path is None
                    or not str(entry).replace("\\", "/").startswith("ui/")
                    or not path.is_file()
                ):
                    raise ValueError(f"ui.{key} entries must point inside ui/")
        pages = ui.get("pages", [])
        if not isinstance(pages, list):
            raise ValueError("manifest ui.pages must be a list")
        seen = set()
        for page in pages:
            if not isinstance(page, dict):
                raise ValueError("plugin page must be an object")
            page_id = str(page.get("id") or "").strip()
            if not _PLUGIN_ID_RE.fullmatch(page_id) or page_id in seen:
                raise ValueError("plugin page ids must be unique lowercase identifiers")
            seen.add(page_id)
            entry = str(page.get("entry") or "").strip()
            path = _safe_relative_file(root, entry)
            if path is None or not entry.replace("\\", "/").startswith("ui/") or not path.is_file():
                raise ValueError(f"plugin page {page_id} must point to a file inside ui/")

    def load(self, executor) -> None:
        for plugin in self._plugins.values():
            if not plugin["enabled"] or plugin["error"]:
                continue
            manifest = plugin["manifest"]
            api = PluginAPI(plugin)
            try:
                entrypoint = str(manifest.get("entrypoint") or "").strip()
                if entrypoint:
                    self._load_entrypoint(plugin, api, entrypoint)
                self._validate_ui_contributions(plugin["root"], {
                    "scripts": manifest.get("ui", {}).get("scripts", []),
                    "styles": manifest.get("ui", {}).get("styles", []),
                    "pages": api.pages,
                })
                plugin["api"] = api
                plugin["tools"] = api.tools
                plugin["routes"] = api.routes
                plugin["pages"] = api.pages
                plugin["settings_schema"] = api.settings_schema
                seen_tool_names = set()
                for tool in api.tools:
                    if tool.name in seen_tool_names or executor.resolve(tool.name):
                        raise ValueError(f"tool name already registered: {tool.name}")
                    seen_tool_names.add(tool.name)
                for tool in api.tools:
                    executor.register(tool)
                plugin["active"] = True
            except Exception as exc:
                plugin["error"] = f"启动失败：{exc}"[:500]

    def _load_entrypoint(self, plugin: dict, api: PluginAPI, entrypoint: str) -> None:
        module_name, separator, function_name = entrypoint.partition(":")
        if not separator:
            function_name = "register"
        module_file = module_name.replace("\\", "/").strip("/")
        if module_file.endswith(".py"):
            module_file = module_file[:-3]
        if "/" not in module_file:
            module_file = module_file.replace(".", "/")
        module_file += ".py"
        module_path = _safe_relative_file(plugin["root"], module_file)
        if module_path is None or not module_path.is_file():
            raise ValueError("plugin entrypoint file not found")
        package_name = f"_nexoracode_plugin_{plugin['id'].replace('-', '_')}"
        package = types.ModuleType(package_name)
        package.__path__ = [str(plugin["root"])]
        package.__package__ = package_name
        sys.modules[package_name] = package
        import_name = f"{package_name}.{module_path.stem}"
        spec = importlib.util.spec_from_file_location(import_name, module_path)
        if spec is None or spec.loader is None:
            raise ImportError("could not load plugin entrypoint")
        module = importlib.util.module_from_spec(spec)
        sys.modules[import_name] = module
        spec.loader.exec_module(module)
        register = getattr(module, function_name, None)
        if not callable(register):
            raise ValueError(f"plugin entrypoint function '{function_name}' is missing")
        result = register(api)
        if isinstance(result, LocalTool):
            api.register_tool(result)
        elif isinstance(result, (list, tuple)):
            for item in result:
                if isinstance(item, LocalTool):
                    api.register_tool(item)

    def get(self, plugin_id: str) -> dict | None:
        return self._plugins.get(str(plugin_id or "").strip())

    def list_plugins(self) -> list[dict]:
        items = []
        for plugin in self._plugins.values():
            manifest = plugin["manifest"]
            items.append({
                "id": plugin["id"],
                "name": plugin["name"],
                "version": plugin["version"],
                "description": plugin["description"],
                "enabled": plugin["enabled"],
                "active": plugin["active"],
                "error": plugin["error"],
                "capabilities": list(manifest.get("capabilities", [])) if isinstance(manifest, dict) else [],
                "surfaces": list(manifest.get("surfaces", ["local"])) if isinstance(manifest, dict) else [],
                "settings_schema": plugin.get("settings_schema") or _normalize_schema(manifest.get("settings", {})),
            })
        return items

    def frontend_plugins(self) -> list[dict]:
        result = []
        for plugin in self._plugins.values():
            if not plugin["active"]:
                continue
            ui = plugin["manifest"].get("ui", {})
            result.append({
                "id": plugin["id"],
                "name": plugin["name"],
                "scripts": list(ui.get("scripts", [])),
                "styles": list(ui.get("styles", [])),
                "pages": plugin.get("pages", []),
            })
        return result

    def set_enabled(self, plugin_id: str, enabled: bool) -> None:
        plugin = self.get(plugin_id)
        if plugin is None:
            raise ValueError("插件未安装")
        if enabled and plugin["error"]:
            raise ValueError("插件有错误，修复后才能启用")
        state = self._state["plugins"].setdefault(plugin["id"], {})
        state["enabled"] = bool(enabled)
        self._write_state()
        plugin["enabled"] = bool(enabled)

    def get_settings(self, plugin_id: str) -> dict:
        plugin = self.get(plugin_id)
        if plugin is None or plugin["error"]:
            raise ValueError("插件未安装或 manifest 无效")
        schema = plugin.get("settings_schema") or _normalize_schema(plugin["manifest"].get("settings", {}))
        path = self.data_root / plugin["id"] / "settings.json"
        try:
            saved = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(saved, dict):
                saved = {}
        except (OSError, ValueError):
            saved = {}
        values = {}
        secrets_set = []
        for key, rule in schema["properties"].items():
            value = saved.get(key, rule.get("default", ""))
            if rule.get("secret") or rule.get("type") == "password":
                if value:
                    secrets_set.append(key)
                value = ""
            values[key] = value
        return {"schema": schema, "values": values, "secrets_set": secrets_set}

    def get_runtime_settings(self, plugin_id: str) -> dict:
        """Return settings to trusted in-process plugin code, including secret values."""
        plugin = self.get(plugin_id)
        if plugin is None or plugin["error"]:
            raise ValueError("插件未安装或 manifest 无效")
        schema = plugin.get("settings_schema") or _normalize_schema(plugin["manifest"].get("settings", {}))
        path = self.data_root / plugin["id"] / "settings.json"
        try:
            saved = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(saved, dict):
                saved = {}
        except (OSError, ValueError):
            saved = {}
        values = {
            key: saved.get(key, rule.get("default", ""))
            for key, rule in schema["properties"].items()
        }
        return {"schema": schema, "values": values}

    def save_settings(self, plugin_id: str, values: Any) -> dict:
        plugin = self.get(plugin_id)
        if plugin is None or plugin["error"]:
            raise ValueError("插件未安装或 manifest 无效")
        if not isinstance(values, dict):
            raise ValueError("settings must be an object")
        schema = plugin.get("settings_schema") or _normalize_schema(plugin["manifest"].get("settings", {}))
        path = self.data_root / plugin["id"] / "settings.json"
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(current, dict):
                current = {}
        except (OSError, ValueError):
            current = {}
        properties = schema["properties"]
        unknown = set(values) - set(properties)
        if unknown:
            raise ValueError(f"unknown plugin settings: {', '.join(sorted(unknown))}")
        updated = dict(current)
        errors = []
        for key, rule in properties.items():
            if key not in values:
                continue
            value = values[key]
            if rule.get("secret") or rule.get("type") == "password":
                if value in (None, ""):
                    continue
            expected = str(rule.get("type") or "string")
            if expected == "boolean" and not isinstance(value, bool):
                errors.append(f"{key} must be boolean")
                continue
            if expected in {"integer", "number"}:
                try:
                    value = int(value) if expected == "integer" else float(value)
                except (TypeError, ValueError):
                    errors.append(f"{key} must be {expected}")
                    continue
                if rule.get("minimum") is not None and value < rule["minimum"]:
                    errors.append(f"{key} is below minimum")
                if rule.get("maximum") is not None and value > rule["maximum"]:
                    errors.append(f"{key} is above maximum")
            elif expected in {"string", "password"}:
                if not isinstance(value, str):
                    errors.append(f"{key} must be a string")
                    continue
                value = value[:int(rule.get("maxLength", 4000) or 4000)]
            choices = rule.get("enum")
            if isinstance(choices, list) and value not in choices:
                errors.append(f"{key} is not an allowed value")
                continue
            updated[key] = value
        for key in schema["required"]:
            value = updated.get(key)
            if value is None or (isinstance(value, str) and not value.strip()):
                errors.append(f"{key} is required")
        if errors:
            raise ValueError("; ".join(errors))
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(updated, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
        return self.get_settings(plugin_id)

    def resolve_ui_asset(self, plugin_id: str, asset_path: str) -> Path | None:
        plugin = self.get(plugin_id)
        if plugin is None or not plugin["active"]:
            return None
        normalized = str(asset_path or "").replace("\\", "/").lstrip("/")
        if not normalized.startswith("ui/"):
            return None
        target = _safe_relative_file(plugin["root"], normalized)
        return target if target is not None and target.is_file() else None

    def register_routes(self, app) -> None:
        for plugin in self._plugins.values():
            if not plugin["active"]:
                continue
            for index, route in enumerate(plugin.get("routes", [])):
                endpoint = f"nexora_plugin_{plugin['id']}_{index}"
                full_rule = f"/api/plugins/{plugin['id']}{route['rule']}"
                app.add_url_rule(
                    full_rule,
                    endpoint,
                    route["handler"],
                    methods=list(route["methods"]),
                )

