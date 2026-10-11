"""Integration tests for serialized queued turns and stream cancellation."""

import sys
import threading
import time
import types
import unittest
import uuid

import test_context_manager as fixtures
from test_context_manager import ROOT, module


class FakeLoop:
    def __init__(
        self,
        store,
        conversation_id,
        queue_store,
        *,
        fail_item_ids=None,
        fail_before_commit_item_ids=None,
        steer_item_id="",
        hold_guided_item_id="",
        checkpoint_with_tool_call=False,
        stream_cancelled_error=None,
    ):
        self.store = store
        self.conversation_id = conversation_id
        self.queue_store = queue_store
        self.fail_item_ids = set(fail_item_ids or [])
        self.fail_before_commit_item_ids = set(fail_before_commit_item_ids or [])
        self.steer_item_id = steer_item_id
        self.hold_guided_item_id = hold_guided_item_id
        self.checkpoint_with_tool_call = checkpoint_with_tool_call
        self.stream_cancelled_error = stream_cancelled_error
        self.calls = []
        self.active_streams = 0
        self.max_active_streams = 0
        self.guide_started = threading.Event()
        self.cancelled = threading.Event()
        self.guide_steered = False

    def stream_send(
        self,
        conversation_id,
        message,
        *,
        cancel_checker,
        queue_item_id="",
        skip_user_message=False,
        should_yield_for_guidance=None,
        **kwargs,
    ):
        self.active_streams += 1
        self.max_active_streams = max(self.max_active_streams, self.active_streams)
        self.calls.append({"message": message, "queue_item_id": queue_item_id})

        try:
            if queue_item_id in self.fail_before_commit_item_ids:
                yield {"type": "error", "message": "request failed before user commit"}

                return

            if not skip_user_message:
                user_message = {"role": "user", "content": message}

                if queue_item_id:
                    user_message["queue_item_id"] = queue_item_id

                self.store.append_message(conversation_id, user_message)

            if queue_item_id:
                yield {"type": "queue_user_committed", "item_id": queue_item_id}

            if queue_item_id in self.fail_item_ids:
                yield {"type": "error", "message": "provider failed"}
                return

            if not queue_item_id and self.steer_item_id and not self.guide_steered:
                self.queue_store.steer(self.conversation_id, self.steer_item_id)
                self.guide_steered = True

            if (
                not queue_item_id
                and self.guide_steered
                and self.checkpoint_with_tool_call
                and should_yield_for_guidance()
            ):
                tool_call_id = "checkpoint-tool-call"
                self.store.append_message(conversation_id, {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{"id": tool_call_id, "name": "local_read_file", "arguments": {}}],
                })
                self.store.append_message(conversation_id, {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": "tool result",
                })
                yield {"type": "function_call", "name": "local_read_file", "call_id": tool_call_id}
                yield {"type": "function_result", "name": "local_read_file", "call_id": tool_call_id, "result": "tool result"}
                yield {"type": "queue_guidance_checkpoint"}

                return

            if self.hold_guided_item_id and queue_item_id == self.hold_guided_item_id:
                self.guide_started.set()

                while not cancel_checker():
                    self.cancelled.wait(0.01)

                raise self.stream_cancelled_error("stream cancelled during guided turn")

            assistant_message = f"assistant:{message}"
            self.store.append_message(conversation_id, {"role": "assistant", "content": assistant_message})
            yield {"type": "content", "content": assistant_message}

            if self.guide_steered and queue_item_id == "" and should_yield_for_guidance():
                yield {"type": "queue_guidance_checkpoint"}

            yield {"type": "done"}
        finally:
            self.active_streams -= 1

    def cancel(self):
        self.cancelled.set()


