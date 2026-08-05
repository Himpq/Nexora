import hashlib
import os
import queue
import threading
import time
from typing import Any, Dict, List

from conversation_manager import ConversationManager
from database import User
from model import Model
from usage_logs import append_usage_log_record
import prompts


MEMORY_ANALYSIS_QUEUE_SIZE = 128
MEMORY_APPEND_MAX_CHARS = 1000
MEMORY_PROFILE_MAX_CHARS = 4000
MEMORY_RECENT_TURN_LIMIT = 5
MEMORY_ASSISTANT_CONTEXT_HEAD_CHARS = 75
MEMORY_ASSISTANT_CONTEXT_TAIL_CHARS = 75


def _message_text(message: Dict[str, Any]) -> str:
    content = message.get("content", "") if isinstance(message, dict) else ""

    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: List[str] = []

        for item in content:
            if not isinstance(item, dict):
                continue

            text = item.get("text")

            if text:
                parts.append(str(text).strip())

        return "\n".join([part for part in parts if part]).strip()

    return str(content or "").strip()


def _clip_assistant_context(text: str) -> str:
    """保留助手回复首尾语境，用户原文不在这里截断。"""
    value = str(text or "").strip()
    head_chars = MEMORY_ASSISTANT_CONTEXT_HEAD_CHARS
    tail_chars = MEMORY_ASSISTANT_CONTEXT_TAIL_CHARS

    if len(value) <= head_chars + tail_chars:
        return value

    return (
        f"{value[:head_chars]}"
        "\n...[中间内容已截断]...\n"
        f"{value[-tail_chars:]}"
    )


def _normalize_memory_reason(value: Any) -> str:
    return " ".join(str(value or "").split())[:200]


def _format_memory_tool(
    model: Model,
    name: str,
    description: str,
    argument_name: str,
    argument_description: str
) -> Dict[str, Any]:
    properties = {}
    required = []

    if argument_name:
        properties[argument_name] = {
            "type": "string",
            "description": argument_description,
            "maxLength": 200 if argument_name == "reason" else MEMORY_PROFILE_MAX_CHARS
        }
        required.append(argument_name)

    parameters = {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False
    }

    if model._provider_use_responses_api(model.provider):
        return {
            "type": "function",
            "name": name,
            "description": description,
            "parameters": parameters
        }

    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters
        }
    }


