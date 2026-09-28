"""NexoraDB 作为记忆的向量索引（只做索引，不做真相源；SQLite 仍是真相源）。

- 分区：固定 username=`nexoralearning`（core/vector 约定），`library = memory_<user>`；写和查都必须带 library。
- 元数据只放 str/int/float/bool：memory_id / kind / key / status / lecture_id / occurred_at(int)。
- `index(cfg, user, row)` 幂等（title=memory_id，重 upsert 覆盖）；`mark(cfg, user, memory_id, status)` 改状态
  用同 title 重 upsert 实现；`search(cfg, user, text, k, lecture_id)` 返回候选 memory_id 列表（按距离升序）。
- 服务不可达 / 未配置（仍指向 127.0.0.1:8100 且无 key）时所有函数静默返回空，`retrieve_memories` 退回关键词检索。
- 查询前缀：bge 检索指令「为这个句子生成表示以用于检索相关文章：」只加在 query 侧。
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Mapping, Optional

from core.runlog import log_event

_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章："
_DEFAULT_URL = "http://127.0.0.1:8100"


def _library(user: str) -> str:
    return f"memory_{str(user or '').strip()}"


def enabled(cfg: Mapping[str, Any]) -> bool:
    db = cfg.get("nexoradb") if isinstance(cfg.get("nexoradb"), Mapping) else {}
    if str(db.get("memory_index", "")).strip().lower() in {"0", "false", "off", "no"}:
        return False
    url = str(db.get("service_url") or "").rstrip("/")
    return bool(url) and url != _DEFAULT_URL


def _metadata(row: Mapping[str, Any], status: Optional[str] = None) -> Dict[str, Any]:
    try:
        occurred = int(row.get("occurred_at") or 0)
    except (TypeError, ValueError):
        occurred = 0
    return {
        "memory_id": str(row.get("id") or ""),
        "kind": str(row.get("kind") or ""),
        "key": str(row.get("key") or ""),
        "status": str(status or row.get("status") or "active"),
        "lecture_id": str(row.get("lecture_id") or ""),
        "occurred_at": occurred,
    }


def index(cfg: Mapping[str, Any], user: str, row: Mapping[str, Any], *, status: Optional[str] = None) -> bool:
    """把一条记忆行写进索引（幂等）。失败静默。"""
    if not enabled(cfg) or not row or not row.get("id"):
        return False
    from core import vector

    try:
        vector.require_nexoradb_available(dict(cfg))
        resp = vector._post(dict(cfg), "/upsert_texts", {
            "username": vector._NEXORA_USERNAME,
            "library": _library(user),
            "items": [{
                "title": str(row["id"]),
                "text": str(row.get("quote") or "")[:2000],
                "metadata": _metadata(row, status),
                "chunk_id": 0,
            }],
        })
        if not resp.get("success", True):
            raise RuntimeError(resp.get("message") or "upsert_texts failed")
        return True
    except Exception as exc:  # noqa: BLE001
        log_event("memory_index_failed", "记忆向量索引写入失败", payload={"user_id": user, "memory_id": row.get("id"), "error": str(exc)[:200]})
        return False


def mark(cfg: Mapping[str, Any], user: str, row: Mapping[str, Any], status: str) -> bool:
    """状态翻转（superseded / retracted）：同 title 重 upsert 改 metadata.status。"""
    return index(cfg, user, row, status=status)


def search(cfg: Mapping[str, Any], user: str, text: str, k: int = 20, *, lecture_id: str = "") -> List[str]:
    """返回按语义距离排序的活跃记忆 id 候选；不可用返回 []。"""
    query = str(text or "").strip()
    if not enabled(cfg) or not query:
        return []
    from core import vector

    try:
        rows = vector.query_library(dict(cfg), library=_library(user), query_text=_QUERY_PREFIX + query,
                                    top_k=max(1, min(50, int(k))), where={"status": "active"})
    except Exception as exc:  # noqa: BLE001
        log_event("memory_index_search_failed", "记忆向量检索失败", payload={"user_id": user, "error": str(exc)[:200]})
        return []
    ids: List[str] = []
    for item in rows:
        meta = item.get("metadata") if isinstance(item.get("metadata"), Mapping) else {}
        scope = str(meta.get("lecture_id") or "")
        if lecture_id and scope and scope != lecture_id:
            continue
        memory_id = str(meta.get("memory_id") or "")
        if memory_id and memory_id not in ids:
            ids.append(memory_id)
    return ids


def index_async(cfg: Mapping[str, Any], user: str, rows: List[Mapping[str, Any]], *, status: Optional[str] = None) -> None:
    """写路径上不阻塞主请求。"""
    if not enabled(cfg) or not rows:
        return
    snapshot = [dict(row) for row in rows if isinstance(row, Mapping)]

    def run() -> None:
        for row in snapshot:
            index(cfg, user, row, status=status)

    threading.Thread(target=run, name=f"memory-index-{str(user)[:20]}", daemon=True).start()
