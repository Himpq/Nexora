"""
Nexora.app.Executor — 工具执行层

承载工具执行与文档生成：
- tool_executor.py: 工具执行器（ToolExecutor）
- document_generation.py: 文档生成（DocumentGenerationService）
- longdoc_skills.py: 长文档技能

对外提供：
- ToolExecutor / DocumentGenerationService / read_longdoc_skill
"""
from .tool_executor import ToolExecutor
from .document_generation import DocumentGenerationService
from .longdoc_skills import (
    build_longdoc_skill_index,
    load_longdoc_skill_catalog,
    public_longdoc_skill_rows,
    read_longdoc_skill,
    render_longdoc_template,
)

__all__ = [n for n in globals() if not n.startswith('_')]
