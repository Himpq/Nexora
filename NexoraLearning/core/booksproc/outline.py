"""Outline generation for NexoraLearning."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple


_WRITE_LOCK = threading.Lock()


def _write_json(path: Path, data: Any) -> None:
    """线程安全写入 JSON 文件。"""
    with _WRITE_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> Optional[Any]:
    """读取 JSON 文件，不存在返回 None。"""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _extract_chapter_summaries(bookinfo_xml: str) -> List[Dict[str, str]]:
    """从 bookinfo.xml 提取章节摘要列表。"""
    import re

    text = str(bookinfo_xml or "")
    if not text.strip():
        return []
    pattern = re.compile(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>\s*"
        r"<chapter_range>\s*(.*?)\s*</chapter_range>\s*"
        r"(?:<chapter_status>\s*.*?\s*</chapter_status>\s*)?"
        r"<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    rows: List[Dict[str, str]] = []
    for match in pattern.finditer(text):
        chapter_name = str(match.group(1) or "").strip()
        chapter_range = str(match.group(2) or "").strip()
        chapter_summary = str(match.group(3) or "").strip()
        if not chapter_name:
            continue
        rows.append(
            {
                "chapter_name": chapter_name,
                "chapter_range": chapter_range,
                "chapter_summary": chapter_summary,
            }
        )
    return rows


def _extract_key_points(bookdetail_xml: str) -> Dict[str, List[Dict[str, str]]]:
    """从 bookdetail.xml 提取章节关键点。"""
    import re

    text = str(bookdetail_xml or "")
    result: Dict[str, List[Dict[str, str]]] = {}

    blocks = re.findall(r"<book_detail>\s*.*?\s*</book_detail>", text, flags=re.IGNORECASE | re.DOTALL)
    for block in blocks:
        name_match = re.search(r"<chapter_name>\s*(.*?)\s*</chapter_name>", block, flags=re.IGNORECASE | re.DOTALL)
        chapter_name = str(name_match.group(1) or "").strip() if name_match else ""
        if not chapter_name:
            continue

        kp_blocks = re.findall(r"<key_point>\s*(.*?)\s*</key_point>", block, flags=re.IGNORECASE | re.DOTALL)
        key_points: List[Dict[str, str]] = []
        for kp in kp_blocks:
            title_match = re.search(r"<key_point_title>\s*(.*?)\s*</key_point_title>", kp, flags=re.IGNORECASE | re.DOTALL)
            content_match = re.search(r"<key_point_content>\s*(.*?)\s*</key_point_content>", kp, flags=re.IGNORECASE | re.DOTALL)
            kp_title = str(title_match.group(1) or "").strip() if title_match else ""
            kp_content = str(content_match.group(1) or "").strip() if content_match else ""
            if kp_title:
                key_points.append({"title": kp_title, "content": kp_content[:200]})

        if key_points:
            result[chapter_name] = key_points

    return result


def _collect_all_books_data(
    cfg: Mapping[str, Any],
    lecture_id: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """收集课程下所有教材的章节结构和精读结果。"""
    from core.lectures import list_books, load_book_info_xml, load_book_detail_xml

    books = list_books(cfg, lecture_id)
    all_chapters: List[Dict[str, Any]] = []
    all_details: List[Dict[str, Any]] = []

    for book in books:
        bid = str(book.get("id") or "").strip()
        btitle = str(book.get("title") or "").strip()
        if not bid:
            continue

        bookinfo = load_book_info_xml(cfg, lecture_id, bid)
        bookdetail = load_book_detail_xml(cfg, lecture_id, bid)

        chapters = _extract_chapter_summaries(bookinfo)
        for ch in chapters:
            ch["book_id"] = bid
            ch["book_title"] = btitle
        all_chapters.extend(chapters)

        details = _extract_key_points(bookdetail)
        for chapter_name, key_points in details.items():
            all_details.append({
                "book_id": bid,
                "book_title": btitle,
                "chapter_name": chapter_name,
                "key_points": key_points,
            })

    return all_chapters, all_details


def _build_profile_summary(
    cfg: Mapping[str, Any],
    user_id: str,
) -> str:
    """构建用户画像摘要。"""
    if not user_id:
        return "暂无用户画像"

    try:
        from core.user.user import read_memory
        from core.memory.profile_extract import parse_profile_dimensions

        profile_content = read_memory(cfg, user_id, "user")
        if not profile_content:
            return "暂无用户画像"

        dimensions = parse_profile_dimensions(profile_content)
        if not dimensions:
            return profile_content[:1500]

        lines = []
        for dim_name, dim_value in dimensions.items():
            if dim_value:
                lines.append(f"- {dim_name}: {dim_value}")
        return "\n".join(lines)[:1500] if lines else profile_content[:1500]
    except Exception:
        return "暂无用户画像"


def _build_books_summary(books: List[Dict[str, Any]]) -> str:
    """构建教材列表摘要。"""
    lines = []
    for book in books:
        btitle = str(book.get("title") or "").strip()
        chapter_count = len(_extract_chapter_summaries(
            book.get("_bookinfo", "")
        )) if book.get("_bookinfo") else 0
        if btitle:
            lines.append(f"- {btitle}（{chapter_count} 章）")
    return "\n".join(lines) if lines else "暂无教材信息"


def generate_outline(
    cfg: Mapping[str, Any],
    lecture_id: str,
    *,
    user_id: str = "",
) -> Dict[str, Any]:
    """生成课程大纲。"""
    from core.lectures import get_lecture, list_books, load_book_info_xml
    from core.booksproc.modeling import build_memory_runner
    from core.booksproc.guide import _parse_json_object
    from core.runlog import log_event

    safe_lecture_id = str(lecture_id or "").strip()
    if not safe_lecture_id:
        raise ValueError("lecture_id is required.")

    lecture = get_lecture(cfg, safe_lecture_id)
    if lecture is None:
        raise ValueError(f"Lecture not found: {safe_lecture_id}")

    lecture_title = str(lecture.get("title") or "").strip()

    # 收集所有教材数据
    books = list_books(cfg, safe_lecture_id)
    if not books:
        raise ValueError("No books found for this lecture.")

    # 为每本书加载 bookinfo
    for book in books:
        bid = str(book.get("id") or "").strip()
        if bid:
            book["_bookinfo"] = load_book_info_xml(cfg, safe_lecture_id, bid)

    all_chapters, all_details = _collect_all_books_data(cfg, safe_lecture_id)
    books_summary = _build_books_summary(books)
    profile_summary = _build_profile_summary(cfg, user_id)

    # 构造 prompt
    try:
        from NexoraLearning.prompts import OUTLINE_GENERATION_PROMPT
    except ImportError:
        from prompts import OUTLINE_GENERATION_PROMPT

    prompt = str(OUTLINE_GENERATION_PROMPT or "")
    values = {
        "lecture_title": lecture_title,
        "books_summary": books_summary,
        "all_chapters": json.dumps(all_chapters, ensure_ascii=False, indent=2)[:8000],
        "all_details": json.dumps(all_details, ensure_ascii=False, indent=2)[:8000],
        "profile_summary": profile_summary,
    }

    for key, value in values.items():
        prompt = prompt.replace("{{" + key + "}}", value)

    log_event(
        "outline_start",
        "课程大纲生成开始",
        payload={"lecture_id": safe_lecture_id},
    )

    # 调用模型生成
    runner = build_memory_runner(cfg)
    content = runner.run(
        request=prompt,
        api_mode="chat",
        options={
            "temperature": 0.3,
            "max_tokens": 4000,
        },
        request_timeout=300,
    )

    if not content:
        raise RuntimeError("Model returned empty outline")

    # 解析结果
    outline = _parse_json_object(content)

    # 验证和规范化
    sections = outline.get("sections")
    if not isinstance(sections, list) or not sections:
        raise ValueError("模型未返回有效的 sections")

    # 补充元数据
    outline["lecture_id"] = safe_lecture_id
    outline["lecture_title"] = lecture_title
    outline["total_sections"] = len(sections)
    outline["total_estimated_minutes"] = sum(
        int(s.get("estimated_minutes") or 0) for s in sections if isinstance(s, dict)
    )

    # 保存大纲
    _save_outline(cfg, safe_lecture_id, outline)

    log_event(
        "outline_done",
        "课程大纲生成完成",
        payload={
            "lecture_id": safe_lecture_id,
            "section_count": len(sections),
        },
    )

    return outline


def _save_outline(
    cfg: Mapping[str, Any],
    lecture_id: str,
    outline: Dict[str, Any],
) -> None:
    """保存大纲到文件。"""
    data_dir = Path(str(cfg.get("data_dir") or "data"))
    outline_dir = data_dir / "lectures" / lecture_id / "solidified"
    outline_dir.mkdir(parents=True, exist_ok=True)
    _write_json(outline_dir / "outline.json", outline)


def load_outline(
    cfg: Mapping[str, Any],
    lecture_id: str,
) -> Optional[Dict[str, Any]]:
    """加载课程大纲。"""
    data_dir = Path(str(cfg.get("data_dir") or "data"))
    outline_path = data_dir / "lectures" / lecture_id / "solidified" / "outline.json"
    return _read_json(outline_path)
