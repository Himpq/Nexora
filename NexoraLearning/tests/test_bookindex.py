"""Tests for canonical book text normalization and structure indexing.

These cover the four structural defects the bookindex package exists to fix:
  1. raw HTML offsets vs. rendered plain-text offsets;
  2. EPUB body assembled in filename order instead of spine order;
  3. catalogue metadata written into the body text;
  4. unvalidated chapter ranges and silent whole-book fallbacks.
"""

from __future__ import annotations

import unittest
import zipfile
from bisect import bisect_left
from pathlib import Path
from tempfile import TemporaryDirectory

from core.bookextract.epub_extract import (
    _iter_epub_spine_documents,
    extract_epub_with_assets,
)
from core.bookindex import (
    build_book_index,
    normalize_book_text,
    parse_bookinfo_chapters,
    parse_range,
)
from core.bookindex.service import get_book_index, resolve_chapter, search_book


def _chapters_xml(rows) -> str:
    parts = ["<chapters>"]
    for name, start, length in rows:
        parts.append(
            "<chapter>"
            f"<chapter_name>{name}</chapter_name>"
            f"<chapter_range>{start}:{length}</chapter_range>"
            "<chapter_summary>摘要</chapter_summary>"
            "</chapter>"
        )
    parts.append("</chapters>")
    return "".join(parts)


def _html_body(paragraph_count: int = 40) -> str:
    blocks = "".join(
        f"<p>第{index}段落，这是一段用于测试的正文内容。</p>" for index in range(1, paragraph_count + 1)
    )
    return f"<html><head><title>不该出现在正文</title></head><body>{blocks}</body></html>"


class NormalizeBookTextTests(unittest.TestCase):
    def test_strips_markup_and_metadata(self):
        raw = (
            "[EPUB_HEADING_CANDIDATES]\n- 第一章\n- 第二章\n[/EPUB_HEADING_CANDIDATES]\n\n"
            "<html><head><title>元数据标题</title></head><body>"
            "<h2>第一章 引论</h2><p>正文第一段。</p>"
            "<script>var a = 1;</script><style>p{color:red}</style>"
            "<p>正文第二段 &amp; 收尾。</p></body></html>"
        )
        result = normalize_book_text(raw)
        self.assertNotIn("[EPUB_HEADING_CANDIDATES]", result.plain)
        self.assertNotIn("元数据标题", result.plain)
        self.assertNotIn("var a = 1", result.plain)
        self.assertNotIn("color:red", result.plain)
        self.assertNotIn("<p>", result.plain)
        self.assertIn("第一章 引论", result.plain)
        self.assertIn("正文第二段 & 收尾。", result.plain)

    def test_paragraph_split_matches_plain_text(self):
        """The browser re-derives paragraphs by splitting on a blank line."""
        result = normalize_book_text(_html_body(12))
        self.assertEqual(
            result.plain.split("\n\n"),
            [para.text for para in result.paragraphs],
        )
        for para in result.paragraphs:
            self.assertEqual(result.plain[para.start:para.end], para.text)

    def test_offset_mapping_is_exact_and_monotonic(self):
        result = normalize_book_text(_html_body(30))
        self.assertGreater(result.raw_length, result.length)
        for para in result.paragraphs:
            raw_offset = result.to_raw(para.start)
            self.assertEqual(result.to_plain(raw_offset), para.start)
            self.assertEqual(result.paragraph_index_at(para.start), para.index)

    def test_offset_mapping_is_exact_mid_paragraph(self):
        """Annotations and search hits land inside paragraphs, not on their edges.

        Regression guard: an earlier run-compressed map only resolved offsets
        that happened to start a run, so every mid-paragraph offset snapped to
        the wrong position.
        """
        result = normalize_book_text(_html_body(20))
        failures = [
            position
            for position in range(result.length)
            if result.plain[position] != "\n"
            and result.to_plain(result.to_raw(position)) != position
        ]
        self.assertEqual(failures, [], f"{len(failures)} content offsets failed to round-trip")

    def test_to_plain_returns_first_surviving_char_at_or_after_offset(self):
        result = normalize_book_text(_html_body(10))
        sources = list(result._raw_at)
        for raw_offset in range(1, result.raw_length + 3):
            expected = bisect_left(sources, raw_offset)
            self.assertEqual(
                result.to_plain(raw_offset),
                expected,
                f"to_plain({raw_offset}) disagreed with the definition",
            )

    def test_offset_inside_dropped_markup_snaps_forward(self):
        raw = "<p>甲段落</p><p>乙段落</p>"
        result = normalize_book_text(raw)
        self.assertEqual(result.plain, "甲段落\n\n乙段落")
        # Offset pointing at the "</p><p>" boundary must resolve to 乙段落.
        boundary = raw.index("</p><p>") + 2
        self.assertEqual(result.paragraph_index_at(result.to_plain(boundary)), 1)

    def test_heading_paragraphs_are_tagged(self):
        result = normalize_book_text("<h1>总纲</h1><p>正文。</p><h3>小节</h3><p>更多正文。</p>")
        kinds = [(para.kind, para.heading_level) for para in result.paragraphs]
        self.assertEqual(kinds[0], ("heading", 1))
        self.assertEqual(kinds[1], ("text", 0))
        self.assertEqual(kinds[2], ("heading", 3))

    def test_image_tokens_survive_as_standalone_paragraphs(self):
        raw = "<p>前文</p>{{nxl_image:l_1:b_1:img_0001:插图}}<p>后文</p>"
        result = normalize_book_text(raw)
        image_paragraphs = [para for para in result.paragraphs if para.kind == "image"]
        self.assertEqual(len(image_paragraphs), 1)
        self.assertEqual(image_paragraphs[0].text, "{{nxl_image:l_1:b_1:img_0001:插图}}")

    def test_zero_width_characters_do_not_shift_offsets(self):
        result = normalize_book_text("﻿<p>正文内容</p>")
        self.assertEqual(result.plain, "正文内容")

    def test_empty_input(self):
        result = normalize_book_text("")
        self.assertEqual(result.plain, "")
        self.assertEqual(result.paragraphs, [])
        self.assertEqual(result.to_plain(100), 0)


