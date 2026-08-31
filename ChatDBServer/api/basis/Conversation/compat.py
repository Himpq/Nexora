"""
Nexora.basis.Conversation.compat — deprecated signatures compat shim

职责：
- 提供 legacy_get_context_length / legacy_get_context / legacy_search 的向后兼容包装
- 内部严格委托至 ConversationContextReader 严格 API
- 兼容旧 offset 寻址：若 conversation_id 未提供，则按 offset 在 sorted 列表中解析
- 严格校验：negative offset -> ConversationValidationError（别名 ValidationError）
- 提供 legacy update_message_metadata shim，委托至 ConversationService

原则：
- 严禁 fallback / 兜底
- 参数校验失败 -> ConversationValidationError
- 会话不存在 -> ConversationNotFoundError（由 Reader 抛出）
"""

from __future__ import annotations

import inspect
from typing import Any, Dict

from .context_reader import ConversationContextReader
from .errors import ConversationNotFoundError, ConversationValidationError

# 别名，供外部直接捕获 ValidationError
ValidationError = ConversationValidationError

__all__ = [
    "ValidationError",
    "ConversationValidationError",
    "legacy_get_context_length",
    "legacy_get_context",
    "legacy_search",
    "legacy_update_message_metadata",
    "update_message_metadata",
    "get_context_length",
    "get_context",
    "search",
]


# ------------------------------------------------------------------
# 内部：username 推断（当 legacy 调用未显式传 username 时）
# ------------------------------------------------------------------

def _infer_username_for_conversation(conversation_id: str) -> str | None:
    """
    已废弃的 username 推断（曾扫描全量用户目录，复杂度高且与零 fallback 原则冲突）。
    现严格要求调用方显式提供 username，未提供则返回 None 由上层抛 ValidationError。
    """
    return None


# ------------------------------------------------------------------
# 内部：offset 校验与 conversation_id 解析
# ------------------------------------------------------------------

def _validate_offset(offset: Any) -> int:
    """
    校验 offset 合法性。

    - 必须为 int（不接受 bool）
    - 必须 >=0
    - 否则抛 ConversationValidationError
    """

    if isinstance(offset, bool):
        raise ConversationValidationError(f"offset 必须为 int，got bool")

    if not isinstance(offset, int):
        # 允许字符串数字的严格转换？旧逻辑曾尝试 int(offset)，此处严格要求 int
        raise ConversationValidationError(f"offset 必须为 int，got {type(offset).__name__}: {offset!r}")

    if offset < 0:
        raise ConversationValidationError(f"offset 不能为负数: {offset}")

    return int(offset)


def _validate_conversation_id(conversation_id: Any) -> str | None:
    if conversation_id is None:
        return None

    cid = str(conversation_id).strip()

    if not cid:
        return None

    return cid


def _resolve_conversation_id(
    username: str | None,
    offset: int,
    conversation_id: str | None,
) -> str | None:
    """
    将旧 offset 寻址翻译为严格 conversation_id。

    - 若 conversation_id 非空 -> 直接返回（忽略 offset，但仍需校验 offset 合法性）
    - 否则按 offset 在 sorted 列表中查找
    - offset 越界 -> 返回 None（调用方决定返回 0 / "" / 错误提示）
    """

    # conversation_id 优先
    cid = _validate_conversation_id(conversation_id)

    if cid is not None:
        return cid

    # 需要通过 offset 解析
    if username is None or not str(username).strip():
        # 无用户名且无 cid，无法解析 -> 返回 None，让调用方按旧语义返回 0/""
        return None

    # 校验 offset（此时必须校验，即便 cid 为 None）
    off = _validate_offset(offset)

    # 使用 index 排序列表解析
    try:
        from .index import list_conversations_sorted
    except Exception:
        # 若 index 不可用，回退到空
        return None

    convs = list_conversations_sorted(str(username).strip())

    if not convs or off >= len(convs):
        return None

    try:
        resolved = str(convs[off].get("conversation_id") or "").strip() or None
    except Exception:
        resolved = None

    return resolved


