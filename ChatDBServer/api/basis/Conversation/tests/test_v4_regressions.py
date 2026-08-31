import hashlib
import os
import shutil
import sys
import tempfile
import unittest
import uuid

from basis.Conversation import ConversationService
from basis.Conversation import asset_store
from basis.Conversation import trash as trash_module
from basis.Conversation.context_reader import ConversationContextReader
from basis.Conversation.errors import ConversationConflictError, ConversationValidationError
from basis.Conversation.repository import _server_data_root, conversation_file_path
from basis.Model.Context import ChatContext


class ConversationV4RegressionTest(unittest.TestCase):
    def setUp(self):
        self.username = "test_v4_reg_" + uuid.uuid4().hex[:10]
        self.service = ConversationService(self.username)
        self.trash = trash_module.ConversationTrashService(self.username)

    def tearDown(self):
        user_dir = os.path.join(_server_data_root(), "users", self.username)
        shutil.rmtree(user_dir, ignore_errors=True)

    def _conversation_with_asset(self):
        cid = self.service.create_conversation(title="asset")
        turn = self.service.begin_user_turn(cid, f"/api/conversations/{cid}/assets/a1")
        self.service.finish_assistant_turn(cid, turn["assistant_index"], {"content": "ok"})
        asset_dir = asset_store.conversation_asset_dir(self.username, cid)
        os.makedirs(asset_dir, exist_ok=True)
        content = b"asset-payload"
        file_name = "a1.bin"
        with open(os.path.join(asset_dir, file_name), "wb") as handle:
            handle.write(content)
        asset_store.save_conversation_asset_index(self.username, cid, {
            "assets": {
                "a1": {
                    "asset_id": "a1",
                    "file_name": file_name,
                    "mime": "application/octet-stream",
                    "size": len(content),
                }
            }
        })
        return cid, content, file_name

    def test_archive_and_restore_keeps_asset_bundle(self):
        cid, content, file_name = self._conversation_with_asset()
        trash_id = self.trash.archive_and_delete(self.username, cid)
        self.assertFalse(os.path.exists(conversation_file_path(self.username, cid)))
        entry = self.trash.read_entry(self.username, trash_id)
        self.assertEqual(entry["manifest"]["index"]["size"], os.path.getsize(os.path.join(entry["assets_dir"], "index.json")))
        self.assertEqual(self.trash.restore_to_active(self.username, trash_id), cid)
        restored_path = os.path.join(asset_store.conversation_asset_dir(self.username, cid), file_name)
        with open(restored_path, "rb") as handle:
            self.assertEqual(handle.read(), content)
        with open(restored_path, "rb") as handle:
            self.assertEqual(hashlib.sha256(handle.read()).hexdigest(), entry["manifest"]["attachments"][0]["hash"])

    def test_missing_asset_index_rejects_archive(self):
        cid = self.service.create_conversation(title="missing-index")
        turn = self.service.begin_user_turn(cid, f"/api/conversations/{cid}/assets/missing")
        self.service.finish_assistant_turn(cid, turn["assistant_index"], {"content": "ok"})
        with self.assertRaises(ConversationValidationError):
            self.trash.archive_and_delete(self.username, cid)
        self.assertTrue(os.path.exists(conversation_file_path(self.username, cid)))

    def test_index_failure_keeps_trash_copy(self):
        cid = self.service.create_conversation(title="index-failure")
        original = trash_module.index_mod.remove_from_index

        def fail_remove(*args, **kwargs):
            raise RuntimeError("forced index removal failure")

        trash_module.index_mod.remove_from_index = fail_remove
        try:
            with self.assertRaises(RuntimeError):
                self.trash.archive_and_delete(self.username, cid)
        finally:
            trash_module.index_mod.remove_from_index = original

        self.assertFalse(os.path.exists(conversation_file_path(self.username, cid)))
        self.assertEqual(len(self.trash.list_entries(self.username)), 1)

    def test_context_reader_uses_strict_coordinates(self):
        cid = self.service.create_conversation(title="context")
        turn = self.service.begin_user_turn(cid, "中文")
        self.service.finish_assistant_turn(cid, turn["assistant_index"], {"content": "answer"})
        reader = ConversationContextReader(self.username)
        full = reader.read(cid, 0, None)
        self.assertEqual(reader.get_length(cid), len(full))
        with self.assertRaises(ConversationValidationError):
            reader.read(cid, -1, None)
        with self.assertRaises(ConversationValidationError):
            reader.read(cid, 4, 3)

    def test_context_diagnostics_are_public(self):
        context = ChatContext()
        self.assertFalse(context.is_degraded())
        context.mark_degraded("compression_load_failed", "broken")
        diagnostics = context.diagnostics()
        self.assertTrue(diagnostics["degraded"])
        self.assertEqual(diagnostics["reason"], "compression_load_failed")
        self.assertEqual(diagnostics["error"], "broken")


if __name__ == "__main__":
    unittest.main()
