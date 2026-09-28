"""按已核实的记忆 ID 清理误入记忆的机器指令值。

用法（在 NexoraLearning 目录）：
    python -X utf8 tools/retract_machine_memories.py --username ots20oug --memory-id mem_xxx [--dry-run] [--data-dir data]

只有人工核实并明确列出的 ID 才会标为 retracted；同时写入
source_type='system_cleanup' 的 feedback 留痕，不删除任何行。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--memory-id", action="append", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from core.memory.evidence_memory import _path

    path = _path({"data_dir": args.data_dir}, args.username)
    if not path.is_file():
        print(json.dumps({"ok": False, "reason": "no_memory_db", "path": str(path)}, ensure_ascii=False))
        return 0
    connection = sqlite3.connect(str(path), timeout=15)
    connection.row_factory = sqlite3.Row
    rows = connection.execute("SELECT id, kind, key, quote FROM memories WHERE status='active'").fetchall()
    requested_ids = set(args.memory_id)
    targets = [row for row in rows if row["id"] in requested_ids]
    missing_ids = requested_ids - {row["id"] for row in targets}

    if missing_ids:
        connection.close()
        print(json.dumps({"ok": False, "reason": "memory_id_not_active", "ids": sorted(missing_ids)}, ensure_ascii=False))
        return 1
    result = {"ok": True, "username": args.username, "active_before": len(rows),
              "retracted": [{"id": r["id"], "kind": r["kind"], "quote": r["quote"]} for r in targets],
              "dry_run": bool(args.dry_run)}
    if not args.dry_run and targets:
        now = int(time.time())
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            for row in targets:
                source_id = f"cleanup_{row['id']}"
                exists = connection.execute("SELECT 1 FROM sources WHERE source_id=?", (source_id,)).fetchone()
                if not exists:
                    connection.execute("INSERT INTO sources VALUES (?,?,?,?,?,?)",
                                       (source_id, "system", "system_cleanup", "机器指令值不是学生原话", now, now))
                    connection.execute("INSERT OR IGNORE INTO feedback VALUES (?,?,?,?)",
                                       (source_id, row["id"], "disagree", ""))
                connection.execute("UPDATE memories SET status='retracted' WHERE id=?", (row["id"],))
    connection.close()
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