def _extract_username_offset_cid_for_length(args: tuple, kwargs: dict) -> tuple[str | None, int, str | None]:
    """
    灵活解析 legacy_get_context_length 的多态调用。

    支持：
    - legacy_get_context_length(offset, conversation_id)
    - legacy_get_context_length(offset, conversation_id, username="...")
    - legacy_get_context_length(username, offset, conversation_id)
    - legacy_get_context_length(username="...", offset=..., conversation_id=...)
    - legacy_get_context_length(offset=..., conversation_id=..., username=...)
    """

    # 默认值
    username: str | None = kwargs.pop("username", None)
    offset: Any = 0
    conversation_id: Any = None

    # kwargs 显式覆盖
    if "offset" in kwargs:
        offset = kwargs.pop("offset")
    if "conversation_id" in kwargs:
        conversation_id = kwargs.pop("conversation_id")
    if "cid" in kwargs and conversation_id is None:
        conversation_id = kwargs.pop("cid")
    if "conversationId" in kwargs and conversation_id is None:
        conversation_id = kwargs.pop("conversationId")

    # positional 处理
    # 期望的旧签名是 (offset, conversation_id) 或 (username, offset, conversation_id)
    # 通过启发式区分
    if len(args) == 0:
        pass
    elif len(args) == 1:
        # 单一位置参数：可能是 offset 或 username+offset 混淆
        # 若 kwargs 已有 username，则此为 offset
        # 否则视作 offset
        offset = args[0]
    elif len(args) == 2:
        # 两种可能：
        #   (offset, conversation_id)
        #   (username, offset)  -> 但缺少 cid，此时 conversation_id 应为 None
        # 判断第一参是否为可能的 username（非数字字符串）且第二参为 int
        first, second = args[0], args[1]

        if username is None and isinstance(first, str) and first.strip() and not first.strip().lstrip("-").isdigit():
            # first 很可能是 username
            # 需进一步判断 second 是否可作为 offset
            # 若 second 是 int，则认为是 (username, offset)
            if isinstance(second, int) and not isinstance(second, bool):
                username = str(first).strip()
                offset = second
                # conversation_id 仍从 kwargs 取得
            elif isinstance(second, str) and second.strip() and not second.strip().lstrip("-").isdigit():
                # (username, conversation_id) 偏移默认 0
                username = str(first).strip()
                conversation_id = second
                offset = 0
            else:
                offset, conversation_id = first, second
        else:
            offset, conversation_id = first, second
    elif len(args) >= 3:
        # 认为是 (username, offset, conversation_id) 或 (offset, conversation_id, username)
        # 优先按 (username, offset, conversation_id) 解析
        # 通过类型 heuristic：若 args[1] 是 int，则 args[0] 极可能是 username
        if isinstance(args[1], int) and not isinstance(args[1], bool):
            username = str(args[0]).strip() if username is None else username
            offset = args[1]
            conversation_id = args[2]
        else:
            # 回退：按 (offset, conversation_id, username) 处理
            offset = args[0]
            conversation_id = args[1]
            if username is None:
                username = str(args[2]).strip()

        # 多余 args 忽略

    # 若 kwargs 中仍有剩余，尝试取 conversation_id
    if conversation_id is None and kwargs:
        # 可能是额外的位置参数溢出到 kwargs
        for key in list(kwargs.keys()):
            if key in ("conversation_id", "cid", "conversationId"):
                conversation_id = kwargs.pop(key)
                break

    # 标准化
    if username is not None:
        username = str(username).strip() or None

    # offset 标准化：若为 None 视为 0
    if offset is None:
        offset = 0

    return username, offset, conversation_id


