import json
from typing import Any, Callable, Dict

from chroma_client import ChromaStore
from file_sandbox import UserFileSandbox


class ToolExecutor:
    """
    Centralized tool dispatcher.
    Keeps tool routing and execution logic out of model.py.
    """

    def __init__(self, model):
        self.model = model
        self.handlers: Dict[str, Callable[[Dict[str, Any]], str]] = {
            "getKnowledgeList": self._get_knowledge_list,
            "addShort": self._add_short,
            "queryShortMemory": self._query_short_memory,
            "addBasis": self._add_basis,
            "removeShort": self._remove_short,
            "removeBasis": self._remove_basis,
            "updateBasis": self._update_basis,
            "getBasisContent": self._get_basis_content,
            "searchKeyword": self._search_keyword,
            "vectorSearch": self._vector_search,
            "linkKnowledge": self._link_knowledge,
            "categorizeKnowledge": self._categorize_knowledge,
            "createCategory": self._create_category,
            "analyzeConnections": self._analyze_connections,
            "getKnowledgeGraphStructure": self._get_knowledge_graph_structure,
            "getKnowledgeConnections": self._get_knowledge_connections,
            "findPathBetweenKnowledge": self._find_path_between_knowledge,
            "getContextLength": self._get_context_length,
            "getContext": self._get_context,
            "getContext_findKeyword": self._get_context_find_keyword,
            "getMainTitle": self._get_main_title,
            "relay_web_search": self._relay_web_search,
            "sendEMail": self._send_email,
            "getEMailList": self._get_email_list,
            "getEMail": self._get_email,
            "file_create": self._file_create,
            "file_read": self._file_read,
            "file_write": self._file_write,
            "file_find": self._file_find,
            "file_list": self._file_list,
            "file_remove": self._file_remove,
        }
        self._file_sandbox = UserFileSandbox(self.model.username)

    def execute(self, function_name: str, args: Dict[str, Any]) -> str:
        handler = self.handlers.get(function_name)
        if not handler:
            return f"错误：未知函数 {function_name}"
        return handler(args)

    def _get_knowledge_list(self, args: Dict[str, Any]) -> str:
        result = self.model.user.getKnowledgeList(args.get("_type", 0))
        if isinstance(result, dict):
            if args.get("_type", 0) == 0:
                return "\n".join([f"{k}: {v}" for k, v in result.items()]) or "(空)"
            return "\n".join(result.keys()) or "(空)"
        return str(result)

    def _add_short(self, args: Dict[str, Any]) -> str:
        self.model.user.addShort(args.get("title", ""))
        return "已添加到短期记忆"

    def _query_short_memory(self, args: Dict[str, Any]) -> str:
        keyword = str(args.get("keyword", "") or "").strip()
        try:
            limit = int(args.get("limit", 20) or 20)
        except Exception:
            limit = 20
        limit = min(max(limit, 1), 200)

        short_dict = self.model.user.getKnowledgeList(0)
        if not isinstance(short_dict, dict):
            short_dict = {}

        def _sort_key(item):
            sid = str(item[0] or "")
            try:
                return (0, -int(sid))
            except Exception:
                return (1, sid)

        filtered = []
        for sid, title in sorted(short_dict.items(), key=_sort_key):
            title_text = str(title or "")
            if keyword and keyword not in title_text:
                continue
            filtered.append({"id": str(sid), "title": title_text})

        payload = {
            "success": True,
            "keyword": keyword,
            "total": len(short_dict),
            "matched": len(filtered),
            "limit": limit,
            "items": filtered[:limit],
        }
        return json.dumps(payload, ensure_ascii=False)

    def _add_basis(self, args: Dict[str, Any]) -> str:
        self.model.user.addBasis(
            args.get("title", ""),
            args.get("context", ""),
            args.get("url", ""),
        )
        return "已添加到基础知识库"

    def _remove_short(self, args: Dict[str, Any]) -> str:
        self.model.user.removeShort(args.get("ID"))
        return "已删除短期记忆"

    def _remove_basis(self, args: Dict[str, Any]) -> str:
        self.model.user.removeBasis(args.get("title", ""))
        return "已删除基础知识"

    def _update_basis(self, args: Dict[str, Any]) -> str:
        success, message = self.model.user.updateBasis(
            title=args.get("title", ""),
            new_title=args.get("new_title"),
            context=args.get("context"),
            url=args.get("url"),
            from_pos=args.get("from_pos"),
            to_pos=args.get("to_pos"),
            replacement=args.get("replacement"),
            replacements=args.get("replacements"),
        )
        if success:
            updates = []
            if args.get("new_title"):
                updates.append(f"标题已更新为'{args.get('new_title')}'")
            if args.get("context"):
                updates.append("内容已更新")
            if args.get("replacement") is not None or args.get("replacements"):
                updates.append("区间替换已应用")
            if args.get("url"):
                updates.append("来源链接已更新")
            return f"已成功更新基础知识。{', '.join(updates) if updates else ''}"
        return f"更新失败: {message}"

    def _get_basis_content(self, args: Dict[str, Any]) -> str:
        mode = str(args.get("match_mode", "keyword") or "keyword").strip().lower()
        regex_mode = mode in {"regex", "rg", "re"}
        raw_case_sensitive = args.get("case_sensitive", True)
        if isinstance(raw_case_sensitive, bool):
            case_sensitive = raw_case_sensitive
        elif isinstance(raw_case_sensitive, str):
            case_sensitive = raw_case_sensitive.strip().lower() in {"1", "true", "yes", "y", "on"}
        else:
            case_sensitive = bool(raw_case_sensitive)

        return self.model.user.getBasisContent(
            title=args.get("title", ""),
            keyword=args.get("keyword"),
            range_size=args.get("range"),
            from_pos=args.get("from_pos"),
            to_pos=args.get("to_pos"),
            regex_mode=regex_mode,
            max_matches=args.get("max_matches", 5),
            case_sensitive=case_sensitive,
        )

    def _search_keyword(self, args: Dict[str, Any]) -> str:
        result = self.model.user.search_keyword(args.get("keyword", ""), args.get("range", 10))
        if result.startswith("未找到关键词"):
            keyword = args.get("keyword", "")
            return f"{result}。建议：本地知识库中没有此信息。请立即调用 `relay_web_search` 工具联网搜索: '{keyword}'"
        return result

    def _vector_search(self, args: Dict[str, Any]) -> str:
        query = args.get("query", "")
        top_k = int(args.get("top_k") or 5)
        if not query:
            return "missing query"

        cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}
        rag_cfg = cfg.get("rag_database", {}) if isinstance(cfg, dict) else {}
        if not rag_cfg.get("rag_database_enabled", False):
            return "vector db disabled"

        try:
            store = ChromaStore(rag_cfg)
            result = store.query_text(self.model.username, query, top_k=top_k)
            ids = result.get("ids", [[]])[0] if isinstance(result.get("ids"), list) else []
            metas = result.get("metadatas", [[]])[0] if isinstance(result.get("metadatas"), list) else []
            dists = result.get("distances", [[]])[0] if isinstance(result.get("distances"), list) else []
            payload = []
            for i, vid in enumerate(ids):
                meta = metas[i] if i < len(metas) else {}
                score = None
                if i < len(dists) and dists[i] is not None:
                    score = 1 - dists[i]
                payload.append({"id": vid, "title": meta.get("title"), "score": score})
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return f"vector search error: {str(e)}, fall back to searchKeyword immediately."

    def _link_knowledge(self, args: Dict[str, Any]) -> str:
        success, msg = self.model.user.add_connection(
            args.get("source"),
            args.get("target"),
            args.get("relation"),
            args.get("description", ""),
        )
        return f"{'成功' if success else '失败'}: {msg}"

    def _categorize_knowledge(self, args: Dict[str, Any]) -> str:
        success, msg = self.model.user.move_knowledge_to_category(
            args.get("title"),
            args.get("category"),
        )
        return f"{'成功' if success else '失败'}: {msg}"

    def _create_category(self, args: Dict[str, Any]) -> str:
        success, msg = self.model.user.create_category(
            args.get("name"),
            args.get("description", ""),
        )
        return f"{'成功' if success else '失败'}: {msg}"

    def _analyze_connections(self, args: Dict[str, Any]) -> str:
        return self.model.user.get_knowledge_connections(args.get("title"))

    def _get_knowledge_graph_structure(self, args: Dict[str, Any]) -> str:
        return json.dumps(self.model.user.get_knowledge_graph_structure(), ensure_ascii=False)

    def _get_knowledge_connections(self, args: Dict[str, Any]) -> str:
        return json.dumps(self.model.user.get_knowledge_connections(args.get("title")), ensure_ascii=False)

    def _find_path_between_knowledge(self, args: Dict[str, Any]) -> str:
        return json.dumps(
            self.model.user.find_knowledge_path(args.get("start"), args.get("end")),
            ensure_ascii=False,
        )

    def _get_context_length(self, args: Dict[str, Any]) -> str:
        length = self.model.conversation_manager.get_context_length(
            args.get("offset", 0),
            conversation_id=self.model.conversation_id,
        )
        return f"对话长度: {length} 字符"

    def _get_context(self, args: Dict[str, Any]) -> str:
        content = self.model.conversation_manager.get_context(
            args.get("offset", 0),
            args.get("from_pos", 0),
            args.get("to_pos", None),
            conversation_id=self.model.conversation_id,
        )
        return content if content else "无内容"

    def _get_context_find_keyword(self, args: Dict[str, Any]) -> str:
        return self.model.conversation_manager.get_context_find_keyword(
            args.get("offset", 0),
            args.get("keyword", ""),
            args.get("range", 10),
            conversation_id=self.model.conversation_id,
        )

    def _get_main_title(self, args: Dict[str, Any]) -> str:
        return self.model.conversation_manager.get_main_title(
            self.model.conversation_id,
            args.get("offset", 0),
        )

    def _relay_web_search(self, args: Dict[str, Any]) -> str:
        query = args.get("query", "")
        print(f"[SEARCH] 执行中转联网搜索: {query}")
        if not str(query or "").strip():
            return "联网搜索执行失败: query 不能为空"
        try:
            return self.model._execute_local_web_search_relay(query, args)
        except Exception as e:
            print(f"[SEARCH][RELAY] 失败: {e}")
            return f"联网搜索执行失败: {str(e)}"

    def _send_email(self, args: Dict[str, Any]) -> str:
        return self.model._tool_send_email(args)

    def _get_email_list(self, args: Dict[str, Any]) -> str:
        return self.model._tool_get_email_list(args)

    def _get_email(self, args: Dict[str, Any]) -> str:
        return self.model._tool_get_email(args)

    def _file_create(self, args: Dict[str, Any]) -> str:
        file_ref = args.get("file_path") or args.get("path") or args.get("file")
        if not file_ref:
            return json.dumps({"success": False, "message": "file_path is required"}, ensure_ascii=False)

        raw_overwrite = args.get("overwrite", False)
        if isinstance(raw_overwrite, bool):
            overwrite = raw_overwrite
        elif isinstance(raw_overwrite, str):
            overwrite = raw_overwrite.strip().lower() in {"1", "true", "yes", "y", "on"}
        else:
            overwrite = bool(raw_overwrite)

        try:
            payload = self._file_sandbox.create_file(
                file_ref=str(file_ref),
                content=args.get("content", ""),
                overwrite=overwrite,
            )
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"success": False, "message": str(e)}, ensure_ascii=False)

    def _file_read(self, args: Dict[str, Any]) -> str:
        file_ref = args.get("file_path") or args.get("path") or args.get("file")
        if not file_ref:
            return json.dumps({"success": False, "message": "file_path is required"}, ensure_ascii=False)
        try:
            payload = self._file_sandbox.read_file(
                file_ref=str(file_ref),
                from_line=args.get("from_line"),
                to_line=args.get("to_line"),
                from_pos=args.get("from_pos"),
                to_pos=args.get("to_pos"),
            )
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"success": False, "message": str(e)}, ensure_ascii=False)

    def _file_write(self, args: Dict[str, Any]) -> str:
        file_ref = args.get("file_path") or args.get("path") or args.get("file")
        if not file_ref:
            return json.dumps({"success": False, "message": "file_path is required"}, ensure_ascii=False)
        try:
            payload = self._file_sandbox.write_file(
                file_ref=str(file_ref),
                content=args.get("content"),
                from_line=args.get("from_line"),
                to_line=args.get("to_line"),
                replacement=args.get("replacement"),
                old_text=args.get("old_text"),
                new_text=args.get("new_text"),
                regex=bool(args.get("regex", False)),
                max_replace=args.get("max_replace"),
            )
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"success": False, "message": str(e)}, ensure_ascii=False)

    def _file_find(self, args: Dict[str, Any]) -> str:
        file_ref = args.get("file_path") or args.get("path") or args.get("file")
        keyword = args.get("keyword") or args.get("query") or args.get("pattern")
        if not file_ref:
            return json.dumps({"success": False, "message": "file_path is required"}, ensure_ascii=False)
        if not keyword:
            return json.dumps({"success": False, "message": "keyword is required"}, ensure_ascii=False)
        raw_case_sensitive = args.get("case_sensitive", True)
        if isinstance(raw_case_sensitive, bool):
            case_sensitive = raw_case_sensitive
        elif isinstance(raw_case_sensitive, str):
            case_sensitive = raw_case_sensitive.strip().lower() in {"1", "true", "yes", "y", "on"}
        else:
            case_sensitive = bool(raw_case_sensitive)
        try:
            payload = self._file_sandbox.find_in_file(
                file_ref=str(file_ref),
                keyword=str(keyword),
                regex=bool(args.get("regex", False)),
                case_sensitive=case_sensitive,
                max_results=args.get("max_results", 200),
            )
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"success": False, "message": str(e)}, ensure_ascii=False)

    def _file_list(self, args: Dict[str, Any]) -> str:
        try:
            files = self._file_sandbox.list_files(
                query=args.get("query"),
                regex=bool(args.get("regex", False)),
                max_items=args.get("max_items", 200),
            )
            return json.dumps({
                "success": True,
                "username": self.model.username,
                "total": len(files),
                "files": files,
            }, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"success": False, "message": str(e)}, ensure_ascii=False)

    def _file_remove(self, args: Dict[str, Any]) -> str:
        file_ref = args.get("file_path") or args.get("path") or args.get("file")
        if not file_ref:
            return json.dumps({"success": False, "message": "file_path is required"}, ensure_ascii=False)
        try:
            payload = self._file_sandbox.remove_file(str(file_ref))
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"success": False, "message": str(e)}, ensure_ascii=False)
