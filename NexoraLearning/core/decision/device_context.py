"""端侧上报的设备上下文（重构方案 ContextBundle 的 calendar / device / location 来源）。

手机在前台时把未来 24h 日历、免打扰、情景模式、粗粒度位置上报一次，落到
data/users/<u>/device_context.json；决策器在任何触发源（夜间备课、邮件、困惑）
求值时都能读到，而不必等 App 打开。过期（默认 36h）即视为未知。
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

_lock = threading.Lock()
_MAX_AGE_SECONDS = 36 * 3600
_MAX_EVENTS = 12


def _path(cfg: Mapping[str, Any], username: str) -> Path:
    return Path(cfg.get("data_dir") or "data") / "users" / username / "device_context.json"


def save_device_context(cfg: Mapping[str, Any], username: str, payload: Mapping[str, Any], *, now: Optional[int] = None) -> Dict[str, Any]:
    events: List[Dict[str, Any]] = []
    for row in (payload.get("calendar") if isinstance(payload.get("calendar"), list) else [])[:_MAX_EVENTS]:
        if not isinstance(row, Mapping):
            continue
        title = str(row.get("title") or "").strip()[:60]
        if not title:
            continue
        try:
            start = int(row.get("start") or 0)
        except (TypeError, ValueError):
            start = 0
        events.append({"title": title, "start": start})
    reported_at = int(now or time.time())
    if reported_at > 10_000_000_000:
        reported_at //= 1000
    try:
        sampled_at_ms = int(payload.get("sampled_at_ms") or reported_at * 1000)
    except (ValueError, TypeError, OverflowError):
        sampled_at_ms = reported_at * 1000
    # 端侧日历读不到（未授权 / 设备不支持）时上报 calendar_status='unavailable'：
    # 决策器不能把这种空日历当成「用户今天没有安排」。
    calendar_status = str(payload.get("calendar_status") or "ok").strip()[:24] or "ok"
    record = {
        "reported_at": reported_at,
        "sampled_at_ms": sampled_at_ms,
        "calendar": events,
        "calendar_status": calendar_status,
        "calendar_reason": str(payload.get("calendar_reason") or "").strip()[:24],
        "do_not_disturb": payload.get("do_not_disturb") if isinstance(payload.get("do_not_disturb"), bool) else None,
        "dnd_status": str(payload.get("dnd_status") or ("ok" if isinstance(payload.get("do_not_disturb"), bool) else "unavailable"))[:24],
        "scene": str(payload.get("scene") or "").strip()[:24],
        "location": str(payload.get("location") or "").strip()[:24],
        "device": str(payload.get("device") or "").strip()[:24],
    }
    path = _path(cfg, username)
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            previous = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = {}
        if isinstance(previous, dict) and int(previous.get("sampled_at_ms") or int(previous.get("reported_at") or 0) * 1000) > sampled_at_ms:
            return previous
        path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    return record


def load_device_context(cfg: Mapping[str, Any], username: str, *, now: Optional[int] = None) -> Dict[str, Any]:
    path = _path(cfg, username)
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(record, dict):
        return {}
    try:
        reported_at = int(record.get("reported_at") or 0)
    except (TypeError, ValueError):
        reported_at = 0
    current = int(now or time.time())
    if current > 10_000_000_000:
        current //= 1000
    if reported_at and current - reported_at > _MAX_AGE_SECONDS:
        return {}
    return record


def merge_into_signals(cfg: Mapping[str, Any], username: str, signals: Mapping[str, Any], *, now: Optional[int] = None) -> Dict[str, Any]:
    """触发源没带的字段用端侧上报补齐；显式传入的信号优先。"""
    merged = dict(signals)
    stored = load_device_context(cfg, username, now=now)
    if not stored:
        return merged
    if "calendar" not in merged and stored.get("calendar"):
        merged["calendar"] = stored["calendar"]
    if str(stored.get("calendar_status") or "ok") != "ok":
        merged.setdefault("calendar_unavailable", True)
        merged.setdefault("calendar_unavailable_reason", str(stored.get("calendar_reason") or ""))
    if "do_not_disturb" not in merged and isinstance(stored.get("do_not_disturb"), bool):
        merged["do_not_disturb"] = stored["do_not_disturb"]
    merged.setdefault("dnd_status", "ok" if "do_not_disturb" in signals else stored.get("dnd_status") or "unavailable")
    if stored.get("dnd_status") == "unavailable" and "do_not_disturb" not in signals:
        merged.setdefault("dnd_unavailable", True)
    for key in ("scene", "location", "device"):
        if not merged.get(key) and stored.get(key):
            merged[key] = stored[key]
    merged["device_reported_at"] = stored.get("reported_at")
    return merged
