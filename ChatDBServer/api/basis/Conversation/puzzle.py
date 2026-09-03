"""
Nexora.basis.Conversation.puzzle — Puzzle 画布状态服务

职责：
- 校验 puzzle state 的白名单与严格类型（未知键直接抛错，不静默丢弃）
- 提供原子化的 update / 查询，供 ConversationService 委托

设计约束（对应 service.py 原逻辑的抽取）：
- allowed_keys：nodes, edges, zoom, viewportX, viewportY, locked, submission,
  submitted_at, updated_at
- 严格类型：
    nodes        -> list
    edges        -> list
    zoom         -> number (int/float, 不接受 bool)
    viewportX    -> number
    viewportY    -> number
    locked       -> bool
    submission   -> dict
    submitted_at -> str
    updated_at   -> str
- 未知键必须 raise ConversationValidationError
- 单个 conversation 最多容纳 50 个 puzzle_id，超出抛错
- 更新为原子操作：conversation_update_session + safe_write_json + 索引同步
"""

from __future__ import annotations

import copy
from datetime import datetime
from typing import Any, Dict

from basis.Database import safe_write_json

from . import index as index_mod
from .errors import ConversationValidationError
from .migration import migrate_single_conversation_data
from .repository import conversation_update_session
from .schema import SCHEMA_VERSION, normalize_v4_conversation, validate_v4_conversation


# ------------------------------------------------------------------
# 常量：白名单与类型表
# ------------------------------------------------------------------

ALLOWED_PUZZLE_STATE_KEYS = {
    "nodes",
    "edges",
    "zoom",
    "viewportX",
    "viewportY",
    "locked",
    "submission",
    "submitted_at",
    "updated_at",
}

# 每个键的严格类型描述，用于错误提示
# value 为 tuple(type, human-readable-name)
_PUZZLE_KEY_TYPE_LABEL: Dict[str, str] = {
    "nodes": "list",
    "edges": "list",
    "zoom": "number",
    "viewportX": "number",
    "viewportY": "number",
    "locked": "bool",
    "submission": "dict",
    "submitted_at": "string",
    "updated_at": "string",
}

PUZZLE_STATE_LIMIT = 50


# ------------------------------------------------------------------
# 内部工具
# ------------------------------------------------------------------

def _is_number(value: Any) -> bool:
    """判定是否为 number（int/float），排除 bool。"""

    if isinstance(value, bool):
        return False

    return isinstance(value, (int, float))


def _type_mismatch_message(key: str, value: Any) -> str:
    expected = _PUZZLE_KEY_TYPE_LABEL.get(key, "unknown")

    return (
        f"puzzle state 字段类型错误: {key!r} 期望 {expected}，"
        f"实际为 {type(value).__name__} ({value!r})"
    )


# ------------------------------------------------------------------
# 校验
# ------------------------------------------------------------------

