import json
import os
import re
import shutil
import time
import hmac
from functools import wraps
from hashlib import sha1, sha256
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from flask import Flask, Response, jsonify, redirect, request, send_file, send_from_directory, session

APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "config.json"


DEFAULT_CONFIG: Dict[str, Any] = {
    "host": "0.0.0.0",
    "port": 8099,
    "secret_key": "wnetdisk-dev-secret",
    "paths": {
        "storage_root": "./data/netdisk",
        "users_root": "./data/users",
        "trash_root": "./data/trash"
    },
    "bootstrap_admin": {
        "enabled": True,
        "username": "admin",
        "password": "admin123",
        "role": "admin"
    },
    "federated_auth": {
        "enabled": False,
        "shared_secret": "change-this-federation-secret",
        "max_skew_seconds": 120,
        "auto_create_user": True,
        "default_role": "normal"
    },
    "integration": {
        "enabled": False,
        "api_keys": [
            "change-this-integration-key"
        ],
        "allow_user_create": True
    }
}


def load_config() -> Dict[str, Any]:
    if CONFIG_PATH.exists():
        with CONFIG_PATH.open("r", encoding="utf-8-sig") as f:
            loaded = json.load(f)
        return deep_merge(DEFAULT_CONFIG, loaded)
    return DEFAULT_CONFIG


def deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


CONFIG = load_config()


def _resolve_path(path_value: str) -> Path:
    p = Path(path_value)
    if p.is_absolute():
        return p
    return (APP_DIR / p).resolve()


STORAGE_ROOT = _resolve_path(CONFIG["paths"]["storage_root"])
USERS_ROOT = _resolve_path(CONFIG["paths"]["users_root"])
TRASH_ROOT = _resolve_path(CONFIG["paths"]["trash_root"])
FRONTEND_ROOT = APP_DIR / "frontend"

app = Flask(__name__)
app.secret_key = CONFIG.get("secret_key") or "wnetdisk-dev-secret"


def ensure_dirs() -> None:
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    USERS_ROOT.mkdir(parents=True, exist_ok=True)
    TRASH_ROOT.mkdir(parents=True, exist_ok=True)


def _valid_username(username: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_\-\.]{1,64}", username or ""))


def _user_file(username: str) -> Path:
    return USERS_ROOT / f"{username}.json"


def _user_root(username: str) -> Path:
    root = (STORAGE_ROOT / username).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def list_users() -> Dict[str, Dict[str, Any]]:
    users: Dict[str, Dict[str, Any]] = {}
    for fp in USERS_ROOT.glob("*.json"):
        try:
            with fp.open("r", encoding="utf-8") as f:
                data = json.load(f)
            users[fp.stem] = data
        except Exception:
            continue
    return users


def get_user(username: str) -> Optional[Dict[str, Any]]:
    fp = _user_file(username)
    if not fp.exists():
        return None
    with fp.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_user(username: str, password: str, role: str) -> None:
    payload = {
        "password": password,
        "role": role
    }
    with _user_file(username).open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def delete_user(username: str) -> None:
    fp = _user_file(username)
    if fp.exists():
        fp.unlink()


def ensure_admin_user() -> None:
    boot = CONFIG.get("bootstrap_admin") or {}
    if not boot.get("enabled", True):
        return
    username = boot.get("username") or "admin"
    password = boot.get("password") or "admin123"
    role = boot.get("role") or "admin"
    if not _valid_username(username):
        return
    if get_user(username) is None:
        save_user(username, password, role)


def _sha1_text(text: str) -> str:
    return sha1((text or "").encode("utf-8")).hexdigest()


def _hmac_sha256(secret: str, text: str) -> str:
    return hmac.new(secret.encode("utf-8"), text.encode("utf-8"), sha256).hexdigest()


def current_identity() -> Optional[Dict[str, str]]:
    username = session.get("username")
    role = session.get("role")
    if not username:
        return None
    return {"username": username, "role": role or "normal"}


def login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        ident = current_identity()
        if not ident:
            return jsonify({"success": False, "message": "Unauthorized"}), 401
        return func(*args, **kwargs)

    return wrapper


def admin_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        ident = current_identity()
        if not ident:
            return jsonify({"success": False, "message": "Unauthorized"}), 401
        if ident["role"] != "admin":
            return jsonify({"success": False, "message": "Forbidden"}), 403
        return func(*args, **kwargs)

    return wrapper


