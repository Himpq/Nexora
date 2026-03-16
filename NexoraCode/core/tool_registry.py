"""
工具注册器：管理所有本地工具的注册、发现和调用
"""

import importlib
import pkgutil
import sys
import traceback
from pathlib import Path
from typing import Any

# Explicit imports help PyInstaller include tool modules in packaged builds.
try:
    from tools import shell as _tool_shell  # noqa: F401
    from tools import file_ops as _tool_file_ops  # noqa: F401
    from tools import renderer as _tool_renderer  # noqa: F401
except Exception:
    pass


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, dict] = {}
        self._auto_discover()

    def _auto_discover(self):
        """自动加载 tools/ 目录下所有工具模块"""
        module_names: set[str] = set()

        # 1) Normal source layout discovery.
        tools_dir = Path(__file__).parent.parent / "tools"
        for path in tools_dir.glob("*.py"):
            stem = str(path.stem or "").strip()
            if not stem or stem.startswith("_"):
                continue
            module_names.add(f"tools.{stem}")

        # 2) Packaged discovery via package metadata.
        try:
            tools_pkg = importlib.import_module("tools")
            for mod in pkgutil.iter_modules(getattr(tools_pkg, "__path__", [])):
                name = str(getattr(mod, "name", "") or "").strip()
                if not name or name.startswith("_"):
                    continue
                module_names.add(f"tools.{name}")
        except Exception:
            pass

        # 3) Explicit fallback list (important when frozen import graph is trimmed).
        for name in ("tools.shell", "tools.file_ops", "tools.renderer"):
            module_names.add(name)

        for mod_name in sorted(module_names):
            try:
                module = importlib.import_module(mod_name)
                if not hasattr(module, "TOOL_MANIFEST"):
                    continue
                for manifest in module.TOOL_MANIFEST:
                    self._tools[manifest["name"]] = {
                        "manifest": manifest,
                        "handler": getattr(module, manifest["handler"]),
                    }
            except Exception:
                print(f"[ToolRegistry] Failed to load {mod_name}:\n{traceback.format_exc()}")

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
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e), "traceback": traceback.format_exc()}
