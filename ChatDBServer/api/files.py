import hashlib
import mimetypes
import os
import secrets
import time
from typing import Any, Dict, Optional, Tuple

from flask import Blueprint, jsonify, request, send_file, session

from api.datastorage import get_path_lock, safe_read_json, safe_write_json
from api.file_sandbox import UserFileSandbox
from api.secure import safe_filename


files_bp = Blueprint("files", __name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRANSFER_INDEX_PATH = os.path.join(BASE_DIR, "data", "file_transfers.json")
LIVE_TRANSFER_DIR = os.path.join(BASE_DIR, "data", "live_transfers")

TRANSFER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
TRANSFER_CODE_GROUP_SIZE = 4
TRANSFER_CODE_GROUPS = 3
TRANSFER_CODE_LENGTH = TRANSFER_CODE_GROUP_SIZE * TRANSFER_CODE_GROUPS
TRANSFER_EXPIRE_MINUTES_DEFAULT = 30
TRANSFER_EXPIRE_MINUTES_MIN = 1
TRANSFER_EXPIRE_MINUTES_MAX = 24 * 60
TRANSFER_MAX_DOWNLOADS_DEFAULT = 1
TRANSFER_MAX_DOWNLOADS_MIN = 1
TRANSFER_MAX_DOWNLOADS_MAX = 50
LIVE_TRANSFER_HEARTBEAT_TIMEOUT_SECONDS = 15
LIVE_TRANSFER_EVENTS_LIMIT = 30


def current_username() -> str:
    username = str(session.get("username") or "").strip()

    if not username:
        raise PermissionError("login required")

    return username


def json_error(message: str, status: int = 400):
    return jsonify({
        "success": False,
        "message": message,
    }), status


def normalize_transfer_code(code: Any) -> str:
    raw = str(code or "").strip().upper()
    normalized_chars = []

    for ch in raw:
        if ch in {" ", "-", "_"}:
            continue

        if ch not in TRANSFER_CODE_ALPHABET:
            raise ValueError("读取码格式错误")

        normalized_chars.append(ch)

    normalized = "".join(normalized_chars)

    if len(normalized) != TRANSFER_CODE_LENGTH:
        raise ValueError("读取码格式错误")

    return normalized


def format_transfer_code(code: str) -> str:
    clean = normalize_transfer_code(code)
    groups = []

    for index in range(0, len(clean), TRANSFER_CODE_GROUP_SIZE):
        groups.append(clean[index:index + TRANSFER_CODE_GROUP_SIZE])

    return "-".join(groups)


def hash_transfer_code(code: str) -> str:
    clean = normalize_transfer_code(code)
    return hashlib.sha256(clean.encode("utf-8")).hexdigest()


def coerce_int(value: Any, minimum: int, maximum: int, field_name: str) -> int:
    try:
        number = int(value)
    except Exception as exc:
        raise ValueError(f"{field_name} 必须是整数") from exc

    if number < minimum or number > maximum:
        raise ValueError(f"{field_name} 必须在 {minimum} 到 {maximum} 之间")

    return number


class FileTransferStore:
    """管理文件读取码，读取码只存哈希，下载时再回到用户文件沙箱取真实文件。"""

    def __init__(self, index_path: str = TRANSFER_INDEX_PATH):
        self.index_path = index_path
        self.lock = get_path_lock(index_path)
        os.makedirs(os.path.dirname(index_path), exist_ok=True)
        os.makedirs(LIVE_TRANSFER_DIR, exist_ok=True)

    def _load_index(self) -> Dict[str, Any]:
        data = safe_read_json(self.index_path, default={}, ensure_dict=True)

        if not isinstance(data, dict):
            data = {}

        transfers = data.get("transfers")

        if not isinstance(transfers, dict):
            transfers = {}

        data["version"] = 1
        data["transfers"] = transfers

        return data

    def _save_index(self, data: Dict[str, Any]) -> None:
        safe_write_json(self.index_path, data, indent=2)

    def _generate_code(self, transfers: Dict[str, Any]) -> Tuple[str, str]:
        for _ in range(100):
            code = "".join(secrets.choice(TRANSFER_CODE_ALPHABET) for _ in range(TRANSFER_CODE_LENGTH))
            code_hash = hash_transfer_code(code)

            if code_hash not in transfers:
                return code, code_hash

        raise RuntimeError("读取码生成失败")

    def _delete_live_file(self, record: Dict[str, Any]) -> None:
        if str(record.get("transfer_type") or "").strip() != "live":
            return

        stored_path = str(record.get("stored_path") or "").strip().replace("\\", "/")

        if not stored_path:
            return

        abs_path = os.path.normpath(os.path.join(BASE_DIR, stored_path))
        live_root = os.path.normpath(os.path.abspath(LIVE_TRANSFER_DIR))
        abs_path_real = os.path.normpath(os.path.abspath(abs_path))

        if abs_path_real == live_root or not abs_path_real.startswith(live_root + os.sep):
            return

        try:
            if os.path.isfile(abs_path_real):
                os.remove(abs_path_real)
        except Exception as exc:
            print(f"[Files] delete live transfer file failed: {exc}")

    def _prune_expired(self, data: Dict[str, Any], now: Optional[int] = None) -> None:
        current_time = int(now or time.time())
        transfers = data.get("transfers")

        if not isinstance(transfers, dict):
            return

        expired_hashes = []

        for code_hash, record in transfers.items():
            item = record if isinstance(record, dict) else {}
            expires_at = int(item.get("expires_at") or 0)

            if expires_at and expires_at <= current_time:
                expired_hashes.append(code_hash)

        for code_hash in expired_hashes:
            record = transfers.pop(code_hash, None)

            if isinstance(record, dict):
                self._delete_live_file(record)

    def create_transfer(
        self,
        *,
        owner: str,
        file_ref: str,
        expires_in_minutes: int,
        max_downloads: int,
    ) -> Dict[str, Any]:
        safe_owner = str(owner or "").strip()
        safe_file_ref = str(file_ref or "").strip()

        if not safe_owner:
            raise PermissionError("login required")

        if not safe_file_ref:
            raise ValueError("缺少 file_ref")

        sandbox = UserFileSandbox(safe_owner)
        entry = sandbox._get_entry(safe_file_ref)
        abs_path = sandbox._get_abs_path(entry)

        if not os.path.isfile(abs_path):
            raise FileNotFoundError("文件实体不存在")

        created_at = int(time.time())
        expires_at = created_at + expires_in_minutes * 60

        with self.lock:
            data = self._load_index()
            self._prune_expired(data, created_at)
            transfers = data["transfers"]
            code, code_hash = self._generate_code(transfers)
            record = {
                "code_hash": code_hash,
                "owner": safe_owner,
                "file_ref": str(entry.get("sandbox_path") or safe_file_ref).strip(),
                "alias": str(entry.get("alias") or "").strip(),
                "stored_path": str(entry.get("stored_path") or "").strip(),
                "original_name": str(entry.get("original_name") or entry.get("alias") or "").strip(),
                "size": int(entry.get("size") or 0),
                "source_ext": str(entry.get("source_ext") or "").strip(),
                "created_at": created_at,
                "expires_at": expires_at,
                "max_downloads": max_downloads,
                "download_count": 0,
                "revoked": False,
            }
            transfers[code_hash] = record
            self._save_index(data)

        return self._public_record(record, code=code, include_private=True)

    def list_owner_transfers(self, owner: str) -> Dict[str, Any]:
        safe_owner = str(owner or "").strip()
        current_time = int(time.time())

        if not safe_owner:
            raise PermissionError("login required")

        with self.lock:
            data = self._load_index()
            self._prune_expired(data, current_time)
            self._save_index(data)
            transfers = data["transfers"]
            records = [
                self._public_record(record, include_private=True)
                for record in transfers.values()
                if isinstance(record, dict) and str(record.get("owner") or "").strip() == safe_owner
            ]

        records.sort(key=lambda item: int(item.get("created_at") or 0), reverse=True)

        return {
            "success": True,
            "transfers": records,
            "total": len(records),
        }

    def create_live_transfer(
        self,
        *,
        owner: str,
        upload_file: Any,
        expires_in_minutes: int,
        max_downloads: int,
    ) -> Dict[str, Any]:
        safe_owner = str(owner or "").strip()

        if not safe_owner:
            raise PermissionError("login required")

        if upload_file is None:
            raise ValueError("缺少 file")

        original_name = safe_filename(
            getattr(upload_file, "filename", "") or "transfer.bin",
            default="transfer.bin",
            max_len=180,
        )
        stored_name = f"{secrets.token_hex(16)}_{original_name}"
        stored_abs_path = os.path.join(LIVE_TRANSFER_DIR, stored_name)
        stored_rel_path = os.path.relpath(stored_abs_path, BASE_DIR).replace("\\", "/")

        upload_file.save(stored_abs_path)

        if not os.path.isfile(stored_abs_path):
            raise FileNotFoundError("临时传输文件保存失败")

        created_at = int(time.time())
        expires_at = created_at + expires_in_minutes * 60
        size = os.path.getsize(stored_abs_path)

        with self.lock:
            data = self._load_index()
            self._prune_expired(data, created_at)
            transfers = data["transfers"]
            code, code_hash = self._generate_code(transfers)
            record = {
                "transfer_type": "live",
                "code_hash": code_hash,
                "owner": safe_owner,
                "stored_path": stored_rel_path,
                "original_name": original_name,
                "size": int(size),
                "created_at": created_at,
                "expires_at": expires_at,
                "max_downloads": max_downloads,
                "download_count": 0,
                "last_heartbeat_at": created_at,
                "heartbeat_timeout_seconds": LIVE_TRANSFER_HEARTBEAT_TIMEOUT_SECONDS,
                "download_events": [],
                "revoked": False,
            }
            transfers[code_hash] = record
            self._save_index(data)

        return self._public_record(record, code=code, include_private=True)

    def get_public_record(self, code: str) -> Dict[str, Any]:
        record = self._get_active_record(code)
        return self._public_record(record, include_private=False)

    def revoke_transfer(self, *, owner: str, code: str) -> Dict[str, Any]:
        safe_owner = str(owner or "").strip()
        code_hash = hash_transfer_code(code)

        if not safe_owner:
            raise PermissionError("login required")

        with self.lock:
            data = self._load_index()
            transfers = data["transfers"]
            record = transfers.get(code_hash)

            if not isinstance(record, dict):
                raise FileNotFoundError("读取码不存在或已过期")

            if str(record.get("owner") or "").strip() != safe_owner:
                raise PermissionError("无权撤销该读取码")

            record["revoked"] = True
            self._delete_live_file(record)
            self._save_index(data)

        return {
            "success": True,
            "transfer": self._public_record(record, include_private=True),
        }

    def heartbeat_live_transfer(self, *, owner: str, code: str) -> Dict[str, Any]:
        safe_owner = str(owner or "").strip()
        code_hash = hash_transfer_code(code)
        current_time = int(time.time())

        if not safe_owner:
            raise PermissionError("login required")

        with self.lock:
            data = self._load_index()
            self._prune_expired(data, current_time)
            transfers = data["transfers"]
            record = transfers.get(code_hash)

            if not isinstance(record, dict):
                self._save_index(data)
                raise FileNotFoundError("读取码不存在或已过期")

            if str(record.get("owner") or "").strip() != safe_owner:
                raise PermissionError("无权维持该读取码")

            if str(record.get("transfer_type") or "").strip() != "live":
                raise ValueError("该读取码不是在线传输")

            self._assert_record_active(record, current_time, require_heartbeat=False)
            record["last_heartbeat_at"] = current_time
            self._save_index(data)

        return {
            "success": True,
            "transfer": self._public_record(record, include_private=True),
        }

    def list_live_transfer_events(self, *, owner: str, code: str, since: int = 0) -> Dict[str, Any]:
        safe_owner = str(owner or "").strip()
        code_hash = hash_transfer_code(code)

        if not safe_owner:
            raise PermissionError("login required")

        with self.lock:
            data = self._load_index()
            self._prune_expired(data)
            transfers = data["transfers"]
            record = transfers.get(code_hash)

            if not isinstance(record, dict):
                self._save_index(data)
                raise FileNotFoundError("读取码不存在或已过期")

            if str(record.get("owner") or "").strip() != safe_owner:
                raise PermissionError("无权查看该读取码")

            raw_events = record.get("download_events")
            events = raw_events if isinstance(raw_events, list) else []
            filtered = [
                event for event in events
                if isinstance(event, dict) and int(event.get("id") or 0) > int(since or 0)
            ]
            transfer = self._public_record(record, include_private=True)
            self._save_index(data)

        return {
            "success": True,
            "transfer": transfer,
            "events": filtered,
        }

    def claim_download(
        self,
        code: str,
        *,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Dict[str, Any]:
        code_hash = hash_transfer_code(code)
        current_time = int(time.time())

        with self.lock:
            data = self._load_index()
            self._prune_expired(data, current_time)
            transfers = data["transfers"]
            record = transfers.get(code_hash)

            if not isinstance(record, dict):
                self._save_index(data)
                raise FileNotFoundError("读取码不存在或已过期")

            self._assert_record_active(record, current_time)
            record["download_count"] = int(record.get("download_count") or 0) + 1

            if str(record.get("transfer_type") or "").strip() == "live":
                events = record.get("download_events")

                if not isinstance(events, list):
                    events = []

                next_id = 1

                if events:
                    next_id = max(int(item.get("id") or 0) for item in events if isinstance(item, dict)) + 1

                events.append({
                    "id": next_id,
                    "type": "download",
                    "at": current_time,
                    "ip": str(ip_address or "").strip()[:120],
                    "user_agent": str(user_agent or "").strip()[:500],
                })
                record["download_events"] = events[-LIVE_TRANSFER_EVENTS_LIMIT:]

            self._save_index(data)

            return dict(record)

    def _get_active_record(self, code: str) -> Dict[str, Any]:
        code_hash = hash_transfer_code(code)
        current_time = int(time.time())

        with self.lock:
            data = self._load_index()
            self._prune_expired(data, current_time)
            transfers = data["transfers"]
            record = transfers.get(code_hash)

            if not isinstance(record, dict):
                self._save_index(data)
                raise FileNotFoundError("读取码不存在或已过期")

            self._assert_record_active(record, current_time)
            self._save_index(data)

            return dict(record)

    def _assert_record_active(
        self,
        record: Dict[str, Any],
        now: int,
        require_heartbeat: bool = True,
    ) -> None:
        if bool(record.get("revoked")):
            raise PermissionError("读取码已撤销")

        expires_at = int(record.get("expires_at") or 0)

        if expires_at <= now:
            raise FileNotFoundError("读取码已过期")

        max_downloads = int(record.get("max_downloads") or TRANSFER_MAX_DOWNLOADS_DEFAULT)
        download_count = int(record.get("download_count") or 0)

        if download_count >= max_downloads:
            raise PermissionError("读取码下载次数已用完")

        if require_heartbeat and str(record.get("transfer_type") or "").strip() == "live":
            last_heartbeat_at = int(record.get("last_heartbeat_at") or 0)
            timeout_seconds = int(record.get("heartbeat_timeout_seconds") or LIVE_TRANSFER_HEARTBEAT_TIMEOUT_SECONDS)

            if last_heartbeat_at + timeout_seconds < now:
                raise PermissionError("在线传输窗口已关闭，读取码失效")

    def _public_record(
        self,
        record: Dict[str, Any],
        code: str = "",
        include_private: bool = False,
    ) -> Dict[str, Any]:
        download_count = int(record.get("download_count") or 0)
        max_downloads = int(record.get("max_downloads") or TRANSFER_MAX_DOWNLOADS_DEFAULT)
        remaining_downloads = max(0, max_downloads - download_count)
        file_name = safe_filename(
            record.get("original_name") or record.get("alias") or "download.bin",
            default="download.bin",
            max_len=180,
        )

        payload = {
            "file_name": file_name,
            "size": int(record.get("size") or 0),
            "mime_type": mimetypes.guess_type(file_name)[0] or "application/octet-stream",
            "created_at": int(record.get("created_at") or 0),
            "expires_at": int(record.get("expires_at") or 0),
            "max_downloads": max_downloads,
            "download_count": download_count,
            "remaining_downloads": remaining_downloads,
            "revoked": bool(record.get("revoked")),
            "transfer_type": str(record.get("transfer_type") or "sandbox").strip() or "sandbox",
        }

        if include_private:
            payload.update({
                "owner": str(record.get("owner") or "").strip(),
                "file_ref": str(record.get("file_ref") or "").strip(),
                "alias": str(record.get("alias") or "").strip(),
                "last_heartbeat_at": int(record.get("last_heartbeat_at") or 0),
                "heartbeat_timeout_seconds": int(record.get("heartbeat_timeout_seconds") or 0),
            })

        if code:
            payload["code"] = format_transfer_code(code)

        return payload


def resolve_record_file(record: Dict[str, Any]) -> Tuple[str, str, str]:
    transfer_type = str(record.get("transfer_type") or "").strip()

    if transfer_type == "live":
        stored_path = str(record.get("stored_path") or "").strip().replace("\\", "/")

        if not stored_path:
            raise FileNotFoundError("在线传输文件信息不完整")

        abs_path = os.path.normpath(os.path.join(BASE_DIR, stored_path))
        live_root = os.path.normpath(os.path.abspath(LIVE_TRANSFER_DIR))
        abs_path_real = os.path.normpath(os.path.abspath(abs_path))

        if abs_path_real == live_root or not abs_path_real.startswith(live_root + os.sep):
            raise FileNotFoundError("在线传输文件路径无效")

        if not os.path.isfile(abs_path_real):
            raise FileNotFoundError("在线传输文件不存在")

        download_name = safe_filename(
            record.get("original_name") or "download.bin",
            default="download.bin",
            max_len=180,
        )
        mimetype = mimetypes.guess_type(download_name)[0] or "application/octet-stream"

        return abs_path_real, download_name, mimetype

    owner = str(record.get("owner") or "").strip()
    file_ref = str(record.get("file_ref") or "").strip()
    stored_path = str(record.get("stored_path") or "").strip()

    if not owner or not file_ref:
        raise FileNotFoundError("读取码文件信息不完整")

    sandbox = UserFileSandbox(owner)
    entry = sandbox._get_entry(file_ref)

    if stored_path and str(entry.get("stored_path") or "").strip() != stored_path:
        raise FileNotFoundError("文件已更新，读取码失效")

    abs_path = sandbox._get_abs_path(entry)
    download_name = safe_filename(
        entry.get("original_name") or entry.get("alias") or record.get("original_name") or "download.bin",
        default="download.bin",
        max_len=180,
    )
    mimetype = mimetypes.guess_type(download_name)[0] or "application/octet-stream"

    return abs_path, download_name, mimetype


def get_download_client_ip() -> str:
    forwarded_for = str(request.headers.get("X-Forwarded-For") or "").strip()

    if forwarded_for:
        first = forwarded_for.split(",")[0].strip()

        if first:
            return first

    return str(request.remote_addr or "").strip()


transfer_store = FileTransferStore()


@files_bp.route("/api/files/transfer/create", methods=["POST"])
def create_file_transfer():
    try:
        username = current_username()
        data = request.get_json(silent=True) or {}
        file_ref = str(data.get("file_ref") or data.get("sandbox_path") or data.get("alias") or "").strip()
        expires_in_minutes = coerce_int(
            data.get("expires_in_minutes", TRANSFER_EXPIRE_MINUTES_DEFAULT),
            TRANSFER_EXPIRE_MINUTES_MIN,
            TRANSFER_EXPIRE_MINUTES_MAX,
            "expires_in_minutes",
        )
        max_downloads = coerce_int(
            data.get("max_downloads", TRANSFER_MAX_DOWNLOADS_DEFAULT),
            TRANSFER_MAX_DOWNLOADS_MIN,
            TRANSFER_MAX_DOWNLOADS_MAX,
            "max_downloads",
        )
        transfer = transfer_store.create_transfer(
            owner=username,
            file_ref=file_ref,
            expires_in_minutes=expires_in_minutes,
            max_downloads=max_downloads,
        )

        return jsonify({
            "success": True,
            "transfer": transfer,
        })
    except PermissionError as exc:
        return json_error(str(exc), 401)
    except FileNotFoundError as exc:
        return json_error(str(exc), 404)
    except ValueError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Files] create transfer failed: {exc}")
        return json_error(f"创建读取码失败: {str(exc)}", 500)


@files_bp.route("/api/files/transfer/list", methods=["GET"])
def list_file_transfers():
    try:
        username = current_username()
        return jsonify(transfer_store.list_owner_transfers(username))
    except PermissionError as exc:
        return json_error(str(exc), 401)
    except Exception as exc:
        print(f"[Files] list transfers failed: {exc}")
        return json_error(f"读取传输列表失败: {str(exc)}", 500)


@files_bp.route("/api/files/live-transfer/create", methods=["POST"])
def create_live_file_transfer():
    try:
        username = current_username()
        upload_file = request.files.get("file")
        expires_in_minutes = coerce_int(
            request.form.get("expires_in_minutes", TRANSFER_EXPIRE_MINUTES_DEFAULT),
            TRANSFER_EXPIRE_MINUTES_MIN,
            TRANSFER_EXPIRE_MINUTES_MAX,
            "expires_in_minutes",
        )
        max_downloads = coerce_int(
            request.form.get("max_downloads", TRANSFER_MAX_DOWNLOADS_DEFAULT),
            TRANSFER_MAX_DOWNLOADS_MIN,
            TRANSFER_MAX_DOWNLOADS_MAX,
            "max_downloads",
        )
        transfer = transfer_store.create_live_transfer(
            owner=username,
            upload_file=upload_file,
            expires_in_minutes=expires_in_minutes,
            max_downloads=max_downloads,
        )

        return jsonify({
            "success": True,
            "transfer": transfer,
        })
    except PermissionError as exc:
        return json_error(str(exc), 401)
    except FileNotFoundError as exc:
        return json_error(str(exc), 404)
    except ValueError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Files] create live transfer failed: {exc}")
        return json_error(f"创建在线传输失败: {str(exc)}", 500)


