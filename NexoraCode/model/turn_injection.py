"""
NexoraCode.model.turn_injection — tail volatile 注入块：常量、diff 与基线快照

职责：
- 收敛 volatile 注入块的标记常量（新增通道只改这里）
- 按「基线快照 + 哈希比对」生成 Project conventions / Custom instructions 注入块

设计契约（与 ChatDBServer 的 knowledge diff 通道同构）：
- head（system prompt：内置规则 + 项目路径）恒定不变，保证 prefix cache 命中；
  自定义提示词 / AGENTS.md 这类「用户随时可改」的内容绝不进 head，
  否则用户一改设置，已缓存的整段前缀立即失效。
- 上述内容以 volatile 块走 tail，且只在必要时注入：
    1. 首轮（无基线）：全量注入，同时建立基线；
    2. 后续轮：与基线逐行比对，有变化注入 diff（+ / - 行），无变化不注入。
  这样稳定轮次的 tail 为空，前缀 [head + 历史] 始终可缓存。
- 基线随会话持久化：首轮建立后跨请求复用，否则每次新请求都会被当成首轮全量注入。
- 块内容同时用于诊断展示：除 name / chars 外，额外记录本轮变更行（added / removed），
  供界面直接渲染 diff；注入块原文本身仍不落界面。
"""

from __future__ import annotations

import difflib
import hashlib
from typing import Any, Dict, List, Tuple


PROJECT_CONVENTIONS_MARKER = "## Project conventions"
CUSTOM_INSTRUCTIONS_MARKER = "## Custom instructions"

# 单个注入通道的静态描述：(基线键, 标记, 展示名, 首轮引导语, diff 引导语)
INJECTION_CHANNELS: Tuple[Tuple[str, str, str, str, str], ...] = (
    (
        "project_conventions",
        PROJECT_CONVENTIONS_MARKER,
        "项目约定 (AGENTS.md)",
        "以下是当前项目根目录 AGENTS.md 中的项目约定，请在本项目内遵守：",
        "项目约定（AGENTS.md）已更新：",
    ),
    (
        "custom_instructions",
        CUSTOM_INSTRUCTIONS_MARKER,
        "自定义提示词",
        "以下是用户自定义要求，请在不违反上述安全与路径规则的前提下遵守：",
        "用户自定义要求已更新：",
    ),
)

# volatile 注入块的稳定诊断名称：只记录名称和长度，不记录注入原文。
VOLATILE_INJECTION_NAME_MARKERS: Tuple[Tuple[str, str], ...] = tuple(
    (marker, key) for key, marker, _, _, _ in INJECTION_CHANNELS
)

# volatile 注入块标记：命中任一子串的注入块归入 tail，未命中的归入 head。
VOLATILE_INJECTION_MARKERS: Tuple[str, ...] = tuple(
    marker for marker, _ in VOLATILE_INJECTION_NAME_MARKERS
)

# 单次 diff 最多展示的变更行数：超出只提示剩余条数，避免长文档改写挤占窗口。
_MAX_DIFF_LINES = 40


def is_volatile_injection(text: Any) -> bool:
    """判断一个注入块是否属于 tail volatile 类别。"""

    text = str(text or "")
    return any(marker in text for marker in VOLATILE_INJECTION_MARKERS)


def get_volatile_injection_name(text: Any) -> str:
    """返回 volatile 注入块的稳定诊断名称；非 volatile 块返回空串。"""

    text = str(text or "")

    for marker, name in VOLATILE_INJECTION_NAME_MARKERS:
        if marker in text:
            return name

    return ""


def normalize_lines(text: Any) -> List[str]:
    """把文本归一化为行列表：统一换行符、去掉行尾空白、丢弃首尾空行。

    行是 diff 的最小单位：AGENTS.md 与自定义提示词都是自由文本，
    按行比对既能捕捉实质修改，又不会因为整段重排产生海量噪音。
    """

    raw = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in raw.split("\n")]

    while lines and not lines[0]:
        lines.pop(0)

    while lines and not lines[-1]:
        lines.pop()

    return lines


