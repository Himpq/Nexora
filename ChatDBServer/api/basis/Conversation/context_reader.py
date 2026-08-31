"""
Nexora.basis.Conversation.context_reader — 严格 Context API

职责：
- 提供 ConversationContextReader(username) 的严格实现
- 统一序列化坐标系：role + content 拼接，严格校验参数
- 读取失败绝不返回 "" 伪装成功，统一抛出受控异常

设计原则：
- 严禁 fallback / 兜底
- 参数校验失败 -> ConversationValidationError
- 会话不存在 -> ConversationNotFoundError
- 所有方法共享同一序列化逻辑
"""

from __future__ import annotations

from typing import Any, List

from .errors import ConversationNotFoundError, ConversationValidationError
from .repository import conversation_file_path, load_conversation_file


# ------------------------------------------------------------------
# 单次返回上限
# ------------------------------------------------------------------
_MAX_RETURN_CHARS = 20000
_TRUNC_SUFFIX = "\n\n...[truncated]..."


# ------------------------------------------------------------------
# 底层 content -> text 转换（与 Service._message_content_to_text 对齐）
# ------------------------------------------------------------------
def _message_content_to_text(content: Any) -> str:
    """
    将消息 content 转为纯文本。

    支持：
    - str 直接返回
    - list[dict] 多模态：仅提取 type==text 的片段
    - 其他类型转为字符串
    """

    if isinstance(content, list):
        texts: List[str] = []

        for seg in content:
            if isinstance(seg, dict) and str(seg.get("type") or "").strip() == "text":
                texts.append(str(seg.get("text") or ""))

            elif isinstance(seg, str):
                texts.append(seg)

        return "\n".join(texts)

    if content is None:
        return ""

    return str(content or "")


def _validate_username(username: str) -> str:
    name = str(username or "").strip()

    if not name:
        raise ConversationValidationError("username 不能为空")

    return name


def _validate_conversation_id(conversation_id: str) -> str:
    cid = str(conversation_id or "").strip()

    if not cid:
        raise ConversationValidationError("conversation_id 不能为空")

    # 防止路径穿越
    if "/" in cid or "\\" in cid or ".." in cid:
        raise ConversationValidationError(f"conversation_id 非法: {cid!r}")

    return cid


def _truncate_if_needed(text: str) -> str:
    if len(text) > _MAX_RETURN_CHARS:
        return text[:_MAX_RETURN_CHARS] + _TRUNC_SUFFIX

    return text


