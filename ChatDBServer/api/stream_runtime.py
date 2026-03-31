import copy
import threading
import time
import uuid
from typing import Any, Callable, Dict, Generator, Optional, Tuple


_SESSIONS_LOCK = threading.Lock()
_SESSIONS: Dict[str, Dict[str, Any]] = {}

_MAX_CHUNKS_PER_SESSION = 12000
_DONE_TTL_SEC = 900
_STALE_RUNNING_TTL_SEC = 7200
_CANCEL_SENTINEL = "__STREAM_CANCELLED__"


def _new_session(username: str, conversation_id: str = "") -> Dict[str, Any]:
    return {
        "stream_id": uuid.uuid4().hex,
        "username": str(username or "").strip(),
        "conversation_id": str(conversation_id or "").strip(),
        "created_at": time.time(),
        "updated_at": time.time(),
        "status": "running",  # running | done
        "head_seq": 1,
        "last_seq": 0,
        "chunks": [],  # list[dict]
        "error": "",
        "cancel_requested": False,
        "cancel_reason": "",
        "cond": threading.Condition(threading.Lock()),
    }


def cleanup_sessions() -> None:
    now = time.time()
    with _SESSIONS_LOCK:
        remove_ids = []
        for sid, s in list(_SESSIONS.items()):
            status = str(s.get("status") or "done")
            updated_at = float(s.get("updated_at") or 0)
            age = max(0.0, now - updated_at)
            if status == "running":
                if age > _STALE_RUNNING_TTL_SEC:
                    remove_ids.append(sid)
            else:
                if age > _DONE_TTL_SEC:
                    remove_ids.append(sid)
        for sid in remove_ids:
            _SESSIONS.pop(sid, None)


def start_session(
    username: str,
    conversation_id: str,
    worker: Callable[[Callable[[Dict[str, Any]], None], Callable[[str], None]], None],
) -> str:
    cleanup_sessions()
    session = _new_session(username=username, conversation_id=conversation_id)
    stream_id = session["stream_id"]
    with _SESSIONS_LOCK:
        _SESSIONS[stream_id] = session

    def _set_conversation_id(cid: str) -> None:
        val = str(cid or "").strip()
        if not val:
            return
        cond = session["cond"]
        with cond:
            session["conversation_id"] = val
            session["updated_at"] = time.time()
            cond.notify_all()

    def _push_chunk(chunk: Dict[str, Any]) -> None:
        payload = copy.deepcopy(chunk) if isinstance(chunk, dict) else {"type": "message", "content": str(chunk)}
        cid = str(payload.get("conversation_id") or "").strip()
        cond = session["cond"]
        with cond:
            if bool(session.get("cancel_requested", False)):
                raise RuntimeError(_CANCEL_SENTINEL)
            if cid:
                session["conversation_id"] = cid
            session["last_seq"] = int(session["last_seq"]) + 1
            payload["_stream_seq"] = int(session["last_seq"])
            session["chunks"].append(payload)
            if len(session["chunks"]) > _MAX_CHUNKS_PER_SESSION:
                session["chunks"].pop(0)
                session["head_seq"] = int(session["head_seq"]) + 1
            session["updated_at"] = time.time()
            cond.notify_all()

    def _finish(status: str = "done", error: str = "") -> None:
        cond = session["cond"]
        with cond:
            session["status"] = str(status or "done")
            session["error"] = str(error or "")
            session["updated_at"] = time.time()
            cond.notify_all()

    def _run():
        try:
            worker(_push_chunk, _set_conversation_id)
            _finish("done", "")
        except RuntimeError as e:
            if _CANCEL_SENTINEL in str(e):
                _finish("done", "cancelled")
                return
            try:
                _push_chunk({
                    "type": "error",
                    "content": f"stream runtime worker error: {str(e)}"
                })
            except Exception:
                pass
            _finish("done", str(e))
        except Exception as e:
            try:
                _push_chunk({
                    "type": "error",
                    "content": f"stream runtime worker error: {str(e)}"
                })
            except Exception:
                pass
            _finish("done", str(e))

    t = threading.Thread(target=_run, name=f"stream-runtime-{stream_id[:8]}", daemon=True)
    t.start()
    return stream_id


