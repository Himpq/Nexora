"""Judgment Loop：把「要不要出现、以什么形态出现、说什么」交给模型（重构方案 §二·第一步）。

engine.py 的六层压制保留为硬约束（地板），本模块提供天花板：

    ContextBundle = build_context_bundle(...)   # 时钟 / 日历 / 设备 / 位置 / 对话 / 认知 / 历史
    Judgment      = judge(cfg, bundle)          # act / reason / payload / confidence / hold_until

模型不可用（未配置、超时、返回不是 JSON）时返回 None，engine 回退到原打分公式，
所以离线与单测路径不受影响。所有模型调用走现有 NexoraProxy，无新依赖。
"""

from __future__ import annotations

import json
import re
import threading
import time
from typing import Any, Callable, Dict, List, Mapping, Optional

ACTS = ("hold", "card", "liveview", "notify", "xiaoyi_suggest")

DIALOG_RECORD_TYPE = "agent_dialog"
_DIALOG_WINDOW_SECONDS = 7 * 86400
_DIALOG_LIMIT = 20
_HISTORY_LIMIT = 5

_JUDGE_SYSTEM = (
    "你是 Nexora，一个住在学生手机里的学习智能体。你会在学生不在时替他备课、出题，"
    "并且只在对的时刻出现。现在给你一份上下文，请裁决这一刻要不要出现、以什么形态出现、说什么。\n"
    "原则：\n"
    "1. 打扰是有代价的。没有足够理由就 hold，并说明你为什么忍住。\n"
    "2. 结合时间、日历、设备状态、最近对话、认知状态与历史反应做判断，不要只看触发事件。\n"
    "3. 形态：card=桌面/小艺卡片（默认）；notify=通知（只在紧急时）；liveview=实况窗（进行中的过程）；"
    "xiaoyi_suggest=小艺建议里的课程接续（低打扰的接续场景）；hold=不出现。\n"
    "4. 第一人称、一句话、像一个了解他的人在说话，不要客服腔。reason 要写出你看到了什么才这样判断。\n"
    "5. 不要展开分析过程，直接给结论。只输出一个 JSON 对象，不要任何其他文字：\n"
    '{"act":"hold|card|liveview|notify|xiaoyi_suggest","reason":"...","payload":{"title":"...","one_liner":"...",'
    '"actions":["好","晚点","不用了"]},"confidence":0.0,"hold_until":null}'
)

_REBUT_SYSTEM = (
    "你是 Nexora，一个学习智能体。你之前对学生下过一条判断，学生现在反驳你。"
    "请认真看学生的话和证据，用第一人称一两句话回应：要么承认并改写你的判断，要么说明你为什么仍然这么看。"
    "不要客套，不要列表。只输出一个 JSON 对象："
    '{"reply":"...","revised_claim":"...","changed":true}'
)

_lock = threading.Lock()
_client_cache: Dict[int, Any] = {}
_judge_override: Optional[Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]] = None
_failure_until: Dict[str, float] = {}
_FAILURE_BACKOFF_SECONDS = 30.0


def set_judge_override(fn: Optional[Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]]) -> None:
    """测试/排练注入：给定 bundle 直接返回裁决字典（None = 模型不可用）。"""
    global _judge_override
    _judge_override = fn
    _failure_until.clear()


