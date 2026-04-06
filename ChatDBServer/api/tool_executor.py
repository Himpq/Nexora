import os
import json
import re
import unicodedata
from typing import Any, Callable, Dict
from flask import has_request_context, request
from urllib import request as urllib_request, parse as urllib_parse, error as urllib_error
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET
import ssl

from chroma_client import ChromaStore
from file_sandbox import UserFileSandbox
from client_tool_bridge import request_client_js_execution
from tools import TOOL_NAME_ALIASES, canonicalize_tool_name


class ToolExecutor:
    """
    Centralized tool dispatcher.
    Keeps tool routing and execution logic out of model.py.
    """

    def __init__(self, model):
        self.model = model
        self._template_pattern = re.compile(r"\{\{\s*(file|basis)\s*:(.*?)\}\}", re.IGNORECASE | re.DOTALL)
        self._template_max_chunk_chars = 20000
        self._template_total_budget_chars = 80000
        self.handlers: Dict[str, Callable[[Dict[str, Any]], str]] = {
            "select_tools": self._select_tools,
            "enable_tools": self._enable_tools,
            "get_knowledge_list": self._get_knowledge_list,
            # "addShort": self._add_short,  # short-memory tools disabled
            # "queryShortMemory": self._query_short_memory,  # short-memory tools disabled
            "add_basis": self._add_basis,
            # "removeShort": self._remove_short,  # short-memory tools disabled
            "remove_basis": self._remove_basis,
            "update_basis": self._update_basis,
            "get_basis_content": self._get_basis_content,
            "longterm_plan": self._longterm_plan,
            "longterm_update": self._longterm_update,
            "search_keyword": self._search_keyword,
            "readtmp": self._readtmp,
            "searchtmp": self._searchtmp,
            "listtmp": self._listtmp,
            "cleartmp": self._cleartmp,
            "arxiv_search": self._arxiv_search,
            "js_execute": self._js_execute,
            "client_js_exec": self._js_execute,
            "get_user_profile_memory": self._get_user_profile_memory,
            "set_user_profile_memory": self._set_user_profile_memory,
            "vector_search": self._vector_search,
            "file_semantic_search": self._file_semantic_search,
            "link_knowledge": self._link_knowledge,
            "categorize_knowledge": self._categorize_knowledge,
            "create_category": self._create_category,
            "analyze_connections": self._analyze_connections,
            "get_knowledge_graph_structure": self._get_knowledge_graph_structure,
            "get_knowledge_connections": self._get_knowledge_connections,
            "find_path_between_knowledge": self._find_path_between_knowledge,
            "get_context_length": self._get_context_length,
            "get_context": self._get_context,
            "get_context_find_keyword": self._get_context_find_keyword,
            "get_main_title": self._get_main_title,
            "relay_web_search": self._relay_web_search,
            "send_email": self._send_email,
            "get_email_list": self._get_email_list,
            "get_email": self._get_email,
            "file_create": self._file_create,
            "file_read": self._file_read,
            "file_write": self._file_write,
            "file_find": self._file_find,
            "file_list": self._file_list,
            "file_remove": self._file_remove,
        }
        # Backward compatibility for old camelCase tool names.
        for legacy_name, canonical_name in TOOL_NAME_ALIASES.items():
            handler = self.handlers.get(canonical_name)
            if handler:
                self.handlers.setdefault(legacy_name, handler)
        self._file_sandbox = UserFileSandbox(self.model.username)

    def _safe_int(self, v, default=None):
        try:
            if v is None:
                return default
            return int(str(v).strip())
        except Exception:
            return default

    def _normalize_client_js_code(self, raw_code: Any) -> str:
        code = str(raw_code or "")
        if not code:
            return ""
        code = code.replace("\ufeff", "")
        code = code.replace("\u2028", "\n").replace("\u2029", "\n")

        trimmed = code.strip()
        if trimmed:
            try:
                parsed = json.loads(trimmed)
                if isinstance(parsed, str):
                    code = parsed
                elif isinstance(parsed, dict) and isinstance(parsed.get("code"), str):
                    code = str(parsed.get("code") or "")
            except Exception:
                pass

        m = re.match(r"^```(?:javascript|js|jsx|typescript|ts)?\s*([\s\S]*?)\s*```$", str(code).strip(), re.IGNORECASE)
        if m:
            code = m.group(1)

        # NFKC can normalize full-width punctuation to ASCII.
        code = unicodedata.normalize("NFKC", str(code or ""))
        code = code.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
        return code.strip()

    def _normalize_tool_ids(self, value: Any):
        ids = []
        if value is None:
            return ids
        if isinstance(value, bool):
            return ids
        if isinstance(value, (int, float)):
            try:
                ids.append(int(value))
            except Exception:
                pass
            return ids
        if isinstance(value, str):
            for tok in re.findall(r"-?\d+", value):
                try:
                    ids.append(int(tok))
                except Exception:
                    continue
            return ids
        if isinstance(value, (list, tuple, set)):
            for item in value:
                ids.extend(self._normalize_tool_ids(item))
            return ids
        if isinstance(value, dict):
            for k, v in value.items():
                if isinstance(k, str) and re.fullmatch(r"-?\d+", k.strip()):
                    try:
                        ids.append(int(k.strip()))
                    except Exception:
                        pass
                ids.extend(self._normalize_tool_ids(v))
            return ids
        return ids

    def _normalize_tool_names(self, value: Any):
        names = []
        if value is None:
            return names
        if isinstance(value, bool):
            return names
        if isinstance(value, (int, float)):
            return names
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return names
            try:
                parsed = json.loads(raw)
                if not isinstance(parsed, str):
                    return self._normalize_tool_names(parsed)
            except Exception:
                pass
            for part in re.split(r"[,;\n]+", raw):
                token = str(part or "").strip().strip("[](){}\"'")
                if token:
                    names.append(token)
            return names
        if isinstance(value, (list, tuple, set)):
            for item in value:
                names.extend(self._normalize_tool_names(item))
            return names
        if isinstance(value, dict):
            for k, v in value.items():
                if isinstance(k, str) and isinstance(v, bool) and v:
                    key_token = k.strip()
                    if key_token:
                        names.append(key_token)
                names.extend(self._normalize_tool_names(v))
            return names
        return names

    def _clip_template_chunk(self, text: str, hint: str = "片段") -> str:
        s = str(text or "")
        if len(s) <= self._template_max_chunk_chars:
            return s
        keep = self._template_max_chunk_chars
        return s[:keep] + f"\n\n...[{hint}过长已截断，共{len(s)}字符，当前保留{keep}字符]..."

    def _expand_file_template(self, spec: str) -> str:
        parts = [p.strip() for p in str(spec or "").split(",")]
        parts = [p for p in parts if p != ""]
        if not parts:
            raise ValueError("file 模板缺少路径")

        file_ref = parts[0]
        mode = ""
        start = None
        end = None
        if len(parts) >= 2:
            token = parts[1].lower()
            if token in {"lines", "line"}:
                mode = "lines"
                start = self._safe_int(parts[2], 1) if len(parts) >= 3 else 1
                end = self._safe_int(parts[3], None) if len(parts) >= 4 else None
            elif token in {"chars", "char"}:
                mode = "chars"
                start = self._safe_int(parts[2], 0) if len(parts) >= 3 else 0
                end = self._safe_int(parts[3], None) if len(parts) >= 4 else None
            elif len(parts) >= 3:
                # 兼容简写：{{file:path,0,500}} -> line range
                mode = "lines"
                start = self._safe_int(parts[1], 1)
                end = self._safe_int(parts[2], None)

        if mode == "lines":
            payload = self._file_sandbox.read_file(file_ref=file_ref, from_line=start, to_line=end)
        elif mode == "chars":
            payload = self._file_sandbox.read_file(file_ref=file_ref, from_pos=start, to_pos=end)
        else:
            payload = self._file_sandbox.read_file(file_ref=file_ref)

        if not isinstance(payload, dict) or not payload.get("success", False):
            raise ValueError(f"读取文件失败: {file_ref}")
        return self._clip_template_chunk(payload.get("content", ""), hint=f"file:{file_ref}")

    def _expand_basis_template(self, spec: str) -> str:
        parts = [p.strip() for p in str(spec or "").split(",")]
        parts = [p for p in parts if p != ""]
        if not parts:
            raise ValueError("basis 模板缺少标题")
        title = parts[0]

        mode = ""
        start = None
        end = None
        if len(parts) >= 2:
            token = parts[1].lower()
            if token in {"chars", "char"}:
                mode = "chars"
                start = self._safe_int(parts[2], 0) if len(parts) >= 3 else 0
                end = self._safe_int(parts[3], None) if len(parts) >= 4 else None
            elif len(parts) >= 3:
                # 兼容简写：{{basis:title,0,3000}} -> char range
                mode = "chars"
                start = self._safe_int(parts[1], 0)
                end = self._safe_int(parts[2], None)

        if mode == "chars":
            raw = self.model.user.getBasisContent(title=title, from_pos=start, to_pos=end)
            try:
                payload = json.loads(raw) if isinstance(raw, str) else raw
            except Exception:
                payload = None
            if isinstance(payload, dict) and payload.get("success", False):
                content = payload.get("content", "")
            elif isinstance(raw, str):
                content = raw
            else:
                content = ""
        else:
            content = self.model.user.getBasisContent(title=title)

        return self._clip_template_chunk(content, hint=f"basis:{title}")

    def _expand_template_text(self, text: str, budget: Dict[str, int]) -> str:
        src = str(text or "")
        if "{{" not in src or "}}" not in src:
            return src

        def repl(match):
            kind = str(match.group(1) or "").strip().lower()
            spec = str(match.group(2) or "").strip()
            if kind == "file":
                expanded = self._expand_file_template(spec)
            elif kind == "basis":
                expanded = self._expand_basis_template(spec)
            else:
                raise ValueError(f"不支持的模板类型: {kind}")

            budget["chars"] = int(budget.get("chars", 0)) + len(expanded)
            if budget["chars"] > self._template_total_budget_chars:
                raise ValueError(
                    f"模板展开总量超限（>{self._template_total_budget_chars}字符），请缩小范围"
                )
            return expanded

        return self._template_pattern.sub(repl, src)

    def _resolve_templates_in_value(self, value: Any, budget: Dict[str, int]):
        if isinstance(value, str):
            return self._expand_template_text(value, budget)
        if isinstance(value, dict):
            out = {}
            for k, v in value.items():
                out[k] = self._resolve_templates_in_value(v, budget)
            return out
        if isinstance(value, list):
            return [self._resolve_templates_in_value(v, budget) for v in value]
        if isinstance(value, tuple):
            return [self._resolve_templates_in_value(v, budget) for v in value]
        return value

    def _resolve_public_base_url(self) -> str:
        def _is_local_host(hostname: str) -> bool:
            h = str(hostname or "").strip().lower()
            return h in {"127.0.0.1", "localhost", "0.0.0.0", "::1"}

        cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}
        api_cfg = cfg.get("api", {}) if isinstance(cfg.get("api"), dict) else {}
        base_url = str(
            cfg.get("public_base_url", "")
            or api_cfg.get("public_base_url", "")
            or os.environ.get("NEXORA_PUBLIC_BASE_URL", "")
            or ""
        ).strip()

        if not base_url and has_request_context():
            xfh = str(request.headers.get("X-Forwarded-Host", "") or "").split(",")[0].strip()
            xfp = str(request.headers.get("X-Forwarded-Proto", "") or "").split(",")[0].strip()
            if xfh:
                proto = xfp or request.scheme or "http"
                base_url = f"{proto}://{xfh}"
            else:
                host = str(request.headers.get("Host", "") or request.host or "").strip()
                proto = xfp or request.scheme or "http"
                if host:
                    base_url = f"{proto}://{host}"

            # 反代未透传 Host 时，回退浏览器来源（Origin/Referer）
            try:
                parsed = urlsplit(base_url) if base_url else None
                host_name = (parsed.hostname or "") if parsed else ""
            except Exception:
                host_name = ""
            if not base_url or _is_local_host(host_name):
                origin = str(request.headers.get("Origin", "") or "").strip()
                referer = str(request.headers.get("Referer", "") or "").strip()
                cand = origin or referer
                if cand:
                    p = urlsplit(cand)
                    if p.scheme and p.netloc and not _is_local_host(p.hostname or ""):
                        base_url = f"{p.scheme}://{p.netloc}"

        # 最后回退：用 rag_database.host 组装公网域名
        if not base_url:
            rag_cfg = cfg.get("rag_database", {}) if isinstance(cfg.get("rag_database"), dict) else {}
            rag_host = str(rag_cfg.get("host", "") or "").strip()
            if rag_host and not _is_local_host(rag_host):
                base_url = f"https://{rag_host}"

        base_url = base_url.rstrip("/")
        if base_url and not base_url.startswith(("http://", "https://")):
            base_url = f"https://{base_url}"
        return base_url

    def execute(self, function_name: str, args: Dict[str, Any]) -> str:
        canonical_name = canonicalize_tool_name(function_name)
        handler = self.handlers.get(canonical_name) or self.handlers.get(function_name)
        if not handler:
            return f"错误：未知函数 {function_name}"
        try:
            safe_args = args if isinstance(args, dict) else {}
            budget = {"chars": 0}
            resolved_args = self._resolve_templates_in_value(safe_args, budget)
        except Exception as e:
            return f"错误：参数模板解析失败: {str(e)}"
        return handler(resolved_args)

    def _longterm_plan(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        plan_items = safe_args.get("plan", []) or []
        steps = [str(item or "").strip() for item in plan_items if str(item or "").strip()]
        if not steps:
            return "错误：未提供规划内容"
        task_text = str(safe_args.get("task", "") or "").strip()
        plan_json = {
            "kind": "longterm_plan",
            "task": task_text,
            "plan": steps,
        }
        return json.dumps(plan_json, ensure_ascii=False)

    def _longterm_update(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        summary = str(safe_args.get("summary", "") or "").strip()
        step_index = safe_args.get("step_index", safe_args.get("stepIndex", None))
        step_no = safe_args.get("step_no", safe_args.get("stepNo", None))
        step_id = str(safe_args.get("step_id", safe_args.get("stepId", "")) or "").strip()
        step_title = str(safe_args.get("step_title", safe_args.get("stepTitle", "")) or "").strip()
        step_status = str(safe_args.get("step_status", safe_args.get("stepStatus", "")) or "").strip().lower()
        context = str(safe_args.get("context", "") or "").strip()
        has_done = "done" in safe_args
        done = bool(safe_args.get("done", True))
        has_step_mark = any([
            step_index is not None,
            step_no is not None,
            bool(step_id),
            bool(step_title),
            bool(step_status),
        ])
        if has_step_mark and not has_done:
            done = False
        plan_json = {
            "kind": "longterm_update",
            "summary": summary,
            "step_index": step_index,
            "step_no": step_no,
            "step_id": step_id,
            "step_title": step_title,
            "step_status": step_status,
            "context": context,
            "done": done,
        }
        return json.dumps(plan_json, ensure_ascii=False)

    def _get_knowledge_list(self, args: Dict[str, Any]) -> str:
        k_type = args.get("_type", 0)
        try:
            k_type = int(k_type)
        except Exception:
            k_type = 0
        if k_type == 0:
            permission_hint = self._resolve_user_permission_hint()
            profile = self.model.user.get_user_profile_memory(
                user_permission=permission_hint,
                max_chars=400
            )
            return f"[用户画像短期记忆]\n{str(profile or '').strip()}"
        result = self.model.user.getKnowledgeList(k_type)
        if isinstance(result, dict):
            if k_type == 0:
                return "\n".join([f"{k}: {v}" for k, v in result.items()]) or "(空)"
            items = []
            for title, meta in result.items():
                safe_meta = meta if isinstance(meta, dict) else {}
                items.append({
                    "title": str(title or ""),
                    "basis_id": str(safe_meta.get("basis_id") or "").strip() or None,
                    "public": bool(safe_meta.get("public", False)),
                    "collaborative": bool(safe_meta.get("collaborative", False)),
                    "pin": bool(safe_meta.get("pin", False)),
                    "created_at": safe_meta.get("created_at"),
                    "updated_at": safe_meta.get("updated_at"),
                })
            items.sort(key=lambda x: (not bool(x.get("pin")), str(x.get("title") or "")))
            payload = {
                "success": True,
                "type": "basis",
                "total": len(items),
                "items": items
            }
            return json.dumps(payload, ensure_ascii=False)
        return str(result)

    def _resolve_user_permission_hint(self) -> str:
        getter = getattr(self.model, "_get_user_permission_hint", None)
        if callable(getter):
            try:
                return str(getter() or "").strip()
            except Exception:
                pass
        return "member"

    def _get_user_profile_memory(self, args: Dict[str, Any]) -> str:
        _ = args if isinstance(args, dict) else {}
        permission_hint = self._resolve_user_permission_hint()
        profile = self.model.user.get_user_profile_memory(
            user_permission=permission_hint,
            max_chars=400
        )
        payload = {
            "success": True,
            "profile": str(profile or ""),
            "length": len(str(profile or "")),
            "max_length": 400
        }
        return json.dumps(payload, ensure_ascii=False)

    def _set_user_profile_memory(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        permission_hint = self._resolve_user_permission_hint()
        reset = bool(safe_args.get("reset", False))
        profile_input = "" if reset else safe_args.get("profile", "")
        profile = self.model.user.set_user_profile_memory(
            profile_text=profile_input,
            user_permission=permission_hint,
            max_chars=400
        )
        payload = {
            "success": True,
            "profile": str(profile or ""),
            "length": len(str(profile or "")),
            "max_length": 400,
            "reset": reset
        }
        return json.dumps(payload, ensure_ascii=False)

    def _collect_runtime_tool_names_from_args(self, args: Dict[str, Any]):
        names = []
        for key in ("tools", "tool_names", "toolNames", "selected_tools", "selectedTools", "names", "name_text"):
            if key in args:
                names.extend(self._normalize_tool_names(args.get(key)))
        if not names and "selection" in args:
            names.extend(self._normalize_tool_names(args.get("selection")))

        uniq_names = []
        seen_names = set()
        for name in names:
            token = canonicalize_tool_name(name)
            if not token:
                continue
            key = token.lower()
            if key in seen_names:
                continue
            seen_names.add(key)
            uniq_names.append(token)
        return uniq_names

    def _runtime_catalog_names(self):
        catalog = list(getattr(self.model, "_runtime_tool_catalog", []) or [])
        out = []
        seen = set()
        for item in catalog:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "") or "").strip()
            cname = canonicalize_tool_name(name)
            if not name or cname in {"select_tools", "enable_tools"}:
                continue
            key = (cname or name).lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(cname or name)
        return out

    def _apply_runtime_tool_selection(self, args: Dict[str, Any], *, allow_enable_all: bool = False) -> str:
        applier_by_names = getattr(self.model, "_apply_runtime_tool_selection_by_names", None)
        if not callable(applier_by_names):
            return json.dumps(
                {"success": False, "message": "runtime tool selection is unavailable"},
                ensure_ascii=False
            )

        uniq_names = self._collect_runtime_tool_names_from_args(args if isinstance(args, dict) else {})
        if (not uniq_names) and allow_enable_all:
            uniq_names = self._runtime_catalog_names()

        if uniq_names:
            result = applier_by_names(uniq_names)
            if not isinstance(result, dict):
                result = {"success": False, "message": "invalid runtime selection result"}
            return json.dumps(result, ensure_ascii=False)

        return json.dumps(
            {"success": False, "message": "未提供有效工具名（请传入 tools/tool_names/name_text）"},
            ensure_ascii=False
        )

    def _select_tools(self, args: Dict[str, Any]) -> str:
        return self._apply_runtime_tool_selection(args, allow_enable_all=False)

    def _enable_tools(self, args: Dict[str, Any]) -> str:
        enabler = getattr(self.model, "_enable_runtime_tools_for_current_reply", None)
        if not callable(enabler):
            return json.dumps(
                {"success": False, "message": "runtime enable-tools is unavailable"},
                ensure_ascii=False
            )
        result = enabler()
        if not isinstance(result, dict):
            result = {"success": False, "message": "invalid enable-tools result"}

        requested_names = self._collect_runtime_tool_names_from_args(args if isinstance(args, dict) else {})
        if requested_names:
            result["requested_tool_names"] = requested_names
            result["note"] = "enable_tools 在 Auto(OFF) 中会切换到 Force（忽略精确工具列表）"
        return json.dumps(result, ensure_ascii=False)

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
            is_public=args.get("public"),
            is_collaborative=args.get("collaborative"),
            from_pos=args.get("from_pos"),
            to_pos=args.get("to_pos"),
            replacement=args.get("replacement"),
            replacements=args.get("replacements"),
        )
        if success:
            updates = []
            effective_title = str(args.get("new_title") or args.get("title") or "").strip()
            if args.get("new_title"):
                updates.append(f"标题已更新为'{args.get('new_title')}'")
            if args.get("context"):
                updates.append("内容已更新")
            if args.get("replacement") is not None or args.get("replacements"):
                updates.append("区间替换已应用")
            if args.get("url"):
                updates.append("来源链接已更新")
            if args.get("public") is not None:
                updates.append(f"公开状态已设为 {'公开' if bool(args.get('public')) else '私有'}")
            if args.get("collaborative") is not None:
                updates.append(f"协作编辑已设为 {'开启' if bool(args.get('collaborative')) else '关闭'}")

            # 当设置公开/协作时，返回 share_url（协作链接与公开链接一致）
            need_share_url = (args.get("public") is not None) or (args.get("collaborative") is not None)
            if need_share_url and effective_title:
                meta = self.model.user.getBasisMetadata(effective_title) or {}
                share_id = str(meta.get("share_id", "") or "").strip()
                if share_id:
                    base_url = self._resolve_public_base_url()
                    if base_url:
                        share_url = f"{base_url}/public/knowledge/{self.model.username}/{share_id}"
                    else:
                        share_url = f"/public/knowledge/{self.model.username}/{share_id}"
                    updates.append(f"公开链接: {share_url}")

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
            basis_id=args.get("basis_id"),
            keyword=args.get("keyword"),
            range_size=args.get("range"),
            from_pos=args.get("from_pos"),
            to_pos=args.get("to_pos"),
            regex_mode=regex_mode,
            max_matches=args.get("max_matches", 5),
            case_sensitive=case_sensitive,
        )

    def _search_keyword(self, args: Dict[str, Any]) -> str:
        return self.model.user.search_keyword(args.get("keyword", ""), args.get("range", 10))

    def _readtmp(self, args: Dict[str, Any]) -> str:
        rid = str(args.get("resource_id") or "").strip()
        if not rid:
            return json.dumps({"success": False, "message": "resource_id is required"}, ensure_ascii=False)
        return self.model.temp_cache_read(
            resource_id=rid,
            start=args.get("start", 0),
            count=args.get("count", 2000),
        )

    def _searchtmp(self, args: Dict[str, Any]) -> str:
        raw_case = args.get("case_sensitive", False)
        if isinstance(raw_case, bool):
            case_sensitive = raw_case
        elif isinstance(raw_case, str):
            case_sensitive = raw_case.strip().lower() in {"1", "true", "yes", "y", "on"}
        else:
            case_sensitive = bool(raw_case)
        return self.model.temp_cache_search(
            resource_id=args.get("resource_id"),
            keyword=args.get("keyword"),
            regex=args.get("regex"),
            case_sensitive=case_sensitive,
            range_size=args.get("range", 80),
            max_matches=args.get("max_matches", 20),
        )

    def _listtmp(self, args: Dict[str, Any]) -> str:
        _ = args
        return self.model.temp_cache_list()

    def _cleartmp(self, args: Dict[str, Any]) -> str:
        _ = args
        return self.model.temp_cache_clear()

    def _build_ssl_context_with_certifi(self):
        """Build SSL context using certifi bundle when available."""
        try:
            import certifi  # optional dependency
            return ssl.create_default_context(cafile=certifi.where())
        except Exception:
            return ssl.create_default_context()

    def _normalize_plain_text(self, text: Any) -> str:
        s = unicodedata.normalize("NFKC", str(text or "")).lower()
        return re.sub(r"\s+", " ", s).strip()

    def _tokenize_query(self, text: str):
        src = self._normalize_plain_text(text)
        # Keep latin tokens and contiguous CJK groups.
        raw_tokens = re.findall(r"[a-z0-9][a-z0-9._+\-]*|[\u4e00-\u9fff]+", src)
        stopwords = {
            "the", "a", "an", "of", "to", "for", "in", "on", "and", "or",
            "with", "by", "from", "is", "are", "be", "as", "at"
        }
        out = []
        for tok in raw_tokens:
            if tok in stopwords:
                continue
            if len(tok) == 1 and tok.isascii() and tok.isalpha():
                continue
            out.append(tok)
        return out

    def _is_advanced_arxiv_query(self, query: str) -> bool:
        q = str(query or "")
        # arXiv fielded query hints / boolean syntax
        if re.search(r"\b(cat|ti|au|abs|co|jr|rn|id|all):", q, flags=re.IGNORECASE):
            return True
        if re.search(r"\b(AND|OR|NOT)\b", q, flags=re.IGNORECASE):
            return True
        if "(" in q or ")" in q:
            return True
        return False

    def _build_arxiv_effective_query(self, raw_query: str) -> str:
        q = str(raw_query or "").strip()
        if not q:
            return q
        if self._is_advanced_arxiv_query(q):
            return q
        tokens = self._tokenize_query(q)
        if not tokens:
            return q
        # Prefer precision: all:token AND all:token...
        tokens = tokens[:8]
        return " AND ".join([f"all:{t}" for t in tokens])

    def _score_arxiv_item(self, user_query: str, title: str, summary: str, categories: str) -> float:
        q_norm = self._normalize_plain_text(user_query)
        if not q_norm:
            return 0.0
        tokens = self._tokenize_query(user_query)
        t_norm = self._normalize_plain_text(title)
        s_norm = self._normalize_plain_text(summary)
        c_norm = self._normalize_plain_text(categories)

        score = 0.0
        # Phrase match bonus
        if q_norm in t_norm:
            score += 12.0
        if q_norm in s_norm:
            score += 5.0
        if q_norm in c_norm:
            score += 4.0

        # Token coverage
        hit_count = 0
        for tok in tokens:
            hit = False
            if tok and tok in t_norm:
                score += 2.4
                hit = True
            if tok and tok in s_norm:
                score += 1.1
                hit = True
            if tok and tok in c_norm:
                score += 1.6
                hit = True
            if hit:
                hit_count += 1

        if tokens and hit_count == len(tokens):
            score += 3.0
        return round(score, 4)

    def _arxiv_search(self, args: Dict[str, Any]) -> str:
        query = str(args.get("query") or "").strip()
        if not query:
            return json.dumps({"success": False, "message": "missing query"}, ensure_ascii=False)

        try:
            max_results = int(args.get("max_results", 5) or 5)
        except Exception:
            max_results = 5
        max_results = min(max(max_results, 1), 20)

        sort_by = str(args.get("sort_by", "relevance") or "relevance").strip()
        if sort_by not in {"relevance", "submittedDate", "lastUpdatedDate"}:
            sort_by = "relevance"

        sort_order = str(args.get("sort_order", "descending") or "descending").strip().lower()
        if sort_order not in {"ascending", "descending"}:
            sort_order = "descending"

        strict = args.get("strict", True)
        if isinstance(strict, str):
            strict = strict.strip().lower() in {"1", "true", "yes", "y", "on"}
        else:
            strict = bool(strict)

        endpoint = "https://export.arxiv.org/api/query"
        effective_query = self._build_arxiv_effective_query(query)
        fetch_count = min(max(max_results * 5, max_results + 8), 60)
        params = {
            "search_query": effective_query,
            "start": "0",
            "max_results": str(fetch_count),
            "sortBy": sort_by,
            "sortOrder": sort_order,
        }
        url = f"{endpoint}?{urllib_parse.urlencode(params)}"

        headers = {
            "User-Agent": "Nexora/1.0 (+https://chat.himpqblog.cn)",
            "Accept": "application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        }

        raw = None
        # 1) HTTPS + explicit CA bundle (certifi if present)
        try:
            req = urllib_request.Request(url, headers=headers, method="GET")
            ssl_ctx = self._build_ssl_context_with_certifi()
            with urllib_request.urlopen(req, timeout=20, context=ssl_ctx) as resp:
                raw = resp.read()
        except urllib_error.HTTPError as e:
            return json.dumps(
                {"success": False, "message": f"arXiv HTTP {int(getattr(e, 'code', 500) or 500)}"},
                ensure_ascii=False
            )
        except Exception as e_https:
            err_text = str(e_https)
            # 2) CERTIFICATE_VERIFY_FAILED 回退到 HTTP（仅元数据查询场景）
            if "CERTIFICATE_VERIFY_FAILED" in err_text or "certificate verify failed" in err_text.lower():
                try:
                    fallback_url = f"http://export.arxiv.org/api/query?{urllib_parse.urlencode(params)}"
                    req = urllib_request.Request(fallback_url, headers=headers, method="GET")
                    with urllib_request.urlopen(req, timeout=20) as resp:
                        raw = resp.read()
                except Exception as e_http:
                    return json.dumps(
                        {
                            "success": False,
                            "message": (
                                f"arXiv request failed (https cert verify + http fallback): {str(e_http)}"
                            )
                        },
                        ensure_ascii=False
                    )
            else:
                return json.dumps({"success": False, "message": f"arXiv request failed: {err_text}"}, ensure_ascii=False)

        try:
            root = ET.fromstring(raw)
        except Exception as e:
            return json.dumps({"success": False, "message": f"arXiv parse failed: {str(e)}"}, ensure_ascii=False)

        ns = {
            "atom": "http://www.w3.org/2005/Atom",
            "opensearch": "http://a9.com/-/spec/opensearch/1.1/",
        }
        total_results = 0
        total_node = root.find(".//opensearch:totalResults", ns)
        if total_node is None:
            total_node = root.find(".//{http://a9.com/-/spec/opensearch/1.1/}totalResults")
        if total_node is not None and total_node.text:
            try:
                total_results = int(total_node.text.strip())
            except Exception:
                total_results = 0

        items = []
        entries = root.findall("atom:entry", ns)
        for entry in entries:
            aid = str(entry.findtext("atom:id", default="", namespaces=ns) or "").strip()
            title = str(entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
            summary = str(entry.findtext("atom:summary", default="", namespaces=ns) or "").strip()
            published = str(entry.findtext("atom:published", default="", namespaces=ns) or "").strip()
            updated = str(entry.findtext("atom:updated", default="", namespaces=ns) or "").strip()
            authors = []
            for author in entry.findall("atom:author", ns):
                name_text = str(author.findtext("atom:name", default="", namespaces=ns) or "").strip()
                if name_text:
                    authors.append(name_text)

            pdf_url = ""
            for link in entry.findall("atom:link", ns):
                href = str(link.attrib.get("href", "") or "").strip()
                title_attr = str(link.attrib.get("title", "") or "").strip().lower()
                link_type = str(link.attrib.get("type", "") or "").strip().lower()
                if title_attr == "pdf" or link_type == "application/pdf":
                    pdf_url = href
                    break
            if not pdf_url and aid:
                pdf_url = aid.replace("abs", "pdf") + ".pdf"

            categories = []
            for cat in entry.findall("atom:category", ns):
                term = str(cat.attrib.get("term", "") or "").strip()
                if term:
                    categories.append(term)

            relevance_score = self._score_arxiv_item(
                query,
                title=title,
                summary=summary,
                categories=" ".join(categories),
            )

            items.append({
                "id": aid,
                "title": title,
                "authors": authors,
                "published": published,
                "updated": updated,
                "summary": summary,
                "pdf_url": pdf_url,
                "categories": categories,
                "relevance_score": relevance_score,
            })

        # Re-rank by local lexical relevance to reduce obviously unrelated entries.
        items = sorted(
            items,
            key=lambda x: (
                float(x.get("relevance_score", 0.0) or 0.0),
                str(x.get("updated", "") or ""),
            ),
            reverse=True,
        )
        if strict:
            filtered = [it for it in items if float(it.get("relevance_score", 0.0) or 0.0) > 0.0]
            if filtered:
                items = filtered
        items = items[:max_results]

        payload = {
            "success": True,
            "query": query,
            "effective_query": effective_query,
            "total_results": total_results,
            "fetched": len(entries),
            "returned": len(items),
            "strict": bool(strict),
            "items": items,
        }
        return json.dumps(payload, ensure_ascii=False)

    def _js_execute(self, args: Dict[str, Any]) -> str:
        raw_code = args.get("code")
        code = self._normalize_client_js_code(raw_code)
        if not code:
            return json.dumps({"success": False, "message": "missing code"}, ensure_ascii=False)
        if len(code) > 20000:
            return json.dumps({"success": False, "message": "code too long (max 20000 chars)"}, ensure_ascii=False)

        timeout_ms = args.get("timeout_ms", 8000)
        try:
            timeout_ms = int(timeout_ms)
        except Exception:
            timeout_ms = 8000
        timeout_ms = min(max(timeout_ms, 500), 30000)

        context = args.get("context", {})
        if not isinstance(context, dict):
            context = {}
        if len(json.dumps(context, ensure_ascii=False, default=str)) > 50000:
            return json.dumps({"success": False, "message": "context too large"}, ensure_ascii=False)

        conversation_id = str(getattr(self.model, "conversation_id", "") or "").strip()
        username = str(getattr(self.model, "username", "") or "").strip()
        if not conversation_id:
            return json.dumps(
                {"success": False, "message": "missing conversation_id for client js execution"},
                ensure_ascii=False
            )
        if not username:
            return json.dumps({"success": False, "message": "missing username"}, ensure_ascii=False)

        payload = request_client_js_execution(
            username=username,
            conversation_id=conversation_id,
            code=code,
            context=context,
            timeout_ms=timeout_ms,
        )
        if str(raw_code or "") != code:
            payload["code_normalized"] = True
        return json.dumps(payload, ensure_ascii=False, default=str)

    def _vector_search(self, args: Dict[str, Any]) -> str:
        query = args.get("query", "")
        top_k = int(args.get("top_k") or 5)
        library = str(args.get("library") or "knowledge").strip() or "knowledge"
        if not query:
            return "missing query"

        cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}
        rag_cfg = cfg.get("rag_database", {}) if isinstance(cfg, dict) else {}
        if not rag_cfg.get("rag_database_enabled", False):
            return "vector db disabled"

        try:
            store = ChromaStore(rag_cfg)
            result = store.query_text(
                self.model.username,
                query,
                top_k=top_k,
                library=library
            )
            ids = result.get("ids", [[]])[0] if isinstance(result.get("ids"), list) else []
            metas = result.get("metadatas", [[]])[0] if isinstance(result.get("metadatas"), list) else []
            docs = result.get("documents", [[]])[0] if isinstance(result.get("documents"), list) else []
            dists = result.get("distances", [[]])[0] if isinstance(result.get("distances"), list) else []
            payload = []
            q = str(query or "")
            q_lower = q.lower()
            title_to_basis_id = {}
            if library == "knowledge":
                try:
                    kb_map = self.model.user.getKnowledgeList(1)
                    if isinstance(kb_map, dict):
                        for t, m in kb_map.items():
                            if not isinstance(m, dict):
                                continue
                            bid = str(m.get("basis_id") or "").strip()
                            if bid:
                                title_to_basis_id[str(t)] = bid
                except Exception:
                    title_to_basis_id = {}
            for i, vid in enumerate(ids):
                meta = metas[i] if i < len(metas) else {}
                doc = str(docs[i] if i < len(docs) else "")
                score = None
                if i < len(dists) and dists[i] is not None:
                    score = 1 - dists[i]
                title_val = str(meta.get("title") or "").strip()
                basis_id = str(meta.get("basis_id") or "").strip() or str(title_to_basis_id.get(title_val) or "").strip()
                chunk_start = meta.get("chunk_start")
                chunk_end = meta.get("chunk_end")
                query_pos = None
                query_pos_abs = None
                if doc and q_lower:
                    rel = doc.lower().find(q_lower)
                    if rel >= 0:
                        query_pos = int(rel)
                        if isinstance(chunk_start, int):
                            query_pos_abs = int(chunk_start) + int(rel)
                payload.append({
                    "id": vid,
                    "article": title_val,
                    "title": title_val,
                    "basis_id": basis_id or None,
                    "library": library,
                    "chunk_id": meta.get("chunk_id"),
                    "chunk_start": chunk_start,
                    "chunk_end": chunk_end,
                    "score": score,
                    "query_position_in_chunk": query_pos,
                    "query_position_abs": query_pos_abs,
                    "preview": doc[:300]
                })
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return f"vector search error: {str(e)}, fall back to search_keyword immediately."

    def _file_semantic_search(self, args: Dict[str, Any]) -> str:
        query = str(args.get("query") or "").strip()
        if not query:
            return "missing query"
        try:
            top_k = int(args.get("top_k") or 5)
        except Exception:
            top_k = 5
        top_k = min(max(top_k, 1), 20)
        file_alias = str(args.get("file_alias") or "").strip()

        cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}
        rag_cfg = cfg.get("rag_database", {}) if isinstance(cfg, dict) else {}
        if not rag_cfg.get("rag_database_enabled", False):
            return "vector db disabled"

        where = None
        if file_alias:
            raw = file_alias.replace("\\", "/").strip()
            base = os.path.basename(raw) if raw else ""
            username = str(self.model.username or "")
            candidates = []
            if raw:
                candidates.append({"file_alias": raw})
                candidates.append({"sandbox_path": raw})
            if base:
                candidates.append({"file_alias": base})
                candidates.append({"sandbox_path": f"{username}/files/{base}"})

            uniq = []
            seen = set()
            for c in candidates:
                key = tuple(sorted(c.items()))
                if key in seen:
                    continue
                seen.add(key)
                uniq.append(c)
            if len(uniq) == 1:
                where = uniq[0]
            elif len(uniq) > 1:
                where = {"$or": uniq}

        try:
            store = ChromaStore(rag_cfg)
            result = store.query_text(
                self.model.username,
                query,
                top_k=top_k,
                library="temp_file",
                where=where
            )
            ids_check = result.get("ids", [[]]) if isinstance(result, dict) else [[]]
            first_ids = ids_check[0] if isinstance(ids_check, list) and ids_check and isinstance(ids_check[0], list) else []
            if file_alias and len(first_ids) == 0:
                # fallback: broaden query then post-filter by file metadata
                broad = store.query_text(
                    self.model.username,
                    query,
                    top_k=min(max(top_k * 6, top_k), 60),
                    library="temp_file",
                    where=None
                )
                raw = file_alias.replace("\\", "/").strip()
                base = os.path.basename(raw) if raw else ""
                expected_sandbox = f"{self.model.username}/files/{base}" if base else ""
                expected_title = f"temp_file::{base}" if base else ""

                b_ids = broad.get("ids", [[]]) if isinstance(broad, dict) else [[]]
                b_docs = broad.get("documents", [[]]) if isinstance(broad, dict) else [[]]
                b_metas = broad.get("metadatas", [[]]) if isinstance(broad, dict) else [[]]
                b_dists = broad.get("distances", [[]]) if isinstance(broad, dict) else [[]]
                src_ids = b_ids[0] if isinstance(b_ids, list) and b_ids and isinstance(b_ids[0], list) else []
                src_docs = b_docs[0] if isinstance(b_docs, list) and b_docs and isinstance(b_docs[0], list) else []
                src_metas = b_metas[0] if isinstance(b_metas, list) and b_metas and isinstance(b_metas[0], list) else []
                src_dists = b_dists[0] if isinstance(b_dists, list) and b_dists and isinstance(b_dists[0], list) else []

                f_ids, f_docs, f_metas, f_dists = [], [], [], []
                for i, vid in enumerate(src_ids):
                    meta = src_metas[i] if i < len(src_metas) and isinstance(src_metas[i], dict) else {}
                    m_alias = str(meta.get("file_alias") or "").strip()
                    m_path = str(meta.get("sandbox_path") or "").strip().replace("\\", "/")
                    m_title = str(meta.get("title") or "").strip()
                    m_original = str(meta.get("original_name") or "").strip()
                    matched = False
                    if raw and (m_alias == raw or m_path == raw):
                        matched = True
                    if (not matched) and base and (
                        m_alias == base
                        or m_original == base
                        or m_path.endswith(f"/{base}")
                        or m_path == expected_sandbox
                    ):
                        matched = True
                    if (not matched) and expected_title and m_title == expected_title:
                        matched = True
                    if not matched:
                        continue
                    f_ids.append(vid)
                    f_docs.append(src_docs[i] if i < len(src_docs) else "")
                    f_metas.append(meta)
                    f_dists.append(src_dists[i] if i < len(src_dists) else None)
                    if len(f_ids) >= top_k:
                        break
                result = {
                    "ids": [f_ids],
                    "documents": [f_docs],
                    "metadatas": [f_metas],
                    "distances": [f_dists],
                }
            ids = result.get("ids", [[]])[0] if isinstance(result.get("ids"), list) else []
            metas = result.get("metadatas", [[]])[0] if isinstance(result.get("metadatas"), list) else []
            docs = result.get("documents", [[]])[0] if isinstance(result.get("documents"), list) else []
            dists = result.get("distances", [[]])[0] if isinstance(result.get("distances"), list) else []

            payload = []
            for i, vid in enumerate(ids):
                meta = metas[i] if i < len(metas) else {}
                doc = str(docs[i] if i < len(docs) else "")
                score = None
                if i < len(dists) and dists[i] is not None:
                    score = 1 - dists[i]
                payload.append({
                    "id": vid,
                    "article": (meta.get("file_alias") or meta.get("title")),
                    "file_alias": meta.get("file_alias"),
                    "title": meta.get("title"),
                    "chunk_id": meta.get("chunk_id"),
                    "chunk_start": meta.get("chunk_start"),
                    "chunk_end": meta.get("chunk_end"),
                    "score": score,
                    "query_position_in_chunk": (
                        doc.lower().find(query.lower())
                        if query and doc and doc.lower().find(query.lower()) >= 0
                        else None
                    ),
                    "query_position_abs": (
                        (int(meta.get("chunk_start")) + int(doc.lower().find(query.lower())))
                        if query and doc and isinstance(meta.get("chunk_start"), int) and doc.lower().find(query.lower()) >= 0
                        else None
                    ),
                    "preview": doc[:300]
                })
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return f"file semantic search error: {str(e)}"

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
            if isinstance(payload, dict) and payload.get("success"):
                removed = payload.get("removed", {}) if isinstance(payload.get("removed"), dict) else {}
                alias = str(removed.get("alias") or "").strip()
                if alias:
                    cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}
                    rag_cfg = cfg.get("rag_database", {}) if isinstance(cfg, dict) else {}
                    if rag_cfg.get("rag_database_enabled", False):
                        try:
                            store = ChromaStore(rag_cfg)
                            if getattr(store, "mode", "") == "service":
                                store.delete_by_title(
                                    self.model.username,
                                    f"temp_file::{alias}",
                                    library="temp_file"
                                )
                                payload["vector_deleted"] = True
                            else:
                                payload["vector_deleted"] = False
                                payload["vector_delete_skipped"] = "non_service_mode"
                        except Exception as vec_err:
                            payload["vector_deleted"] = False
                            payload["vector_delete_error"] = str(vec_err)
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"success": False, "message": str(e)}, ensure_ascii=False)