@files_bp.route("/api/files/live-transfer/<path:code>/heartbeat", methods=["POST"])
def heartbeat_live_file_transfer(code):
    try:
        username = current_username()
        return jsonify(transfer_store.heartbeat_live_transfer(owner=username, code=code))
    except PermissionError as exc:
        return json_error(str(exc), 403)
    except FileNotFoundError as exc:
        return json_error(str(exc), 404)
    except ValueError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Files] heartbeat live transfer failed: {exc}")
        return json_error(f"维持在线传输失败: {str(exc)}", 500)


@files_bp.route("/api/files/live-transfer/<path:code>/revoke", methods=["POST"])
def revoke_live_file_transfer(code):
    try:
        username = current_username()
        return jsonify(transfer_store.revoke_transfer(owner=username, code=code))
    except PermissionError as exc:
        return json_error(str(exc), 403)
    except FileNotFoundError as exc:
        return json_error(str(exc), 404)
    except ValueError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Files] revoke live transfer failed: {exc}")
        return json_error(f"关闭在线传输失败: {str(exc)}", 500)


@files_bp.route("/api/files/live-transfer/<path:code>/events", methods=["GET"])
def list_live_file_transfer_events(code):
    try:
        username = current_username()
        since = coerce_int(
            request.args.get("since", 0),
            0,
            1000000000,
            "since",
        )

        return jsonify(transfer_store.list_live_transfer_events(owner=username, code=code, since=since))
    except PermissionError as exc:
        return json_error(str(exc), 403)
    except FileNotFoundError as exc:
        return json_error(str(exc), 404)
    except ValueError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Files] list live transfer events failed: {exc}")
        return json_error(f"读取在线传输事件失败: {str(exc)}", 500)


