"""
Nexora.basis.index_codec — 消息下标 / 生效位次类字段的安全编解码

统一收敛全仓 `int(x or -1)` 的 falsy-zero 陷阱：0 是合法值（首轮
effective_from_message=0、history_cut_index=0、longterm 第 0 步、assistant 消息
可为 0），一旦用 `or -1` 兜底，0 会被 falsy 吞成 -1，导致摘要块 / 首轮事件 /
当前步骤提示被错误判为无效。

约定：
- 所有"消息下标 / 生效位次"读取必须走 parse_message_index（或语义化的
  parse_effective_from / snapshot_effective_from），禁止再手写 `or -1` 兜底。
- 非法或缺失返回 default（默认 -1 表示"无效"），调用方自行判断 < 0。

零依赖：本模块不 import 任何 basis 子包，可被任意层安全引用。
"""

from __future__ import annotations

from typing import Any, Dict, Optional


def parse_message_index(value: Any, *, default: int = -1) -> int:
    """
    安全解析消息下标类字段（history_cut_index / current_index / assistant_index）。
    0 是合法值，不能被 `or default` 兜底吞掉；非法或缺失返回 default。
    """

    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_effective_from(value: Any) -> Optional[int]:
    """
    解析 effective_from_message：非法或负值时返回 None（不复用 -1 当哨兵，
    便于与"事件缺失"语义区分）。
    """

    index = parse_message_index(value, default=-1)
    return index if index >= 0 else None


def snapshot_effective_from(snapshot: Any, *, key: str = "effective_from_message") -> Optional[int]:
    """
    读取事件 / 快照 dict 的生效下标；非 dict 或值非法时返回 None。
    用于回放过滤与快照新鲜度判断。
    """

    if not isinstance(snapshot, dict):
        return None
    return parse_effective_from(snapshot.get(key))
