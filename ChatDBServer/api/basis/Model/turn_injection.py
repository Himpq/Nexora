"""
Nexora.basis.Model.turn_injection — tail volatile 注入块：常量与构建

职责：
- 收敛 volatile 注入块的标记常量（原 Context.py 双处硬编码），新增通道只改这里
- 构建 Profile / Skill 的 Modified Injection 块（tail 注入与历史回放共用同一格式）

设计契约（与 knowledge diff 通道同构）：
- head（system prompt + skill 块 + 画像块）由 turn-1 快照冻结，保证 prefix cache 命中
- 画像/技能变更以 volatile 块走 tail：每轮重发，模型以「最新的块」为准
- 块内容同时用于：
    1. 当前轮 tail 注入（由轮次开头的 delta 生成）
    2. 历史回放重建（由落库事件生成，事件结构与 delta 同构）
"""

from __future__ import annotations

from typing import Any, Dict, Optional


PROFILE_UPDATED_MARKER = "## User profile updated"
SKILLS_CHANGED_MARKER = "## Skills changed"

# volatile 注入块标记：命中任一子串的 system 注入块归入 tail（每轮重发），
# 未命中的归入 head（仅 turn-1 进入快照）。Context.py 两侧分类均引用本常量。
VOLATILE_INJECTION_MARKERS = (
    "## Workspace Resource Index",
    "## Sandbox Files",
    "## Knowledge changed",
    PROFILE_UPDATED_MARKER,
    SKILLS_CHANGED_MARKER,
)


def is_volatile_injection(text: Any) -> bool:
    """判断一个 system 注入块是否属于 tail volatile 类别。"""

    text = str(text or "")
    return any(marker in text for marker in VOLATILE_INJECTION_MARKERS)


def build_profile_update_block(delta: Optional[Dict[str, Any]]) -> str:
    """把画像变更 delta 格式化为 tail 注入块。

    delta 结构：{"mode": "append" | "overwrite", "content": str}
    与落库的 profile_event 同构，tail 注入与历史回放共用本方法。
    """

    if not isinstance(delta, dict):
        return ""

    mode = str(delta.get("mode") or "").strip()
    content = str(delta.get("content") or "").strip()

    if mode not in {"append", "overwrite"}:
        return ""

    lines = [PROFILE_UPDATED_MARKER]

    if mode == "append":
        lines.append("（用户画像有新增内容，追加到系统提示前部的旧画像之后；与旧画像冲突时以本块为准。）")
    else:
        lines.append("（以下为用户画像的最新完整版本，覆盖系统提示前部的旧画像，以此为准。）")

    if content:
        lines.append(content)
    elif mode == "overwrite":
        lines.append("（用户画像已被清空。）")

    return "\n".join(lines).strip()


def build_skill_update_block(delta: Optional[Dict[str, Any]]) -> str:
    """把技能变更 delta 格式化为 tail 注入块。

    delta 结构：{"added": [{"title", "prompt"}], "removed": [{"title"}]}
    新增/更新的技能必须贴全文（volatile 块每轮重发，新技能全文随 tail 走，
    直到下次 head 重建才烘回 system prompt）；移除只发标题即可。
    """

    if not isinstance(delta, dict):
        return ""

    added = [item for item in (delta.get("added") or []) if isinstance(item, dict)]
    removed = [item for item in (delta.get("removed") or []) if isinstance(item, dict)]

    if not added and not removed:
        return ""

    lines = [
        SKILLS_CHANGED_MARKER,
        "（当前生效技能相对系统提示有变化，以本块为准；被移除技能的旧指令立即失效，新增技能的指令立即生效。）",
    ]

    for item in removed:
        title = str(item.get("title") or "").strip()
        if title:
            lines.append(f"- [已移除] {title}")

    for item in added:
        title = str(item.get("title") or "").strip()
        prompt = str(item.get("prompt") or "").strip()
        if title:
            lines.append(f"+ [新增或更新] {title}")

        if prompt:
            lines.append(prompt)

    return "\n".join(lines).strip()
