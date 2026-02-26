import os
import time
import json
import re
import base64
from types import SimpleNamespace
from html import unescape
from functools import wraps
from email import message_from_string, policy
from email.header import decode_header, Header

from flask import Flask, jsonify, request

try:
    from core import Configure, UserManager, DebugLog, SMTPService
except Exception:
    import Configure
    import UserManager
    import DebugLog
    import SMTPService


def _get_api_config():
    cfg = Configure.get("APIServer", {}) or {}
    listen = cfg.get("listen", {}) if isinstance(cfg.get("listen"), dict) else {}
    auth = cfg.get("auth", {}) if isinstance(cfg.get("auth"), dict) else {}
    security = cfg.get("security", {}) if isinstance(cfg.get("security"), dict) else {}

    def _as_bool(value, default=False):
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            v = value.strip().lower()
            if v in ("1", "true", "yes", "y", "on"):
                return True
            if v in ("0", "false", "no", "n", "off"):
                return False
        return default

    # Prefer flat style:
    # {
    #   "api_server": {
    #     "host": "...", "port": 17171, "api_key": "...",
    #     "local_only_when_no_api_key": true, "enabled": true
    #   }
    # }
    # Fallback to nested style (listen/auth/security) for compatibility.
    host = cfg.get("host", listen.get("host", "127.0.0.1"))
    port_raw = cfg.get("port", listen.get("port", 17171))
    try:
        port = int(port_raw)
    except Exception:
        port = 17171

    api_key = (
        cfg.get("api_key")
        or auth.get("api_key")
        or cfg.get("token", "")
    )

    local_only_raw = cfg.get("local_only_when_no_api_key", None)
    if local_only_raw is None:
        local_only_raw = cfg.get("localOnlyWhenNoApiKey", None)
    if local_only_raw is None:
        local_only_raw = security.get(
            "local_only_when_no_api_key",
            security.get("localOnlyWhenNoApiKey", True),
        )
    local_only = _as_bool(local_only_raw, True)

    return {
        "enabled": bool(cfg.get("enabled", True)),
        "host": host,
        "port": port,
        "api_key": (api_key or "").strip(),
        "local_only_when_no_api_key": local_only,
    }


def _extract_token():
    x_key = request.headers.get("X-API-Key", "").strip()
    if x_key:
        return x_key
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    # backward compatibility
    old_key = request.headers.get("X-API-Token", "").strip()
    if old_key:
        return old_key
    return (request.args.get("api_key") or "").strip()