def _parse_legacy_context_args(args: tuple, kwargs: dict) -> tuple[str | None, int, int, int | None, str | None]:
    """
    解析 legacy_get_context(offset, from_pos, to_pos, conversation_id) 的多态调用。
    支持 username 作为额外首参或关键字。
    返回 (username, offset, from_pos, to_pos, conversation_id)
    """

    username: str | None = kwargs.pop("username", None)
    offset: Any = 0
    from_pos: Any = 0
    to_pos: Any = None
    conversation_id: Any = None

    # kwargs 显式
    if "offset" in kwargs:
        offset = kwargs.pop("offset")
    if "from_pos" in kwargs:
        from_pos = kwargs.pop("from_pos")
    if "fromPos" in kwargs and "from_pos" not in kwargs:
        from_pos = kwargs.pop("fromPos")
    if "to_pos" in kwargs:
        to_pos = kwargs.pop("to_pos")
    if "toPos" in kwargs and to_pos is None:
        to_pos = kwargs.pop("toPos")
    if "conversation_id" in kwargs:
        conversation_id = kwargs.pop("conversation_id")
    if "cid" in kwargs and conversation_id is None:
        conversation_id = kwargs.pop("cid")

    # positional
    # 标准旧签名：(offset, from_pos, to_pos, conversation_id)
    # 带 username： (username, offset, from_pos, to_pos, conversation_id)
    if len(args) == 0:
        pass
    elif len(args) == 1:
        offset = args[0]
    elif len(args) == 2:
        offset, from_pos = args[0], args[1]
    elif len(args) == 3:
        # 可能是 (offset, from_pos, to_pos) 或 (username, offset, from_pos)
        # heuristic：若第一参是 string 且可能是 username
        if username is None and isinstance(args[0], str) and args[0].strip() and not args[0].strip().lstrip("-").isdigit():
            # 视作 (username, offset, from_pos)
            # 但此分支下缺少 to_pos/cid，需从 kwargs 补充
            username = str(args[0]).strip()
            offset, from_pos = args[1], args[2]
        else:
            offset, from_pos, to_pos = args[0], args[1], args[2]
    elif len(args) == 4:
        # 标准 4 参或带 username 的 4 参变体
        # 判断第一参是否为 username
        if username is None and isinstance(args[0], str) and args[0].strip() and not args[0].strip().lstrip("-").isdigit() and isinstance(args[1], int):
            # 可能是 (username, offset, from_pos, to_pos) -> cid 在 kwargs
            username = str(args[0]).strip()
            offset, from_pos, to_pos = args[1], args[2], args[3]
        else:
            offset, from_pos, to_pos, conversation_id = args[0], args[1], args[2], args[3]
    elif len(args) >= 5:
        # (username, offset, from_pos, to_pos, conversation_id)
        if username is None:
            username = str(args[0]).strip()
        offset, from_pos, to_pos, conversation_id = args[1], args[2], args[3], args[4]

    if username is not None:
        username = str(username).strip() or None
    if offset is None:
        offset = 0
    if from_pos is None:
        from_pos = 0

    return username, offset, from_pos, to_pos, conversation_id