class QueueRunnerTests(unittest.TestCase):
    def setUp(self):
        fixtures.ContextTests.setUp(self)
        self.queue_module = module("test_model.MessageQueue", ROOT / "model/MessageQueue.py")
        self.queue_store = self.queue_module.MessageQueue()
        self.runtime_module = module("test_model.StreamRuntime", ROOT / "model/StreamRuntime.py")
        self.runner_module = module("test_model.QueueRunner", ROOT / "model/QueueRunner.py")
        self.stream_ids = []

        title_module = types.ModuleType("test_model.TitleGenerator")
        title_module.wait_for_title = lambda *_args, **_kwargs: None
        sys.modules["test_model.TitleGenerator"] = title_module

        self.normalize_messages = lambda messages: [
            dict(message)
            for message in messages
            if isinstance(message, dict) and message.get("role") != "tool"
        ]

    def tearDown(self):
        for stream_id in self.stream_ids:
            self.runtime_module._SESSIONS.pop(stream_id, None)
            self.runtime_module._JOURNALS.pop(stream_id, None)

        fixtures.ContextTests.tearDown(self)

    def enqueue_items(self, messages):
        self.queue_store.pause(self.cid)
        states = [self.queue_store.enqueue(self.cid, message) for message in messages]
        return [state["items"][-1] for state in states]

    def run_worker(self, *, loop, stream_id, message="manual prompt", body=None, push=None):
        chunks = [] if push is None else push

        self.runner_module.run_queue_worker(
            push_chunk=chunks.append,
            set_conversation_id=lambda _conversation_id: None,
            is_cancel_requested=lambda: False,
            loop=loop,
            store=self.store,
            queue_store=self.queue_store,
            conversation_id=self.cid,
            stream_id=stream_id,
            message=message,
            system_prompt="system",
            injection_sources=[],
            enable_thinking=False,
            body=body or {},
            normalize_messages=self.normalize_messages,
            translate_event=lambda event: dict(event),
        )

        return chunks

    def test_multiple_queued_turns_run_serially_with_correct_indexes(self):
        queued = self.enqueue_items(["first queued task", "second queued task"])
        loop = FakeLoop(self.store, self.cid, self.queue_store)

        chunks = self.run_worker(loop=loop, stream_id="serial-run")

        self.assertEqual(
            [call["message"] for call in loop.calls],
            ["manual prompt", "first queued task", "second queued task"],
        )
        self.assertEqual([call["queue_item_id"] for call in loop.calls], ["", queued[0]["id"], queued[1]["id"]])
        self.assertEqual(loop.max_active_streams, 1)

        starts = [chunk for chunk in chunks if chunk.get("type") == "queue_turn_start"]
        ends = [chunk for chunk in chunks if chunk.get("type") == "queue_turn_end"]
        self.assertEqual(
            [(chunk["message"], chunk["user_index"], chunk["assistant_index"]) for chunk in starts],
            [("first queued task", 2, 3), ("second queued task", 4, 5)],
        )
        self.assertEqual(
            [(chunk["assistant_index"], chunk["final_message"]["content"]) for chunk in ends],
            [(1, "assistant:manual prompt"), (3, "assistant:first queued task")],
        )
        self.assertEqual(self.queue_store.snapshot(self.cid)["items"], [])

    def test_provider_error_consumes_committed_item_and_manual_turn_resumes_remaining_queue(self):
        queued = self.enqueue_items(["retry this task", "keep this task behind it"])
        failing_loop = FakeLoop(
            self.store,
            self.cid,
            self.queue_store,
            fail_item_ids={queued[0]["id"]},
        )

        failed_chunks = self.run_worker(loop=failing_loop, stream_id="queue-error")
        paused_state = self.queue_store.snapshot(self.cid)

        self.assertTrue(paused_state["paused"])
        self.assertFalse(paused_state["busy"])
        self.assertEqual([item["id"] for item in paused_state["items"]], [queued[1]["id"]])
        self.assertTrue(any(chunk.get("type") == "error" for chunk in failed_chunks))
        committed_users = [
            row for row in self.store.get(self.cid)["messages"]
            if row.get("queue_item_id") == queued[0]["id"]
        ]
        self.assertEqual(len(committed_users), 1)

        resumed_loop = FakeLoop(self.store, self.cid, self.queue_store)
        self.run_worker(loop=resumed_loop, stream_id="queue-manual-resume", message="manual next message")
        resumed_state = self.queue_store.snapshot(self.cid)

        self.assertEqual(
            [call["message"] for call in resumed_loop.calls],
            ["manual next message", "keep this task behind it"],
        )
        self.assertFalse(resumed_state["paused"])
        self.assertFalse(resumed_state["busy"])
        self.assertEqual(resumed_state["items"], [])

    def test_permission_resume_after_user_cancellation_continues_remaining_queue(self):
        self.queue_store.activate(self.cid, "cancelled-stream", resume=True)
        already_sent = self.queue_store.enqueue(self.cid, "already sent turn")["items"][0]
        pending = self.queue_store.enqueue(self.cid, "continue after permission")["items"][-1]
        claimed = self.queue_store.advance(self.cid)["item"]
        self.assertEqual(claimed["id"], already_sent["id"])
        self.queue_store.mark_committed(self.cid, claimed["id"], item_kind="queued")
        self.queue_store.pause(self.cid, reason="cancelled")
        loop = FakeLoop(self.store, self.cid, self.queue_store)

        chunks = self.run_worker(
            loop=loop,
            stream_id="permission-resume-after-cancel",
            message="continue the interrupted tool call",
            body={"skip_user_message": True, "queue_resume": True},
        )
        state = self.queue_store.snapshot(self.cid)

        self.assertEqual(
            [call["message"] for call in loop.calls],
            ["continue the interrupted tool call", "continue after permission"],
        )
        self.assertEqual(loop.calls[0]["queue_item_id"], "")
        self.assertEqual(loop.calls[1]["queue_item_id"], pending["id"])
        self.assertFalse(state["paused"])
        self.assertFalse(state["busy"])
        self.assertEqual(state["items"], [])
        self.assertTrue(any(chunk.get("type") == "queue_turn_start" for chunk in chunks))

    def test_failure_before_user_commit_returns_active_item_to_queue(self):
        queued = self.enqueue_items(["not committed yet", "keep behind it"])
        loop = FakeLoop(
            self.store,
            self.cid,
            self.queue_store,
            fail_before_commit_item_ids={queued[0]["id"]},
        )

        self.run_worker(loop=loop, stream_id="queue-error-before-commit")
        state = self.queue_store.snapshot(self.cid)

        self.assertTrue(state["paused"])
        self.assertEqual([item["id"] for item in state["items"]], [item["id"] for item in queued])
        self.assertFalse(any(
            row.get("queue_item_id") == queued[0]["id"]
            for row in self.store.get(self.cid)["messages"]
        ))

    def test_checkpoint_turn_end_does_not_apply_intermediate_tool_call_message(self):
        queued = self.enqueue_items(["guided priority task"])
        loop = FakeLoop(
            self.store,
            self.cid,
            self.queue_store,
            steer_item_id=queued[0]["id"],
            checkpoint_with_tool_call=True,
        )

        chunks = self.run_worker(loop=loop, stream_id="tool-checkpoint")
        ends = [chunk for chunk in chunks if chunk.get("type") == "queue_turn_end"]

        self.assertGreaterEqual(len(ends), 1)
        self.assertIsNone(ends[0]["final_message"])
        self.assertEqual(ends[0]["assistant_index"], -1)

    def test_guidance_runs_at_checkpoint_before_regular_queue(self):
        queued = self.enqueue_items(["ordinary task", "guided priority task", "last ordinary task"])
        loop = FakeLoop(
            self.store,
            self.cid,
            self.queue_store,
            steer_item_id=queued[1]["id"],
        )

        chunks = self.run_worker(loop=loop, stream_id="guided-priority")

        self.assertEqual(
            [call["message"] for call in loop.calls],
            ["manual prompt", "guided priority task", "ordinary task", "last ordinary task"],
        )
        starts = [chunk for chunk in chunks if chunk.get("type") == "queue_turn_start"]
        self.assertEqual(
            [(chunk["message"], chunk["user_index"], chunk["assistant_index"]) for chunk in starts],
            [
                ("guided priority task", 2, 3),
                ("ordinary task", 4, 5),
                ("last ordinary task", 6, 7),
            ],
        )
        self.assertEqual(self.queue_store.snapshot(self.cid)["items"], [])

    def test_guide_failure_consumes_committed_message_and_keeps_queue_order(self):
        queued = self.enqueue_items(["before guide", "failing guided task", "after guide"])
        loop = FakeLoop(
            self.store,
            self.cid,
            self.queue_store,
            fail_item_ids={queued[1]["id"]},
            steer_item_id=queued[1]["id"],
        )

        chunks = self.run_worker(loop=loop, stream_id="guide-rollback")
        state = self.queue_store.snapshot(self.cid)

        self.assertTrue(state["paused"])
        self.assertFalse(state["busy"])
        self.assertEqual([item["id"] for item in state["items"]], [queued[0]["id"], queued[2]["id"]])
        self.assertFalse(any(chunk.get("type") == "queue_guide_rollback" for chunk in chunks))

    def test_real_stream_runtime_cancel_rolls_back_active_guide_and_emits_control_frames(self):
        queued = self.enqueue_items(["cancel this guided task", "keep this uncommitted guide"])
        loop = FakeLoop(
            self.store,
            self.cid,
            self.queue_store,
            steer_item_id=queued[0]["id"],
            hold_guided_item_id=queued[0]["id"],
            stream_cancelled_error=self.runtime_module.StreamCancelled,
        )

        def worker(push_chunk, set_conversation_id, _set_stage, is_cancel_requested):
            self.runner_module.run_queue_worker(
                push_chunk=push_chunk,
                set_conversation_id=set_conversation_id,
                is_cancel_requested=is_cancel_requested,
                loop=loop,
                store=self.store,
                queue_store=self.queue_store,
                conversation_id=self.cid,
                stream_id=stream_id,
                message="manual prompt",
                system_prompt="system",
                injection_sources=[],
                enable_thinking=False,
                body={},
                normalize_messages=self.normalize_messages,
                translate_event=lambda event: dict(event),
            )

        stream_id = uuid.uuid4().hex
        started_stream_id = self.runtime_module.start_session(self.cid, worker, stream_id=stream_id)
        self.assertEqual(started_stream_id, stream_id)
        self.stream_ids.append(stream_id)

        self.assertTrue(loop.guide_started.wait(5), "the guided turn should start before cancellation")
        self.queue_store.steer(self.cid, queued[1]["id"])
        self.assertTrue(self.runtime_module.request_cancel(stream_id, "user_stop"))

        deadline = time.monotonic() + 5

        while time.monotonic() < deadline:
            meta = self.runtime_module.get_session_meta(stream_id)

            if meta and meta.get("status") not in {"running", "cancelling"}:
                break

            time.sleep(0.02)

        self.assertIsNotNone(meta)
        self.assertEqual(meta["status"], "done")

        chunks = [chunk for _sequence, chunk in self.runtime_module.iter_session_chunks(stream_id, from_seq=0)]
        chunk_types = [chunk.get("type") for chunk in chunks]
        self.assertIn("stream_cancel_requested", chunk_types)
        self.assertIn("queue_guide_rollback", chunk_types)
        self.assertIn("queue_turn_end", chunk_types)
        self.assertIn("queue_turn_start", chunk_types)
        self.assertEqual(
            self.runtime_module.get_session_meta(stream_id)["assistant_index"],
            next(chunk["assistant_index"] for chunk in chunks if chunk.get("type") == "queue_turn_start"),
        )

        rollback = next(chunk for chunk in chunks if chunk.get("type") == "queue_guide_rollback")
        self.assertEqual(rollback["item_id"], queued[1]["id"])

        final_state = next(
            chunk
            for chunk in reversed(chunks)
            if chunk.get("type") == "queue_state" and chunk.get("paused") is True
        )
        self.assertEqual([item["id"] for item in final_state["items"]], [queued[1]["id"]])
        self.assertEqual(final_state["active_item_id"], "")

    def test_stream_runtime_allows_queue_boundary_frames_after_cancel(self):
        worker_ready = threading.Event()
        release_worker = threading.Event()

        def worker(push_chunk, _set_conversation_id, _set_stage, _is_cancel_requested):
            worker_ready.set()

            if not release_worker.wait(5):
                raise TimeoutError("test worker was not released")

            push_chunk({"type": "queue_turn_end", "assistant_index": 1})
            push_chunk({"type": "queue_turn_start", "user_index": 2, "assistant_index": 3})

        stream_id = uuid.uuid4().hex
        self.runtime_module.start_session(self.cid, worker, stream_id=stream_id)
        self.stream_ids.append(stream_id)
        self.assertTrue(worker_ready.wait(5))
        self.assertTrue(self.runtime_module.request_cancel(stream_id, "user_stop"))
        release_worker.set()

        deadline = time.monotonic() + 5

        while time.monotonic() < deadline:
            meta = self.runtime_module.get_session_meta(stream_id)

            if meta and meta.get("status") not in {"running", "cancelling"}:
                break

            time.sleep(0.02)

        chunks = [chunk for _sequence, chunk in self.runtime_module.iter_session_chunks(stream_id, from_seq=0)]
        chunk_types = [chunk.get("type") for chunk in chunks]

        self.assertIn("queue_turn_end", chunk_types)
        self.assertIn("queue_turn_start", chunk_types)
        self.assertEqual(self.runtime_module.get_session_meta(stream_id)["assistant_index"], 3)


    def test_turn_end_skips_empty_assistant_content_before_final_answer(self):
        """工具轮中间态(空正文 assistant)不能当 final_message 推给前端。

        场景:引导检查点让当前轮暂停,历史里最后一条 assistant 正文为空
        (只带 tool_calls 或只有 reasoning),此时 queue_turn_end 必须给 None,
        否则 applyFinalMessage 会用空正文覆盖正在流式的气泡。
        """
        queued = self.enqueue_items(["guided priority task"])
        loop = FakeLoop(
            self.store,
            self.cid,
            self.queue_store,
            steer_item_id=queued[0]["id"],
            checkpoint_with_tool_call=True,
        )

        chunks = self.run_worker(loop=loop, stream_id="empty-content-guard")
        ends = [chunk for chunk in chunks if chunk.get("type") == "queue_turn_end"]

        self.assertGreaterEqual(len(ends), 1)

        for chunk in ends:
            if chunk["final_message"] is not None:
                self.assertTrue(str(chunk["final_message"].get("content") or "").strip())

    def test_turn_end_returns_none_when_only_reasoning_assistant_exists(self):
        """只有 reasoning、没有正文的 assistant 同样不能当 final_message。"""
        self.store.append_message(self.cid, {"role": "user", "content": "manual prompt"})
        self.store.append_message(self.cid, {
            "role": "assistant",
            "content": "",
            "metadata": {"reasoning_content": "thinking only"},
        })
        loop = FakeLoop(self.store, self.cid, self.queue_store)

        chunks = self.run_worker(loop=loop, stream_id="reasoning-only-guard", message="")
        ends = [chunk for chunk in chunks if chunk.get("type") == "queue_turn_end"]

        if ends:
            self.assertIsNone(ends[0]["final_message"])
            self.assertEqual(ends[0]["assistant_index"], -1)


if __name__ == "__main__":
    unittest.main()