def _integration_key_valid(api_key: Optional[str]) -> bool:
    if not api_key:
        return False
    integ_cfg = CONFIG.get("integration") or {}
    if not integ_cfg.get("enabled", False):
        return False
    keys = integ_cfg.get("api_keys") or []
    return api_key in keys


def integration_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        api_key = request.headers.get("X-Integration-Key") or request.args.get("integration_key")
        if not _integration_key_valid(api_key):
            return jsonify({"success": False, "message": "Invalid integration key"}), 401
        return func(*args, **kwargs)

    return wrapper


def _ensure_user_for_federation(username: str, role: str = "normal") -> None:
    if get_user(username) is None:
        random_pwd = sha256(f"{username}:{time.time()}".encode("utf-8")).hexdigest()
        save_user(username, random_pwd, role)
        _user_root(username)


def _resolve_target_user(requested_user: Optional[str] = None) -> Tuple[Optional[str], Optional[Response]]:
    ident = current_identity()
    if not ident:
        return None, jsonify({"success": False, "message": "Unauthorized"})

    me = ident["username"]
    role = ident["role"]
    target = requested_user or me

    if target != me and role != "admin":
        return None, jsonify({"success": False, "message": "Forbidden"})

    if get_user(target) is None:
        return None, jsonify({"success": False, "message": f"User not found: {target}"})

    return target, None


def _safe_user_path(username: str, rel_path: str) -> Path:
    rel = (rel_path or "").strip().replace("\\", "/")
    if rel in ("", ".", "./", "/"):
        rel = "."
    if rel.startswith("/"):
        rel = rel.lstrip("/")

    user_root = _user_root(username)
    candidate = (user_root / rel).resolve()

    if os.path.commonpath([str(candidate), str(user_root)]) != str(user_root):
        raise ValueError("Path escapes user root")

    return candidate


def _next_available_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    parent = path.parent
    idx = 1
    while True:
        candidate = parent / f"{stem}_{idx}{suffix}"
        if not candidate.exists():
            return candidate
        idx += 1


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _list_dir_impl(target_user: str, rel_dir: str) -> Dict[str, Any]:
    request_dir = _safe_user_path(target_user, rel_dir)
    if not request_dir.exists():
        raise FileNotFoundError(f"Directory not found: {rel_dir}")
    if not request_dir.is_dir():
        raise NotADirectoryError(f"Not a directory: {rel_dir}")

    entries = sorted(
        request_dir.iterdir(),
        key=lambda p: (p.is_file(), p.name.lower())
    )

    items = []
    for entry in entries:
        stat = entry.stat()
        items.append({
            "name": entry.name,
            "is_file": entry.is_file(),
            "size": stat.st_size if entry.is_file() else None,
            "modified_at": int(stat.st_mtime),
            "request_user": target_user
        })

    return {
        "success": True,
        "user": target_user,
        "dir": rel_dir,
        "items": items
    }


def _mkdir_impl(target_user: str, rel_path: str) -> str:
    dst = _safe_user_path(target_user, rel_path)
    if dst.exists():
        return "Dir already exists"
    dst.mkdir(parents=True, exist_ok=False)
    return f"created: {dst}"


def _delete_impl(target_user: str, rel_path: str) -> str:
    src = _safe_user_path(target_user, rel_path)
    if not src.exists():
        return "Path does not exist"

    trash_user_root = (TRASH_ROOT / target_user).resolve()
    trash_user_root.mkdir(parents=True, exist_ok=True)
    target = _next_available_path(trash_user_root / src.name)

    shutil.move(str(src), str(target))
    return f"removed: {src}"


def _rename_impl(target_user: str, old_rel: str, new_name: str) -> str:
    src = _safe_user_path(target_user, old_rel)
    if not src.exists():
        return f"File does not exist: {old_rel}"

    clean_name = (new_name or "").strip().replace("\\", "/")
    if not clean_name:
        return "New name is empty"
    if "/" in clean_name:
        return "New name must be a single path segment"

    dst = (src.parent / clean_name).resolve()
    root = _user_root(target_user)
    if os.path.commonpath([str(dst), str(root)]) != str(root):
        return "Cannot rename outside user root"
    if dst.exists():
        return f"Target already exists: {clean_name}"

    src.rename(dst)
    return f"Renamed file from {old_rel} to {dst.name}"