def lines_hash(lines: List[str]) -> str:
    """行列表的内容指纹，用于快速判断「有无变化」。"""

    if not lines:
        return ""

    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def _build_diff_rows(old_lines: List[str], new_lines: List[str]) -> List[Dict[str, str]]:
    """生成结构化变更行 [{kind, text}]；无变化返回空列表。

    用 ndiff 而非集合差：集合差丢失顺序，文本里「改了一行」会被误报成
    「删一行 + 加一行」且位置漂移；ndiff 保留上下文顺序，读起来就是标准 diff。
    """

    rows: List[Dict[str, str]] = []

    for line in difflib.ndiff(old_lines, new_lines):
        if line.startswith("+ "):
            rows.append({"kind": "added", "text": line[2:]})
        elif line.startswith("- "):
            rows.append({"kind": "removed", "text": line[2:]})

    return rows


def _truncate_rows(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """变更行超限时截断，并追加一条 note 行说明剩余条数。"""

    if len(rows) <= _MAX_DIFF_LINES:
        return rows

    omitted = len(rows) - _MAX_DIFF_LINES

    return rows[:_MAX_DIFF_LINES] + [
        {"kind": "note", "text": f"... 另有 {omitted} 行变更未展示"}
    ]


def _render_rows(rows: List[Dict[str, str]]) -> List[str]:
    """把结构化变更行渲染成注入块正文行（+ / - 前缀，note 原样）。"""

    lines: List[str] = []

    for row in rows:
        kind = row.get("kind")

        if kind == "added":
            lines.append("+ " + row.get("text", ""))
        elif kind == "removed":
            lines.append("- " + row.get("text", ""))
        else:
            lines.append(row.get("text", ""))

    return lines


def _format_block(marker: str, lead: str, body_lines: List[str]) -> str:
    """把标记、引导语与正文拼成注入块。"""

    if not body_lines:
        return ""

    return f"{marker}\n{lead}\n" + "\n".join(body_lines)


def _build_channel_block(marker: str, full_lead: str, diff_lead: str,
                         new_lines: List[str], old_lines: List[str] | None) -> Tuple[str, List[Dict[str, str]], str]:
    """构建单个通道的注入块，返回 (块文本, 变更行, 模式)。

    old_lines 为 None 表示首轮（无基线）：全量注入，模式 full。
    否则只注入 diff，模式 diff；无变化返回空块，调用方据此跳过注入。

    变更行与块正文同源：界面直接渲染 rows，不会与真正注入的内容不一致。
    全量模式不给正文加 +/- 前缀（那会改变注入语义），但 rows 仍标记为 added，
    以便界面按「新增内容」呈现。
    """

    if old_lines is None:
        if not new_lines:
            return "", [], ""

        rows = [{"kind": "added", "text": line} for line in new_lines]

        return _format_block(marker, full_lead, new_lines), rows, "full"

    rows = _truncate_rows(_build_diff_rows(old_lines, new_lines))

    if not rows:
        return "", [], ""

    return _format_block(marker, diff_lead, _render_rows(rows)), rows, "diff"


def plan_injection(
    sources: Dict[str, Any] | None,
    baseline: Dict[str, Any] | None,
) -> Tuple[List[str], Dict[str, Any], List[Dict[str, Any]]]:
    """按基线比对生成本轮注入块，并返回新基线。

    返回 (blocks, new_baseline, diagnostics)：
    - blocks: 本轮要注入的 tail 块；稳定轮次为空列表（不注入）
    - new_baseline: 采样后的最新基线，由调用方落盘
    - diagnostics: [{name, chars}]，只含名称与长度，不含原文

    sources 为各通道的当前文本（如 AGENTS.md 内容、自定义提示词）。
    """

    blocks: List[str] = []
    diagnostics: List[Dict[str, Any]] = []
    new_baseline: Dict[str, Any] = {}
    baseline = baseline if isinstance(baseline, dict) else {}

    for key, marker, _label, full_lead, diff_lead in INJECTION_CHANNELS:
        lines = normalize_lines((sources or {}).get(key))
        digest = lines_hash(lines)
        previous = baseline.get(key) if isinstance(baseline.get(key), dict) else {}
        old_lines = previous.get("lines") if isinstance(previous.get("lines"), list) else None

        # 当前有内容才写基线：用户清空后该通道回到「下次有内容算首轮全量」。
        if lines:
            new_baseline[key] = {"hash": digest, "lines": lines}

        if not lines and old_lines is None:
            # 从来没有过内容，且现在也没有：无需注入。
            continue

        block, rows, mode = _build_channel_block(
            marker, full_lead, diff_lead, lines, old_lines
        )

        if block:
            blocks.append(block)
            diagnostics.append({
                "name": key,
                "chars": len(block),
                "mode": mode,
                "rows": rows,
            })

    return blocks, new_baseline, diagnostics
