"""
会话列表变更事件测试

会话创建、改标题、删除后必须把变更交给注入的实时通道，且只发给会话所有者。
历史问题：曾经直接广播给所有登录用户，把别人的会话 id 与标题推给无关用户。
"""

import os
import shutil
import unittest
import uuid

from basis.Conversation import ConversationService
from basis.Conversation import trash as trash_module
from basis.Conversation.events import configure_conversation_realtime
from basis.Conversation.repository import _server_data_root


class ConversationEventsTest(unittest.TestCase):
    def setUp(self):
        self.username = "test_events_" + uuid.uuid4().hex[:10]
        self.service = ConversationService(self.username)
        self.trash = trash_module.ConversationTrashService(self.username)
        self.events = []
        configure_conversation_realtime(
            lambda owner, event_type, payload: self.events.append((owner, event_type, payload))
        )

    def tearDown(self):
        configure_conversation_realtime(lambda owner, event_type, payload: None)
        user_dir = os.path.join(_server_data_root(), "users", self.username)
        shutil.rmtree(user_dir, ignore_errors=True)

    def test_create_update_delete_publish_to_owner_only(self):
        cid = self.service.create_conversation(title="事件测试")
        self.service.update_title(cid, "改过的标题")
        self.trash.archive_and_delete(self.username, cid)

        self.assertEqual([event[2]["action"] for event in self.events], ["created", "updated", "deleted"])

        for owner, event_type, payload in self.events:
            self.assertEqual(owner, self.username)
            self.assertEqual(event_type, "conversation_changed")
            self.assertEqual(payload["conversation_id"], cid)

        self.assertEqual(self.events[0][2]["title"], "事件测试")
        self.assertEqual(self.events[1][2]["title"], "改过的标题")
        self.assertEqual(self.events[2][2]["title"], "")


if __name__ == "__main__":
    unittest.main()
