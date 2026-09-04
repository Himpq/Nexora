"""决策器状态持久化（B4）。

状态只保存约束记账（每日推送数、同目标冷却、忽略退避、晚点重试），不保存
决策本身——决策作为时间线条目追加进用户的 learning.jsonl（append-only）。
回复（好/晚点/不用了）就地改写 learning.jsonl 中对应条目的 status/response 字段，
与 core.user 的既有「重写 jsonl」先例（remove_chapter_learning_records）一致。
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

_lock = threading.Lock()

_DECISION_RECORD_TYPE = "agent_decision"


def _state_path(cfg: Dict[str, Any], username: str) -> Path:
    return Path(cfg.get("data_dir") or "data") / "decision" / f"{username}.json"


def _default_state() -> Dict[str, Any]:
    return {
        "daily": {},       # {"2026-09-01": {"fired": n}}
        "cooldowns": {},   # {"lecture|book|chapter": ts}
        "backoff": {},     # {"trigger": {"until_ts": ts, "ignores": n}}
        "defer": {},       # {"trigger": {"retries": n, "retry_at": ts}}
    }


def load_state(cfg: Dict[str, Any], username: str) -> Dict[str, Any]:
    path = _state_path(cfg, username)
    if not path.is_file():
        return _default_state()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return _default_state()
    if not isinstance(value, dict):
        return _default_state()
    state = _default_state()
    for key in state:
        if isinstance(value.get(key), dict):
            state[key] = value[key]
    return state


def save_state(cfg: Dict[str, Any], username: str, state: Dict[str, Any]) -> None:
    path = _state_path(cfg, username)
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.tmp")
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)


def _local_date(now: int) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(now))


def _local_hour(now: int) -> int:
    return int(time.strftime("%H", time.localtime(now)))


def today_fired_count(state: Dict[str, Any], now: int) -> int:
    day = state["daily"].get(_local_date(now))
    if not isinstance(day, dict):
        return 0
    try:
        return int(day.get("fired") or 0)
    except (TypeError, ValueError):
        return 0


def record_fire(state: Dict[str, Any], now: int) -> None:
    day = _local_date(now)
    bucket = state["daily"].setdefault(day, {"fired": 0})
    bucket["fired"] = today_fired_count(state, now) + 1


def target_key(target: Optional[Dict[str, Any]]) -> str:
    if not isinstance(target, dict):
        return ""
    return "|".join(
        str(target.get(field) or "").strip()
        for field in ("lecture_id", "book_id", "chapter_index")
    )


def cooldown_blocked(state: Dict[str, Any], target: Optional[Dict[str, Any]], cooldown_seconds: int, now: int) -> bool:
    key = target_key(target)
    if not key:
        return False
    until = state["cooldowns"].get(key)
    if until is None:
        return False
    try:
        return int(until) > now
    except (TypeError, ValueError):
        return False


def record_cooldown(state: Dict[str, Any], target: Optional[Dict[str, Any]], cooldown_seconds: int, now: int) -> None:
    key = target_key(target)
    if key:
        state["cooldowns"][key] = now + cooldown_seconds


def backoff_blocked(state: Dict[str, Any], trigger: str, now: int) -> bool:
    bucket = state["backoff"].get(trigger)
    if not isinstance(bucket, dict):
        return False
    try:
        return int(bucket.get("until_ts") or 0) > now
    except (TypeError, ValueError):
        return False


def record_dismiss(state: Dict[str, Any], trigger: str, backoff_ignores: int, backoff_seconds: int, now: int) -> bool:
    """记录一次「不用了」。连续 backoff_ignores 次未理会 → 该类型退避 backoff_seconds。

    返回是否触发了退避。
    """
    if not trigger:
        return False
    bucket = state["backoff"].setdefault(trigger, {"until_ts": 0, "ignores": 0})
    try:
        ignores = int(bucket.get("ignores") or 0) + 1
    except (TypeError, ValueError):
        ignores = 1
    if ignores >= backoff_ignores:
        bucket["until_ts"] = now + backoff_seconds
        bucket["ignores"] = 0
        return True
    bucket["ignores"] = ignores
    return False


def defer_blocked(state: Dict[str, Any], trigger: str, defer_retries: int, now: int) -> bool:
    """「晚点」：40 分钟后重试一次，之后不再追。

    重试机会（retry_fires）用尽后永远抑制；未到 retry_at 前也抑制。
    """
    if not trigger:
        return False
    bucket = state["defer"].get(trigger)
    if not isinstance(bucket, dict):
        return False
    try:
        retry_fires = int(bucket.get("retry_fires") or 0)
        retry_at = int(bucket.get("retry_at") or 0)
    except (TypeError, ValueError):
        return False
    if retry_fires >= defer_retries:
        return True
    return now < retry_at


def record_defer(state: Dict[str, Any], trigger: str, defer_seconds: int, now: int) -> None:
    if not trigger:
        return
    bucket = state["defer"].setdefault(trigger, {"retry_fires": 0, "retry_at": 0})
    # 以最后一次点「晚点」为准安排重试时刻；重试机会在 fire 时消耗。
    bucket["retry_at"] = now + defer_seconds


def consume_defer(state: Dict[str, Any], trigger: str) -> bool:
    """重试的那一次真正 fire 后消耗一次重试机会（用尽即不再追）。"""
    bucket = state["defer"].get(trigger)
    if isinstance(bucket, dict):
        try:
            bucket["retry_fires"] = int(bucket.get("retry_fires") or 0) + 1
        except (TypeError, ValueError):
            bucket["retry_fires"] = 1
        return True
    return False


def is_defer_retry(state: Dict[str, Any], trigger: str) -> bool:
    bucket = state["defer"].get(trigger)
    return isinstance(bucket, dict) and int(bucket.get("retry_at") or 0) > 0


def mark_decision_response(
    cfg: Dict[str, Any],
    username: str,
    decision_id: str,
    response: str,
    *,
    params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """就地改写 learning.jsonl 中决策条目的回复状态，并更新约束记账。

    返回 {"updated": bool, "record": {...}|None, "backoff": bool, "retry_at": int|None}。
    """
    from core import user as user_store
    from core.decision.engine import DEFAULT_PARAMS

    resolved = dict(DEFAULT_PARAMS)
    if isinstance(params, dict):
        resolved.update({key: value for key, value in params.items() if key in DEFAULT_PARAMS})

    records = user_store.list_learning_records(cfg, username) or []
    updated_record: Optional[Dict[str, Any]] = None
    kept: List[Dict[str, Any]] = []
    for row in records:
        payload = dict(row) if isinstance(row, dict) else {}
        if str(payload.get("type") or "") == _DECISION_RECORD_TYPE and str(payload.get("decision_id") or "") == decision_id:
            payload["status"] = response
            payload["responded_at"] = int(time.time())
            updated_record = payload
        kept.append(payload)
    if updated_record is None:
        return {"updated": False, "record": None, "backoff": False, "retry_at": None}

    path = Path(cfg.get("data_dir") or "data") / "users" / username / "learning.jsonl"
    serialized = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in kept)
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(serialized, encoding="utf-8")

    state = load_state(cfg, username)
    # 以决策自身的评估时刻为基准排程（排练注入的 now 不写进记录时与墙钟一致）。
    try:
        now = int(updated_record.get("evaluated_at") or updated_record.get("timestamp") or time.time())
    except (TypeError, ValueError):
        now = int(time.time())
    trigger = str(updated_record.get("trigger") or "").strip()
    backoff = False
    retry_at: Optional[int] = None
    if response == "dismiss":
        backoff = record_dismiss(
            state,
            trigger,
            int(resolved["backoff_ignores"]),
            int(resolved["backoff_seconds"]),
            now,
        )
    elif response == "defer":
        record_defer(state, trigger, int(resolved["defer_seconds"]), now)
        retry_at = now + int(resolved["defer_seconds"])
    save_state(cfg, username, state)
    return {"updated": True, "record": updated_record, "backoff": backoff, "retry_at": retry_at}
