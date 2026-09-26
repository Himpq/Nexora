"""执行事件仅落电脑本地；重启后的运行任务明确标记 interrupted。"""
import json
import re
import threading

from core.config import get_app_root
from .ConversationStore import ConversationStore


_LOCK = threading.RLock()
_PROCESS_SESSIONS = set()


class SessionJournal:
    def __init__(self):
        self.root = get_app_root() / "data" / "task_events"

    def path(self, sid, suffix):
        if not re.fullmatch(r"[a-f0-9]{32}", sid):
            raise ValueError("任务 ID 非法")

        return self.root / (sid + suffix)

    def save_meta(self, session):
        metadata = {k: v for k, v in session.items() if k not in {"cond", "chunks"}}

        with _LOCK:
            self.root.mkdir(parents=True, exist_ok=True)
            _PROCESS_SESSIONS.add(metadata["stream_id"])
            ConversationStore._write_json(self.path(metadata["stream_id"], ".json"), metadata)

    def append(self, sid, chunk):
        with _LOCK:
            self.root.mkdir(parents=True, exist_ok=True)

            with self.path(sid, ".jsonl").open("a", encoding="utf-8") as output:
                output.write(json.dumps(chunk, ensure_ascii=False) + "\n")

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
