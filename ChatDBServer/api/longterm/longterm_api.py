from __future__ import annotations

import re
import json
from typing import Any, Dict, List, Optional

import prompts

LONGTERM_MODE_TOKENS = {"longterm", "long_term", "long-term", "lt", "plan"}


def _coerce_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_conversation_mode(mode: Any) -> str:
    token = str(mode or "").strip().lower()
    return "longterm" if token in LONGTERM_MODE_TOKENS else "chat"


def _coerce_plan_list(raw_plan: Any) -> List[str]:
    if not isinstance(raw_plan, list):
        return []
    out: List[str] = []
    for item in raw_plan:
        text = str(item or "").strip()
        if text:
            out.append(text)
    return out


def _coerce_int(value: Any, default: int = -1) -> int:
    try:
        number = int(value)
    except Exception:
        return default
    return number if number >= 0 else default


def _coerce_int_list(raw: Any) -> List[int]:
    if not isinstance(raw, list):
        return []
    out: List[int] = []
    for item in raw:
        try:
            number = int(item)
        except Exception:
            continue
        if number >= 0 and number not in out:
            out.append(number)
    return out


def normalize_longterm_payload(payload: Any, fallback_task: str = "") -> Dict[str, Any]:
    src = payload if isinstance(payload, dict) else {}
    task = str(src.get("task") or src.get("task_text") or fallback_task or "").strip()
    plan = _coerce_plan_list(src.get("plan") if "plan" in src else src.get("plan_text"))
    context = _coerce_text(src.get("context") or src.get("context_text") or "")
    current_index = _coerce_int(src.get("current_index", src.get("currentIndex", -1)), -1)
    done_indices = _coerce_int_list(src.get("done_indices", src.get("doneIndices", [])))
    step = _coerce_text(src.get("step") or src.get("step_title") or src.get("stepTitle") or "")
    if not task and fallback_task:
        task = str(fallback_task or "").strip()
    return {
        "task": task,
        "plan": plan,
        "context": context,
        "step": step,
        "current_index": current_index,
        "done_indices": done_indices,
    }


def normalize_longterm_state(raw: Any) -> Dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    payload = normalize_longterm_payload(
        src,
        fallback_task=str(src.get("task") or ""),
    )
    hook = src.get("hook") if isinstance(src.get("hook"), dict) else {}
    return {
        "active": bool(src.get("active", False)),
        "task": payload["task"],
        "plan": payload["plan"],
        "context": payload.get("context", ""),
        "step": payload.get("step", ""),
        "current_index": payload.get("current_index", -1),
        "done_indices": payload.get("done_indices", []),
        "hook": hook,
    }


def conversation_longterm_root_state(
    payload: Optional[Dict[str, Any]] = None,
    active: bool = False,
    hook: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    normalized = normalize_longterm_payload(payload or {})
    return {
        "active": bool(active),
        "task": normalized["task"],
        "plan": list(normalized["plan"] or []),
        "context": str(normalized.get("context", "") or ""),
        "step": str(normalized.get("step", "") or ""),
        "current_index": int(normalized.get("current_index", -1) or -1),
        "done_indices": list(normalized.get("done_indices", []) or []),
        "hook": hook if isinstance(hook, dict) else {},
    }


def build_longterm_prompt_block(
    task_text: Any = "",
    plan_text: Any = "",
    context_text: Any = "",
    current_plan_text: Any = "",
    confirmation_round: Any = False
) -> str:
    task = _coerce_text(task_text)
    plan = _coerce_text(plan_text)
    context = _coerce_text(context_text)
    current_plan = _coerce_text(current_plan_text)
    out = prompts.build_longterm_system_prompt(
        task_text=task,
        plan_text=plan,
        context_text=context,
        current_plan_text=current_plan,
        confirmation_round=bool(confirmation_round),
    )
    return out


def build_longterm_hook_payload(
    task_text: Any = "",
    plan_text: Any = "",
    context_text: Any = "",
    current_plan_text: Any = "",
    step_text: Any = "",
    current_index: Any = -1,
    done_indices: Any = None,
    prompt_fragment: Any = "",
) -> Dict[str, Any]:
    task = str(task_text or "").strip()
    plan = str(plan_text or "").strip()
    context = _coerce_text(context_text)
    current_plan = _coerce_text(current_plan_text)
    step = _coerce_text(step_text)
    index = _coerce_int(current_index, -1)
    done = _coerce_int_list(done_indices or [])
    prompt = str(prompt_fragment or "").strip()
    return {
        "mode": "longterm",
        "title": "模型已完成 longterm 任务",
        "task": task,
        "plan": plan,
        "context": context,
        "current_plan": current_plan,
        "step": step,
        "current_index": index,
        "done_indices": done,
        "details": {
            "conversation_mode": "longterm",
            "task": task,
            "plan": plan,
            "context": context,
            "current_plan": current_plan,
            "step": step,
            "current_index": index,
            "done_indices": done,
            "prompt_fragment": prompt,
        },
    }


def normalize_longterm_request(
    message: Any = "",
    conversation_mode: Any = "",
    conversation_mode_payload: Any = None
) -> Dict[str, Any]:
    raw_mode = normalize_conversation_mode(conversation_mode) if str(conversation_mode or "").strip() else ""
    payload = normalize_longterm_payload(conversation_mode_payload)
    effective_message = str(message or "")
    if not raw_mode and effective_message.lstrip().lower().startswith('/longterm'):
        raw_mode = 'longterm'
        effective_message = re.sub(r'^\s*/longterm(?:\s+)?', '', effective_message, flags=re.IGNORECASE).strip()
        payload = normalize_longterm_payload(
            {
                **payload,
                'task': effective_message,
            },
            fallback_task=effective_message,
        )
    return {
        "conversation_mode": raw_mode,
        "message": effective_message,
        "conversation_mode_payload": payload,
    }


class LongtermAPI:
    normalize_conversation_mode = staticmethod(normalize_conversation_mode)
    normalize_longterm_payload = staticmethod(normalize_longterm_payload)
    normalize_longterm_state = staticmethod(normalize_longterm_state)
    conversation_longterm_root_state = staticmethod(conversation_longterm_root_state)
    build_longterm_prompt_block = staticmethod(build_longterm_prompt_block)
    build_longterm_hook_payload = staticmethod(build_longterm_hook_payload)
    normalize_longterm_request = staticmethod(normalize_longterm_request)
