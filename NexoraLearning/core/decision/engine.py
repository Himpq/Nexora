"""主动触发决策器打分与约束（B4）。

依据 NEXORA_HARMONYOS_复赛方案.md §4.6：

    打分   score = 0.40*urgency + 0.30*timing + 0.20*(1-cost) - 0.30*penalty
    触发   fire  = score >= 0.55 且通过全部约束
    约束   （按序）静默时段 23:00–08:00 → 每日上限 2 次 → 同目标 24h 冷却
           → 忽略退避（连续 2 次未理会退避 48h）→ 晚点（40 分钟重试一次）
           → 系统免打扰 → 分数门槛（low_score）

事件信号按 §4.6 信号表取值（夜间备课完成 0.8 / 前置缺口 0.7 / 困惑累积 0.7 /
新作业邮件 0.9），作为基准分计入打分。forgetting_curve / unfinished_chapter
为派生触发，基准分（0.45 / 0.35）使验收场景「第 1 章到期 + 第 3 章未收尾 +
21:00 → fire=true」成立；所有参数可经 config.json 的 "proactive" 段覆盖，
演示前按实测调整时需记录理由（方案 §4.6 同款约定）。

timing = 该时段历史学习完成率（telemetry 时段分布）。接入 telemetry 前使用
default_timing 或 "proactive".hour_timing 的逐小时配置；真实分布接线属 §10 #6。

重构（2026-09）：打分与前六层约束保留为「地板」；放行后由 core/decision/judgment.py
的模型裁决决定出现与否、形态（channel）与措辞，模型不可用时回退到 fire_threshold。
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

from core.decision.state import (
    backoff_blocked,
    cooldown_blocked,
    consume_defer,
    defer_blocked,
    is_defer_retry,
    load_state,
    record_cooldown,
    record_fire,
    save_state,
    target_key,
    today_fired_count,
)

DEFAULT_PARAMS: Dict[str, Any] = {
    "weights": {"urgency": 0.40, "timing": 0.30, "cost": 0.20, "penalty": 0.30},
    "fire_threshold": 0.55,
    "event_bases": {
        "prep_done": 0.8,
        "prereq_gap": 0.7,
        "confusion_spike": 0.7,
        "mail_arrived": 0.9,
        "forgetting_curve": 0.45,
        "unfinished_chapter": 0.35,
    },
    "silent_hours": [23, 8],
    "daily_cap": 2,
    "cooldown_seconds": 86400,
    "backoff_ignores": 2,
    "backoff_seconds": 172800,
    "defer_seconds": 2400,
    "defer_retries": 1,
    "default_timing": 0.5,
    "hour_timing": {},
}

_TRIGGERS = (
    "prep_done",
    "mail_arrived",
    "confusion_spike",
    "prereq_gap",
    "forgetting_curve",
    "unfinished_chapter",
)

_SUPPRESS_COPY = {
    "judgment": "我看了看你现在的情况，觉得不是时候，先记着。",
    "silent_hours": "现在是休息时间，我先记下来，明早再提醒你。",
    "daily_cap": "今天已经提醒过两次了，我先记下，明天再说。",
    "cooldown": "这一章刚提醒过，我不重复打扰。",
    "backoff": "这类提醒你最近两次都没理会，我先安静两天。",
    "defer": "你点了晚点，我过 40 分钟再提一次。",
    "do_not_disturb": "你开了免打扰，我先记下来，等方便了再说。",
    "low_score": "现在时机还不合适，我先记着。",
}

_SUPPRESS_REASON = {
    "judgment": "我综合了时间、日历和你最近的状态，判断现在不该打扰",
    "silent_hours": "静默时段 23:00–08:00",
    "daily_cap": "今日推送已达上限 2 次",
    "cooldown": "同目标 24h 冷却",
    "backoff": "连续 2 次未理会，退避 48h",
    "defer": "用户点了晚点，等待重试",
    "do_not_disturb": "系统免打扰开启",
    "low_score": "综合分低于 0.55",
}


def _merge_params(cfg: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        key: (dict(value) if isinstance(value, dict) else list(value) if isinstance(value, list) else value)
        for key, value in DEFAULT_PARAMS.items()
    }
    if isinstance(cfg, dict) and isinstance(cfg.get("proactive"), dict):
        override = cfg["proactive"]
        for key, default in DEFAULT_PARAMS.items():
            if key in override:
                value = override[key]
                if isinstance(default, dict) and isinstance(value, dict):
                    params[key].update(value)
                else:
                    params[key] = value
    return params


def _int_param(params: Dict[str, Any], key: str, default: int) -> int:
    try:
        return int(params.get(key, default))
    except (TypeError, ValueError):
        return default


def _float_param(params: Dict[str, Any], key: str, default: float) -> float:
    try:
        return float(params.get(key, default))
    except (TypeError, ValueError):
        return default


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _collect_triggers(explicit: str, signals: Optional[Dict[str, Any]]) -> List[str]:
    triggers: List[str] = []
    if explicit and explicit in _TRIGGERS:
        triggers.append(explicit)
    if isinstance(signals, dict):
        for name in _TRIGGERS:
            if name in triggers:
                continue
            present = signals.get(name)
            if name == "forgetting_curve":
                try:
                    if float(signals.get("overdue_days") or 0) > 0:
                        triggers.append(name)
                except (TypeError, ValueError):
                    pass
            elif name == "unfinished_chapter":
                if isinstance(present, dict) and present:
                    triggers.append(name)
            elif name == "mail_arrived":
                if isinstance(present, dict) and present:
                    triggers.append(name)
            elif name in {"prereq_gap", "confusion_spike"}:
                if isinstance(present, dict) and present:
                    triggers.append(name)
            elif present is True:
                triggers.append(name)
    return triggers


def _primary_trigger(explicit: str, triggers: List[str]) -> str:
    if explicit and explicit in _TRIGGERS:
        return explicit
    for name in _TRIGGERS:
        if name in triggers:
            return name
    return "unfinished_chapter" if "unfinished_chapter" in triggers else ""


def _timing_value(params: Dict[str, Any], signals: Optional[Dict[str, Any]], now: int) -> float:
    if isinstance(signals, dict):
        try:
            supplied = float(signals.get("timing"))
        except (TypeError, ValueError):
            supplied = None
        if supplied is not None:
            return _clamp(supplied)
    hour_map = params.get("hour_timing")
    if isinstance(hour_map, dict):
        hour = int(time.strftime("%H", time.localtime(now)))
        value = hour_map.get(str(hour), hour_map.get(hour))
        try:
            if value is not None:
                return _clamp(float(value))
        except (TypeError, ValueError):
            pass
    return _clamp(_float_param(params, "default_timing", 0.5))


def _chapter_label(target: Optional[Dict[str, Any]]) -> str:
    if not isinstance(target, dict):
        return "下一章"
    name = str(target.get("chapter_name") or "").strip()
    if name:
        return name
    index = target.get("chapter_index")
    if index is not None:
        try:
            return f"第 {int(index) + 1} 章"
        except (TypeError, ValueError):
            pass
    return "下一章"


def _human_text(trigger: str, target: Optional[Dict[str, Any]], signals: Optional[Dict[str, Any]], minutes: int) -> str:
    signals = signals if isinstance(signals, dict) else {}
    chapter = _chapter_label(target)
    if trigger == "prep_done":
        return f"我昨晚把{chapter}读完了，划了重点、出了题。要现在看吗？"
    if trigger == "mail_arrived":
        subject = str((signals.get("mail_arrived") or {}).get("subject") or "").strip()
        subject = subject or "新邮件"
        return f"收到一封新邮件：{subject}。要我读一下并安排进计划吗？"
    if trigger == "prereq_gap":
        concept = str((signals.get("prereq_gap") or {}).get("concept") or "").strip() or "前置概念"
        return f"这节要用到{concept}，你之前学过但最近没碰。先花{minutes}分钟补一下？"
    if trigger == "confusion_spike":
        concept = str((signals.get("confusion_spike") or {}).get("concept") or "").strip() or "这个知识点"
        try:
            hits = int((signals.get("confusion_spike") or {}).get("hit_count") or 0)
        except (TypeError, ValueError):
            hits = 0
        hits_text = f"卡过 {hits} 次" if hits > 0 else "反复卡住"
        return f"你在{concept}上{hits_text}。我备了段讲解，现在过一遍？"
    combined = _collect_triggers("", signals)
    has_overdue = "forgetting_curve" in combined and "unfinished_chapter" in combined
    if has_overdue and trigger == "forgetting_curve":
        try:
            overdue_days = int(float(signals.get("overdue_days") or 0))
        except (TypeError, ValueError):
            overdue_days = 0
        unfinished = signals.get("unfinished_chapter")
        if isinstance(unfinished, dict) and unfinished:
            unfinished_name = str(unfinished.get("chapter_name") or "").strip()
            if unfinished_name:
                return f"{chapter}该复习了（已过 {overdue_days} 天），{unfinished_name}也还没收尾。先从{minutes}分钟开始？"
    if trigger == "forgetting_curve":
        try:
            overdue_days = int(float(signals.get("overdue_days") or 0))
        except (TypeError, ValueError):
            overdue_days = 0
        return f"{chapter}该复习了，距上次学完已过 {overdue_days} 天。{minutes}分钟过一遍？"
    if trigger == "unfinished_chapter":
        return f"{chapter}上次没读完。今天{minutes}分钟收个尾？"
    return f"现在适合继续{chapter}，{minutes}分钟开始？"


def _evidence(trigger: str, target: Optional[Dict[str, Any]], signals: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    signals = signals if isinstance(signals, dict) else {}
    evidence: List[Dict[str, Any]] = []
    chapter = _chapter_label(target)
    if trigger == "prep_done":
        evidence.append({"label": f"昨晚备课完成：{chapter}", "source": "prep"})
    elif trigger == "prereq_gap":
        concept = str((signals.get("prereq_gap") or {}).get("concept") or "").strip()
        evidence.append({"label": f"前置缺口：{concept}", "source": "prereq"})
    elif trigger == "confusion_spike":
        concept = str((signals.get("confusion_spike") or {}).get("concept") or "").strip()
        evidence.append({"label": f"困惑累积：{concept}", "source": "confusion"})
    elif trigger == "mail_arrived":
        subject = str((signals.get("mail_arrived") or {}).get("subject") or "").strip()
        evidence.append({"label": f"新邮件：{subject}", "source": "mail"})
    if "forgetting_curve" in _collect_triggers("", signals):
        evidence.append({"label": f"{chapter} 已到复习时间", "source": "forgetting_curve"})
    if "unfinished_chapter" in _collect_triggers("", signals):
        evidence.append({"label": f"{chapter} 尚未读完", "source": "progress"})
    return evidence


def evaluate(
    cfg: Dict[str, Any],
    username: str,
    *,
    trigger: str = "",
    signals: Optional[Dict[str, Any]] = None,
    target: Optional[Dict[str, Any]] = None,
    minutes: Optional[int] = None,
    now: Optional[int] = None,
) -> Dict[str, Any]:
    """评估一次主动推送并持久化（无论 fire 真假都写入时间线）。

    返回 decision 字典（§3.4 ProactiveDecision + 时间线字段）。
    """
    params = _merge_params(cfg)
    current = int(now or time.time())
    from core.decision.device_context import merge_into_signals

    # 端侧最近一次上报补齐触发源未携带的设备状态；显式信号优先，
    # 因此免打扰会继续作为规则地板，而不仅仅是模型上下文提示。
    signals = merge_into_signals(cfg, username, signals if isinstance(signals, dict) else {}, now=current)
    explicit = str(trigger or "").strip()
    triggers = _collect_triggers(explicit, signals)
    primary = _primary_trigger(explicit, triggers)
    target = target if isinstance(target, dict) else {}

    try:
        overdue_days = float(signals.get("overdue_days") or 0)
    except (TypeError, ValueError):
        overdue_days = 0.0
    urgency = _clamp(max(0.0, overdue_days) / 3.0)
    timing = _timing_value(params, signals, current)
    try:
        resolved_minutes = int(minutes or signals.get("est_minutes") or 15)
    except (TypeError, ValueError):
        resolved_minutes = 15
    resolved_minutes = max(1, min(240, resolved_minutes))
    cost = _clamp(resolved_minutes / 30.0)
    penalty = _clamp(today_fired_count(load_state(cfg, username), current) / _int_param(params, "daily_cap", 2))

    weights = params["weights"] if isinstance(params.get("weights"), dict) else DEFAULT_PARAMS["weights"]
    bases = params["event_bases"] if isinstance(params.get("event_bases"), dict) else DEFAULT_PARAMS["event_bases"]
    base = sum(float(bases.get(name, 0.0)) for name in triggers)
    score = _clamp(
        float(weights.get("urgency", 0.40)) * urgency
        + float(weights.get("timing", 0.30)) * timing
        + float(weights.get("cost", 0.20)) * (1.0 - cost)
        - float(weights.get("penalty", 0.30)) * penalty
        + base,
        low=0.0,
        high=1.2,
    )

    state = load_state(cfg, username)
    # 晚点重试是同一次推送的重试，不受同目标冷却约束；冷却约束新推送。
    retry = bool(primary and is_defer_retry(state, primary))
    silent_hours = params["silent_hours"] if isinstance(params.get("silent_hours"), list) else DEFAULT_PARAMS["silent_hours"]
    hour = int(time.strftime("%H", time.localtime(current)))
    try:
        start, end = int(silent_hours[0]), int(silent_hours[1])
    except (IndexError, TypeError, ValueError):
        start, end = 23, 8
    in_silent = hour >= start or hour < end

    suppressed_by: Optional[str] = None
    if in_silent:
        suppressed_by = "silent_hours"
    elif today_fired_count(state, current) >= _int_param(params, "daily_cap", 2):
        suppressed_by = "daily_cap"
    elif not retry and cooldown_blocked(state, target, _int_param(params, "cooldown_seconds", 86400), current):
        suppressed_by = "cooldown"
    elif primary and backoff_blocked(state, primary, current):
        suppressed_by = "backoff"
    elif primary and defer_blocked(state, primary, _int_param(params, "defer_retries", 1), current):
        suppressed_by = "defer"
    elif signals.get("do_not_disturb") is True:
        suppressed_by = "do_not_disturb"

    # Judgment Loop（重构方案 §二·第一步）：规则做地板，模型做天花板。
    # 硬约束已判定时模型仍可表达「本想说什么」，但不会推翻硬约束；
    # 硬约束放行时，由模型决定出现与否、形态和措辞；模型不可用则回退到分数门槛。
    from core.decision.judgment import build_context_bundle, compact_context, judge

    bundle = build_context_bundle(
        cfg,
        username,
        now=current,
        trigger=primary,
        signals=signals,
        target=target,
        minutes=resolved_minutes,
        hard_block=suppressed_by,
    )
    judgment = judge(cfg, bundle)
    if suppressed_by is None:
        if judgment is not None:
            if judgment["act"] == "hold":
                suppressed_by = "judgment"
        elif score < _float_param(params, "fire_threshold", 0.55):
            suppressed_by = "low_score"

    fire = suppressed_by is None

    if fire:
        record_fire(state, current)
        record_cooldown(state, target, _int_param(params, "cooldown_seconds", 86400), current)
        if primary and retry:
            consume_defer(state, primary)
    save_state(cfg, username, state)

    channel = judgment["act"] if judgment is not None and fire else ("hold" if not fire else "card")
    text, reason = _compose(
        fire=fire,
        suppressed_by=suppressed_by,
        judgment=judgment,
        fallback_text=_human_text(primary, target, signals, resolved_minutes),
        fallback_reason=_reason_for_fire(primary, triggers, signals),
    )
    evidence = _evidence(primary, target, signals)
    decision = {
        "decision_id": f"dec_{uuid.uuid4().hex[:20]}",
        "kind": "agent_act" if fire else "agent_hold",
        "fire": fire,
        "score": round(score, 3),
        "trigger": primary,
        "suppressed_by": suppressed_by,
        "target": {
            "lecture_id": str(target.get("lecture_id") or "").strip(),
            "book_id": str(target.get("book_id") or "").strip(),
            "chapter_index": target.get("chapter_index"),
            "chapter_name": str(target.get("chapter_name") or "").strip(),
        },
        "minutes": resolved_minutes,
        "text": text,
        "reason": reason,
        "evidence": evidence,
        "card": (
            {
                "type": "proactive",
                "title": text,
                "reason": reason,
                "minutes": resolved_minutes,
                "accept": "好",
                "defer": "晚点",
                "dismiss": "不用了",
                "channel": channel,
            }
            if fire
            else None
        ),
        "status": "pending",
        "retry": retry,
        "timestamp": current,
        "evaluated_at": current,
        # 出现的形态（hold / card / notify / liveview / xiaoyi_suggest），端侧据此选入口。
        "channel": channel,
        "judgment": (
            {
                "source": "model",
                "act": judgment["act"],
                "confidence": judgment["confidence"],
                "hold_until": judgment["hold_until"],
                "wanted_to_say": judgment["payload"]["one_liner"] if suppressed_by and judgment["act"] != "hold" else "",
            }
            if judgment is not None
            else {"source": "rules", "act": channel, "confidence": round(min(1.0, score), 2), "hold_until": None, "wanted_to_say": ""}
        ),
        # 它当时看到了什么：长按时间线条目可展开（重构方案「每个动作都可追问为什么」）。
        "context": compact_context(bundle),
    }
    return decision


def _compose(
    *,
    fire: bool,
    suppressed_by: Optional[str],
    judgment: Optional[Dict[str, Any]],
    fallback_text: str,
    fallback_reason: str,
) -> Tuple[str, str]:
    """决定时间线上的一句话与「为什么」。模型可用时用模型措辞，否则用规则模板。"""
    if fire:
        if judgment is not None and judgment["payload"]["one_liner"]:
            return judgment["payload"]["one_liner"], judgment["reason"] or fallback_reason
        return fallback_text, fallback_reason
    key = suppressed_by or "low_score"
    rule_copy = _SUPPRESS_COPY.get(key, _SUPPRESS_COPY["low_score"])
    rule_reason = _SUPPRESS_REASON.get(key, "分数低于门槛")
    if judgment is None:
        return rule_copy, rule_reason
    if key == "judgment":
        return judgment["payload"]["one_liner"] or rule_copy, judgment["reason"] or rule_reason
    if judgment["act"] != "hold" and judgment["payload"]["one_liner"]:
        # 模型想说、硬约束拦住：克制本身写进时间线。
        return f"我本想说「{judgment['payload']['one_liner']}」，但{rule_reason}，先记下。", judgment["reason"] or rule_reason
    return rule_copy, judgment["reason"] or rule_reason


def _reason_for_fire(trigger: str, triggers: List[str], signals: Dict[str, Any]) -> str:
    parts: List[str] = []
    if trigger == "prep_done":
        parts.append("夜间备课已完成")
    elif trigger == "mail_arrived":
        parts.append("有新邮件到达")
    elif trigger == "prereq_gap":
        parts.append("发现前置知识缺口")
    elif trigger == "confusion_spike":
        parts.append("困惑信号累计超过阈值")
    if "forgetting_curve" in triggers:
        parts.append("章节已到复习时间")
    if "unfinished_chapter" in triggers:
        parts.append("有章节未读完")
    if not parts:
        parts.append("当前进度适合继续学习")
    return "，".join(parts) + "。"