class ParseRangeTests(unittest.TestCase):
    def test_valid_and_invalid_ranges(self):
        self.assertEqual(parse_range("120:340"), (120, 340))
        self.assertEqual(parse_range(" 5 : 6 "), (5, 6))
        self.assertEqual(parse_range("bad"), (0, 0))
        self.assertEqual(parse_range("-1:5"), (0, 0))
        self.assertEqual(parse_range(None), (0, 0))

    def test_parse_bookinfo_chapters_reads_stored_coordinates(self):
        rows = parse_bookinfo_chapters(_chapters_xml([("第一章", 0, 100), ("第二章", 100, 200)]))
        self.assertEqual([row["title"] for row in rows], ["第一章", "第二章"])
        self.assertEqual(rows[1]["raw_start"], 100)
        self.assertEqual(rows[1]["raw_length"], 200)


class BuildBookIndexTests(unittest.TestCase):
    def setUp(self):
        self.raw = _html_body(60)
        self.total = normalize_book_text(self.raw).length

    def _index(self, rows):
        return build_book_index(raw_text=self.raw, bookinfo_xml=_chapters_xml(rows) if rows else "")

    def _assert_tiles(self, index):
        self.assertTrue(index.chapters)
        self.assertEqual(index.chapters[0].start, 0)
        self.assertEqual(index.chapters[-1].end, index.total_chars)
        for previous, current in zip(index.chapters, index.chapters[1:]):
            self.assertEqual(previous.end, current.start)

    def test_offsets_are_remapped_into_plain_space(self):
        index = self._index([("第一章", 0, 900), ("第二章", 900, 900)])
        self.assertEqual(index.coordinate_space, "plain")
        self.assertLess(index.total_chars, index.raw_chars)
        for chapter in index.chapters:
            self.assertLessEqual(chapter.end, index.total_chars)
        self._assert_tiles(index)

    def test_overlapping_chapters_are_truncated_and_reported(self):
        index = self._index([("A", 0, 900), ("B", 600, 900), ("C", 1400, 900)])
        self._assert_tiles(index)
        self.assertIn("chapter_overlap", [row["code"] for row in index.diagnostics])

    def test_gaps_are_filled_so_no_text_is_unreachable(self):
        index = self._index([("A", 300, 300), ("C", 1800, 400)])
        self._assert_tiles(index)
        codes = [row["code"] for row in index.diagnostics]
        self.assertTrue({"chapter_gap_filled", "chapter_gap_absorbed"} & set(codes))

    def test_out_of_range_chapter_is_dropped_with_error(self):
        index = self._index([("A", 0, 900), ("B", 10_000_000, 500)])
        self.assertIn("chapter_out_of_range", [row["code"] for row in index.diagnostics])
        self.assertNotIn("B", [chapter.title for chapter in index.chapters])
        self._assert_tiles(index)

    def test_invalid_range_and_missing_title_are_skipped(self):
        index = self._index([("A", 0, 0), ("", 100, 200), ("B", 300, 900)])
        codes = [row["code"] for row in index.diagnostics]
        self.assertIn("chapter_invalid_range", codes)
        self.assertIn("chapter_missing_title", codes)
        self._assert_tiles(index)

    def test_missing_bookinfo_falls_back_to_single_chapter(self):
        index = self._index([])
        self.assertEqual(len(index.chapters), 1)
        self.assertTrue(index.chapters[0].synthetic)
        self._assert_tiles(index)

    def test_chapter_boundaries_align_to_paragraphs(self):
        index = self._index([("A", 0, 777), ("B", 777, 1200)])
        starts = {para.start for para in index.paragraphs}
        for chapter in index.chapters:
            self.assertIn(chapter.start, starts | {0})

    def test_sessions_are_mapped_and_cover_their_chapter(self):
        sections = (
            "<sections><chapter_sessions>"
            "<chapter_name>A</chapter_name><chapter_range>0:900</chapter_range>"
            "<session_items>"
            "<session_item><session_index>1</session_index><session_name>S1</session_name>"
            "<session_range>0:400</session_range><session_summary>前半</session_summary></session_item>"
            "<session_item><session_index>2</session_index><session_name>S2</session_name>"
            "<session_range>400:500</session_range><session_summary>后半</session_summary></session_item>"
            "</session_items></chapter_sessions></sections>"
        )
        index = build_book_index(
            raw_text=self.raw,
            bookinfo_xml=_chapters_xml([("A", 0, 900), ("B", 900, 900)]),
            sections_xml=sections,
        )
        chapter = index.chapter_by_title("A")
        self.assertIsNotNone(chapter)
        self.assertEqual(len(chapter.sessions), 2)
        self.assertEqual(chapter.sessions[0].start, chapter.start)
        self.assertEqual(chapter.sessions[-1].end, chapter.end)
        for previous, current in zip(chapter.sessions, chapter.sessions[1:]):
            self.assertEqual(previous.end, current.start)

    def test_orphaned_sessions_are_reported(self):
        sections = (
            "<sections><chapter_sessions>"
            "<chapter_name>不存在的章节</chapter_name><chapter_range>0:100</chapter_range>"
            "<session_items><session_item><session_name>S</session_name>"
            "<session_range>0:100</session_range></session_item></session_items>"
            "</chapter_sessions></sections>"
        )
        index = build_book_index(
            raw_text=self.raw,
            bookinfo_xml=_chapters_xml([("A", 0, 900)]),
            sections_xml=sections,
        )
        self.assertIn("sessions_orphaned", [row["code"] for row in index.diagnostics])

    def test_annotations_bind_to_chapter_and_paragraph(self):
        annotations = (
            "<annotations><annotation>"
            "<chapter_name>A</chapter_name><offset>200</offset><length>10</length>"
            "<annotation_type>思考点</annotation_type>"
            "<annotation_content>想一想</annotation_content>"
            "<anchor_text>第5段落</anchor_text>"
            "</annotation></annotations>"
        )
        index = build_book_index(
            raw_text=self.raw,
            bookinfo_xml=_chapters_xml([("A", 0, 900), ("B", 900, 900)]),
            annotations_xml=annotations,
        )
        self.assertEqual(len(index.annotations), 1)
        annotation = index.annotations[0]
        self.assertEqual(annotation.chapter_index, 0)
        self.assertGreaterEqual(annotation.paragraph_index, 0)
        # anchor_text wins over a stale offset, and lands on the anchored text.
        self.assertEqual(annotation.bound_by, "anchor_text")
        self.assertIn("第5段落", index.paragraphs[annotation.paragraph_index].text)

    def test_annotation_offset_is_clamped_into_its_chapter(self):
        annotations = (
            "<annotations><annotation>"
            "<chapter_name>B</chapter_name><offset>0</offset>"
            "<annotation_content>越界批注</annotation_content>"
            "</annotation></annotations>"
        )
        index = build_book_index(
            raw_text=self.raw,
            bookinfo_xml=_chapters_xml([("A", 0, 900), ("B", 900, 900)]),
            annotations_xml=annotations,
        )
        annotation = index.annotations[0]
        chapter = index.chapters[annotation.chapter_index]
        self.assertGreaterEqual(annotation.offset, chapter.start)
        self.assertLess(annotation.offset, chapter.end)


