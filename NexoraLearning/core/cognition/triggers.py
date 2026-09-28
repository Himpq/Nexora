"""困惑归因的自动触发（fire-and-forget）。

`scan_confusion` 幂等、可频繁调，但每次全量读 telemetry CSV，所以放线程里；
同一用户 60 秒内只跑一次，避免连续提问 / 频繁上报把它打成风暴。
接线点：阅读会话完成（learning_progress.session_complete）、答题结算（/review/submit）、
上下文提问（/ask-in-context）。失败只记事件，不影响主请求。
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, Mapping

from core.runlog import log_event

_LOCK = threading.Lock()
_LAST_RUN: Dict[str, float] = {}
_INFLIGHT: set[str] = set()
THROTTLE_SECONDS = 60.0


def _due(username: str, now: float) -> bool:
    with _LOCK:
        if username in _INFLIGHT:
            return False
        last = _LAST_RUN.get(username, 0.0)
        if now - last < THROTTLE_SECONDS:
            return False
        _LAST_RUN[username] = now
        _INFLIGHT.add(username)
        return True


def _finish(username: str) -> None:
    with _LOCK:
        _INFLIGHT.discard(username)


def reset_throttle() -> None:
    """测试用。"""
    with _LOCK:
        _LAST_RUN.clear()
        _INFLIGHT.clear()


def schedule_confusion_scan(cfg: Mapping[str, Any], username: str, *, reason: str = "", sync: bool = False) -> bool:
    """返回是否真的安排了一次扫描（被节流时返回 False）。sync=True 只给测试用。"""
    user = str(username or "").strip()
    if not user:
        return False
    if not _due(user, time.time()):
        return False

    def run() -> None:
        try:
            from core.cognition.attribution import scan_confusion

            result = scan_confusion(cfg, user)
            log_event("confusion_scan_auto", "困惑扫描（自动触发）", payload={
                "user_id": user, "reason": reason, "ran": bool(result.get("ran")),
                "evidence_written": int(result.get("evidence_written") or 0),
                "cards_written": int(result.get("cards_written") or 0),
            })
        except Exception as exc:  # noqa: BLE001 - 后台线程不能抛
            log_event("confusion_scan_auto_failed", "困惑扫描（自动触发）失败", payload={"user_id": user, "reason": reason, "error": str(exc)})
        finally:
            _finish(user)

    if sync:
        run()
        return True
    threading.Thread(target=run, name=f"confusion-scan-{user[:24]}", daemon=True).start()
    return True
