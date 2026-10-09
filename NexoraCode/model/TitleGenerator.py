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
- wait_for_title(): 等待进行中的标题生成结束（worker 收尾前调用，保证标题帧先于流结束）
- set_title_listener(): 注册生成完成回调，供宿主把新标题推给前端即时刷新
"""

from __future__ import annotations

import re
import threading
import time
from typing import Optional

from .ConversationStore import (
    ConversationStore,
    TITLE_SOURCE_AUTO,
    can_overwrite_title,
    is_placeholder_title,
)
from .Provider import ProviderClient, load_provider
from .ShortRequest import ShortRequestError, run_short_request


# 标题长度上限（字符），与手动截断口径保持一致量级。
_TITLE_MAX_CHARS = 24
# 生成标题的输出上限，标题很短，给足余量即可。
_TITLE_MAX_TOKENS = 48
# 同一会话只保留一个进行中的生成任务，避免重复请求。
_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT: set[str] = set()

# 标题生成完成后的通知回调（由宿主注册，用于把新标题推给前端即时刷新）。
# 回调在后台线程内同步执行，实现方必须自行保证线程安全与异常隔离。
_LISTENER_LOCK = threading.Lock()
_LISTENER = None


def set_title_listener(listener) -> None:
    """注册标题生成完成回调：listener(conversation_id, title)。传 None 解除。"""
    global _LISTENER

    with _LISTENER_LOCK:
        _LISTENER = listener


def _notify_title_generated(conversation_id: str, title: str) -> None:
    """通知宿主标题已更新；回调异常不得影响标题生成主流程。"""
    with _LISTENER_LOCK:
        listener = _LISTENER

    if listener is None:
        return

    try:
        listener(conversation_id, title)
    except Exception as exc:
        print(f"[LocalTitle] listener failed conversation={conversation_id} reason={type(exc).__name__}: {exc}")


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
    """后台任务：生成标题并在可覆盖时写回。"""
    try:
        title = _generate_title_text(user_text)

        if not title:
            return

        store = ConversationStore()
        conversation = store.get(conversation_id)

        if conversation is None:
            return

        # 二次确认：占位值或来源为 auto（截断标题 / 上一次自动标题）才写回，
        # 用户手动改写的标题（title_source=user）绝不覆盖。
        state = store.get_title_state(conversation_id)

        if not can_overwrite_title(state.get("title"), state.get("title_source")):
            return

        store.set_title(conversation_id, title, source=TITLE_SOURCE_AUTO)
        print(f"[LocalTitle] generated conversation={conversation_id} title={title!r}")

        _notify_title_generated(conversation_id, title)
    except Exception as exc:
        # 标题是锦上添花：任何失败都静默降级，保留原有截断标题。
        print(f"[LocalTitle] skipped conversation={conversation_id} reason={type(exc).__name__}: {exc}")
    finally:
        with _INFLIGHT_LOCK:
            _INFLIGHT.discard(conversation_id)


def wait_for_title(conversation_id: str, timeout: float = 8.0) -> bool:
    """等待该会话进行中的标题生成结束；返回是否在超时前结束。

    worker 收尾前调用：标题帧必须赶在流结束前推送，否则读取端退出后就收不到了。
    """
    clean_id = str(conversation_id or "").strip()

    if not clean_id:
        return True

    deadline = time.monotonic() + max(0.0, float(timeout))

    while time.monotonic() < deadline:
        with _INFLIGHT_LOCK:
            running = clean_id in _INFLIGHT

        if not running:
            return True

        time.sleep(0.02)

    return False


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
