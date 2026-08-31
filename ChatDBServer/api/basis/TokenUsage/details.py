import hashlib
import json
from typing import Any, Dict, List, Optional

from basis.Conversation import ConversationService


class TokenUsageDetailPresenter:
    """将 Token 日志精确关联到会话消息，并生成 Markdown Present 内容。"""

    def __init__(self, username: str):
        self.username = str(username or "").strip()
        self.conversation_service = ConversationService(self.username)
        # 兼容旧属性
        self.conversation_manager = self.conversation_service

    @staticmethod
    def build_reference(log: Dict[str, Any]) -> str:
        log_id = str((log or {}).get("log_id") or "").strip()

        if log_id:
            return f"log_{log_id}"

        payload = {key: value for key, value in dict(log or {}).items() if key != "detail_ref"}
        canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        return f"legacy_{digest}"

    def decorate_history(self, logs: List[Dict[str, Any]], limit: int = 20) -> List[Dict[str, Any]]:
        history = []

        for log in list(logs or [])[:max(0, int(limit))]:
            if not isinstance(log, dict):
                continue

            item = dict(log)
            item["detail_ref"] = self.build_reference(log)
            history.append(item)

        return history

    def present(self, logs: List[Dict[str, Any]], detail_ref: str) -> Dict[str, Any]:
        reference = str(detail_ref or "").strip()

        if not reference:
            raise ValueError("Token 详情引用不能为空")

        log = self._find_log(logs, reference)

        if log is None:
            raise LookupError("Token 记录不存在或已过期")

        detail = self._base_detail(log)
        resolved = self._resolve_messages(log)

        if resolved is None:
            detail.update({
                "available": False,
                "user_markdown": "该条旧 Token 日志没有保存消息关联标识，无法精确定位用户提问。",
                "response_markdown": self._build_unavailable_response(log),
            })

            return detail

        user_message = resolved.get("user") or {}
        assistant_message = resolved.get("assistant") or {}
        detail["available"] = True
        detail["user_markdown"] = self._message_content(user_message)

        if bool(log.get("memory_analysis")):
            detail["response_markdown"] = self._build_memory_response(log, assistant_message)
        else:
            detail["response_markdown"] = self._message_content(assistant_message)

        return detail

    def _find_log(self, logs: List[Dict[str, Any]], detail_ref: str) -> Optional[Dict[str, Any]]:
        for log in list(logs or []):
            if isinstance(log, dict) and self.build_reference(log) == detail_ref:
                return log

        return None

    def _base_detail(self, log: Dict[str, Any]) -> Dict[str, Any]:
        input_tokens = self._safe_int(log.get("input_tokens"))
        output_tokens = self._safe_int(log.get("output_tokens"))
        total_tokens = self._safe_int(log.get("total_tokens"))

        if total_tokens <= 0:
            total_tokens = input_tokens + output_tokens

        action = str(log.get("action") or "chat").strip() or "chat"

        return {
            "title": "MEMORY 模型详情" if bool(log.get("memory_analysis")) else "Token 调用详情",
            "timestamp": str(log.get("timestamp") or ""),
            "conversation_title": str(log.get("conversation_title") or ""),
            "action": action,
            "model": str(log.get("model") or ""),
            "provider": str(log.get("provider") or ""),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
        }

    def _resolve_messages(self, log: Dict[str, Any]) -> Optional[Dict[str, Dict[str, Any]]]:
        conversation_id = str(log.get("conversation_id") or "").strip()

        if not conversation_id or conversation_id in {"unknown", "transient"}:
            return None

        conversation = self.conversation_service.get_conversation(conversation_id)
        messages = conversation.get("messages", []) if isinstance(conversation, dict) else []

        if not isinstance(messages, list):
            raise ValueError("对话消息结构无效")

        assistant_index = self._find_assistant_index(messages, log)

        if assistant_index < 0:
            return None

        user_index = -1

        for index in range(assistant_index - 1, -1, -1):
            message = messages[index]

            if isinstance(message, dict) and str(message.get("role") or "").strip() == "user":
                user_index = index
                break

        return {
            "assistant": messages[assistant_index],
            "user": messages[user_index] if user_index >= 0 else {},
        }

    def _find_assistant_index(self, messages: List[Dict[str, Any]], log: Dict[str, Any]) -> int:
        source_index = self._safe_int(log.get("source_assistant_index"), default=-1)

        if self._is_assistant_at(messages, source_index):
            return source_index

        memory_job_id = str(log.get("memory_job_id") or "").strip()

        if memory_job_id:
            for index, message in enumerate(messages):
                analysis = self._message_metadata(message).get("memory_analysis", {})

                if isinstance(analysis, dict) and str(analysis.get("job_id") or "").strip() == memory_job_id:
                    return index if self._is_assistant_at(messages, index) else -1

        response_trace_id = str(log.get("response_trace_id") or "").strip()

        if response_trace_id:
            for index, message in enumerate(messages):
                metadata = self._message_metadata(message)

                if str(metadata.get("token_response_trace_id") or "").strip() == response_trace_id:
                    return index if self._is_assistant_at(messages, index) else -1

        return -1

    def _build_memory_response(self, log: Dict[str, Any], assistant_message: Dict[str, Any]) -> str:
        analysis = self._message_metadata(assistant_message).get("memory_analysis", {})

        if not isinstance(analysis, dict):
            analysis = {}

        status = str(analysis.get("status") or "processing").strip() or "processing"
        action = str(analysis.get("action") or log.get("memory_action") or "decision").strip() or "decision"
        reason = str(analysis.get("reason") or "").strip()
        update_content = str(analysis.get("update_content") or "").strip()
        model = str(analysis.get("model") or log.get("model") or "").strip()
        requested_model = str(analysis.get("requested_model") or "").strip()
        model_source = str(analysis.get("model_source") or "").strip()
        fallback_used = bool(analysis.get("fallback_used", False))
        completed_at = str(analysis.get("completed_at") or "").strip()
        lines = [
            "### MEMORY 决策",
            "",
            f"- 状态：`{self._inline_code(status)}`",
            f"- 操作：`{self._inline_code(action)}`",
        ]

        if reason:
            lines.extend(["", "#### reason", "", reason])

        if update_content:
            lines.extend(["", "#### 更新记忆", "", self._fenced_text(update_content)])
        elif action in {"append", "overwrite", "keep_duplicate"} and status == "completed":
            lines.extend(["", "> 该条记录生成于更新内容开始持久化之前，因此没有可展示的写入正文。"])

        lines.extend(["", "#### 模型", ""])

        if model:
            lines.append(f"- 实际模型：`{self._inline_code(model)}`")

        if requested_model:
            lines.append(f"- 请求模型：`{self._inline_code(requested_model)}`")

        if model_source:
            lines.append(f"- 模型来源：`{self._inline_code(model_source)}`")

        lines.append(f"- 发生回退：`{'是' if fallback_used else '否'}`")

        if completed_at:
            lines.append(f"- 完成时间：`{self._inline_code(completed_at)}`")

        return "\n".join(lines).strip()

    def _build_unavailable_response(self, log: Dict[str, Any]) -> str:
        return "\n".join([
            "### 调用信息",
            "",
            f"- 类型：`{self._inline_code(log.get('action') or 'chat')}`",
            f"- 模型：`{self._inline_code(log.get('model') or '未记录')}`",
            f"- 输入 Token：`{self._safe_int(log.get('input_tokens'))}`",
            f"- 输出 Token：`{self._safe_int(log.get('output_tokens'))}`",
            "",
            "> 该条旧记录没有 `source_assistant_index` 或 `response_trace_id`，因此不按时间猜测模型响应。",
        ])

    @staticmethod
    def _message_metadata(message: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(message, dict):
            return {}

        metadata = message.get("metadata", {})

        return metadata if isinstance(metadata, dict) else {}

    @staticmethod
    def _message_content(message: Dict[str, Any]) -> str:
        if not isinstance(message, dict):
            return "未找到对应消息。"

        content = message.get("content", "")

        if isinstance(content, str):
            return content.strip() or "该消息没有文本内容。"

        return json.dumps(content, ensure_ascii=False, indent=2, default=str)

    @staticmethod
    def _is_assistant_at(messages: List[Dict[str, Any]], index: int) -> bool:
        return (
            0 <= index < len(messages)
            and isinstance(messages[index], dict)
            and str(messages[index].get("role") or "").strip() == "assistant"
        )

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return int(default)

    @staticmethod
    def _inline_code(value: Any) -> str:
        return str(value or "").replace("`", "\\`").replace("\n", " ")

    @staticmethod
    def _fenced_text(value: str) -> str:
        text = str(value or "")
        fence = "```"

        while fence in text:
            fence += "`"

        return f"{fence}text\n{text}\n{fence}"