class EpubReadingOrderTests(unittest.TestCase):
    def _build_epub(self, path: Path) -> None:
        opf = """<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover" href="cov.html" media-type="application/xhtml+xml"/>
    <item id="toc" href="toc.html" media-type="application/xhtml+xml"/>
    <item id="ch1" href="txt1.html" media-type="application/xhtml+xml"/>
    <item id="ch2" href="txt2.html" media-type="application/xhtml+xml"/>
    <item id="ch10" href="txt10.html" media-type="application/xhtml+xml"/>
    <item id="app" href="att.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
    <itemref idref="toc"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch10"/>
    <itemref idref="app"/>
  </spine>
</package>"""
        toc_links = "".join(f'<a href="txt{i}.html">目录条目{i}</a>' for i in range(1, 14))
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr(
                "META-INF/container.xml",
                '<?xml version="1.0"?><container><rootfiles>'
                '<rootfile full-path="OPS/content.opf"/></rootfiles></container>',
            )
            zf.writestr("OPS/content.opf", opf)
            zf.writestr("OPS/toc.ncx", "<ncx><navMap><navPoint><navLabel><text>第一章</text>"
                                       "</navLabel></navPoint></navMap></ncx>")
            zf.writestr("OPS/cov.html", "<html><body><p>封面页</p></body></html>")
            zf.writestr("OPS/toc.html", f"<html><body>{toc_links}</body></html>")
            zf.writestr("OPS/txt1.html", "<html><body><p>正文第一章内容</p></body></html>")
            zf.writestr("OPS/txt2.html", "<html><body><p>正文第二章内容</p></body></html>")
            zf.writestr("OPS/txt10.html", "<html><body><p>正文第十章内容</p></body></html>")
            zf.writestr("OPS/att.html", "<html><body><p>附录参考文献</p></body></html>")

    def test_spine_order_is_used_not_filename_order(self):
        with TemporaryDirectory() as tmp:
            epub = Path(tmp) / "book.epub"
            self._build_epub(epub)
            with zipfile.ZipFile(epub) as zf:
                documents = _iter_epub_spine_documents(zf)
            order = [Path(doc.name).name for doc in documents]
        self.assertEqual(order, ["cov.html", "toc.html", "txt1.html", "txt2.html", "txt10.html", "att.html"])
        # Filename sorting would have put the appendix first and txt10 before txt2.
        self.assertNotEqual(order, sorted(order))

    def test_navigation_pages_are_excluded_from_body(self):
        with TemporaryDirectory() as tmp:
            epub = Path(tmp) / "book.epub"
            self._build_epub(epub)
            result = extract_epub_with_assets(
                str(epub), lecture_id="l_1", book_id="b_1", assets_dir=Path(tmp) / "assets"
            )
        text = result["text"]
        self.assertNotIn("目录条目1", text)
        self.assertNotIn("[EPUB_HEADING_CANDIDATES]", text)
        self.assertIn("封面页", text)
        self.assertIn("附录参考文献", text)
        # Reading order preserved: appendix comes after chapter text.
        self.assertLess(text.index("正文第一章内容"), text.index("附录参考文献"))
        self.assertLess(text.index("正文第二章内容"), text.index("正文第十章内容"))
        skipped = [row["document"] for row in result["structure"]["skipped_documents"]]
        self.assertTrue(any(name.endswith("toc.html") for name in skipped))

    def test_heading_candidates_go_to_the_sidecar(self):
        with TemporaryDirectory() as tmp:
            epub = Path(tmp) / "book.epub"
            self._build_epub(epub)
            result = extract_epub_with_assets(
                str(epub), lecture_id="l_1", book_id="b_1", assets_dir=Path(tmp) / "assets"
            )
        candidates = result["structure"]["heading_candidates"]
        # The NCX outline reaches the sidecar...
        self.assertIn("第一章", candidates)
        # ...and the body text starts with real prose, not a metadata block.
        self.assertTrue(result["text"].lstrip().startswith("<html>"))
        self.assertNotIn("[EPUB_HEADING_CANDIDATES]", result["text"])
        # A body offset of 0 must therefore point at the first spine document.
        normalized = normalize_book_text(result["text"])
        self.assertEqual(normalized.paragraphs[0].text, "封面页")

    def test_xml_xhtml_spine_document_is_extracted(self):
        with TemporaryDirectory() as tmp:
            epub = Path(tmp) / "xml-body.epub"
            opf = """<package><manifest>
<item id="chapter" href="chapter.xml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref="chapter"/></spine></package>"""
            with zipfile.ZipFile(epub, "w") as zf:
                zf.writestr(
                    "META-INF/container.xml",
                    '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>',
                )
                zf.writestr("OPS/content.opf", opf)
                zf.writestr(
                    "OPS/chapter.xml",
                    '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>XML 正文内容</p></body></html>',
                )

            result = extract_epub_with_assets(
                str(epub), lecture_id="l_xml", book_id="b_xml", assets_dir=Path(tmp) / "assets"
            )

        self.assertIn("XML 正文内容", result["text"])
        self.assertTrue(any(row["document"].endswith("chapter.xml") for row in result["structure"]["documents"]))

    def test_parse_endpoint_persists_epub_structure_sidecar(self):
        from flask import Flask

        from api import routes
        from core.lectures import (
            create_book,
            create_lecture,
            load_book_structure,
            save_book_original_file,
        )

        with TemporaryDirectory() as tmp:
            cfg = {"data_dir": str(Path(tmp) / "data")}
            lecture = create_lecture(cfg, "EPUB 课程")
            book = create_book(cfg, lecture["id"], "EPUB 教材")
            epub = Path(tmp) / "book.epub"
            self._build_epub(epub)
            save_book_original_file(
                cfg,
                lecture["id"],
                book["id"],
                epub.read_bytes(),
                filename="book.epub",
            )
            routes._cfg.clear()
            routes._cfg.update(cfg)
            routes._refresh_route_module_context()
            app = Flask(__name__)
            app.register_blueprint(routes.bp)

            response = app.test_client().post(
                f"/api/lectures/{lecture['id']}/books/{book['id']}/parse"
            )

            self.assertEqual(response.status_code, 200)
            structure = load_book_structure(cfg, lecture["id"], book["id"])
            self.assertIn("第一章", structure.get("heading_candidates", []))
            self.assertTrue(structure.get("documents"))


