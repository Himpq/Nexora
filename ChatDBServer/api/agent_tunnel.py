import json
import threading
import time
from typing import Dict, Any, Optional
import uuid

# Map of username -> {"ws": websocket, "tools": [], "last_ping": float}
_ACTIVE_AGENTS = {}
_AGENT_LOCK = threading.Lock()
# Pending results map: task_id -> {"event": threading.Event(), "result": None}
_PENDING_TASKS = {}

def register_agent(username, ws):
    with _AGENT_LOCK:
        _ACTIVE_AGENTS[username] = {"ws": ws, "tools": [], "last_ping": time.time()}

def update_agent_tools(username, tools: list):
    with _AGENT_LOCK:
        if username in _ACTIVE_AGENTS:
            _ACTIVE_AGENTS[username]["tools"] = tools

def update_agent_prompt(username, prompt_text: str):
    with _AGENT_LOCK:
        if username in _ACTIVE_AGENTS:
            _ACTIVE_AGENTS[username]["prompt"] = prompt_text

def update_ping(username):
    with _AGENT_LOCK:
        if username in _ACTIVE_AGENTS:
            _ACTIVE_AGENTS[username]["last_ping"] = time.time()

def unregister_agent(username, ws):
    with _AGENT_LOCK:
        agent = _ACTIVE_AGENTS.get(username)
        if agent and agent["ws"] == ws:
            del _ACTIVE_AGENTS[username]

def is_agent_online(username: str) -> bool:
    with _AGENT_LOCK:
        agent = _ACTIVE_AGENTS.get(username)
        # 简单判定：最近60秒内有活跃
        if agent and time.time() - agent["last_ping"] < 60:
            return True
        elif agent:
            # Drop stale connection internally
            del _ACTIVE_AGENTS[username]
        return False

def get_agent_tools(username: str) -> list:
    with _AGENT_LOCK:
        agent = _ACTIVE_AGENTS.get(username)
        if agent and time.time() - agent["last_ping"] < 60:
            return agent.get("tools", [])
        return []

def get_agent_prompt(username: str) -> str:
    with _AGENT_LOCK:
        agent = _ACTIVE_AGENTS.get(username)
        if agent and time.time() - agent["last_ping"] < 60:
            return agent.get("prompt", "")
        return ""

def call_local_tool_sync(username: str, tool_name: str, args: dict, timeout_sec: int = 30, cancel_checker=None) -> dict:
    started_at = time.perf_counter()

    with _AGENT_LOCK:
        agent = _ACTIVE_AGENTS.get(username)
        ws = agent["ws"] if agent else None
        
    if not ws:
        return {"error": "Local agent offline"}
    
    task_id = uuid.uuid4().hex
    event = threading.Event()
    _PENDING_TASKS[task_id] = {"event": event, "result": None}
    
    payload = {
        "type": "call_tool",
        "task_id": task_id,
        "tool_name": tool_name,
        "args": args,
        "sent_at": time.time(),
    }

    try:
        send_started_at = time.perf_counter()
        ws.send(json.dumps(payload))
        send_ms = (time.perf_counter() - send_started_at) * 1000.0
    except Exception as e:
        _PENDING_TASKS.pop(task_id, None)
        return {"error": f"Failed to send request to agent: {e}"}
        
    success = False
    deadline = time.time() + max(0.1, float(timeout_sec or 30))
    while True:
        if callable(cancel_checker) and cancel_checker():
            _PENDING_TASKS.pop(task_id, None)
            return {"success": False, "error": "stream_cancelled", "message": "用户已停止生成"}

        remaining = deadline - time.time()
        if remaining <= 0:
            break

        if event.wait(timeout=min(0.4, max(0.01, remaining))):
            success = True
            break

    task_data = _PENDING_TASKS.pop(task_id, None)
    
    if not success:
        total_ms = (time.perf_counter() - started_at) * 1000.0
        print(
            "[NEXORACODE_TOOL_LATENCY] "
            + json.dumps({
                "stage": "timeout",
                "username": username,
                "tool_name": tool_name,
                "task_id": task_id,
                "send_ms": round(send_ms, 1),
                "total_ms": round(total_ms, 1),
                "timeout_sec": timeout_sec,
            }, ensure_ascii=False, default=str)
        )
        return {"error": f"Local agent execution timeout (>{timeout_sec}s)"}

    total_ms = (time.perf_counter() - started_at) * 1000.0
    if total_ms >= 500.0:
        result_obj = task_data.get("result") if isinstance(task_data, dict) else None
        print(
            "[NEXORACODE_TOOL_LATENCY] "
            + json.dumps({
                "stage": "result",
                "username": username,
                "tool_name": tool_name,
                "task_id": task_id,
                "send_ms": round(send_ms, 1),
                "total_ms": round(total_ms, 1),
                "result_success": bool(result_obj.get("success", True)) if isinstance(result_obj, dict) else None,
            }, ensure_ascii=False, default=str)
        )

    return task_data.get("result", {"error": "No result received"})

def handle_agent_result(task_id: str, result: Any):
    task = _PENDING_TASKS.get(task_id)
    if task:
        task["result"] = result
        task["event"].set()
