"""
NexoraCode.model.TitleGenerator — 会话标题自动生成

会话创建后标题为占位值（「新对话」/「新会话」）。首条用户消息落盘时，用当前
选中的 Provider 异步生成一个简短标题并写回会话索引；生成失败或不满足条件时
保持原有截断标题，不阻塞对话主流程。

设计：
- 异步：在后台线程执行，绝不阻塞 stream_send 的流式回复。
- 降级：Provider 未配置、请求失败、返回格式无效时静默放弃，标题维持原值。
- 幂等：仅在标题仍为占位值时生成，避免覆盖用户手动改名或已生成结果。
- 去重：同一会话同时只允许一个生成任务在跑。

对外提供：
- maybe_generate_title(): 若标题仍是占位值则异步生成
"""

from __future__ import annotations

import re
import threading
from typing import Optional

from .ConversationStore import ConversationStore, is_placeholder_title
from .Provider import ProviderClient, load_provider
from .ShortRequest import ShortRequestError, run_short_request


# 标题长度上限（字符），与手动截断口径保持一致量级。
_TITLE_MAX_CHARS = 24
# 生成标题的输出上限，标题很短，给足余量即可。
_TITLE_MAX_TOKENS = 48
# 同一会话只保留一个进行中的生成任务，避免重复请求。
_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT: set[str] = set()

_TITLE_SYSTEM_PROMPT = (
    "你是会话标题生成器。根据用户的第一条消息，生成一个简短的中文标题，"
    "概括用户要处理的任务或问题。"
    "要求：不超过 20 个字；不加引号、书名号或结尾标点；不要输出解释、前缀或多余文字；"
    "只输出标题本身。"
)


def _clean_title(raw: str) -> str:
    """清洗模型输出：去掉引号/标点/换行，压平空白并截断。"""
    text = re.sub(r"\s+", " ", str(raw or "")).strip()
    # 先去结尾标点（模型常写「标题。」），再剥离可能包裹的引号与书名号。
    text = text.rstrip("。.，,：:；;！!？?").strip()
    text = text.strip("\"'“”‘’《》「」【】").strip()
    return text[:_TITLE_MAX_CHARS]


def _generate_title_text(user_text: str) -> str:
    """调用当前 Provider 生成标题文本；失败抛异常由调用方降级。"""
    provider = load_provider()

    if not provider.is_configured():
        raise ShortRequestError("Provider 未配置")

    # 标题生成要求确定性输出，温度固定为 0。
    provider.temperature = 0.0
    client = ProviderClient(provider)
    messages = [
        {"role": "system", "content": _TITLE_SYSTEM_PROMPT},
        {"role": "user", "content": str(user_text or "").strip()[:2000]},
    ]
    result = run_short_request(
        client,
        messages,
        max_tokens=_TITLE_MAX_TOKENS,
        cancel_message="标题生成已取消",
        tool_call_message="标题请求返回了工具调用",
    )
    return _clean_title(result.text)


def _run_generation(conversation_id: str, user_text: str) -> None:
    """后台任务：生成标题并在仍为占位值时写回。"""
    try:
        title = _generate_title_text(user_text)

        if not title:
            return

        store = ConversationStore()
        conversation = store.get(conversation_id)

        if conversation is None:
            return

        # 二次确认：仅当标题仍是占位值时写回，避免覆盖用户手动改名。
        if not is_placeholder_title(conversation.get("title")):
            return

        store.set_title(conversation_id, title)
        print(f"[LocalTitle] generated conversation={conversation_id} title={title!r}")
    except Exception as exc:
        # 标题是锦上添花：任何失败都静默降级，保留原有截断标题。
        print(f"[LocalTitle] skipped conversation={conversation_id} reason={type(exc).__name__}: {exc}")
    finally:
        with _INFLIGHT_LOCK:
            _INFLIGHT.discard(conversation_id)


def maybe_generate_title(conversation_id: str, user_text: str, current_title: str = "") -> bool:
    """标题仍为占位值时，异步生成智能标题；返回是否已派发任务。

    调用方传入 current_title 可避免重复读盘；为空时由后台任务自行读取校验。
    """
    clean_id = str(conversation_id or "").strip()

    if not clean_id or not str(user_text or "").strip():
        return False

    if not is_placeholder_title(current_title):
        return False

    with _INFLIGHT_LOCK:
        if clean_id in _INFLIGHT:
            return False

        _INFLIGHT.add(clean_id)

    thread = threading.Thread(
        target=_run_generation,
        args=(clean_id, user_text),
        name=f"title-gen-{clean_id[:8]}",
        daemon=True,
    )
    thread.start()
    return True
