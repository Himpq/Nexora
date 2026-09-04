"""把已有的长教材（达梦《数据库管理系统中级（备份还原）》，24 万字 EPUB）挂到演示账号上。

用途：书房 / 阅读器只用 seed_demo 的 439 字合成教材验证不了长文翻页、目录、进度与划线持久化。
这本书的 bookinfo.xml 为空（精读管线未跑），/index 会退化成单章「参考文献」。本工具用 EPUB
自带的 chapterTitle 标记按「任务」切章，写出 bookinfo.xml（raw 坐标 START:LENGTH），
使阅读器拿到 7 章真实目录，然后把课程加入演示账号的已选课程。幂等，可重复运行。

    python tools/attach_demo_long_book.py [--username demo_student] [--lecture l_d80300f15836] [--book b_bcc51fd12d17]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import List, Tuple

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.user import user as user_store  # noqa: E402
from core.bookindex.service import invalidate_book_index, get_book_index  # noqa: E402

CHAPTER_TITLE_RE = re.compile(r'<p[^>]*class="chapterTitle"[^>]*>(.*?)</p>', re.S)
# 保留：参考文献（EPUB 里排在最前，占住开头的 XML 壳，否则会并进「前言」）、前言、项目背景、任务 1–4、附录；封面/书名页/目录不当章节。
KEEP_PREFIX = ("参考文献", "前言", "项目背景", "任务", "附录")


def _clean(title: str) -> str:
    text = re.sub(r"<[^>]+>", "", title)
    text = text.replace("　", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def build_chapters(raw: str) -> List[Tuple[str, int, int]]:
    marks: List[Tuple[int, str]] = []
    for match in CHAPTER_TITLE_RE.finditer(raw):
        title = _clean(match.group(1))
        if title.startswith(KEEP_PREFIX):
            marks.append((match.start(), title))
    chapters: List[Tuple[str, int, int]] = []
    for i, (start, title) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(raw)
        if end - start > 0:
            chapters.append((title, start, end))
    return chapters


def write_bookinfo(book_dir: Path, chapters: List[Tuple[str, int, int]]) -> Path:
    parts = ["<book>"]
    for title, start, end in chapters:
        parts.append(
            f"<chapter><chapter_name>{title}</chapter_name><chapter_range>{start}:{end - start}</chapter_range></chapter>"
        )
    parts.append("</book>")
    path = book_dir / "bookinfo.xml"
    path.write_text("".join(parts), encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="把长教材挂到演示账号")
    parser.add_argument("--username", default="demo_student")
    parser.add_argument("--lecture", default="l_d80300f15836")
    parser.add_argument("--book", default="b_bcc51fd12d17")
    args = parser.parse_args()

    from main import ensure_bootstrap

    cfg = ensure_bootstrap()
    book_dir = ROOT / "data" / "lectures" / args.lecture / "books" / args.book
    text_path = book_dir / "text" / "content.txt"
    if not text_path.is_file():
        print(f"[attach] 找不到正文 {text_path}")
        return 1
    raw = text_path.read_text(encoding="utf-8")
    chapters = build_chapters(raw)
    if len(chapters) < 3:
        print(f"[attach] 只识别到 {len(chapters)} 章，放弃写入")
        return 1
    path = write_bookinfo(book_dir, chapters)
    invalidate_book_index(cfg, args.lecture, args.book)
    index = get_book_index(cfg, args.lecture, args.book)
    user_store.ensure_user_files(cfg, args.username)
    if args.lecture not in set(user_store.list_selected_lecture_ids(cfg, args.username)):
        user_store.set_lecture_selection(cfg, args.username, args.lecture, selected=True, actor="attach_demo_long_book")
    print(f"[attach] 已写 {path}（{len(chapters)} 章），课程 {args.lecture} 已加入 {args.username} 的已选课程")
    for chapter in index.chapters:
        print(f"         #{chapter.index} {chapter.title}  {chapter.length} 字 / {chapter.paragraph_end - chapter.paragraph_start + 1} 段")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