# ------------------------------------------------------------------
# 严格 Reader
# ------------------------------------------------------------------
class ConversationContextReader:
    """
    严格 Context API。

    所有方法：
    - 会话不存在 -> ConversationNotFoundError
    - 参数非法 -> ConversationValidationError
    - 绝不返回 "" 表示缺失
    """

    def __init__(self, username: str):
        self.username = _validate_username(username)

    # ------------------------------------------------------------------
    # 内部序列化
    # ------------------------------------------------------------------
    def _message_content_to_text(self, content: Any) -> str:
        return _message_content_to_text(content)

    def _serialize(self, conversation_id: str) -> str:
        """
        将会话消息统一序列化为：
            role: content \\n\\n role: content ...

        与 Service._serialize_context_messages 保持同一坐标系。
        """

        cid = _validate_conversation_id(conversation_id)

        # load_conversation_file 在文件不存在时抛出 ConversationNotFoundError
        data = load_conversation_file(self.username, cid)

        if not isinstance(data, dict):
            raise ConversationNotFoundError(
                f"无法读取或解析对话文件: {cid}",
                conversation_id=cid,
            )

        messages = data.get("messages", []) if isinstance(data.get("messages"), list) else []

        parts: List[str] = []

        for msg in messages:
            if not isinstance(msg, dict):
                continue

            role = str(msg.get("role") or "").strip() or "unknown"
            content_str = self._message_content_to_text(msg.get("content"))

            parts.append(f"{role}: {content_str}")

        return "\n\n".join(parts)

    # ------------------------------------------------------------------
    # get_length
    # ------------------------------------------------------------------
    def get_length(self, conversation_id: str) -> int:
        """
        返回序列化文本长度。
        """

        cid = _validate_conversation_id(conversation_id)

        full = self._serialize(cid)

        return len(full)

    # ------------------------------------------------------------------
    # read
    # ------------------------------------------------------------------
    def read(
        self,
        conversation_id: str,
        from_pos: int,
        to_pos: int | None = None,
    ) -> str:
        """
        按字符范围切片返回上下文文本。

        校验：
        - from_pos 必须为 int 且 >=0
        - to_pos 若提供必须为 int 且 >= from_pos 且 >=0
        - 超出长度自动截断，不抛错
        - 单次返回超过 20000 字符则截断
        """

        cid = _validate_conversation_id(conversation_id)

        # from_pos 校验
        if not isinstance(from_pos, int) or isinstance(from_pos, bool):
            raise ConversationValidationError("from_pos 必须为 int")

        if from_pos < 0:
            raise ConversationValidationError(f"from_pos 不能为负数: {from_pos}")

        # to_pos 校验
        if to_pos is not None:
            if not isinstance(to_pos, int) or isinstance(to_pos, bool):
                raise ConversationValidationError("to_pos 必须为 int 或 None")

            if to_pos < 0:
                raise ConversationValidationError(f"to_pos 不能为负数: {to_pos}")

            if to_pos < from_pos:
                raise ConversationValidationError(
                    f"to_pos({to_pos}) 不能小于 from_pos({from_pos})"
                )

        full = self._serialize(cid)

        # 允许 from_pos 超出长度 -> 空截断，不抛错
        if to_pos is None:
            sliced = full[from_pos:]
        else:
            sliced = full[from_pos:to_pos]

        return _truncate_if_needed(sliced)

    # ------------------------------------------------------------------
    # search
    # ------------------------------------------------------------------
    def search(
        self,
        conversation_id: str,
        keyword: str,
        window: int = 10,
        max_hits: int = 20,
    ) -> str:
        """
        大小写不敏感搜索关键词，返回命中片段。

        参数：
        - keyword 非空字符串，否则抛 ValidationError
        - window 半径系数，实际半径 = window * 80
        - max_hits 最大命中数

        片段生成与 Service.get_context_find_keyword 同逻辑但严格校验。
        """

        cid = _validate_conversation_id(conversation_id)

        # keyword 校验
        if not isinstance(keyword, str):
            raise ConversationValidationError("keyword 必须为字符串")

        kw_raw = str(keyword)

        if not kw_raw.strip():
            raise ConversationValidationError("keyword 不能为空")

        kw = kw_raw.strip()

        # window 校验
        if not isinstance(window, int) or isinstance(window, bool):
            raise ConversationValidationError("window 必须为 int")

        if window < 0:
            raise ConversationValidationError(f"window 不能为负数: {window}")

        # max_hits 校验
        if not isinstance(max_hits, int) or isinstance(max_hits, bool):
            raise ConversationValidationError("max_hits 必须为 int")

        if max_hits <= 0:
            raise ConversationValidationError(f"max_hits 必须 >0, got {max_hits}")

        # 加载原始 messages 以保留索引与 role
        data = load_conversation_file(self.username, cid)

        if not isinstance(data, dict):
            raise ConversationNotFoundError(
                f"无法读取或解析对话文件: {cid}",
                conversation_id=cid,
            )

        messages = data.get("messages", []) if isinstance(data.get("messages"), list) else []

        kw_lower = kw.lower()
        radius = int(window) * 80

        hits: List[str] = []

        for idx, msg in enumerate(messages):
            if not isinstance(msg, dict):
                continue

            content_str = self._message_content_to_text(msg.get("content"))

            if not content_str:
                continue

            lower = content_str.lower()
            pos = lower.find(kw_lower)

            if pos == -1:
                continue

            # 截取片段
            start = max(0, pos - radius)
            end = min(len(content_str), pos + len(kw) + radius)

            snippet = content_str[start:end].replace("\n", " ").strip()

            if start > 0:
                snippet = "..." + snippet

            if end < len(content_str):
                snippet = snippet + "..."

            role = str(msg.get("role") or "").strip() or "unknown"

            hits.append(f"[{idx}][{role}] {snippet}")

            if len(hits) >= int(max_hits):
                break

        if not hits:
            result = f"未找到关键词: {kw}"
            return _truncate_if_needed(result)

        header = f"关键词 '{kw}' 命中 {len(hits)} 条："
        result = header + "\n" + "\n".join(hits)

        return _truncate_if_needed(result)


# ------------------------------------------------------------------
# 兼容导出 helper functions
# ------------------------------------------------------------------
def _compat_reader(username: str) -> ConversationContextReader:
    return ConversationContextReader(username)


def serialize_context(username: str, conversation_id: str) -> str:
    """兼容函数：序列化上下文。"""

    return _compat_reader(username)._serialize(conversation_id)


def get_length(username: str, conversation_id: str) -> int:
    """兼容函数：获取长度。"""

    return _compat_reader(username).get_length(conversation_id)


def read(
    username: str,
    conversation_id: str,
    from_pos: int,
    to_pos: int | None = None,
) -> str:
    """兼容函数：范围读取。"""

    return _compat_reader(username).read(conversation_id, from_pos, to_pos)


def search(
    username: str,
    conversation_id: str,
    keyword: str,
    window: int = 10,
    max_hits: int = 20,
) -> str:
    """兼容函数：关键词搜索。"""

    return _compat_reader(username).search(conversation_id, keyword, window, max_hits)


# 额外别名，覆盖历史调用签名
get_conversation_length = get_length
get_context_length = get_length

read_conversation = read
read_conversation_context = read
get_context = read

search_conversation = search
search_conversation_context = search
get_context_find_keyword = search
find_keyword = search

message_content_to_text = _message_content_to_text
serialize = serialize_context


__all__ = [
    "ConversationContextReader",
    "_message_content_to_text",
    "message_content_to_text",
    "serialize_context",
    "serialize",
    "get_length",
    "get_conversation_length",
    "get_context_length",
    "read",
    "read_conversation",
    "read_conversation_context",
    "get_context",
    "search",
    "search_conversation",
    "search_conversation_context",
    "get_context_find_keyword",
    "find_keyword",
]
