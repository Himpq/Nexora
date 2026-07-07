"""Learning resource route helper functions."""

import html as html_lib
import re
import time
from collections.abc import Mapping as MappingABC
from typing import Any, Dict, List, Mapping

from core.learning_resources import is_learning_resource_plain_text_language, strip_model_thinking_blocks
from core.models import PromptContextManager

RESOURCE_TYPE_LABELS = {
    "explainer": "科普解释",
    "concept": "概念辨析",
    "practice": "实操案例",
    "review": "复习清单",
}

def _learning_resource_type_label(value: Any) -> str:
    key = str(value or "explainer").strip()
    return RESOURCE_TYPE_LABELS.get(key, "资源文章")

def _normalize_learning_resource_topic_payload(data: Any) -> List[Dict[str, str]]:
    if not isinstance(data, MappingABC):
        raise ValueError("选题工具参数根节点必须是对象。")

    raw_topics = data.get("topics")
    if not isinstance(raw_topics, list):
        raise ValueError("选题工具参数缺少 topics 数组。")

    topics: List[Dict[str, str]] = []
    seen = set()

    for item in raw_topics:
        if isinstance(item, MappingABC):
            title = str(item.get("title") or item.get("name") or "").strip()
            reason = str(item.get("reason") or item.get("description") or "").strip()
        else:
            title = str(item or "").strip()
            reason = ""
        title = re.sub(r"\s+", " ", title).strip(" -:：。")
        if not title or title in seen:
            continue
        seen.add(title)
        topics.append(
            {
                "id": f"topic_{len(topics) + 1}",
                "title": title[:80],
                "reason": reason[:180],
                "source": "llm",
            }
        )
        if len(topics) >= 10:
            break

    if len(topics) < 10:
        raise ValueError(f"选题工具参数中有效选题不足 10 个，实际为 {len(topics)} 个。")

    return topics

def _learning_resource_summary(title: str, resource_type: str, lecture_title: str) -> str:
    type_label = _learning_resource_type_label(resource_type)
    clean_title = str(title or "").strip()
    clean_lecture = str(lecture_title or "当前课程").strip() or "当前课程"
    if clean_title:
        return f"{type_label}草稿已创建，后续会围绕「{clean_title}」生成正文并发布给学习者。"
    return f"围绕「{clean_lecture}」创建的{type_label}草稿，等待生成正文。"

def _render_learning_resource_prompt(template: str, variables: Mapping[str, Any]) -> str:
    manager = PromptContextManager()
    context = manager.build_context(
        {
            "lecture_title": variables.get("lecture_title"),
            "lecture_id": variables.get("lecture_id"),
            "username": variables.get("username"),
        }
    )
    return manager.render(str(template or ""), context, variables)

def _strip_learning_resource_context_text(value: Any, max_chars: int = 2000) -> str:
    text = str(value or "")
    if not text.strip():
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    if max_chars > 0 and len(text) > max_chars:
        return text[:max_chars].rstrip() + "..."
    return text

