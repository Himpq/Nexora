"""向量化与 NexoraDB 调用统一模块。"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from .lectures import (
    get_book,
    get_lecture,
    list_books,
    load_book_text,
    save_book_chunks,
    update_book,
    update_lecture,
)
from .utils import CHUNK_OVERLAP, CHUNK_SIZE, chunk_text

# NexoraDB 用 username 作为 collection 分区键；
# NexoraLearning 使用固定 username，用 library 区分课程或讲座。
_NEXORA_USERNAME = "nexoralearning"
_THREAD_LOCK = threading.Lock()


def get_chunking_config(cfg: Dict[str, Any]) -> Dict[str, int]:
    """读取分块配置。"""
    raw = cfg.get("vectorization")
    branch = raw if isinstance(raw, dict) else {}
    try:
        size = int(branch.get("chunk_size", CHUNK_SIZE))
    except Exception:
        size = CHUNK_SIZE
    try:
        overlap = int(branch.get("chunk_overlap", CHUNK_OVERLAP))
    except Exception:
        overlap = CHUNK_OVERLAP

    size = max(50, size)
    overlap = max(0, min(overlap, size - 1))
    return {"chunk_size": size, "chunk_overlap": overlap}


def split_text_for_vector(cfg: Dict[str, Any], text: str) -> List[str]:
    """按配置分块文本。"""
    settings = get_chunking_config(cfg)
    return chunk_text(
        text,
        size=settings["chunk_size"],
        overlap=settings["chunk_overlap"],
    )


def _library(course_id: str) -> str:
    """课程向量库命名约定。"""
    return f"course_{course_id}"


def _get_url(cfg: Dict[str, Any]) -> str:
    """读取 NexoraDB 服务地址。"""
    db_cfg = cfg.get("nexoradb") or {}
    return str(db_cfg.get("service_url") or "http://127.0.0.1:8100").rstrip("/")


def _get_key(cfg: Dict[str, Any]) -> str:
    """读取 NexoraDB API Key。"""
    db_cfg = cfg.get("nexoradb") or {}
    return str(db_cfg.get("api_key") or "")


def _post(cfg: Dict[str, Any], path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """向 NexoraDB 发起 JSON POST 请求。"""
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
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8")
            return json.loads(body) if body else {"success": False, "message": str(exc)}
        except Exception:
            return {"success": False, "message": str(exc)}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def upsert_chunks(
    cfg: Dict[str, Any],
    course_id: str,
    material_id: str,
    chunks: List[str],
    title: str,
) -> int:
    """将切片批量写入课程库（course_{course_id}）。"""
    return upsert_chunks_to_library(
        cfg,
        library=_library(course_id),
        material_id=material_id,
        chunks=chunks,
        title=title,
    )


def upsert_chunks_to_library(
    cfg: Dict[str, Any],
    *,
    library: str,
    material_id: str,
    chunks: List[str],
    title: str,
    metadata_extra: Optional[Dict[str, Any]] = None,
) -> int:
    """将切片写入指定 library。"""
    if not chunks:
        return 0
    extra = dict(metadata_extra or {})
    items = []
    for index, chunk in enumerate(chunks):
        metadata = {"material_id": material_id, "chunk_index": index}
        metadata.update(extra)
        items.append(
            {
                "title": title,
                "text": chunk,
                "metadata": metadata,
                "chunk_id": index,
            }
        )
    resp = _post(
        cfg,
        "/upsert_texts",
        {
            "username": _NEXORA_USERNAME,
            "items": items,
            "library": str(library),
        },
    )
    if not resp.get("success", True):
        raise RuntimeError(resp.get("message") or "upsert_texts failed")
    ids = resp.get("vector_ids") or []
    return len(ids) if isinstance(ids, list) else len(chunks)


def delete_material_chunks(cfg: Dict[str, Any], course_id: str, material_id: str) -> None:
    """删除某教材在 NexoraDB 中的所有向量。"""
    _post(
        cfg,
        "/delete",
        {
            "username": _NEXORA_USERNAME,
            "library": _library(course_id),
            "where": {"material_id": material_id},
        },
    )


def delete_course_collection(cfg: Dict[str, Any], course_id: str) -> None:
    """删除整个课程知识库。"""
    library = _library(course_id)
    resp = _post(cfg, "/titles", {"username": _NEXORA_USERNAME, "library": library})
    titles = resp.get("titles") or []
    for title in titles:
        _post(cfg, "/delete", {"username": _NEXORA_USERNAME, "title": title, "library": library})


def query(
    cfg: Dict[str, Any],
    course_id: str,
    query_text: str,
    top_k: int = 5,
    material_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """检索课程向量，返回 [{text, metadata, distance}]。"""
    payload: Dict[str, Any] = {
        "username": _NEXORA_USERNAME,
        "text": query_text,
        "top_k": top_k,
        "library": _library(course_id),
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
    """获取课程向量库统计。"""
    library = _library(course_id)
    resp = _post(cfg, "/titles", {"username": _NEXORA_USERNAME, "library": library})
    titles = resp.get("titles") or []
    return {"library": library, "title_count": len(titles), "titles": titles}


def vectorize_book(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    """同步执行单本教材向量化。"""
    lecture = get_lecture(cfg, lecture_id)
    if lecture is None:
        raise ValueError(f"Lecture not found: {lecture_id}")
    book = get_book(cfg, lecture_id, book_id)
    if book is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")

    text = load_book_text(cfg, lecture_id, book_id)
    if not text.strip():
        raise ValueError("Book text is empty.")
    if not force and str(book.get("vector_status") or "").strip().lower() == "vectorizing":
        return {"success": True, "queued": False, "status": "vectorizing", "book": book}

    update_book(cfg, lecture_id, book_id, {"vector_status": "vectorizing", "error": ""})
    chunks = split_text_for_vector(cfg, text)
    chunk_count = save_book_chunks(cfg, lecture_id, book_id, chunks)

    library = f"lecture_{lecture_id}"
    vector_count = upsert_chunks_to_library(
        cfg,
        library=library,
        material_id=book_id,
        chunks=chunks,
        title=str(book.get("title") or lecture.get("title") or book_id),
        metadata_extra={
            "lecture_id": lecture_id,
            "lecture_title": str(lecture.get("title") or ""),
            "book_id": book_id,
            "book_title": str(book.get("title") or ""),
        },
    )
    now = int(time.time())

    updated_book = update_book(
        cfg,
        lecture_id,
        book_id,
        {
            "vector_status": "done",
            "vector_provider": "nexoradb_service",
            "vector_request_path": "",
            "chunks_count": chunk_count,
            "vector_count": int(vector_count),
            "last_vectorized_at": now,
            "error": "",
        },
    ) or book

    books = [item for item in (get_book(cfg, lecture_id, row["id"]) for row in list_books(cfg, lecture_id)) if item]
    update_lecture(
        cfg,
        lecture_id,
        {
            "vector_count": sum(int(item.get("vector_count") or 0) for item in books),
            "updated_at": now,
        },
    )

    return {
        "success": True,
        "queued": False,
        "status": "done",
        "chunks_count": chunk_count,
        "vector_count": int(vector_count),
        "library": library,
        "book": updated_book,
    }


def queue_vectorize_book(
    cfg: Dict[str, Any],
    lecture_id: str,
    book_id: str,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    """异步排队执行单本教材向量化。"""
    book = get_book(cfg, lecture_id, book_id)
    if book is None:
        raise ValueError(f"Book not found: {lecture_id}/{book_id}")
    with _THREAD_LOCK:
        update_book(cfg, lecture_id, book_id, {"vector_status": "queued", "error": ""})
        threading.Thread(
            target=_vectorize_book_safe,
            args=(dict(cfg), lecture_id, book_id, force),
            daemon=True,
        ).start()
    return {"success": True, "queued": True, "status": "queued"}


def _vectorize_book_safe(cfg: Dict[str, Any], lecture_id: str, book_id: str, force: bool) -> None:
    """后台线程安全包装。"""
    try:
        vectorize_book(cfg, lecture_id, book_id, force=force)
    except Exception as exc:
        update_book(cfg, lecture_id, book_id, {"vector_status": "error", "error": str(exc)})
