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

def call_local_tool_sync(username: str, tool_name: str, args: dict, timeout_sec: int = 30) -> dict:
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
        "args": args
    }
    
    try:
        ws.send(json.dumps(payload))
    except Exception as e:
        _PENDING_TASKS.pop(task_id, None)
        return {"error": f"Failed to send request to agent: {e}"}
        
    # Wait for result
    success = event.wait(timeout=timeout_sec)
    task_data = _PENDING_TASKS.pop(task_id, None)
    
    if not success:
        return {"error": f"Local agent execution timeout (>{timeout_sec}s)"}
        
    return task_data.get("result", {"error": "No result received"})

def handle_agent_result(task_id: str, result: Any):
    task = _PENDING_TASKS.get(task_id)
    if task:
        task["result"] = result
        task["event"].set()
