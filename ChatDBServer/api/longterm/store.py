import json
import threading
from typing import Any, Dict, List, Optional


_USER_LOCKS: Dict[str, threading.Lock] = {}
_LOCK_GUARD = threading.Lock()
_MEM_TASKS: Dict[str, Dict[str, Dict[str, Any]]] = {}


def _get_user_lock(username: str) -> threading.Lock:
    key = str(username or "").strip()
    with _LOCK_GUARD:
        if key not in _USER_LOCKS:
            _USER_LOCKS[key] = threading.Lock()
        return _USER_LOCKS[key]


class LongTermTaskStore:
    """
    Long-term 任务存储层（内存版）
    - 不落盘，不创建目录
    - 生命周期随进程重启而清空
    """

    def __init__(self, username: str):
        self.username = str(username or "").strip()
        self._lock = _get_user_lock(self.username)
        with self._lock:
            if self.username not in _MEM_TASKS:
                _MEM_TASKS[self.username] = {}

    def save_task(self, task: Dict[str, Any]) -> None:
        task_id = str(task.get("id") or "").strip()
        if not task_id:
            raise ValueError("task.id is required")
        with self._lock:
            # 内存中保留深拷贝，防止外部对象引用造成隐式篡改
            _MEM_TASKS[self.username][task_id] = json.loads(json.dumps(task, ensure_ascii=False))

    def load_task(self, task_id: str) -> Dict[str, Any]:
        tid = str(task_id or "").strip()
        if not tid:
            raise FileNotFoundError("task not found: empty task_id")
        with self._lock:
            data = _MEM_TASKS.get(self.username, {}).get(tid)
            if not isinstance(data, dict):
                raise FileNotFoundError(f"task not found: {task_id}")
            if not isinstance(data, dict):
                raise ValueError(f"invalid task content: {task_id}")
            return json.loads(json.dumps(data, ensure_ascii=False))

    def list_tasks(self, limit: int = 100, status: Optional[str] = None) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit or 100), 1000))
        status_filter = str(status or "").strip().lower()

        with self._lock:
            entries: List[Dict[str, Any]] = []
            user_tasks = _MEM_TASKS.get(self.username, {})
            for _, data in user_tasks.items():
                if not isinstance(data, dict):
                    continue

                st = str(data.get("status") or "").lower()
                if status_filter and st != status_filter:
                    continue

                plan = data.get("plan", {}) if isinstance(data.get("plan"), dict) else {}
                steps = plan.get("steps", []) if isinstance(plan.get("steps"), list) else []
                done_count = 0
                for s in steps:
                    if isinstance(s, dict) and str(s.get("status") or "") == "done":
                        done_count += 1

                entries.append({
                    "id": data.get("id"),
                    "title": data.get("title"),
                    "goal": data.get("goal"),
                    "status": data.get("status"),
                    "phase": (data.get("pointer") or {}).get("phase"),
                    "current_step_id": (data.get("pointer") or {}).get("current_step_id"),
                    "step_total": len(steps),
                    "step_done": done_count,
                    "updated_at": int(data.get("updated_at", 0) or 0),
                    "created_at": int(data.get("created_at", 0) or 0),
                })

            entries.sort(key=lambda x: int(x.get("updated_at") or 0), reverse=True)
            return entries[:limit]
