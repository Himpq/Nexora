import json
import os
import re
import threading
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple


_FILE_LOCK = threading.Lock()


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        if v is None:
            return default
        return int(v)
    except Exception:
        return default


class TempContextStore:
    """
    Ephemeral long-text store for a single reply scope.
    Supports memory mode or file mode.
    """

    def __init__(
        self,
        *,
        username: str,
        scope_id: str,
        storage_mode: str = "memory",
        file_path: str = "",
        expire_seconds: int = 0,
    ) -> None:
        self.username = str(username or "").strip()
        self.scope_id = str(scope_id or "").strip() or uuid.uuid4().hex
        self.storage_mode = "file" if str(storage_mode or "").strip().lower() == "file" else "memory"
        self.expire_seconds = max(0, _safe_int(expire_seconds, 0))
        self.file_path = str(file_path or "").strip()
        self._mem: Dict[str, Dict[str, Any]] = {}

        if self.storage_mode == "file":
            if not self.file_path:
                raise ValueError("file_path is required in file storage mode")
            parent = os.path.dirname(os.path.abspath(self.file_path))
            if parent:
                os.makedirs(parent, exist_ok=True)
            if not os.path.exists(self.file_path):
                self._write_file_entries([])

    def _now(self) -> float:
        return float(time.time())

    def _is_expired(self, entry: Dict[str, Any], now_ts: Optional[float] = None) -> bool:
        if not isinstance(entry, dict):
            return True
        exp = entry.get("expires_at")
        if exp in (None, 0, ""):
            return False
        now_val = self._now() if now_ts is None else float(now_ts)
        try:
            return float(exp) <= now_val
        except Exception:
            return True

    def _make_entry(self, content: str, source_tool: str, meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        now_ts = self._now()
        rid = f"tmp_{uuid.uuid4().hex[:12]}"
        expires_at = None
        if self.expire_seconds > 0:
            expires_at = now_ts + float(self.expire_seconds)
        return {
            "resource_id": rid,
            "username": self.username,
            "scope_id": self.scope_id,
            "source_tool": str(source_tool or "").strip(),
            "created_at": now_ts,
            "expires_at": expires_at,
            "length": len(content or ""),
            "content": str(content or ""),
            "meta": meta if isinstance(meta, dict) else {},
        }

    def _read_file_entries(self) -> List[Dict[str, Any]]:
        with _FILE_LOCK:
            try:
                with open(self.file_path, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                entries = payload.get("entries", []) if isinstance(payload, dict) else []
                return entries if isinstance(entries, list) else []
            except Exception:
                return []

    def _write_file_entries(self, entries: List[Dict[str, Any]]) -> None:
        with _FILE_LOCK:
            payload = {
                "version": 1,
                "updated_at": self._now(),
                "entries": entries if isinstance(entries, list) else [],
            }
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)

    def _list_scope_entries(self, include_expired: bool = False) -> List[Dict[str, Any]]:
        now_ts = self._now()
        if self.storage_mode == "memory":
            arr = list(self._mem.values())
        else:
            arr = self._read_file_entries()
        out: List[Dict[str, Any]] = []
        for item in arr:
            if not isinstance(item, dict):
                continue
            if str(item.get("username") or "") != self.username:
                continue
            if str(item.get("scope_id") or "") != self.scope_id:
                continue
            if (not include_expired) and self._is_expired(item, now_ts):
                continue
            out.append(item)
        out.sort(key=lambda x: float(x.get("created_at") or 0.0))
        return out

    def cache_text(self, content: str, source_tool: str, meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        text = str(content or "")
        entry = self._make_entry(text, source_tool, meta)
        if self.storage_mode == "memory":
            self._mem[entry["resource_id"]] = entry
        else:
            now_ts = self._now()
            all_entries = self._read_file_entries()
            alive: List[Dict[str, Any]] = []
            for item in all_entries:
                if not isinstance(item, dict):
                    continue
                if self._is_expired(item, now_ts):
                    continue
                alive.append(item)
            alive.append(entry)
            self._write_file_entries(alive)
        return {
            "resource_id": entry["resource_id"],
            "length": int(entry["length"]),
            "source_tool": entry["source_tool"],
            "created_at": entry["created_at"],
        }

    def _get_entry(self, resource_id: str) -> Optional[Dict[str, Any]]:
        rid = str(resource_id or "").strip()
        if not rid:
            return None
        if self.storage_mode == "memory":
            item = self._mem.get(rid)
            if not isinstance(item, dict):
                return None
            if self._is_expired(item):
                self._mem.pop(rid, None)
                return None
            return item
        for item in self._list_scope_entries(include_expired=False):
            if str(item.get("resource_id") or "") == rid:
                return item
        return None

    def read(self, resource_id: str, start: int = 0, count: int = 2000) -> Dict[str, Any]:
        item = self._get_entry(resource_id)
        if not item:
            return {"success": False, "message": "resource_id not found or expired"}
        text = str(item.get("content") or "")
        total = len(text)
        s = max(0, min(_safe_int(start, 0), total))
        n = max(1, min(_safe_int(count, 2000), 200000))
        e = max(s, min(total, s + n))
        return {
            "success": True,
            "resource_id": str(item.get("resource_id") or ""),
            "source_tool": str(item.get("source_tool") or ""),
            "start": s,
            "count": n,
            "end": e,
            "total_length": total,
            "content": text[s:e],
        }

    def _char_to_line_col(self, text: str, pos: int) -> Tuple[int, int]:
        p = max(0, min(len(text), int(pos)))
        line = text.count("\n", 0, p) + 1
        last_nl = text.rfind("\n", 0, p)
        if last_nl < 0:
            col = p + 1
        else:
            col = p - last_nl
        return line, col

    def search(
        self,
        *,
        resource_id: Optional[str] = None,
        keyword: Optional[str] = None,
        regex: Optional[str] = None,
        case_sensitive: bool = False,
        range_size: int = 80,
        max_matches: int = 20,
    ) -> Dict[str, Any]:
        rid = str(resource_id or "").strip()
        key = str(keyword or "").strip()
        rgx = str(regex or "").strip()
        if not key and not rgx:
            return {"success": False, "message": "keyword or regex is required"}

        window = max(0, min(_safe_int(range_size, 80), 20000))
        limit = max(1, min(_safe_int(max_matches, 20), 200))
        flags = 0 if case_sensitive else re.IGNORECASE

        if rid:
            entries = [self._get_entry(rid)]
        else:
            entries = self._list_scope_entries(include_expired=False)
        entries = [e for e in entries if isinstance(e, dict)]

        matches: List[Dict[str, Any]] = []
        article_stats: Dict[str, int] = {}

        for entry in entries:
            text = str(entry.get("content") or "")
            this_rid = str(entry.get("resource_id") or "")
            article = str(entry.get("source_tool") or this_rid)
            if rgx:
                try:
                    pattern = re.compile(rgx, flags)
                except Exception as e:
                    return {"success": False, "message": f"invalid regex: {e}"}
                for m in pattern.finditer(text):
                    s, e = m.span()
                    left = max(0, s - window)
                    right = min(len(text), e + window)
                    line, col = self._char_to_line_col(text, s)
                    matches.append({
                        "resource_id": this_rid,
                        "article": article,
                        "start": s,
                        "end": e,
                        "line": line,
                        "col": col,
                        "match": m.group(0),
                        "snippet": text[left:right],
                    })
                    article_stats[article] = article_stats.get(article, 0) + 1
                    if len(matches) >= limit:
                        break
            else:
                hay = text if case_sensitive else text.lower()
                needle = key if case_sensitive else key.lower()
                pos = 0
                while True:
                    found = hay.find(needle, pos)
                    if found < 0:
                        break
                    s = found
                    e = found + len(needle)
                    left = max(0, s - window)
                    right = min(len(text), e + window)
                    line, col = self._char_to_line_col(text, s)
                    matches.append({
                        "resource_id": this_rid,
                        "article": article,
                        "start": s,
                        "end": e,
                        "line": line,
                        "col": col,
                        "match": text[s:e],
                        "snippet": text[left:right],
                    })
                    article_stats[article] = article_stats.get(article, 0) + 1
                    if len(matches) >= limit:
                        break
                    pos = found + max(1, len(needle))
            if len(matches) >= limit:
                break

        articles = [{"article": k, "hits": v} for k, v in article_stats.items()]
        articles.sort(key=lambda x: (-int(x.get("hits") or 0), str(x.get("article") or "")))
        return {
            "success": True,
            "resource_id": rid or None,
            "matched": len(matches),
            "articles": articles,
            "matches": matches,
            "query": {"keyword": key or None, "regex": rgx or None, "case_sensitive": bool(case_sensitive)},
        }

    def list_resources(self) -> Dict[str, Any]:
        items = []
        for e in self._list_scope_entries(include_expired=False):
            items.append({
                "resource_id": str(e.get("resource_id") or ""),
                "source_tool": str(e.get("source_tool") or ""),
                "length": _safe_int(e.get("length"), 0),
                "created_at": e.get("created_at"),
            })
        return {"success": True, "count": len(items), "items": items}

    def clear_scope(self) -> Dict[str, Any]:
        if self.storage_mode == "memory":
            removed = len(self._mem)
            self._mem = {}
            return {"success": True, "removed": removed}
        now_ts = self._now()
        entries = self._read_file_entries()
        kept: List[Dict[str, Any]] = []
        removed = 0
        for item in entries:
            if not isinstance(item, dict):
                continue
            expired = self._is_expired(item, now_ts)
            same_scope = (
                str(item.get("username") or "") == self.username
                and str(item.get("scope_id") or "") == self.scope_id
            )
            if expired or same_scope:
                removed += 1
                continue
            kept.append(item)
        self._write_file_entries(kept)
        return {"success": True, "removed": removed}