def validate_state(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    严格校验 puzzle state。

    - state 必须为 dict，否则抛错
    - 出现白名单外的键直接抛错（不静默丢弃）
    - 已知键按 _PUZZLE_KEY_TYPE_LABEL 做严格类型检查

    返回 state 的浅拷贝（调用方可安全修改），校验失败抛 ConversationValidationError。
    """

    if not isinstance(state, dict):
        raise ConversationValidationError("state 必须是 dict")

    # 未知键直接抛错
    unknown = [k for k in state.keys() if k not in ALLOWED_PUZZLE_STATE_KEYS]

    if unknown:
        raise ConversationValidationError(
            f"puzzle state 包含非法字段: {unknown!r}，"
            f"允许的字段为 {sorted(ALLOWED_PUZZLE_STATE_KEYS)!r}"
        )

    # 逐键严格类型检查
    for key, value in state.items():
        if key == "nodes":
            if not isinstance(value, list):
                raise ConversationValidationError(_type_mismatch_message(key, value))

        elif key == "edges":
            if not isinstance(value, list):
                raise ConversationValidationError(_type_mismatch_message(key, value))

        elif key in ("zoom", "viewportX", "viewportY"):
            if not _is_number(value):
                raise ConversationValidationError(_type_mismatch_message(key, value))

        elif key == "locked":
            if not isinstance(value, bool):
                raise ConversationValidationError(_type_mismatch_message(key, value))

        elif key == "submission":
            if not isinstance(value, dict):
                raise ConversationValidationError(_type_mismatch_message(key, value))

        elif key in ("submitted_at", "updated_at"):
            if not isinstance(value, str):
                raise ConversationValidationError(_type_mismatch_message(key, value))

        else:
            # 防御：若未来扩展白名单但漏加分支，这里兜底为未知键错误
            raise ConversationValidationError(f"未处理的 puzzle 字段: {key!r}")

    return dict(state)


def _ensure_updated_at(clean: Dict[str, Any]) -> Dict[str, Any]:
    """若 clean 中无 updated_at，则补齐为当前 ISO 时间。"""

    if "updated_at" not in clean:
        clean["updated_at"] = datetime.now().isoformat()

    return clean


# ------------------------------------------------------------------
# 函数式 API（供 service.py 直接委托）
# ------------------------------------------------------------------

def update_puzzle_state(
    username: str,
    conversation_id: str,
    puzzle_id: str,
    state: Dict[str, Any],
) -> Dict[str, Any]:
    """
    原子更新单个 puzzle 的画布状态。

    - 校验 puzzle_id / state
    - 严格校验白名单与类型（未知键抛错）
    - 在 conversation_update_session 事务内完成 50 上限检查与写入
    - 自动补齐 updated_at，并同步索引

    返回写入后的 clean state 深拷贝。
    """

    pid = str(puzzle_id or "").strip()

    if not pid:
        raise ConversationValidationError("puzzle_id 不能为空")

    if not isinstance(state, dict):
        raise ConversationValidationError("state 必须是 dict")

    # 严格校验（未知键抛错、类型不符抛错）
    clean = validate_state(state)

    # 补齐 updated_at（validate 后再补，避免对 updated_at 的 string 校验失效）
    _ensure_updated_at(clean)

    # 仅保留白名单键（validate 已保证无非法键，此处为防御性过滤）
    clean = {k: v for k, v in clean.items() if k in ALLOWED_PUZZLE_STATE_KEYS}

    with conversation_update_session(username, conversation_id) as (path, data):
        # 若为旧版，先迁移并归一化
        if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
            data = migrate_single_conversation_data(data)
            data = normalize_v4_conversation(data)

        puzzle_states = data.get("puzzle_states")

        if not isinstance(puzzle_states, dict):
            puzzle_states = {}

        # 容量校验：新增时检查 50 上限
        if pid not in puzzle_states and len(puzzle_states) >= PUZZLE_STATE_LIMIT:
            raise ConversationValidationError(
                f"puzzle_states limit reached ({PUZZLE_STATE_LIMIT})"
            )

        puzzle_states[pid] = dict(clean)
        data["puzzle_states"] = puzzle_states
        data["updated_at"] = datetime.now().isoformat()

        validate_v4_conversation(data)
        safe_write_json(path, data, indent=2)
        index_mod.sync_index_from_file(username, path, data)

        return copy.deepcopy(clean)


def get_puzzle_states(username: str, conversation_id: str) -> Dict[str, Any]:
    """
    获取对话中全部 puzzle 状态（深拷贝）。

    读取失败由下层抛 ConversationNotFoundError 等，调用方按需映射为 HTTP 状态。
    """

    from .repository import load_conversation_file

    data = load_conversation_file(username, conversation_id)

    if int(data.get("schema_version") or 0) != SCHEMA_VERSION:
        data = migrate_single_conversation_data(data)
        data = normalize_v4_conversation(data)
    else:
        data = normalize_v4_conversation(data)

    ps = data.get("puzzle_states")

    if not isinstance(ps, dict):
        return {}

    return copy.deepcopy(ps)


def get_puzzle_state(
    username: str, conversation_id: str, puzzle_id: str
) -> Dict[str, Any] | None:
    """获取单个 puzzle 状态，深拷贝；不存在返回 None。"""

    pid = str(puzzle_id or "").strip()

    if not pid:
        raise ConversationValidationError("puzzle_id 不能为空")

    states = get_puzzle_states(username, conversation_id)
    value = states.get(pid)

    return copy.deepcopy(value) if isinstance(value, dict) else None


# ------------------------------------------------------------------
# 面向对象封装（供 service.py 以组合方式委托）
# ------------------------------------------------------------------

class ConversationPuzzleService:
    """
    Puzzle 领域服务，供 ConversationService 组合委托。

    示例（在 service.py 中）：
        from .puzzle import ConversationPuzzleService

        class ConversationService:
            def __init__(self, username):
                ...
                self._puzzles = ConversationPuzzleService(username)

            def update_puzzle_state(self, conversation_id, puzzle_id, state):
                return self._puzzles.update_puzzle_state(conversation_id, puzzle_id, state)

    亦可直接使用模块级函数 update_puzzle_state(username, ...) 避免实例化。
    """

    def __init__(self, username: str):
        self.username = str(username or "").strip()

        if not self.username:
            raise ConversationValidationError("username 不能为空")

    # -- 校验 --

    def validate_state(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """代理到模块级 validate_state。"""

        return validate_state(state)

    # -- 写 --

    def update_puzzle_state(
        self, conversation_id: str, puzzle_id: str, state: Dict[str, Any]
    ) -> Dict[str, Any]:
        """原子更新 puzzle 状态（实例方法，username 已绑定）。"""

        return update_puzzle_state(self.username, conversation_id, puzzle_id, state)

    # -- 读 --

    def get_puzzle_states(self, conversation_id: str) -> Dict[str, Any]:
        """获取全部 puzzle 状态。"""

        return get_puzzle_states(self.username, conversation_id)

    def get_puzzle_state(
        self, conversation_id: str, puzzle_id: str
    ) -> Dict[str, Any] | None:
        """获取单个 puzzle 状态。"""

        return get_puzzle_state(self.username, conversation_id, puzzle_id)


__all__ = [
    "ALLOWED_PUZZLE_STATE_KEYS",
    "PUZZLE_STATE_LIMIT",
    "ConversationPuzzleService",
    "validate_state",
    "update_puzzle_state",
    "get_puzzle_states",
    "get_puzzle_state",
]