def _normalize_learning_resource_components(raw: Any) -> Dict[str, Any]:
    data = raw if isinstance(raw, MappingABC) else {}
    components: Dict[str, Any] = {
        "quick_summary": strip_model_thinking_blocks(data.get("quick_summary") or ""),
        "concept_cards": [],
        "review_questions": [],
        "practice_blocks": [],
        "article_markdown": strip_model_thinking_blocks(data.get("article_markdown") or data.get("content") or ""),
    }
    for item in (data.get("concept_cards") if isinstance(data.get("concept_cards"), list) else []):
        if not isinstance(item, MappingABC):
            continue
        title = strip_model_thinking_blocks(item.get("title") or item.get("name") or "")
        content = strip_model_thinking_blocks(item.get("content") or item.get("description") or "")
        if title or content:
            components["concept_cards"].append({"title": title or "关键概念", "content": content})
    for item in (data.get("review_questions") if isinstance(data.get("review_questions"), list) else []):
        if isinstance(item, MappingABC):
            question = strip_model_thinking_blocks(item.get("question") or item.get("title") or "")
            answer = strip_model_thinking_blocks(item.get("answer") or "")
        else:
            question = strip_model_thinking_blocks(item)
            answer = ""
        if question:
            components["review_questions"].append({"question": question, "answer": answer})
    for item in (data.get("practice_blocks") if isinstance(data.get("practice_blocks"), list) else []):
        if isinstance(item, MappingABC):
            language = str(item.get("language") or item.get("lang") or "text").strip() or "text"
            content = strip_model_thinking_blocks(item.get("content") or item.get("code") or "")
            runnable = bool(item.get("runnable")) or language.lower() in {"python", "py"}
        else:
            language = "text"
            content = strip_model_thinking_blocks(item)
            runnable = False

        if content and not is_learning_resource_plain_text_language(language):
            components["practice_blocks"].append({"type": "code", "language": language, "content": content, "runnable": runnable})
    return components

def _learning_resource_markdown_from_components(components: Mapping[str, Any], title: str) -> str:
    article = strip_model_thinking_blocks(components.get("article_markdown") or "")
    if article:
        return article
    rows = [f"# {title}"]
    summary = str(components.get("quick_summary") or "").strip()
    if summary:
        rows.extend(["", "## 速读摘要", summary])
    concept_cards = components.get("concept_cards") if isinstance(components.get("concept_cards"), list) else []
    if concept_cards:
        rows.extend(["", "## 关键概念"])
        for item in concept_cards:
            if isinstance(item, MappingABC):
                rows.append(f"- **{item.get('title') or '概念'}**：{item.get('content') or ''}")
    review_questions = components.get("review_questions") if isinstance(components.get("review_questions"), list) else []
    if review_questions:
        rows.extend(["", "## 复盘问题"])
        for idx, item in enumerate(review_questions, start=1):
            if isinstance(item, MappingABC):
                rows.append(f"{idx}. {item.get('question') or ''}")
                if item.get("answer"):
                    rows.append(f"   - 参考：{item.get('answer')}")
    return "\n".join(rows).strip()

def _learning_resource_blocks_from_components(components: Mapping[str, Any], title: str) -> List[Dict[str, Any]]:
    markdown = _learning_resource_markdown_from_components(components, title)
    blocks = _split_learning_resource_blocks(markdown)
    practice_blocks = components.get("practice_blocks") if isinstance(components.get("practice_blocks"), list) else []
    for block in practice_blocks:
        if isinstance(block, MappingABC) and str(block.get("content") or "").strip():
            blocks.append(
                {
                    "type": "code",
                    "language": str(block.get("language") or "text").strip() or "text",
                    "content": str(block.get("content") or "").strip(),
                    "runnable": bool(block.get("runnable")),
                }
            )
    return blocks

def _split_learning_resource_blocks(markdown: str) -> List[Dict[str, Any]]:
    text = strip_model_thinking_blocks(markdown)
    if not text:
        return []
    blocks: List[Dict[str, Any]] = []
    cursor = 0
    pattern = re.compile(r"```([A-Za-z0-9_+\-.#]*)\s*\n(.*?)```", re.S)
    for match in pattern.finditer(text):
        before = text[cursor:match.start()].strip()
        if before:
            blocks.append({"type": "markdown", "content": before})
        language = str(match.group(1) or "").strip()
        display_language = language or "text"
        code = str(match.group(2) or "").strip("\n")

        if code.strip() and is_learning_resource_plain_text_language(language):
            blocks.append({"type": "markdown", "content": code.strip()})
        elif code.strip():
            blocks.append(
                {
                    "type": "code",
                    "language": display_language,
                    "content": code,
                    "runnable": display_language.lower() in {"python", "py"},
                }
            )
        cursor = match.end()
    tail = text[cursor:].strip()
    if tail:
        blocks.append({"type": "markdown", "content": tail})
    return blocks or [{"type": "markdown", "content": text}]

