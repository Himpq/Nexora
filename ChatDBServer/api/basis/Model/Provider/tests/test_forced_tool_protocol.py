"""强制工具调用与思考开关的 Provider 协议回归测试。

背景：记忆决策任务只接受「恰好一次工具调用」。DeepSeek V4 系列默认开启思考模式，
思考模式下上游拒绝 tool_choice=required，且不显式关闭思考时 enable_thinking=False
完全无效，导致模型频繁不调用工具、整轮记忆决策作废。
"""
import unittest

from basis.Model.Provider.openai import OpenAIProvider


class ForcedToolChoiceTest(unittest.TestCase):
    """强制工具调用只对声明了该协议的 Provider 下发。"""

    def setUp(self):
        self.openai_provider = OpenAIProvider("deepseek", {"api_type": "openai"})

    def test_openai_compatible_declares_required_tool_choice(self):
        params = {"tools": [{"type": "function", "function": {"name": "memory_keep"}}]}
        result = self.openai_provider.apply_forced_tool_choice(dict(params), model_name="DeepSeek-V4.1-Flash")

        self.assertEqual(result["tool_choice"], "required")


class DeepSeekThinkingSwitchTest(unittest.TestCase):
    """DeepSeek 走官方 thinking.type 协议，而不是 Ollama 风格 think。"""

    def setUp(self):
        self.provider = OpenAIProvider("deepseek", {"api_type": "openai"})

    def test_disable_thinking_uses_thinking_type_protocol(self):
        params = {"reasoning_effort": "high"}

        result = self.provider.apply_chat_thinking_switch(
            params,
            enable_thinking=False,
            model_name="DeepSeek-V4.1-Flash",
        )

        self.assertEqual(result["extra_body"]["thinking"], {"type": "disabled"})
        self.assertNotIn("think", result["extra_body"])
        self.assertNotIn("reasoning_effort", result)

    def test_enable_thinking_uses_thinking_type_protocol(self):
        result = self.provider.apply_chat_thinking_switch(
            {},
            enable_thinking=True,
            model_name="deepseek-flash",
        )

        self.assertEqual(result["extra_body"]["thinking"], {"type": "enabled"})

    def test_ollama_style_think_is_replaced_for_deepseek_models(self):
        params = {"extra_body": {"think": False}}

        result = self.provider.apply_chat_thinking_switch(
            params,
            enable_thinking=False,
            model_name="DeepSeek-V4.1-Flash",
        )

        self.assertNotIn("think", result["extra_body"])


class OllamaThinkingSwitchTest(unittest.TestCase):
    """非 DeepSeek 模型保持既有的 Ollama 风格 think 协议。"""

    def setUp(self):
        self.provider = OpenAIProvider("relay", {"api_type": "openai"})

    def test_disable_thinking_writes_think_false(self):
        result = self.provider.apply_chat_thinking_switch(
            {},
            enable_thinking=False,
            model_name="doubao-seed-1-6-flash-250828",
        )

        self.assertEqual(result["extra_body"]["think"], False)

    def test_thinking_level_is_forwarded(self):
        result = self.provider.apply_chat_thinking_switch(
            {},
            enable_thinking=True,
            thinking_level="medium",
            model_name="gpt-oss-120b",
        )

        self.assertEqual(result["extra_body"]["think"], "medium")


if __name__ == "__main__":
    unittest.main()