def require_api_token(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        cfg = _get_api_config()
        expected = (os.environ.get("NEXORAMAIL_API_KEY") or os.environ.get("NEXORAMAIL_API_TOKEN") or cfg["api_key"] or "").strip()
        # If no token configured, keep API local-only by default.
        if not expected:
            if cfg.get("local_only_when_no_api_key", True):
                remote = (request.remote_addr or "").strip()
                if remote not in ("127.0.0.1", "::1", "localhost"):
                    return jsonify({"success": False, "message": "API key not configured; local-only mode"}), 403
            return fn(*args, **kwargs)
        got = _extract_token()
        if got != expected:
            return jsonify({"success": False, "message": "Invalid API key"}), 401
        return fn(*args, **kwargs)

    return wrapper


def _normalize_username(username_or_email):
    if not username_or_email:
        return ""
    s = str(username_or_email).strip()
    if "@" in s:
        return s.split("@", 1)[0].strip()
    return s


def _get_group(group_name):
    group = (group_name or "default").strip()
    if not group:
        group = "default"
    ug = UserManager.getGroup(group)
    return group, ug


def _get_user(group_name, username_or_email):
    group, ug = _get_group(group_name)
    username = _normalize_username(username_or_email)
    user = (ug.users or {}).get(username)
    if not user:
        return group, ug, username, None
    return group, ug, username, user


def _build_internal_auth_session(group_name, sender, user_group):
    """
    Build a minimal SMTP session object for trusted API calls so relay/send permissions
    are evaluated as the sender user (instead of anonymous session=None).
    """
    sender_username = _normalize_username(sender)
    if not sender_username:
        return None, "invalid sender"

    user = (user_group.users or {}).get(sender_username)
    if not user:
        return None, f"sender user not found in group '{group_name}': {sender_username}"

    session_obj = SimpleNamespace(
        peer="internal-api",
        authenticated=True,
        user={
            "username": sender_username,
            "email": sender,
            "group": group_name,
        },
        attributes={"source": "api"},
    )
    return session_obj, None


def _decode_subject(value):
    if not value:
        return ""
    out = []
    for text, charset in decode_header(value):
        if isinstance(text, bytes):
            out.append(text.decode(charset or "utf-8", errors="replace"))
        else:
            out.append(str(text))
    return _repair_common_mojibake("".join(out).strip())


def _garbled_score_text(s):
    text = str(s or "")
    if not text:
        return 0
    suspicious = ("鎴", "馃", "锛", "锟", "�", "鏄", "鍐", "涓", "鐨")
    score = 0
    for token in suspicious:
        score += text.count(token)
    return score


def _repair_common_mojibake(text):
    src = str(text or "")
    if not src:
        return src
    best = src
    best_score = _garbled_score_text(src)
    for enc in ("gb18030", "gbk"):
        try:
            cand = src.encode(enc, errors="strict").decode("utf-8", errors="strict")
        except Exception:
            continue
        cand_score = _garbled_score_text(cand)
        if cand_score < best_score:
            best = cand
            best_score = cand_score
    return best


def _extract_subject(raw_content):
    if not raw_content:
        return ""
    try:
        msg = message_from_string(raw_content)
        return _decode_subject(msg.get("Subject", ""))
    except Exception:
        for line in raw_content.splitlines()[:30]:
            if line.lower().startswith("subject:"):
                return _repair_common_mojibake(line.split(":", 1)[1].strip())
        return ""


def _strip_html(html_text):
    if not html_text:
        return ""
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", html_text)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</p\s*>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _decode_part_text(part):
    try:
        raw = part.get_payload(decode=True)
        if raw is None:
            raw_payload = part.get_payload()
            if isinstance(raw_payload, str):
                return raw_payload
            return ""
        charset = part.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")
    except Exception:
        try:
            payload = part.get_payload()
            if isinstance(payload, str):
                return payload
        except Exception:
            pass
        return ""


def _decode_base64_blocks_fallback(raw_content):
    text_parts = []
    pattern = re.compile(
        r"Content-Transfer-Encoding:\s*base64\s*(?:\r?\n)+(?P<data>(?:[A-Za-z0-9+/=\r\n]+))",
        re.IGNORECASE,
    )
    for m in pattern.finditer(raw_content or ""):
        block = m.group("data") or ""
        # stop at boundary-like line if present
        block = re.split(r"\r?\n--[-_A-Za-z0-9]+", block, maxsplit=1)[0]
        compact = re.sub(r"\s+", "", block)
        if len(compact) < 8:
            continue
        try:
            decoded = base64.b64decode(compact, validate=False)
            txt = decoded.decode("utf-8", errors="replace").strip()
            if txt:
                text_parts.append(txt)
        except Exception:
            continue
    return "\n\n".join(text_parts).strip()


def _extract_mail_content(raw_content):
    """
    Return dict:
    {
      subject, from, to, date,
      content_text, content_html, preview_text
    }
    """
    result = {
        "subject": "",
        "from": "",
        "to": "",
        "date": "",
        "content_text": "",
        "content_html": "",
        "preview_text": "",
    }
    if not raw_content:
        return result

    plain_parts = []
    html_parts = []
    try:
        msg = message_from_string(raw_content, policy=policy.default)
        result["subject"] = _decode_subject(str(msg.get("Subject", "") or ""))
        result["from"] = str(msg.get("From", "") or "").strip()
        result["to"] = str(msg.get("To", "") or "").strip()
        result["date"] = str(msg.get("Date", "") or "").strip()

        if msg.is_multipart():
            for part in msg.walk():
                ctype = (part.get_content_type() or "").lower()
                disp = (part.get_content_disposition() or "").lower()
                if disp == "attachment":
                    continue
                if ctype == "text/plain":
                    txt = _decode_part_text(part).strip()
                    if txt:
                        plain_parts.append(txt)
                elif ctype == "text/html":
                    html = _decode_part_text(part).strip()
                    if html:
                        html_parts.append(html)
        else:
            ctype = (msg.get_content_type() or "").lower()
            body = _decode_part_text(msg).strip()
            if ctype == "text/html":
                html_parts.append(body)
            else:
                plain_parts.append(body)
    except Exception:
        # best-effort fallback for malformed MIME
        pass

    plain = "\n\n".join([p for p in plain_parts if p]).strip()
    html = "\n\n".join([h for h in html_parts if h]).strip()

    # Fallback: if parser failed but raw contains html body.
    if not plain and not html:
        split = re.split(r"\r?\n\r?\n", raw_content, maxsplit=1)
        body = split[1] if len(split) > 1 else raw_content
        if re.search(r"(?is)<html[\s>]|<body[\s>]|<div[\s>]|<table[\s>]", body):
            html = body.strip()
        else:
            plain = body.strip()

    # Fallback for base64-only multipart fragments
    if not plain and not html and "base64" in (raw_content or "").lower():
        plain = _decode_base64_blocks_fallback(raw_content)

    if not plain and html:
        plain = _strip_html(html)

    preview = re.sub(r"\s+", " ", (plain or "")).strip()
    if len(preview) > 180:
        preview = preview[:180]

    result["content_text"] = plain
    result["content_html"] = html
    result["preview_text"] = preview
    if not result["subject"]:
        result["subject"] = _extract_subject(raw_content)
    return result


def _safe_commonpath(base_path, child_path):
    try:
        base = os.path.abspath(base_path)
        child = os.path.abspath(child_path)
        return os.path.commonpath([base, child]) == base
    except Exception:
        return False


def _mail_dir_for(user_path, mail_id):
    safe_id = str(mail_id or "").strip()
    if not safe_id or any(x in safe_id for x in ("/", "\\", "..")):
        return None
    return os.path.join(user_path, safe_id)


def _sent_root_for_user(user_path):
    base = str(user_path or "").strip()
    if not base:
        return ""
    return os.path.join(base, "sent")


def _mail_dir_for_box(user_path, mail_id, box="inbox"):
    if box == "sent":
        root = _sent_root_for_user(user_path)
    else:
        root = user_path
    return _mail_dir_for(root, mail_id)


def _load_mail_entry(mail_dir, include_content=False):
    info_path = os.path.join(mail_dir, "mail.json")
    content_path = os.path.join(mail_dir, "content.txt")
    if not os.path.exists(info_path):
        return None

    try:
        with open(info_path, "r", encoding="utf-8") as f:
            meta = json.load(f) or {}
    except Exception:
        return None

    raw_content = ""
    try:
        with open(content_path, "r", encoding="utf-8", errors="replace") as f:
            raw_content = f.read()
    except Exception:
        raw_content = ""

    parsed = _extract_mail_content(raw_content)
    subject = parsed.get("subject", "")
    timestamp = int(meta.get("timestamp", 0) or 0)
    payload = {
        "id": meta.get("id") or os.path.basename(mail_dir),
        "sender": meta.get("sender", ""),
        "recipient": meta.get("recipient", ""),
        "timestamp": timestamp,
        "subject": subject,
        "size": int(meta.get("size", 0) or 0),
    }
    # Read-state model:
    # - missing is_read means unread by default (new behavior)
    # - read_at keeps the first/last read timestamp if available
    is_read_raw = meta.get("is_read", meta.get("read", None))
    if isinstance(is_read_raw, bool):
        is_read = is_read_raw
    elif isinstance(is_read_raw, str):
        is_read = is_read_raw.strip().lower() in ("1", "true", "yes", "y", "on")
    elif isinstance(is_read_raw, (int, float)):
        is_read = bool(is_read_raw)
    else:
        is_read = False
    read_at = meta.get("read_at", meta.get("readAt"))
    payload["is_read"] = bool(is_read)
    if read_at is not None:
        payload["read_at"] = read_at
    if payload["size"] <= 0:
        try:
            payload["size"] = os.path.getsize(content_path)
        except Exception:
            payload["size"] = len(raw_content.encode("utf-8", errors="ignore")) if raw_content else 0

    # Prefer parsed envelope fields when available.
    if parsed.get("from"):
        payload["sender"] = parsed.get("from")
    if parsed.get("to"):
        payload["recipient"] = parsed.get("to")
    if parsed.get("date"):
        payload["date"] = parsed.get("date")
    payload["preview_text"] = parsed.get("preview_text", "")

    if include_content:
        payload["content"] = raw_content
        payload["content_text"] = parsed.get("content_text", "")
        payload["content_html"] = parsed.get("content_html", "")
    else:
        payload["preview"] = parsed.get("preview_text", "")
    return payload


def _list_mails(user_path):
    mails = []
    if not user_path or not os.path.isdir(user_path):
        return mails

    for mail_id in os.listdir(user_path):
        mail_dir = os.path.join(user_path, mail_id)
        if not os.path.isdir(mail_dir):
            continue
        item = _load_mail_entry(mail_dir, include_content=False)
        if item:
            mails.append(item)
    mails.sort(key=lambda x: (x.get("timestamp", 0), x.get("id", "")), reverse=True)
    return mails


def _list_sent_mails(user_path):
    sent_root = _sent_root_for_user(user_path)
    mails = []
    if not sent_root or not os.path.isdir(sent_root):
        return mails
    for mail_id in os.listdir(sent_root):
        mail_dir = os.path.join(sent_root, mail_id)
        if not os.path.isdir(mail_dir):
            continue
        item = _load_mail_entry(mail_dir, include_content=False)
        if item:
            mails.append(item)
    mails.sort(key=lambda x: (x.get("timestamp", 0), x.get("id", "")), reverse=True)
    return mails


def _compose_mail_raw(sender, recipient, subject, content):
    ts = time.strftime("%a, %d %b %Y %H:%M:%S +0000", time.gmtime())
    mail_id = f"{int(time.time())}.{os.getpid()}@nexoramail.local"
    subject_clean = _repair_common_mojibake(subject)
    subject_header = str(Header(subject_clean or "", "utf-8"))
    return (
        f"Date: {ts}\r\n"
        f"From: <{sender}>\r\n"
        f"To: <{recipient}>\r\n"
        f"Message-ID: <{mail_id}>\r\n"
        f"Subject: {subject_header}\r\n"
        "MIME-Version: 1.0\r\n"
        "Content-Type: text/plain; charset=\"UTF-8\"\r\n"
        "\r\n"
        f"{content}\r\n"
    )


app = Flask(__name__)


@app.get("/api/health")
def health():
    return jsonify({"success": True, "service": "NexoraMail API"})


@app.get("/api/status")
@require_api_token
def status():
    smtp = (Configure.get("SMTPServices", {}) or {}).get("services", {}) or {}
    pop3 = (Configure.get("POP3Services", {}) or {}).get("services", {}) or {}
    return jsonify(
        {
            "success": True,
            "smtp_ports": sorted([str(p) for p in smtp.keys()], key=lambda x: int(x)),
            "pop3_ports": sorted([str(p) for p in pop3.keys()], key=lambda x: int(x)),
            "groups": sorted(list((Configure.get("UserGroups", {}) or {}).keys())),
        }
    )


@app.get("/api/groups")
@require_api_token
def list_groups():
    groups_cfg = Configure.get("UserGroups", {}) or {}
    out = []
    for group_name in sorted(groups_cfg.keys()):
        ug = UserManager.getGroup(group_name)
        out.append(
            {
                "group": group_name,
                "domains": ug.getDomains(),
                "users": len((ug.users or {}).keys()),
            }
        )
    return jsonify({"success": True, "groups": out})


@app.get("/api/users")
@require_api_token
def list_users():
    group, ug = _get_group(request.args.get("group"))
    users = []
    for username, data in (ug.users or {}).items():
        users.append(
            {
                "username": username,
                "permissions": data.get("permissions", []),
                "path": data.get("path", ""),
            }
        )
    users.sort(key=lambda x: x["username"])
    return jsonify({"success": True, "group": group, "users": users})


@app.get("/api/users/<group>/<username>")
@require_api_token
def get_user(group, username):
    group_name, ug, uname, user = _get_user(group, username)
    if not user:
        return jsonify({"success": False, "message": "user not found"}), 404
    user_path = user.get("path", "")
    mails = _list_mails(user_path)
    return jsonify(
        {
            "success": True,
            "group": group_name,
            "user": {
                "username": uname,
                "permissions": user.get("permissions", []),
                "path": user_path,
                "mail_count": len(mails),
            },
        }
    )


@app.post("/api/users")
@require_api_token
def add_user():
    payload = request.get_json(silent=True) or {}
    group = (payload.get("group") or "default").strip()
    username = _normalize_username(payload.get("username"))
    password = payload.get("password") or ""
    permissions = payload.get("permissions")
    if not username or not password:
        return jsonify({"success": False, "message": "username/password required"}), 400

    ug = UserManager.getGroup(group)
    if username in (ug.users or {}):
        return jsonify({"success": False, "message": "user already exists"}), 409
    ok = ug.addUser(username, password, permissions=permissions)
    return jsonify({"success": bool(ok), "group": group, "username": username})


@app.patch("/api/users/<group>/<username>")
@require_api_token
def update_user(group, username):
    payload = request.get_json(silent=True) or {}
    group_name, ug, uname, user = _get_user(group, username)
    if not user:
        return jsonify({"success": False, "message": "user not found"}), 404

    changed = False
    if "password" in payload and payload.get("password"):
        user["password"] = payload["password"]
        changed = True
    if "permissions" in payload and isinstance(payload.get("permissions"), list):
        user["permissions"] = payload["permissions"]
        changed = True
    if changed:
        ug.save()

    return jsonify(
        {
            "success": True,
            "group": group_name,
            "username": uname,
            "changed": changed,
            "permissions": user.get("permissions", []),
        }
    )


@app.delete("/api/users/<group>/<username>")
@require_api_token
def remove_user(group, username):
    group_name, ug = _get_group(group)
    ok = ug.removeUser(_normalize_username(username))
    return jsonify({"success": bool(ok), "group": group_name, "username": _normalize_username(username)})


@app.get("/api/mailboxes/<group>/<username>/mails")
@require_api_token
def list_user_mails(group, username):
    group_name, ug, uname, user = _get_user(group, username)
    if not user:
        return jsonify({"success": False, "message": "user not found"}), 404

    query = (request.args.get("q") or "").strip().lower()
    offset = max(int(request.args.get("offset", 0) or 0), 0)
    limit = min(max(int(request.args.get("limit", 50) or 50), 1), 200)

    mails = _list_mails(user.get("path", ""))
    if query:
        filtered = []
        for m in mails:
            text = " ".join(
                [
                    str(m.get("id", "")),
                    str(m.get("sender", "")),
                    str(m.get("recipient", "")),
                    str(m.get("subject", "")),
                    str(m.get("preview_text", "")),
                    str(m.get("preview", "")),
                ]
            ).lower()
            if query in text:
                filtered.append(m)
        mails = filtered

    total = len(mails)
    unread_total = sum(1 for m in mails if not bool(m.get("is_read", False)))
    sliced = mails[offset : offset + limit]
    return jsonify(
        {
            "success": True,
            "group": group_name,
            "username": uname,
            "total": total,
            "unread_total": unread_total,
            "offset": offset,
            "limit": limit,
            "mails": sliced,
        }
    )


@app.get("/api/mailboxes/<group>/<username>/mails/<mail_id>")
@require_api_token
def get_user_mail(group, username, mail_id):
    group_name, ug, uname, user = _get_user(group, username)
    if not user:
        return jsonify({"success": False, "message": "user not found"}), 404

    user_path = user.get("path", "")
    mail_dir = _mail_dir_for(user_path, mail_id)
    if not mail_dir or not _safe_commonpath(user_path, mail_dir) or not os.path.isdir(mail_dir):
        return jsonify({"success": False, "message": "mail not found"}), 404

    item = _load_mail_entry(mail_dir, include_content=True)
    if not item:
        return jsonify({"success": False, "message": "mail not found"}), 404
    return jsonify({"success": True, "group": group_name, "username": uname, "mail": item})


@app.get("/api/mailboxes/<group>/<username>/sent")
@require_api_token
def list_user_sent_mails(group, username):
    group_name, ug, uname, user = _get_user(group, username)
    if not user:
        return jsonify({"success": False, "message": "user not found"}), 404

    query = (request.args.get("q") or "").strip().lower()
    offset = max(int(request.args.get("offset", 0) or 0), 0)
    limit = min(max(int(request.args.get("limit", 50) or 50), 1), 200)

    mails = _list_sent_mails(user.get("path", ""))
    if query:
        filtered = []
        for m in mails:
            text = " ".join(
                [
                    str(m.get("id", "")),
                    str(m.get("sender", "")),
                    str(m.get("recipient", "")),
                    str(m.get("subject", "")),
                    str(m.get("preview_text", "")),
                    str(m.get("preview", "")),
                ]
            ).lower()
            if query in text:
                filtered.append(m)
        mails = filtered

    total = len(mails)
    sliced = mails[offset : offset + limit]
    return jsonify(
        {
            "success": True,
            "group": group_name,
            "username": uname,
            "total": total,
            "offset": offset,
            "limit": limit,
            "mails": sliced,
        }
    )


@app.get("/api/mailboxes/<group>/<username>/sent/<mail_id>")
@require_api_token
def get_user_sent_mail(group, username, mail_id):
    group_name, ug, uname, user = _get_user(group, username)
    if not user:
        return jsonify({"success": False, "message": "user not found"}), 404

    user_path = user.get("path", "")
    mail_dir = _mail_dir_for_box(user_path, mail_id, box="sent")
    sent_root = _sent_root_for_user(user_path)
    if not sent_root or not mail_dir or not _safe_commonpath(sent_root, mail_dir) or not os.path.isdir(mail_dir):
        return jsonify({"success": False, "message": "mail not found"}), 404

    item = _load_mail_entry(mail_dir, include_content=True)
    if not item:
        return jsonify({"success": False, "message": "mail not found"}), 404
    return jsonify({"success": True, "group": group_name, "username": uname, "mail": item})


@app.delete("/api/mailboxes/<group>/<username>/sent/<mail_id>")
@require_api_token
def delete_user_sent_mail(group, username, mail_id):
    group_name, ug, uname, user = _get_user(group, username)
    if not user:
        return jsonify({"success": False, "message": "user not found"}), 404

    user_path = user.get("path", "")
    mail_dir = _mail_dir_for_box(user_path, mail_id, box="sent")
    sent_root = _sent_root_for_user(user_path)
    if not sent_root or not mail_dir or not _safe_commonpath(sent_root, mail_dir) or not os.path.isdir(mail_dir):
        return jsonify({"success": False, "message": "mail not found"}), 404

    try:
        for fn in os.listdir(mail_dir):
            fp = os.path.join(mail_dir, fn)
            if os.path.isfile(fp):
                os.remove(fp)
        os.rmdir(mail_dir)
        return jsonify({"success": True, "group": group_name, "username": uname, "id": mail_id})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.patch("/api/mailboxes/<group>/<username>/mails/<mail_id>/read")
@require_api_token
def update_user_mail_read_state(group, username, mail_id):
    group_name, ug, uname, user = _get_user(group, username)
    if not user:
        return jsonify({"success": False, "message": "user not found"}), 404

    payload = request.get_json(silent=True) or {}
    raw_value = payload.get("is_read", payload.get("read", True))
    if isinstance(raw_value, bool):
        is_read = raw_value
    elif isinstance(raw_value, str):
        is_read = raw_value.strip().lower() in ("1", "true", "yes", "y", "on")
    elif isinstance(raw_value, (int, float)):
        is_read = bool(raw_value)
    else:
        is_read = bool(raw_value)

    user_path = user.get("path", "")
    mail_dir = _mail_dir_for(user_path, mail_id)
    if not mail_dir or not _safe_commonpath(user_path, mail_dir) or not os.path.isdir(mail_dir):
        return jsonify({"success": False, "message": "mail not found"}), 404

    info_path = os.path.join(mail_dir, "mail.json")
    if not os.path.isfile(info_path):
        return jsonify({"success": False, "message": "mail metadata not found"}), 404

    try:
        with open(info_path, "r", encoding="utf-8") as f:
            meta = json.load(f) or {}
    except Exception:
        meta = {}

    meta["is_read"] = bool(is_read)
    if is_read:
        meta["read_at"] = int(time.time())
    else:
        meta.pop("read_at", None)

    try:
        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

    item = _load_mail_entry(mail_dir, include_content=False)
    return jsonify(
        {
            "success": True,
            "group": group_name,
            "username": uname,
            "id": str(mail_id),
            "is_read": bool(is_read),
            "mail": item or {},
        }
    )


@app.delete("/api/mailboxes/<group>/<username>/mails/<mail_id>")
@require_api_token
def delete_user_mail(group, username, mail_id):
    group_name, ug, uname, user = _get_user(group, username)
    if not user:
        return jsonify({"success": False, "message": "user not found"}), 404

    user_path = user.get("path", "")
    mail_dir = _mail_dir_for(user_path, mail_id)
    if not mail_dir or not _safe_commonpath(user_path, mail_dir) or not os.path.isdir(mail_dir):
        return jsonify({"success": False, "message": "mail not found"}), 404

    try:
        for fn in os.listdir(mail_dir):
            fp = os.path.join(mail_dir, fn)
            if os.path.isfile(fp):
                os.remove(fp)
        os.rmdir(mail_dir)
        return jsonify({"success": True, "group": group_name, "username": uname, "id": mail_id})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.post("/api/send")
@require_api_token
def api_send_mail():
    payload = request.get_json(silent=True) or {}
    group_name = (payload.get("group") or "default").strip()
    sender = (payload.get("sender") or "").strip()
    recipient = (payload.get("recipient") or "").strip()
    raw = payload.get("raw")
    subject = (payload.get("subject") or "").strip() or "(No Subject)"
    content = payload.get("content") or ""
    suppress_error = bool(payload.get("suppress_error_mail", True))

    if not sender or not recipient:
        return jsonify({"success": False, "message": "sender/recipient required"}), 400

    _, ug = _get_group(group_name)
    data = raw if isinstance(raw, str) and raw.strip() else _compose_mail_raw(sender, recipient, subject, str(content))
    try:
        internal_session, session_err = _build_internal_auth_session(group_name, sender, ug)
        if session_err:
            return jsonify({"success": False, "message": session_err}), 403

        result = SMTPService.sendMail(sender, recipient, data, internal_session, ug, suppressError=suppress_error)
        if isinstance(result, tuple):
            send_ok = bool(result[0])
            attempts = result[1] if len(result) > 1 else []
        else:
            send_ok = bool(result)
            attempts = []
        if not send_ok:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "mail delivery failed or not permitted",
                        "group": group_name,
                        "sender": sender,
                        "recipient": recipient,
                        "attempts": attempts,
                    }
                ),
                403,
            )

        return jsonify(
            {
                "success": True,
                "group": group_name,
                "sender": sender,
                "recipient": recipient,
                "attempts": attempts,
            }
        )
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


def main():
    Configure.checkConf()
    Configure.init()
    UserManager.initModule()
    DebugLog.init()
    SMTPService.initModule(DebugLog, Configure)
    cfg = _get_api_config()
    if not cfg["enabled"]:
        print("[NexoraMail API] disabled by APIServer.enabled=false")
        return
    print(f"[NexoraMail API] listening on {cfg['host']}:{cfg['port']}")
    app.run(host=cfg["host"], port=cfg["port"], debug=False)


if __name__ == "__main__":
    main()
