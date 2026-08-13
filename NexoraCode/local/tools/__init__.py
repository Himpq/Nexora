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
from .PermissionTool import PermissionGrantTool, PermissionListTool
from .ImageSearchTool import ImageSearchTool
from .BrowserTool import (
    BrowserCloseTool,
    BrowserClickTool,
    BrowserEvalTool,
    BrowserInputTool,
    BrowserListTool,
    BrowserOpenTool,
    BrowserReadTool,
    BrowserScrollTool,
)
from .LongContextTool import ContextClearTool, ContextReadTool


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
    PermissionGrantTool(),
    PermissionListTool(),
    ImageSearchTool(),
    BrowserOpenTool(),
    BrowserReadTool(),
    BrowserClickTool(),
    BrowserInputTool(),
    BrowserEvalTool(),
    BrowserScrollTool(),
    BrowserListTool(),
    BrowserCloseTool(),
    ContextReadTool(),
    ContextClearTool(),
]

# 旧名兼容映射集中在各工具类 aliases 上（见工具定义）；
# 保留空常量供执行器统一注册，便于后续追加跨工具别名。
TOOL_ALIASES: dict[str, str] = {}
