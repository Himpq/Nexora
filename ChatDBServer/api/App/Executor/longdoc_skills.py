import json
import os
import re
from typing import Any, Dict, List, Optional


LONGDOC_DIR_NAME = "longdoc"
CONTENT_MARKER = "---content---"


def _split_csv_text(value: Any) -> List[str]:
    if isinstance(value, list):
        out: List[str] = []
        seen = set()

        for raw in value:
            item = str(raw or "").strip()

            if not item:
                continue

            key = item.lower()

            if key in seen:
                continue

            seen.add(key)
            out.append(item)

        return out

    text = str(value or "").strip()

    if not text:
        return []

    out: List[str] = []
    seen = set()

    for raw in re.split(r"[,，\n]", text):
        item = str(raw or "").strip()

        if not item:
            continue

        key = item.lower()

        if key in seen:
            continue

        seen.add(key)
        out.append(item)

    return out


def _normalize_skill_id(value: Any) -> str:
    text = str(value or "").strip().lower()

    if not text:
        return ""

    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"[^a-z0-9_\-]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_-")

    return text


def _parse_skill_text(raw_text: Any, source: str = "") -> Optional[Dict[str, Any]]:
    text = str(raw_text or "")

    if not text.strip():
        return None

    lines = text.splitlines()
    marker_index = -1

    for idx, line in enumerate(lines):

        if str(line or "").strip().lower() == CONTENT_MARKER:
            marker_index = idx
            break

    header_lines = lines if marker_index < 0 else lines[:marker_index]
    content_lines = [] if marker_index < 0 else lines[marker_index + 1:]
    header: Dict[str, str] = {}

    for raw_line in header_lines:
        line = str(raw_line or "").strip()

        if not line or line.startswith("#"):
            continue

        sep = ":" if ":" in line else ("=" if "=" in line else "")

        if not sep:
            continue

        key, value = line.split(sep, 1)
        key_text = str(key or "").strip().lower()
        value_text = str(value or "").strip()

        if not key_text:
            continue

        header[key_text] = value_text

    source_name = os.path.basename(str(source or ""))
    source_id = source_name[:-6] if source_name.lower().endswith(".skill") else source_name
    skill_id = _normalize_skill_id(header.get("id") or source_id)
    title = str(header.get("title") or "").strip()
    skill_type = str(header.get("type") or "").strip().lower()
    description = str(header.get("description") or header.get("summary") or "").strip()
    content = "\n".join(content_lines).rstrip("\r\n")

    if skill_type != "longdoc":
        return None

    if not skill_id or not title or not description or not content.strip():
        return None

    return {
        "id": skill_id,
        "type": "longdoc",
        "title": title,
        "description": description,
        "aliases": _split_csv_text(header.get("aliases", "")),
        "author": str(header.get("author") or "").strip(),
        "release_date": str(header.get("release_date") or "").strip(),
        "version": str(header.get("version") or "").strip(),
        "update_date": str(header.get("update_date") or "").strip(),
        "main_content": content,
        "source": str(source or "").strip()
    }


def load_longdoc_skill_catalog(skills_dir: str) -> List[Dict[str, Any]]:
    root = os.path.join(str(skills_dir or ""), LONGDOC_DIR_NAME)

    if not os.path.isdir(root):
        return []

    rows: List[Dict[str, Any]] = []
    seen_ids = set()

    for current_root, _, files in os.walk(root):

        for filename in sorted(files):

            if not str(filename or "").lower().endswith(".skill"):
                continue

            path = os.path.join(current_root, filename)

            try:
                with open(path, "r", encoding="utf-8-sig") as f:
                    item = _parse_skill_text(f.read(), source=path)
            except Exception as exc:
                print(f"[LONGDOC_SKILL] read failed path={path} error={exc}")
                continue

            if not item:
                continue

            skill_id = str(item.get("id") or "").strip()

            if not skill_id or skill_id in seen_ids:
                continue

            seen_ids.add(skill_id)
            rows.append(item)

    return rows


def build_longdoc_skill_index(skills: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    index: Dict[str, Dict[str, Any]] = {}

    for item in skills or []:

        if not isinstance(item, dict):
            continue

        keys = [
            str(item.get("id") or "").strip(),
            str(item.get("title") or "").strip(),
        ]
        keys.extend(_split_csv_text(item.get("aliases", [])))

        for key in keys:
            lookup_key = str(key or "").strip().lower()

            if not lookup_key:
                continue

            if lookup_key not in index:
                index[lookup_key] = item

    return index


def public_longdoc_skill_rows(skills: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []

    for item in skills or []:

        if not isinstance(item, dict):
            continue

        rows.append({
            "id": str(item.get("id") or "").strip(),
            "type": "longdoc",
            "title": str(item.get("title") or "").strip(),
            "description": str(item.get("description") or "").strip(),
            "aliases": list(item.get("aliases", []) or []),
            "author": str(item.get("author") or "").strip(),
            "release_date": str(item.get("release_date") or "").strip(),
            "version": str(item.get("version") or "").strip(),
            "update_date": str(item.get("update_date") or "").strip(),
        })

    return rows


def render_longdoc_template(content: Any, variables: Optional[Dict[str, Any]] = None) -> str:
    text = str(content or "")
    values = variables if isinstance(variables, dict) else {}

    def replace_match(match) -> str:
        key = str(match.group(1) or "").strip()

        if not key or key not in values:
            return match.group(0)

        return str(values.get(key) or "")

    return re.sub(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}", replace_match, text)


def read_longdoc_skill(
    skills: List[Dict[str, Any]],
    name: Any,
    variables: Optional[Dict[str, Any]] = None
) -> str:
    query = str(name or "").strip()

    if not query:
        return json.dumps({
            "success": False,
            "message": "name 不能为空",
            "available_skills": public_longdoc_skill_rows(skills)
        }, ensure_ascii=False)

    index = build_longdoc_skill_index(skills)
    item = index.get(query.lower())

    if not item:
        return json.dumps({
            "success": False,
            "message": f"未找到 longdoc skill: {query}",
            "available_skills": public_longdoc_skill_rows(skills)
        }, ensure_ascii=False)

    template_variables = variables if isinstance(variables, dict) else {}
    content = render_longdoc_template(item.get("main_content"), template_variables).strip()

    return json.dumps({
        "success": True,
        "id": str(item.get("id") or "").strip(),
        "type": "longdoc",
        "title": str(item.get("title") or "").strip(),
        "description": str(item.get("description") or "").strip(),
        "aliases": list(item.get("aliases", []) or []),
        "template_variables": template_variables,
        "content": content
    }, ensure_ascii=False)
