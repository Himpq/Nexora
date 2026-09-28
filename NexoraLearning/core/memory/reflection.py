"""夜间反思：合并近 7 天的情景记忆与阅读 / 答题观察，产出 ≤ 2 条带来源的结论（kind=insight）。

insight 的 quote 是模型句子，但 `value` 存 source_ids 列表（JSON），指向原话；「它眼里的你」把 insight 排最前。
只对最近 7 天有活动的用户跑，每天一次，`think: False`。
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any, Dict, List, Mapping, Optional

from core.runlog import log_event

WINDOW_SECONDS = 7 * 86400

_PROMPT = (
    "你是学习助手的夜间反思器。根据学生最近 7 天的原话记录和学习观察，写出最多 2 条对这个学生的观察结论，"
    "每条一句话、第一人称「我注意到…」、必须能被给出的原话或观察支持，并列出支持它的记忆 id。"
    "只输出 JSON 数组：[{\"text\": 结论, \"source_ids\": [记忆 id...], \"confidence\": 0.5~0.9}]，没有可靠结论就输出 []。\n\n"
    "近 7 天原话记忆：{memories}\n\n学习观察：{observations}\n\n输出："
)


def _parse(raw: str) -> List[Dict[str, Any]]:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(raw or "").strip(), flags=re.IGNORECASE | re.MULTILINE)
    match = re.search(r"\[.*\]", text, flags=re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    rows = []
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, Mapping):
            continue
        sentence = str(item.get("text") or "").strip()[:300]
        sources = [str(s) for s in (item.get("source_ids") or []) if str(s).strip()]
        if sentence and sources:
            rows.append({"text": sentence, "source_ids": sources[:8], "confidence": item.get("confidence")})
    return rows[:2]


def insert_insight(cfg: Mapping[str, Any], username: str, *, text: str, source_ids: List[str],
                   confidence: float = 0.7, occurred_at: Optional[int] = None) -> Optional[str]:
    """写一条 insight（幂等：同一天同一句只写一次）。"""
    from core.memory.evidence_memory import _database, _id, _insert_memory

    timestamp = int(occurred_at or time.time())
    day = time.strftime("%Y-%m-%d", time.localtime(timestamp))
    source_id = "reflect_" + hashlib.sha256(f"{username}|{day}|{text}".encode("utf-8")).hexdigest()[:20]
    with _database(cfg, username, create=True) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("SELECT 1 FROM sources WHERE source_id=?", (source_id,)).fetchone():
            return None
        connection.execute("INSERT INTO sources VALUES (?,?,?,?,?,?)",
                           (source_id, "reflection", "reflection", text, timestamp, int(time.time())))
        memory_id = _insert_memory(connection, source_id=source_id,
                                   claim={"key": "insight", "kind": "insight", "quote": text},
                                   lecture_id="", book_id="", occurred_at=timestamp)
        connection.execute("UPDATE memories SET value=?, confidence=? WHERE id=?",
                           (json.dumps(list(source_ids), ensure_ascii=False), max(0.5, min(0.9, float(confidence or 0.7))), memory_id))
        return memory_id


def run_reflection(proxy: Any, cfg: Mapping[str, Any], username: str, *, now: Optional[int] = None) -> Dict[str, Any]:
    from core.cognition.learning_observations import learning_observations
    from core.memory.evidence_memory import retrieve_memories

    current = int(now or time.time())
    rows = [row for row in retrieve_memories(cfg, username, limit=40)
            if row.get("kind") != "insight" and current - int(row.get("occurred_at") or 0) <= WINDOW_SECONDS]
    if len(rows) < 2 or proxy is None:
        return {"ran": False, "reason": "not_enough_recent_memories" if len(rows) < 2 else "no_proxy"}
    compact = [{"id": row["id"], "kind": row["kind"], "said_on": row.get("said_on"), "quote": str(row["quote"])[:160]} for row in rows[:24]]
    try:
        observed = learning_observations(cfg, username)
        summary = [{k: course.get(k) for k in ("title", "reading_progress", "read_chapters", "completed_chapters")}
                   for course in observed.get("courses") or []][:4]
    except Exception:
        summary = []
    prompt = (_PROMPT.replace("{memories}", json.dumps(compact, ensure_ascii=False))
              .replace("{observations}", json.dumps(summary, ensure_ascii=False)))
    result = proxy.complete_raw(messages=[{"role": "user", "content": prompt}], username=username, api_mode="chat",
                                options={"temperature": 0.1, "max_tokens": 600, "think": False}, request_timeout=30)
    if not isinstance(result, Mapping) or not result.get("success"):
        return {"ran": False, "reason": "model_failed"}
    payload = result.get("payload") if isinstance(result.get("payload"), Mapping) else {}
    known = {row["id"] for row in rows}
    written = []
    for item in _parse(proxy.extract_output_text(payload)):
        sources = [sid for sid in item["source_ids"] if sid in known]
        if not sources:
            continue
        memory_id = insert_insight(cfg, username, text=item["text"], source_ids=sources,
                                   confidence=float(item.get("confidence") or 0.7), occurred_at=current)
        if memory_id:
            written.append(memory_id)
    log_event("memory_reflection", "夜间反思完成", payload={"user_id": username, "written": len(written)})
    return {"ran": True, "written": written}


def run_reflection_for_active_users(cfg: Mapping[str, Any], *, now: Optional[int] = None, proxy: Any = None) -> Dict[str, Any]:
    from core import user as user_store
    from core.memory.evidence_memory import memory_stats

    current = int(now or time.time())
    if proxy is None:
        try:
            from core.nexora_proxy import NexoraProxy

            proxy = NexoraProxy(cfg)
        except Exception:
            proxy = None
    ran: Dict[str, Any] = {}
    for row in user_store.list_users(cfg) or []:
        if not isinstance(row, Mapping):
            continue
        username = str(row.get("id") or row.get("username") or "").strip()
        if not username:
            continue
        try:
            stats = memory_stats(cfg, username)
            if current - int(stats.get("last_activity_at") or 0) > WINDOW_SECONDS:
                continue
            ran[username] = run_reflection(proxy, cfg, username, now=current)
        except Exception as exc:  # noqa: BLE001
            ran[username] = {"ran": False, "reason": str(exc)[:200]}
    return ran
