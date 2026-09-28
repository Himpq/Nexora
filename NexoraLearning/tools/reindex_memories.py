"""把存量记忆回填进 NexoraDB 索引（library=memory_<user>）。配好 nexoradb.service_url / api_key 后跑一次。

用法（NexoraLearning 目录）：
    python -X utf8 tools/reindex_memories.py [--username ots20oug] [--data-dir data] [--dry-run]
不带 --username 时遍历 data/users/*/memories/evidence.sqlite3。
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _load_cfg(data_dir: str):
    from main import _apply_environment_overrides  # noqa: WPS433

    path = Path(data_dir) / "config.json"
    cfg = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    cfg["data_dir"] = data_dir
    env_local = Path(".env.local")
    if env_local.is_file():
        for line in env_local.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())
    return _apply_environment_overrides(cfg)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", default="")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    cfg = _load_cfg(args.data_dir)
    from core.memory import memory_index
    from core.memory.evidence_memory import _SELECT, _path, _public, validate_memory_user_id

    if not memory_index.enabled(cfg):
        print(json.dumps({"ok": False, "reason": "nexoradb_not_configured",
                          "service_url": (cfg.get("nexoradb") or {}).get("service_url")}, ensure_ascii=False))
        return 1
    users_root = Path(args.data_dir) / "users"
    if args.username:
        users = [validate_memory_user_id(args.username)]
    elif users_root.is_dir():
        users = sorted(p.name for p in users_root.iterdir() if p.is_dir() and _path(cfg, p.name).is_file())
    else:
        users = []

    report = {}

    for user in users:
        db = _path(cfg, user)
        if not db.is_file():
            report[user] = {"rows": 0, "indexed": 0, "reason": "no_db"}
            continue
        connection = sqlite3.connect(str(db))
        connection.row_factory = sqlite3.Row
        rows = [_public(row) for row in connection.execute(_SELECT).fetchall()]
        connection.close()
        indexed = 0
        if not args.dry_run:
            for row in rows:
                if memory_index.index(cfg, user, row):
                    indexed += 1
        report[user] = {"rows": len(rows), "indexed": indexed, "dry_run": args.dry_run}
    print(json.dumps({"ok": True, "users": report}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