def _move_impl(target_user: str, src_rel: str, dst_rel: str, cut: bool) -> str:
    src = _safe_user_path(target_user, src_rel)
    dst = _safe_user_path(target_user, dst_rel)

    if not src.exists():
        return f"File does not exist: {src_rel}"

    if cut:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        return f"Moved file: {src_rel} to {dst_rel}"

    if src.is_file():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(src), str(dst))
    else:
        if dst.exists():
            return f"Target already exists: {dst_rel}"
        shutil.copytree(str(src), str(dst))
    return f"Copied file from {src_rel} to {dst_rel}"


def _upload_impl(target_user: str, rel_path: str):
    if "file" not in request.files:
        return None, "missing file"

    file_obj = request.files["file"]
    if not file_obj.filename:
        return None, "empty filename"

    folder = _safe_user_path(target_user, rel_path)
    folder.mkdir(parents=True, exist_ok=True)

    dst = (folder / file_obj.filename).resolve()
    root = _user_root(target_user)
    if os.path.commonpath([str(dst), str(root)]) != str(root):
        return None, "invalid filename/path"

    file_obj.save(dst)
    return str(dst), None


def _serialize_file_detail(path: Path) -> Dict[str, Any]:
    stat = path.stat()
    return {
        "filename": path.name,
        "filesize": stat.st_size,
        "filecreatedate": int(stat.st_ctime),
        "filemodifieddate": int(stat.st_mtime),
    }


@app.route("/", methods=["GET"])
def home() -> Response:
    if (FRONTEND_ROOT / "index.html").exists():
        return redirect("/ui/")
    return jsonify({"success": True, "service": "WNetdisk Flask", "time": int(time.time())})


@app.route("/ui/", methods=["GET"])
def ui_index() -> Response:
    index_path = FRONTEND_ROOT / "index.html"
    if index_path.exists():
        return send_from_directory(FRONTEND_ROOT, "index.html")
    return jsonify({"success": False, "message": "frontend not found"}), 404


@app.route("/ui/<path:subpath>", methods=["GET"])
def ui_static(subpath: str) -> Response:
    fp = FRONTEND_ROOT / subpath
    if not fp.exists():
        return jsonify({"success": False, "message": "Not found"}), 404
    return send_from_directory(FRONTEND_ROOT, subpath)