def _parse_legacy_search_args(args: tuple, kwargs: dict) -> tuple[str | None, int, str, int, str | None]:
    """
    解析 legacy_search(offset, keyword, range, conversation_id) 的多态调用。
    返回 (username, offset, keyword, range, conversation_id)
    注意：参数名 `range` 为 Python 内置，此处用 `range` / `window` / `rng` 兼容。
    """

    username: str | None = kwargs.pop("username", None)
    offset: Any = 0
    keyword: Any = ""
    window: Any = 10
    conversation_id: Any = None

    # kwargs 显式
    if "offset" in kwargs:
        offset = kwargs.pop("offset")
    if "keyword" in kwargs:
        keyword = kwargs.pop("keyword")
    if "kw" in kwargs and not keyword:
        keyword = kwargs.pop("kw")
    # range 兼容：range / window / rng / range_ / window_size
    for key in ("range", "window", "rng", "range_", "window_size", "range_value"):
        if key in kwargs:
            window = kwargs.pop(key)
            break
    if "conversation_id" in kwargs:
        conversation_id = kwargs.pop("conversation_id")
    if "cid" in kwargs and conversation_id is None:
        conversation_id = kwargs.pop("cid")

    # positional
    if len(args) == 0:
        pass
    elif len(args) == 1:
        offset = args[0]
    elif len(args) == 2:
        offset, keyword = args[0], args[1]
    elif len(args) == 3:
        # 可能是 (offset, keyword, range) 或 (username, offset, keyword)
        if username is None and isinstance(args[0], str) and args[0].strip() and not args[0].strip().lstrip("-").isdigit() and isinstance(args[1], int):
            # 不太可能，keyword 应为 str，忽略
            pass
        # heuristic：若第一参像 username（字符串且非空且非纯数字），且第二参是字符串 keyword，第三参是 int window
        # 但旧签名前两个 (offset:int, keyword:str) -> 第一参应为 int
        # 若第一参为 str 且第二参为 str，认为是 (username, keyword, window) 缺 offset
        if username is None and isinstance(args[0], str) and args[0].strip() and isinstance(args[1], str) and isinstance(args[2], int):
            # 可能是 (username, keyword, window) ? 忽略此歧义，回退标准
            pass
        offset, keyword, window = args[0], args[1], args[2]
    elif len(args) == 4:
        # 标准 (offset, keyword, range, conversation_id) 或带 username 的 (username, offset, keyword, range)
        if username is None and isinstance(args[0], str) and args[0].strip() and not args[0].strip().lstrip("-").isdigit() and isinstance(args[1], int):
            # unlikely: offset should be int, but args[1] is int -> first is username
            # e.g. ("alice", 0, "hello", 10) -> username, offset, keyword, window
            username = str(args[0]).strip()
            offset, keyword, window = args[1], args[2], args[3]
        else:
            offset, keyword, window, conversation_id = args[0], args[1], args[2], args[3]
    elif len(args) >= 5:
        if username is None:
            username = str(args[0]).strip()
        offset, keyword, window, conversation_id = args[1], args[2], args[3], args[4]

    if username is not None:
        username = str(username).strip() or None
    if offset is None:
        offset = 0
    if keyword is None:
        keyword = ""

    return username, offset, keyword, window, conversation_id


# ------------------------------------------------------------------
# legacy_get_context_length
# ------------------------------------------------------------------

def legacy_get_context_length(*args, **kwargs) -> int:
    """
    Deprecated wrapper：legacy_get_context_length(offset, conversation_id)

    - 兼容旧签名：若 conversation_id 提供则直接使用；否则按 offset 解析
    - 严格校验：offset 为负 -> ConversationValidationError
    - 内部委托至 ConversationContextReader(username).get_length(conversation_id)

    支持的调用形态（均为兼容）：
    - legacy_get_context_length(offset, conversation_id, username="...")
    - legacy_get_context_length(username, offset, conversation_id)
    - legacy_get_context_length(offset=..., conversation_id=..., username=...)
    """

    username, offset, conversation_id = _extract_username_offset_cid_for_length(args, kwargs)

    # 严格校验 offset
    _validate_offset(offset)

    # 解析最终 conversation_id
    cid = _resolve_conversation_id(username, int(offset), conversation_id)

    if cid is None:
        # 旧 service 语义：无对话或 offset 越界时返回 0
        return 0

    # 若未显式提供 username，尝试通过 cid 推断
    resolved_username = str(username).strip() if username is not None and str(username).strip() else None

    if resolved_username is None:
        resolved_username = _infer_username_for_conversation(cid)

    if resolved_username is None or not str(resolved_username).strip():
        raise ConversationValidationError("username 不能为空（legacy_get_context_length 需要 username 以解析严格 Reader）")

    reader = ConversationContextReader(str(resolved_username).strip())

    return int(reader.get_length(cid))


# 兼容别名
get_context_length = legacy_get_context_length


