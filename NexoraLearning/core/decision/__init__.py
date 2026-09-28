"""主动触发决策器（B4）。

依据 NEXORA_HARMONYOS_复赛方案.md §4.6：
输入 = 用户名 + 当前时刻 + 事件信号，产出 ProactiveDecision，并无论 fire 真假
都写入时间线（agent_act / agent_hold）。本包只做确定性打分与约束判定，不含
N1–N5 的触发源接线；触发源（夜间备课完成、前置缺口、困惑累积、邮件）在后续
任务中各自注入信号。
"""

from core.decision.engine import DEFAULT_PARAMS, evaluate
from core.decision.judgment import DIALOG_RECORD_TYPE, build_context_bundle, judge, rebut, set_judge_override
from core.decision.state import (
    load_state,
    mark_decision_response,
    save_state,
)

__all__ = [
    "DEFAULT_PARAMS",
    "DIALOG_RECORD_TYPE",
    "build_context_bundle",
    "evaluate",
    "judge",
    "load_state",
    "mark_decision_response",
    "rebut",
    "save_state",
    "set_judge_override",
]