@app.route("/ui/api/", defaults={"subpath": ""}, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@app.route("/ui/api/<path:subpath>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
def ui_api_proxy(subpath: str) -> Response:
    query = request.query_string.decode("utf-8")
    target = f"/api/{subpath}" if subpath else "/api/"
    if query:
        target = f"{target}?{query}"
    return redirect(target, code=307)


@app.route("/health", methods=["GET"])
def health() -> Response:
    return jsonify({"success": True, "service": "WNetdisk Flask"})


@app.route("/api/capabilities", methods=["GET"])
def capabilities() -> Response:
    return jsonify({
        "success": True,
        "service": "wnetdisk",
        "features": {
            "auth": True,
            "files": True,
            "admin": True,
            "range_download": True,
            "legacy_compat": True,
            "federated_auth": bool((CONFIG.get("federated_auth") or {}).get("enabled", False)),
            "integration_api": bool((CONFIG.get("integration") or {}).get("enabled", False))
        }
    })


@app.route("/api/auth/login", methods=["POST"])
def api_login() -> Response:
    data = request.get_json(silent=True) or request.form or {}
    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "")

    user = get_user(username)
    if not user or user.get("password") != password:
        return jsonify({"success": False, "message": "Invalid username or password"}), 401

    session["username"] = username
    session["role"] = user.get("role") or "normal"

    return jsonify({
        "success": True,
        "username": username,
        "role": session["role"]
    })


@app.route("/api/auth/logout", methods=["POST"])
def api_logout() -> Response:
    session.clear()
    return jsonify({"success": True})


@app.route("/api/auth/me", methods=["GET"])
@login_required
def api_me() -> Response:
    ident = current_identity()
    return jsonify({"success": True, "user": ident})


@app.route("/api/auth/federated/exchange", methods=["POST"])
def api_federated_exchange() -> Response:
    fed_cfg = CONFIG.get("federated_auth") or {}
    if not fed_cfg.get("enabled", False):
        return jsonify({"success": False, "message": "Federated auth disabled"}), 403

    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip()
    role = str(data.get("role") or fed_cfg.get("default_role") or "normal").strip()
    ext_token = str(data.get("external_token") or "")
    ts = str(data.get("timestamp") or "")
    signature = str(data.get("signature") or "")

    if not username or not _valid_username(username):
        return jsonify({"success": False, "message": "Invalid username"}), 400
    if role not in {"normal", "vip", "admin"}:
        role = "normal"
    if not ext_token or not ts or not signature:
        return jsonify({"success": False, "message": "Missing federated fields"}), 400

    try:
        ts_i = int(ts)
    except ValueError:
        return jsonify({"success": False, "message": "Invalid timestamp"}), 400

    max_skew = int(fed_cfg.get("max_skew_seconds", 120))
    if abs(int(time.time()) - ts_i) > max_skew:
        return jsonify({"success": False, "message": "Token timestamp expired"}), 401

    secret = str(fed_cfg.get("shared_secret") or "")
    if not secret:
        return jsonify({"success": False, "message": "Federation secret missing"}), 500

    signing_text = f"{username}|{role}|{ts}|{ext_token}"
    expected = _hmac_sha256(secret, signing_text)
    if not hmac.compare_digest(expected, signature):
        return jsonify({"success": False, "message": "Invalid federated signature"}), 401

    user = get_user(username)
    if not user:
        if fed_cfg.get("auto_create_user", True):
            _ensure_user_for_federation(username, role)
        else:
            return jsonify({"success": False, "message": "User not found"}), 404
    else:
        if user.get("role") == "admin":
            role = "admin"

    session["username"] = username
    session["role"] = role
    session["federated"] = True
    return jsonify({"success": True, "username": username, "role": role})


@app.route("/api/files/list", methods=["GET"])
@login_required
def api_files_list() -> Response:
    rel_dir = request.args.get("dir", "./")
    requested_user = request.args.get("user")
    target_user, err = _resolve_target_user(requested_user)
    if err:
        return err, 403

    try:
        payload = _list_dir_impl(target_user, rel_dir)
        return jsonify(payload)
    except FileNotFoundError as e:
        return jsonify({"success": False, "message": str(e)}), 404
    except NotADirectoryError as e:
        return jsonify({"success": False, "message": str(e)}), 400
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/files/mkdir", methods=["POST"])
@login_required
def api_files_mkdir() -> Response:
    data = request.get_json(silent=True) or request.form or {}
    rel_path = data.get("path", "")
    requested_user = data.get("user")
    target_user, err = _resolve_target_user(requested_user)
    if err:
        return err, 403

    try:
        message = _mkdir_impl(target_user, rel_path)
        return jsonify({"success": True, "message": message})
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/files/delete", methods=["POST", "DELETE"])
@login_required
def api_files_delete() -> Response:
    data = request.get_json(silent=True) or request.form or {}
    rel_path = data.get("path") or request.args.get("path") or ""
    requested_user = data.get("user") or request.args.get("user")

    target_user, err = _resolve_target_user(requested_user)
    if err:
        return err, 403

    try:
        message = _delete_impl(target_user, rel_path)
        return jsonify({"success": True, "message": message})
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/files/rename", methods=["POST"])
@login_required
def api_files_rename() -> Response:
    data = request.get_json(silent=True) or request.form or {}
    old_rel = data.get("old") or ""
    new_name = data.get("new") or ""
    requested_user = data.get("user")

    target_user, err = _resolve_target_user(requested_user)
    if err:
        return err, 403

    try:
        message = _rename_impl(target_user, old_rel, new_name)
        success = not message.lower().startswith("file does not exist") and not message.lower().startswith("target already exists")
        status = 200 if success else 400
        return jsonify({"success": success, "message": message}), status
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/files/move", methods=["POST"])
@login_required
def api_files_move() -> Response:
    data = request.get_json(silent=True) or request.form or {}
    src_rel = data.get("src") or ""
    dst_rel = data.get("dest") or ""
    cut = _as_bool(data.get("cut", False))
    requested_user = data.get("user")

    target_user, err = _resolve_target_user(requested_user)
    if err:
        return err, 403

    try:
        message = _move_impl(target_user, src_rel, dst_rel, cut)
        success = not message.lower().startswith("file does not exist") and not message.lower().startswith("target already exists")
        status = 200 if success else 400
        return jsonify({"success": success, "message": message}), status
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/files/upload", methods=["POST"])
@login_required
def api_files_upload() -> Response:
    rel_path = request.form.get("path", "./")
    requested_user = request.form.get("user")

    target_user, err = _resolve_target_user(requested_user)
    if err:
        return err, 403

    try:
        saved_path, save_err = _upload_impl(target_user, rel_path)
        if save_err:
            return jsonify({"success": False, "message": save_err}), 400
        return jsonify({"success": True, "path": saved_path})
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/files/download", methods=["GET"])
@login_required
def api_files_download() -> Response:
    rel_file = request.args.get("filepath") or ""
    requested_user = request.args.get("user")

    target_user, err = _resolve_target_user(requested_user)
    if err:
        return err, 403

    try:
        fp = _safe_user_path(target_user, rel_file)
        if not fp.exists() or not fp.is_file():
            return jsonify({"success": False, "message": "File not found"}), 404
        return send_file(fp, as_attachment=True, download_name=fp.name, conditional=True)
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/files/detail", methods=["GET"])
@login_required
def api_files_detail() -> Response:
    rel_file = request.args.get("filepath") or ""
    requested_user = request.args.get("user")
    target_user, err = _resolve_target_user(requested_user)
    if err:
        return err, 403

    try:
        fp = _safe_user_path(target_user, rel_file)
        if not fp.exists() or not fp.is_file():
            return jsonify({"success": False, "message": "File not found"}), 404
        return jsonify({"success": True, "detail": _serialize_file_detail(fp)})
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/files/quickview", methods=["GET"])
@login_required
def api_files_quickview() -> Response:
    rel_file = request.args.get("filepath") or ""
    requested_user = request.args.get("user")
    target_user, err = _resolve_target_user(requested_user)
    if err:
        return err, 403
    try:
        fp = _safe_user_path(target_user, rel_file)
        if not fp.exists() or not fp.is_file():
            return jsonify({"success": False, "message": "File not found"}), 404
        return send_file(fp, conditional=True)
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/files/music_cover", methods=["GET"])
@login_required
def api_files_music_cover() -> Response:
    return jsonify({"error": "cover extraction not implemented"})


@app.route("/api/admin/users", methods=["GET"])
@admin_required
def api_admin_users() -> Response:
    users = list_users()
    payload = {}
    for username, meta in users.items():
        payload[username] = {
            "role": meta.get("role", "normal"),
            "path": str(_user_root(username))
        }
    return jsonify({"success": True, "users": payload})


@app.route("/api/admin/users", methods=["POST"])
@admin_required
def api_admin_create_user() -> Response:
    data = request.get_json(silent=True) or request.form or {}
    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "")
    role = str(data.get("role") or "normal").strip()

    if not _valid_username(username):
        return jsonify({"success": False, "message": "Invalid username"}), 400
    if not password:
        return jsonify({"success": False, "message": "Password is required"}), 400
    if role not in {"normal", "vip", "admin"}:
        return jsonify({"success": False, "message": "Invalid role"}), 400
    if get_user(username) is not None:
        return jsonify({"success": False, "message": "User already exists"}), 400

    save_user(username, password, role)
    _user_root(username)
    return jsonify({"success": True})


