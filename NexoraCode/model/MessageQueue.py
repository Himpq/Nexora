"""Persistent per-conversation queue for NexoraCode streaming turns."""

from __future__ import annotations

import copy
import json
import threading
import time
import uuid
from pathlib import Path

from core.config import get_app_root
from .ConversationStore import write_json_atomic


_LOCK = threading.RLock()
_MAX_MESSAGE_CHARS = 20000
_UNSET = object()


class MessageQueue:
    """Store queued and guided messages independently from conversation history."""

    def __init__(self):
        self.root = get_app_root() / "data" / "message_queues"

    def _path(self, conversation_id: str) -> Path:
        safe_id = "".join(char for char in str(conversation_id or "") if char.isalnum() or char in "_-")

        if not safe_id:
            raise ValueError("conversation_id is required")

        return self.root / f"{safe_id}.json"

    def _load_locked(self, conversation_id: str) -> dict:
        path = self._path(conversation_id)

        if not path.is_file():
            return {
                "conversation_id": conversation_id,
                "items": [],
                "pending_guidance": [],
                "inflight_guidance": [],
                "paused": False,
                "pause_reason": "",
                "busy_stream_id": "",
                "active_item_id": "",
                "active_item": None,
                "permission_item_id": "",
                "permission_item_kind": "",
                "permission_pending": False,
                "permission_resume_pending": False,
                "next_order": 1,
                "revision": 0,
                "updated_at": time.time(),
            }

        state = json.loads(path.read_text(encoding="utf-8"))

        if not isinstance(state, dict) or state.get("conversation_id") != conversation_id:
            raise ValueError("queue state is invalid")

        state.setdefault("pause_reason", "")
        state.setdefault("permission_pending", False)
        state.setdefault("permission_resume_pending", False)

        return state

    def _save_locked(self, state: dict) -> None:
        state["revision"] = int(state.get("revision") or 0) + 1
        state["updated_at"] = time.time()
        self.root.mkdir(parents=True, exist_ok=True)
        write_json_atomic(self._path(state["conversation_id"]), state)

    @staticmethod
    def _message_is_committed(item: dict, committed_item_ids: set[str] | None = None) -> bool:
        item_id = str(item.get("id") or "")

        return bool(item.get("message_committed")) or item_id in (committed_item_ids or set())

    @staticmethod
    def committed_item_ids_from_history(conversation: dict | None) -> set[str]:
        if not isinstance(conversation, dict):
            return set()

        messages = conversation.get("messages")

        if not isinstance(messages, list):
            return set()

        return {
            str(message.get("queue_item_id") or "").strip()
            for message in messages
            if (
                isinstance(message, dict)
                and str(message.get("role") or "") == "user"
                and str(message.get("queue_item_id") or "").strip()
            )
        }

    @staticmethod
    def _restore_guidance_locked(state: dict, committed_item_ids: set[str] | None = None) -> list[dict]:
        guides = state["inflight_guidance"] + state["pending_guidance"]
        state["inflight_guidance"] = []
        state["pending_guidance"] = []
        restored = []

        for item in guides:
            if MessageQueue._message_is_committed(item, committed_item_ids):
                continue

            item.pop("queue_position", None)
            state["items"].append(item)
            restored.append(item)

        state["items"].sort(key=lambda item: int(item.get("order") or 0))
        return restored

    def snapshot(self, conversation_id: str) -> dict:
        with _LOCK:
            state = self._load_locked(conversation_id)
            return self._public_state(state)

    @staticmethod
    def _public_state(state: dict) -> dict:
        return {
            "conversation_id": str(state.get("conversation_id") or ""),
            "items": copy.deepcopy(state.get("items") or []),
            "paused": bool(state.get("paused", False)),
            "busy": bool(state.get("busy_stream_id")),
            "active_item_id": str(state.get("active_item_id") or ""),
            "active_item": copy.deepcopy(state.get("active_item")),
            "permission_item_id": str(state.get("permission_item_id") or ""),
            "permission_item_kind": str(state.get("permission_item_kind") or ""),
            "pending_guidance": len(state.get("pending_guidance") or []) + len(state.get("inflight_guidance") or []),
            "updated_at": float(state.get("updated_at") or 0),
            "revision": int(state.get("revision") or 0),
        }

    def reconcile(
        self,
        conversation_id: str,
        active_stream_ids: set[str],
        *,
        committed_item_ids: set[str] | None = None,
    ) -> dict:
        with _LOCK:
            state = self._load_locked(conversation_id)
            stream_id = str(state.get("busy_stream_id") or "")

            if stream_id and stream_id not in active_stream_ids:
                if state.get("active_item") and not self._message_is_committed(
                    state["active_item"], committed_item_ids
                ):
                    state["items"].append(state["active_item"])
                    state["items"].sort(key=lambda item: int(item.get("order") or 0))

                state["active_item"] = None
                self._restore_guidance_locked(state, committed_item_ids)
                state["busy_stream_id"] = ""
                state["active_item_id"] = ""
                state["paused"] = True
                state["pause_reason"] = "interrupted"
                self._save_locked(state)

            return self._public_state(state)

    def activate(
        self,
        conversation_id: str,
        stream_id: str,
        *,
        resume: bool = False,
        resume_permission: bool = False,
    ) -> dict:
        with _LOCK:
            state = self._load_locked(conversation_id)

            if state.get("busy_stream_id"):
                raise ValueError("conversation queue is already active")

            state["busy_stream_id"] = str(stream_id or "")

            # 权限续跑解锁 paused 的两种情况:
            #   1. 用户主动停止(cancelled)——续跑就是用户重新放行的动作;
            #   2. 该队列正处于等待权限状态(permission_pending)——续跑到达即说明
            #      权限已解决,即使中途被 reconcile 标成 interrupted 也要放行,
            #      否则 advance 会因 paused 拒绝取下一项,队列永久停摆。
            # 错误(error)暂停仍需用户手动重新发消息,不在这里解锁。
            permission_pending = bool(state.get("permission_pending"))

            if resume or (
                resume_permission
                and (state.get("pause_reason") == "cancelled" or permission_pending)
            ):
                state["paused"] = False
                state["pause_reason"] = ""

            if resume_permission:
                # 续跑目标(引导/队列项)可能还冻结在 inflight_guidance 或 active_item 里,
                # 交给 advance 复用,所以只清标记、保留定位信息。
                state["permission_pending"] = False
                state["permission_resume_pending"] = permission_pending
            else:
                state["permission_item_id"] = ""
                state["permission_item_kind"] = ""

            self._save_locked(state)
            return self._public_state(state)

    def enqueue(self, conversation_id: str, message: str, enable_thinking=None) -> dict:
        clean_message = str(message or "").strip()

        if not clean_message:
            raise ValueError("message is required")

        if len(clean_message) > _MAX_MESSAGE_CHARS:
            raise ValueError(f"message exceeds {_MAX_MESSAGE_CHARS} characters")

        if enable_thinking is not None and not isinstance(enable_thinking, bool):
            raise ValueError("enable_thinking must be boolean or null")

        with _LOCK:
            state = self._load_locked(conversation_id)

            # 等待权限时流已 detach(busy=False),但续跑会带着队列一起执行,
            # 所以额外放行这一种情况;其余仍要求 busy 或已暂停。
            if (
                not state.get("busy_stream_id")
                and not state.get("paused")
                and not state.get("permission_pending")
            ):
                raise ValueError("conversation is not streaming")

            item = {
                "id": uuid.uuid4().hex,
                "message": clean_message,
                "enable_thinking": enable_thinking,
                "created_at": time.time(),
                "order": int(state.get("next_order") or 1),
            }
            state["next_order"] = item["order"] + 1
            state["items"].append(item)
            self._save_locked(state)
            return self._public_state(state)

    def update(self, conversation_id: str, item_id: str, message: str, enable_thinking=_UNSET) -> dict:
        clean_message = str(message or "").strip()

        if not clean_message:
            raise ValueError("message is required")

        if len(clean_message) > _MAX_MESSAGE_CHARS:
            raise ValueError(f"message exceeds {_MAX_MESSAGE_CHARS} characters")

        if enable_thinking is not _UNSET and enable_thinking is not None and not isinstance(enable_thinking, bool):
            raise ValueError("enable_thinking must be boolean or null")

        with _LOCK:
            state = self._load_locked(conversation_id)

            for item in state["items"]:
                if str(item.get("id") or "") == item_id:
                    item["message"] = clean_message

                    if enable_thinking is not _UNSET:
                        item["enable_thinking"] = enable_thinking
                    self._save_locked(state)
                    return self._public_state(state)

            raise KeyError("queue item not found")

    def remove(self, conversation_id: str, item_id: str) -> dict:
        with _LOCK:
            state = self._load_locked(conversation_id)
            old_count = len(state["items"])
            state["items"] = [item for item in state["items"] if str(item.get("id") or "") != item_id]

            if len(state["items"]) == old_count:
                raise KeyError("queue item not found")

            self._save_locked(state)
            return self._public_state(state)

    def steer(self, conversation_id: str, item_id: str) -> dict:
        with _LOCK:
            state = self._load_locked(conversation_id)

            # 等待权限时流已 detach(busy=False),但队列仍可操作:续跑会带着引导
            # 消息一起执行。否则用户在这个窗口里既不能引导也不能入队。
            if state.get("paused"):
                raise ValueError("conversation is not actively streaming")

            if not state.get("busy_stream_id") and not state.get("permission_pending"):
                raise ValueError("conversation is not actively streaming")

            for index, item in enumerate(state["items"]):
                if str(item.get("id") or "") != item_id:
                    continue

                guided = dict(item)
                guided["queue_position"] = index
                state["items"].pop(index)
                state["pending_guidance"].append(guided)
                self._save_locked(state)
                return self._public_state(state)

            raise KeyError("queue item not found")

    def advance(self, conversation_id: str, *, completed_item_id="", completed_guidance_id="") -> dict:
        """Atomically finish the prior turn and claim the next turn or close the stream."""
        with _LOCK:
            state = self._load_locked(conversation_id)

            if completed_item_id and state.get("active_item_id") == completed_item_id:
                state["active_item_id"] = ""
                state["active_item"] = None

            if completed_guidance_id:
                state["inflight_guidance"] = [
                    item for item in state["inflight_guidance"]
                    if str(item.get("id") or "") != completed_guidance_id
                ]

            item = None
            kind = ""

            # 权限续跑:目标引导已在 inflight_guidance 里(等待权限时被冻结),
            # 直接复用它,不再从 pending/items 里取。
            resuming_permission = bool(state.get("permission_resume_pending"))

            if resuming_permission and state.get("permission_item_kind") == "guided":
                resume_id = str(state.get("permission_item_id") or "")
                item = next(
                    (
                        guide for guide in state["inflight_guidance"]
                        if str(guide.get("id") or "") == resume_id
                    ),
                    None,
                )

                if item is not None:
                    kind = "guided"

            # 权限续跑:目标队列项还在 active_item 里(等待权限时被冻结),
            # 直接复用它,不再从 items 里取。
            if (
                item is None
                and resuming_permission
                and state.get("permission_item_kind") == "queued"
            ):
                active_item = state.get("active_item")

                if isinstance(active_item, dict):
                    item = active_item
                    state["active_item_id"] = str(item.get("id") or "")
                    kind = "queued"

            if item is None and not state.get("paused") and state["pending_guidance"]:
                item = state["pending_guidance"].pop(0)
                state["inflight_guidance"].append(item)
                kind = "guided"
            elif item is None and not state.get("paused") and state["items"]:
                item = state["items"].pop(0)
                state["active_item"] = item
                state["active_item_id"] = str(item.get("id") or "")
                kind = "queued"

            finished = item is None

            # 续跑目标已被本次 advance 消费,清掉定位信息,避免影响后续轮次。
            if resuming_permission:
                state["permission_resume_pending"] = False
                state["permission_item_id"] = ""
                state["permission_item_kind"] = ""

            if finished:
                state["busy_stream_id"] = ""
                state["active_item_id"] = ""
                state["active_item"] = None

                if not state["items"] and not state["pending_guidance"] and not state["inflight_guidance"]:
                    state["paused"] = False
                    state["pause_reason"] = ""

            self._save_locked(state)
            return {
                "item": copy.deepcopy(item),
                "kind": kind,
                "finished": finished,
                "state": self._public_state(state),
            }

    def mark_committed(self, conversation_id: str, item_id: str, *, item_kind: str) -> dict:
        """Persist that a queue item's user message is already in conversation history."""
        safe_item_id = str(item_id or "").strip()

        if not safe_item_id:
            raise ValueError("item_id is required")

        with _LOCK:
            state = self._load_locked(conversation_id)
            item = None

            if item_kind == "queued":
                active_item = state.get("active_item")
                if isinstance(active_item, dict) and str(active_item.get("id") or "") == safe_item_id:
                    item = active_item
            elif item_kind == "guided":
                item = next(
                    (
                        guide for guide in state["inflight_guidance"]
                        if str(guide.get("id") or "") == safe_item_id
                    ),
                    None,
                )
            else:
                raise ValueError("item_kind must be queued or guided")

            if item is None:
                raise KeyError("active queue item not found")

            item["message_committed"] = True
            self._save_locked(state)
            return self._public_state(state)

    def has_pending_guidance(self, conversation_id: str) -> bool:
        with _LOCK:
            return bool(self._load_locked(conversation_id)["pending_guidance"])

    def rollback_guidance(
        self,
        conversation_id: str,
        *,
        pause_reason: str = "cancelled",
    ) -> tuple[list[dict], dict]:
        with _LOCK:
            state = self._load_locked(conversation_id)
            rolled_back = self._restore_guidance_locked(state)
            state["permission_item_id"] = ""
            state["permission_item_kind"] = ""
            state["busy_stream_id"] = ""
            # 同 pause:取消也可能发生在等待权限期间,保留标记让续跑能解锁。

            if state.get("active_item"):
                active_item = state["active_item"]
                state["active_item"] = None

                if not self._message_is_committed(active_item):
                    state["items"].append(active_item)

            state["items"].sort(key=lambda item: int(item.get("order") or 0))
            state["paused"] = True
            state["pause_reason"] = str(pause_reason or "cancelled")
            state["active_item_id"] = ""
            self._save_locked(state)
            return copy.deepcopy(rolled_back), self._public_state(state)

    def permission_resume_item(self, conversation_id: str) -> dict | None:
        with _LOCK:
            state = self._load_locked(conversation_id)

            # 等待权限期间被 pause(进程重启/流异常)时也要能取到续跑项,
            # 否则续跑流拿不到 item_id,引导消息无法被标记为已提交。
            if state.get("paused") and not state.get("permission_pending"):
                return None

            item_id = str(state.get("permission_item_id") or "")
            item_kind = str(state.get("permission_item_kind") or "")

            if item_kind == "guided":
                return copy.deepcopy(next(
                    (item for item in state["inflight_guidance"] if str(item.get("id") or "") == item_id),
                    None,
                ))

            if item_kind == "queued" and state.get("active_item"):
                return copy.deepcopy(state["active_item"])

            return None

    def wait_for_permission(self, conversation_id: str, *, item_id="", item_kind="") -> dict:
        """Detach a permission-blocked stream while preserving queued work for resume.

        记录 permission_pending:权限续跑要能直接引导并启用队列,不能因为进程重启
        等外部原因把 paused 置位后卡住。续跑到达时由 activate 消费这个标记解锁。
        """
        with _LOCK:
            state = self._load_locked(conversation_id)
            state["busy_stream_id"] = ""
            state["permission_item_id"] = str(item_id or "")
            state["permission_item_kind"] = str(item_kind or "")
            state["permission_pending"] = True

            self._save_locked(state)
            return self._public_state(state)

    def pause(self, conversation_id: str, *, reason: str = "error") -> dict:
        with _LOCK:
            state = self._load_locked(conversation_id)
            state["paused"] = True
            state["pause_reason"] = str(reason or "error")
            state["busy_stream_id"] = ""
            state["active_item_id"] = ""

            # 等待权限期间暂停(进程重启/流异常)要保留续跑定位信息与标记,
            # 否则续跑拿不到 item_id 也解不了 paused,队列永久停摆。
            if not state.get("permission_pending"):
                state["permission_item_id"] = ""
                state["permission_item_kind"] = ""

            if state.get("active_item"):
                if not self._message_is_committed(state["active_item"]):
                    state["items"].append(state["active_item"])

                state["active_item"] = None

            # 等待权限时 inflight 引导就是续跑目标,必须留在 inflight_guidance,
            # 退回 items 会让 permission_resume_item 取不到它。
            if not state.get("permission_pending"):
                self._restore_guidance_locked(state)

            state["items"].sort(key=lambda item: int(item.get("order") or 0))
            self._save_locked(state)
            return self._public_state(state)

