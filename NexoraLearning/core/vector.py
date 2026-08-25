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
from .runlog import log_event

# NexoraDB 用 username 作为 collection 分区键；
# NexoraLearning 使用固定 username，用 library 区分课程或讲座。
_NEXORA_USERNAME = "nexoralearning"
_THREAD_LOCK = threading.Lock()
_SERVICE_STATE_LOCK = threading.Lock()
_SERVICE_STATE: Dict[str, Dict[str, Any]] = {}
_DEFAULT_UNAVAILABLE_COOLDOWN_SECONDS = 60


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


def _get_service_state_key(cfg: Dict[str, Any]) -> str:
    """按服务地址隔离 NexoraDB 运行状态。"""
    return _get_url(cfg)


def _as_config_bool(value: Any, default: bool = True) -> bool:
    """读取配置布尔值。"""
    if value is None:
        return default

    if isinstance(value, bool):
        return value

    return str(value).strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _get_unavailable_cooldown(cfg: Dict[str, Any]) -> int:
    """读取连接失败后的停用窗口。"""
    db_cfg = cfg.get("nexoradb") or {}

    try:
        value = int(db_cfg.get("unavailable_cooldown_seconds") or _DEFAULT_UNAVAILABLE_COOLDOWN_SECONDS)
    except Exception:
        value = _DEFAULT_UNAVAILABLE_COOLDOWN_SECONDS

    return max(1, value)


def _mark_nexoradb_available(cfg: Dict[str, Any]) -> None:
    """真实请求成功后清除不可用标记。"""
    key = _get_service_state_key(cfg)

    with _SERVICE_STATE_LOCK:
        _SERVICE_STATE.pop(key, None)


def _mark_nexoradb_unavailable(cfg: Dict[str, Any], message: str) -> None:
    """真实请求失败后短暂停用向量流程。"""
    key = _get_service_state_key(cfg)

    with _SERVICE_STATE_LOCK:
        _SERVICE_STATE[key] = {
            "available": False,
            "message": str(message or "NexoraDB 连接失败"),
            "disabled_until": time.time() + _get_unavailable_cooldown(cfg),
        }


def _get_timeout(cfg: Dict[str, Any], default: float) -> float:
    """读取 NexoraDB 请求超时配置。"""
    db_cfg = cfg.get("nexoradb") or {}

    try:
        timeout = float(db_cfg.get("request_timeout") or default)
    except Exception:
        timeout = default

    return max(0.5, timeout)


def _request_json(
    cfg: Dict[str, Any],
    method: str,
    path: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """向 NexoraDB 发起 JSON 请求。"""
    url = f"{_get_url(cfg)}{path}"
    headers: Dict[str, str] = {}
    key = _get_key(cfg)

    if key:
        headers["X-API-Key"] = key

    data = None

    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=_get_timeout(cfg, 30.0) if timeout is None else timeout) as resp:
            body = resp.read().decode("utf-8")
            _mark_nexoradb_available(cfg)
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8")
            return json.loads(body) if body else {"success": False, "message": str(exc)}
        except Exception:
            return {"success": False, "message": str(exc)}
    except Exception as exc:
        message = str(exc)
        _mark_nexoradb_unavailable(cfg, message)
        return {"success": False, "message": message}


def _post(cfg: Dict[str, Any], path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """向 NexoraDB 发起 JSON POST 请求。"""
    return _request_json(cfg, "POST", path, payload=payload)


def get_nexoradb_status(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """读取本地记录的 NexoraDB 运行状态，不发起网络探测。"""
    service_url = _get_url(cfg)
    db_cfg = cfg.get("nexoradb") if isinstance(cfg.get("nexoradb"), dict) else {}

    if "enabled" in db_cfg and not _as_config_bool(db_cfg.get("enabled"), default=True):
        return {
            "available": False,
            "service_url": service_url,
            "message": "NexoraDB 已在配置中关闭",
        }

    key = _get_service_state_key(cfg)
    now = time.time()

    with _SERVICE_STATE_LOCK:
        state = dict(_SERVICE_STATE.get(key) or {})

        if state and now < float(state.get("disabled_until") or 0):
            return {
                "available": False,
                "service_url": service_url,
                "message": str(state.get("message") or "NexoraDB 暂时不可用"),
                "disabled_until": state.get("disabled_until"),
            }

        if state:
            _SERVICE_STATE.pop(key, None)

    return {
        "available": True,
        "service_url": service_url,
        "message": "",
    }


def is_nexoradb_available(cfg: Dict[str, Any]) -> bool:
    """返回 NexoraDB 当前是否可用。"""
    return bool(get_nexoradb_status(cfg).get("available"))


def require_nexoradb_available(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """要求 NexoraDB 已连接，否则停止向量流程。"""
    status = get_nexoradb_status(cfg)

    if not status.get("available"):
        raise RuntimeError(str(status.get("message") or "NexoraDB 未连接，向量检索与向量化已停用"))

    return status


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

    require_nexoradb_available(cfg)

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
    return query_library(
        cfg,
        library=_library(course_id),
        query_text=query_text,
        top_k=top_k,
        material_id=material_id,
    )


def query_lecture(
    cfg: Dict[str, Any],
    lecture_id: str,
    query_text: str,
    top_k: int = 5,
    book_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """检索讲座教材向量，返回 [{text, metadata, distance}]。"""
    return query_library(
        cfg,
        library=f"lecture_{lecture_id}",
        query_text=query_text,
        top_k=top_k,
        material_id=book_id,
    )


def query_library(
    cfg: Dict[str, Any],
    *,
    library: str,
    query_text: str,
    top_k: int = 5,
    material_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """检索指定 NexoraDB library。"""
    require_nexoradb_available(cfg)

    payload: Dict[str, Any] = {
        "username": _NEXORA_USERNAME,
        "text": query_text,
        "top_k": top_k,
        "library": str(library),
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

    require_nexoradb_available(cfg)

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
    require_nexoradb_available(cfg)

    with _THREAD_LOCK:
        update_book(cfg, lecture_id, book_id, {"vector_status": "queued", "error": ""})
        log_event(
            "book_vectorize_queue",
            "教材已加入向量化队列",
            payload={"lecture_id": lecture_id, "book_id": book_id, "force": bool(force)},
        )
        threading.Thread(
            target=_vectorize_book_safe,
            args=(dict(cfg), lecture_id, book_id, force),
            daemon=True,
        ).start()
    return {"success": True, "queued": True, "status": "queued"}


def _vectorize_book_safe(cfg: Dict[str, Any], lecture_id: str, book_id: str, force: bool) -> None:
    """后台线程安全包装。"""
    try:
        result = vectorize_book(cfg, lecture_id, book_id, force=force)
        log_event(
            "book_vectorize_done",
            "教材向量化完成",
            payload={
                "lecture_id": lecture_id,
                "book_id": book_id,
                "chunks_count": int((result or {}).get("chunks_count") or 0),
                "vector_count": int((result or {}).get("vector_count") or 0),
            },
        )
    except Exception as exc:
        update_book(cfg, lecture_id, book_id, {"vector_status": "error", "error": str(exc)})
        log_event(
            "book_vectorize_error",
            "教材向量化失败",
            payload={"lecture_id": lecture_id, "book_id": book_id, "error": str(exc)},
        )
