import json
import unittest

from basis.Model.Provider.base import (
    ProviderInterface,
    append_stream_delta,
    reconcile_stream_snapshot,
)


class _TestProvider(ProviderInterface):
    @property
    def api_type(self) -> str:
        return "test"

    def create_client(self, api_key: str, base_url: str, timeout: float = 120.0):
        return None


def _tool_delta(arguments: str, name: str = "", call_id: str = ""):
    function = {"arguments": arguments}

    if name:
        function["name"] = name

    tool_call = {
        "index": 0,
        "function": function,
    }

    if call_id:
        tool_call["id"] = call_id

    return {
        "choices": [{
            "delta": {"tool_calls": [tool_call]},
            "finish_reason": "",
        }]
    }


class StreamToolArgumentsTest(unittest.TestCase):
    def setUp(self):
        self.provider = _TestProvider("test", {})

    def _final_call(self, fragments):
        chunks = []

        for index, fragment in enumerate(fragments):
            chunks.append(_tool_delta(
                fragment,
                name="map_render" if index == 0 else "",
                call_id="call_1" if index == 0 else "",
            ))

        chunks.append({
            "choices": [{
                "delta": {},
                "finish_reason": "tool_calls",
            }]
        })
        events = list(self.provider._iter_openai_chat_stream_events(chunks))

        return next(event for event in events if event.get("type") == "function_call")

    def test_single_character_zero_is_not_deduplicated(self):
        final_call = self._final_call(['{"port":670', "0", "}"])

        self.assertEqual(final_call["arguments"], '{"port":6700}')
        self.assertEqual(json.loads(final_call["arguments"])["port"], 6700)

    def test_repeated_closing_braces_are_not_deduplicated(self):
        final_call = self._final_call(['{"outer":{"inner":1', "}", "}"])

        self.assertEqual(final_call["arguments"], '{"outer":{"inner":1}}')
        self.assertEqual(json.loads(final_call["arguments"]), {"outer": {"inner": 1}})

    def test_split_array_and_object_markers_remain_complete(self):
        fragments = [
            '{"markers":[',
            '{"lng":121.4,"lat":31.2}',
            ",",
            '{"lng":121.5,"lat":31.3}',
            "]",
            "}",
        ]
        final_call = self._final_call(fragments)
        arguments = json.loads(final_call["arguments"])

        self.assertEqual(len(arguments["markers"]), 2)
        self.assertEqual(arguments["markers"][1]["lng"], 121.5)

    def test_delta_append_never_guesses_overlap(self):
        merged, emitted = append_stream_delta('{"port":670', "0")

        self.assertEqual(merged, '{"port":6700')
        self.assertEqual(emitted, "0")

    def test_snapshot_accepts_extension_and_rejects_conflict(self):
        merged, emitted = reconcile_stream_snapshot('{"port":670', '{"port":6700}', "arguments")

        self.assertEqual(merged, '{"port":6700}')
        self.assertEqual(emitted, "0}")

        with self.assertRaisesRegex(ValueError, "arguments snapshot conflicts"):
            reconcile_stream_snapshot('{"port":670', '{"port":6800}', "arguments")


class FunctionOutputMessagesTest(unittest.TestCase):
    def setUp(self):
        self.provider = _TestProvider("test", {})
        self.image_url = "data:image/png;base64,AAAA"

    def test_chat_completion_uses_image_url_content(self):
        messages = self.provider.build_image_input_messages(
            image_inputs=[{"url": self.image_url}],
            use_responses_api=False,
        )

        self.assertEqual(messages[0]["role"], "user")
        self.assertEqual(messages[0]["content"][0]["type"], "text")
        self.assertEqual(messages[0]["content"][1]["type"], "image_url")
        self.assertEqual(messages[0]["content"][1]["image_url"]["url"], self.image_url)

    def test_responses_api_uses_input_image_content(self):
        messages = self.provider.build_image_input_messages(
            image_inputs=[{"url": self.image_url}],
            use_responses_api=True,
        )

        self.assertEqual(messages[0]["role"], "user")
        self.assertEqual(messages[0]["content"][0]["type"], "input_text")
        self.assertEqual(messages[0]["content"][1]["type"], "input_image")
        self.assertEqual(messages[0]["content"][1]["image_url"], self.image_url)


if __name__ == "__main__":
    unittest.main()