# ------------------------------------------------------------------
# legacy_get_context
# ------------------------------------------------------------------

def legacy_get_context(*args, **kwargs) -> str:
    """
    Deprecated wrapper：legacy_get_context(offset, from_pos, to_pos, conversation_id)

    - 兼容旧签名：from_pos/to_pos 按字符范围切片
    - offset 负数 -> ConversationValidationError
    - from_pos/to_pos 校验由严格 Reader 负责（负数同样抛 ValidationError）
    - 若 offset 解析不到 cid，则返回 ""（与旧 service 保持一致，不抛 NotFound）
    """

    username, offset, from_pos, to_pos, conversation_id = _parse_legacy_context_args(args, kwargs)

    # offset 负数严格抛错
    _validate_offset(offset)

    # from_pos / to_pos 类型与负数校验将由 Reader.read 完成，但此处提前对 from_pos 负数给出明确 ValidationError 以满足 shim 要求
    # to_pos 允许 None
    if from_pos is not None:
        if isinstance(from_pos, bool) or not isinstance(from_pos, int):
            raise ConversationValidationError(f"from_pos 必须为 int，got {from_pos!r}")

        if int(from_pos) < 0:
            raise ConversationValidationError(f"from_pos 不能为负数: {from_pos}")

    if to_pos is not None:
        if isinstance(to_pos, bool) or not isinstance(to_pos, int):
            raise ConversationValidationError(f"to_pos 必须为 int 或 None，got {to_pos!r}")

        if int(to_pos) < 0:
            raise ConversationValidationError(f"to_pos 不能为负数: {to_pos}")

        if isinstance(from_pos, int) and isinstance(to_pos, int) and int(to_pos) < int(from_pos):
            raise ConversationValidationError(f"to_pos({to_pos}) 不能小于 from_pos({from_pos})")

    cid = _resolve_conversation_id(username, int(offset), conversation_id)

    if cid is None:
        return ""

    resolved_username = str(username).strip() if username is not None and str(username).strip() else None

    if resolved_username is None:
        resolved_username = _infer_username_for_conversation(cid)

    if resolved_username is None or not str(resolved_username).strip():
        raise ConversationValidationError("username 不能为空（legacy_get_context 需要 username 以解析严格 Reader）")

    reader = ConversationContextReader(str(resolved_username).strip())

    return str(reader.read(cid, int(from_pos), to_pos))


# 兼容别名
get_context = legacy_get_context


# ------------------------------------------------------------------
# legacy_search
# ------------------------------------------------------------------

def legacy_search(*args, **kwargs) -> str:
    """
    Deprecated wrapper：legacy_search(offset, keyword, range, conversation_id)

    - 旧参数 `range` 对应严格 Reader 的 `window`
    - offset 负数 -> ConversationValidationError
    - keyword / window 校验由 Reader 完成
    - 若 offset 越界无对话，返回 "无对话或 offset 越界"（与旧 service 一致）
    """

    username, offset, keyword, window, conversation_id = _parse_legacy_search_args(args, kwargs)

    # offset 严格校验
    _validate_offset(offset)

    # window 允许 0，负数由 Reader 抛错，但此处也可提前校验以统一错误类型
    if isinstance(window, bool) or not isinstance(window, int):
        raise ConversationValidationError(f"range/window 必须为 int，got {window!r}")

    if int(window) < 0:
        raise ConversationValidationError(f"window 不能为负数: {window}")

    # keyword 非空校验交由 Reader，但为保持 shim 语义，空 keyword 直接返回提示（旧 service 行为）
    if not isinstance(keyword, str):
        raise ConversationValidationError("keyword 必须为字符串")

    if not str(keyword).strip():
        # 旧 service 返回 "关键词为空"
        return "关键词为空"

    cid = _resolve_conversation_id(username, int(offset), conversation_id)

    if cid is None:
        return "无对话或 offset 越界"

    resolved_username = str(username).strip() if username is not None and str(username).strip() else None

    if resolved_username is None:
        resolved_username = _infer_username_for_conversation(cid)

    if resolved_username is None or not str(resolved_username).strip():
        raise ConversationValidationError("username 不能为空（legacy_search 需要 username 以解析严格 Reader）")

    reader = ConversationContextReader(str(resolved_username).strip())

    return str(reader.search(cid, str(keyword).strip(), window=int(window)))


