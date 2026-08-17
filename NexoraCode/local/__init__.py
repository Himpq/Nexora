"""
NexoraCode.local — NexoraCode 本地基础层

与 ChatDBServer 的 Nexora.basis 分层对应，收纳与具体 UI / WSS 调度解耦的本地基础能力：
- Schema: 轻量 JSON Schema 子集校验器
- Tool: 工具基类（schema 与实现合一）
- ToolExecutor: 工具执行器（注册 / 校验 / 线程池 / 大输出 / 取消）
- PathGuard: 路径准入与隐私守卫
- tools: 全部本地工具实例

对外提供：
- LocalTool / ToolContext: 工具基类与上下文
- ToolExecutor / build_default_executor: 执行器与默认构建入口
"""

from __future__ import annotations

from .Schema import build_parameters_schema, validate_parameters
from .Tool import LocalTool, ToolContext
from .ToolExecutor import ToolExecutor, build_default_executor
from .tools import TOOL_ALIASES, TOOLS
