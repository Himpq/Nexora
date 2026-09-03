"""
全局搜索接口 - 为前端命令面板（Ctrl+K）提供跨会话搜索能力。

搜索范围：
1. 会话标题（来自会话索引，无需读取会话文件）
2. 消息全文（按更新时间倒序逐个读取会话 JSON，命中即收集）

只读操作，不触发会话兼容性修复，不修改任何数据。
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from flask import Blueprint, jsonify, request, session

from basis.Conversation import ConversationService
from basis.Conversation.repository import conversation_base_path
from basis.User import User
from App.Storage import UserFileSandbox


global_search_bp = Blueprint("global_search", __name__)

# 结果与扫描上限：个人使用量级下保证接口在百毫秒级返回
TITLE_RESULT_LIMIT = 8
MESSAGE_RESULT_LIMIT = 24
MESSAGE_PER_CONVERSATION_LIMIT = 3
CONVERSATION_SCAN_LIMIT = 300
KNOWLEDGE_RESULT_LIMIT = 6
FILE_RESULT_LIMIT = 6
SNIPPET_CONTEXT_CHARS = 60

SEARCHABLE_ROLES = {"user", "assistant"}
KNOWLEDGE_SOURCE_TYPES = {"knowledge_title", "knowledge_content"}


def _extract_message_text(content: Any) -> str:
    """提取消息的纯文本部分。content 可能是字符串或多模态列表。"""

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: List[str] = []

        for item in content:
            if isinstance(item, dict):
                text = item.get("text")

                if isinstance(text, str) and text:
                    parts.append(text)

        return "\n".join(parts)

    return ""


def _build_snippet(text: str, hit_pos: int, keyword_len: int) -> str:
    """截取命中位置前后的上下文片段。"""

    start = max(0, hit_pos - SNIPPET_CONTEXT_CHARS)
    end = min(len(text), hit_pos + keyword_len + SNIPPET_CONTEXT_CHARS)
    snippet = text[start:end].replace("\n", " ").strip()

    if start > 0:
        snippet = "…" + snippet

    if end < len(text):
        snippet = snippet + "…"

    return snippet


def _search_conversation_messages(file_path: str, keyword_lower: str) -> List[Dict[str, Any]]:
    """在单个会话 JSON 中搜索消息，返回命中项（不含会话级字段）。

    先做字节级粗筛：关键词（原文与 JSON 转义两种形态）都不在原始字节中时，
    直接跳过 JSON 解析。会话文件为原生 UTF-8，粗筛可靠且比解析快一个数量级。
    """

    try:
        with open(file_path, "rb") as f:
            raw = f.read()
    except OSError:
        return []

    raw_lower = raw.lower()
    encoded_forms = {
        keyword_lower.encode("utf-8"),
        json.dumps(keyword_lower, ensure_ascii=False)[1:-1].encode("utf-8"),
    }

    if not any(form in raw_lower for form in encoded_forms):
        return []

    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return []

    messages = data.get("messages")

    if not isinstance(messages, list):
        return []

    hits: List[Dict[str, Any]] = []

    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            continue

        role = str(message.get("role") or "").strip().lower()

        if role not in SEARCHABLE_ROLES:
            continue

        text = _extract_message_text(message.get("content"))

        if not text:
            continue

        hit_pos = text.lower().find(keyword_lower)

        if hit_pos < 0:
            continue

        hits.append({
            "message_index": index,
            "role": role,
            "snippet": _build_snippet(text, hit_pos, len(keyword_lower)),
        })

        if len(hits) >= MESSAGE_PER_CONVERSATION_LIMIT:
            break

    return hits


def _search_knowledge(username: str, keyword: str) -> List[Dict[str, Any]]:
    """搜索知识库标题与内容，复用 User.search_keyword，按知识条目标题去重。"""

    payload = json.loads(User(username).search_keyword(keyword, range_size=SNIPPET_CONTEXT_CHARS))
    matches = payload.get("matches")

    if not isinstance(matches, list):
        return []

    seen_titles = set()
    results: List[Dict[str, Any]] = []

    for match in matches:
        if not isinstance(match, dict):
            continue

        if match.get("source_type") not in KNOWLEDGE_SOURCE_TYPES:
            continue

        title = str(match.get("title") or "").strip()

        if not title or title in seen_titles:
            continue

        seen_titles.add(title)
        results.append({
            "title": title,
            "snippet": str(match.get("snippet") or "").replace("\n", " ").strip(),
        })

        if len(results) >= KNOWLEDGE_RESULT_LIMIT:
            break

    return results


def _search_files(username: str, keyword: str) -> List[Dict[str, Any]]:
    """按文件名（别名/原始名/沙箱路径）搜索云盘文件。"""

    listing = UserFileSandbox(username).list_files(query=keyword, limit=FILE_RESULT_LIMIT)
    files = listing.get("files")

    if not isinstance(files, list):
        return []

    results: List[Dict[str, Any]] = []

    for entry in files:
        if not isinstance(entry, dict):
            continue

        alias = str(entry.get("alias") or "").strip()

        if not alias:
            continue

        results.append({
            "alias": alias,
            "name": str(entry.get("original_name") or alias),
        })

    return results


@global_search_bp.route("/api/search/global", methods=["GET"])
def global_search():
    username = str(session.get("username") or "").strip()

    if not username:
        return jsonify({"success": False, "message": "请先登录"}), 401

    keyword = str(request.args.get("q") or "").strip()

    if not keyword:
        return jsonify({"success": False, "message": "搜索词不能为空"}), 400

    keyword_lower = keyword.lower()
    service = ConversationService(username)
    index_items = service.list_conversations()

    if not isinstance(index_items, list):
        index_items = []

    title_results: List[Dict[str, Any]] = []
    message_results: List[Dict[str, Any]] = []
    scanned = 0

    for item in index_items:
        if not isinstance(item, dict):
            continue

        conversation_id = str(item.get("conversation_id") or "").strip()
        title = str(item.get("title") or "未命名对话")
        updated_at = item.get("updated_at")

        if not conversation_id:
            continue

        if len(title_results) < TITLE_RESULT_LIMIT and keyword_lower in title.lower():
            title_results.append({
                "conversation_id": conversation_id,
                "title": title,
                "updated_at": updated_at,
                "preview": str(item.get("preview") or ""),
            })

        if len(message_results) >= MESSAGE_RESULT_LIMIT or scanned >= CONVERSATION_SCAN_LIMIT:
            continue

        scanned += 1
        file_path = os.path.join(conversation_base_path(username), f"{conversation_id}.json")

        if not os.path.exists(file_path):
            continue

        for hit in _search_conversation_messages(file_path, keyword_lower):
            hit["conversation_id"] = conversation_id
            hit["title"] = title
            hit["updated_at"] = updated_at
            message_results.append(hit)

            if len(message_results) >= MESSAGE_RESULT_LIMIT:
                break

    return jsonify({
        "success": True,
        "keyword": keyword,
        "titles": title_results,
        "messages": message_results,
        "knowledge": _search_knowledge(username, keyword),
        "files": _search_files(username, keyword),
        "scanned_conversations": scanned,
    })