class MemoryAnalysisQueue:
    """普通聊天用户画像分析队列，保证任务按提交顺序串行执行。"""

    def __init__(self):
        self._queue = queue.Queue(maxsize=MEMORY_ANALYSIS_QUEUE_SIZE)
        self._worker_lock = threading.Lock()
        self._worker_thread = None

    def enqueue(
        self,
        *,
        username: str,
        conversation_id: str,
        assistant_index: int,
        model_name: str,
        completion_callback=None
    ) -> Dict[str, Any]:
        user_key = str(username or "").strip()
        conversation_key = str(conversation_id or "").strip()
        model_key = str(model_name or "").strip()

        if not user_key or not conversation_key or assistant_index < 0 or not model_key:
            raise ValueError("memory analysis job fields are incomplete")

        seed = f"{user_key}|{conversation_key}|{int(assistant_index)}|{model_key}"
        job_id = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
        job = {
            "job_id": job_id,
            "username": user_key,
            "conversation_id": conversation_key,
            "assistant_index": int(assistant_index),
            "model_name": model_key,
            "created_at": time.time(),
            "_completion_callback": completion_callback if callable(completion_callback) else None
        }

        try:
            self._queue.put_nowait(job)
        except queue.Full as error:
            self._log_event(job, "rejected", error="memory analysis queue is full")
            raise RuntimeError("memory analysis queue is full") from error

        self._log_event(job, "queued")
        self._ensure_worker()

        return {
            "queued": True,
            "job_id": job_id,
            "queue_size": self._queue.qsize()
        }

    def _ensure_worker(self) -> None:
        with self._worker_lock:
            if self._worker_thread is not None and self._worker_thread.is_alive():
                return

            self._worker_thread = threading.Thread(
                target=self._worker_loop,
                name="memory-analysis-worker",
                daemon=True
            )
            self._worker_thread.start()

    def _worker_loop(self) -> None:
        while True:
            job = self._queue.get()

            try:
                self._execute_job(job)
            except Exception as error:
                self._log_event(job, "failed", error=str(error))
                print(
                    f"[MEMORY_ANALYSIS] failed job_id={job.get('job_id')} "
                    f"conversation_id={job.get('conversation_id')} error={error}"
                )
            finally:
                self._queue.task_done()

    def _execute_job(self, job: Dict[str, Any]) -> None:
        context = self._load_context(job)
        user = User(job["username"])
        analysis_model, model_source = self._resolve_analysis_model(user, job)

        job["analysis_model"] = analysis_model
        job["analysis_model_source"] = model_source
        self._log_event(job, "started")
        existing_memory = user.get_user_profile_memory(max_chars=0)
        prompt = self._build_prompt(context, existing_memory)
        usage_state = {
            "input": 0,
            "output": 0,
            "raw_input": 0,
            "cached_input": 0,
            "estimated": False
        }
        # 用户保存的记忆模型是明确执行选择；不可静默改用会话模型。
        job["requested_analysis_model"] = analysis_model
        job["analysis_model_fallback"] = False
        job["analysis_model_fallback_error"] = ""
        decision = self._run_model_decision(job, prompt, analysis_model, usage_state)

        result = self._apply_decision(user, existing_memory, decision)
        memory_io_tokens = {
            "input": int(usage_state["input"]),
            "output": int(usage_state["output"]),
            "raw_input": int(usage_state["raw_input"]),
            "cached_input": int(usage_state["cached_input"]),
            "total": int(usage_state["input"] + usage_state["output"]),
            "estimated": bool(usage_state["estimated"])
        }
        completed_at = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
        manager = ConversationManager(job["username"])
        manager.update_message_metadata(
            job["conversation_id"],
            int(job["assistant_index"]),
            {
                "memory_io_tokens": memory_io_tokens,
                "memory_analysis": {
                    "job_id": str(job["job_id"]),
                    "status": "completed",
                    "action": str(result["action"]),
                    "reason": str(result.get("reason") or ""),
                    "update_content": str(result.get("update_content") or ""),
                    "model": analysis_model,
                    "model_source": model_source,
                    "requested_model": str(job.get("requested_analysis_model") or analysis_model),
                    "fallback_used": bool(job.get("analysis_model_fallback", False)),
                    "fallback_error": str(job.get("analysis_model_fallback_error") or "")[:500],
                    "completed_at": completed_at
                }
            }
        )
        self._log_event(
            job,
            "completed",
            action=result["action"],
            reason=result.get("reason", ""),
            memory_length=len(result["memory"])
        )

        completion_callback = job.get("_completion_callback")

        if callable(completion_callback):
            try:
                completion_callback({
                    "conversation_id": str(job["conversation_id"]),
                    "assistant_index": int(job["assistant_index"]),
                    "memory_io_tokens": memory_io_tokens,
                    "memory_action": str(result["action"]),
                    "memory_reason": str(result.get("reason") or ""),
                    "memory_model": analysis_model,
                    "memory_model_requested": str(job.get("requested_analysis_model") or analysis_model),
                    "memory_model_fallback": bool(job.get("analysis_model_fallback", False)),
                    "memory_model_fallback_error": str(job.get("analysis_model_fallback_error") or "")[:500],
                    "completed_at": completed_at
                })
            except Exception as callback_error:
                print(
                    f"[MEMORY_ANALYSIS] completion callback failed job_id={job.get('job_id')} "
                    f"error={callback_error}"
                )
        print(
            f"[MEMORY_ANALYSIS] completed job_id={job.get('job_id')} "
            f"conversation_id={job.get('conversation_id')} action={result['action']} "
            f"model={analysis_model} model_source={model_source} "
            f"fallback_used={bool(job.get('analysis_model_fallback', False))} "
            f"reason={result.get('reason', '')}"
        )

    def _run_model_decision(
        self,
        job: Dict[str, Any],
        prompt: str,
        analysis_model: str,
        usage_state: Dict[str, Any]
    ) -> Dict[str, Any]:
        decision = {
            "calls": [],
            "action": "",
            "content": "",
            "reason": ""
        }
        model = Model(
            username=job["username"],
            model_name=analysis_model,
            system_prompt=prompts.MEMORY_ANALYSIS_SYSTEM_PROMPT,
            conversation_id=job["conversation_id"],
            auto_create=False,
            persist_conversation=False,
            include_profile_context=False
        )
        model._usage_action_type = "memory"
        model._usage_metadata = {
            "memory_analysis": True,
            "memory_job_id": job["job_id"],
            "memory_action": "decision",
            "memory_model_source": str(job.get("analysis_model_source") or "conversation"),
            "source_assistant_index": int(job["assistant_index"])
        }

        def _observe_usage(usage: Dict[str, Any]) -> None:
            usage_state["input"] += int(max(0, (usage or {}).get("input", 0) or 0))
            usage_state["output"] += int(max(0, (usage or {}).get("output", 0) or 0))
            usage_state["raw_input"] += int(max(0, (usage or {}).get("raw_input", 0) or 0))
            usage_state["cached_input"] += int(max(0, (usage or {}).get("cached_input", 0) or 0))
            usage_state["estimated"] = bool(usage_state["estimated"] or (usage or {}).get("estimated", False))

        model._usage_observer = _observe_usage

        def _record(action: str, arguments: Dict[str, Any]) -> str:
            content = str((arguments or {}).get("content") or "").strip()
            reason = _normalize_memory_reason((arguments or {}).get("reason"))
            decision["calls"].append({
                "action": action,
                "content": content,
                "reason": reason
            })

            if not decision["action"]:
                decision["action"] = action
                decision["content"] = content
                decision["reason"] = reason

            return "memory decision recorded"

        tool_specs = [
            (
                "memory_keep",
                "本轮没有值得新增或修改的长期用户记忆，必须用 reason 简短说明原因。",
                "reason",
                "不更新长期记忆的简短原因，不得复述敏感内容。",
                lambda args: _record("keep", args)
            ),
            (
                "memory_append",
                "追加一条新的长期用户记忆。",
                "content",
                "需要追加的长期用户记忆。",
                lambda args: _record("append", args)
            ),
            (
                "memory_overwrite",
                "用 content 中的完整用户画像覆盖当前画像。",
                "content",
                "覆盖后的完整用户画像。",
                lambda args: _record("overwrite", args)
            )
        ]

        for name, description, argument_name, argument_description, handler in tool_specs:
            model.register_external_function_tool(
                _format_memory_tool(
                    model,
                    name,
                    description,
                    argument_name,
                    argument_description
                ),
                handler=handler
            )

        model.configure_external_tool_execution(
            exclusive=True,
            require_tool_call=True
        )
        stream_error = ""

        for chunk in model.sendMessage(
            prompt,
            stream=True,
            max_rounds=1,
            enable_thinking=False,
            enable_web_search=False,
            enable_tools=True,
            tool_mode="force",
            include_context=False,
            disable_thinking_after_tool_call=True,
            conversation_mode="chat"
        ):
            if not isinstance(chunk, dict):
                continue

            if str(chunk.get("type") or "").strip() == "error":
                stream_error = str(chunk.get("content") or "memory model error").strip()

        if stream_error:
            raise RuntimeError(stream_error)

        if len(decision["calls"]) != 1:
            raise ValueError(
                f"memory model must call exactly one tool, received {len(decision['calls'])}"
            )

        return decision

    def _resolve_analysis_model(self, user: User, job: Dict[str, Any]) -> tuple[str, str]:
        preferences = user.get_preferences()
        configured_model = str(preferences.get("memory_update_model") or "").strip()
        analysis_model = configured_model or str(job.get("model_name") or "").strip()

        if not analysis_model:
            raise ValueError("memory analysis model is empty")

        model_source = "preference" if configured_model else "conversation"
        return analysis_model, model_source

    def _load_context(self, job: Dict[str, Any]) -> Dict[str, Any]:
        manager = ConversationManager(job["username"])
        conversation = manager.get_conversation(job["conversation_id"])
        messages = conversation.get("messages", []) if isinstance(conversation, dict) else []

        if not isinstance(messages, list):
            raise ValueError("conversation messages are invalid")

        assistant_index = int(job["assistant_index"])

        if assistant_index >= len(messages):
            raise ValueError("assistant message is not persisted")

        assistant_message = messages[assistant_index]

        if str((assistant_message or {}).get("role") or "").strip().lower() != "assistant":
            raise ValueError("target message is not assistant")

        user_index = assistant_index - 1

        if user_index < 0:
            raise ValueError("current user message is missing")

        user_message = messages[user_index]

        if str((user_message or {}).get("role") or "").strip().lower() != "user":
            raise ValueError("message before assistant is not user")

        current_user_text = _message_text(user_message)
        current_assistant_text = _message_text(assistant_message)

        if not current_user_text or not current_assistant_text:
            raise ValueError("current turn has no complete text")

        recent_turns = []
        pending_assistant = None

        for message in reversed(messages[:assistant_index + 1]):
            role = str((message or {}).get("role") or "").strip().lower()

            if role == "assistant" and pending_assistant is None:
                pending_assistant = message
                continue

            if role != "user" or pending_assistant is None:
                continue

            user_text = _message_text(message)
            assistant_text = _message_text(pending_assistant)
            pending_assistant = None

            if not user_text or not assistant_text:
                continue

            recent_turns.append({
                "user": user_text,
                "assistant": _clip_assistant_context(assistant_text)
            })

            if len(recent_turns) >= MEMORY_RECENT_TURN_LIMIT:
                break

        recent_turns.reverse()

        return {
            "recent_turns": recent_turns,
            "current_user": current_user_text,
            "current_assistant": _clip_assistant_context(current_assistant_text)
        }

    def _build_prompt(self, context: Dict[str, Any], existing_memory: str) -> str:
        recent_turns = list(context.get("recent_turns") or [])[-MEMORY_RECENT_TURN_LIMIT:]
        turn_blocks = []

        for index, turn in enumerate(recent_turns, start=1):
            current_marker = " current=\"true\"" if index == len(recent_turns) else ""
            turn_blocks.append(
                f"<TURN index=\"{index}\"{current_marker}>\n"
                f"用户: {str((turn or {}).get('user') or '').strip()}\n"
                f"助手摘要: {str((turn or {}).get('assistant') or '').strip()}\n"
                "</TURN>"
            )

        recent_text = "\n\n".join(turn_blocks).strip() or "无"

        return (
            "<EXISTING_MEMORY>\n"
            f"{str(existing_memory or '').strip()}\n"
            "</EXISTING_MEMORY>\n\n"
            f"<RECENT_TURNS count=\"{len(recent_turns)}\">\n"
            f"{recent_text}\n"
            "</RECENT_TURNS>"
        )

    def _apply_decision(
        self,
        user: User,
        existing_memory: str,
        decision: Dict[str, Any]
    ) -> Dict[str, str]:
        action = str(decision.get("action") or "").strip()
        content = str(decision.get("content") or "").strip()
        reason = _normalize_memory_reason(decision.get("reason"))
        current = str(existing_memory or "").strip()

        if action == "keep":
            if not reason:
                raise ValueError("memory_keep reason is required")

            return {
                "action": "keep",
                "memory": current,
                "reason": reason[:200],
                "update_content": ""
            }

        if action == "append":
            if not content:
                raise ValueError("memory_append content is empty")

            if len(content) > MEMORY_APPEND_MAX_CHARS:
                raise ValueError("memory_append content is too long")

            if content in current:
                return {
                    "action": "keep_duplicate",
                    "memory": current,
                    "reason": "",
                    "update_content": content
                }

            next_memory = f"{current}\n{content}".strip()

        elif action == "overwrite":
            if not content:
                raise ValueError("memory_overwrite content is empty")

            next_memory = content

            if current.startswith("用户权限:") and not next_memory.startswith("用户权限:"):
                raise ValueError("memory_overwrite must preserve user permission prefix")

        else:
            raise ValueError(f"unknown memory action: {action}")

        if len(next_memory) > MEMORY_PROFILE_MAX_CHARS:
            raise ValueError("updated memory profile is too long")

        saved = user.set_user_profile_memory(next_memory, max_chars=0)

        return {
            "action": action,
            "memory": saved,
            "reason": "",
            "update_content": content
        }

    def _log_event(
        self,
        job: Dict[str, Any],
        status: str,
        *,
        action: str = "",
        reason: str = "",
        error: str = "",
        memory_length: int = 0
    ) -> None:
        username = str(job.get("username") or "").strip()

        if not username:
            return

        user = User(username)
        log_path = os.path.join(user.path, "memory_analysis.json")
        append_usage_log_record(log_path, {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
            "job_id": str(job.get("job_id") or ""),
            "status": str(status or ""),
            "action": str(action or ""),
            "reason": _normalize_memory_reason(reason),
            "error": str(error or "")[:500],
            "conversation_id": str(job.get("conversation_id") or ""),
            "assistant_index": int(job.get("assistant_index", -1) or -1),
            "model": str(job.get("analysis_model") or job.get("model_name") or ""),
            "requested_model": str(
                job.get("requested_analysis_model")
                or job.get("analysis_model")
                or job.get("model_name")
                or ""
            ),
            "source_model": str(job.get("model_name") or ""),
            "model_source": str(job.get("analysis_model_source") or "conversation"),
            "fallback_used": bool(job.get("analysis_model_fallback", False)),
            "fallback_error": str(job.get("analysis_model_fallback_error") or "")[:500],
            "memory_length": int(memory_length or 0),
            "queue_size": self._queue.qsize()
        })


_MEMORY_ANALYSIS_QUEUE = MemoryAnalysisQueue()


def get_memory_analysis_queue() -> MemoryAnalysisQueue:
    return _MEMORY_ANALYSIS_QUEUE
