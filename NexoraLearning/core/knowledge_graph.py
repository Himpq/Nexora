"""知识图谱生成模块。

从 bookinfo.xml 和 bookdetail.xml 提取章节结构和知识点，
调用 LLM 生成知识点层级树，注入用户画像。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from core.runlog import log_event


def _graph_path(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> Path:
    data_dir = Path(str(cfg.get("data_dir") or "data")).resolve()
    return data_dir / "lectures" / lecture_id / "books" / book_id / "knowledge_graph.json"


def load_cached_graph(cfg: Mapping[str, Any], lecture_id: str, book_id: str) -> Optional[Dict[str, Any]]:
    path = _graph_path(cfg, lecture_id, book_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("chapters"), list):
            return data
    except Exception as exc:
        log_event(
            "knowledge_graph_cache_read_error",
            "知识图谱缓存读取失败",
            payload={"path": str(path), "error": str(exc)},
        )
    return None


def _save_graph(cfg: Mapping[str, Any], lecture_id: str, book_id: str, graph: Dict[str, Any]) -> None:
    path = _graph_path(cfg, lecture_id, book_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")


def _extract_chapters(bookinfo_xml: str) -> List[Dict[str, str]]:
    pattern = re.compile(
        r"<chapter_name>\s*(.*?)\s*</chapter_name>\s*"
        r"<chapter_range>\s*(.*?)\s*</chapter_range>\s*"
        r"(?:<chapter_status>\s*.*?\s*</chapter_status>\s*)?"
        r"<chapter_summary>\s*(.*?)\s*</chapter_summary>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    rows: List[Dict[str, str]] = []
    for match in pattern.finditer(str(bookinfo_xml or "")):
        name = str(match.group(1) or "").strip()
        summary = str(match.group(3) or "").strip()
        if name:
            rows.append({"name": name, "summary": summary})
    return rows


def _extract_key_points(bookdetail_xml: str) -> Dict[str, List[Dict[str, str]]]:
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


def generate_knowledge_graph(
    cfg: Mapping[str, Any],
    lecture_id: str,
    book_id: str,
    lecture_title: str = "",
    book_title: str = "",
    bookinfo_xml: str = "",
    bookdetail_xml: str = "",
) -> Dict[str, Any]:
    from core.booksproc import build_memory_runner, get_memory_settings
    from prompts import KNOWLEDGE_GRAPH_PROMPT

    chapters = _extract_chapters(bookinfo_xml)
    key_points = _extract_key_points(bookdetail_xml)

    if not chapters:
        raise RuntimeError("缺少章节信息，请先完成教材粗读。")

    chapter_lines: List[str] = []
    for idx, ch in enumerate(chapters, start=1):
        chapter_lines.append(f"{idx}. {ch['name']}：{ch.get('summary', '')[:150]}")
        kp_list = key_points.get(ch["name"], [])
        for kp in kp_list[:5]:
            chapter_lines.append(f"   - {kp['title']}：{kp['content'][:80]}")

    prompt = KNOWLEDGE_GRAPH_PROMPT.replace(
        "{{lecture_title}}", lecture_title
    ).replace(
        "{{book_title}}", book_title
    ).replace(
        "{{chapters_and_keypoints}}", "\n".join(chapter_lines)
    )

    settings = dict(get_memory_settings(cfg) or {})
    runner = build_memory_runner(cfg, str(settings.get("model_name") or "").strip())

    try:
        result = runner.run(
            prompt,
            context_payload={"username": "system"},
            model_name=str(settings.get("model_name") or "").strip() or None,
            options={"temperature": 0.3, "max_output_tokens": 4000},
            request_timeout=120,
        )

        json_match = re.search(r"\{[\s\S]*\}", str(result or ""), flags=re.DOTALL)
        if json_match:
            graph_data = json.loads(json_match.group(0))
            if isinstance(graph_data, dict) and isinstance(graph_data.get("chapters"), list):
                _save_graph(cfg, lecture_id, book_id, graph_data)
                log_event(
                    "knowledge_graph_generated",
                    "知识图谱生成完成",
                    payload={
                        "lecture_id": lecture_id,
                        "book_id": book_id,
                        "chapter_count": len(graph_data.get("chapters", [])),
                    },
                )
                return graph_data
    except Exception as exc:
        log_event("knowledge_graph_error", "知识图谱生成失败", payload={"error": str(exc)})

    fallback_graph = _build_fallback_graph(chapters, key_points)
    _save_graph(cfg, lecture_id, book_id, fallback_graph)
    return fallback_graph


def _build_fallback_graph(
    chapters: List[Dict[str, str]],
    key_points: Dict[str, List[Dict[str, str]]],
) -> Dict[str, Any]:
    result_chapters: List[Dict[str, Any]] = []

    for ch in chapters:
        ch_data: Dict[str, Any] = {
            "name": ch["name"],
            "summary": ch.get("summary", ""),
            "concepts": [],
        }

        kp_list = key_points.get(ch["name"], [])
        for kp in kp_list[:6]:
            ch_data["concepts"].append({
                "name": kp["title"],
                "detail": kp.get("content", ""),
                "children": [],
            })

        result_chapters.append(ch_data)

    return {"chapters": result_chapters}
