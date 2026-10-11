"""Persistence and ordering tests for serial NexoraCode message queues."""

import unittest
import threading

import test_context_manager as fixtures
from test_context_manager import ROOT, module


class MessageQueueTests(unittest.TestCase):
    def setUp(self):
        fixtures.ContextTests.setUp(self)
        self.queue_module = module("test_model.MessageQueue", ROOT / "model/MessageQueue.py")
        self.queue = self.queue_module.MessageQueue()

    def tearDown(self):
        fixtures.ContextTests.tearDown(self)

    def test_claimed_message_is_hidden_and_restored_after_failure(self):
        self.queue.activate(self.cid, "stream-1", resume=True)
        first = self.queue.enqueue(self.cid, "first")
        second = self.queue.enqueue(self.cid, "second")
        first_id = first["items"][0]["id"]

        claimed = self.queue.advance(self.cid)["item"]

        self.assertEqual(claimed["id"], first_id)
        snapshot = self.queue.snapshot(self.cid)
        self.assertEqual([item["message"] for item in snapshot["items"]], ["second"])
        self.assertEqual(snapshot["active_item_id"], first_id)

        self.queue.pause(self.cid)
        restored = self.queue.snapshot(self.cid)
        self.assertTrue(restored["paused"])
        self.assertEqual([item["message"] for item in restored["items"]], ["first", "second"])
        self.assertEqual(restored["active_item_id"], "")

    def test_committed_active_message_is_consumed_when_queue_pauses(self):
        self.queue.activate(self.cid, "stream-committed", resume=True)
        queued = self.queue.enqueue(self.cid, "already sent")
        self.queue.enqueue(self.cid, "still pending")
        active = self.queue.advance(self.cid)["item"]

        self.queue.mark_committed(self.cid, active["id"], item_kind="queued")
        state = self.queue.pause(self.cid)

        self.assertEqual(active["id"], queued["items"][0]["id"])
        self.assertEqual([item["message"] for item in state["items"]], ["still pending"])
        self.assertEqual(state["active_item_id"], "")

    def test_reconcile_uses_conversation_history_to_consume_committed_message(self):
        self.queue.activate(self.cid, "stream-before-crash", resume=True)
        self.queue.enqueue(self.cid, "saved before queue marker")
        active = self.queue.advance(self.cid)["item"]
        committed_ids = self.queue.committed_item_ids_from_history({
            "messages": [
                {"role": "assistant", "queue_item_id": "not-a-user-message"},
                {"role": "user", "queue_item_id": active["id"]},
                {"role": "user", "queue_item_id": ""},
            ],
        })
        self.assertEqual(committed_ids, {active["id"]})

        state = self.queue.reconcile(
            self.cid,
            set(),
            committed_item_ids=committed_ids,
        )

        self.assertTrue(state["paused"])
        self.assertFalse(state["busy"])
        self.assertEqual(state["items"], [])
        self.assertIsNone(state["active_item"])

    def test_guide_is_removed_then_reinserted_in_original_order(self):
        self.queue.activate(self.cid, "stream-2", resume=True)
        before = self.queue.enqueue(self.cid, "before")
        guided = self.queue.enqueue(self.cid, "guide")
        after = self.queue.enqueue(self.cid, "after")
        guide_id = guided["items"][1]["id"]
        moved = self.queue.steer(self.cid, guide_id)
        self.assertEqual([item["message"] for item in moved["items"]], ["before", "after"])
        self.assertEqual(moved["pending_guidance"], 1)
        self.assertEqual(self.queue.advance(self.cid)["item"]["id"], guide_id)

        rolled_back, state = self.queue.rollback_guidance(self.cid)

        self.assertEqual([item["id"] for item in rolled_back], [guide_id])
        self.assertTrue(state["paused"])
        self.assertEqual([item["message"] for item in state["items"]], ["before", "guide", "after"])
        self.assertEqual(state["items"][0]["id"], before["items"][0]["id"])
        self.assertEqual(state["items"][2]["id"], after["items"][2]["id"])

    def test_rollback_consumes_committed_guide_and_restores_uncommitted_guide(self):
        self.queue.activate(self.cid, "stream-guide-commit", resume=True)
        self.queue.enqueue(self.cid, "before")
        first_guide = self.queue.enqueue(self.cid, "already sent guide")
        second_guide = self.queue.enqueue(self.cid, "not sent guide")
        self.queue.enqueue(self.cid, "after")
        first_guide_id = first_guide["items"][1]["id"]
        second_guide_id = second_guide["items"][2]["id"]
        self.queue.steer(self.cid, first_guide_id)
        self.queue.steer(self.cid, second_guide_id)
        self.queue.advance(self.cid)
        self.queue.mark_committed(self.cid, first_guide_id, item_kind="guided")

        rolled_back, state = self.queue.rollback_guidance(self.cid)

        self.assertEqual([item["id"] for item in rolled_back], [second_guide_id])
        self.assertEqual(
            [item["message"] for item in state["items"]],
            ["before", "not sent guide", "after"],
        )

    def test_queue_survives_restart_and_reconciles_active_state(self):
        self.queue.activate(self.cid, "stream-3", resume=True)
        self.queue.enqueue(self.cid, "queued")
        self.queue.enqueue(self.cid, "guided")
        state = self.queue.snapshot(self.cid)
        guide_id = state["items"][1]["id"]
        self.queue.steer(self.cid, guide_id)
        self.queue.advance(self.cid)

        restored = self.queue_module.MessageQueue().reconcile(self.cid, set())

        self.assertTrue(restored["paused"])
        self.assertFalse(restored["busy"])
        self.assertEqual([item["message"] for item in restored["items"]], ["queued", "guided"])
        self.assertEqual(restored["pending_guidance"], 0)

    def test_advance_claims_or_finishes_atomically(self):
        self.queue.activate(self.cid, "stream-4", resume=True)
        first = self.queue.enqueue(self.cid, "first")
        second = self.queue.enqueue(self.cid, "second")

        started = self.queue.advance(self.cid)

        self.assertEqual(started["kind"], "queued")
        self.assertEqual(started["item"]["id"], first["items"][0]["id"])
        self.assertEqual(started["state"]["active_item_id"], first["items"][0]["id"])

        finished = self.queue.advance(self.cid, completed_item_id=first["items"][0]["id"])

        self.assertEqual(finished["kind"], "queued")
        self.assertEqual(finished["item"]["id"], second["items"][1]["id"])

        closed = self.queue.advance(self.cid, completed_item_id=second["items"][1]["id"])

        self.assertTrue(closed["finished"])
        self.assertFalse(closed["state"]["busy"])
        self.assertEqual(closed["state"]["items"], [])
        with self.assertRaisesRegex(ValueError, "not streaming"):
            self.queue.enqueue(self.cid, "too late")

    def test_patch_without_thinking_preserves_existing_value(self):
        self.queue.activate(self.cid, "stream-5", resume=True)
        state = self.queue.enqueue(self.cid, "queued", True)
        item_id = state["items"][0]["id"]

        updated = self.queue.update(self.cid, item_id, "edited")

        self.assertEqual(updated["items"][0]["message"], "edited")
        self.assertIs(updated["items"][0]["enable_thinking"], True)

    def test_rollback_returns_only_guides_and_restores_active_queue_item(self):
        self.queue.activate(self.cid, "stream-6", resume=True)
        queue_item = self.queue.enqueue(self.cid, "ordinary")
        guide = self.queue.enqueue(self.cid, "guide")
        self.queue.advance(self.cid)
        self.queue.steer(self.cid, guide["items"][1]["id"])

        rolled_back, state = self.queue.rollback_guidance(self.cid)

        self.assertEqual([item["message"] for item in rolled_back], ["guide"])
        self.assertEqual([item["message"] for item in state["items"]], ["ordinary", "guide"])
        self.assertEqual(state["items"][0]["id"], queue_item["items"][0]["id"])

    def test_permission_wait_detaches_stream_without_pausing_pending_queue(self):
        self.queue.activate(self.cid, "stream-7", resume=True)
        guide = self.queue.enqueue(self.cid, "guided")
        guide_id = guide["items"][0]["id"]
        self.queue.steer(self.cid, guide_id)
        self.queue.advance(self.cid)

        state = self.queue.wait_for_permission(self.cid, item_id=guide_id, item_kind="guided")

        self.assertFalse(state["busy"])
        self.assertFalse(state["paused"])
        self.assertEqual(state["pending_guidance"], 1)
        self.assertEqual(self.queue.permission_resume_item(self.cid)["id"], guide_id)

    def test_manual_successful_stream_resumes_queue_paused_after_error(self):
        self.queue.activate(self.cid, "stream-8", resume=True)
        self.queue.enqueue(self.cid, "retry after error")
        self.queue.pause(self.cid)
        self.assertTrue(self.queue.snapshot(self.cid)["paused"])

        self.queue.activate(self.cid, "stream-9", resume=True)
        started = self.queue.advance(self.cid)

        self.assertFalse(started["state"]["paused"])
        self.assertEqual(started["item"]["message"], "retry after error")

    def test_permission_resume_unpauses_queue_after_user_cancellation(self):
        self.queue.activate(self.cid, "stream-10", resume=True)
        self.queue.enqueue(self.cid, "continue queued work")
        self.queue.pause(self.cid, reason="cancelled")

        self.queue.activate(
            self.cid,
            "stream-11",
            resume=False,
            resume_permission=True,
        )
        state = self.queue.advance(self.cid)

        self.assertFalse(state["state"]["paused"])
        self.assertEqual(state["item"]["message"], "continue queued work")

    def test_permission_resume_does_not_unlock_a_queue_paused_by_error(self):
        self.queue.activate(self.cid, "stream-10", resume=True)
        self.queue.enqueue(self.cid, "wait for manual retry")
        self.queue.pause(self.cid, reason="error")

        self.queue.activate(
            self.cid,
            "stream-11",
            resume=False,
            resume_permission=True,
        )
        state = self.queue.advance(self.cid)

        self.assertTrue(state["state"]["paused"])
        self.assertTrue(state["finished"])
        self.assertEqual([item["message"] for item in state["state"]["items"]], ["wait for manual retry"])

    def test_permission_resume_unpauses_queue_marked_interrupted_while_waiting_for_permission(self):
        """权限等待期间进程重启把队列标成 interrupted,续跑仍要放行并继续取下一项。"""
        self.queue.activate(self.cid, "stream-permission", resume=True)
        already_sent = self.queue.enqueue(self.cid, "already sent turn")["items"][0]
        pending = self.queue.enqueue(self.cid, "continue after permission")["items"][-1]
        claimed = self.queue.advance(self.cid)["item"]
        self.assertEqual(claimed["id"], already_sent["id"])
        self.queue.mark_committed(self.cid, claimed["id"], item_kind="queued")
        self.queue.wait_for_permission(self.cid, item_id=claimed["id"], item_kind="queued")

        # 等待权限期间队列不再是 busy,reconcile 不会把它标成 interrupted。
        reconciled = self.queue.reconcile(self.cid, set())
        self.assertFalse(reconciled["paused"])
        self.assertFalse(reconciled["busy"])
        self.assertEqual(self.queue.snapshot(self.cid)["items"][-1]["id"], pending["id"])

        # 模拟进程重启:重启后队列被标成 interrupted,续跑仍要放行并继续取下一项。
        self.queue.pause(self.cid, reason="interrupted")
        self.assertTrue(self.queue.snapshot(self.cid)["paused"])

        self.queue.activate(
            self.cid,
            "stream-permission-resume",
            resume=False,
            resume_permission=True,
        )
        state = self.queue.advance(self.cid)

        self.assertFalse(state["state"]["paused"])
        self.assertFalse(state["finished"])
        self.assertEqual(state["item"]["id"], pending["id"])

    def test_permission_pending_is_consumed_so_a_later_error_pause_stays_locked(self):
        """permission_pending 被续跑消费后,后续的错误暂停不再被自动解锁。"""
        self.queue.activate(self.cid, "stream-once", resume=True)
        self.queue.enqueue(self.cid, "queued work")
        self.queue.wait_for_permission(self.cid, item_id="", item_kind="")
        self.queue.activate(
            self.cid,
            "stream-once-resume",
            resume=False,
            resume_permission=True,
        )
        self.queue.pause(self.cid, reason="error")

        self.queue.activate(
            self.cid,
            "stream-after-error",
            resume=False,
            resume_permission=True,
        )
        state = self.queue.advance(self.cid)

        self.assertTrue(state["state"]["paused"])
        self.assertTrue(state["finished"])

    def test_permission_wait_allows_enqueue_and_steer(self):
        """等待权限期间流已 detach,但仍应能入队和引导(续跑会带着它们执行)。"""
        self.queue.activate(self.cid, "stream-wait", resume=True)
        first = self.queue.enqueue(self.cid, "first")["items"][0]
        self.queue.advance(self.cid)
        self.queue.wait_for_permission(self.cid, item_id=first["id"], item_kind="queued")

        state = self.queue.enqueue(self.cid, "queued while waiting")
        queued_id = state["items"][-1]["id"]

        steered = self.queue.steer(self.cid, queued_id)

        self.assertEqual(steered["pending_guidance"], 1)
        self.assertEqual([item["id"] for item in steered["items"]], [])

    def test_permission_wait_still_rejects_steer_after_error_pause(self):
        """错误暂停(无 permission_pending)时引导仍要拒绝。"""
        self.queue.activate(self.cid, "stream-error", resume=True)
        self.queue.enqueue(self.cid, "pending work")
        self.queue.pause(self.cid, reason="error")

        with self.assertRaises(ValueError):
            self.queue.steer(self.cid, self.queue.snapshot(self.cid)["items"][0]["id"])

    def test_permission_resume_after_restart_keeps_pending_item_resumable(self):
        """等待权限时进程重启,续跑仍能取到续跑项并继续。"""
        self.queue.activate(self.cid, "stream-restart", resume=True)
        guide = self.queue.enqueue(self.cid, "guided work")
        guide_id = guide["items"][0]["id"]
        self.queue.steer(self.cid, guide_id)
        self.queue.advance(self.cid)
        self.queue.wait_for_permission(self.cid, item_id=guide_id, item_kind="guided")
        self.queue.pause(self.cid, reason="interrupted")

        self.assertEqual(self.queue.permission_resume_item(self.cid)["id"], guide_id)

        self.queue.activate(
            self.cid,
            "stream-restart-resume",
            resume=False,
            resume_permission=True,
        )
        state = self.queue.advance(self.cid)

        self.assertFalse(state["state"]["paused"])
        self.assertEqual(state["item"]["id"], guide_id)
        self.assertEqual(state["kind"], "guided")

    def test_stream_replay_keeps_turn_boundaries_and_only_last_turn_content(self):
        runtime = module("test_model.StreamRuntime", ROOT / "model/StreamRuntime.py")
        stream_id = "queue-replay-test"
        previous = runtime._SESSIONS.get(stream_id)
        runtime._SESSIONS[stream_id] = {
            "cond": threading.Condition(),
            "chunks": [
                {"type": "content", "content": "first answer"},
                {"type": "queue_turn_end", "assistant_index": 1},
                {"type": "queue_turn_start", "user_index": 2, "assistant_index": 3},
                {"type": "content", "content": "second answer"},
            ],
            "last_seq": 4,
            "status": "running",
            "conversation_id": self.cid,
        }

        try:
            result = runtime.get_accumulated_content(stream_id)
        finally:
            if previous is None:
                runtime._SESSIONS.pop(stream_id, None)
            else:
                runtime._SESSIONS[stream_id] = previous

        self.assertEqual(result["content"], "second answer")
        self.assertEqual(
            [chunk["type"] for chunk in result["render_chunks"]],
            ["content", "queue_turn_end", "queue_turn_start", "content"],
        )


if __name__ == "__main__":
    unittest.main()
