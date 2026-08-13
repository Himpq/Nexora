"""
Nexora.app.Components.Mail — NexoraMail 链接桥

职责：模型调用 NexoraMail 服务的链接桥梁（HTTP 调用、邮件工具注入、发送/读取工具）。
归入 app.Components（其他项目链接桥梁），不再属于 basis.Model。

对外提供：
- MailMixin: 邮件工具混合类（Model 主类继承）
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
from datetime import datetime
from email.header import Header
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Optional
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlsplit


class MailMixin:
    def _get_model_data_dir(self) -> str:
        """延迟获取 model 模块的 DATA_DIR（避免顶层循环导入）。"""
        from App.Core.model import DATA_DIR
        return DATA_DIR

    def _get_nexora_mail_config(self) -> Dict[str, Any]:
        """读取 NexoraMail 集成配置"""
        mail_cfg = self.config.get("nexora_mail", {}) if isinstance(self.config, dict) else {}
        host = str(mail_cfg.get("host", "127.0.0.1")).strip() or "127.0.0.1"
        port_raw = mail_cfg.get("port", 17171)
        try:
            port = int(port_raw)
        except Exception:
            port = 17171

        service_url = str(mail_cfg.get("service_url", "") or "").strip()
        if not service_url:
            service_url = f"http://{host}:{port}"

        timeout_raw = mail_cfg.get("timeout", 10)
        try:
            timeout = int(timeout_raw)
        except Exception:
            timeout = 10
        timeout = max(1, timeout)

        send_timeout_raw = mail_cfg.get("send_timeout", 120)
        try:
            send_timeout = int(send_timeout_raw)
        except Exception:
            send_timeout = 120
        send_timeout = max(1, send_timeout)

        return {
            "enabled": bool(mail_cfg.get("nexora_mail_enabled", False)),
            "host": host,
            "port": port,
            "service_url": service_url.rstrip("/"),
            "api_key": str(mail_cfg.get("api_key", "") or "").strip(),
            "timeout": timeout,
            "send_timeout": send_timeout,
            "default_group": str(mail_cfg.get("default_group", "default") or "default").strip() or "default",
        }

    def _nexora_mail_call(
        self,
        path: str,
        method: str = "GET",
        payload: Optional[Dict[str, Any]] = None,
        query: Optional[Dict[str, Any]] = None,
        timeout: Optional[int] = None
    ):
        """调用 NexoraMail API，返回 (ok, status, data)"""
        cfg = self._get_nexora_mail_config()
        if not cfg.get("enabled"):
            return False, 503, {"success": False, "message": "NexoraMail disabled"}

        q = ""
        if query and isinstance(query, dict):
            pairs = []
            for k, v in query.items():
                if v is None:
                    continue
                pairs.append((k, str(v)))
            if pairs:
                q = "?" + urllib_parse.urlencode(pairs)

        url = f"{cfg['service_url']}{path}{q}"
        headers = {"Accept": "application/json"}
        if cfg.get("api_key"):
            headers["X-API-Key"] = cfg["api_key"]

        body = None
        if payload is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        req = urllib_request.Request(url, data=body, method=str(method or "GET").upper(), headers=headers)
        request_timeout = int(timeout) if timeout is not None else int(cfg["timeout"])
        if request_timeout <= 0:
            request_timeout = int(cfg["timeout"])
        try:
            with urllib_request.urlopen(req, timeout=request_timeout) as resp:
                status = int(getattr(resp, "status", 200) or 200)
                raw = resp.read().decode("utf-8", errors="replace")
                data = {}
                if raw.strip():
                    try:
                        data = json.loads(raw)
                    except Exception:
                        data = {"success": 200 <= status < 300, "raw": raw}
                if not isinstance(data, dict):
                    data = {"success": 200 <= status < 300}
                if "success" not in data:
                    data["success"] = 200 <= status < 300
                return 200 <= status < 300, status, data
        except urllib_error.HTTPError as e:
            status = int(getattr(e, "code", 500) or 500)
            try:
                raw = e.read().decode("utf-8", errors="replace")
                data = json.loads(raw) if raw.strip() else {}
            except Exception:
                data = {}
            if not isinstance(data, dict):
                data = {}
            if "message" not in data:
                data["message"] = f"NexoraMail HTTP {status}"
            data["success"] = False
            return False, status, data
        except Exception as e:
            return False, 502, {"success": False, "message": f"NexoraMail connect failed: {str(e)}"}

    def _resolve_local_mail_binding(self):
        """解析当前用户绑定的本地邮箱账号"""
        users_path = os.path.join(self._get_model_data_dir(), "user.json")
        if not os.path.exists(users_path):
            return None, "user database not found"

        try:
            with open(users_path, "r", encoding="utf-8") as f:
                users = json.load(f)
        except Exception as e:
            return None, f"failed to read user database: {str(e)}"

        user = users.get(self.username)
        if not isinstance(user, dict):
            return None, "current user not found"

        local_mail = user.get("local_mail", {}) if isinstance(user.get("local_mail"), dict) else {}
        mail_username = str(local_mail.get("username", "") or "").strip()
        if not mail_username:
            return None, "local mail account is not bound for current user"

        cfg = self._get_nexora_mail_config()
        group = str(local_mail.get("group") or cfg.get("default_group") or "default").strip() or "default"
        return {
            "group": group,
            "mail_username": mail_username,
            "local_mail": local_mail,
        }, None

    def _can_inject_mail_tools(self) -> Tuple[bool, str]:
        """判断当前会话是否应向模型注入 NexoraMail 工具定义。"""
        cfg = self._get_nexora_mail_config()

        if not cfg.get("enabled"):
            return False, "NexoraMail 未启用"

        _, bind_err = self._resolve_local_mail_binding()

        if bind_err:
            return False, bind_err

        return True, ""

    def _get_nexora_mail_primary_domain(self, group_name: str) -> Optional[str]:
        ok, _, data = self._nexora_mail_call("/api/groups", method="GET")
        if not ok or not isinstance(data, dict):
            return None
        groups = data.get("groups", [])
        if not isinstance(groups, list):
            return None
        target = str(group_name or "").strip()
        for item in groups:
            if not isinstance(item, dict):
                continue
            if str(item.get("group") or "").strip() != target:
                continue
            domains = item.get("domains", [])
            if isinstance(domains, list):
                for d in domains:
                    domain = str(d or "").strip()
                    if domain:
                        return domain
        return None

    def _build_nexora_sender_address(self, mail_username: str, group_name: str) -> str:
        local = str(mail_username or "").strip()
        if "@" in local:
            local = local.split("@", 1)[0].strip()
        if not local:
            return ""

        cfg = self._get_nexora_mail_config()
        domain = self._get_nexora_mail_primary_domain(group_name) or cfg.get("host") or "localhost"
        domain = str(domain).strip() or "localhost"
        return f"{local}@{domain}"

    def _decode_literal_unicode_escapes(self, text: Any) -> str:
        """
        Decode literal unicode escapes that may come from LLM tool arguments, e.g.
        '\\\\u4f60\\\\u597d' or '\\\\U0001f464' -> actual characters.
        Keep normal text unchanged.
        """
        s = str(text or "")
        if ("\\" not in s) or ("\\u" not in s and "\\U" not in s and "\\x" not in s):
            return s

        # Handle surrogate pairs first: \uD83D\uDC64 -> 😀-style codepoint
        def repl_surrogate_pair(m):
            hi = int(m.group(1), 16)
            lo = int(m.group(2), 16)
            codepoint = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
            try:
                return chr(codepoint)
            except Exception:
                return m.group(0)

        out = re.sub(
            r"\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][cdefCDEF][0-9a-fA-F]{2})",
            repl_surrogate_pair,
            s,
        )

        def repl_u8(m):
            try:
                return chr(int(m.group(1), 16))
            except Exception:
                return m.group(0)

        def repl_u4(m):
            try:
                cp = int(m.group(1), 16)
                # Skip lone surrogates (already handled above).
                if 0xD800 <= cp <= 0xDFFF:
                    return m.group(0)
                return chr(cp)
            except Exception:
                return m.group(0)

        def repl_x2(m):
            try:
                return chr(int(m.group(1), 16))
            except Exception:
                return m.group(0)

        out = re.sub(r"\\U([0-9a-fA-F]{8})", repl_u8, out)
        out = re.sub(r"\\u([0-9a-fA-F]{4})", repl_u4, out)
        out = re.sub(r"\\x([0-9a-fA-F]{2})", repl_x2, out)
        return out

    def _garbled_score_text(self, text: Any) -> int:
        s = str(text or "")
        if not s:
            return 0
        suspicious = ("鎴", "馃", "锛", "锟", "�", "鏄", "鍐", "涓", "鐨")
        score = 0
        for token in suspicious:
            score += s.count(token)
        return score

    def _repair_common_mojibake(self, text: Any) -> str:
        """
        Repair common UTF-8<->GBK mojibake in short text (mainly subject lines).
        """
        src = str(text or "")
        if not src:
            return src
        best = src
        best_score = self._garbled_score_text(src)
        for enc in ("gb18030", "gbk"):
            try:
                cand = src.encode(enc, errors="strict").decode("utf-8", errors="strict")
            except Exception:
                continue
            cand_score = self._garbled_score_text(cand)
            if cand_score < best_score:
                best = cand
                best_score = cand_score
        return best

    def _build_utf8_raw_mail(self, sender: str, recipient: str, subject: str, content: str, is_html: bool) -> str:
        """Build MIME raw email with UTF-8-safe headers/body."""
        ctype = "text/html" if is_html else "text/plain"
        subject_header = Header(subject or "", "utf-8").encode()
        body_bytes = str(content or "").encode("utf-8", errors="replace")
        body_b64 = base64.b64encode(body_bytes).decode("ascii")
        body_lines = "\r\n".join(textwrap.wrap(body_b64, 76)) if body_b64 else ""
        return (
            f"From: <{sender}>\r\n"
            f"To: <{recipient}>\r\n"
            f"Subject: {subject_header}\r\n"
            "MIME-Version: 1.0\r\n"
            f"Content-Type: {ctype}; charset=\"UTF-8\"\r\n"
            "Content-Transfer-Encoding: base64\r\n"
            "\r\n"
            f"{body_lines}\r\n"
        )

    def _tool_send_email(self, args: Dict[str, Any]) -> str:
        """sendEMail 工具执行入口"""
        cfg = self._get_nexora_mail_config()
        if not cfg.get("enabled"):
            return "发送失败：NexoraMail 未启用"

        recipient = str(args.get("recipient") or args.get("to") or "").strip()
        subject = str(args.get("subject") or "").strip() or "(No Subject)"
        content = args.get("content")
        knowledge_title = str(args.get("knowledge_title") or "").strip()
        is_html = bool(args.get("is_html", False))

        if not recipient:
            return "发送失败：缺少 recipient"

        if (content is None or str(content).strip() == "") and knowledge_title:
            try:
                content = self.user.getBasisContent(knowledge_title)
            except Exception as e:
                return f"发送失败：读取知识内容失败 ({str(e)})"
            if not subject or subject == "(No Subject)":
                subject = f"[Knowledge] {knowledge_title}"

        if content is None:
            content = ""
        content = str(content)

        # Normalize escaped unicode from tool-argument text, e.g. "\U0001f464"
        subject = self._decode_literal_unicode_escapes(subject)
        content = self._decode_literal_unicode_escapes(content)
        subject = self._repair_common_mojibake(subject)

        if not content.strip():
            return "发送失败：缺少 content（可提供 content 或 knowledge_title）"

        binding, bind_err = self._resolve_local_mail_binding()
        if bind_err:
            return f"发送失败：{bind_err}"

        sender = self._build_nexora_sender_address(binding["mail_username"], binding["group"])
        if not sender:
            return "发送失败：无法生成发件地址"

        send_body = {
            "group": binding["group"],
            "sender": sender,
            "recipient": recipient,
            "subject": subject,
            "raw": self._build_utf8_raw_mail(
                sender=sender,
                recipient=recipient,
                subject=subject,
                content=content,
                is_html=is_html,
            ),
        }

        ok, status, data = self._nexora_mail_call(
            "/api/send",
            method="POST",
            payload=send_body,
            timeout=int(cfg.get("send_timeout", cfg.get("timeout", 10))),
        )
        if not ok:
            message = data.get("message") if isinstance(data, dict) else ""
            return f"发送失败：{message or f'NexoraMail HTTP {status}'}"

        return f"邮件发送成功：{sender} -> {recipient}，主题：{subject}"

    def _tool_get_email_list(self, args: Dict[str, Any]) -> str:
        """getEMailList 工具执行入口"""
        cfg = self._get_nexora_mail_config()
        if not cfg.get("enabled"):
            return "获取失败：NexoraMail 未启用"

        binding, bind_err = self._resolve_local_mail_binding()
        if bind_err:
            return f"获取失败：{bind_err}"

        group = str(binding.get("group") or "default").strip() or "default"
        username = str(binding.get("mail_username") or "").strip()
        if not username:
            return "获取失败：未绑定本地邮箱用户名"

        q = str(args.get("query") or "").strip()
        try:
            mail_list_type = int(args.get("type", 1) or 1)
        except Exception:
            mail_list_type = 1
        if mail_list_type not in (0, 1):
            mail_list_type = 1
        try:
            date_range_days = int(args.get("date_range", 15) or 15)
        except Exception:
            date_range_days = 15
        # 默认最近15天；允许显式传 <=0 表示不限制
        if date_range_days < 0:
            date_range_days = 15
        try:
            offset = max(int(args.get("offset", 0) or 0), 0)
        except Exception:
            offset = 0
        try:
            limit = int(args.get("limit", 20) or 20)
        except Exception:
            limit = 20
        limit = min(max(limit, 1), 100)

        path = f"/api/mailboxes/{urllib_parse.quote(group)}/{urllib_parse.quote(username)}/mails"
        query = {"offset": offset, "limit": limit}
        if q:
            query["q"] = q

        ok, status, data = self._nexora_mail_call(path, method="GET", query=query)
        if not ok:
            msg = data.get("message") if isinstance(data, dict) else ""
            return f"获取失败：{msg or f'NexoraMail HTTP {status}'}"

        source_mails = data.get("mails") or []

        def _resolve_mail_timestamp(mail_item: Dict[str, Any]) -> int:
            """优先用 timestamp；缺失时解析 date 字段（兼容 RFC822 / 普通日期字符串）。"""
            try:
                ts = int(mail_item.get("timestamp", 0) or 0)
            except Exception:
                ts = 0
            if ts > 0:
                return ts

            date_text_raw = str(mail_item.get("date") or "").strip()
            if not date_text_raw:
                return 0
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    return int(datetime.strptime(date_text_raw, fmt).timestamp())
                except Exception:
                    pass
            try:
                return int(parsedate_to_datetime(date_text_raw).timestamp())
            except Exception:
                return 0

        if date_range_days > 0:
            cutoff_ts = int(time.time()) - int(date_range_days) * 86400
            source_mails = [
                m for m in source_mails
                if isinstance(m, dict) and _resolve_mail_timestamp(m) >= cutoff_ts
            ]
        if mail_list_type == 0:
            source_mails = [m for m in source_mails if isinstance(m, dict) and not bool(m.get("is_read", False))]

        mails = []
        for m in source_mails:
            if not isinstance(m, dict):
                continue
            ts = int(m.get("timestamp", 0) or 0)
            date_text = str(m.get("date") or "").strip()
            if not date_text and ts > 0:
                try:
                    date_text = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    date_text = ""
            mails.append(
                {
                    "id": str(m.get("id") or ""),
                    "title": str(m.get("subject") or ""),
                    "sender": str(m.get("sender") or ""),
                    "date": date_text,
                }
            )

        payload = {
            "success": True,
            "group": group,
            "username": username,
            "type": mail_list_type,
            "date_range": date_range_days,
            "total": len(mails),
            "offset": int(data.get("offset", offset) or offset),
            "limit": int(data.get("limit", limit) or limit),
            "mails": mails,
        }
        return json.dumps(payload, ensure_ascii=False)

    def _tool_get_email(self, args: Dict[str, Any]) -> str:
        """getEMail 工具执行入口"""
        cfg = self._get_nexora_mail_config()
        if not cfg.get("enabled"):
            return "获取失败：NexoraMail 未启用"

        mail_id = str(args.get("mail_id") or "").strip()
        if not mail_id:
            return "获取失败：缺少 mail_id"

        binding, bind_err = self._resolve_local_mail_binding()
        if bind_err:
            return f"获取失败：{bind_err}"

        group = str(binding.get("group") or "default").strip() or "default"
        username = str(binding.get("mail_username") or "").strip()
        if not username:
            return "获取失败：未绑定本地邮箱用户名"

        path = f"/api/mailboxes/{urllib_parse.quote(group)}/{urllib_parse.quote(username)}/mails/{urllib_parse.quote(mail_id)}"
        ok, status, data = self._nexora_mail_call(path, method="GET")
        if not ok:
            msg = data.get("message") if isinstance(data, dict) else ""
            return f"获取失败：{msg or f'NexoraMail HTTP {status}'}"

        mail = data.get("mail") if isinstance(data, dict) else None
        if not isinstance(mail, dict):
            return "获取失败：邮件不存在或格式异常"

        try:
            content_type = int(args.get("content_type", 0) or 0)  # 0: extracted, 1: all
        except Exception:
            content_type = 0
        if content_type not in (0, 1):
            content_type = 0

        raw_truncate = args.get("truncate", True)
        if isinstance(raw_truncate, bool):
            truncate_enabled = raw_truncate
        elif isinstance(raw_truncate, str):
            truncate_enabled = raw_truncate.strip().lower() in ("1", "true", "yes", "y", "on")
        elif isinstance(raw_truncate, (int, float)):
            truncate_enabled = bool(raw_truncate)
        else:
            truncate_enabled = True

        try:
            max_chars = int(args.get("max_chars", 12000) or 12000)
        except Exception:
            max_chars = 12000
        max_chars = min(max(max_chars, 500), 50000)

        def _truncate_text(text: Any, hint: str = "内容"):
            s = str(text or "")
            if not truncate_enabled:
                return s, False
            if len(s) <= max_chars:
                return s, False
            return s[:max_chars] + f"\n\n...[{hint}过长已截断，共{len(s)}字符，当前保留{max_chars}字符]...", True

        text_body_raw = str(mail.get("content_text") or "")
        html_body_raw = str(mail.get("content_html") or "")
        raw_body_raw = str(mail.get("content") or "")

        text_body, text_truncated = _truncate_text(text_body_raw, "文本")
        html_body, html_truncated = _truncate_text(html_body_raw, "HTML")
        raw_body, raw_truncated = _truncate_text(raw_body_raw, "原始邮件")

        payload = {
            "success": True,
            "group": group,
            "username": username,
            "mail": {
                "id": str(mail.get("id") or mail_id),
                "subject": str(mail.get("subject") or ""),
                "sender": str(mail.get("sender") or ""),
                "recipient": str(mail.get("recipient") or ""),
                "date": str(mail.get("date") or ""),
                "timestamp": int(mail.get("timestamp", 0) or 0),
                "is_read": bool(mail.get("is_read", False)),
                "size": int(mail.get("size", 0) or 0),
                "preview_text": str(mail.get("preview_text") or ""),
                "content_type": content_type,
                "truncate": bool(truncate_enabled),
                "max_chars": int(max_chars),
            },
        }

        if content_type == 0:
            # 轻量模式：只返回提取文本
            payload["mail"]["content_text"] = text_body
            payload["mail"]["truncated"] = bool(text_truncated)
        else:
            # 完整模式：返回提取文本 + HTML + 原始内容
            payload["mail"]["content_text"] = text_body
            payload["mail"]["content_html"] = html_body
            payload["mail"]["content_raw"] = raw_body
            payload["mail"]["truncated"] = bool(text_truncated or html_truncated or raw_truncated)
            payload["mail"]["truncate_details"] = {
                "content_text": bool(text_truncated),
                "content_html": bool(html_truncated),
                "content_raw": bool(raw_truncated),
            }
        return json.dumps(payload, ensure_ascii=False)

