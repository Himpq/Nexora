"""
NexoraCode.local.tools — 本地工具集

全部本地工具的注册清单与额外别名：
- TOOLS: 工具实例列表，由 ToolExecutor.build_default_executor 注册
- TOOL_ALIASES: 旧工具名的额外映射（各工具类 aliases 之外的补充）

新增工具只需：在 tools/ 下新建 LocalTool 子类，加入 TOOLS 即可。
"""

from __future__ import annotations

from .FileTool import (
    FileListTool,
    FilePatchTool,
    FileProbeTool,
    FileReadTool,
    FileWriteTool,
)
from .ShellTool import ShellExecTool
from .TerminalTool import TerminalTool
from .ProcessTool import ProcessManagerTool
from .SearchTool import FileSearchTreeTool, TextSearchTool
from .CodeScanTool import CodeScanTool
from .ContextTool import ContextLengthTool, ContextReadTool, ContextSearchTool
from .PermissionTool import PermissionGrantTool, PermissionListTool
# ImageSearchTool 已停用：图片搜索不再在用户本机执行，后续计划接入 Exa Web Search。
# 该模块顶部会导入 tools.imgspd → playwright / crawlee，属于重量级依赖；
# 工具已不注册，这里同步断开导入，避免启动时加载无用依赖。
# 后续接入 Exa 时新增独立工具，不要恢复本行。
# from .ImageSearchTool import ImageSearchTool
from .BrowserTool import (
    BrowserCloseTool,
    BrowserClickTool,
    BrowserEvalTool,
    BrowserInputTool,
    BrowserListTool,
    BrowserOpenTool,
    BrowserReadTool,
    # BrowserScrollTool,
)


TOOLS = [
    FileReadTool(),
    FileProbeTool(),
    FileWriteTool(),
    FileListTool(),
    FilePatchTool(),
    ShellExecTool(),
    TerminalTool(),
    ProcessManagerTool(),
    TextSearchTool(),
    FileSearchTreeTool(),
    CodeScanTool(),
    ContextLengthTool(),
    ContextReadTool(),
    ContextSearchTool(),
    PermissionGrantTool(),
    PermissionListTool(),
    # ImageSearchTool(),
    BrowserOpenTool(),
    BrowserReadTool(),
    BrowserClickTool(),
    BrowserInputTool(),
    BrowserEvalTool(),
    # BrowserScrollTool(),
    BrowserListTool(),
    BrowserCloseTool(),
]

# 旧名兼容映射集中在各工具类 aliases 上（见工具定义）；
# 保留空常量供执行器统一注册，便于后续追加跨工具别名。
TOOL_ALIASES: dict[str, str] = {}
