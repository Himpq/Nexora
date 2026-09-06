import json
import unittest

from App.Core.tool_protocol import (
    INVALID_TOOL_ARGUMENTS_KEY,
    ToolLoopRoundCounter,
    build_tool_json_error_message,
    canonical_tool_call_signature,
    sanitize_tool_calls_in_messages,
)


class ToolProtocolTest(unittest.TestCase):
    def test_invalid_arguments_preserve_raw_text_and_parse_error(self):
        raw_arguments = '{"center":{"lng":121.4},"markers":[}'
        logs = []
        messages = [{
            "role": "assistant",
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "map_render",
                    "arguments": raw_arguments,
                },
            }],
        }]

        sanitized = sanitize_tool_calls_in_messages(messages, logger=logs.append)
        arguments = sanitized[0]["tool_calls"][0]["function"]["arguments"]
        envelope = json.loads(arguments)[INVALID_TOOL_ARGUMENTS_KEY]

        self.assertEqual(envelope["raw_arguments"], raw_arguments)
        self.assertIn("Expecting", envelope["parse_error"])
        self.assertEqual(messages[0]["tool_calls"][0]["function"]["arguments"], raw_arguments)
        self.assertEqual(len(logs), 1)

    def test_valid_arguments_are_not_rewritten(self):
        raw_arguments = '{"port": 6700, "host": "127.0.0.1"}'
        messages = [{
            "role": "assistant",
            "tool_calls": [{
                "function": {
                    "name": "terminal",
                    "arguments": raw_arguments,
                },
            }],
        }]

        sanitized = sanitize_tool_calls_in_messages(messages)

        self.assertEqual(
            sanitized[0]["tool_calls"][0]["function"]["arguments"],
            raw_arguments,
        )

    def test_semantic_signature_ignores_call_id_and_key_order(self):
        first = [{
            "name": "terminal",
            "call_id": "call_a",
            "arguments": '{"port":6700,"host":"127.0.0.1"}',
        }]
        second = [{
            "name": "terminal",
            "call_id": "call_b",
            "arguments": '{"host":"127.0.0.1","port":6700}',
        }]

        self.assertEqual(
            canonical_tool_call_signature(first),
            canonical_tool_call_signature(second),
        )
        self.assertEqual(canonical_tool_call_signature([]), "")

    def test_round_counter_stops_after_completed_round_budget(self):
        counter = ToolLoopRoundCounter(2)

        self.assertTrue(counter.has_budget())
        self.assertEqual(counter.current_index, 0)

        # 网络重试发生在 complete_round 之前，不应消耗已完成轮次。
        self.assertTrue(counter.has_budget())
        self.assertEqual(counter.current_index, 0)

        self.assertEqual(counter.complete_round(), 1)
        self.assertTrue(counter.has_budget())
        self.assertEqual(counter.complete_round(), 2)
        self.assertFalse(counter.has_budget())

        with self.assertRaisesRegex(RuntimeError, "轮次已经耗尽"):
            counter.complete_round()

    def test_json_error_points_to_original_arguments(self):
        arguments = '{"markers":[{"lng":121.4,}]}'

        try:
            json.loads(arguments)
        except json.JSONDecodeError as error:
            message = build_tool_json_error_message("map_render", arguments, error)
        else:
            self.fail("测试参数必须是非法 JSON")

        self.assertIn("map_render", message)
        self.assertIn(arguments, message)
        self.assertIn("^", message)
        self.assertIn("schema", message)


if __name__ == "__main__":
    unittest.main()
