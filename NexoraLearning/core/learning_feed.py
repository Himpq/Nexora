"""Learning feed storage helpers."""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

_LOCK = threading.Lock()


def _data_dir(cfg: Mapping[str, Any]) -> Path:
    return Path(str((cfg or {}).get("data_dir") or "data"))


def _feed_path(cfg: Mapping[str, Any]) -> Path:
    return _data_dir(cfg) / "learning_feeds.jsonl"


def ensure_learning_feed_file(cfg: Mapping[str, Any]) -> Path:
    path = _feed_path(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("", encoding="utf-8")
    return path


def _normalize_feed_author(author: Any, fallback_user_id: str = "") -> Dict[str, str]:
    raw = author if isinstance(author, Mapping) else {}
    user_id = str(raw.get("user_id") or raw.get("username") or fallback_user_id or "").strip()
    if not user_id:
        return {}
    return {"user_id": user_id}


def _normalize_feed_comment(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, Mapping):
        return None
    content = str(raw.get("content") or "").strip()
    if not content:
        return None
    comment_id = str(raw.get("id") or f"comment_{uuid.uuid4().hex[:12]}").strip()
    timestamp = int(raw.get("timestamp") or time.time())
    author = _normalize_feed_author(raw.get("author"), str(raw.get("username") or "").strip())
    user_id = str(author.get("user_id") or raw.get("username") or "").strip()
    if not user_id:
        return None
    return {
        "id": comment_id,
        "timestamp": timestamp,
        "username": user_id,
        "author": author,
        "content": content,
    }


def _normalize_feed_record(raw: Mapping[str, Any]) -> Dict[str, Any]:
    payload = dict(raw or {})
    user_id = str(payload.get("username") or payload.get("user_id") or "").strip()
    payload["author"] = _normalize_feed_author(payload.get("author"), user_id)
    comments = payload.get("comments")
    if isinstance(comments, list):
        normalized_comments = [item for item in (_normalize_feed_comment(row) for row in comments) if isinstance(item, dict)]
    else:
        normalized_comments = []
    payload["comments"] = normalized_comments
    payload["comments_count"] = len(normalized_comments)
    liked_user_ids = payload.get("liked_user_ids")
    if isinstance(liked_user_ids, list):
        normalized_likes = [str(item or "").strip() for item in liked_user_ids if str(item or "").strip()]
    else:
        normalized_likes = []
    payload["liked_user_ids"] = normalized_likes
    payload["likes_count"] = len(normalized_likes)
    return payload


def prepend_learning_feed_item(cfg: Mapping[str, Any], record: Mapping[str, Any]) -> Dict[str, Any]:
    path = ensure_learning_feed_file(cfg)
    payload = _normalize_feed_record(record or {})
    payload.setdefault("id", f"feed_{uuid.uuid4().hex[:12]}")
    payload.setdefault("timestamp", int(time.time()))
    serialized = json.dumps(payload, ensure_ascii=False) + "\n"
    with _LOCK:
        previous = path.read_text(encoding="utf-8") if path.exists() else ""
        path.write_text(serialized + previous, encoding="utf-8")
    return payload


def list_learning_feed_items(cfg: Mapping[str, Any], *, limit: int = 200) -> List[Dict[str, Any]]:
    path = ensure_learning_feed_file(cfg)
    rows: List[Dict[str, Any]] = []
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            raw_line = str(raw_line or "").strip()
            if not raw_line:
                continue
            try:
                row = json.loads(raw_line)
            except Exception:
                continue
            if isinstance(row, dict):
                rows.append(_normalize_feed_record(row))
            if len(rows) >= max(1, int(limit or 200)):
                break
    except Exception:
        return []
    return rows


def update_learning_feed_item(cfg: Mapping[str, Any], feed_id: str, updater) -> Optional[Dict[str, Any]]:
    target_id = str(feed_id or "").strip()
    if not target_id:
        return None
    path = ensure_learning_feed_file(cfg)
    with _LOCK:
        rows: List[Dict[str, Any]] = []
        updated: Optional[Dict[str, Any]] = None
        try:
            raw_lines = path.read_text(encoding="utf-8").splitlines()
        except Exception:
            raw_lines = []
        for raw_line in raw_lines:
            raw_line = str(raw_line or "").strip()
            if not raw_line:
                continue
            try:
                row = json.loads(raw_line)
            except Exception:
                continue
            if not isinstance(row, dict):
                continue
            if str(row.get("id") or "").strip() == target_id:
                next_row = updater(dict(row))
                if isinstance(next_row, dict):
                    row = _normalize_feed_record(next_row)
                    updated = row
            rows.append(row)
        path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
        return updated


def toggle_learning_feed_like(cfg: Mapping[str, Any], feed_id: str, username: str) -> Optional[Dict[str, Any]]:
    actor = str(username or "").strip()
    if not actor:
        return None

    def _updater(row: Dict[str, Any]) -> Dict[str, Any]:
        liked_user_ids = row.get("liked_user_ids")
        if not isinstance(liked_user_ids, list):
            liked_user_ids = []
        normalized = [str(item or "").strip() for item in liked_user_ids if str(item or "").strip()]
        if actor in normalized:
            normalized = [item for item in normalized if item != actor]
        else:
            normalized.append(actor)
        row["liked_user_ids"] = normalized
        row["likes_count"] = len(normalized)
        return row

    return update_learning_feed_item(cfg, feed_id, _updater)


def append_learning_feed_comment(
    cfg: Mapping[str, Any],
    feed_id: str,
    username: str,
    comment: Mapping[str, Any],
) -> Optional[Dict[str, Any]]:
    actor = str(username or "").strip()
    if not actor:
        return None
    payload = dict(comment or {})
    payload["id"] = str(payload.get("id") or f"comment_{uuid.uuid4().hex[:12]}").strip()
    payload["username"] = str(payload.get("username") or actor).strip() or actor
    payload["timestamp"] = int(payload.get("timestamp") or time.time())

    def _updater(row: Dict[str, Any]) -> Dict[str, Any]:
        comments = row.get("comments")
        if not isinstance(comments, list):
            comments = []
        normalized = _normalize_feed_comment(payload)
        if not normalized:
            return row
        comments.append(normalized)
        row["comments"] = comments
        row["comments_count"] = len(comments)
        return row

    return update_learning_feed_item(cfg, feed_id, _updater)


def delete_learning_feed_item(cfg: Mapping[str, Any], feed_id: str) -> bool:
    target_id = str(feed_id or "").strip()
    if not target_id:
        return False
    path = ensure_learning_feed_file(cfg)
    removed = False
    with _LOCK:
        rows: List[Dict[str, Any]] = []
        try:
            raw_lines = path.read_text(encoding="utf-8").splitlines()
        except Exception:
            raw_lines = []
        for raw_line in raw_lines:
            raw_line = str(raw_line or "").strip()
            if not raw_line:
                continue
            try:
                row = json.loads(raw_line)
            except Exception:
                continue
            if not isinstance(row, dict):
                continue
            if str(row.get("id") or "").strip() == target_id:
                removed = True
                continue
            rows.append(_normalize_feed_record(row))
        path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    return removed


def delete_learning_feed_comment(cfg: Mapping[str, Any], feed_id: str, comment_id: str) -> Optional[Dict[str, Any]]:
    target_comment_id = str(comment_id or "").strip()
    if not target_comment_id:
        return None

    def _updater(row: Dict[str, Any]) -> Dict[str, Any]:
        comments = row.get("comments")
        if not isinstance(comments, list):
            return row
        next_comments = []
        removed = False
        for comment in comments:
            if not isinstance(comment, dict):
                continue
            if str(comment.get("id") or "").strip() == target_comment_id:
                removed = True
                continue
            next_comments.append(comment)
        if not removed:
            return row
        row["comments"] = next_comments
        row["comments_count"] = len(next_comments)
        return row

    return update_learning_feed_item(cfg, feed_id, _updater)