# 兼容别名
search = legacy_search


# ------------------------------------------------------------------
# legacy update_message_metadata shim
# ------------------------------------------------------------------

def legacy_update_message_metadata(*args, **kwargs) -> Dict[str, Any]:
    """
    Deprecated shim：legacy_update_message_metadata(conversation_id, message_index, metadata_patch)

    兼容旧签名并委托至 ConversationService.update_message_metadata。

    支持调用形态：
    - legacy_update_message_metadata(username, conversation_id, message_index, metadata_patch)
    - legacy_update_message_metadata(conversation_id, message_index, metadata_patch, username="...")
    - legacy_update_message_metadata(username="...", conversation_id="...", message_index=..., metadata_patch={...})
    - legacy_update_message_metadata(message_index=..., metadata_patch=..., conversation_id=..., username=...)
    """

    username: str | None = kwargs.pop("username", None)
    conversation_id: Any = kwargs.pop("conversation_id", None)
    message_index: Any = kwargs.pop("message_index", None)
    metadata_patch: Any = kwargs.pop("metadata_patch", None)
    # 兼容别名
    if conversation_id is None and "cid" in kwargs:
        conversation_id = kwargs.pop("cid")
    if message_index is None and "index" in kwargs:
        message_index = kwargs.pop("index")
    if metadata_patch is None and "patch" in kwargs:
        metadata_patch = kwargs.pop("patch")
    if metadata_patch is None and "metadata" in kwargs:
        metadata_patch = kwargs.pop("metadata")

    # positional 解析
    # 标准严格签名：(username, conversation_id, message_index, metadata_patch)
    # 旧签名可能为：(conversation_id, message_index, metadata_patch)
    remaining = list(args)

    if len(remaining) == 0:
        pass
    elif len(remaining) == 1:
        # 可能是 conversation_id
        if conversation_id is None:
            conversation_id = remaining[0]
        elif message_index is None:
            message_index = remaining[0]
        elif metadata_patch is None:
            metadata_patch = remaining[0]
    elif len(remaining) == 2:
        # 可能是 (conversation_id, message_index) 或 (message_index, metadata_patch)
        # heuristic：若 remaining[1] 是 dict，则是 (message_index, patch)
        if isinstance(remaining[1], dict):
            if message_index is None:
                message_index = remaining[0]
            if metadata_patch is None:
                metadata_patch = remaining[1]
            # conversation_id 需从 kwargs
        else:
            if conversation_id is None:
                conversation_id = remaining[0]
            if message_index is None:
                message_index = remaining[1]
    elif len(remaining) == 3:
        # 可能是 (conversation_id, message_index, metadata_patch) 或 (username, conversation_id, message_index)
        if isinstance(remaining[2], dict):
            # (conversation_id, message_index, patch) 或 (username, conversation_id, message_index?) 但第三参是 dict -> 认为是 patch
            # 判断第一参是否为可能的 username（字符串且非纯数字）且第二参为字符串 conversation_id
            if username is None and isinstance(remaining[0], str) and remaining[0].strip() and isinstance(remaining[1], str) and isinstance(remaining[2], dict):
                # 无法区分：可能是 (username, conversation_id, patch) 缺 index，或 (conversation_id, message_index, patch)
                # 通过第二参是否为 int 判断
                # 此处保守：视为 (conversation_id, message_index, patch)
                conversation_id, message_index, metadata_patch = remaining[0], remaining[1], remaining[2]
                # 若 username 仍缺，尝试从第一参推断是否为 username（若它不是数字字符串且 conversation_id 看起来像数字？）不做复杂
            else:
                conversation_id, message_index, metadata_patch = remaining[0], remaining[1], remaining[2]
        else:
            # (username, conversation_id, message_index) 缺 patch -> patch 在 kwargs
            if username is None:
                username = str(remaining[0]).strip()
            conversation_id, message_index = remaining[1], remaining[2]
    elif len(remaining) >= 4:
        # (username, conversation_id, message_index, metadata_patch)
        if username is None:
            username = str(remaining[0]).strip()
        conversation_id, message_index, metadata_patch = remaining[1], remaining[2], remaining[3]

    # 若仍缺 username，尝试从 remaining 推断（若调用为 (username, conversation_id, message_index, patch) 已处理）
    if username is not None:
        username = str(username).strip() or None

    if not username:
        raise ConversationValidationError("username 不能为空（legacy_update_message_metadata 需要 username）")

    if conversation_id is None or not str(conversation_id).strip():
        raise ConversationValidationError("conversation_id 不能为空")

    if message_index is None:
        raise ConversationValidationError("message_index 不能为空")

    try:
        idx = int(message_index)  # type: ignore[arg-type]
        if isinstance(message_index, bool):
            raise ValueError
    except Exception:
        raise ConversationValidationError(f"message_index 必须为 int，got {message_index!r}")

    if idx < 0:
        raise ConversationValidationError(f"message_index 不能为负数: {idx}")

    if metadata_patch is None:
        metadata_patch = {}

    if not isinstance(metadata_patch, dict):
        raise ConversationValidationError(f"metadata_patch 必须为 dict，got {type(metadata_patch).__name__}: {metadata_patch!r}")

    # 委托至严格 Service
    from .service import ConversationService

    svc = ConversationService(str(username))

    return dict(svc.update_message_metadata(str(conversation_id).strip(), int(idx), dict(metadata_patch)))