@app.route("/api/admin/users/<username>/password", methods=["PATCH"])
@admin_required
def api_admin_change_password(username: str) -> Response:
    data = request.get_json(silent=True) or request.form or {}
    new_password = str(data.get("password") or "")

    user = get_user(username)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    if not new_password:
        return jsonify({"success": False, "message": "Password is required"}), 400

    user["password"] = new_password
    with _user_file(username).open("w", encoding="utf-8") as f:
        json.dump(user, f, ensure_ascii=False, indent=2)

    return jsonify({"success": True})


@app.route("/api/admin/users/<username>/role", methods=["PATCH"])
@admin_required
def api_admin_change_role(username: str) -> Response:
    data = request.get_json(silent=True) or request.form or {}
    new_role = str(data.get("role") or "").strip()

    user = get_user(username)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    if new_role not in {"normal", "vip", "admin"}:
        return jsonify({"success": False, "message": "Invalid role"}), 400

    user["role"] = new_role
    with _user_file(username).open("w", encoding="utf-8") as f:
        json.dump(user, f, ensure_ascii=False, indent=2)

    return jsonify({"success": True})


@app.route("/api/admin/users/<username>", methods=["DELETE"])
@admin_required
def api_admin_delete_user(username: str) -> Response:
    ident = current_identity() or {}
    if username == ident.get("username"):
        return jsonify({"success": False, "message": "Cannot delete yourself"}), 400

    user = get_user(username)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    if user.get("role") == "admin":
        return jsonify({"success": False, "message": "Cannot delete admin user"}), 400

    user_root = _user_root(username)
    if user_root.exists():
        shutil.rmtree(user_root, ignore_errors=True)
    delete_user(username)

    return jsonify({"success": True})


