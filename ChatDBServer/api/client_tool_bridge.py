import copy
import threading
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple


_LOCK = threading.Lock()
_COND = threading.Condition(_LOCK)
_PENDING: Dict[str, List[Dict[str, Any]]] = {}
_RESPONSES: Dict[str, Dict[str, Any]] = {}

_MAX_PENDING_PER_KEY = 8


def _make_key(username: str, conversation_id: str) -> str:
    return f"{str(username or '').strip()}::{str(conversation_id or '').strip()}"


def _clamp_timeout_ms(v: Any, default_ms: int = 8000) -> int:
    try:
        n = int(v)
    except Exception:
        n = int(default_ms)
    return min(max(n, 500), 30000)


def _clamp_pull_wait_ms(v: Any, default_ms: int = 0) -> int:
    try:
        n = int(v)
    except Exception:
        n = int(default_ms)
    return min(max(n, 0), 20000)


def _prune_expired_locked(now_ts: float) -> None:
    dead_keys: List[str] = []
    for key, queue in _PENDING.items():
        if not isinstance(queue, list):
            dead_keys.append(key)
            continue
        alive = [item for item in queue if float(item.get("expire_at", 0.0) or 0.0) > now_ts]
        if alive:
            _PENDING[key] = alive
        else:
            dead_keys.append(key)
    for key in dead_keys:
        _PENDING.pop(key, None)


def _remove_request_locked(key: str, request_id: str) -> None:
    queue = _PENDING.get(key)
    if not isinstance(queue, list) or not queue:
        return
    _PENDING[key] = [x for x in queue if str(x.get("request_id", "") or "") != request_id]
    if not _PENDING[key]:
        _PENDING.pop(key, None)


def enqueue_request(
    username: str,
    conversation_id: str,
    request_type: str,
    payload: Dict[str, Any],
    timeout_ms: int = 8000,
) -> Dict[str, Any]:
    now_ts = time.time()
    timeout = _clamp_timeout_ms(timeout_ms)
    req_id = uuid.uuid4().hex
    key = _make_key(username, conversation_id)
    request_obj = {
        "request_id": req_id,
        "type": str(request_type or "").strip() or "unknown",
        "conversation_id": str(conversation_id or "").strip(),
        "payload": payload if isinstance(payload, dict) else {},
        "created_at": now_ts,
        "expire_at": now_ts + (timeout / 1000.0) + 5.0,
        "timeout_ms": timeout,
        "poll_count": 0,
    }
    with _COND:
        _prune_expired_locked(now_ts)
        queue = _PENDING.setdefault(key, [])
        queue.append(request_obj)
        if len(queue) > _MAX_PENDING_PER_KEY:
            del queue[0 : len(queue) - _MAX_PENDING_PER_KEY]
        _COND.notify_all()
    return request_obj


def wait_for_result(
    username: str,
    conversation_id: str,
    request_id: str,
    timeout_ms: int = 8000,
) -> Dict[str, Any]:
    timeout = _clamp_timeout_ms(timeout_ms)
    key = _make_key(username, conversation_id)
    deadline = time.time() + (timeout / 1000.0)
    with _COND:
        while True:
            resp = _RESPONSES.pop(request_id, None)
            if isinstance(resp, dict):
                _remove_request_locked(key, request_id)
                return resp
            now_ts = time.time()
            if now_ts >= deadline:
                _remove_request_locked(key, request_id)
                return {
                    "success": False,
                    "error": "client_js_timeout",
                    "message": "客户端 JS 执行超时或未回传结果",
                }
            _COND.wait(timeout=min(0.4, max(0.01, deadline - now_ts)))


def pull_pending_request(
    username: str,
    conversation_id: str,
    wait_ms: int = 0,
) -> Optional[Dict[str, Any]]:
    key = _make_key(username, conversation_id)
    wait_sec = _clamp_pull_wait_ms(wait_ms) / 1000.0
    deadline = time.time() + wait_sec
    with _COND:
        while True:
            now_ts = time.time()
            _prune_expired_locked(now_ts)
            queue = _PENDING.get(key, [])
            if queue:
                req = queue[0]
                req["poll_count"] = int(req.get("poll_count", 0) or 0) + 1
                req["last_polled_at"] = now_ts
                return copy.deepcopy(req)
            if now_ts >= deadline:
                return None
            _COND.wait(timeout=min(0.8, max(0.02, deadline - now_ts)))


def submit_request_result(
    username: str,
    conversation_id: str,
    request_id: str,
    result_payload: Dict[str, Any],
) -> Tuple[bool, str]:
    key = _make_key(username, conversation_id)
    rid = str(request_id or "").strip()
    if not rid:
        return False, "request_id is required"

    with _COND:
        _prune_expired_locked(time.time())
        queue = _PENDING.get(key, [])
        found = None
        for item in queue:
            if str(item.get("request_id", "") or "") == rid:
                found = item
                break
        if found is None:
            return False, "request not found or expired"
        _RESPONSES[rid] = result_payload if isinstance(result_payload, dict) else {}
        _remove_request_locked(key, rid)
        _COND.notify_all()
    return True, ""


def request_client_js_execution(
    username: str,
    conversation_id: str,
    code: str,
    context: Optional[Dict[str, Any]] = None,
    timeout_ms: int = 8000,
) -> Dict[str, Any]:
    js_code = str(code or "").strip()
    if not js_code:
        return {"success": False, "message": "missing code"}

    safe_timeout = _clamp_timeout_ms(timeout_ms)
    ctx = context if isinstance(context, dict) else {}
    req = enqueue_request(
        username=username,
        conversation_id=conversation_id,
        request_type="js_execute",
        payload={
            "code": js_code,
            "context": ctx,
            "timeout_ms": safe_timeout,
        },
        timeout_ms=safe_timeout,
    )
    started = time.time()
    resp = wait_for_result(
        username=username,
        conversation_id=conversation_id,
        request_id=str(req.get("request_id", "") or ""),
        timeout_ms=safe_timeout,
    )
    elapsed_ms = int((time.time() - started) * 1000)
    if not isinstance(resp, dict):
        return {
            "success": False,
            "message": "invalid client response",
            "elapsed_ms": elapsed_ms,
        }
    out = dict(resp)
    out["elapsed_ms"] = elapsed_ms
    out["request_id"] = str(req.get("request_id", "") or "")
    out["conversation_id"] = str(conversation_id or "")
    out["executed_on"] = "client_js"
    return out
