"""模型抽取记忆（异步、工具式 JSON 操作列表）。

正则 `_extract` 是同步高精度快路径；这里在回答完成后起线程，把本轮原话 + 回答 + 相关旧记忆交给模型，
输出 `[{op, kind, quote, confidence, supersedes?}]`，由 `apply_model_claims` 落库：
quote 必须是原话片段（防止模型改写），同一来源不重复，`supersedes` 只能指向现有活跃记忆。
`think: False`、`max_tokens 800`，结果不进时间线（只在产生新记忆时写一条 memory_noted 事件）。
"""

from __future__ import annotations

import json
import re
import threading
import time
from typing import Any, Dict, List, Mapping, Optional

from core.runlog import log_event

_PROMPT = (
    "你是学习助手的记忆整理器。下面给出学生这轮的原话、助手的回答、以及已有的相关记忆。"
    "请从**学生原话**里抽取值得长期记住的自述事实，输出 JSON 数组，不要输出其他文字。\n"
    "每项：{\"op\": \"remember\"|\"supersede\"|\"noop\", \"kind\": \"goal\"|\"preference\"|\"difficulty\"|\"background\"|\"interest\"|\"pace\", "
    "\"quote\": 原话片段(必须逐字出自学生原话), \"confidence\": 0.5~0.95, \"supersedes\": 被替代的旧记忆 id(可选)}\n"
    "规则：普通提问（如「索引的代价是什么」）不是自述，输出 []；转述、假设、引用他人不算；"
    "只有学生明确说出自己的目标 / 偏好 / 困难 / 背景 / 兴趣 / 学习节奏才记；"
    "与旧记忆矛盾时用 supersede 并填 supersedes；不确定就不记。最多 3 项。\n\n"
    "学生原话：{text}\n\n助手回答（仅供理解语境，不能作为学生事实）：{answer}\n\n"
    "已有相关记忆：{memories}\n\n输出："
)


def _parse_ops(raw: str) -> List[Dict[str, Any]]:
    text = str(raw or "").strip()
    if not text:
        return []
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE | re.MULTILINE).strip()
    match = re.search(r"\[.*\]", text, flags=re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    return [row for row in data if isinstance(row, Mapping)][:3] if isinstance(data, list) else []


def extract_with_model(proxy: Any, cfg: Mapping[str, Any], username: str, *, text: str, answer: str,
                       memories: List[Mapping[str, Any]], model: Optional[str] = None) -> List[Dict[str, Any]]:
    """同步调用一次模型，返回操作列表（失败返回 []）。"""
    if proxy is None:
        return []
    compact = [{"id": row.get("id"), "kind": row.get("kind"), "quote": str(row.get("quote") or "")[:200]} for row in memories[:8]]
    prompt = (_PROMPT.replace("{text}", str(text or "")[:2000]).replace("{answer}", str(answer or "")[:1200])
              .replace("{memories}", json.dumps(compact, ensure_ascii=False)))
    result = proxy.complete_raw(
        messages=[{"role": "user", "content": prompt}],
        model=model,
        username=username,
        api_mode="chat",
        options={"temperature": 0.0, "max_tokens": 800, "think": False},
        request_timeout=25,
    )
    if not isinstance(result, Mapping) or not result.get("success"):
        return []
    payload = result.get("payload") if isinstance(result.get("payload"), Mapping) else {}
    return _parse_ops(proxy.extract_output_text(payload))


def run_extraction(proxy: Any, cfg: Mapping[str, Any], username: str, *, text: str, answer: str,
                   source_id: str, lecture_id: str = "", book_id: str = "", occurred_at: Optional[int] = None,
                   model: Optional[str] = None) -> Dict[str, Any]:
    from core import user as user_store
    from core.memory.evidence_memory import apply_model_claims, retrieve_memories

    memories = retrieve_memories(cfg, username, query=text, lecture_id=lecture_id, limit=8)
    ops = extract_with_model(proxy, cfg, username, text=text, answer=answer, memories=memories, model=model)
    if not ops:
        return {"applied": 0, "skipped": 0, "memories": []}
    outcome = apply_model_claims(cfg, username, source_id=source_id, text=text, claims=ops,
                                 lecture_id=lecture_id, book_id=book_id, occurred_at=occurred_at)
    for row in outcome.get("memories") or []:
        # 可见：时间线出「我记住了：…」（不进对话记录，点开可在「它眼里的你」反驳）。
        user_store.append_learning_record(cfg, username, {
            "type": "agent_event",
            "event": "memory_noted",
            "event_id": f"memnote_{str(row.get('id') or '')[-16:]}",
            "memory_id": row.get("id"),
            "kind": row.get("kind"),
            "quote": str(row.get("quote") or "")[:240],
            "timestamp": int(occurred_at or time.time()),
        })
    log_event("memory_model_extract", "模型抽取记忆", payload={
        "user_id": username, "source_id": source_id, "ops": len(ops),
        "applied": outcome.get("applied"), "skipped": outcome.get("skipped"),
    })
    return outcome


def schedule_extraction(proxy: Any, cfg: Mapping[str, Any], username: str, **kwargs: Any) -> bool:
    """fire-and-forget；没有模型代理时直接跳过。"""
    if proxy is None or not str(kwargs.get("text") or "").strip():
        return False

    def run() -> None:
        try:
            run_extraction(proxy, cfg, username, **kwargs)
        except Exception as exc:  # noqa: BLE001
            log_event("memory_model_extract_failed", "模型抽取记忆失败", payload={"user_id": username, "error": str(exc)[:300]})

    threading.Thread(target=run, name=f"memory-extract-{username[:20]}", daemon=True).start()
    return True