# ---------------- Integration API (for Nexora aggregator) ----------------

def _integration_target_user(data: Dict[str, Any]) -> Tuple[Optional[str], Optional[Tuple[Response, int]]]:
    username = str(data.get("username") or "").strip()
    if not username or not _valid_username(username):
        return None, (jsonify({"success": False, "message": "Invalid username"}), 400)

    user = get_user(username)
    if not user:
        allow_create = bool((CONFIG.get("integration") or {}).get("allow_user_create", True))
        if not allow_create:
            return None, (jsonify({"success": False, "message": "User not found"}), 404)
        _ensure_user_for_federation(username, "normal")
    return username, None


@app.route("/api/integration/health", methods=["GET"])
@integration_required
def integration_health() -> Response:
    return jsonify({"success": True, "service": "wnetdisk-integration"})


@app.route("/api/integration/files/list", methods=["POST"])
@integration_required
def integration_files_list() -> Response:
    data = request.get_json(silent=True) or {}
    username, err = _integration_target_user(data)
    if err:
        return err
    rel_dir = str(data.get("dir") or "./")
    try:
        payload = _list_dir_impl(username, rel_dir)
        return jsonify(payload)
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/integration/files/mkdir", methods=["POST"])
@integration_required
def integration_files_mkdir() -> Response:
    data = request.get_json(silent=True) or {}
    username, err = _integration_target_user(data)
    if err:
        return err
    try:
        msg = _mkdir_impl(username, str(data.get("path") or ""))
        return jsonify({"success": True, "message": msg})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/integration/files/delete", methods=["POST"])
@integration_required
def integration_files_delete() -> Response:
    data = request.get_json(silent=True) or {}
    username, err = _integration_target_user(data)
    if err:
        return err
    try:
        msg = _delete_impl(username, str(data.get("path") or ""))
        return jsonify({"success": True, "message": msg})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/integration/files/rename", methods=["POST"])
@integration_required
def integration_files_rename() -> Response:
    data = request.get_json(silent=True) or {}
    username, err = _integration_target_user(data)
    if err:
        return err
    msg = _rename_impl(username, str(data.get("old") or ""), str(data.get("new") or ""))
    ok = msg.startswith("Renamed")
    return jsonify({"success": ok, "message": msg}), (200 if ok else 400)


