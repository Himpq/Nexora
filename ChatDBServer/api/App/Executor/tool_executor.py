import os
import json
import re
import unicodedata
import base64
import binascii
from typing import Any, Callable, Dict
from flask import has_request_context, request
from urllib import request as urllib_request, parse as urllib_parse, error as urllib_error
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET
import ssl
import uuid

from App.Storage import ChromaStore
from App.Storage import UserFileSandbox
from .document_generation import DocumentGenerationService
from App.Utils import request_client_js_execution
from basis.Conversation import persist_conversation_image_bytes
from basis.Conversation.context_reader import ConversationContextReader
from basis.TokenUsage import build_image_generation_log_context, record_papi_image_generation
from basis.Model.Provider import create_provider_adapter
from basis.Tool import canonicalize_tool_name
from App.Components import LearningRuntimeExecutor, get_learning_tools
from .longdoc_skills import read_longdoc_skill
from Map.baidu import BaiduMapToolService
from Map.tianditu import create_map_tool_service
from basis.Permission import build_permission_question_payload


class ToolExecutor:
    """
    Centralized tool dispatcher.
    Keeps tool routing and execution logic out of model.py.
    """

    def __init__(self, model):
        self.model = model
        self.handlers: Dict[str, Callable[[Dict[str, Any]], str]] = {
            # Select Tools 已下线，不再注册 runtime_tool_select。
            # "runtime_tool_select": self._runtime_tool_select,
            "runtime_tool_enable": self._runtime_tool_enable,
            "skill": self._skill,
            "question": self._question,
            "ask_for_permission": self._ask_for_permission,
            "knowledge_list": self._get_knowledge_list,
            "memory_short_add": self._add_short,
            # "queryShortMemory": self._query_short_memory,  # short-memory tools disabled
            "knowledge_basis_create": self._add_basis,
            # "removeShort": self._remove_short,  # short-memory tools disabled
            "knowledge_basis_delete": self._remove_basis,
            "knowledge_basis_update": self._update_basis,
            "knowledge_basis_read": self._get_basis_content,
            "longterm_plan": self._longterm_plan,
            "longterm_update": self._longterm_update,
            "search": self._unified_search,
            "exa_web_search": self._exa_web_search,
            "server_render_page": self._server_render_page,
            "generate_image": self._generate_image,
            "knowledge_search_keyword": self._search_keyword,
            "temp_context_read": self._temp_context_read,
            "temp_context_search": self._temp_context_search,
            "temp_context_list": self._temp_context_list,
            "temp_context_clear": self._temp_context_clear,
            "arxiv_search": self._arxiv_search,
            "js_execute": self._js_execute,
            "client_js_exec": self._js_execute,
            "memory_profile_read": self._get_user_profile_memory,
            "memory_short_update": self._set_user_profile_memory,
            "knowledge_search_vector": self._vector_search,
            "cloud_file_search_semantic": self._file_semantic_search,
            "link_knowledge": self._link_knowledge,
            "categorize_knowledge": self._categorize_knowledge,
            "create_category": self._create_category,
            "analyze_connections": self._analyze_connections,
            "knowledge_graph_read": self._get_knowledge_graph_structure,
            "get_knowledge_connections": self._get_knowledge_connections,
            "find_path_between_knowledge": self._find_path_between_knowledge,
            "conversation_context_length": self._get_context_length,
            "conversation_context_read": self._get_context,
            "conversation_context_search": self._get_context_find_keyword,
            "send_email": self._send_email,
            "get_email_list": self._get_email_list,
            "get_email": self._get_email,
            "cloud_file_create": self._file_create,
            "cloud_file_read": self._file_read,
            "cloud_file_write": self._file_write,
            "cloud_doc_write": self._doc_write,
            "cloud_file_apply_diff": self._file_apply_diff,
            "cloud_file_edit": self._file_edit,
            "cloud_file_find": self._file_find,
            "cloud_file_list": self._file_list,
            "cloud_file_remove": self._file_remove,
            "map_render": self._map_render,
            "map_calc_distance": self._map_calc_distance,
            "map_calc_route": self._map_calc_route,
            "map_geocode": self._map_geocode,
            "map_poi_search": self._map_poi_search,
        }
        self._file_sandbox = UserFileSandbox(self.model.username)
        self._learning_executor = None
        self._map_tool_service = None

    def _safe_int(self, v, default=None):
        try:
            if v is None:
                return default
            return int(str(v).strip())
        except Exception:
            return default

    def _safe_bool(self, value: Any, default: bool = False) -> bool:
        if value is None:
            return default

        if isinstance(value, bool):
            return value

        if isinstance(value, str):
            text = value.strip().lower()

            if text in {"1", "true", "yes", "y", "on"}:
                return True

            if text in {"0", "false", "no", "n", "off"}:
                return False

            return default

        return bool(value)

    def _has_arg_value(self, args: Dict[str, Any], key: str) -> bool:
        return key in args and args.get(key) is not None and str(args.get(key)).strip() != ""

    def _resolve_offset_length_slice(self, args: Dict[str, Any]):
        has_offset = self._has_arg_value(args, "offset")
        has_length = self._has_arg_value(args, "length")

        if has_offset != has_length:
            return None, None, "offset 和 length 必须同时提供。"

        if not has_offset:
            return None, None, ""

        offset = self._safe_int(args.get("offset"), None)
        length = self._safe_int(args.get("length"), None)

        if offset is None or length is None:
            return None, None, "offset 和 length 必须是整数。"

        if offset < 0:
            return None, None, "offset 必须大于等于 0。"

        if length <= 0:
            return None, None, "length 必须大于 0。"

        return offset, length, ""

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
        raw_name = str(function_name or "").strip()
        if self._is_learning_runtime_tool(raw_name):
            try:
                return self._get_learning_executor().execute(raw_name, args or {})
            except Exception as e:
                return f"错误：Learning 工具执行失败: {str(e)}"

        canonical_name = canonicalize_tool_name(raw_name)
        handler = self.handlers.get(canonical_name)
        if not handler:
            return f"错误：未知函数 {function_name}"
        safe_args = args if isinstance(args, dict) else {}
        return handler(safe_args)

    def _question(self, args: Dict[str, Any]) -> str:
        """创建一个需要前端等待用户回答的结构化问题。"""
        safe_args = args if isinstance(args, dict) else {}
        title = str(safe_args.get("question_title") or "").strip()
        content = str(safe_args.get("question_content") or "").strip()

        if not title or not content:
            return "错误：question_title 和 question_content 为必填"

        raw_choices = safe_args.get("choices", [])
        if raw_choices is None:
            raw_choices = []

        if not isinstance(raw_choices, list):
            return "错误：choices 必须是数组"

        choices = [str(item or "").strip() for item in raw_choices if str(item or "").strip()]
        track_answer = safe_args.get("track_answer", False)

        if not isinstance(track_answer, bool):
            return "错误：track_answer 必须是布尔值"

        question_id = str(safe_args.get("question_id") or "").strip()
        if track_answer and not question_id:
            return "错误：track_answer 为 true 时 question_id 必填"

        allow_other = safe_args.get("allow_other", True)
        if not isinstance(allow_other, bool):
            return "错误：allow_other 必须是布尔值"

        payload = {
            "success": True,
            "question": {
                "track_answer": track_answer,
                "question_id": question_id if track_answer else "",
                "question_title": title,
                "question_content": content,
                "choices": choices,
                "allow_other": allow_other,
            },
            "await": True,
        }
        return json.dumps(payload, ensure_ascii=False)

    def _ask_for_permission(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        path = str(safe_args.get("path") or "").strip()
        operation = str(safe_args.get("operation") or "read").strip().lower()
        scope = str(safe_args.get("scope") or "file").strip().lower()
        reason = str(safe_args.get("reason") or "").strip()
        sensitive = bool(safe_args.get("sensitive", False))

        if not path:
            return "错误：path 为必填"

        if operation not in {"read", "write", "read_write"}:
            return "错误：operation 必须是 read、write 或 read_write"

        if scope not in {"file", "dir"}:
            return "错误：scope 必须是 file 或 dir"

        if not reason:
            return "错误：reason 为必填"

        payload = build_permission_question_payload(
            path=path,
            operation=operation,
            scope=scope,
            reason=reason,
            sensitive=sensitive,
            project_root=str(getattr(self.model, "_runtime_nexoracode_project_path", "") or "").strip(),
        )
        return json.dumps(payload, ensure_ascii=False)

    def _is_learning_runtime_tool(self, function_name: str) -> bool:
        if str(getattr(self.model, "_runtime_conversation_mode", "") or "").strip().lower() != "learning":
            return False
        target = str(function_name or "").strip()
        if not target:
            return False
        try:
            tools = get_learning_tools() or []
        except Exception:
            return False
        for tool in tools:
            if not isinstance(tool, dict) or str(tool.get("type", "") or "").strip() != "function":
                continue
            fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
            name = str(fn.get("name", "") or "").strip()
            if name == target:
                return True
        return False

    def _get_learning_executor(self) -> LearningRuntimeExecutor:
        if self._learning_executor is None:
            cfg = {
                "_runtime_user_id": str(getattr(self.model, "username", "") or "").strip(),
            }
            self._learning_executor = LearningRuntimeExecutor(cfg)
        return self._learning_executor

    def _get_map_tool_service(self) -> BaiduMapToolService:
        if self._map_tool_service is None:
            config = getattr(self.model, "config", {}) if isinstance(getattr(self.model, "config", {}), dict) else {}
            self._map_tool_service = create_map_tool_service(
                config,
                username=str(getattr(self.model, "username", "") or "").strip(),
                conversation_id=str(getattr(self.model, "conversation_id", "") or "").strip(),
            )

        return self._map_tool_service

    def _map_render(self, args: Dict[str, Any]) -> str:
        return self._get_map_tool_service().render(args)

    def _map_calc_distance(self, args: Dict[str, Any]) -> str:
        return self._get_map_tool_service().calc_distance(args)

    def _map_calc_route(self, args: Dict[str, Any]) -> str:
        return self._get_map_tool_service().calc_route(args)

    def _map_geocode(self, args: Dict[str, Any]) -> str:
        return self._get_map_tool_service().geocode(args)

    def _map_poi_search(self, args: Dict[str, Any]) -> str:
        return self._get_map_tool_service().poi_search(args)

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
        if "_type" in args:
            try:
                requested_type = int(args.get("_type"))
            except (TypeError, ValueError):
                return json.dumps({
                    "success": False,
                    "error": "knowledge_list _type 必须为 1。"
                }, ensure_ascii=False)

            if requested_type != 1:
                return json.dumps({
                    "success": False,
                    "error": "knowledge_list 不再提供用户画像读取，只支持基础知识库。"
                }, ensure_ascii=False)

        result = self.model.user.getKnowledgeList(1)

        if isinstance(result, dict):
            items = []
            for title, meta in result.items():
                safe_meta = meta if isinstance(meta, dict) else {}
                items.append({
                    "title": str(title or ""),
                    "basis_id": str(safe_meta.get("basis_id") or "").strip() or None,
                    "public": bool(safe_meta.get("public", False)),
                    "collaborative": bool(safe_meta.get("collaborative", False)),
                    "model_readonly": bool(safe_meta.get("model_readonly", False)),
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
            max_chars=0
        )
        payload = {
            "success": True,
            "profile": str(profile or ""),
            "length": len(str(profile or "")),
            "max_length": 0
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
            max_chars=0
        )
        payload = {
            "success": True,
            "profile": str(profile or ""),
            "length": len(str(profile or "")),
            "max_length": 0,
            "reset": reset
        }
        return json.dumps(payload, ensure_ascii=False)

    # Select Tools 已下线：旧精确工具名解析与选择执行链路保留为注释。
    # def _collect_runtime_tool_names_from_args(self, args: Dict[str, Any]):
    #     ...
    #
    # def _runtime_catalog_names(self):
    #     ...
    #
    # def _apply_runtime_tool_selection(self, args: Dict[str, Any], *, allow_enable_all: bool = False) -> str:
    #     ...

    # Select Tools 已下线，旧 runtime_tool_select 入口保留为注释。
    # def _runtime_tool_select(self, args: Dict[str, Any]) -> str:
    #     return self._apply_runtime_tool_selection(args, allow_enable_all=False)

    def _runtime_tool_enable(self, args: Dict[str, Any]) -> str:
        enabler = getattr(self.model, "_enable_runtime_tools_for_current_reply", None)
        if not callable(enabler):
            return json.dumps(
                {"success": False, "message": "runtime enable-tools is unavailable"},
                ensure_ascii=False
            )
        result = enabler()
        if not isinstance(result, dict):
            result = {"success": False, "message": "invalid enable-tools result"}

        return json.dumps(result, ensure_ascii=False)

    def _resolve_longdoc_public_base_url(self) -> str:
        cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}
        api_cfg = cfg.get("api", {}) if isinstance(cfg.get("api"), dict) else {}
        public_base_url = str(
            cfg.get("public_base_url", "")
            or api_cfg.get("public_base_url", "")
            or os.environ.get("NEXORA_PUBLIC_BASE_URL", "")
            or ""
        ).strip().rstrip("/")

        if public_base_url and not public_base_url.startswith(("http://", "https://")):
            public_base_url = f"https://{public_base_url}"

        return public_base_url or "https://example.com"

    def _longdoc_skill_template_variables(self) -> Dict[str, str]:
        public_base_url = self._resolve_longdoc_public_base_url()
        values: Dict[str, str] = {
            "public_base_url": public_base_url,
            "site_base_url": public_base_url,
        }

        values.update({
            "papi_base_url": f"{public_base_url}/api/papi",
            "papi_v1_base_url": f"{public_base_url}/api/papi/v1",
            "papi_models_url": f"{public_base_url}/api/papi/v1/models",
            "papi_chat_completions_url": f"{public_base_url}/api/papi/v1/chat/completions",
            "papi_responses_url": f"{public_base_url}/api/papi/v1/responses",
            "papi_images_generations_url": f"{public_base_url}/api/papi/v1/images/generations",
            "public_knowledge_base_url": f"{public_base_url}/public/knowledge",
        })

        return values

    def _skill(self, args: Dict[str, Any]) -> str:
        skills = list(getattr(self.model, "_longdoc_skill_catalog", []) or [])
        name = args.get("name") if isinstance(args, dict) else ""
        result = read_longdoc_skill(
            skills,
            name,
            variables=self._longdoc_skill_template_variables()
        )

        try:
            payload = json.loads(result) if isinstance(result, str) else result
            success = bool(isinstance(payload, dict) and payload.get("success") is True)
            content_chars = len(str(payload.get("content") or "")) if isinstance(payload, dict) else 0
            skill_ids = [
                str(item.get("id") or "").strip()
                for item in skills[:20]
                if isinstance(item, dict) and str(item.get("id") or "").strip()
            ]
            print(
                "[LONGDOC_SKILL] "
                f"query={str(name or '').strip()} "
                f"catalog_count={len(skills)} "
                f"catalog_ids={','.join(skill_ids)} "
                f"success={success} "
                f"content_chars={content_chars} "
                f"result_chars={len(str(result or ''))}"
            )
        except Exception as exc:
            print(
                "[LONGDOC_SKILL] "
                f"query={str(name or '').strip()} "
                f"catalog_count={len(skills)} "
                f"log_error={exc}"
            )

        return result

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
            timeline_actor={
                "actor_type": "model_tool",
                "actor_name": str(getattr(self.model, "model_name", "") or "").strip() or "model",
                "conversation_id": str(getattr(self.model, "conversation_id", "") or "").strip(),
                "conversation_title": str(self.model.conversation_manager.get_conversation(self.model.conversation_id).get("title") if getattr(self.model, "conversation_id", None) else "").strip() if getattr(self.model, "conversation_id", None) else "",
            },
        )
        return "已添加到基础知识库"

    def _remove_short(self, args: Dict[str, Any]) -> str:
        self.model.user.removeShort(args.get("ID"))
        return "已删除短期记忆"

    def _remove_basis(self, args: Dict[str, Any]) -> str:
        title = str(args.get("title", "") or "").strip()
        meta = self.model.user.getBasisMetadata(title) or {}
        if isinstance(meta, dict) and meta and bool(meta.get("model_readonly", False)):
            return "删除失败: 该知识已启用模型只读，模型只能查阅和引用，不能删除。"

        self.model.user.removeBasis(
            title,
            timeline_actor={
                "actor_type": "model_tool",
                "actor_name": str(getattr(self.model, "model_name", "") or "").strip() or "model",
                "conversation_id": str(getattr(self.model, "conversation_id", "") or "").strip(),
                "conversation_title": str(self.model.conversation_manager.get_conversation(self.model.conversation_id).get("title") if getattr(self.model, "conversation_id", None) else "").strip() if getattr(self.model, "conversation_id", None) else "",
            },
        )
        return "已删除基础知识"

    # 旧批量 _update_basis 已试点下线（保留注释便于回滚）：
    # 原实现支持 from_pos/to_pos/replacement + replacements[] + patch + edits[] 批量四选一，
    # 长累计文本下批量 edits 易在 Flash 0731 上产生 JSON 语法错误，现改为仅允许单次原子 edit。

    def _update_basis(self, args: Dict[str, Any]) -> str:
        title = str(args.get("title", "") or "").strip()
        meta = self.model.user.getBasisMetadata(title) or {}
        if isinstance(meta, dict) and meta and bool(meta.get("model_readonly", False)):
            return "更新失败: 该知识已启用模型只读，模型只能查阅和引用，不能修改内容、标题或共享设置。"

        # 试点：拦截旧批量参数，引导模型走单次 edit（兼容 edits 为字符串的错误序列化）
        if "edits" in args:
            raw_edits = args.get("edits")
            # 旧批量无论是 list 还是误序列化为字符串都拦截
            if isinstance(raw_edits, list) and len(raw_edits) > 0:
                return "更新失败: 试点已下线批量 edits，单次仅允许1个单 edit。请改用单次参数 action+target+content/replacement，多次修改请多次调用。示例：{\"title\":\"...\",\"action\":\"insert_after\",\"target\":\"### 1. 标题\",\"content\":\"...\"}"
            if isinstance(raw_edits, str) and str(raw_edits).strip():
                # 典型错误：edits 传成了字符串 "[{...}]"
                preview = str(raw_edits).strip()[:120]
                return f"更新失败: edits 不应为字符串（收到 {preview}...），试点已下线批量 edits。请改用单次参数 action+target+content/replacement。示例：{{\"title\":\"...\",\"action\":\"insert_after\",\"target\":\"### 1. 标题\",\"content\":\"...\"}}"

        if isinstance(args.get("replacements"), list) and len(args.get("replacements") or []) > 0:
            return "更新失败: 试点已下线批量 replacements，请改用单次 action+target 方式，多次修改请多次调用。"

        if str(args.get("patch") or "").strip():
            return "更新失败: 试点已下线 patch 统一 diff，请改用单次 action+target 或 context 整段覆盖。"

        if args.get("from_pos") is not None or args.get("to_pos") is not None:
            return "更新失败: 试点已下线 from_pos/to_pos 区间替换，请改用单次 action+target 方式。"

        # 试点：若既无 context 也无单 edit，且无标题/URL/公开等元数据变更，直接判定为无效调用
        has_action = bool(str(args.get("action") or "").strip())
        has_target = bool(str(args.get("target") or "").strip())
        has_context = args.get("context") is not None
        has_meta = any([
            args.get("new_title"),
            args.get("url") is not None,
            args.get("public") is not None,
            args.get("collaborative") is not None,
        ])
        if not has_context and not (has_action and has_target) and not has_meta:
            return "更新失败: 未提供任何有效更新内容。单次仅支持 context 整段覆盖 或 action+target 单 edit 二选一。请检查是否误将 edits 传为字符串。"

        success, message = self.model.user.updateBasis(
            title=title,
            new_title=args.get("new_title"),
            context=args.get("context"),
            url=args.get("url"),
            is_public=args.get("public"),
            is_collaborative=args.get("collaborative"),
            action=args.get("action"),
            target=args.get("target"),
            replacement=args.get("replacement"),
            content=args.get("content"),
            occurrence=args.get("occurrence"),
            dry_run=self._safe_bool(args.get("dry_run"), False),
            expected_sha256=args.get("expected_sha256"),
            timeline_actor={
                "actor_type": "model_tool",
                "actor_name": str(getattr(self.model, "model_name", "") or "").strip() or "model",
                "conversation_id": str(getattr(self.model, "conversation_id", "") or "").strip(),
                "conversation_title": str(self.model.conversation_manager.get_conversation(self.model.conversation_id).get("title") if getattr(self.model, "conversation_id", None) else "").strip() if getattr(self.model, "conversation_id", None) else "",
            },
        )

        if isinstance(message, dict):
            if "success" not in message:
                message["success"] = bool(success)

            return json.dumps(message, ensure_ascii=False)

        if success:
            updates = []
            effective_title = str(args.get("new_title") or args.get("title") or "").strip()
            if args.get("new_title"):
                updates.append(f"标题已更新为'{args.get('new_title')}'")
            if args.get("context"):
                updates.append("内容已更新")
            if args.get("action") and args.get("target"):
                updates.append("单次编辑已应用" if not self._safe_bool(args.get("dry_run"), False) else "单次编辑已预览")
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
        has_keyword = bool(str(args.get("keyword") or "").strip())
        raw_case_sensitive = args.get("case_sensitive", True)
        if isinstance(raw_case_sensitive, bool):
            case_sensitive = raw_case_sensitive
        elif isinstance(raw_case_sensitive, str):
            case_sensitive = raw_case_sensitive.strip().lower() in {"1", "true", "yes", "y", "on"}
        else:
            case_sensitive = bool(raw_case_sensitive)

        offset, length, slice_error = self._resolve_offset_length_slice(args)
        if slice_error:
            return json.dumps({"success": False, "message": slice_error}, ensure_ascii=False)
        if offset is not None and has_keyword:
            return json.dumps({"success": False, "message": "keyword 不能和 offset/length 同时使用。"}, ensure_ascii=False)

        to_pos = None
        if offset is not None and length is not None:
            to_pos = offset + length

        return self.model.user.getBasisContent(
            title=args.get("title", ""),
            basis_id=args.get("basis_id"),
            keyword=args.get("keyword"),
            range_size=args.get("range"),
            from_pos=offset,
            to_pos=to_pos,
            regex_mode=regex_mode,
            max_matches=args.get("max_matches", 5),
            case_sensitive=case_sensitive,
        )

    def _search_keyword(self, args: Dict[str, Any]) -> str:
        return self.model.user.search_keyword(args.get("keyword", ""), args.get("range", 10))

    def _temp_context_read(self, args: Dict[str, Any]) -> str:
        rid = str(args.get("resource_id") or "").strip()
        if not rid:
            return json.dumps({"success": False, "message": "resource_id is required"}, ensure_ascii=False)
        return self.model.temp_cache_read(
            resource_id=rid,
            offset=args.get("offset", 0),
            length=args.get("length", 2000),
        )

    def _temp_context_search(self, args: Dict[str, Any]) -> str:
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

    def _temp_context_list(self, args: Dict[str, Any]) -> str:
        _ = args
        return self.model.temp_cache_list()

    def _temp_context_clear(self, args: Dict[str, Any]) -> str:
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
            return f"knowledge_search_vector error: {str(e)}. 请检查向量库状态，或明确调用 knowledge_search_keyword 做关键词检索。"

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
        length = ConversationContextReader(self.model.username).get_length(self.model.conversation_id)
        return f"对话长度: {length} 字符"

    def _get_context(self, args: Dict[str, Any]) -> str:
        reader = ConversationContextReader(self.model.username)
        content = reader.read(
            self.model.conversation_id,
            args.get("from_pos", 0),
            args.get("to_pos", None),
        )
        return content if content else "无内容"

    def _get_context_find_keyword(self, args: Dict[str, Any]) -> str:
        reader = ConversationContextReader(self.model.username)
        return reader.search(
            self.model.conversation_id,
            args.get("keyword", ""),
            args.get("range", 10),
        )

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
            has_line_range = self._has_arg_value(args, "from_line") or self._has_arg_value(args, "to_line")
            has_char_range = self._has_arg_value(args, "offset") or self._has_arg_value(args, "length")
            if has_line_range and has_char_range:
                return json.dumps({"success": False, "message": "from_line/to_line 不能和 offset/length 同时使用。"}, ensure_ascii=False)

            offset, length, slice_error = self._resolve_offset_length_slice(args)
            if slice_error:
                return json.dumps({"success": False, "message": slice_error}, ensure_ascii=False)

            to_pos = None
            if offset is not None and length is not None:
                to_pos = offset + length

            payload = self._file_sandbox.read_file(
                file_ref=str(file_ref),
                from_line=args.get("from_line"),
                to_line=args.get("to_line"),
                from_pos=offset,
                to_pos=to_pos,
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

    def _doc_write(self, args: Dict[str, Any]) -> str:
        file_ref = args.get("file_path") or args.get("path") or args.get("file")

        if not file_ref:
            return json.dumps({"success": False, "message": "file_path is required"}, ensure_ascii=False)

        markdown = args.get("markdown")

        if not isinstance(markdown, str) or not markdown.strip():
            return json.dumps({"success": False, "message": "markdown is required"}, ensure_ascii=False)

        doc_options = args.get("doc_options")

        if doc_options is None:
            doc_options = {}

        if not isinstance(doc_options, dict):
            return json.dumps({"success": False, "message": "doc_options must be an object"}, ensure_ascii=False)

        try:
            generation_result = DocumentGenerationService().create_docx(
                markdown=markdown,
                title=str(args.get("title") or "").strip(),
                doc_options=doc_options,
            )
            payload = self._file_sandbox.write_docx_file(
                file_ref=str(file_ref),
                docx_bytes=generation_result.docx_bytes,
                markdown=markdown,
                title=generation_result.title,
                overwrite=self._safe_bool(args.get("overwrite"), False),
                render_stats={
                    "block_count": generation_result.block_count,
                },
            )
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"success": False, "message": str(e)}, ensure_ascii=False)

    def _file_apply_diff(self, args: Dict[str, Any]) -> str:
        file_ref = args.get("file_path") or args.get("path") or args.get("file")
        patch_text = str(args.get("patch") or "").strip()

        if not file_ref:
            return json.dumps({"success": False, "message": "file_path is required"}, ensure_ascii=False)

        if not patch_text:
            return json.dumps({"success": False, "message": "patch is required"}, ensure_ascii=False)

        if isinstance(args.get("edits"), list):
            return json.dumps({"success": False, "message": "cloud_file_apply_diff 只接受 patch，不接受 edits"}, ensure_ascii=False)

        dry_run = self._safe_bool(args.get("dry_run"), False)

        try:
            payload = self._file_sandbox.patch_file(
                file_ref=str(file_ref),
                patch=args.get("patch"),
                edits=None,
                dry_run=dry_run,
                expected_sha256=args.get("expected_sha256"),
                tool_name="cloud_file_apply_diff",
            )
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"success": False, "message": str(e)}, ensure_ascii=False)

    def _file_edit(self, args: Dict[str, Any]) -> str:
        file_ref = args.get("file_path") or args.get("path") or args.get("file")
        edits = args.get("edits")

        if not file_ref:
            return json.dumps({"success": False, "message": "file_path is required"}, ensure_ascii=False)

        if not isinstance(edits, list) or not edits:
            return json.dumps({"success": False, "message": "edits must be a non-empty array"}, ensure_ascii=False)

        if str(args.get("patch") or "").strip():
            return json.dumps({"success": False, "message": "cloud_file_edit 只接受 edits，不接受 patch"}, ensure_ascii=False)

        dry_run = self._safe_bool(args.get("dry_run"), False)

        try:
            payload = self._file_sandbox.patch_file(
                file_ref=str(file_ref),
                patch="",
                edits=edits,
                dry_run=dry_run,
                expected_sha256=args.get("expected_sha256"),
                tool_name="cloud_file_edit",
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
            payload = self._file_sandbox.list_files(
                query=args.get("query"),
                regex=bool(args.get("regex", False)),
                offset=args.get("offset", 0),
                limit=args.get("limit", 200),
            )
            return json.dumps({
                "success": True,
                "username": self.model.username,
                "total": payload.get("total", 0),
                "offset": payload.get("offset", 0),
                "limit": payload.get("limit", 200),
                "files": payload.get("files", []),
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



    def _unified_search(self, args: Dict[str, Any]) -> str:
        """统一搜索工具：知识库（关键词+可用时的向量语义）、云盘文件、互联网一次查询。

        某来源后端未启用时跳过该来源并写入 notes，而不是让整次搜索失败。
        """

        query = str(args.get("query", "")).strip()

        if not query:
            return json.dumps({"success": False, "message": "query is required"}, ensure_ascii=False)

        scope = str(args.get("scope") or "all").strip().lower()

        if scope not in {"all", "knowledge", "files", "web"}:
            scope = "all"

        limit = max(1, min(int(args.get("limit") or 8), 20))
        results: Dict[str, Any] = {}
        notes = []

        if scope in {"all", "knowledge"}:
            results["knowledge"] = self._unified_search_knowledge(query, limit, notes)

        if scope in {"all", "files"}:
            results["files"] = self._unified_search_files(query, limit, notes)

        if scope in {"all", "web"}:
            results["web"] = self._unified_search_web(query, limit, notes)

        return json.dumps({
            "success": True,
            "query": query,
            "scope": scope,
            "results": results,
            "notes": notes,
        }, ensure_ascii=False)

    def _unified_search_knowledge(self, query: str, limit: int, notes: list) -> list:
        """知识库来源：关键词命中（标题+内容）为主，向量库启用时融合语义命中并按标题去重。"""

        items = []
        seen_titles = set()

        try:
            payload = json.loads(self.model.user.search_keyword(query, range_size=60))
            matches = payload.get("matches") if isinstance(payload, dict) else []

            for match in matches if isinstance(matches, list) else []:
                if not isinstance(match, dict):
                    continue

                title = str(match.get("title") or match.get("article") or "").strip()

                if not title or title in seen_titles:
                    continue

                seen_titles.add(title)
                items.append({
                    "title": title,
                    "snippet": str(match.get("snippet") or "").replace("\n", " ").strip()[:200],
                    "matched_by": "keyword",
                })

                if len(items) >= limit:
                    break
        except Exception as e:
            notes.append(f"knowledge keyword search failed: {e}")

        cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}
        rag_cfg = cfg.get("rag_database", {}) if isinstance(cfg, dict) else {}

        if not rag_cfg.get("rag_database_enabled", False):
            notes.append("vector db disabled, knowledge results are keyword-only")
            return items

        try:
            store = ChromaStore(rag_cfg)
            result = store.query_text(self.model.username, query, top_k=limit, library="knowledge")
            metas = result.get("metadatas", [[]])[0] if isinstance(result.get("metadatas"), list) else []
            docs = result.get("documents", [[]])[0] if isinstance(result.get("documents"), list) else []

            for meta, doc in zip(metas, docs):
                if len(items) >= limit:
                    break

                meta = meta if isinstance(meta, dict) else {}
                title = str(meta.get("title") or "").strip()

                if not title or title in seen_titles:
                    continue

                seen_titles.add(title)
                items.append({
                    "title": title,
                    "snippet": str(doc or "").replace("\n", " ").strip()[:200],
                    "matched_by": "semantic",
                })
        except Exception as e:
            notes.append(f"knowledge semantic search failed: {e}")

        return items

    def _unified_search_files(self, query: str, limit: int, notes: list) -> list:
        """云盘文件来源：按文件别名/原始名/路径模糊匹配。"""

        try:
            listing = self._file_sandbox.list_files(query=query, limit=limit)
            files = listing.get("files") if isinstance(listing, dict) else []
        except Exception as e:
            notes.append(f"file search failed: {e}")
            return []

        items = []

        for entry in files if isinstance(files, list) else []:
            if not isinstance(entry, dict):
                continue

            alias = str(entry.get("alias") or "").strip()

            if not alias:
                continue

            items.append({
                "alias": alias,
                "name": str(entry.get("original_name") or alias),
            })

        return items

    def _unified_search_web(self, query: str, limit: int, notes: list) -> list:
        """互联网来源：NexoraSearch 启用时查询，三引擎结果合并、按 URL 去重、瘦身输出。"""

        cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}
        search_cfg = cfg.get("nexora_search", {}) if isinstance(cfg, dict) else {}

        if not search_cfg.get("nexora_search_enabled", False):
            notes.append("web search unavailable: NexoraSearch is disabled")
            return []

        url = str(search_cfg.get("service_url", "http://127.0.0.1:8080")).strip('/')
        api_key = str(search_cfg.get("api_key", ""))
        timeout = search_cfg.get("timeout", 15)
        target_url = f"{url}/api/search/render?query={urllib_parse.quote(query)}"
        req = urllib_request.Request(target_url, headers={
            "Authorization": f"Bearer {api_key}" if api_key else ""
        })

        try:
            with urllib_request.urlopen(req, timeout=timeout) as resp:
                result = json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            notes.append(f"web search failed: {e}")
            return []

        if not result.get("success"):
            notes.append(f"web search failed: {result.get('error', 'unknown error')}")
            return []

        payload = result.get("results", {})

        if isinstance(payload, dict) and isinstance(payload.get("results"), dict):
            engine_map = payload.get("results", {})
        else:
            engine_map = payload if isinstance(payload, dict) else {}

        items = []
        seen_urls = set()

        for engine, engine_results in engine_map.items():
            if not isinstance(engine_results, list):
                continue

            for entry in engine_results:
                if not isinstance(entry, dict):
                    continue

                link = str(entry.get("url") or "").strip()

                if not link or link in seen_urls:
                    continue

                seen_urls.add(link)
                items.append({
                    "title": str(entry.get("title") or "").strip(),
                    "url": link,
                    "snippet": str(entry.get("snippet") or "").replace("\n", " ").strip()[:200],
                    "engine": str(engine),
                })

                if len(items) >= limit:
                    return items

        return items

    def _exa_web_search(self, args: Dict[str, Any]) -> str:
        """
        Exa AI 神经搜索工具

        强制使用 Exa 提供方，不受 web_search.active_provider 影响
        不再受 providers.<name>.enable_search 限制（该开关仅控制原生 web_search），
        只要配置了 EXA_API_KEY 即可调用；未配置时由 provider.search 返回明确错误。
        """

        query = str(args.get("query", "")).strip()

        if not query:
            return json.dumps({"success": False, "provider": "exa", "error": "query is required"}, ensure_ascii=False)

        num_results = max(1, min(int(args.get("num_results") or args.get("numResults") or args.get("limit") or 8), 20))

        search_type = str(args.get("type") or args.get("search_type") or "").strip().lower()

        if search_type and search_type not in {"auto", "fast", "instant", "deep-lite", "deep", "deep-reasoning"}:
            search_type = "auto"

        include_domains = args.get("include_domains", args.get("includeDomains"))
        exclude_domains = args.get("exclude_domains", args.get("excludeDomains"))

        cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}

        try:
            from App.Search.config import get_provider_config
            from App.Search.factory import create_search_provider

            provider_cfg = get_provider_config(cfg, "exa")
            provider = create_search_provider("exa", provider_cfg)

            kwargs: Dict[str, Any] = {"num_results": num_results}

            if search_type:
                kwargs["type"] = search_type

            if isinstance(include_domains, list) and include_domains:
                kwargs["includeDomains"] = [str(x).strip() for x in include_domains if str(x).strip()]

            if isinstance(exclude_domains, list) and exclude_domains:
                kwargs["excludeDomains"] = [str(x).strip() for x in exclude_domains if str(x).strip()]

            result = provider.search(query=query, **kwargs)

        except Exception as exc:
            return json.dumps({"success": False, "provider": "exa", "query": query, "error": str(exc)}, ensure_ascii=False)

        if not result.ok:
            return json.dumps(
                {"success": False, "provider": "exa", "query": query, "error": result.error},
                ensure_ascii=False,
            )

        items = []

        for hit in result.hits[:num_results]:
            # Markdown 精简：片段与高亮截短，减少 token，同时保留 image/favicon/author 供展示
            snippet_short = str(hit.snippet or "").strip()[:320]
            highlights_short = [str(h).strip()[:280] for h in (hit.highlights or [])[:2] if str(h).strip()]

            items.append(
                {
                    "title": hit.title,
                    "url": hit.url,
                    "snippet": snippet_short,
                    "highlights": highlights_short,
                    "published_date": hit.published_date,
                    "score": hit.score,
                    "image": hit.image,
                    "favicon": hit.favicon,
                    "author": hit.author,
                }
            )

        payload: Dict[str, Any] = {
            "success": True,
            "provider": "exa",
            "query": query,
            "type": search_type or "auto",
            "results": items,
        }

        # 顶层 images：仅保留可展示的真实配图，过滤 logo/favicon/svg/gif，去重
        def _is_displayable(url: str) -> bool:
            u = str(url or "").strip()
            if not u.startswith("https://"):
                return False
            low = u.lower()
            if low.endswith(".svg") or low.endswith(".ico") or low.endswith(".gif"):
                return False
            if any(tok in low for tok in ("logo", "favicon", "disambig", "sprite", "/40px-")):
                return False
            return True

        seen = set()
        filtered_images = []
        for it in items:
            u = str(it.get("image") or "").strip()
            if _is_displayable(u) and u not in seen:
                seen.add(u)
                filtered_images.append(u)

        payload["images"] = filtered_images

        # 结构化输出透传（若提供方返回 output）
        if isinstance(result.raw, dict) and result.raw.get("output"):
            payload["output"] = result.raw.get("output")

        return json.dumps(payload, ensure_ascii=False)

    def _server_render_page(self, args: Dict[str, Any]) -> str:
        url = str(args.get("url", "")).strip()
        if not url:
            return "Error: Missing url parameter."

        cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}
        search_cfg = cfg.get("nexora_search", {}) if isinstance(cfg, dict) else {}

        if not search_cfg.get("nexora_search_enabled", False):
            return "NexoraSearch is currently disabled."

        service_url = str(search_cfg.get("service_url", "http://127.0.0.1:8080")).strip().rstrip("/")
        api_key = str(search_cfg.get("api_key", ""))
        timeout = args.get("timeout_ms", search_cfg.get("timeout", 15))
        try:
            timeout = int(timeout)
        except Exception:
            timeout = 15

        target_url = f"{service_url}/api/render/webview?url={urllib_parse.quote(url)}&timeout={timeout}"
        req = urllib_request.Request(target_url, headers={
            "Authorization": f"Bearer {api_key}" if api_key else ""
        })

        try:
            with urllib_request.urlopen(req, timeout=timeout) as resp:
                data = resp.read().decode('utf-8')
                result = json.loads(data)

                if not result.get("success"):
                    return f"Render Request Failed: {result.get('error', 'Unknown Error')}"

                final_url = str(result.get("url", url) or url).strip()
                title = str(result.get("title", "") or "").strip()
                content = str(result.get("content", "") or "")
                mode = str(result.get("mode", result.get("warning", "unknown")) or "unknown").strip()
                original_url = str(result.get("original_url", url) or url).strip()

                output = [f"Render Result for '{url}':"]
                output.append(f"original_url: {original_url}")
                output.append(f"final_url: {final_url}")
                output.append(f"title: {title or '(empty)'}")
                output.append(f"mode: {mode}")
                output.append(f"content_length: {len(content)}")
                warning = str(result.get("warning", "") or "").strip()
                if warning:
                    output.append(f"warning: {warning}")
                if content:
                    output.append("content:")
                    output.append(content[:12000])
                else:
                    output.append("content: (empty)")

                return "\n".join(output)[:12000]
        except urllib_error.HTTPError as e:
            msg = e.read().decode('utf-8') if e.fp else str(e)
            return f"HTTP Error {e.code}: {msg}"
        except Exception as e:
            return f"Render Internal Error: {str(e)}"


    def _get_enabled_gen_image_api(self) -> Dict[str, Any]:
        cfg = self.model.config if isinstance(getattr(self.model, "config", None), dict) else {}
        gen_cfg = cfg.get("gen_image", {}) if isinstance(cfg.get("gen_image", {}), dict) else {}
        apis = gen_cfg.get("apis", {}) if isinstance(gen_cfg.get("apis", {}), dict) else {}
        enabled_api = str(gen_cfg.get("enabled_api", "") or "").strip()

        if not enabled_api:
            raise ValueError("未启用生图接口")

        api_cfg = apis.get(enabled_api)

        if not isinstance(api_cfg, dict):
            raise ValueError(f"已启用的生图接口不存在: {enabled_api}")

        return dict(api_cfg)

    def _safe_gen_image_count(self, raw_count: Any) -> int:
        try:
            count = int(raw_count or 1)
        except Exception:
            count = 1

        return max(1, min(count, 4))

    def _decode_generated_image_bytes(self, b64_text: str) -> bytes:
        raw_text = str(b64_text or "").strip()

        if not raw_text:
            raise ValueError("图片 base64 为空")

        if raw_text.startswith("data:image/"):
            _, raw_text = raw_text.split(",", 1)

        try:
            return base64.b64decode(raw_text, validate=True)
        except (ValueError, binascii.Error) as e:
            raise ValueError(f"图片 base64 无法解析: {str(e)}")

    def _generated_image_markdown(self, images: list) -> str:
        lines = []

        for idx, item in enumerate(images, 1):
            url = str((item or {}).get("asset_url") or (item or {}).get("url") or "").strip()

            if not url:
                continue

            lines.append(f"![生成图片 {idx}]({url})")

        return "\n\n".join(lines)

    def _normalize_generated_image_progress(self, raw_progress: Any) -> list:
        """Normalize image generation stage logs for the tool result payload."""
        logs = []

        if not isinstance(raw_progress, list):
            return logs

        for entry in raw_progress:
            if isinstance(entry, str):
                text = entry.strip()
            elif isinstance(entry, dict):
                nested_logs = entry.get("logs")

                if isinstance(nested_logs, list):
                    logs.extend(self._normalize_generated_image_progress(nested_logs))
                    continue

                text = str(entry.get("log") or entry.get("message") or entry.get("text") or "").strip()
            else:
                text = str(entry or "").strip()

            if text:
                logs.append(text)

        return logs

    def _generate_image(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        prompt = str(safe_args.get("prompt", "") or "").strip()

        if not prompt:
            return json.dumps({"success": False, "message": "prompt 不能为空"}, ensure_ascii=False)

        api_name = "gen_image"
        api_type = "openai"
        model_id = ""
        size = str(safe_args.get("size") or "1024x1024").strip()
        quality = str(safe_args.get("quality") or "auto").strip()
        response_format = "b64_json"
        image_count = self._safe_gen_image_count(safe_args.get("n", 1))
        remote_addr = ""
        user_agent = ""

        if has_request_context():
            remote_addr = str(getattr(request, "remote_addr", "") or "").strip()
            user_agent = str(request.headers.get("User-Agent") or "").strip()

        image_log_context = build_image_generation_log_context(
            username=str(getattr(self.model, "username", "") or "").strip(),
            conversation_id=str(getattr(self.model, "conversation_id", "") or "").strip(),
            request_path="chat.generate_image",
            method="TOOL",
            remote_addr=remote_addr,
            user_agent=user_agent,
        )

        def write_image_generation_log(status: str, images=None, error: str = "") -> None:
            try:
                record_papi_image_generation(
                    image_log_context,
                    prompt=prompt,
                    provider=api_name,
                    model=model_id,
                    size=size,
                    quality=quality,
                    response_format=response_format,
                    requested_count=image_count,
                    images=images if isinstance(images, list) else [],
                    request_path="chat.generate_image",
                    status=status,
                    error=error,
                    extra={
                        "api_type": api_type,
                        "conversation_id": str(getattr(self.model, "conversation_id", "") or "").strip(),
                    },
                )
            except Exception as log_error:
                print(f"[GEN_IMAGE_LOG] write failed: {log_error}")

        try:
            api_cfg = self._get_enabled_gen_image_api()
            api_name = str(api_cfg.get("api_id") or api_cfg.get("name") or "gen_image").strip() or "gen_image"
            api_type = str(api_cfg.get("api_type") or "openai").strip() or "openai"
            api_key = str(api_cfg.get("api_key") or "").strip()
            base_url = str(api_cfg.get("base_url") or "").strip().rstrip("/")
            model_id = str(api_cfg.get("model") or "").strip()
            size = str(safe_args.get("size") or api_cfg.get("size") or "1024x1024").strip()
            quality = str(safe_args.get("quality") or api_cfg.get("quality") or "auto").strip()
            response_format = str(api_cfg.get("response_format") or "b64_json").strip()
            timeout = int(api_cfg.get("timeout") or 120)
            image_count = self._safe_gen_image_count(safe_args.get("n", 1))

            if not api_key:
                raise ValueError("生图 API Key 不能为空")

            if not base_url:
                raise ValueError("生图 Base URL 不能为空")

            if not model_id:
                raise ValueError("生图模型不能为空")

            if not str(getattr(self.model, "conversation_id", "") or "").strip():
                raise ValueError("当前会话 ID 为空，无法保存生图结果")

            adapter = create_provider_adapter(api_name, {
                "api_key": api_key,
                "base_url": base_url,
                "api_type": api_type,
            })
            print(f"[GEN_IMAGE] api={api_name} model={model_id} size={size} n={image_count}")
            result = adapter.generate_image(
                api_key=api_key,
                base_url=base_url,
                model_id=model_id,
                prompt=prompt,
                size=size,
                n=image_count,
                quality=quality,
                response_format=response_format,
                timeout=timeout,
            )
            raw_images = result.get("images", []) if isinstance(result, dict) else []
            progress_logs = self._normalize_generated_image_progress(result.get("progress", [])) if isinstance(result, dict) else []

            def add_progress(logs: list) -> None:
                for text in logs:
                    if text not in progress_logs:
                        progress_logs.append(text)

            if not isinstance(raw_images, list) or not raw_images:
                raise ValueError("生图接口没有返回图片")

            images = []

            for idx, item in enumerate(raw_images, 1):

                if not isinstance(item, dict):
                    continue

                image_url = str(item.get("url") or "").strip()
                b64_json = str(item.get("b64_json") or "").strip()
                revised_prompt = str(item.get("revised_prompt") or "").strip()
                item_progress = self._normalize_generated_image_progress(item.get("progress", []))
                add_progress(item_progress)

                if b64_json:
                    raw = self._decode_generated_image_bytes(b64_json)
                    asset = persist_conversation_image_bytes(
                        username=self.model.username,
                        conversation_id=self.model.conversation_id,
                        image_bytes=raw,
                        mime="image/png",
                        name=f"generated_image_{idx}.png",
                        metadata={
                            "source": "generate_image",
                            "prompt": prompt,
                            "model": model_id,
                            "api": api_name,
                        },
                    )
                    image_item = {
                        "index": idx,
                        "asset_id": asset.get("asset_id"),
                        "asset_url": asset.get("asset_url"),
                        "mime": asset.get("mime"),
                        "size": asset.get("size"),
                        "revised_prompt": revised_prompt,
                    }

                    if item_progress:
                        image_item["progress"] = item_progress

                    images.append(image_item)
                    continue

                if image_url:
                    image_item = {
                        "index": idx,
                        "url": image_url,
                        "revised_prompt": revised_prompt,
                    }

                    if item_progress:
                        image_item["progress"] = item_progress

                    images.append(image_item)

            if not images:
                raise ValueError("生图接口返回了图片数据，但没有可展示的图片地址")

            markdown = self._generated_image_markdown(images)
            model_result = "图片生成成功，图片已自动展示在聊天记录中。"
            payload = {
                "success": True,
                "message": model_result,
                "model_result": model_result,
                "api": api_name,
                "model": model_id,
                "prompt": prompt,
                "images": images,
                "markdown": markdown,
                "progress": progress_logs,
            }
            write_image_generation_log("success", images=images)
            return json.dumps(payload, ensure_ascii=False)
        except Exception as e:
            print(f"[GEN_IMAGE] failed: {e}")
            write_image_generation_log("error", error=str(e))
            return json.dumps({"success": False, "message": str(e)}, ensure_ascii=False)
