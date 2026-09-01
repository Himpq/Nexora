"""
Nexora.basis.Tool.Presenter — 工具结果展示层

职责：把工具返回的结构化数据渲染成适合模型继续推理的 Markdown。
工具契约层（basis.Tool）的展示层：schema/命名（Tool）+ 结果渲染（Presenter）。

对外提供：
- ToolResultPresenter: 工具结果渲染器
"""

import json
import os
from typing import Any, Callable, Dict, List, Optional


class ToolResultPresenter:
    def __init__(self):
        self._presenters: Dict[str, Callable[[Dict[str, Any], Any], str]] = {
            "temp_context_read": self._render_tmp_read,
            "temp_context_search": self._render_tmp_search,
            "temp_context_list": self._render_tmp_list,
            "temp_context_clear": self._render_tmp_clear,
            "skill": self._render_skill,
            "cloud_file_read": self._render_file_read,
            "local_file_read": self._render_file_read,
            "cloud_file_create": self._render_file_create,
            "cloud_file_write": self._render_file_write,
            "cloud_doc_write": self._render_doc_write,
            "cloud_file_apply_diff": self._render_file_patch,
            "cloud_file_edit": self._render_file_patch,
            "cloud_file_find": self._render_file_find,
            "cloud_file_list": self._render_file_list,
            "cloud_file_remove": self._render_file_remove,
            "local_file_write": self._render_file_write,
            "local_file_probe": self._render_local_file_probe,
            "local_file_list": self._render_local_file_list,
            "local_file_search_tree": self._render_local_file_search_tree,
            "local_file_patch": self._render_file_patch,
            "local_shell_exec": self._render_shell_exec,
            "local_shell_session": self._render_shell_session,
            "local_terminal": self._render_terminal,
            "image_search": self._render_image_search,
            "browser_page_open": self._render_browser_page_result,
            "browser_page_read": self._render_browser_page_result,
            "browser_page_click": self._render_browser_page_result,
            "browser_page_input": self._render_browser_page_result,
            "browser_page_eval": self._render_browser_page_result,
            "browser_page_scroll": self._render_browser_page_result,
            "browser_page_list": self._render_browser_page_list,
            "browser_page_close": self._render_browser_page_close,
            "conversation_context_read": self._render_local_long_context,
            "clear_context": self._render_local_long_context_clear,
            "server_render_page": self._render_server_render_page,
            "map_render": self._render_map_result,
            "map_calc_distance": self._render_map_result,
            "map_calc_route": self._render_map_result,
            "map_geocode": self._render_map_result,
            "map_poi_search": self._render_map_result,
            "arxiv_search": self._render_arxiv_search,
            "search": self._render_unified_search,
            "exa_web_search": self._render_exa_web_search,
            "js_execute": self._render_js_execute,
            "client_js_exec": self._render_js_execute,
            "cloud_file_search_semantic": self._render_file_semantic_search,
            "conversation_context_length": self._render_context_length,
            "conversation_context_read": self._render_context,
            "conversation_context_search": self._render_context_keyword_search,
            "send_email": self._render_send_email,
            "get_email_list": self._render_email_list,
            "get_email": self._render_email,
            "knowledge_list": self._render_knowledge_list,
            "memory_profile_read": self._render_user_profile_memory,
            "memory_short_update": self._render_user_profile_update,
            "workspace_mem_apply_diff": self._render_workspace_memory_update,
            "workspace_mem_edit": self._render_workspace_memory_update,
            "workspace_mem_add": self._render_workspace_memory_update,
            "workspace_draft_add": self._render_workspace_draft_update,
            "knowledge_basis_create": self._render_knowledge_mutation,
            "knowledge_basis_delete": self._render_knowledge_mutation,
            "knowledge_basis_update": self._render_knowledge_mutation,
            "link_knowledge": self._render_knowledge_mutation,
            "categorize_knowledge": self._render_knowledge_mutation,
            "create_category": self._render_knowledge_mutation,
            "knowledge_basis_read": self._render_basis_content,
            "knowledge_search_keyword": self._render_knowledge_keyword_search,
            "knowledge_search_vector": self._render_vector_search,
            "analyze_connections": self._render_knowledge_connections,
            "knowledge_graph_read": self._render_knowledge_graph_structure,
            "get_knowledge_connections": self._render_knowledge_connections,
            "find_path_between_knowledge": self._render_knowledge_path,
            "listLectures": self._render_learning_lectures,
            "createLecture": self._render_learning_lectures,
            "getLecture": self._render_learning_lectures,
            "updateLecture": self._render_learning_lectures,
            "listBooks": self._render_learning_books,
            "createBook": self._render_learning_books,
            "getBook": self._render_learning_books,
            "updateBook": self._render_learning_books,
            "getBookText": self._render_learning_book_text,
            "readBookTextRange": self._render_learning_book_text,
            "searchBookText": self._render_learning_book_search,
            "getBookInfoXml": self._render_learning_xml_read,
            "getBookDetailXml": self._render_learning_xml_read,
            "getBookQuestionsXml": self._render_learning_xml_read,
            "saveBookInfoXml": self._render_learning_xml_write,
            "saveBookDetailXml": self._render_learning_xml_write,
            "saveBookQuestionsXml": self._render_learning_xml_write,
            "triggerBookVectorization": self._render_learning_vectorization,
            "vectorSearch": self._render_learning_vector_search,
            "puzzle": self._render_learning_puzzle,
            "question": self._render_question,
            "learning_card": self._render_learning_card,
            "read_learning_memory": self._render_learning_memory_read,
            "append_learning_memory": self._render_learning_memory_write,
            "update_learning_memory": self._render_learning_memory_write,
            "write_learning_memory": self._render_learning_memory_write,
        }

    def render(self, tool_name: str, args: Dict[str, Any], result: Any) -> Optional[str]:
        name = str(tool_name or "").strip()
        presenter = self._presenters.get(name)

        if presenter is None:
            return None

        try:
            safe_args = dict(args) if isinstance(args, dict) else {}
            safe_args.setdefault("_tool_name", name)
            return presenter(safe_args, result)
        except Exception as exc:
            return (
                "## Tool Result Render Failed\n\n"
                f"- Tool: `{name}`\n"
                f"- Reason: {str(exc)}\n\n"
                "### Raw Result\n\n"
                f"{self._fenced_text(str(result or ''), language='text')}"
            )

    def _load_payload(self, result: Any) -> Any:
        if isinstance(result, (dict, list)):
            return result

        text = str(result or "").strip()

        if not text:
            return ""

        try:
            return json.loads(text)
        except Exception:
            return text

    def _load_payload_unwrapped(self, result: Any) -> Any:
        payload = self._load_payload(result)

        if not isinstance(payload, dict) or payload.get("tmp_cached"):
            return payload

        wrapper_keys = {
            "success",
            "result",
            "error",
            "message",
            "traceback",
            "elapsed_ms",
            "duration_ms",
            "request_id",
        }
        keys = set(payload.keys())
        if "result" not in payload or not keys.issubset(wrapper_keys):
            return payload

        if payload.get("success") is False and payload.get("result") in (None, ""):
            return payload

        inner = payload.get("result")
        if isinstance(inner, str):
            return self._load_payload(inner)
        if inner is not None:
            return inner
        return payload

    def _as_bool_text(self, value: Any) -> str:
        return "yes" if bool(value) else "no"

    def _status_title(self, success: bool, success_title: str, failed_title: str) -> str:
        return success_title if success else failed_title

    def _length_line(self, payload: Dict[str, Any]) -> str:
        length = payload.get("length", "")
        max_length = payload.get("max_length", "")

        if str(max_length or "").strip() in ("", "0"):
            return f"- Length: {length}"

        return f"- Length: {length} / {max_length}"

    def _short_hash(self, value: Any) -> str:
        text = str(value or "").strip()
        if len(text) <= 16:
            return text
        return f"{text[:12]}...{text[-8:]}"

    def _clip(self, text: Any, limit: int = 12000) -> str:
        value = str(text or "")

        if len(value) <= limit:
            return value

        head = max(0, int(limit * 0.65))
        tail = max(0, limit - head)
        omitted = len(value) - head - tail
        return (
            value[:head]
            + f"\n\n...[omitted {omitted} chars]...\n\n"
            + value[-tail:]
        )

    def _fenced_text(self, text: Any, language: str = "text", limit: int = 12000) -> str:
        content = self._clip(text, limit=limit)
        fence = "```"

        if "```" in content:
            fence = "````"

        lang = str(language or "text").strip()
        return f"{fence}{lang}\n{content}\n{fence}"

    def _markdown_body(self, text: Any, limit: int = 12000) -> str:
        return self._clip(text, limit=limit).strip()

    def _escape_table_cell(self, value: Any) -> str:
        text = str(value if value is not None else "").replace("\r\n", "\n").replace("\r", "\n")
        return text.replace("|", "\\|").replace("\n", "<br>").strip()

    def _format_score(self, value: Any) -> str:
        try:
            return f"{float(value):.4f}"
        except Exception:
            return ""

    def _is_displayable_exa_image(self, url: Any) -> bool:
        """
        判断 Exa image 是否值得在工具展开区以 Markdown 图片展示。

        过滤 favicon/logo/小图标等无效缩略图，避免把 32x32 的 favicon 拉伸成全宽卡片。
        规则：
        - 仅 https 外链
        - 排除 svg/ico/gif
        - 排除含 logo/favicon/disambig/sprite/40px- 等标识的缩略图
        """
        text = str(url or "").strip()
        if not text.startswith("https://"):
            return False
        low = text.lower()
        if low.endswith(".svg") or low.endswith(".ico") or low.endswith(".gif"):
            return False
        # Exa 常把站点 logo 当作 image，需过滤
        if any(token in low for token in ("logo", "favicon", "disambig", "sprite", "/40px-")):
            return False
        return True

    def _looks_successful_text(self, result: Any) -> bool:
        text = str(result or "").strip().lower()
        if not text:
            return True
        failed_tokens = ("失败", "错误", "error", "failed", "not found")
        return not any(token in text for token in failed_tokens)

    def _language_for_path(self, path: Any) -> str:
        ext = os.path.splitext(str(path or ""))[1].lower()
        mapping = {
            ".py": "python",
            ".js": "javascript",
            ".jsx": "jsx",
            ".ts": "typescript",
            ".tsx": "tsx",
            ".json": "json",
            ".md": "markdown",
            ".html": "html",
            ".css": "css",
            ".xml": "xml",
            ".yaml": "yaml",
            ".yml": "yaml",
            ".toml": "toml",
            ".ps1": "powershell",
            ".sh": "bash",
            ".bat": "bat",
            ".sql": "sql",
        }
        return mapping.get(ext, "text")

    def _render_cached_payload(self, tool_name: str, payload: Dict[str, Any]) -> str:
        preview = str(payload.get("preview") or "")
        lines = [
            "## Tool Output Cached",
            "",
            f"- Tool: `{tool_name}`",
            f"- Resource: `{payload.get('resource_id', '')}`",
            f"- Total Chars: {payload.get('total_chars', payload.get('length', ''))}",
            f"- Hint: `{payload.get('hint', 'temp_context_read(resource_id,offset,length)')}`",
        ]

        if preview:
            lines.extend([
                "",
                "### Preview",
                "",
                self._fenced_text(preview, language="text", limit=1200),
            ])

        return "\n".join(lines).strip()

    def _render_skill(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False
        title = str(payload.get("title") or args.get("name") or payload.get("id") or "").strip()
        skill_id = str(payload.get("id") or "").strip()
        lines = [
            self._status_title(success, "## Longdoc Skill", "## Longdoc Skill Read Failed"),
            "",
        ]

        if title:
            lines.append(f"- Title: {title}")

        if skill_id:
            lines.append(f"- ID: `{skill_id}`")

        if payload.get("type"):
            lines.append(f"- Type: `{payload.get('type')}`")

        description = str(payload.get("description") or "").strip()

        if description:
            lines.append(f"- Description: {description}")

        aliases = payload.get("aliases") if isinstance(payload.get("aliases"), list) else []

        if aliases:
            lines.append(f"- Aliases: {', '.join([str(x) for x in aliases if str(x).strip()])}")

        if not success:
            reason = str(payload.get("message") or payload.get("error") or "unknown error").strip()
            lines.extend(["", f"- Reason: {reason}"])
            available = payload.get("available_skills") if isinstance(payload.get("available_skills"), list) else []

            if available:
                lines.extend([
                    "",
                    "### Available Longdoc Skills",
                    "",
                    "| ID | Title | Description | Aliases |",
                    "| --- | --- | --- | --- |",
                ])

                for item in available[:50]:

                    if not isinstance(item, dict):
                        continue

                    alias_text = ", ".join([str(x) for x in (item.get("aliases") or []) if str(x).strip()])
                    lines.append(
                        "| "
                        f"{self._escape_table_cell(item.get('id'))} | "
                        f"{self._escape_table_cell(item.get('title'))} | "
                        f"{self._escape_table_cell(item.get('description'))} | "
                        f"{self._escape_table_cell(alias_text)} |"
                    )

            return "\n".join(lines).strip()

        variables = payload.get("template_variables") if isinstance(payload.get("template_variables"), dict) else {}

        if variables:
            lines.extend(["", "### Template Variables", ""])

            for key in sorted(variables.keys()):
                value = str(variables.get(key) or "").strip()

                if value:
                    lines.append(f"- `{key}`: {value}")

        content = str(payload.get("content") or "").strip()

        if content:
            lines.extend(["", "### Content", "", content])

        return "\n".join(lines).strip()

    def _extract_file_label(self, args: Dict[str, Any], payload: Any) -> str:
        if isinstance(payload, dict):
            file_obj = payload.get("file")

            if isinstance(file_obj, dict):
                for key in ("path", "sandbox_path", "alias", "original_name"):
                    value = str(file_obj.get(key) or "").strip()

                    if value:
                        return value

            for key in ("path", "file_path", "file", "sandbox_path", "alias"):
                value = str(payload.get(key) or "").strip()

                if value:
                    return value

        for key in ("path", "file_path", "file"):
            value = str(args.get(key) or "").strip()

            if value:
                return value

        return "(unknown)"

    def _extract_cloud_file_reference_path(self, args: Dict[str, Any], payload: Any) -> str:
        _ = args

        if isinstance(payload, dict):
            file_obj = payload.get("file")

            if isinstance(file_obj, dict):
                value = str(file_obj.get("sandbox_path") or "").strip()

                if value:
                    return value

            value = str(payload.get("sandbox_path") or "").strip()

            if value:
                return value

        return ""

    def _append_cloud_file_reference_instruction(self, lines: list, args: Dict[str, Any], payload: Any) -> None:
        file_ref = self._extract_cloud_file_reference_path(args, payload)

        if not file_ref:
            return

        lines.extend([
            "",
            "### Reply Instruction",
            f"Final reply must reference this file as: [file]{file_ref}[/file]",
        ])

    def _render_tmp_read(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False

        if payload.get("tmp_cached"):
            return self._render_cached_payload("temp_context_read", payload)

        title = self._status_title(success, "## Temporary Context Read", "## Temporary Context Read Failed")
        lines = [
            title,
            "",
            f"- Resource: `{payload.get('resource_id') or args.get('resource_id') or ''}`",
            f"- Source Tool: `{payload.get('source_tool', '')}`",
        ]

        if "offset" in payload or "end_offset" in payload or "total_length" in payload:
            lines.append(
                f"- Range: {payload.get('offset', 0)}:{payload.get('end_offset', '')} / {payload.get('total_length', '')}"
            )

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        lines.extend([
            "",
            "### Content",
            "",
            self._fenced_text(payload.get("content", ""), language="text"),
        ])
        return "\n".join(lines).strip()

    def _render_tmp_search(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False
        query = payload.get("query") if isinstance(payload.get("query"), dict) else {}
        lines = [
            self._status_title(success, "## Temporary Context Search", "## Temporary Context Search Failed"),
            "",
            f"- Resource: `{payload.get('resource_id') or args.get('resource_id') or '(all)'}`",
            f"- Keyword: `{query.get('keyword') or args.get('keyword') or ''}`",
            f"- Regex: `{query.get('regex') or args.get('regex') or ''}`",
            f"- Case Sensitive: {self._as_bool_text(query.get('case_sensitive', args.get('case_sensitive', False)))}",
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        articles = payload.get("articles") if isinstance(payload.get("articles"), list) else []
        matches = payload.get("matches") if isinstance(payload.get("matches"), list) else []
        lines.extend([
            f"- Matched: {payload.get('matched', len(matches))}",
            f"- Resources: {len(articles)}",
        ])

        if articles:
            lines.extend([
                "",
                "### Resources",
                "",
                "| Source Tool | Hits |",
                "| --- | --- |",
            ])
            for item in articles[:50]:
                if isinstance(item, dict):
                    lines.append(f"| {self._escape_table_cell(item.get('article'))} | {item.get('hits', '')} |")

        if matches:
            lines.extend(["", "### Matches"])
            for index, match in enumerate(matches[:50], start=1):
                if not isinstance(match, dict):
                    continue
                lines.extend([
                    "",
                    f"#### Match {index}",
                    "",
                    f"- Resource: `{match.get('resource_id', '')}`",
                    f"- Source Tool: `{match.get('article', '')}`",
                    f"- Position: {match.get('start', '')}:{match.get('end', '')} (line {match.get('line', '')}, col {match.get('col', '')})",
                    f"- Match: `{match.get('match', '')}`",
                    "",
                    "##### Snippet",
                    "",
                    self._fenced_text(match.get("snippet", ""), language="markdown", limit=2500),
                ])
            if len(matches) > 50:
                lines.extend(["", f"... omitted {len(matches) - 50} more matches ..."])
        elif success:
            lines.extend(["", "(no matches)"])

        return "\n".join(lines).strip()

    def _render_tmp_list(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False
        lines = [
            self._status_title(success, "## Temporary Context List", "## Temporary Context List Failed"),
            "",
        ]

        if not success:
            lines.append(f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}")
            return "\n".join(lines).strip()

        items = payload.get("items") if isinstance(payload.get("items"), list) else []
        lines.append(f"- Count: {payload.get('count', len(items))}")
        if not items:
            lines.extend(["", "(empty)"])
            return "\n".join(lines).strip()

        lines.extend([
            "",
            "| # | Resource | Source Tool | Chars | Created At |",
            "| --- | --- | --- | --- | --- |",
        ])
        for index, item in enumerate(items[:100], start=1):
            if not isinstance(item, dict):
                continue
            lines.append(
                "| {idx} | `{rid}` | `{source}` | {length} | {created} |".format(
                    idx=index,
                    rid=self._escape_table_cell(item.get("resource_id")),
                    source=self._escape_table_cell(item.get("source_tool")),
                    length=self._escape_table_cell(item.get("length", "")),
                    created=self._escape_table_cell(item.get("created_at", "")),
                )
            )
        if len(items) > 100:
            lines.extend(["", f"... omitted {len(items) - 100} more resources ..."])
        return "\n".join(lines).strip()

    def _render_tmp_clear(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False
        lines = [
            self._status_title(success, "## Temporary Context Cleared", "## Temporary Context Clear Failed"),
            "",
            f"- Removed: {payload.get('removed', 0)}",
        ]
        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
        return "\n".join(lines).strip()

    def _render_file_read(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("cloud_file_read", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        file_label = self._extract_file_label(args, payload)
        title = self._status_title(success, "## File Read", "## File Read Failed")
        lines = [
            title,
            "",
            f"- File: `{file_label}`",
        ]

        if payload.get("mode"):
            lines.append(f"- Mode: `{payload.get('mode')}`")

        if payload.get("sha256"):
            lines.append(f"- SHA256: `{str(payload.get('sha256') or '').strip()}`")

        file_obj = payload.get("file") if isinstance(payload.get("file"), dict) else {}

        if file_obj.get("size") is not None:
            lines.append(f"- Size: {file_obj.get('size')} bytes")
        elif payload.get("size") is not None:
            lines.append(f"- Size: {payload.get('size')} bytes")

        if file_obj.get("total_chars") is not None:
            lines.append(f"- Total Chars: {file_obj.get('total_chars')}")
        elif payload.get("total_chars") is not None:
            lines.append(f"- Total Chars: {payload.get('total_chars')}")

        if payload.get("returned_chars") is not None:
            lines.append(f"- Returned Chars: {payload.get('returned_chars')}")

        if payload.get("returned_line_count") is not None:
            lines.append(f"- Returned Lines: {payload.get('returned_line_count')}")

        slice_obj = payload.get("slice") if isinstance(payload.get("slice"), dict) else {}

        if slice_obj:
            slice_bits = [f"{key}={value}" for key, value in slice_obj.items()]
            lines.append(f"- Slice: {', '.join(slice_bits)}")

        if "truncated" in payload:
            lines.append(f"- Truncated: {self._as_bool_text(payload.get('truncated'))}")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        lines.extend([
            "",
            "### Content",
            "",
            self._fenced_text(payload.get("content", ""), language=self._language_for_path(file_label)),
        ])
        return "\n".join(lines).strip()

    def _render_file_create(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("cloud_file_create", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        file_label = self._extract_file_label(args, payload)
        title = self._status_title(success, "## File Created", "## File Create Failed")
        lines = [
            title,
            "",
            f"- File: `{file_label}`",
            f"- Created: {self._as_bool_text(payload.get('created', False))}",
            f"- Overwritten: {self._as_bool_text(payload.get('overwritten', False))}",
        ]

        file_obj = payload.get("file") if isinstance(payload.get("file"), dict) else {}
        if file_obj.get("size") is not None:
            lines.append(f"- Size: {file_obj.get('size')} bytes")
        if args.get("content") is not None:
            lines.append(f"- Content Chars: {len(str(args.get('content') or ''))}")

        if not success:
            lines.extend(["", f"Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])

        else:
            self._append_cloud_file_reference_instruction(lines, args, payload)

        return "\n".join(lines).strip()

    def _render_file_write(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("cloud_file_write", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        file_label = self._extract_file_label(args, payload)
        title = self._status_title(success, "## File Written", "## File Write Failed")
        lines = [
            title,
            "",
            f"- File: `{file_label}`",
        ]

        if payload.get("mode"):
            lines.append(f"- Mode: `{payload.get('mode')}`")
        if payload.get("replaced_count") is not None:
            lines.append(f"- Replaced: {payload.get('replaced_count')}")

        file_obj = payload.get("file") if isinstance(payload.get("file"), dict) else {}
        if file_obj.get("size") is not None:
            lines.append(f"- Size: {file_obj.get('size')} bytes")
        if payload.get("bytes_written") is not None:
            lines.append(f"- Bytes Written: {payload.get('bytes_written')}")

        if args.get("from_line") is not None or args.get("to_line") is not None:
            lines.append(f"- Line Range: {args.get('from_line', '')}:{args.get('to_line', '')}")
        if args.get("old_text") is not None:
            lines.append(f"- Old Text Chars: {len(str(args.get('old_text') or ''))}")
            lines.append(f"- New Text Chars: {len(str(args.get('new_text') or ''))}")
        elif args.get("content") is not None:
            lines.append(f"- Content Chars: {len(str(args.get('content') or ''))}")
        elif args.get("replacement") is not None:
            lines.append(f"- Replacement Chars: {len(str(args.get('replacement') or ''))}")

        if not success:
            lines.extend(["", f"Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])

        elif str(payload.get("mode") or "").strip().lower() == "overwrite":
            self._append_cloud_file_reference_instruction(lines, args, payload)

        return "\n".join(lines).strip()

    def _render_doc_write(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("cloud_doc_write", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        file_label = self._extract_file_label(args, payload)
        title = self._status_title(success, "## Word Document Written", "## Word Document Write Failed")
        lines = [
            title,
            "",
            f"- File: `{file_label}`",
        ]

        if payload.get("mode"):
            lines.append(f"- Mode: `{payload.get('mode')}`")

        if payload.get("created") is not None:
            lines.append(f"- Created: {self._as_bool_text(payload.get('created'))}")

        if payload.get("overwritten") is not None:
            lines.append(f"- Overwritten: {self._as_bool_text(payload.get('overwritten'))}")

        if payload.get("markdown_chars") is not None:
            lines.append(f"- Markdown Chars: {payload.get('markdown_chars')}")

        if payload.get("block_count") is not None:
            lines.append(f"- Blocks: {payload.get('block_count')}")

        file_obj = payload.get("file") if isinstance(payload.get("file"), dict) else {}

        if file_obj.get("size") is not None:
            lines.append(f"- Size: {file_obj.get('size')} bytes")

        if not success:
            lines.extend(["", f"Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])

        else:
            self._append_cloud_file_reference_instruction(lines, args, payload)

        return "\n".join(lines).strip()

    def _render_file_find(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("cloud_file_find", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        file_label = self._extract_file_label(args, payload)
        lines = [
            self._status_title(success, "## File Search Results", "## File Search Failed"),
            "",
            f"- File: `{file_label}`",
            f"- Keyword: `{payload.get('keyword') or args.get('keyword') or args.get('query') or args.get('pattern') or ''}`",
            f"- Regex: {self._as_bool_text(payload.get('regex', args.get('regex', False)))}",
            f"- Case Sensitive: {self._as_bool_text(payload.get('case_sensitive', args.get('case_sensitive', True)))}",
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        results = payload.get("results") if isinstance(payload.get("results"), list) else []
        lines.append(f"- Matched: {payload.get('matched', len(results))}")

        if not results:
            lines.extend(["", "(no matches)"])
            return "\n".join(lines).strip()

        lines.extend(["", "### Matches"])
        for item in results[:50]:
            if not isinstance(item, dict):
                continue
            line_no = item.get("line", "")
            col = item.get("column", "")
            end_col = item.get("end_column", "")
            lines.extend([
                "",
                f"#### Line {line_no}, Col {col}:{end_col}",
                "",
                f"- Match: `{item.get('match', '')}`",
                "",
                self._fenced_text(item.get("text", ""), language=self._language_for_path(file_label), limit=2000),
            ])
        if len(results) > 50:
            lines.extend(["", f"... omitted {len(results) - 50} more matches ..."])
        return "\n".join(lines).strip()

    def _render_file_list(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("cloud_file_list", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        lines = [
            self._status_title(success, "## File List", "## File List Failed"),
            "",
            f"- User: `{payload.get('username', '')}`",
        ]
        if args.get("query"):
            lines.append(f"- Query: `{args.get('query')}`")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        files = payload.get("files") if isinstance(payload.get("files"), list) else []
        lines.append(f"- Total: {payload.get('total', len(files))}")
        if not files:
            lines.extend(["", "(empty)"])
            return "\n".join(lines).strip()

        lines.extend([
            "",
            "| # | Sandbox Path | Size | Updated | Source |",
            "| --- | --- | --- | --- | --- |",
        ])
        for index, item in enumerate(files[:100], start=1):
            if not isinstance(item, dict):
                continue
            source = item.get("source_ext") or item.get("parser_mode") or item.get("original_name") or ""
            lines.append(
                "| {idx} | `{path}` | {size} | {updated} | {source} |".format(
                    idx=index,
                    path=self._escape_table_cell(item.get("sandbox_path") or item.get("alias")),
                    size=self._escape_table_cell(item.get("size", "")),
                    updated=self._escape_table_cell(item.get("updated_at", "")),
                    source=self._escape_table_cell(source),
                )
            )
        if len(files) > 100:
            lines.extend(["", f"... omitted {len(files) - 100} more files ..."])
        return "\n".join(lines).strip()

    def _render_local_file_probe(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("local_file_probe", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        file_label = str(payload.get("path") or args.get("path") or "(unknown)")
        lines = [
            self._status_title(success, "## Local File Probe", "## Local File Probe Failed"),
            "",
            f"- File: `{file_label}`",
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        lines.extend([
            f"- Size: {payload.get('size', 0)} bytes",
            f"- SHA256: `{payload.get('sha256', '')}`",
            f"- Encoding Hint: `{payload.get('encoding_hint') or 'unknown'}`",
            f"- BOM: `{payload.get('bom') or 'none'}`",
            f"- Binary: {self._as_bool_text(payload.get('is_binary'))}",
            f"- Line Separator: `{payload.get('line_separator') or 'none'}`",
            f"- Trailing Newline: {self._as_bool_text(payload.get('has_trailing_newline'))}",
            f"- Readable: {self._as_bool_text(payload.get('readable'))}",
            f"- Writable: {self._as_bool_text(payload.get('writable'))}",
        ])

        if payload.get("binary_reason"):
            lines.append(f"- Binary Reason: `{payload.get('binary_reason')}`")

        line_endings = payload.get("line_endings") if isinstance(payload.get("line_endings"), dict) else {}

        if line_endings:
            lines.extend([
                "",
                "### Line Endings",
                "",
                "| CRLF | LF | CR | Total |",
                "| --- | --- | --- | --- |",
                "| {crlf} | {lf} | {cr} | {total} |".format(
                    crlf=self._escape_table_cell(line_endings.get("crlf", 0)),
                    lf=self._escape_table_cell(line_endings.get("lf", 0)),
                    cr=self._escape_table_cell(line_endings.get("cr", 0)),
                    total=self._escape_table_cell(line_endings.get("total", 0)),
                ),
            ])

        lines.extend([
            "",
            "### Byte Signals",
            "",
            "| Null Bytes | Control Bytes | Control Ratio |",
            "| --- | --- | --- |",
            "| {nulls} | {controls} | {ratio} |".format(
                nulls=self._escape_table_cell(payload.get("null_bytes", 0)),
                controls=self._escape_table_cell(payload.get("control_bytes", 0)),
                ratio=self._escape_table_cell(payload.get("control_byte_ratio", 0)),
            ),
        ])

        encoding_checks = payload.get("encoding_checks") if isinstance(payload.get("encoding_checks"), list) else []

        if encoding_checks:
            lines.extend([
                "",
                "### Encoding Checks",
                "",
                "| Encoding | Decodable | Error |",
                "| --- | --- | --- |",
            ])

            for item in encoding_checks:

                if not isinstance(item, dict):
                    continue

                lines.append(
                    "| {encoding} | {decodable} | {error} |".format(
                        encoding=self._escape_table_cell(item.get("encoding")),
                        decodable=self._escape_table_cell(self._as_bool_text(item.get("decodable"))),
                        error=self._escape_table_cell(self._clip(item.get("error", ""), limit=180)),
                    )
                )

        return "\n".join(lines).strip()

    def _render_local_file_list(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("local_file_list", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        directory = str(payload.get("path") or args.get("path") or "(unknown)")
        entries = payload.get("entries") if isinstance(payload.get("entries"), list) else []
        lines = [
            self._status_title(success, "## Local Directory Listed", "## Local Directory List Failed"),
            "",
            f"- Directory: `{directory}`",
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        lines.append(f"- Entries: {payload.get('count', len(entries))}")
        if not entries:
            lines.extend(["", "(empty)"])
            return "\n".join(lines).strip()

        lines.extend([
            "",
            "| # | Name | Type | Size |",
            "| --- | --- | --- | --- |",
        ])
        for index, item in enumerate(entries[:120], start=1):
            if not isinstance(item, dict):
                continue
            lines.append(
                "| {idx} | `{name}` | {kind} | {size} |".format(
                    idx=index,
                    name=self._escape_table_cell(item.get("name")),
                    kind=self._escape_table_cell(item.get("type")),
                    size=self._escape_table_cell("" if item.get("size") is None else item.get("size")),
                )
            )
        if len(entries) > 120:
            lines.extend(["", f"... omitted {len(entries) - 120} more entries ..."])
        return "\n".join(lines).strip()

    def _render_local_file_search_tree(self, args: Dict[str, Any], result: Any) -> str:
        """Render local_file_search_tree as a readable Markdown directory tree."""
        payload = self._load_payload_unwrapped(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        directory = str(payload.get("path") or args.get("path") or "(unknown)")
        entries = payload.get("entries") if isinstance(payload.get("entries"), list) else []
        lines = [
            self._status_title(success, "## Local File Tree", "## Local File Tree Failed"),
            "",
            f"- Root: `{directory}`",
            f"- Max Depth: `{payload.get('max_depth', args.get('max_depth', ''))}`",
            f"- Pattern: `{payload.get('pattern') or args.get('pattern') or '*'}`",
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        lines.append(f"- Entries: {payload.get('entry_count', len(entries))}")

        skipped = payload.get("skipped") if isinstance(payload.get("skipped"), dict) else {}

        if skipped:
            skipped_bits = [f"{key}={value}" for key, value in skipped.items() if value]

            if skipped_bits:
                lines.append(f"- Skipped: {', '.join(skipped_bits)}")

        tree_lines = []

        for entry in sorted(
            (item for item in entries if isinstance(item, dict)),
            key=lambda item: str(item.get("relative_path") or item.get("name") or "")
        ):
            relative_path = str(entry.get("relative_path") or entry.get("name") or "").strip()

            if not relative_path:
                continue

            depth = entry.get("depth")

            try:
                indent_level = max(0, int(depth) - 1)
            except (TypeError, ValueError):
                indent_level = max(0, relative_path.count("/"))

            name = str(entry.get("name") or relative_path.rsplit("/", 1)[-1])
            suffix = "/" if str(entry.get("type") or "") == "dir" else ""
            tree_lines.append(f"{'  ' * indent_level}{name}{suffix}")

        if tree_lines:
            lines.extend(["", "### Tree", "", self._fenced_text("\n".join(tree_lines), language="text", limit=24000)])
        else:
            lines.extend(["", "(empty)"])

        if payload.get("truncated"):
            lines.extend(["", "> The directory result was truncated by the configured entry limit."])

        return "\n".join(lines).strip()

    def _render_file_remove(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("cloud_file_remove", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        removed = payload.get("removed") if isinstance(payload.get("removed"), dict) else {}
        file_label = self._extract_file_label(args, {"file": removed} if removed else payload)
        lines = [
            self._status_title(success, "## File Removed", "## File Remove Failed"),
            "",
            f"- File: `{file_label}`",
        ]

        if "vector_deleted" in payload:
            lines.append(f"- Vector Deleted: {self._as_bool_text(payload.get('vector_deleted'))}")
        if payload.get("vector_delete_skipped"):
            lines.append(f"- Vector Delete Skipped: `{payload.get('vector_delete_skipped')}`")
        if payload.get("vector_delete_error"):
            lines.append(f"- Vector Delete Error: {payload.get('vector_delete_error')}")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
        return "\n".join(lines).strip()

    def _format_structured_edits(self, edits: Any) -> str:
        if not isinstance(edits, list):
            return ""

        chunks = []

        for index, edit in enumerate(edits, start=1):
            if not isinstance(edit, dict):
                continue

            action = str(edit.get("action") or "").strip()
            target = str(edit.get("target") or "")
            replacement = str(edit.get("replacement") or "")
            content = str(edit.get("content") or "")
            occurrence = edit.get("occurrence")
            header = f"{index}. `{action}`"

            if occurrence:
                header += f" occurrence={occurrence}"

            chunks.append(header)

            if action == "replace":
                chunks.append(self._fenced_text(f"- {target}\n+ {replacement}", language="diff", limit=3000))
            elif action == "delete":
                chunks.append(self._fenced_text(f"- {target}", language="diff", limit=3000))
            elif action in {"insert_before", "insert_after"}:
                chunks.append(self._fenced_text(f"  {target}\n+ {content}", language="diff", limit=3000))

        return "\n\n".join(chunks).strip()

    def _render_file_patch(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload(str(args.get("_tool_name") or "cloud_file_edit"), payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        changed = bool(payload.get("changed", False))
        file_label = str(payload.get("path") or args.get("path") or "(unknown)")
        success_title = "## File Patch Preview" if payload.get("dry_run") else "## File Modified Success"
        title = self._status_title(success, success_title, "## File Modify Failed")
        lines = [
            title,
            "",
            f"- File: `{file_label}`",
            f"- Changed: {self._as_bool_text(changed)}",
        ]

        if payload.get("dry_run") is not None:
            lines.append(f"- Dry Run: {self._as_bool_text(payload.get('dry_run'))}")

        if payload.get("requires_confirm") is not None:
            lines.append(f"- Requires Confirm: {self._as_bool_text(payload.get('requires_confirm'))}")

        if payload.get("preview_id"):
            lines.append(f"- Preview ID: `{payload.get('preview_id')}`")

        if payload.get("confirmed_preview_id"):
            lines.append(f"- Confirmed Preview ID: `{payload.get('confirmed_preview_id')}`")

        if payload.get("preview_expires_in_seconds") is not None:
            lines.append(f"- Preview Expires In: {payload.get('preview_expires_in_seconds')} seconds")

        if payload.get("mode"):
            lines.append(f"- Mode: `{payload.get('mode')}`")

        if payload.get("edit_count") is not None:
            lines.append(f"- Edits: {payload.get('edit_count')}")

        if payload.get("hunk_count") is not None:
            lines.append(f"- Hunks: {payload.get('hunk_count')}")

        if not payload.get("dry_run") and (
            payload.get("added_lines") is not None or payload.get("removed_lines") is not None
        ):
            lines.append(f"- Lines: +{payload.get('added_lines', 0)} / -{payload.get('removed_lines', 0)}")

        if payload.get("old_sha256") or payload.get("new_sha256"):
            lines.append(
                f"- SHA256: `{self._short_hash(payload.get('old_sha256'))}` -> `{self._short_hash(payload.get('new_sha256'))}`"
            )

        if not success:
            lines.extend(["", f"Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        patch_text = str(args.get("patch") or "").strip()

        if patch_text:
            lines.extend([
                "",
                "### Patch",
                "",
                self._fenced_text(patch_text, language="diff", limit=8000),
            ])
        else:
            edits_text = self._format_structured_edits(args.get("edits"))

            if edits_text:
                lines.extend([
                    "",
                    "### Structured Edits",
                    "",
                    edits_text,
                ])

        if payload.get("diff"):
            lines.extend([
                "",
                "### Result Diff",
                "",
                self._fenced_text(payload.get("diff"), language="diff", limit=12000),
            ])

        return "\n".join(lines).strip()

    def _render_shell_exec(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("local_shell_exec", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        has_error = bool(payload.get("error"))
        returncode = payload.get("returncode")
        success = (not has_error) and (returncode in (0, "0", None))
        title = self._status_title(success, "## Shell Command Completed", "## Shell Command Failed")
        lines = [
            title,
            "",
            f"- Command: `{args.get('command', '')}`",
        ]

        if args.get("cwd"):
            lines.append(f"- CWD: `{args.get('cwd')}`")

        if returncode is not None:
            lines.append(f"- Exit Code: `{returncode}`")

        if has_error:
            lines.extend(["", f"- Reason: {payload.get('error')}"])

        stdout = str(payload.get("stdout") or "")
        stderr = str(payload.get("stderr") or "")

        if stdout:
            lines.extend([
                "",
                "### STDOUT",
                "",
                self._fenced_text(stdout, language="text", limit=8000),
            ])

        if stderr:
            lines.extend([
                "",
                "### STDERR",
                "",
                self._fenced_text(stderr, language="text", limit=5000),
            ])

        if payload.get("_hint"):
            lines.extend(["", f"- Hint: {payload.get('_hint')}"])

        return "\n".join(lines).strip()

    def _render_shell_session(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("local_shell_session", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        action = str(args.get("action") or "").strip().lower()
        title_map = {
            "create": ("## Shell Session Created", "## Shell Session Create Failed"),
            "exec": ("## Shell Session Output", "## Shell Session Command Failed"),
            "status": ("## Shell Session Status", "## Shell Session Status Failed"),
            "close": ("## Shell Session Closed", "## Shell Session Close Failed"),
        }
        success_title, failed_title = title_map.get(action, ("## Shell Session Result", "## Shell Session Failed"))
        success = payload.get("success", True) is not False and not payload.get("error")
        lines = [
            self._status_title(success, success_title, failed_title),
            "",
            f"- Action: `{action or '(unknown)'}`",
            f"- Session: `{payload.get('session_id') or args.get('session_id') or ''}`",
            f"- Status: `{payload.get('status', '')}`",
        ]

        if args.get("cwd") or payload.get("cwd"):
            lines.append(f"- CWD: `{payload.get('cwd') or args.get('cwd')}`")
        if args.get("command"):
            lines.append(f"- Command: `{args.get('command')}`")
        if payload.get("pending_output") is not None:
            lines.append(f"- Pending Output: {payload.get('pending_output')} chars")
        if payload.get("total_chunks") is not None:
            lines.append(f"- Chunks: {payload.get('current_chunk', 1)} / {payload.get('total_chunks')}")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        content = str(payload.get("content") or "")
        if not content and isinstance(payload.get("chunks"), list):
            content = "\n".join(str(chunk or "") for chunk in payload.get("chunks", [])[:3])

        if content:
            lines.extend(["", "### Output", "", self._fenced_text(content, language="text", limit=10000)])
        return "\n".join(lines).strip()

    def _render_terminal(self, args: Dict[str, Any], result: Any) -> str:
        """将终端结构化结果压缩成模型和前端共用的 Markdown。"""
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("local_terminal", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        action = str(args.get("action") or "").strip().lower()
        success = payload.get("success", True) is not False and not payload.get("error")
        status = str(payload.get("status") or "").strip().lower()
        wait_expired = bool(payload.get("wait_expired"))
        returncode = payload.get("returncode")

        if not success:
            title = "## Terminal Failed"
        elif action == "terminate":
            title = "## Terminal Terminated" if status == "terminated" else "## Terminal Exited"
        elif wait_expired and status == "running":
            title = "## Terminal Still Running"
        elif returncode not in (0, "0", None):
            title = "## Terminal Command Failed"
        elif status == "running":
            title = "## Terminal Running"
        else:
            title = "## Terminal Completed"

        lines = [
            title,
            "",
            f"- Action: `{action or '(unknown)'}`",
        ]

        terminal_id = str(payload.get("terminal_id") or args.get("terminal_id") or "").strip()

        if terminal_id:
            lines.append(f"- Terminal: `{terminal_id}`")

        if status:
            lines.append(f"- Status: `{status}`")

        if returncode is not None:
            lines.append(f"- Exit Code: `{returncode}`")

        if wait_expired:
            lines.append("- Wait Window Ended: yes")

        if payload.get("has_more"):
            lines.append("- More Output Available: yes")

        if payload.get("truncated"):
            lines.append("- Output Truncated: yes")

        if not success:
            reason = str(payload.get("error") or payload.get("message") or "unknown error").strip()
            lines.extend(["", f"- Reason: {reason}"])

        output = str(payload.get("output") or "")

        if output:
            output_title = "### New Output" if action in {"read", "terminate"} else "### Output"
            lines.extend([
                "",
                output_title,
                "",
                self._fenced_text(output, language="text", limit=8000),
            ])

        return "\n".join(lines).strip()

    def _render_image_search(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("image_search", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        status = str(payload.get("status") or "").strip().lower()
        success = payload.get("success", True) is not False and not payload.get("error") and status not in {"error", "failed"}
        results = payload.get("results") if isinstance(payload.get("results"), list) else []
        lines = [
            self._status_title(success, "## Image Search Results", "## Image Search Failed"),
            "",
            f"- Query: `{payload.get('query') or args.get('query') or ''}`",
            f"- Source: `{payload.get('engine') or args.get('source') or ''}`",
            f"- Status: `{payload.get('status', '')}`",
            f"- Results: {len(results)}",
        ]

        anti_spider = payload.get("anti_spider") if isinstance(payload.get("anti_spider"), dict) else {}
        if anti_spider.get("detected"):
            lines.append(f"- Anti Spider: {anti_spider.get('reason') or 'detected'}")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        if not results:
            lines.extend(["", payload.get("message") or "(no image results)"])
            return "\n".join(lines).strip()

        for index, item in enumerate(results[:16], start=1):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or f"Image {index}").strip()
            image_url = str(item.get("image_url") or item.get("thumbnail_url") or "").strip()
            source_url = str(item.get("source_url") or item.get("page_url") or "").strip()
            lines.extend(["", f"### {index}. {title}", ""])
            if item.get("width") or item.get("height"):
                lines.append(f"- Size: {item.get('width') or '?'}x{item.get('height') or '?'}")
            if item.get("license") or item.get("author"):
                lines.append(f"- Credit: {self._escape_table_cell(item.get('author'))} {self._escape_table_cell(item.get('license'))}".strip())
            if image_url:
                alt = title.replace("[", "\\[").replace("]", "\\]")
                lines.append(f"![{alt}]({image_url})")
            if source_url:
                lines.append(f"- Source: {source_url}")
        if len(results) > 16:
            lines.extend(["", f"... omitted {len(results) - 16} more images ..."])
        return "\n".join(lines).strip()

    def _web_result_title(self, tool_name: str, success: bool) -> str:
        title_map = {
            "browser_page_open": ("## Local Web Page Rendered", "## Local Web Render Failed"),
            "browser_page_read": ("## Local Web Content Read", "## Local Web Content Read Failed"),
            "browser_page_click": ("## Local Web Clicked", "## Local Web Click Failed"),
            "browser_page_input": ("## Local Web Input Completed", "## Local Web Input Failed"),
            "browser_page_eval": ("## Local Web JavaScript Executed", "## Local Web JavaScript Failed"),
            "browser_page_scroll": ("## Local Web Scrolled", "## Local Web Scroll Failed"),
        }
        success_title, failed_title = title_map.get(tool_name, ("## Local Web Result", "## Local Web Failed"))
        return self._status_title(success, success_title, failed_title)

    def _append_web_snapshot(self, lines: list, payload: Dict[str, Any]) -> None:
        nodes = payload.get("nodes") if isinstance(payload.get("nodes"), list) else []
        if not nodes:
            return

        lines.extend([
            "",
            "### Interactive Nodes",
            "",
            "| ID | Tag | Text | Selector |",
            "| --- | --- | --- | --- |",
        ])
        for node in nodes[:80]:
            if not isinstance(node, dict):
                continue
            locator = node.get("locator") if isinstance(node.get("locator"), dict) else {}
            lines.append(
                "| `{node_id}` | {tag} | {text} | `{selector}` |".format(
                    node_id=self._escape_table_cell(node.get("node_id")),
                    tag=self._escape_table_cell(node.get("tag")),
                    text=self._escape_table_cell(node.get("text")),
                    selector=self._escape_table_cell(locator.get("preferred", "")),
                )
            )
        if len(nodes) > 80:
            lines.extend(["", f"... omitted {len(nodes) - 80} more nodes ..."])

    def _render_browser_page_result(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload(str(args.get("_tool_name") or "local_web"), payload)

        if not isinstance(payload, dict):
            return str(result or "")

        tool_name = str(args.get("_tool_name") or "").strip()
        success = payload.get("success", True) is not False and not payload.get("error")
        lines = [
            self._web_result_title(tool_name, success),
            "",
        ]
        if args.get("url"):
            lines.append(f"- Requested URL: {args.get('url')}")
        if payload.get("page_id") is not None or args.get("page_id") is not None:
            lines.append(f"- Page ID: `{payload.get('page_id', args.get('page_id'))}`")
        if payload.get("url"):
            lines.append(f"- Current URL: {payload.get('url')}")
        if payload.get("title"):
            lines.append(f"- Title: {payload.get('title')}")
        if args.get("extract_mode") or payload.get("extract_mode"):
            lines.append(f"- Mode: `{payload.get('extract_mode') or args.get('extract_mode')}`")
        if payload.get("engine"):
            lines.append(f"- Engine: `{payload.get('engine')}`")
        if payload.get("warning"):
            lines.append(f"- Warning: {payload.get('warning')}")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        if "result" in payload and payload.get("result") is not None:
            value = payload.get("result")
            if isinstance(value, (dict, list)):
                body = json.dumps(value, ensure_ascii=False, indent=2)
                language = "json"
            else:
                body = str(value)
                language = "text"
            lines.extend(["", "### Interaction Result", "", self._fenced_text(body, language=language, limit=5000)])

        content = str(payload.get("content") or "")
        if content:
            language = "html" if str(payload.get("extract_mode") or args.get("extract_mode")).lower() == "html" else "markdown"
            lines.extend(["", "### Content", "", self._fenced_text(content, language=language, limit=12000)])

        dom = payload.get("dom") if isinstance(payload.get("dom"), dict) else None
        self._append_web_snapshot(lines, dom or payload)
        return "\n".join(lines).strip()

    def _render_browser_page_list(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("browser_page_list", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        pages = payload.get("pages") if isinstance(payload.get("pages"), list) else []
        lines = [
            self._status_title(success, "## Local Web Pages", "## Local Web Pages Failed"),
            "",
            f"- Active Page ID: `{payload.get('active_page_id', '')}`",
            f"- Pages: {len(pages)}",
        ]
        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()
        if not pages:
            lines.extend(["", "(no open pages)"])
            return "\n".join(lines).strip()
        lines.extend(["", "| Page ID | Active | Title | URL |", "| --- | --- | --- | --- |"])
        for page in pages[:60]:
            if not isinstance(page, dict):
                continue
            lines.append(
                "| `{pid}` | {active} | {title} | {url} |".format(
                    pid=self._escape_table_cell(page.get("page_id")),
                    active=self._as_bool_text(page.get("active")),
                    title=self._escape_table_cell(page.get("title")),
                    url=self._escape_table_cell(page.get("url")),
                )
            )
        return "\n".join(lines).strip()

    def _render_browser_page_close(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("browser_page_close", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        lines = [
            self._status_title(success, "## Local Web Page Closed", "## Local Web Page Close Failed"),
            "",
            f"- Page ID: `{payload.get('page_id') or args.get('page_id') or ''}`",
            f"- Closed: {self._as_bool_text(payload.get('closed', success))}",
        ]
        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()
        pages = payload.get("pages") if isinstance(payload.get("pages"), list) else []
        if pages:
            lines.append(f"- Remaining Pages: {len(pages)}")
        return "\n".join(lines).strip()

    def _render_local_long_context(self, args: Dict[str, Any], result: Any) -> str:
        text = str(result or "").strip()
        success = self._looks_successful_text(text) and text != "Context not found."
        lines = [
            self._status_title(success, "## Local Long Context Read", "## Local Long Context Read Failed"),
            "",
            f"- Context ID: `{args.get('ctxId') or args.get('ctx_id') or ''}`",
        ]
        if args.get("keyword"):
            lines.append(f"- Keyword: `{args.get('keyword')}`")
        if args.get("regex"):
            lines.append(f"- Regex: `{args.get('regex')}`")
        if args.get("range_start") is not None or args.get("range_end") is not None:
            lines.append(f"- Line Range: {args.get('range_start', '')}:{args.get('range_end', '')}")

        if not success:
            lines.extend(["", f"- Reason: {text or 'unknown error'}"])
            return "\n".join(lines).strip()

        lines.extend(["", "### Content", "", self._fenced_text(text, language="markdown", limit=12000)])
        return "\n".join(lines).strip()

    def _render_local_long_context_clear(self, args: Dict[str, Any], result: Any) -> str:
        text = str(result or "").strip()
        success = self._looks_successful_text(text)
        return "\n".join([
            self._status_title(success, "## Local Long Context Cleared", "## Local Long Context Clear Failed"),
            "",
            self._markdown_body(text or "(empty)", limit=2000),
        ]).strip()

    def _render_server_render_page(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("server_render_page", payload)

        text = str(result or "").strip()
        success = self._looks_successful_text(text) and text.startswith("Render Result")
        if isinstance(payload, dict):
            success = payload.get("success", True) is not False

        lines = [
            self._status_title(success, "## Web Page Rendered", "## Web Page Render Failed"),
            "",
            f"- Requested URL: {args.get('url', '')}",
        ]

        if isinstance(payload, dict):
            final_url = payload.get("url") or payload.get("final_url") or args.get("url", "")
            title = payload.get("title") or ""
            content = str(payload.get("content") or "")
            lines.extend([
                f"- Final URL: {final_url}",
                f"- Title: {title or '(empty)'}",
                f"- Mode: `{payload.get('mode') or payload.get('warning') or 'unknown'}`",
                f"- Content Chars: {len(content)}",
            ])
            if payload.get("warning"):
                lines.append(f"- Warning: {payload.get('warning')}")
            if not success:
                lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            elif content:
                lines.extend(["", "### Content", "", self._fenced_text(content, language="markdown", limit=12000)])
            return "\n".join(lines).strip()

        if not success:
            lines.extend(["", self._markdown_body(text or "unknown error", limit=4000)])
            return "\n".join(lines).strip()

        meta_text = text
        content = ""
        marker = "\ncontent:\n"
        if marker in text:
            meta_text, content = text.split(marker, 1)

        for raw_line in meta_text.splitlines()[1:]:
            if ":" not in raw_line:
                continue
            key, value = raw_line.split(":", 1)
            key = key.strip()
            value = value.strip()
            if key == "original_url":
                lines.append(f"- Original URL: {value}")
            elif key == "final_url":
                lines.append(f"- Final URL: {value}")
            elif key == "title":
                lines.append(f"- Title: {value or '(empty)'}")
            elif key == "mode":
                lines.append(f"- Mode: `{value}`")
            elif key == "content_length":
                lines.append(f"- Content Chars: {value}")
            elif key == "warning":
                lines.append(f"- Warning: {value}")

        if content:
            lines.extend(["", "### Content", "", self._fenced_text(content, language="markdown", limit=12000)])
        else:
            lines.extend(["", "### Content", "", "(empty)"])
        return "\n".join(lines).strip()

    def _render_map_result(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload_unwrapped(result)

        if not isinstance(payload, dict):
            return "\n".join([
                "## Map Tool Result",
                "",
                self._fenced_text(str(result or ""), language="text", limit=4000),
            ]).strip()

        tool_name = str(payload.get("tool") or args.get("_tool_name") or "map_tool").strip()
        success = payload.get("success", True) is not False
        lines = [
            self._status_title(success, "## Map Tool Completed", "## Map Tool Failed"),
            "",
            f"- Tool: `{tool_name}`",
        ]

        provider = str(payload.get("provider") or "").strip()
        if provider:
            lines.append(f"- Provider: `{provider}`")

        provider_status = payload.get("provider_status")
        if isinstance(provider_status, dict):
            status_text = provider_status.get("status", "")
            message_text = str(provider_status.get("message") or "").strip()
            lines.append(f"- Provider Status: `{status_text}`")

            if message_text:
                lines.append(f"- Provider Message: {message_text}")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        self._append_map_handle_lines(lines, payload)
        self._append_map_metric_lines(lines, payload)
        self._append_map_point_lines(lines, payload)
        self._append_map_poi_table(lines, payload)
        self._append_map_transit_schemes(lines, payload)

        markdown = str(payload.get("markdown") or "").strip()

        if markdown:
            lines.extend(["", "### Scene", "", markdown])
        elif isinstance(payload.get("scene"), dict):
            lines.extend([
                "",
                "### Scene",
                "",
                self._fenced_text(json.dumps(payload.get("scene"), ensure_ascii=False, indent=4), language="nexora-map", limit=16000),
            ])

        return "\n".join(lines).strip()

    def _append_map_handle_lines(self, lines: list, payload: Dict[str, Any]) -> None:
        record = payload.get("record") if isinstance(payload.get("record"), dict) else {}
        map_id = payload.get("map_id") or record.get("map_id")
        record_id = payload.get("record_id") or record.get("record_id")
        render_id = payload.get("render_id") or record.get("render_id")
        conversation_id = payload.get("conversation_id") or record.get("conversation_id")
        title = payload.get("title") or record.get("title")
        summary = payload.get("summary")

        if summary is None and isinstance(record.get("summary"), dict):
            summary = record.get("summary")

        if map_id:
            lines.append(f"- Map ID: `{map_id}`")
        elif record_id:
            lines.append(f"- Record ID: `{record_id}`")

        if render_id and render_id != map_id:
            lines.append(f"- Render ID: `{render_id}`")

        if conversation_id:
            lines.append(f"- Conversation ID: `{conversation_id}`")

        if title:
            lines.append(f"- Title: {title}")

        if isinstance(summary, dict) and summary:
            lines.extend(["", "### Summary"])

            for key, value in summary.items():
                if key == "transit_schemes":
                    continue

                if isinstance(value, (dict, list)):
                    value = json.dumps(value, ensure_ascii=False)

                lines.append(f"- {key}: {value}")

    def _append_map_transit_schemes(self, lines: list, payload: Dict[str, Any]) -> None:
        schemes = self._map_transit_schemes(payload)

        if not schemes:
            return

        recommended = schemes[0] if isinstance(schemes[0], dict) else {}
        lines.extend([
            "",
            "### Transit Schemes",
            "",
            f"- Schemes: {len(schemes)}",
        ])

        if recommended:
            route_label = self._transit_scheme_route_label(recommended)
            duration_text = self._format_minutes(recommended.get("duration_minutes"))
            distance_text = self._format_kilometers(recommended.get("distance_kilometers"))
            summary_bits = [bit for bit in (duration_text, distance_text) if bit]

            lines.extend([
                f"- Recommended: 方案 {recommended.get('index', 1)}" + (f" ({' | '.join(summary_bits)})" if summary_bits else ""),
            ])

            if route_label:
                lines.append(f"- Route: {route_label}")

            steps = recommended.get("steps") if isinstance(recommended.get("steps"), list) else []

            if steps:
                lines.extend(["", f"#### Recommended Scheme {recommended.get('index', 1)} Steps", ""])

                for fallback_index, step in enumerate(steps[:30], start=1):
                    if isinstance(step, dict):
                        lines.append(f"{step.get('index') or fallback_index}. {self._format_transit_step(step)}")

                if len(steps) > 30:
                    lines.append(f"{len(steps) - 30} more steps omitted.")

        if len(schemes) > 1:
            lines.extend([
                "",
                "#### Scheme Comparison",
                "",
                "| Scheme | Route | Duration | Distance | Steps |",
                "| --- | --- | --- | --- | --- |",
            ])

            for scheme in schemes[:10]:
                if not isinstance(scheme, dict):
                    continue

                lines.append(
                    "| {scheme} | {route} | {duration} | {distance} | {steps} |".format(
                        scheme=self._escape_table_cell(f"方案 {scheme.get('index', '')}".strip()),
                        route=self._escape_table_cell(self._transit_scheme_route_label(scheme)),
                        duration=self._escape_table_cell(self._format_minutes(scheme.get("duration_minutes"))),
                        distance=self._escape_table_cell(self._format_kilometers(scheme.get("distance_kilometers"))),
                        steps=self._escape_table_cell(scheme.get("step_count", "")),
                    )
                )

            if len(schemes) > 10:
                lines.append(f"\n... omitted {len(schemes) - 10} more transit schemes ...")

    def _map_transit_schemes(self, payload: Dict[str, Any]) -> list:
        route = payload.get("route") if isinstance(payload.get("route"), dict) else {}
        summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}

        for value in (
            payload.get("transit_schemes"),
            route.get("transit_schemes"),
            summary.get("transit_schemes"),
        ):
            if isinstance(value, list) and value:
                return value

        return []

    def _transit_scheme_route_label(self, scheme: Dict[str, Any]) -> str:
        line_name = str(scheme.get("line_name") or "").strip()

        if line_name:
            return self._normalize_transit_line_name(line_name)

        steps = scheme.get("steps") if isinstance(scheme.get("steps"), list) else []
        names = []

        for step in steps:
            if not isinstance(step, dict):
                continue

            name = str(step.get("line_name") or "").strip()

            if name:
                names.append(self._normalize_transit_line_name(name))

        return " -> ".join(names)

    def _normalize_transit_line_name(self, value: Any) -> str:
        text = str(value or "").strip()
        text = text.replace(" | ", " -> ")
        text = text.replace(" - ", " -> ")
        text = text.strip(" ->|")

        return text

    def _format_transit_step(self, step: Dict[str, Any]) -> str:
        step_type = str(step.get("type") or "").strip()
        line_name = self._normalize_transit_line_name(step.get("line_name"))
        instruction = str(step.get("instruction") or "").strip()
        start_station = str(step.get("start_station") or "").strip()
        end_station = str(step.get("end_station") or "").strip()
        stop_count = step.get("stop_count")
        direction = str(step.get("direction") or "").strip()
        distance_text = self._format_meters(step.get("distance_meters"))
        duration_text = self._format_seconds(step.get("duration_seconds"))
        detail_bits = [bit for bit in (distance_text, duration_text) if bit]

        if instruction:
            text = instruction
        elif start_station and end_station and start_station == end_station:
            text = f"换乘 {line_name or step_type}".strip()

            if direction and direction != line_name:
                text += f"（{direction}）"
        elif line_name:
            text = f"乘坐 {line_name}"

            if direction and direction != line_name:
                text += f"（{direction}）"

            if start_station or end_station:
                text += f"：{start_station or '起点'} 到 {end_station or '终点'}"

            if stop_count not in (None, ""):
                text += f"，{stop_count} 站"
        elif step_type:
            text = step_type

            if start_station or end_station:
                text += f"：{start_station or '起点'} 到 {end_station or '终点'}"
        else:
            text = "路线分段"

        if detail_bits:
            text += f"（{'，'.join(detail_bits)}）"

        return text

    def _format_kilometers(self, value: Any) -> str:
        try:
            num = float(value)
        except Exception:
            return ""

        return f"{num:.1f} km" if num >= 10 else f"{num:.2f} km"

    def _format_meters(self, value: Any) -> str:
        try:
            num = float(value)
        except Exception:
            return ""

        if num >= 1000:
            return self._format_kilometers(num / 1000)

        return f"{round(num):.0f} m"

    def _format_minutes(self, value: Any) -> str:
        try:
            minutes = float(value)
        except Exception:
            return ""

        if minutes >= 60:
            hours = int(minutes // 60)
            rest = int(round(minutes % 60))

            if rest:
                return f"{hours} h {rest} min"

            return f"{hours} h"

        if 0 < minutes < 1:
            return "<1 min"

        return f"{int(round(minutes))} min"

    def _format_seconds(self, value: Any) -> str:
        try:
            seconds = float(value)
        except Exception:
            return ""

        return self._format_minutes(seconds / 60)

    def _append_map_metric_lines(self, lines: list, payload: Dict[str, Any]) -> None:
        route = payload.get("route") if isinstance(payload.get("route"), dict) else {}

        if route:
            if route.get("distance_kilometers") is not None:
                lines.append(f"- Distance: {route.get('distance_kilometers')} km")

            if route.get("duration_minutes") is not None:
                lines.append(f"- Duration: {route.get('duration_minutes')} min")

            if route.get("point_count") is not None:
                lines.append(f"- Route Points: {route.get('point_count')}")

            return

        if payload.get("distance_kilometers") is not None:
            lines.append(f"- Straight Distance: {payload.get('distance_kilometers')} km")

        if payload.get("bearing_degrees") is not None:
            lines.append(f"- Initial Bearing: {payload.get('bearing_degrees')} deg")

    def _append_map_point_lines(self, lines: list, payload: Dict[str, Any]) -> None:
        for key, label in (("origin", "Origin"), ("destination", "Destination"), ("point", "Point")):
            point = payload.get(key)

            if not isinstance(point, dict):
                continue

            lng = point.get("lng")
            lat = point.get("lat")
            lines.append(f"- {label}: `{lng},{lat}`")

    def _append_map_poi_table(self, lines: list, payload: Dict[str, Any]) -> None:
        results = payload.get("results")

        if not isinstance(results, list) or not results:
            return

        lines.extend([
            "",
            "### POI Results",
            "",
            "| Name | Address | Coordinate |",
            "| --- | --- | --- |",
        ])

        for item in results[:10]:
            if not isinstance(item, dict):
                continue

            point = item.get("point") if isinstance(item.get("point"), dict) else {}
            coord = f"{point.get('lng', '')},{point.get('lat', '')}".strip(",")
            lines.append(
                "| "
                + self._escape_table_cell(item.get("name"))
                + " | "
                + self._escape_table_cell(item.get("address"))
                + " | "
                + self._escape_table_cell(coord)
                + " |"
            )

    def _render_arxiv_search(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("arxiv_search", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False
        lines = [
            self._status_title(success, "## arXiv Search Results", "## arXiv Search Failed"),
            "",
            f"- Query: `{payload.get('query') or args.get('query') or ''}`",
        ]
        if payload.get("effective_query"):
            lines.append(f"- Effective Query: `{payload.get('effective_query')}`")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        items = payload.get("items") if isinstance(payload.get("items"), list) else []
        lines.extend([
            f"- Total Results: {payload.get('total_results', '')}",
            f"- Fetched: {payload.get('fetched', '')}",
            f"- Returned: {payload.get('returned', len(items))}",
            f"- Strict: {self._as_bool_text(payload.get('strict', False))}",
        ])

        if not items:
            lines.extend(["", "(no papers returned)"])
            return "\n".join(lines).strip()

        for index, item in enumerate(items[:20], start=1):
            if not isinstance(item, dict):
                continue
            authors = item.get("authors") if isinstance(item.get("authors"), list) else []
            cats = item.get("categories") if isinstance(item.get("categories"), list) else []
            title = str(item.get("title") or "(untitled)").replace("\n", " ").strip()
            lines.extend([
                "",
                f"### {index}. {title}",
                "",
                f"- ID: {item.get('id', '')}",
                f"- PDF: {item.get('pdf_url', '')}",
                f"- Published: {item.get('published', '')}",
                f"- Updated: {item.get('updated', '')}",
                f"- Score: {self._format_score(item.get('relevance_score'))}",
            ])
            if authors:
                author_text = ", ".join(str(a) for a in authors[:8])
                if len(authors) > 8:
                    author_text += f", ... +{len(authors) - 8}"
                lines.append(f"- Authors: {author_text}")
            if cats:
                lines.append(f"- Categories: {', '.join(str(c) for c in cats[:12])}")
            summary = str(item.get("summary") or "").strip()
            if summary:
                lines.extend(["", "#### Summary", "", self._markdown_body(summary, limit=2500)])
        if len(items) > 20:
            lines.extend(["", f"... omitted {len(items) - 20} more papers ..."])
        return "\n".join(lines).strip()

    def _render_js_execute(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("js_execute", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        lines = [
            self._status_title(success, "## JavaScript Executed", "## JavaScript Execution Failed"),
            "",
            f"- Executed On: `{payload.get('executed_on', 'client_js')}`",
        ]
        if payload.get("elapsed_ms") is not None:
            lines.append(f"- Elapsed: {payload.get('elapsed_ms')} ms")
        if payload.get("request_id"):
            lines.append(f"- Request ID: `{payload.get('request_id')}`")
        if payload.get("code_normalized") or (isinstance(payload.get("meta"), dict) and payload.get("meta", {}).get("code_normalized")):
            lines.append("- Code Normalized: yes")

        if args.get("code"):
            lines.extend(["", "### Code", "", self._fenced_text(args.get("code"), language="javascript", limit=4000)])

        logs = payload.get("logs") if isinstance(payload.get("logs"), list) else []
        if logs:
            lines.extend(["", "### Console", "", self._fenced_text("\n".join(str(x) for x in logs), language="text", limit=5000)])

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])

        if "result" in payload and payload.get("result") is not None:
            value = payload.get("result")
            if isinstance(value, (dict, list)):
                body = json.dumps(value, ensure_ascii=False, indent=2)
                language = "json"
            else:
                body = str(value)
                language = "text"
            lines.extend(["", "### Result", "", self._fenced_text(body, language=language, limit=8000)])

        return "\n".join(lines).strip()

    def _render_file_semantic_search(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("cloud_file_search_semantic", payload)

        if not isinstance(payload, list):
            text = str(result or "").strip()
            success = self._looks_successful_text(text)
            return "\n".join([
                self._status_title(success, "## File Semantic Search", "## File Semantic Search Failed"),
                "",
                f"- Query: `{args.get('query', '')}`",
                f"- File Filter: `{args.get('file_alias', '')}`" if args.get("file_alias") else "- File Filter: `(all files)`",
                "",
                self._markdown_body(text or "(empty)", limit=4000),
            ]).strip()

        lines = [
            "## File Semantic Search",
            "",
            f"- Query: `{args.get('query', '')}`",
            f"- File Filter: `{args.get('file_alias', '')}`" if args.get("file_alias") else "- File Filter: `(all files)`",
            f"- Results: {len(payload)}",
        ]

        for index, item in enumerate(payload[:20], start=1):
            if not isinstance(item, dict):
                continue
            file_label = item.get("file_alias") or item.get("article") or item.get("title") or "(unknown)"
            lines.extend([
                "",
                f"### Result {index}: {file_label}",
                "",
            ])
            if item.get("score") is not None:
                lines.append(f"- Score: {self._format_score(item.get('score'))}")
            lines.append(f"- Chunk: `{item.get('chunk_id', '')}` {item.get('chunk_start', '')}:{item.get('chunk_end', '')}")
            if item.get("query_position_abs") is not None:
                lines.append(f"- Query Position: {item.get('query_position_abs')}")
            preview = str(item.get("preview") or "").strip()
            if preview:
                lines.extend(["", "#### Preview", "", self._fenced_text(preview, language="markdown", limit=2500)])
        if len(payload) > 20:
            lines.extend(["", f"... omitted {len(payload) - 20} more results ..."])
        return "\n".join(lines).strip()

    def _render_context_length(self, args: Dict[str, Any], result: Any) -> str:
        return "\n".join([
            "## Conversation Context Length",
            "",
            f"- Offset: `{args.get('offset', 0)}`",
            "",
            self._markdown_body(result, limit=1000),
        ]).strip()

    def _render_context(self, args: Dict[str, Any], result: Any) -> str:
        return "\n".join([
            "## Conversation Context Read",
            "",
            f"- Offset: `{args.get('offset', 0)}`",
            f"- Range: {args.get('from_pos', 0)}:{args.get('to_pos', '')}",
            "",
            "### Content",
            "",
            self._fenced_text(result, language="markdown", limit=14000),
        ]).strip()

    def _render_context_keyword_search(self, args: Dict[str, Any], result: Any) -> str:
        text = str(result or "").strip()
        success = not text.startswith("对话不存在")
        return "\n".join([
            self._status_title(success, "## Conversation Context Search", "## Conversation Context Search Failed"),
            "",
            f"- Offset: `{args.get('offset', 0)}`",
            f"- Keyword: `{args.get('keyword', '')}`",
            f"- Range: {args.get('range', 10)}",
            "",
            "### Matches",
            "",
            self._fenced_text(text or "(empty)", language="markdown", limit=12000),
        ]).strip()

    def _render_send_email(self, args: Dict[str, Any], result: Any) -> str:
        text = str(result or "").strip()
        success = text.startswith("邮件发送成功")
        lines = [
            self._status_title(success, "## Email Sent", "## Email Send Failed"),
            "",
            f"- To: `{args.get('recipient') or args.get('to') or ''}`",
            f"- Subject: {args.get('subject') or '(No Subject)'}",
        ]
        if args.get("knowledge_title"):
            lines.append(f"- Knowledge Source: `{args.get('knowledge_title')}`")
        if args.get("content") is not None:
            lines.append(f"- Content Chars: {len(str(args.get('content') or ''))}")
        lines.extend(["", "### Result", "", self._markdown_body(text, limit=3000)])
        return "\n".join(lines).strip()

    def _render_email_list(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("get_email_list", payload)

        if not isinstance(payload, dict):
            text = str(result or "").strip()
            return "\n".join([
                self._status_title(self._looks_successful_text(text), "## Email List", "## Email List Failed"),
                "",
                self._markdown_body(text, limit=4000),
            ]).strip()

        success = payload.get("success", True) is not False
        lines = [
            self._status_title(success, "## Email List", "## Email List Failed"),
            "",
            f"- Mailbox: `{payload.get('group', '')}/{payload.get('username', '')}`",
            f"- Type: `{payload.get('type', '')}`",
            f"- Date Range: {payload.get('date_range', '')} days",
            f"- Offset: {payload.get('offset', '')}",
            f"- Limit: {payload.get('limit', '')}",
        ]
        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        mails = payload.get("mails") if isinstance(payload.get("mails"), list) else []
        lines.append(f"- Total: {payload.get('total', len(mails))}")
        if not mails:
            lines.extend(["", "(empty)"])
            return "\n".join(lines).strip()

        lines.extend([
            "",
            "| # | ID | Date | Sender | Subject |",
            "| --- | --- | --- | --- | --- |",
        ])
        for index, item in enumerate(mails[:100], start=1):
            if not isinstance(item, dict):
                continue
            lines.append(
                "| {idx} | `{mid}` | {date} | {sender} | {title} |".format(
                    idx=index,
                    mid=self._escape_table_cell(item.get("id")),
                    date=self._escape_table_cell(item.get("date")),
                    sender=self._escape_table_cell(item.get("sender")),
                    title=self._escape_table_cell(item.get("title")),
                )
            )
        if len(mails) > 100:
            lines.extend(["", f"... omitted {len(mails) - 100} more emails ..."])
        return "\n".join(lines).strip()

    def _render_email(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("get_email", payload)

        if not isinstance(payload, dict):
            text = str(result or "").strip()
            return "\n".join([
                self._status_title(self._looks_successful_text(text), "## Email Read", "## Email Read Failed"),
                "",
                self._markdown_body(text, limit=4000),
            ]).strip()

        success = payload.get("success", True) is not False
        mail = payload.get("mail") if isinstance(payload.get("mail"), dict) else {}
        lines = [
            self._status_title(success, "## Email Read", "## Email Read Failed"),
            "",
            f"- Mailbox: `{payload.get('group', '')}/{payload.get('username', '')}`",
            f"- Mail ID: `{mail.get('id') or args.get('mail_id') or ''}`",
        ]
        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        lines.extend([
            f"- Subject: {mail.get('subject', '')}",
            f"- From: {mail.get('sender', '')}",
            f"- To: {mail.get('recipient', '')}",
            f"- Date: {mail.get('date', '')}",
            f"- Read: {self._as_bool_text(mail.get('is_read', False))}",
            f"- Size: {mail.get('size', '')} bytes",
            f"- Truncated: {self._as_bool_text(mail.get('truncated', False))}",
        ])

        content_text = str(mail.get("content_text") or "").strip()
        if content_text:
            lines.extend(["", "### Text Body", "", self._fenced_text(content_text, language="markdown", limit=12000)])

        if mail.get("content_html"):
            lines.extend(["", "### HTML Body", "", self._fenced_text(mail.get("content_html"), language="html", limit=8000)])
        if mail.get("content_raw"):
            lines.extend(["", "### Raw Content", "", self._fenced_text(mail.get("content_raw"), language="text", limit=8000)])
        return "\n".join(lines).strip()

    def _render_knowledge_list(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("knowledge_list", payload)

        raw_text = str(result or "").strip()
        if raw_text.startswith("[用户画像短期记忆]"):
            body = raw_text.replace("[用户画像短期记忆]", "", 1).strip()
            return "\n".join([
                "## User Profile Memory",
                "",
                "- Type: short-term profile",
                "",
                "### Content",
                "",
                self._markdown_body(body or "(empty)", limit=4000),
            ]).strip()

        if not isinstance(payload, dict):
            return raw_text

        success = payload.get("success", True) is not False
        title = self._status_title(success, "## Knowledge List", "## Knowledge List Failed")
        lines = [
            title,
            "",
            f"- Type: `{payload.get('type') or args.get('_type') or 'basis'}`",
            f"- Total: {payload.get('total', 0)}",
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        items = payload.get("items")
        if not isinstance(items, list) or not items:
            lines.extend(["", "(empty)"])
            return "\n".join(lines).strip()

        lines.extend([
            "",
            "| # | Title | Basis ID | Flags |",
            "| --- | --- | --- | --- |",
        ])
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                continue
            flags = []
            if item.get("pin"):
                flags.append("pin")
            if item.get("public"):
                flags.append("public")
            if item.get("collaborative"):
                flags.append("collab")
            if item.get("model_readonly", False):
                flags.append("readonly")
            lines.append(
                "| {idx} | {title} | `{basis_id}` | {flags} |".format(
                    idx=index,
                    title=self._escape_table_cell(item.get("title")),
                    basis_id=self._escape_table_cell(item.get("basis_id") or ""),
                    flags=self._escape_table_cell(", ".join(flags) or "-"),
                )
            )
        return "\n".join(lines).strip()

    def _render_user_profile_memory(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("memory_profile_read", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False
        title = self._status_title(success, "## User Profile Memory", "## User Profile Memory Failed")
        lines = [
            title,
            "",
            self._length_line(payload),
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        lines.extend([
            "",
            "### Content",
            "",
            self._markdown_body(payload.get("profile", "") or "(empty)", limit=4000),
        ])
        return "\n".join(lines).strip()

    def _render_user_profile_update(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("memory_short_update", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False
        title = self._status_title(success, "## User Profile Updated", "## User Profile Update Failed")
        lines = [
            title,
            "",
            f"- Reset: {self._as_bool_text(payload.get('reset', False))}",
            self._length_line(payload),
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        lines.extend([
            "",
            "### Current Profile",
            "",
            self._markdown_body(payload.get("profile", "") or "(empty)", limit=4000),
        ])
        return "\n".join(lines).strip()

    def _render_workspace_draft_update(self, args: Dict[str, Any], result: Any) -> str:
        """Render Workspace draft tool results into Markdown for model-visible tool output."""
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return "\n".join([
                "## Workspace Draft Result Parse Failed",
                "",
                f"- Tool: `{str(args.get('_tool_name') or 'workspace_draft_add')}`",
                "",
                "### Raw Result",
                "",
                self._fenced_text(result, language="text", limit=4000),
            ]).strip()

        success = payload.get("success", True) is not False and not payload.get("error")
        lines = [self._status_title(success, "## Workspace Draft Appended", "## Workspace Draft Append Failed"), ""]

        if success:
            lines.extend([
                f"- Draft ID: `{payload.get('draft_id') or ''}`",
                f"- Title: {payload.get('title') or ''}",
                f"- Chars: {payload.get('chars', 0)}",
                f"- Total Drafts: {payload.get('total', 0)}",
            ])
        else:
            lines.append(f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}")

        return "\n".join(lines).strip()

    def _render_workspace_memory_update(self, args: Dict[str, Any], result: Any) -> str:
        """Render Workspace memory mutation results into Markdown for model-visible tool output."""
        payload = self._load_payload(result)
        tool_name = str(args.get("_tool_name") or "").strip()

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload(tool_name or "workspace_mem", payload)

        title_map = {
            "workspace_mem_apply_diff": ("## Workspace Memory Diff Applied", "## Workspace Memory Diff Failed"),
            "workspace_mem_edit": ("## Workspace Memory Edited", "## Workspace Memory Edit Failed"),
            "workspace_mem_add": ("## Workspace Memory Appended", "## Workspace Memory Append Failed"),
        }
        success_title, failed_title = title_map.get(tool_name, ("## Workspace Memory Updated", "## Workspace Memory Update Failed"))

        if not isinstance(payload, dict):
            return "\n".join([
                "## Workspace Memory Result Parse Failed",
                "",
                f"- Tool: `{tool_name or 'workspace_mem'}`",
                "",
                "### Raw Result",
                "",
                self._fenced_text(result, language="text", limit=4000),
            ]).strip()

        success = payload.get("success", True) is not False and not payload.get("error")
        stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
        mode = str(stats.get("mode") or "").strip()
        title = "## Workspace Memory Preview" if payload.get("dry_run") else success_title
        lines = [
            self._status_title(success, title, failed_title),
            "",
            f"- Workspace: `{payload.get('workspace_id') or args.get('workspace_id') or ''}`",
        ]

        if mode:
            lines.append(f"- Mode: `{mode}`")

        if payload.get("changed") is not None:
            lines.append(f"- Changed: {self._as_bool_text(payload.get('changed'))}")

        if payload.get("dry_run") is not None:
            lines.append(f"- Dry Run: {self._as_bool_text(payload.get('dry_run'))}")

        if payload.get("chars") is not None:
            lines.append(f"- Chars: {payload.get('chars')} / {payload.get('limit', '')}")

        if payload.get("old_sha256") or payload.get("new_sha256") or payload.get("sha256"):
            old_sha = payload.get("old_sha256")
            new_sha = payload.get("new_sha256") or payload.get("sha256")
            lines.append(f"- SHA256: `{self._short_hash(old_sha)}` -> `{self._short_hash(new_sha)}`")

        if payload.get("expected_sha256"):
            lines.append(f"- Expected SHA256: `{self._short_hash(payload.get('expected_sha256'))}`")

        if stats.get("edit_count") is not None:
            lines.append(f"- Edits: {stats.get('edit_count')}")

        if stats.get("hunk_count") is not None:
            lines.append(f"- Hunks: {stats.get('hunk_count')}")

        if not payload.get("dry_run") and (
            stats.get("added_lines") is not None or stats.get("removed_lines") is not None
        ):
            lines.append(f"- Lines: +{stats.get('added_lines', 0)} / -{stats.get('removed_lines', 0)}")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            content = str(payload.get("content") or "").strip()

            if content:
                lines.extend([
                    "",
                    "### Current Workspace Memory",
                    "",
                    self._fenced_text(content, language="markdown", limit=12000),
                ])

            return "\n".join(lines).strip()

        patch_text = str(args.get("patch") or "").strip()

        if patch_text:
            lines.extend([
                "",
                "### Requested Patch",
                "",
                self._fenced_text(patch_text, language="diff", limit=8000),
            ])
        else:
            edits_text = self._format_structured_edits(args.get("edits"))

            if edits_text:
                lines.extend(["", "### Requested Structured Edits", "", edits_text])

        preview_diff = str(payload.get("preview_diff") or "").strip()

        if preview_diff:
            lines.extend([
                "",
                "### Preview Diff",
                "",
                self._fenced_text(preview_diff, language="diff", limit=8000),
            ])

        content = str(payload.get("content") or "").strip()

        if content:
            lines.extend([
                "",
                "### Current Workspace Memory",
                "",
                self._fenced_text(content, language="markdown", limit=12000),
            ])
        else:
            lines.extend([
                "",
                "### Current Workspace Memory",
                "",
                self._fenced_text("(empty)", language="markdown", limit=12000),
            ])

        return "\n".join(lines).strip()

    def _render_knowledge_mutation(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("knowledge_mutation", payload)

        tool_title = {
            "knowledge_basis_create": ("## Knowledge Added", "## Knowledge Add Failed"),
            "knowledge_basis_delete": ("## Knowledge Removed", "## Knowledge Remove Failed"),
            "knowledge_basis_update": ("## Knowledge Updated", "## Knowledge Update Failed"),
            "link_knowledge": ("## Knowledge Linked", "## Knowledge Link Failed"),
            "categorize_knowledge": ("## Knowledge Categorized", "## Knowledge Categorize Failed"),
            "create_category": ("## Knowledge Category Created", "## Knowledge Category Create Failed"),
        }
        tool_name = str(args.get("_tool_name") or "").strip()
        success_title, failed_title = tool_title.get(tool_name, ("## Knowledge Tool Completed", "## Knowledge Tool Failed"))

        if isinstance(payload, dict) and (
            payload.get("mode")
            or payload.get("diff")
            or payload.get("old_sha256")
            or payload.get("new_sha256")
        ):
            success = payload.get("success", True) is not False and not payload.get("error")
            changed = bool(payload.get("changed", False))
            preview_title = "## Knowledge Patch Preview" if payload.get("dry_run") else success_title
            title = self._status_title(success, preview_title, failed_title)
            lines = [
                title,
                "",
                f"- Knowledge: `{payload.get('title') or args.get('title') or ''}`",
                f"- Changed: {self._as_bool_text(changed)}",
            ]

            if payload.get("dry_run") is not None:
                lines.append(f"- Dry Run: {self._as_bool_text(payload.get('dry_run'))}")

            if payload.get("mode"):
                lines.append(f"- Mode: `{payload.get('mode')}`")

            if payload.get("edit_count") is not None:
                lines.append(f"- Edits: {payload.get('edit_count')}")

            if payload.get("hunk_count") is not None:
                lines.append(f"- Hunks: {payload.get('hunk_count')}")

            if not payload.get("dry_run") and (
                payload.get("added_lines") is not None or payload.get("removed_lines") is not None
            ):
                lines.append(f"- Lines: +{payload.get('added_lines', 0)} / -{payload.get('removed_lines', 0)}")

            if payload.get("old_sha256") or payload.get("new_sha256"):
                lines.append(
                    f"- SHA256: `{self._short_hash(payload.get('old_sha256'))}` -> `{self._short_hash(payload.get('new_sha256'))}`"
                )

            if not success:
                lines.extend(["", f"Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
                return "\n".join(lines).strip()

            patch_text = str(args.get("patch") or "").strip()

            if patch_text:
                lines.extend([
                    "",
                    "### Patch",
                    "",
                    self._fenced_text(patch_text, language="diff", limit=8000),
                ])
            else:
                edits_text = self._format_structured_edits(args.get("edits"))

                if edits_text:
                    lines.extend([
                        "",
                        "### Structured Edits",
                        "",
                        edits_text,
                    ])

            if payload.get("diff"):
                lines.extend([
                    "",
                    "### Result Diff",
                    "",
                    self._fenced_text(payload.get("diff"), language="diff", limit=12000),
                ])

            return "\n".join(lines).strip()

        raw_text = str(result or "").strip()
        success = payload.get("success", True) is not False if isinstance(payload, dict) else self._looks_successful_text(raw_text)
        title = self._status_title(success, success_title, failed_title)
        lines = [title]

        title_value = str(args.get("title") or "").strip()
        new_title = str(args.get("new_title") or "").strip()
        if title_value or new_title:
            if new_title and new_title != title_value:
                lines.extend(["", f"- Knowledge: `{title_value}` -> `{new_title}`"])
            else:
                lines.extend(["", f"- Knowledge: `{title_value or new_title}`"])

        if args.get("source") or args.get("target"):
            lines.append(f"- Connection: `{args.get('source', '')}` -> `{args.get('target', '')}`")
        if args.get("relation"):
            lines.append(f"- Relation: `{args.get('relation')}`")
        if args.get("category") or args.get("name"):
            lines.append(f"- Category: `{args.get('category') or args.get('name')}`")
        if args.get("url"):
            lines.append(f"- URL: {args.get('url')}")

        changed = []
        if args.get("context") is not None:
            changed.append(f"content ({len(str(args.get('context') or ''))} chars)")
        if args.get("replacement") is not None or args.get("replacements"):
            changed.append("range replacement")
        if args.get("patch") or args.get("edits"):
            changed.append("patch")
        if args.get("public") is not None:
            changed.append(f"public={bool(args.get('public'))}")
        if args.get("collaborative") is not None:
            changed.append(f"collaborative={bool(args.get('collaborative'))}")
        if changed:
            lines.append(f"- Changed: {', '.join(changed)}")

        if raw_text:
            lines.extend(["", "### Result", "", self._markdown_body(raw_text, limit=4000)])
        return "\n".join(lines).strip()

    def _is_basis_content_payload(self, payload: Any) -> bool:
        if not isinstance(payload, dict):
            return False
        return any(key in payload for key in ("success", "mode", "content", "matches", "matched", "total_length"))

    def _render_basis_content(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("knowledge_basis_read", payload)

        if not self._is_basis_content_payload(payload):
            title = str(args.get("title") or "").strip()
            basis_id = str(args.get("basis_id") or "").strip()
            lines = ["## Knowledge Content"]
            if title:
                lines.extend(["", f"- Knowledge: `{title}`"])
            if basis_id:
                lines.append(f"- Basis ID: `{basis_id}`")
            lines.extend(["", "### Content", "", self._markdown_body(result, limit=16000)])
            return "\n".join(lines).strip()

        success = payload.get("success", True) is not False
        mode = str(payload.get("mode") or "content")
        title = str(payload.get("title") or args.get("title") or "").strip()
        basis_id = str(payload.get("basis_id") or args.get("basis_id") or "").strip()
        heading = "## Knowledge Content"
        if mode == "slice":
            heading = "## Knowledge Content Slice"
        elif mode in {"keyword", "regex"}:
            heading = "## Knowledge Content Matches"
        heading = self._status_title(success, heading, "## Knowledge Content Read Failed")

        lines = [heading]
        if title:
            lines.extend(["", f"- Knowledge: `{title}`"])
        if basis_id:
            lines.append(f"- Basis ID: `{basis_id}`")
        if payload.get("total_length") is not None:
            lines.append(f"- Total Chars: {payload.get('total_length')}")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        if mode == "slice":
            offset = int(payload.get("offset", 0) or 0)
            end_offset = payload.get("end_offset")
            if end_offset is None:
                end_offset = offset + int(payload.get("length", 0) or 0)
            lines.append(f"- Range: {offset}:{end_offset}")
            lines.extend(["", "### Content", "", self._markdown_body(payload.get("content", ""), limit=16000)])
            return "\n".join(lines).strip()

        matches = payload.get("matches")
        if isinstance(matches, list):
            lines.extend([
                f"- Keyword: `{payload.get('keyword', '')}`",
                f"- Matched: {payload.get('matched', len(matches))}",
            ])
            for match in matches[:20]:
                if not isinstance(match, dict):
                    continue
                index = match.get("index", "")
                lines.extend([
                    "",
                    f"### Match {index}",
                    "",
                    f"- Position: {match.get('start', '')}:{match.get('end', '')}",
                    f"- Line: {match.get('start_line', match.get('line', ''))}, Col: {match.get('start_col', match.get('col', ''))}",
                    f"- Match: `{match.get('match', '')}`",
                    "",
                    "#### Snippet",
                    "",
                    self._fenced_text(match.get("snippet", ""), language="markdown", limit=3000),
                ])
            if len(matches) > 20:
                lines.extend(["", f"... omitted {len(matches) - 20} more matches ..."])
            return "\n".join(lines).strip()

        lines.extend(["", "### Content", "", self._markdown_body(payload.get("content", ""), limit=16000)])
        return "\n".join(lines).strip()

    def _render_knowledge_keyword_search(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("knowledge_search_keyword", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False
        lines = [
            self._status_title(success, "## Knowledge Keyword Search", "## Knowledge Keyword Search Failed"),
            "",
            f"- Keyword: `{payload.get('keyword') or args.get('keyword') or ''}`",
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or payload.get('error') or 'unknown error'}"])
            return "\n".join(lines).strip()

        articles = payload.get("articles") if isinstance(payload.get("articles"), list) else []
        matches = payload.get("matches") if isinstance(payload.get("matches"), list) else []
        lines.extend([
            f"- Matched: {payload.get('matched', len(matches))}",
            f"- Articles: {len(articles)}",
        ])

        # 按条目（article）合并命中：同一知识条目下的多个命中聚成一段，
        # 只列条目名 + 命中数 + 去重后的若干片段，避免逐命中重复整块 snippet。
        if matches:
            grouped = {}
            order = []

            for match in matches:
                if not isinstance(match, dict):
                    continue

                article = str(match.get("article") or "")

                if article not in grouped:
                    grouped[article] = {
                        "source_type": match.get("source_type", "match"),
                        "basis_id": match.get("basis_id", ""),
                        "snippets": [],
                        "count": 0,
                    }
                    order.append(article)

                entry = grouped[article]
                entry["count"] += 1
                snippet = str(match.get("snippet") or "").replace("\n", " ").strip()

                if snippet and snippet not in entry["snippets"] and len(entry["snippets"]) < 3:
                    entry["snippets"].append(snippet)

            lines.extend(["", "### Matches"])

            for article in order[:20]:
                entry = grouped[article]
                lines.extend(["", f"#### {entry['source_type']}: {article} ({entry['count']} hits)"])

                if entry["basis_id"]:
                    lines.append(f"- Basis ID: `{entry['basis_id']}`")

                for snippet in entry["snippets"]:
                    lines.append(f"- …{snippet}…")

            if len(order) > 20:
                lines.extend(["", f"... omitted {len(order) - 20} more articles ..."])

        return "\n".join(lines).strip()

    def _render_unified_search(self, args: Dict[str, Any], result: Any) -> str:
        """统一 search 工具的结果渲染：按来源分组，空来源跳过，notes 汇总说明。"""

        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("search", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False
        lines = [
            self._status_title(success, "## Search", "## Search Failed"),
            "",
            f"- Query: `{payload.get('query') or args.get('query') or ''}`",
            f"- Scope: {payload.get('scope') or 'all'}",
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        results = payload.get("results") if isinstance(payload.get("results"), dict) else {}

        knowledge = results.get("knowledge") if isinstance(results.get("knowledge"), list) else []
        if knowledge:
            lines.extend(["", f"### Knowledge ({len(knowledge)})"])
            for item in knowledge:
                if not isinstance(item, dict):
                    continue
                snippet = str(item.get("snippet") or "").strip()
                matched_by = str(item.get("matched_by") or "keyword")
                lines.append(f"- **{item.get('title', '')}** ({matched_by})" + (f" — {snippet}" if snippet else ""))

        files = results.get("files") if isinstance(results.get("files"), list) else []
        if files:
            lines.extend(["", f"### Files ({len(files)})"])
            for item in files:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "")
                alias = str(item.get("alias") or "")
                lines.append(f"- {name}" + (f" (`{alias}`)" if alias and alias != name else ""))

        web = results.get("web") if isinstance(results.get("web"), list) else []
        if web:
            lines.extend(["", f"### Web ({len(web)})"])
            for item in web:
                if not isinstance(item, dict):
                    continue
                snippet = str(item.get("snippet") or "").strip()
                lines.append(f"- [{item.get('title', '')}]({item.get('url', '')})" + (f" — {snippet}" if snippet else ""))

        if not knowledge and not files and not web:
            lines.extend(["", "- No results found in any enabled source."])

        notes = payload.get("notes") if isinstance(payload.get("notes"), list) else []
        if notes:
            lines.extend(["", "### Notes"])
            for note in notes:
                lines.append(f"- {note}")

        return "\n".join(lines).strip()

    def _render_exa_web_search(self, args: Dict[str, Any], result: Any) -> str:
        """
        Exa Web Search 渲染：突出神经搜索的高亮片段与来源可追溯性

        前端效果：
        - 标题带 Exa 标识与查询词，折叠面板内标题由 toolFlow 统一显示为「Exa 搜索 xxx」
        - 展开区为 Markdown：编号标题+链接、发布日期/评分、Snippet 引用块、Highlights 引用块
        - 移动端友好：无宽表格，仅用标题、列表与引用块，避免横向滚动
        """

        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("exa_web_search", payload)

        if not isinstance(payload, dict):
            text = str(result or "").strip()
            success = self._looks_successful_text(text)
            title = self._status_title(success, "## Exa Web Search", "## Exa Web Search Failed")

            return "\n".join([
                title,
                "",
                f"- Query: `{args.get('query', '')}`",
                "",
                self._markdown_body(text or "(empty)", limit=6000),
            ]).strip()

        success = payload.get("success", True) is not False

        query = str(payload.get("query") or args.get("query") or "").strip()
        search_type = str(payload.get("type") or args.get("type") or "auto").strip() or "auto"

        lines = [
            self._status_title(success, "## Exa Web Search", "## Exa Web Search Failed"),
            "",
            f"- Query: `{self._escape_table_cell(query) or '(empty)'}`",
            f"- Type: `{search_type}`",
        ]

        if not success:
            reason = str(payload.get("error") or payload.get("message") or "unknown error").strip()
            lines.extend(["", f"- Reason: {reason}"])

            return "\n".join(lines).strip()

        results = payload.get("results") if isinstance(payload.get("results"), list) else []

        if not results and isinstance(payload.get("error"), str) and payload.get("error"):
            lines.extend(["", f"- Reason: {payload.get('error')}"])

            return "\n".join(lines).strip()

        lines.append(f"- Results: {len(results)}")

        if not results:
            lines.extend(["", "- No results found."])

            return "\n".join(lines).strip()

        seen_images: set = set()
        for index, item in enumerate(results[:20], start=1):
            if not isinstance(item, dict):
                continue

            title = str(item.get("title") or "").strip() or "(untitled)"
            url = str(item.get("url") or "").strip()
            snippet = str(item.get("snippet") or "").strip()
            published = str(item.get("published_date") or "").strip()
            score = item.get("score")
            highlights = item.get("highlights") if isinstance(item.get("highlights"), list) else []
            image = str(item.get("image") or "").strip()
            favicon = str(item.get("favicon") or "").strip()
            author = str(item.get("author") or "").strip()

            # 标题行：带编号的可点击链接（Markdown），移动端自动换行；favicon 作为小图标可选
            if url:
                lines.extend(["", f"### {index}. [{self._escape_table_cell(title)}]({url})"])
                # URL 仅保留一行，避免与标题重复过长；favicon/author 作为轻量元信息
            else:
                lines.extend(["", f"### {index}. {self._escape_table_cell(title)}"])

            meta_bits = []

            if published:
                meta_bits.append(f"{published}")

            if author:
                meta_bits.append(f"{self._escape_table_cell(author)}")

            if isinstance(score, (int, float)):
                meta_bits.append(f"score {self._format_score(score)}")

            if meta_bits:
                lines.append(f"- {' | '.join(meta_bits)}")

            if url:
                lines.append(f"- {url}")

            # Snippet 精简为 320 字，减少 token
            if snippet:
                clipped_snippet = snippet[:320].replace("\n", " ").strip()

                if clipped_snippet:
                    lines.extend(["", f"> {clipped_snippet}"])

            # Highlights 精简为 2 条 *280 字，token 友好
            if highlights:
                for hl in highlights[:2]:
                    text = str(hl or "").strip().replace("\n", " ")

                    if not text:
                        continue

                    clipped = text[:280]
                    lines.append(f"> {clipped}")

            # 纯 Markdown 图片：仅渲染可信的真实配图，过滤 favicon/logo 小图标并去重；favicon 不返回给模型
            if self._is_displayable_exa_image(image):
                if image not in seen_images:
                    seen_images.add(image)
                    if len(seen_images) <= 3:
                        alt = self._escape_table_cell(title)[:40]
                        lines.extend(["", f"![{alt}]({image})"])

        # 结构化输出（outputSchema）透传提示
        if isinstance(payload.get("output"), dict) and payload.get("output"):
            lines.extend(["", "### Structured Output", "", self._fenced_text(json.dumps(payload.get("output"), ensure_ascii=False, indent=2), language="json", limit=3000)])

        return "\n".join(lines).strip()

    def _render_vector_search(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("knowledge_search_vector", payload)

        if not isinstance(payload, list):
            text = str(result or "").strip()
            success = self._looks_successful_text(text)
            title = self._status_title(success, "## Knowledge Vector Search", "## Knowledge Vector Search Failed")
            return "\n".join([
                title,
                "",
                f"- Query: `{args.get('query', '')}`",
                f"- Library: `{args.get('library', 'knowledge')}`",
                "",
                self._markdown_body(text or "(empty)", limit=4000),
            ]).strip()

        lines = [
            "## Knowledge Vector Search",
            "",
            f"- Query: `{args.get('query', '')}`",
            f"- Library: `{args.get('library', 'knowledge')}`",
            f"- Results: {len(payload)}",
        ]

        for index, item in enumerate(payload[:20], start=1):
            if not isinstance(item, dict):
                continue
            lines.extend([
                "",
                f"### Result {index}: {item.get('title') or item.get('article') or '(untitled)'}",
                "",
            ])
            if item.get("basis_id"):
                lines.append(f"- Basis ID: `{item.get('basis_id', '')}`")
            if item.get("score") is not None:
                lines.append(f"- Score: {self._format_score(item.get('score'))}")
            lines.append(f"- Chunk: `{item.get('chunk_id', '')}` {item.get('chunk_start', '')}:{item.get('chunk_end', '')}")
            if item.get("query_position_abs") is not None:
                lines.append(f"- Query Position: {item.get('query_position_abs')}")
            preview = str(item.get("preview") or "").strip()
            if preview:
                lines.extend(["", "#### Preview", "", self._fenced_text(preview, language="markdown", limit=2500)])

        if len(payload) > 20:
            lines.extend(["", f"... omitted {len(payload) - 20} more results ..."])
        return "\n".join(lines).strip()

    def _learning_book_label(self, book: Any) -> str:
        if not isinstance(book, dict):
            return ""
        return str(book.get("title") or book.get("id") or book.get("book_id") or "").strip()

    def _learning_lecture_label(self, lecture: Any) -> str:
        if not isinstance(lecture, dict):
            return ""
        return str(lecture.get("title") or lecture.get("id") or lecture.get("lecture_id") or "").strip()

    def _append_learning_lecture_table(self, lines: list, lectures: Any) -> None:
        if not isinstance(lectures, list) or not lectures:
            return
        lines.extend([
            "",
            "### Lectures",
            "",
            "| # | Title | ID | Status | Progress | Books |",
            "| --- | --- | --- | --- | --- | --- |",
        ])
        for index, lecture in enumerate(lectures[:80], start=1):
            if not isinstance(lecture, dict):
                continue
            lines.append(
                "| {idx} | {title} | `{lid}` | {status} | {progress}% | {books} |".format(
                    idx=index,
                    title=self._escape_table_cell(lecture.get("title")),
                    lid=self._escape_table_cell(lecture.get("id") or lecture.get("lecture_id")),
                    status=self._escape_table_cell(lecture.get("status")),
                    progress=self._escape_table_cell(lecture.get("progress", "")),
                    books=self._escape_table_cell(lecture.get("books_count", "")),
                )
            )
        if len(lectures) > 80:
            lines.extend(["", f"... omitted {len(lectures) - 80} more lectures ..."])

    def _append_learning_book_table(self, lines: list, books: Any) -> None:
        if not isinstance(books, list) or not books:
            return
        lines.extend([
            "",
            "### Books",
            "",
            "| # | Title | ID | Text | Coarse | Intensive | Sections | Vectors |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ])
        for index, book in enumerate(books[:80], start=1):
            if not isinstance(book, dict):
                continue
            vector_text = book.get("vector_status") or ""
            if book.get("vector_count"):
                vector_text = f"{vector_text} ({book.get('vector_count')})".strip()
            lines.append(
                "| {idx} | {title} | `{bid}` | {text} | {coarse} | {intensive} | {sections} | {vectors} |".format(
                    idx=index,
                    title=self._escape_table_cell(book.get("title")),
                    bid=self._escape_table_cell(book.get("id") or book.get("book_id")),
                    text=self._escape_table_cell(book.get("text_status")),
                    coarse=self._escape_table_cell(book.get("coarse_status")),
                    intensive=self._escape_table_cell(book.get("intensive_status")),
                    sections=self._escape_table_cell(book.get("section_status")),
                    vectors=self._escape_table_cell(vector_text),
                )
            )
        if len(books) > 80:
            lines.extend(["", f"... omitted {len(books) - 80} more books ..."])

    def _render_learning_lectures(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        tool_name = str(args.get("_tool_name") or "").strip()
        title_map = {
            "listLectures": ("## Learning Lectures", "## Learning Lectures Failed"),
            "createLecture": ("## Learning Lecture Created", "## Learning Lecture Create Failed"),
            "getLecture": ("## Learning Lecture", "## Learning Lecture Read Failed"),
            "updateLecture": ("## Learning Lecture Updated", "## Learning Lecture Update Failed"),
        }
        success_title, failed_title = title_map.get(tool_name, ("## Learning Lecture Tool", "## Learning Lecture Tool Failed"))
        success = payload.get("success", True) is not False and not payload.get("error")
        lines = [self._status_title(success, success_title, failed_title)]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        lecture = payload.get("lecture") if isinstance(payload.get("lecture"), dict) else None
        if lecture:
            lines.extend([
                "",
                f"- Lecture: `{self._learning_lecture_label(lecture)}`",
                f"- Lecture ID: `{lecture.get('id') or args.get('lecture_id') or ''}`",
                f"- Status: `{lecture.get('status', '')}`",
                f"- Progress: {lecture.get('progress', 0)}%",
            ])
            if lecture.get("category"):
                lines.append(f"- Category: `{lecture.get('category')}`")
            if lecture.get("books_count") is not None or payload.get("total_books") is not None:
                lines.append(f"- Books: {lecture.get('books_count', payload.get('total_books', ''))}")
            if lecture.get("description"):
                lines.extend(["", "### Description", "", self._markdown_body(lecture.get("description"), limit=1200)])

        lectures = payload.get("lectures") if isinstance(payload.get("lectures"), list) else []
        if lectures:
            lines.extend(["", f"- Total: {payload.get('total', len(lectures))}"])
            self._append_learning_lecture_table(lines, lectures)
        books = payload.get("books") if isinstance(payload.get("books"), list) else []
        if books:
            lines.append(f"- Total Books: {payload.get('total_books', len(books))}")
            self._append_learning_book_table(lines, books)
        if not lecture and not lectures and not books:
            lines.extend(["", "(empty)"])
        return "\n".join(lines).strip()

    def _render_learning_books(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        tool_name = str(args.get("_tool_name") or "").strip()
        title_map = {
            "listBooks": ("## Learning Books", "## Learning Books Failed"),
            "createBook": ("## Learning Book Created", "## Learning Book Create Failed"),
            "getBook": ("## Learning Book", "## Learning Book Read Failed"),
            "updateBook": ("## Learning Book Updated", "## Learning Book Update Failed"),
        }
        success_title, failed_title = title_map.get(tool_name, ("## Learning Book Tool", "## Learning Book Tool Failed"))
        success = payload.get("success", True) is not False and not payload.get("error")
        lines = [self._status_title(success, success_title, failed_title)]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        lecture = payload.get("lecture") if isinstance(payload.get("lecture"), dict) else None
        if lecture:
            lines.extend(["", f"- Lecture: `{self._learning_lecture_label(lecture)}`", f"- Lecture ID: `{lecture.get('id') or args.get('lecture_id') or ''}`"])

        book = payload.get("book") if isinstance(payload.get("book"), dict) else None
        if book:
            lines.extend([
                "",
                f"- Book: `{self._learning_book_label(book)}`",
                f"- Book ID: `{book.get('id') or args.get('book_id') or ''}`",
                f"- Lecture ID: `{book.get('lecture_id') or args.get('lecture_id') or ''}`",
                f"- Source: `{book.get('source_type', '')}`",
                f"- Text: `{book.get('text_status', '')}` ({book.get('text_chars', 0)} chars)",
                f"- Coarse: `{book.get('coarse_status', '')}`",
                f"- Intensive: `{book.get('intensive_status', '')}`",
                f"- Questions: `{book.get('question_status', '')}`",
                f"- Sections: `{book.get('section_status', '')}`",
                f"- Vectors: `{book.get('vector_status', '')}` ({book.get('vector_count', 0)})",
            ])
            if book.get("error"):
                lines.append(f"- Error: {book.get('error')}")
            if book.get("description"):
                lines.extend(["", "### Description", "", self._markdown_body(book.get("description"), limit=1200)])

        books = payload.get("books") if isinstance(payload.get("books"), list) else []
        if books:
            lines.extend(["", f"- Total: {payload.get('total', len(books))}"])
            self._append_learning_book_table(lines, books)
        if not book and not books:
            lines.extend(["", "(empty)"])
        return "\n".join(lines).strip()

    def _render_learning_book_text(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        book = payload.get("book") if isinstance(payload.get("book"), dict) else {}
        tool_name = str(args.get("_tool_name") or "").strip()
        title = self._status_title(
            success,
            "## Learning Book Text Slice" if tool_name == "readBookTextRange" else "## Learning Book Text",
            "## Learning Book Text Read Failed",
        )
        lines = [
            title,
            "",
            f"- Book: `{self._learning_book_label(book) or args.get('book_id') or ''}`",
            f"- Book ID: `{book.get('id') or args.get('book_id') or ''}`",
            f"- Lecture ID: `{book.get('lecture_id') or args.get('lecture_id') or ''}`",
        ]
        if payload.get("offset") is not None:
            lines.append(f"- Range: {payload.get('offset', 0)}:{int(payload.get('offset', 0) or 0) + int(payload.get('length', 0) or 0)}")
        if payload.get("chars") is not None:
            lines.append(f"- Total Chars: {payload.get('chars')}")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        content = str(payload.get("content") if payload.get("content") is not None else payload.get("text") or "")
        lines.extend(["", "### Content", "", self._fenced_text(content, language="markdown", limit=16000)])
        return "\n".join(lines).strip()

    def _render_learning_book_search(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        hits = payload.get("hits") if isinstance(payload.get("hits"), list) else []
        lines = [
            self._status_title(success, "## Learning Book Text Search", "## Learning Book Text Search Failed"),
            "",
            f"- Lecture ID: `{payload.get('lecture_id') or args.get('lecture_id') or ''}`",
            f"- Book Filter: `{payload.get('book_id') or args.get('book_id') or '(all)'}`",
            f"- Query: `{payload.get('query') or args.get('keyword') or ''}`",
            f"- Hits: {payload.get('count', len(hits))}",
            f"- Truncated: {self._as_bool_text(payload.get('truncated', False))}",
        ]

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        if not hits:
            lines.extend(["", "(no matches)"])
            return "\n".join(lines).strip()

        for index, hit in enumerate(hits[:30], start=1):
            if not isinstance(hit, dict):
                continue
            lines.extend([
                "",
                f"### Hit {index}: {hit.get('book_title') or hit.get('book_id') or '(unknown book)'}",
                "",
                f"- Book ID: `{hit.get('book_id', '')}`",
                f"- Offset: {hit.get('match_start', hit.get('offset', ''))}:{hit.get('match_end', '')}",
                "",
                self._fenced_text(hit.get("text", ""), language="markdown", limit=2500),
            ])
        if len(hits) > 30:
            lines.extend(["", f"... omitted {len(hits) - 30} more hits ..."])
        return "\n".join(lines).strip()

    def _render_learning_xml_read(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        book = payload.get("book") if isinstance(payload.get("book"), dict) else {}
        kind = str(payload.get("kind") or "").strip() or str(args.get("_tool_name") or "XML")
        lines = [
            self._status_title(success, "## Learning Book XML Read", "## Learning Book XML Read Failed"),
            "",
            f"- Kind: `{kind}`",
            f"- Book: `{self._learning_book_label(book) or args.get('book_id') or ''}`",
            f"- Book ID: `{book.get('id') or args.get('book_id') or ''}`",
            f"- Chars: {payload.get('chars', len(str(payload.get('content') or '')))}",
        ]
        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()
        lines.extend(["", "### XML", "", self._fenced_text(payload.get("content", ""), language="xml", limit=16000)])
        return "\n".join(lines).strip()

    def _render_learning_xml_write(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        book = payload.get("book") if isinstance(payload.get("book"), dict) else {}
        title_map = {
            "saveBookInfoXml": "coarse XML",
            "saveBookDetailXml": "intensive XML",
            "saveBookQuestionsXml": "questions XML",
        }
        kind = title_map.get(str(args.get("_tool_name") or ""), "XML")
        lines = [
            self._status_title(success, "## Learning Book XML Saved", "## Learning Book XML Save Failed"),
            "",
            f"- Kind: `{kind}`",
            f"- Book: `{self._learning_book_label(book) or args.get('book_id') or ''}`",
            f"- Book ID: `{book.get('id') or args.get('book_id') or ''}`",
            f"- Chars Written: {payload.get('chars', len(str(args.get('content') or '')))}",
        ]
        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
        elif payload.get("summary"):
            lines.extend(["", "### Result", "", self._markdown_body(payload.get("summary"), limit=2000)])
        return "\n".join(lines).strip()

    def _render_learning_vectorization(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        vectorization = payload.get("vectorization") if isinstance(payload.get("vectorization"), dict) else payload
        success = payload.get("success", True) is not False and vectorization.get("success", True) is not False and not payload.get("error")
        lines = [
            self._status_title(success, "## Learning Book Vectorization", "## Learning Book Vectorization Failed"),
            "",
            f"- Lecture ID: `{args.get('lecture_id', '')}`",
            f"- Book ID: `{args.get('book_id', '')}`",
            f"- Status: `{vectorization.get('status', '')}`",
            f"- Chunks: {vectorization.get('chunks_count', 0)}",
            f"- Vectors: {vectorization.get('vector_count', 0)}",
        ]
        message = vectorization.get("message") or payload.get("message") or payload.get("error")
        if message:
            lines.extend(["", "### Message", "", self._markdown_body(message, limit=3000)])
        return "\n".join(lines).strip()

    def _render_learning_vector_search(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        results = payload.get("results") if isinstance(payload.get("results"), list) else []
        lines = [
            self._status_title(success, "## Learning Vector Search", "## Learning Vector Search Failed"),
            "",
            f"- Lecture ID: `{args.get('lecture_id') or payload.get('lecture_id') or ''}`",
            f"- Book Filter: `{args.get('book_id') or '(all)'}`",
            f"- Query: `{payload.get('query') or args.get('query') or ''}`",
            f"- Results: {payload.get('count', len(results))}",
        ]
        if payload.get("placeholder"):
            lines.append("- Backend: `local`")

        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()

        if not results:
            lines.extend(["", "(no vector results)"])
            return "\n".join(lines).strip()

        for index, item in enumerate(results[:20], start=1):
            if not isinstance(item, dict):
                continue
            lines.extend([
                "",
                f"### Result {index}: {item.get('book_title') or item.get('book_id') or '(unknown book)'}",
                "",
                f"- Book ID: `{item.get('book_id', '')}`",
                f"- Chunk: `{item.get('chunk_index', '')}`",
                f"- Score: {self._format_score(item.get('score'))}",
                "",
                self._fenced_text(item.get("text", ""), language="markdown", limit=3000),
            ])
        if len(results) > 20:
            lines.extend(["", f"... omitted {len(results) - 20} more results ..."])
        return "\n".join(lines).strip()

    def _render_learning_puzzle(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        puzzle = payload.get("puzzle") if isinstance(payload.get("puzzle"), dict) else payload
        steps = puzzle.get("steps") if isinstance(puzzle.get("steps"), list) else []
        lines = [
            self._status_title(success, "## Learning Puzzle Created", "## Learning Puzzle Failed"),
            "",
            f"- Puzzle ID: `{puzzle.get('puzzle_id', '')}`",
            f"- Title: {puzzle.get('title') or args.get('title') or ''}",
            f"- Steps: {len(steps)}",
        ]
        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()
        if steps:
            lines.extend(["", "### Candidate Steps", "", *[f"- {step}" for step in steps[:60]]])
        return "\n".join(lines).strip()

    def _render_question(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        question = payload.get("question") if isinstance(payload.get("question"), dict) else payload
        choices = question.get("choices") if isinstance(question.get("choices"), list) else []
        lines = [
            self._status_title(success, "## Question Created", "## Question Failed"),
            "",
            f"- Question ID: `{question.get('question_id', '')}`",
            f"- Title: {question.get('question_title') or args.get('question_title') or ''}",
            f"- Track Answer: {self._as_bool_text(question.get('track_answer', False))}",
            f"- Await: {self._as_bool_text(payload.get('await', True))}",
        ]
        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()
        content = question.get("question_content") or args.get("question_content") or ""
        if content:
            lines.extend(["", "### Question", "", self._markdown_body(content, limit=3000)])
        if choices:
            lines.extend(["", "### Choices", "", *[f"- {choice}" for choice in choices[:20]]])
        return "\n".join(lines).strip()

    def _render_learning_card(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        card = payload.get("card") if isinstance(payload.get("card"), dict) else payload
        lecture = card.get("lecture") if isinstance(card.get("lecture"), dict) else {}
        lines = [
            self._status_title(success, "## Learning Card Created", "## Learning Card Failed"),
            "",
            f"- Type: `{card.get('type') or args.get('type') or ''}`",
            f"- Lecture ID: `{card.get('lecture_id') or args.get('lecture_id') or ''}`",
        ]
        if card.get("book_id") or args.get("book_id"):
            lines.append(f"- Book ID: `{card.get('book_id') or args.get('book_id')}`")
        if card.get("range"):
            lines.append(f"- Range: `{card.get('range')}`")
        if lecture:
            lines.append(f"- Lecture: `{self._learning_lecture_label(lecture)}`")
        if card.get("books_count") is not None:
            lines.append(f"- Books: {card.get('books_count')}")
        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()
        html = str(card.get("html") or "").strip()
        if html:
            lines.extend(["", "### HTML Preview", "", self._fenced_text(html, language="html", limit=5000)])
        return "\n".join(lines).strip()

    def _render_learning_memory_read(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        success = payload.get("success", True) is not False and not payload.get("error")
        lines = [
            self._status_title(success, "## Learning Memory Read", "## Learning Memory Read Failed"),
            "",
            f"- Memory Type: `{payload.get('memory_type') or args.get('memory_type') or ''}`",
            f"- Lecture ID: `{payload.get('lecture_id') or args.get('lecture_id') or ''}`",
            f"- Total Lines: {payload.get('total_lines', '')}",
            f"- Range: {args.get('start_line', 1)}:{args.get('end_line', '')}",
        ]
        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
            return "\n".join(lines).strip()
        lines_payload = payload.get("lines") if isinstance(payload.get("lines"), list) else []
        content = "\n".join(str(line or "") for line in lines_payload) if lines_payload else str(payload.get("content") or "")
        lines.extend(["", "### Content", "", self._fenced_text(content, language="markdown", limit=12000)])
        return "\n".join(lines).strip()

    def _render_learning_memory_write(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if not isinstance(payload, dict):
            return str(result or "")

        tool_name = str(args.get("_tool_name") or "").strip()
        title_map = {
            "append_learning_memory": ("## Learning Memory Appended", "## Learning Memory Append Failed"),
            "update_learning_memory": ("## Learning Memory Updated", "## Learning Memory Update Failed"),
            "write_learning_memory": ("## Learning Memory Written", "## Learning Memory Write Failed"),
        }
        success_title, failed_title = title_map.get(tool_name, ("## Learning Memory Saved", "## Learning Memory Save Failed"))
        success = payload.get("success", True) is not False and not payload.get("error")
        lines = [
            self._status_title(success, success_title, failed_title),
            "",
            f"- Memory Type: `{payload.get('memory_type') or args.get('memory_type') or ''}`",
            f"- Lecture ID: `{payload.get('lecture_id') or args.get('lecture_id') or ''}`",
            f"- Path: `{payload.get('path', '')}`",
        ]
        if args.get("start_line") is not None or args.get("end_line") is not None:
            lines.append(f"- Line Range: {args.get('start_line', '')}:{args.get('end_line', '')}")
        if args.get("content") is not None:
            lines.append(f"- Content Chars: {len(str(args.get('content') or ''))}")
        if not success:
            lines.extend(["", f"- Reason: {payload.get('error') or payload.get('message') or 'unknown error'}"])
        return "\n".join(lines).strip()

    def _render_knowledge_graph_structure(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("knowledge_graph_read", payload)

        if not isinstance(payload, dict):
            return str(result or "")

        categories = payload.get("categories") if isinstance(payload.get("categories"), list) else []
        lines = [
            "## Knowledge Graph Structure",
            "",
            f"- Categories: {len(categories)}",
            f"- Connections: {payload.get('connections_count', 0)}",
        ]

        for category in categories:
            if not isinstance(category, dict):
                continue
            knowledge_list = category.get("knowledge_list") if isinstance(category.get("knowledge_list"), list) else []
            lines.extend([
                "",
                f"### {category.get('name', '(unnamed)')}",
                "",
                f"- Knowledge Count: {category.get('knowledge_count', len(knowledge_list))}",
            ])
            if knowledge_list:
                lines.extend(["", *[f"- {item}" for item in knowledge_list[:80]]])
                if len(knowledge_list) > 80:
                    lines.append(f"- ... omitted {len(knowledge_list) - 80} more ...")
        return "\n".join(lines).strip()

    def _render_knowledge_connections(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("get_knowledge_connections", payload)

        connections = payload if isinstance(payload, list) else []
        if not isinstance(payload, list):
            text = str(result or "").strip()
            if text:
                return "\n".join(["## Knowledge Connections", "", self._markdown_body(text, limit=6000)]).strip()

        lines = [
            "## Knowledge Connections",
            "",
            f"- Knowledge: `{args.get('title', '')}`" if args.get("title") else "- Knowledge: `(all)`",
            f"- Connections: {len(connections)}",
        ]

        if not connections:
            lines.extend(["", "(none)"])
            return "\n".join(lines).strip()

        lines.extend([
            "",
            "| From | Relation | To | Description |",
            "| --- | --- | --- | --- |",
        ])
        for conn in connections[:80]:
            if not isinstance(conn, dict):
                continue
            lines.append(
                "| {src} | {rel} | {dst} | {desc} |".format(
                    src=self._escape_table_cell(conn.get("from") or conn.get("source")),
                    rel=self._escape_table_cell(conn.get("type") or conn.get("relation")),
                    dst=self._escape_table_cell(conn.get("to") or conn.get("target")),
                    desc=self._escape_table_cell(conn.get("description")),
                )
            )
        if len(connections) > 80:
            lines.append(f"\n... omitted {len(connections) - 80} more connections ...")
        return "\n".join(lines).strip()

    def _render_knowledge_path(self, args: Dict[str, Any], result: Any) -> str:
        payload = self._load_payload(result)

        if isinstance(payload, dict) and payload.get("tmp_cached"):
            return self._render_cached_payload("find_path_between_knowledge", payload)

        path = payload if isinstance(payload, list) else []
        lines = [
            "## Knowledge Path",
            "",
            f"- Start: `{args.get('start', '')}`",
            f"- End: `{args.get('end', '')}`",
            f"- Found: {self._as_bool_text(bool(path))}",
        ]
        if path:
            lines.extend(["", "### Path", "", " -> ".join(f"`{item}`" for item in path)])
        else:
            text = str(result or "").strip()
            if text and text != "[]":
                lines.extend(["", self._markdown_body(text, limit=4000)])
        return "\n".join(lines).strip()
