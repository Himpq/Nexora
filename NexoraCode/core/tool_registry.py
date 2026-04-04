"""
工具注册器：管理所有本地工具的注册、发现和调用
"""

import importlib
import sys
import traceback
from pathlib import Path
from typing import Any

# Explicit imports help PyInstaller include tool modules in packaged builds.
try:
    from tools import catalog as _tool_catalog  # noqa: F401
    from tools import shell as _tool_shell  # noqa: F401
    from tools import file_ops as _tool_file_ops  # noqa: F401
    from tools import renderer as _tool_renderer  # noqa: F401
    from tools import long_context as _tool_long_context  # noqa: F401
except Exception:
    pass


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, dict] = {}
        self._auto_discover()

    def _auto_discover(self):
        """从 tools/catalog.py 加载工具定义。"""
        tools_dir = Path(__file__).parent.parent / "tools"
        try:
            catalog_mod = importlib.import_module("tools.catalog")
            tool_catalog = list(getattr(catalog_mod, "TOOL_CATALOG", []) or [])
        except Exception:
            print(f"[ToolRegistry] Failed to load tools.catalog:\n{traceback.format_exc()}")
            tool_catalog = []

        modules_cache: dict[str, Any] = {}
        for item in tool_catalog:
            try:
                if not isinstance(item, dict):
                    continue
                module_name = str(item.get("module", "") or "").strip()
                tool_name = str(item.get("name", "") or "").strip()
                handler_name = str(item.get("handler", "") or "").strip()
                if not module_name or not tool_name or not handler_name:
                    continue
                if module_name not in modules_cache:
                    modules_cache[module_name] = importlib.import_module(f"tools.{module_name}")
                module = modules_cache[module_name]
                manifest = dict(item)
                manifest.pop("module", None)
                self._tools[tool_name] = {
                    "manifest": manifest,
                    "handler": getattr(module, handler_name),
                }
            except Exception:
                print(f"[ToolRegistry] Failed to load tool item {item}:\n{traceback.format_exc()}")

        if not self._tools:
            mode = "frozen" if bool(getattr(sys, "frozen", False)) else "source"
            print(f"[ToolRegistry] WARNING: no tools loaded (mode={mode}, tools_dir={tools_dir})")

    def list_tools(self) -> list[dict]:
        """返回原始 manifest 格式（调试/内部用）"""
        return [t["manifest"] for t in self._tools.values()]

    def list_tools_llm_format(self) -> list[dict]:
        """返回 OpenAI-compatible 格式工具定义（供 LLM 调用，注册到 Nexora 服务器）"""
        result = []
        for t in self._tools.values():
            m = t["manifest"]
            result.append({
                "type": "function",
                "function": {
                    "name": m["name"],
                    "description": m.get("description", ""),
                    "parameters": m.get("parameters", {"type": "object", "properties": {}}),
                },
            })
        return result

    def execute(self, tool_name: str, params: dict) -> dict[str, Any]:
        if tool_name not in self._tools:
            return {"success": False, "error": f"Unknown tool: {tool_name}"}
        try:
            result = self._tools[tool_name]["handler"](**params)
            
            # buffer long strings
            try:
                from tools.long_context import process_large_output
                if isinstance(result, str) and len(result) > 10000:
                    result = process_large_output(result)
                elif isinstance(result, dict):
                    # Check if any string value is very long, specifically 'content'
                    if "content" in result and isinstance(result["content"], str) and len(result["content"]) > 10000:
                        result["content"] = process_large_output(result["content"])
                    else:
                        for k, v in result.items():
                            if isinstance(v, str) and len(v) > 40000:
                                result[k] = process_large_output(v)
            except Exception:
                pass
                
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e), "traceback": traceback.format_exc()}