class ChapterResolutionTests(unittest.TestCase):
    def _seed(self, tmp: str):
        from core.lectures import (
            create_book,
            create_lecture,
            save_book_info_xml,
            save_book_text,
        )

        cfg = {"data_dir": str(Path(tmp) / "data")}
        lecture = create_lecture(cfg, "测试课程")
        book = create_book(cfg, lecture["id"], "测试教材")
        save_book_text(cfg, lecture["id"], book["id"], _html_body(40))
        save_book_info_xml(
            cfg,
            lecture["id"],
            book["id"],
            _chapters_xml([("第一章", 0, 700), ("第二章", 700, 900)]),
        )
        return cfg, lecture["id"], book["id"]

    def test_invalid_chapter_index_is_rejected_not_silently_widened(self):
        with TemporaryDirectory() as tmp:
            cfg, lecture_id, book_id = self._seed(tmp)
            index, chapter, error = resolve_chapter(cfg, lecture_id, book_id, 0)
            self.assertEqual(error, "")
            self.assertIsNotNone(chapter)

            _, chapter, error = resolve_chapter(cfg, lecture_id, book_id, 99)
            self.assertIsNone(chapter)
            self.assertEqual(error, "chapter_index_out_of_range")

            _, chapter, error = resolve_chapter(cfg, lecture_id, book_id, -1)
            self.assertIsNone(chapter)
            self.assertEqual(error, "chapter_index_out_of_range")

            _, chapter, error = resolve_chapter(cfg, lecture_id, book_id, "abc")
            self.assertIsNone(chapter)
            self.assertEqual(error, "chapter_index_invalid")

    def test_index_cache_refreshes_when_sources_change(self):
        from core.lectures import save_book_info_xml

        with TemporaryDirectory() as tmp:
            cfg, lecture_id, book_id = self._seed(tmp)
            first = get_book_index(cfg, lecture_id, book_id)
            self.assertEqual(len(first.chapters), 2)

            save_book_info_xml(
                cfg,
                lecture_id,
                book_id,
                _chapters_xml([("甲", 0, 500), ("乙", 500, 500), ("丙", 1000, 600)]),
            )
            second = get_book_index(cfg, lecture_id, book_id)
            self.assertEqual([c.title for c in second.chapters], ["甲", "乙", "丙"])

    def test_search_returns_jumpable_anchors(self):
        with TemporaryDirectory() as tmp:
            cfg, lecture_id, book_id = self._seed(tmp)
            result = search_book(cfg, lecture_id, book_id, "第7段落")
            self.assertEqual(result["coordinate_space"], "plain")
            self.assertGreaterEqual(result["hits_count"], 1)
            hit = result["hits"][0]
            for key in ("offset", "chapter_index", "chapter_title", "paragraph_index", "snippet"):
                self.assertIn(key, hit)
            self.assertGreaterEqual(hit["chapter_index"], 0)
            self.assertGreaterEqual(hit["paragraph_index"], 0)

            index = get_book_index(cfg, lecture_id, book_id)
            paragraph = index.paragraphs[hit["paragraph_index"]]
            self.assertIn("第7段落", paragraph.text)
            self.assertTrue(paragraph.start <= hit["offset"] < paragraph.end)

    def test_search_never_matches_catalogue_metadata(self):
        from core.lectures import (
            create_book,
            create_lecture,
            save_book_text,
        )

        with TemporaryDirectory() as tmp:
            cfg = {"data_dir": str(Path(tmp) / "data")}
            lecture = create_lecture(cfg, "遗留课程")
            book = create_book(cfg, lecture["id"], "遗留教材")
            save_book_text(
                cfg,
                lecture["id"],
                book["id"],
                "[EPUB_HEADING_CANDIDATES]\n- 只在目录里的词条\n[/EPUB_HEADING_CANDIDATES]\n\n"
                + _html_body(10),
            )
            result = search_book(cfg, lecture["id"], book["id"], "只在目录里的词条")
            self.assertEqual(result["hits_count"], 0)


if __name__ == "__main__":
    unittest.main()