def _params(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    proactive = cfg.get("proactive") if isinstance(cfg, Mapping) and isinstance(cfg.get("proactive"), Mapping) else {}
    raw = proactive.get("judgment") if isinstance(proactive.get("judgment"), Mapping) else {}
    params = {
        "enabled": True,
        "model": "",
        "timeout": 40,
        # 默认模型带推理链（reasoning_content 先于正文计费）：400 会被思考吃光、正文为空。
        # 预算按「思考 + 一段 JSON」给足，并显式关闭思考；不支持 think 选项的模型忽略该字段。
        "max_tokens": 2000,
        "temperature": 0.2,
        "think": False,
    }
    for key in params:
        if key in raw:
            params[key] = raw[key]
    return params


def _model_options(params: Mapping[str, Any], *, max_tokens: int, temperature: float) -> Dict[str, Any]:
    options: Dict[str, Any] = {"temperature": temperature, "max_tokens": max_tokens}
    if params.get("think") is not None:
        options["think"] = bool(params["think"])
    return options


def _completion_text(result: Mapping[str, Any]) -> Tuple[str, str]:
    """(正文, 失败原因)。正文为空但有推理链 → 预算被思考耗尽，原因 'reasoning_only'。"""
    content = str(result.get("content") or "").strip()
    if content:
        return content, ""
    payload = result.get("payload") if isinstance(result.get("payload"), Mapping) else {}
    choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
    for choice in choices:
        message = choice.get("message") if isinstance(choice, Mapping) and isinstance(choice.get("message"), Mapping) else {}
        for key in ("reasoning_content", "reasoning", "thinking"):
            if str(message.get(key) or "").strip():
                return "", "reasoning_only"
    return "", "empty"


def _enabled(cfg: Mapping[str, Any]) -> bool:
    if _judge_override is not None:
        return True
    params = _params(cfg)
    if params["enabled"] is False:
        return False
    nexora = cfg.get("nexora") if isinstance(cfg.get("nexora"), Mapping) else {}
    return bool(str(nexora.get("base_url") or "").strip())


def _client(cfg: Mapping[str, Any]):
    key = id(cfg)
    with _lock:
        client = _client_cache.get(key)
        if client is None:
            from core.nexora_proxy import NexoraProxy

            client = NexoraProxy(cfg)
            _client_cache[key] = client
    return client


def _model_name(cfg: Mapping[str, Any]) -> Optional[str]:
    explicit = str(_params(cfg).get("model") or "").strip()
    if explicit:
        return explicit
    models = cfg.get("models") if isinstance(cfg.get("models"), Mapping) else {}
    return str(models.get("default_nexora_model") or "").strip() or None


def _failure_key(cfg: Mapping[str, Any]) -> str:
    nexora = cfg.get("nexora") if isinstance(cfg.get("nexora"), Mapping) else {}
    return "|".join((
        str(nexora.get("base_url") or "").strip(),
        str(_model_name(cfg) or "").strip(),
    ))


def _in_failure_backoff(cfg: Mapping[str, Any]) -> bool:
    key = _failure_key(cfg)
    until = _failure_until.get(key, 0.0)
    if until <= time.monotonic():
        if key in _failure_until:
            _failure_until.pop(key, None)
        return False
    return True


def _mark_failure(cfg: Mapping[str, Any]) -> None:
    _failure_until[_failure_key(cfg)] = time.monotonic() + _FAILURE_BACKOFF_SECONDS


def _strip_fence(text: str) -> str:
    text = str(text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _parse_object(content: str) -> Optional[Dict[str, Any]]:
    text = _strip_fence(content)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None


def _clock(now: int) -> Dict[str, Any]:
    local = time.localtime(now)
    weekday = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][local.tm_wday]
    return {
        "local_time": time.strftime("%Y-%m-%d %H:%M", local),
        "hour": local.tm_hour,
        "weekday": weekday,
        "is_weekend": local.tm_wday >= 5,
    }


def _calendar(signals: Mapping[str, Any], now: int) -> List[Dict[str, Any]]:
    """端侧 Calendar Kit 读到的未来 24h 事件（signals.calendar），只保留标题与相对时间。"""
    rows = signals.get("calendar")
    if not isinstance(rows, list):
        return []
    events: List[Dict[str, Any]] = []
    for row in rows[:12]:
        if not isinstance(row, Mapping):
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        try:
            start = int(row.get("start") or 0)
        except (TypeError, ValueError):
            start = 0
        if start > 1_000_000_000_000:
            start //= 1000
        entry: Dict[str, Any] = {"title": title}
        if start:
            entry["in_hours"] = round((start - now) / 3600, 1)
            entry["at"] = time.strftime("%m-%d %H:%M", time.localtime(start))
        lowered = title.lower()
        entry["is_exam"] = any(word in lowered for word in ("考", "exam", "测", "quiz", "期中", "期末"))
        events.append(entry)
    return events


def _device(signals: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "do_not_disturb": signals.get("do_not_disturb") is True,
        "scene": str(signals.get("scene") or "").strip() or "unknown",
        "kind": str(signals.get("device") or "").strip() or "unknown",
        "reported_at": signals.get("device_reported_at"),
    }


def _location(signals: Mapping[str, Any]) -> str:
    return str(signals.get("location") or "").strip() or "unknown"


def _dialog(records: List[Dict[str, Any]], now: int) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for row in records:
        if not isinstance(row, Mapping) or str(row.get("type") or "") != DIALOG_RECORD_TYPE:
            continue
        try:
            ts = int(row.get("timestamp") or 0)
        except (TypeError, ValueError):
            ts = 0
        if ts and now - ts > _DIALOG_WINDOW_SECONDS:
            continue
        rows.append({
            "at": time.strftime("%m-%d %H:%M", time.localtime(ts)) if ts else "",
            "source": str(row.get("source") or "app"),
            "q": str(row.get("question") or "")[:80],
            "a": str(row.get("answer") or "")[:80],
        })
    return rows[-_DIALOG_LIMIT:]


def _history(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for row in records:
        if not isinstance(row, Mapping) or str(row.get("type") or "") != "agent_decision":
            continue
        if str(row.get("source") or "") == "nightly_prep":
            continue
        # 只要真正经过决策器的记录（有 fire 字段）；流程留痕（tool_step / flow）不是「它的决定」。
        if "fire" not in row or str(row.get("kind") or "") == "tool_step":
            continue
        try:
            ts = int(row.get("timestamp") or 0)
        except (TypeError, ValueError):
            ts = 0
        rows.append({
            "at": time.strftime("%m-%d %H:%M", time.localtime(ts)) if ts else "",
            "trigger": str(row.get("trigger") or ""),
            "fired": bool(row.get("fire")),
            "suppressed_by": str(row.get("suppressed_by") or ""),
            "user_response": str(row.get("status") or "pending"),
            "said": str(row.get("text") or "")[:60],
        })
    return rows[-_HISTORY_LIMIT:]


def _cognition(cfg: Mapping[str, Any], username: str) -> Dict[str, Any]:
    try:
        from core.cognition.facets import build_facets

        data = build_facets(cfg, username)
    except Exception:
        return {"at_risk": [], "confusion": [], "stable": []}
    facets = data.get("facets") if isinstance(data.get("facets"), list) else []
    at_risk: List[str] = []
    confusion: List[str] = []
    stable: List[str] = []
    for facet in facets:
        if not isinstance(facet, Mapping):
            continue
        kind = str(facet.get("kind") or "")
        claim = str(facet.get("claim") or "")[:60]
        if kind == "confusion" and len(confusion) < 3:
            confusion.append(claim)
        elif kind == "mastery" and "稳" in claim and len(stable) < 3:
            stable.append(claim)
        elif kind in ("mastery", "accuracy") and len(at_risk) < 3:
            at_risk.append(claim)
    return {"at_risk": at_risk, "confusion": confusion, "stable": stable}


def build_context_bundle(
    cfg: Mapping[str, Any],
    username: str,
    *,
    now: int,
    trigger: str,
    signals: Optional[Mapping[str, Any]] = None,
    target: Optional[Mapping[str, Any]] = None,
    minutes: int = 15,
    hard_block: Optional[str] = None,
) -> Dict[str, Any]:
    """打包模型裁决所需的上下文（重构方案 ContextBundle）。字段缺失时给空值而不是报错。"""
    from core import user as user_store
    from core.decision.device_context import merge_into_signals

    signals = merge_into_signals(cfg, username, signals if isinstance(signals, Mapping) else {}, now=now)
    target = target if isinstance(target, Mapping) else {}
    try:
        records = user_store.list_learning_records(cfg, username) or []
    except Exception:
        records = []
    return {
        "trigger": {
            "event": trigger or "unknown",
            "detail": {key: value for key, value in signals.items() if key in ("overdue_days", "unfinished_chapter", "mail_arrived", "prereq_gap", "confusion_spike", "est_minutes")},
            "target_chapter": str(target.get("chapter_name") or "").strip(),
            "est_minutes": minutes,
        },
        "clock": _clock(now),
        "calendar": _calendar(signals, now),
        "device": _device(signals),
        "location": _location(signals),
        "dialog": _dialog(records, now),
        "cognition": _cognition(cfg, username),
        "history": _history(records),
        # 规则地板已判定的硬约束；模型仍可表达「本想说什么」，但不会覆盖它。
        "hard_block": hard_block or None,
    }


def _normalize(parsed: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    act = str(parsed.get("act") or "").strip().lower()
    if act not in ACTS:
        return None
    payload = parsed.get("payload") if isinstance(parsed.get("payload"), Mapping) else {}
    actions = payload.get("actions") if isinstance(payload.get("actions"), list) else []
    actions = [str(item).strip() for item in actions if str(item).strip()][:3]
    try:
        confidence = max(0.0, min(1.0, float(parsed.get("confidence") or 0.0)))
    except (TypeError, ValueError):
        confidence = 0.0
    hold_until = parsed.get("hold_until")
    try:
        hold_until = int(hold_until) if hold_until not in (None, "", 0) else None
    except (TypeError, ValueError):
        hold_until = None
    return {
        "act": act,
        "reason": str(parsed.get("reason") or "").strip()[:200],
        "payload": {
            "title": str(payload.get("title") or "").strip()[:60],
            "one_liner": str(payload.get("one_liner") or "").strip()[:120],
            "actions": actions or ["好", "晚点", "不用了"],
        },
        "confidence": round(confidence, 2),
        "hold_until": hold_until,
    }


def judge(cfg: Mapping[str, Any], bundle: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """让模型对一份 ContextBundle 做裁决。不可用时返回 None（调用方回退打分）。"""
    if not _enabled(cfg):
        return None
    if _judge_override is not None:
        try:
            result = _judge_override(dict(bundle))
        except Exception:
            return None
        return _normalize(result) if isinstance(result, Mapping) else None
    # 模型端点不可用时短暂熔断，避免每个触发源都阻塞一个完整网络超时；
    # 规则地板仍会立即接管，下一轮冷却后自动恢复尝试。
    if _in_failure_backoff(cfg):
        return None
    params = _params(cfg)
    try:
        client = _client(cfg)
        result = client.complete_raw(
            messages=[
                {"role": "system", "content": _JUDGE_SYSTEM},
                {"role": "user", "content": json.dumps(bundle, ensure_ascii=False)},
            ],
            model=_model_name(cfg),
            api_mode="chat",
            options=_model_options(params, max_tokens=int(params["max_tokens"]), temperature=float(params["temperature"])),
            request_timeout=float(params["timeout"]),
        )
    except Exception as exc:
        _mark_failure(cfg)
        _log("judgment_model_error", str(exc))
        return None
    if not result.get("success"):
        _mark_failure(cfg)
        _log("judgment_model_error", str(result.get("message") or result.get("status") or "request failed"))
        return None
    content, why = _completion_text(result)
    if not content:
        # 思考把预算吃光不算端点故障：不熔断，下一次触发再试（预算可在 proactive.judgment.max_tokens 调）。
        _log("judgment_model_empty", why)
        return None
    parsed = _parse_object(content)
    if not parsed:
        _mark_failure(cfg)
        _log("judgment_model_unparsable", content[:200])
        return None
    normalized = _normalize(parsed)
    if normalized is None:
        _mark_failure(cfg)
        _log("judgment_model_invalid_act", str(parsed.get("act")))
    return normalized


def _log(event: str, detail: str) -> None:
    """裁决失败原因进运行日志，排练时能看见「为什么回退到了规则」。"""
    try:
        from core.runlog import log_event

        log_event(event, "Judgment Loop 回退到规则", payload={"detail": str(detail)[:300]})
    except Exception:
        pass


def rebut(cfg: Mapping[str, Any], *, claim: str, evidence: List[str], note: str) -> Optional[Dict[str, Any]]:
    """反驳变成对话：把用户的反驳送回模型，得到回应与改写后的判断。"""
    if not _enabled(cfg) or not str(note or "").strip():
        return None
    if _judge_override is not None:
        return {"reply": f"好，我记下了：{note.strip()[:60]}", "revised_claim": claim, "changed": True}
    params = _params(cfg)
    user_prompt = json.dumps(
        {"my_claim": claim, "my_evidence": evidence[:6], "student_says": note.strip()[:300]},
        ensure_ascii=False,
    )
    try:
        result = _client(cfg).complete_raw(
            messages=[{"role": "system", "content": _REBUT_SYSTEM}, {"role": "user", "content": user_prompt}],
            model=_model_name(cfg),
            api_mode="chat",
            options=_model_options(params, max_tokens=max(600, int(params["max_tokens"]) // 2), temperature=0.3),
            request_timeout=float(params["timeout"]),
        )
    except Exception:
        return None
    if not result.get("success"):
        return None
    content, _why = _completion_text(result)
    parsed = _parse_object(content) if content else None
    if not parsed:
        return None
    return {
        "reply": str(parsed.get("reply") or "").strip()[:200],
        "revised_claim": str(parsed.get("revised_claim") or claim).strip()[:120],
        "changed": bool(parsed.get("changed")),
    }


def compact_context(bundle: Mapping[str, Any]) -> Dict[str, Any]:
    """落入时间线的上下文快照（长按「它当时看到了什么」），去掉冗长字段。"""
    clock = bundle.get("clock") if isinstance(bundle.get("clock"), Mapping) else {}
    calendar = bundle.get("calendar") if isinstance(bundle.get("calendar"), list) else []
    device = bundle.get("device") if isinstance(bundle.get("device"), Mapping) else {}
    cognition = bundle.get("cognition") if isinstance(bundle.get("cognition"), Mapping) else {}
    dialog = bundle.get("dialog") if isinstance(bundle.get("dialog"), list) else []
    history = bundle.get("history") if isinstance(bundle.get("history"), list) else []
    dialog_answers = [
        str(row.get("a") or "")
        for row in dialog[-3:]
        if isinstance(row, Mapping) and str(row.get("a") or "").strip()
    ]
    if not dialog_answers:
        dialog_answers = [str(row.get("user_response") or "") for row in history[-3:] if isinstance(row, Mapping)]
    return {
        "time": str(clock.get("local_time") or ""),
        "weekday": str(clock.get("weekday") or ""),
        "calendar": [f"{row.get('at', '')} {row.get('title', '')}".strip() for row in calendar[:3] if isinstance(row, Mapping)],
        "scene": str(device.get("scene") or "unknown"),
        "dnd": bool(device.get("do_not_disturb")),
        "location": str(bundle.get("location") or "unknown"),
        "at_risk": list(cognition.get("at_risk") or [])[:3],
        "confusion": list(cognition.get("confusion") or [])[:3],
        "recent_questions": [str(row.get("q") or "") for row in dialog[-3:] if isinstance(row, Mapping)],
        "recent_responses": dialog_answers,
    }