@app.route("/api/integration/files/move", methods=["POST"])
@integration_required
def integration_files_move() -> Response:
    data = request.get_json(silent=True) or {}
    username, err = _integration_target_user(data)
    if err:
        return err
    try:
        msg = _move_impl(
            username,
            str(data.get("src") or ""),
            str(data.get("dest") or ""),
            _as_bool(data.get("cut", False))
        )
        ok = not msg.lower().startswith("file does not exist") and not msg.lower().startswith("target already exists")
        return jsonify({"success": ok, "message": msg}), (200 if ok else 400)
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/integration/files/upload_text", methods=["POST"])
@integration_required
def integration_files_upload_text() -> Response:
    data = request.get_json(silent=True) or {}
    username, err = _integration_target_user(data)
    if err:
        return err

    rel_dir = str(data.get("dir") or "./")
    filename = str(data.get("filename") or "").strip()
    content = str(data.get("content") or "")
    if not filename:
        return jsonify({"success": False, "message": "filename is required"}), 400

    try:
        folder = _safe_user_path(username, rel_dir)
        folder.mkdir(parents=True, exist_ok=True)
        dst = (folder / filename).resolve()
        root = _user_root(username)
        if os.path.commonpath([str(dst), str(root)]) != str(root):
            return jsonify({"success": False, "message": "invalid destination"}), 400
        with dst.open("w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"success": True, "path": str(dst)})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


# ---------------- Legacy compatibility routes ----------------

@app.route("/api/getlistdir.py", methods=["GET"])
def legacy_getlistdir() -> Response:
    ident = current_identity()
    if not ident:
        return jsonify({"error": "login"})

    rel_dir = request.args.get("dir", "./")
    requested_user = request.args.get("user")
    target_user, err = _resolve_target_user(requested_user)
    if err:
        return jsonify({"error": "no permissions"})

    try:
        result = _list_dir_impl(target_user, rel_dir)
    except FileNotFoundError:
        return jsonify({"error": "cannot find dir"})
    except NotADirectoryError:
        return jsonify({"error": "not a dir"})
    except ValueError:
        return jsonify({"error": "cannot use '..' in WNetdisk!"})

    old_shape = {}
    for idx, item in enumerate(result["items"]):
        old_shape[idx] = {
            "request_user": ident["username"],
            "name": item["name"],
            "type": item["is_file"]
        }
    return jsonify(old_shape)


@app.route("/api/createDir.py", methods=["GET"])
@app.route("/api/createdir.py", methods=["GET"])
def legacy_createdir() -> Response:
    if not current_identity():
        return Response("You are not allowed to create dir before you login.", mimetype="text/plain")

    rel_path = request.args.get("path", "")
    target_user, err = _resolve_target_user(None)
    if err:
        return Response("No permission", mimetype="text/plain")

    try:
        message = _mkdir_impl(target_user, rel_path)
        return Response(message, mimetype="text/plain")
    except ValueError:
        return Response("CANNOT USE .. in PATH!", mimetype="text/plain")


@app.route("/api/deleteFile.py", methods=["GET"])
def legacy_deletefile() -> Response:
    if not current_identity():
        return Response("You are not allowed to delete file before you login.", mimetype="text/plain")

    rel_path = request.args.get("path", "")
    target_user, err = _resolve_target_user(None)
    if err:
        return Response("No permission", mimetype="text/plain")

    try:
        message = _delete_impl(target_user, rel_path)
        return Response(message, mimetype="text/plain")
    except ValueError:
        return Response("CANNOT USE .. in PATH!", mimetype="text/plain")


@app.route("/api/rename.py", methods=["GET"])
def legacy_rename() -> Response:
    if not current_identity():
        return jsonify({"error": "no permissions"})

    old_rel = request.args.get("old", "")
    new_name = request.args.get("new", "")
    target_user, err = _resolve_target_user(None)
    if err:
        return jsonify({"error": "no permissions"})

    message = _rename_impl(target_user, old_rel, new_name)
    if message.startswith("Renamed"):
        return jsonify({"success": message})
    return jsonify({"error": message})


@app.route("/api/moveFile.py", methods=["GET"])
def legacy_movefile() -> Response:
    if not current_identity():
        return jsonify({"error": "no permissions"})

    src_rel = request.args.get("src", "")
    dst_rel = request.args.get("dest", "")
    cut = _as_bool(request.args.get("cut", "false"))
    target_user, err = _resolve_target_user(None)
    if err:
        return jsonify({"error": "no permissions"})

    try:
        message = _move_impl(target_user, src_rel, dst_rel, cut)
        if message.startswith("Moved"):
            return jsonify({"success": message})
        if message.startswith("Copied"):
            return Response(message, mimetype="text/plain")
        return jsonify({"error": message})
    except ValueError:
        return jsonify({"error": "CANNOT USE .. in PATH!"})


@app.route("/api/updatefile.py", methods=["POST"])
def legacy_updatefile() -> Response:
    if not current_identity():
        return Response("You are not allowed to upload file before you login.", mimetype="text/plain")

    rel_path = request.args.get("path") or request.form.get("path") or "./"
    requested_user = request.args.get("username") or request.form.get("username")

    target_user, err = _resolve_target_user(requested_user)
    if err:
        return Response("No permission", mimetype="text/plain")

    try:
        saved_path, save_err = _upload_impl(target_user, rel_path)
        if save_err:
            return Response(save_err, mimetype="text/plain")
        return Response(saved_path, mimetype="text/plain")
    except ValueError:
        return Response("CANNOT USE .. in PATH or USERNAME!!!", mimetype="text/plain")


@app.route("/api/download.py", methods=["GET"])
def legacy_download() -> Response:
    return api_files_download()


@app.route("/api/getdetail.py", methods=["GET"])
def legacy_getdetail() -> Response:
    ident = current_identity()
    if not ident:
        return jsonify({"error": "login"})
    rel_file = request.args.get("filepath", "")
    try:
        fp = _safe_user_path(ident["username"], rel_file)
        if not fp.exists() or not fp.is_file():
            return jsonify({"error": "not a file"})
        return jsonify(_serialize_file_detail(fp))
    except ValueError:
        return jsonify({"error": "cannot find file"})


@app.route("/api/getfilequickview.py", methods=["GET"])
def legacy_getfilequickview() -> Response:
    ident = current_identity()
    if not ident:
        return jsonify({"error": "no permissions"})
    rel_file = request.args.get("filepath", "")
    try:
        fp = _safe_user_path(ident["username"], rel_file)
        if not fp.exists() or not fp.is_file():
            return jsonify({"error": f"file not found: {rel_file}"})
        return send_file(fp, conditional=True)
    except ValueError:
        return jsonify({"error": "no permissions"})


@app.route("/api/getmusiccover.py", methods=["GET"])
def legacy_getmusiccover() -> Response:
    if not current_identity():
        return jsonify({"error": "no permissions"})
    return jsonify({"error": "cover extraction not implemented"})


@app.route("/api/manageuser.py", methods=["GET"])
def legacy_manageuser() -> Response:
    ident = current_identity()
    if not ident:
        return Response("You have to login first.", mimetype="text/plain")
    if ident.get("role") != "admin":
        return Response("You dont have permission to view this page.", mimetype="text/plain")

    req_type = request.args.get("type", "")
    dst_user = (request.args.get("user") or "").strip()
    password = request.args.get("pwd") or ""
    role = request.args.get("role")

    if req_type == "alluser":
        users = list_users()
        payload = {}
        for uname, meta in users.items():
            payload[uname] = {
                "password": _sha1_text(meta.get("password") or ""),
                "path": str(_user_root(uname)),
                "role": meta.get("role", "normal")
            }
        return jsonify(payload)

    if req_type == "create":
        if not _valid_username(dst_user) or not password:
            return Response("Invalid username/password", mimetype="text/plain")
        if get_user(dst_user):
            return Response("User already exists", mimetype="text/plain")
        save_user(dst_user, password, "normal")
        _user_root(dst_user)
        return Response("User created", mimetype="text/plain")

    if req_type == "changepwd":
        user = get_user(dst_user)
        if not user:
            return Response("User does not exist", mimetype="text/plain")
        user["password"] = password
        with _user_file(dst_user).open("w", encoding="utf-8") as f:
            json.dump(user, f, ensure_ascii=False, indent=2)
        return Response("Password changed", mimetype="text/plain")

    if role:
        if role not in {"normal", "vip", "admin"}:
            return Response("Invalid role", mimetype="text/plain")
        if dst_user == ident.get("username"):
            return Response("Cannot modify yourself", mimetype="text/plain")
        user = get_user(dst_user)
        if not user:
            return Response("User does not exist", mimetype="text/plain")
        if user.get("role") == "admin":
            return Response("Cannot modify admin", mimetype="text/plain")
        user["role"] = role
        with _user_file(dst_user).open("w", encoding="utf-8") as f:
            json.dump(user, f, ensure_ascii=False, indent=2)
        return Response("Role updated", mimetype="text/plain")

    if req_type == "deleteuser":
        if dst_user == ident.get("username"):
            return Response("Cannot delete yourself", mimetype="text/plain")
        user = get_user(dst_user)
        if not user:
            return Response("User does not exist", mimetype="text/plain")
        if user.get("role") == "admin":
            return Response("Cannot delete admin", mimetype="text/plain")
        user_root = _user_root(dst_user)
        if user_root.exists():
            shutil.rmtree(user_root, ignore_errors=True)
        delete_user(dst_user)
        return Response("User deleted", mimetype="text/plain")

    return Response("Invalid request type", mimetype="text/plain")


def bootstrap() -> None:
    ensure_dirs()
    ensure_admin_user()


bootstrap()


if __name__ == "__main__":
    host = CONFIG.get("host") or "0.0.0.0"
    port = int(CONFIG.get("port") or 8099)
    app.run(host=host, port=port, debug=False)