def _summarize_learning_resource_markdown(markdown: str, fallback_title: str) -> str:
    text = re.sub(r"```.*?```", "", strip_model_thinking_blocks(markdown), flags=re.S)
    text = re.sub(r"[#>*_`\-\[\]()]|^\s*\d+\.\s*", "", text, flags=re.M)
    text = re.sub(r"\s+", " ", text).strip()
    if text:
        return text[:180]
    return f"围绕「{fallback_title}」生成的学习资源草稿。"

def _normalize_learning_resource_scan(raw: Any, *, fallback_status: str = "rejected") -> Dict[str, Any]:
    data = raw if isinstance(raw, MappingABC) else {}
    status = str(data.get("status") or data.get("result") or fallback_status).strip().lower()
    if status in {"pass", "passed", "ok", "approved", "success"}:
        status = "passed"
    elif status in {"reject", "rejected", "failed", "fail", "blocked", "risk"}:
        status = "rejected"
    else:
        status = fallback_status
    issues: List[Dict[str, str]] = []
    raw_issues = data.get("issues") if isinstance(data.get("issues"), list) else []
    for item in raw_issues[:12]:
        if isinstance(item, MappingABC):
            title = str(item.get("title") or item.get("name") or "复核问题").strip()
            detail = str(item.get("detail") or item.get("description") or item.get("message") or "").strip()
            severity = str(item.get("severity") or "medium").strip().lower()
        else:
            title = "复核问题"
            detail = str(item or "").strip()
            severity = "medium"
        if detail or title:
            issues.append(
                {
                    "severity": severity if severity in {"high", "medium", "low"} else "medium",
                    "title": title,
                    "detail": detail,
                }
            )
    if status == "rejected" and not issues:
        issues.append({"severity": "medium", "title": "scan 拒绝", "detail": "模型认为文章暂不适合发布。"})
    checked = data.get("checked") if isinstance(data.get("checked"), list) else []
    return {
        "status": status,
        "label": "模型已 review" if status == "passed" else "scan 拒绝",
        "summary": str(data.get("summary") or data.get("message") or "").strip(),
        "issues": issues,
        "checked": [str(item or "").strip() for item in checked if str(item or "").strip()][:10],
        "checked_at": int(time.time()),
        "reviewer": "model",
    }

def _learning_resource_scan_feedback(scan: Mapping[str, Any]) -> str:
    if not isinstance(scan, MappingABC):
        return ""
    rows: List[str] = []
    summary = str(scan.get("summary") or "").strip()
    if summary:
        rows.append(f"复核结论：{summary}")
    issues = scan.get("issues") if isinstance(scan.get("issues"), list) else []
    for idx, item in enumerate(issues[:12], start=1):
        if not isinstance(item, MappingABC):
            continue
        severity = str(item.get("severity") or "medium").strip()
        title = str(item.get("title") or "复核问题").strip()
        detail = str(item.get("detail") or "").strip()
        rows.append(f"{idx}. [{severity}] {title}：{detail}")
    checked = scan.get("checked") if isinstance(scan.get("checked"), list) else []
    if checked:
        rows.append("已检查项：" + "、".join(str(item or "").strip() for item in checked if str(item or "").strip()))
    return "\n".join(row for row in rows if row.strip()).strip()

def _is_learning_resource_scan_cancelled(cancel_event: Any) -> bool:
    return cancel_event is not None and cancel_event.is_set()

def _learning_resource_scan_error(error: Any) -> Dict[str, Any]:
    message = str(error or "模型复核调用异常").strip()
    return _normalize_learning_resource_scan(
        {
            "status": "rejected",
            "summary": f"模型复核异常：{message}",
            "issues": [
                {
                    "severity": "medium",
                    "title": "复核调用异常",
                    "detail": message,
                }
            ],
        }
    )