def get_session_meta(stream_id: str, username: Optional[str] = None) -> Optional[Dict[str, Any]]:
    sid = str(stream_id or "").strip()
    if not sid:
        return None
    with _SESSIONS_LOCK:
        s = _SESSIONS.get(sid)
    if not s:
        return None
    if username is not None and str(s.get("username") or "").strip() != str(username or "").strip():
        return None
    cond = s["cond"]
    with cond:
        return {
            "stream_id": sid,
            "username": str(s.get("username") or "").strip(),
            "conversation_id": str(s.get("conversation_id") or "").strip(),
            "status": str(s.get("status") or "done"),
            "head_seq": int(s.get("head_seq") or 1),
            "last_seq": int(s.get("last_seq") or 0),
            "created_at": float(s.get("created_at") or 0),
            "updated_at": float(s.get("updated_at") or 0),
            "error": str(s.get("error") or ""),
            "cancel_requested": bool(s.get("cancel_requested", False)),
            "cancel_reason": str(s.get("cancel_reason") or ""),
        }


def request_cancel(stream_id: str, username: Optional[str] = None, reason: str = "user_abort") -> bool:
    sid = str(stream_id or "").strip()
    if not sid:
        return False
    with _SESSIONS_LOCK:
        s = _SESSIONS.get(sid)
    if not s:
        return False
    if username is not None and str(s.get("username") or "").strip() != str(username or "").strip():
        return False
    cond = s["cond"]
    with cond:
        s["cancel_requested"] = True
        s["cancel_reason"] = str(reason or "user_abort")
        s["status"] = "done"
        s["updated_at"] = time.time()
        cond.notify_all()
    return True


def is_cancel_requested(stream_id: str) -> bool:
    sid = str(stream_id or "").strip()
    if not sid:
        return False
    with _SESSIONS_LOCK:
        s = _SESSIONS.get(sid)
    if not s:
        return False
    cond = s["cond"]
    with cond:
        return bool(s.get("cancel_requested", False))


def iter_session_chunks(
    stream_id: str,
    *,
    username: Optional[str] = None,
    from_seq: int = 0,
    heartbeat_sec: int = 12
) -> Generator[Tuple[Optional[int], Dict[str, Any]], None, None]:
    sid = str(stream_id or "").strip()
    if not sid:
        return
    with _SESSIONS_LOCK:
        session = _SESSIONS.get(sid)
    if not session:
        return
    if username is not None and str(session.get("username") or "").strip() != str(username or "").strip():
        return

    try:
        cursor = int(from_seq) + 1
    except Exception:
        cursor = 1
    cursor = max(1, cursor)
    heartbeat = max(2, int(heartbeat_sec or 12))
    last_ping_ts = time.time()

    cond = session["cond"]
    while True:
        emit_seq = None
        emit_payload = None
        should_break = False
        now = time.time()

        with cond:
            head_seq = int(session.get("head_seq") or 1)
            last_seq = int(session.get("last_seq") or 0)
            status = str(session.get("status") or "done")
            if cursor < head_seq:
                cursor = head_seq

            if cursor <= last_seq:
                idx = cursor - head_seq
                chunks = session.get("chunks") or []
                if 0 <= idx < len(chunks):
                    payload = chunks[idx]
                    emit_seq = int(payload.get("_stream_seq") or cursor)
                    emit_payload = copy.deepcopy(payload)
                    cursor = emit_seq + 1
                    session["updated_at"] = time.time()
                else:
                    cursor = max(cursor + 1, head_seq)
            elif status != "running":
                should_break = True
            else:
                timeout = min(1.0, float(max(0.2, heartbeat - (now - last_ping_ts))))
                cond.wait(timeout=timeout)

        if emit_payload is not None:
            yield emit_seq, emit_payload
            continue

        if should_break:
            break

        if time.time() - last_ping_ts >= heartbeat:
            last_ping_ts = time.time()
            yield None, {"type": "ping"}
