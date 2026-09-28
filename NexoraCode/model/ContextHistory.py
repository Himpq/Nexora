"""压缩后按统一字符坐标读取原始历史，摘要不替代可检索的事实。"""
import json


class ContextHistory:
    def __init__(self, store, conversation_id):
        conversation = store.get(conversation_id)

        if conversation is None:
            raise ValueError("本地会话不存在")

        blocks = []

        for message in conversation.get("messages", []):
            content = message.get("content")
            text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)

            if message.get("tool_calls"):
                text += "\n" + json.dumps(message["tool_calls"], ensure_ascii=False)

            blocks.append(str(message["role"]) + ": " + text)

        self.text = "\n\n".join(blocks)

    def length(self):
        return {"length": len(self.text), "coordinate": "characters"}

    def read(self, start, end=None):
        if isinstance(start, bool) or not isinstance(start, int) or start < 0:
            raise ValueError("from_pos 必须为非负整数")

        if end is not None and (isinstance(end, bool) or not isinstance(end, int) or end < start):
            raise ValueError("to_pos 必须为大于或等于 from_pos 的整数")

        stop = min(len(self.text), start + 20000, len(self.text) if end is None else end)
        return {"text": self.text[start:stop], "from_pos": start, "to_pos": stop,
                "has_more": stop < min(len(self.text), len(self.text) if end is None else end)}

    def search(self, keyword, max_hits=20):
        if not isinstance(keyword, str) or not keyword.strip():
            raise ValueError("keyword 不能为空")

        if isinstance(max_hits, bool) or not isinstance(max_hits, int) or not 1 <= max_hits <= 20:
            raise ValueError("max_hits 必须为 1 至 20")

        import re
        hits = []

        for match in re.finditer(re.escape(keyword), self.text, re.IGNORECASE):
            start = max(0, match.start() - 160)
            end = min(len(self.text), match.end() + 160)
            hits.append({"position": match.start(), "from_pos": start, "to_pos": end, "text": self.text[start:end]})

            if len(hits) == max_hits:
                break

        return {"hits": hits, "length": len(self.text)}
