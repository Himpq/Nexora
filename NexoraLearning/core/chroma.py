"""
NexoraLearning — NexoraDB HTTP 客户端
每个课程对应一个 library 命名空间: course_{course_id}
使用 NexoraDB 的 service HTTP API（与 ChatDBServer 共用同一套接口）

配置示例（config.json）：
  "nexoradb": {
    "service_url": "http://127.0.0.1:8100",
    "api_key": ""
  }
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional

# NexoraDB 用 username 作为 collection 分区键；
# NexoraLearning 使用固定 username="nexoralearning"，用 library 区分课程。
_NEXORA_USERNAME = "nexoralearning"


def _library(course_id: str) -> str:
    return f"course_{course_id}"


def _get_url(cfg: Dict[str, Any]) -> str:
    db_cfg = cfg.get("nexoradb") or {}
    return str(db_cfg.get("service_url") or "http://127.0.0.1:8100").rstrip("/")


def _get_key(cfg: Dict[str, Any]) -> str:
    db_cfg = cfg.get("nexoradb") or {}
    return str(db_cfg.get("api_key") or "")


def _post(cfg: Dict[str, Any], path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{_get_url(cfg)}{path}"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    key = _get_key(cfg)
    if key:
        headers["X-API-Key"] = key
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8")
            return json.loads(body) if body else {"success": False, "message": str(e)}
        except Exception:
            return {"success": False, "message": str(e)}
    except Exception as e:
        return {"success": False, "message": str(e)}


def upsert_chunks(
    cfg: Dict[str, Any],
    course_id: str,
    material_id: str,
    chunks: List[str],
    title: str,
) -> int:
    """将切片批量写入 NexoraDB，返回写入数量。"""
    if not chunks:
        return 0
    library = _library(course_id)
    items = [
        {
            "title": title,
            "text": chunk,
            "metadata": {"material_id": material_id, "chunk_index": i},
            "chunk_id": i,
        }
        for i, chunk in enumerate(chunks)
    ]
    resp = _post(cfg, "/upsert_texts", {
        "username": _NEXORA_USERNAME,
        "items": items,
        "library": library,
    })
    if not resp.get("success", True):
        raise RuntimeError(resp.get("message") or "upsert_texts failed")
    ids = resp.get("vector_ids") or []
    return len(ids) if isinstance(ids, list) else len(chunks)


def delete_material_chunks(cfg: Dict[str, Any], course_id: str, material_id: str) -> None:
    """删除某教材在 NexoraDB 中的所有向量。"""
    library = _library(course_id)
    _post(cfg, "/delete", {
        "username": _NEXORA_USERNAME,
        "library": library,
        "where": {"material_id": material_id},
    })


def delete_course_collection(cfg: Dict[str, Any], course_id: str) -> None:
    """删除整个课程的知识库（按 library 批量清理）。"""
    library = _library(course_id)
    resp = _post(cfg, "/titles", {"username": _NEXORA_USERNAME, "library": library})
    titles = resp.get("titles") or []
    for title in titles:
        _post(cfg, "/delete", {
            "username": _NEXORA_USERNAME,
            "title": title,
            "library": library,
        })


def query(
    cfg: Dict[str, Any],
    course_id: str,
    query_text: str,
    top_k: int = 5,
    material_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """检索，返回 [{text, metadata, distance}]。"""
    library = _library(course_id)
    payload: Dict[str, Any] = {
        "username": _NEXORA_USERNAME,
        "text": query_text,
        "top_k": top_k,
        "library": library,
    }
    if material_id:
        payload["where"] = {"material_id": material_id}

    resp = _post(cfg, "/query_text", payload)
    if not resp.get("success", True):
        raise RuntimeError(resp.get("message") or "query_text failed")

    result = resp.get("result") or {}
    docs = result.get("documents", [[]])
    docs = docs[0] if docs and isinstance(docs[0], list) else docs
    metas = result.get("metadatas", [[]])
    metas = metas[0] if metas and isinstance(metas[0], list) else metas
    dists = result.get("distances", [[]])
    dists = dists[0] if dists and isinstance(dists[0], list) else dists

    return [
        {"text": doc, "metadata": meta, "distance": dist}
        for doc, meta, dist in zip(
            docs,
            metas or [{}] * len(docs),
            dists or [0.0] * len(docs),
        )
    ]


def collection_stats(cfg: Dict[str, Any], course_id: str) -> Dict[str, Any]:
    """获取该课程在 NexoraDB 中的向量统计。"""
    library = _library(course_id)
    resp = _post(cfg, "/titles", {"username": _NEXORA_USERNAME, "library": library})
    titles = resp.get("titles") or []
    return {
        "library": library,
        "title_count": len(titles),
        "titles": titles,
    }