@files_bp.route("/api/files/transfer/<path:code>", methods=["GET"])
def get_file_transfer(code):
    try:
        transfer = transfer_store.get_public_record(code)

        return jsonify({
            "success": True,
            "transfer": transfer,
        })
    except FileNotFoundError as exc:
        return json_error(str(exc), 404)
    except PermissionError as exc:
        return json_error(str(exc), 403)
    except ValueError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Files] get transfer failed: {exc}")
        return json_error(f"读取传输信息失败: {str(exc)}", 500)


@files_bp.route("/api/files/transfer/<path:code>", methods=["DELETE"])
def revoke_file_transfer(code):
    try:
        username = current_username()
        return jsonify(transfer_store.revoke_transfer(owner=username, code=code))
    except PermissionError as exc:
        return json_error(str(exc), 403)
    except FileNotFoundError as exc:
        return json_error(str(exc), 404)
    except ValueError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Files] revoke transfer failed: {exc}")
        return json_error(f"撤销读取码失败: {str(exc)}", 500)


@files_bp.route("/api/files/transfer/<path:code>/download", methods=["GET"])
def download_file_transfer(code):
    try:
        record = transfer_store.claim_download(
            code,
            ip_address=get_download_client_ip(),
            user_agent=str(request.headers.get("User-Agent") or "").strip(),
        )
        abs_path, download_name, mimetype = resolve_record_file(record)

        return send_file(abs_path, as_attachment=True, download_name=download_name, mimetype=mimetype)
    except FileNotFoundError as exc:
        return json_error(str(exc), 404)
    except PermissionError as exc:
        return json_error(str(exc), 403)
    except ValueError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Files] download transfer failed: {exc}")
        return json_error(f"下载传输文件失败: {str(exc)}", 500)
