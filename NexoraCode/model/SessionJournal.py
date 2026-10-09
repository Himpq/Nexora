"""执行事件仅落电脑本地；重启后的运行任务明确标记 interrupted。"""
import json
import re
import threading
import time

from core.config import get_app_root
from .ConversationStore import write_json_atomic


_LOCK = threading.RLock()
_PROCESS_SESSIONS = set()

# 事件与任务去重记录的保留策略：按天过期 + 条数封顶，两者都触发才清理。
# 事件日志的用途是断线后续读与重启后回放，一周足够；任务去重记录删除后，
# 同一个 request_id 的重试会被当成新任务，所以保留期与事件一致。
RETENTION_DAYS = 7
MAX_JOURNAL_FILES = 500


class SessionJournal:
    def __init__(self):
        self.root = get_app_root() / "data" / "task_events"

    def path(self, sid, suffix):
        if not re.fullmatch(r"[a-f0-9]{32}", sid):
            raise ValueError("任务 ID 非法")

        return self.root / (sid + suffix)

    def save_meta(self, session):
        metadata = {k: v for k, v in session.items() if k not in {"cond", "chunks", "_request_message"}}

        with _LOCK:
            self.root.mkdir(parents=True, exist_ok=True)
            _PROCESS_SESSIONS.add(metadata["stream_id"])
            write_json_atomic(self.path(metadata["stream_id"], ".json"), metadata)

    def append(self, sid, chunks):
        """批量追加事件。调用方负责攒批，这里只做一次打开与写盘。"""
        if not chunks:
            return

        with _LOCK:
            self.root.mkdir(parents=True, exist_ok=True)
            payload = "".join(json.dumps(chunk, ensure_ascii=False) + "\n" for chunk in chunks)

            with self.path(sid, ".jsonl").open("a", encoding="utf-8") as output:
                output.write(payload)

    def read(self, sid, after, limit):
        with _LOCK:
            path = self.path(sid, ".json")

            if not path.exists():
                return [], None

            metadata = json.loads(path.read_text(encoding="utf-8"))

            if sid not in _PROCESS_SESSIONS and metadata["status"] in {"running", "cancelling"}:
                metadata.update(status="interrupted", stage="interrupted", error="电脑进程已重启，任务未自动重跑")

            chunks = []
            events = self.path(sid, ".jsonl")

            if events.exists() and limit > 0:
                with events.open(encoding="utf-8") as source:
                    for line in source:
                        chunk = json.loads(line)

                        metadata["last_seq"] = max(int(metadata.get("last_seq", 0)), chunk["_stream_seq"])

                        if chunk["_stream_seq"] > after and len(chunks) < limit:
                            chunks.append(chunk)

            return chunks, metadata

    def recent_files(self, limit):
        """按修改时间倒序返回事件元数据文件，条数受 limit 约束。

        任务列表不能无界扫描整个目录：电脑连续运行数月后目录里会积累上万文件。
        """
        if not self.root.exists():
            return []

        with _LOCK:
            metas = [path for path in self.root.glob("*.json")]

        if len(metas) <= limit:
            return metas

        return sorted(metas, key=lambda path: path.stat().st_mtime, reverse=True)[:limit]

    def purge_expired(self, retention_days=RETENTION_DAYS, max_files=MAX_JOURNAL_FILES):
        """删除过期或超出上限的事件日志，返回被删除的任务 id 集合。"""
        if not self.root.exists():
            return set()

        removed = set()
        deadline = time.time() - max(0, int(retention_days)) * 86400

        with _LOCK:
            metas = [path for path in self.root.glob("*.json")
                     if path.stem not in _PROCESS_SESSIONS]
            # 运行中的任务永远不删，否则续读会直接 404。
            survivors = sorted(
                (path for path in metas if path.stat().st_mtime >= deadline),
                key=lambda path: path.stat().st_mtime,
                reverse=True,
            )
            expired = {path.stem for path in metas if path.stat().st_mtime < deadline}
            overflow = {path.stem for path in survivors[max(0, int(max_files)):]}

            for sid in expired | overflow:
                for suffix in (".json", ".jsonl"):
                    self.path(sid, suffix).unlink(missing_ok=True)

                removed.add(sid)

        return removed
