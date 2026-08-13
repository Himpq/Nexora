"""
NexoraCode.local.ToolExecutor — 本地工具执行器

职责：
- 工具注册 / 别名解析 / LLM 格式导出
- 参数 schema 校验（校验失败返回精确错误，不再抛 TypeError）
- 线程池限并发执行，支持单次超时
- 大输出自动截断到长上下文存储
- 统一返回 {"success", "result"/"error"}，兼容服务器侧 WSS 结果处理

对外提供：
- ToolExecutor: 执行器类
- build_default_executor: 构建并注册全部本地工具的默认实例
"""

from __future__ import annotations

import traceback
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from typing import Any, Optional

from .Schema import validate_parameters
from .Tool import LocalTool, ToolContext
from .LongContext import process_large_output


class ToolExecutor:
    def __init__(self, *, max_workers: int = 8):
        self._tools: dict[str, LocalTool] = {}
        self._aliases: dict[str, str] = {}
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="nc-tool")
        self._content_output_limit = 10000
        self._output_limit = 40000

    def register(self, tool: LocalTool) -> None:
        """注册单个工具；工具的 aliases 同时登记为别名。"""

        if not isinstance(tool, LocalTool) or not str(tool.name or "").strip():
            return

        self._tools[tool.name] = tool

        for alias in tool.aliases:
            alias_text = str(alias or "").strip()

            if alias_text:
                self._aliases[alias_text] = tool.name

    def register_aliases(self, alias_map: dict) -> None:
        """注册额外别名（旧工具名平滑映射到新工具名）。"""

        for raw, target in (alias_map or {}).items():
            raw_text = str(raw or "").strip()
            target_text = str(target or "").strip()

            if raw_text and target_text:
                self._aliases[raw_text] = target_text

    def register_all(self, tools) -> None:
        """批量注册工具。"""

        for tool in tools:
            self.register(tool)

    def resolve(self, raw_name: str) -> Optional[LocalTool]:
        """解析工具名（含别名链），未命中返回 None。"""

        name = str(raw_name or "").strip()

        if not name:
            return None

        seen = set()

        while name in self._aliases and name not in seen:
            seen.add(name)
            name = str(self._aliases.get(name) or "").strip()

        return self._tools.get(name)

    def list_tools(self) -> list[dict]:
        """返回全部非隐藏工具的原始 manifest（调试 / 内部用）。"""

        return [tool.parameters for tool in self._tools.values() if not tool.hidden]

    def list_tools_llm_format(self) -> list[dict]:
        """返回 OpenAI-compatible 格式工具定义，供注册到 Nexora 服务器。"""

        result = []

        for tool in self._tools.values():

            if tool.hidden:
                continue

            result.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            })

        return result

    def execute(
        self,
        tool_name: str,
        args: Any,
        context: Any = None,
        *,
        timeout: float | None = None,
    ) -> dict:
        """执行一次工具调用。

        Args:
            tool_name: 工具名或旧别名
            args: 模型传入的参数 dict
            context: 调用上下文（dict 或 ToolContext），含 conversation_id / is_cancelled
            timeout: 可选执行超时秒数，超时返回错误（线程无法强杀，仅放弃等待）

        Returns:
            {"success", "result"} 成功；{"success": False, "error", ...} 失败。
        """

        tool = self.resolve(tool_name)

        if tool is None:
            return {"success": False, "error": f"Unknown tool: {tool_name}"}

        payload = args if isinstance(args, dict) else {}
        normalized, errors = validate_parameters(payload, tool.parameters)

        if errors:
            return self._validation_failure(tool.name, errors)

        tool_context = ToolContext.from_dict(context)

        try:
            result = self._invoke(tool, normalized, tool_context, timeout=timeout)
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            }

        if not isinstance(result, dict):
            return {"success": True, "result": result}

        result = self._cap_large_values(result)

        # 兼容不带 success 字段的工具返回：存在 error 键即视为失败
        if result.get("success") is None:
            result["success"] = not bool(result.get("error"))

        if result.get("success") is False:
            return {
                "success": False,
                "error": str(result.get("error") or "工具执行失败"),
                "result": result,
            }

        return {"success": True, "result": result}

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    def _validation_failure(self, tool_name: str, errors: list[str]) -> dict:
        error_text = "；".join(errors)
        payload = {
            "success": False,
            "error": error_text,
            "validation_errors": errors,
            "tool": tool_name,
        }

        return {
            "success": False,
            "error": f"参数校验失败：{error_text}",
            "validation_errors": errors,
            "result": payload,
        }

    def _invoke(self, tool: LocalTool, args: dict, context: ToolContext, timeout: float | None) -> Any:
        future = self._pool.submit(tool.run, args, context)

        if timeout and float(timeout) > 0:
            try:
                return future.result(timeout=float(timeout))
            except FutureTimeoutError:
                return {
                    "success": False,
                    "error": f"工具执行超时（>{int(timeout)} 秒）",
                }

        return future.result()

    def _cap_large_values(self, value: Any) -> Any:
        """递归截断超长字符串：content 字段阈值更低，其余字段按通用阈值。"""

        if isinstance(value, str):
            return process_large_output(value) if len(value) > self._output_limit else value

        if isinstance(value, list):
            return [self._cap_large_values(item) for item in value]

        if isinstance(value, dict):
            output = {}

            for key, item in value.items():
                if key == "content" and isinstance(item, str):
                    output[key] = process_large_output(item) if len(item) > self._content_output_limit else item
                else:
                    output[key] = self._cap_large_values(item)

            return output

        return value


def build_default_executor(**kwargs) -> ToolExecutor:
    """构建并注册全部本地工具的执行器。"""

    from .tools import TOOL_ALIASES, TOOLS

    executor = ToolExecutor(**kwargs)
    executor.register_all(TOOLS)
    executor.register_aliases(TOOL_ALIASES)
    return executor
