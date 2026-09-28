"""重建一门课的 outline → mindmap（同步、带备份），修复「图谱与大纲不同步 / 大纲漏书」。

用法（NexoraLearning 目录，读取 data/config.json + .env.local）：
    python -X utf8 tools/rebuild_course_graph.py --lecture l_d5a6224b163f [--mindmap-only] [--dry-run]
完成后打印概念目录按教材的分布，用来确认每本书都有概念。
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _report(cfg, lecture_id: str) -> dict:
    from core.cognition.service import CognitionService
    from core.lectures import list_books

    titles = {str(b.get("id")): str(b.get("title") or "") for b in list_books(cfg, lecture_id)}
    try:
        catalog = CognitionService(cfg).get_catalog(lecture_id)
    except Exception as exc:  # noqa: BLE001
        return {"catalog_error": str(exc)[:300]}
    rows = catalog["concepts"]
    by_book = Counter(str(r.get("book_id") or "") for r in rows)
    return {"concepts": len(rows), "by_book": {titles.get(k, k): v for k, v in by_book.items()},
            "chapters": sorted({(r["book_id"][:8], r["chapter_index"], r["chapter_name"][:16]) for r in rows})}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lecture", required=True)
    parser.add_argument("--mindmap-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rebind-only", action="store_true", help="不生成，只把答题记录重新绑定到当前图谱")
    parser.add_argument("--user", default="system")
    args = parser.parse_args()

    from main import ensure_bootstrap

    cfg = ensure_bootstrap()
    from core.runlog import init_run_logger

    print("event log:", init_run_logger(cfg))
    if args.rebind_only:
        from core.cognition.graph_builder import rebind_evidence_for_lecture

        print("REBIND", json.dumps(rebind_evidence_for_lecture(cfg, args.lecture), ensure_ascii=False))
        print("AFTER", json.dumps({"catalog": _report(cfg, args.lecture)}, ensure_ascii=False))
        return 0
    from core.booksproc.outline import generate_outline, load_outline, outline_coverage_gap
    from core.booksproc.mindmap import generate_mindmap
    from core.cognition.graph_builder import mindmap_is_stale
    from core.lectures import list_books

    lecture_id = args.lecture
    solidified = Path(str(cfg.get("data_dir") or "data")) / "lectures" / lecture_id / "solidified"
    books = list_books(cfg, lecture_id)
    outline = load_outline(cfg, lecture_id)
    before = {
        "outline_gap": outline_coverage_gap(outline.get("sections") or [], books) if outline else "no_outline",
        "mindmap_stale": mindmap_is_stale(cfg, lecture_id),
        "catalog": _report(cfg, lecture_id),
    }
    print("BEFORE", json.dumps(before, ensure_ascii=False))
    if args.dry_run:
        return 0

    stamp = time.strftime("%Y%m%d_%H%M%S")
    for name in ("outline.json", "mindmap.json"):
        path = solidified / name
        if path.is_file():
            shutil.copy2(path, solidified / f"{name}.bak_{stamp}")
    print("backup suffix", stamp)

    started = time.time()
    if not args.mindmap_only:
        print("generating outline ...")
        result = generate_outline(cfg, lecture_id, user_id=args.user, on_status=lambda m: print("  [outline]", m))
        gap = outline_coverage_gap(result.get("sections") or [], books)
        print("outline sections", len(result.get("sections") or []), "gap", gap, f"{time.time() - started:.0f}s")
        if gap["missing"]:
            print("outline still misses books, abort before mindmap")
            return 2
    print("generating mindmap ...")
    mm = generate_mindmap(cfg, lecture_id, user_id=args.user, on_status=lambda m: print("  [mindmap]", m))
    print("mindmap nodes", len(mm.get("nodes") or []), "edges", len(mm.get("edges") or []), f"{time.time() - started:.0f}s")
    from core.cognition.graph_builder import rebind_evidence_for_lecture

    print("REBIND", json.dumps(rebind_evidence_for_lecture(cfg, lecture_id), ensure_ascii=False))
    after = {"mindmap_stale": mindmap_is_stale(cfg, lecture_id), "catalog": _report(cfg, lecture_id)}
    print("AFTER", json.dumps(after, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