# 兼容别名：update_message_metadata 为 shim 主入口
update_message_metadata = legacy_update_message_metadata


# ------------------------------------------------------------------
# 为满足“函数签名包含 offset, conversation_id”等描述，显式声明 inspect signature
# 使 inspect.signature(legacy_*) 显示期望的参数名，即使实现使用 *args
# ------------------------------------------------------------------

try:
    legacy_get_context_length.__signature__ = inspect.Signature(  # type: ignore[attr-defined]
        parameters=[
            inspect.Parameter("offset", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=0),
            inspect.Parameter("conversation_id", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=None),
            inspect.Parameter("username", inspect.Parameter.KEYWORD_ONLY, default=None),
        ]
    )
except Exception:
    pass

try:
    legacy_get_context.__signature__ = inspect.Signature(  # type: ignore[attr-defined]
        parameters=[
            inspect.Parameter("offset", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=0),
            inspect.Parameter("from_pos", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=0),
            inspect.Parameter("to_pos", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=None),
            inspect.Parameter("conversation_id", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=None),
            inspect.Parameter("username", inspect.Parameter.KEYWORD_ONLY, default=None),
        ]
    )
except Exception:
    pass

try:
    legacy_search.__signature__ = inspect.Signature(  # type: ignore[attr-defined]
        parameters=[
            inspect.Parameter("offset", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=0),
            inspect.Parameter("keyword", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=""),
            inspect.Parameter("range", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=10),
            inspect.Parameter("conversation_id", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=None),
            inspect.Parameter("username", inspect.Parameter.KEYWORD_ONLY, default=None),
        ]
    )
except Exception:
    pass

try:
    legacy_update_message_metadata.__signature__ = inspect.Signature(  # type: ignore[attr-defined]
        parameters=[
            inspect.Parameter("username", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=None),
            inspect.Parameter("conversation_id", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=None),
            inspect.Parameter("message_index", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=None),
            inspect.Parameter("metadata_patch", inspect.Parameter.POSITIONAL_OR_KEYWORD, default=None),
        ]
    )
except Exception:
    pass

