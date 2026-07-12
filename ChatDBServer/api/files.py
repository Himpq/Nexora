import hashlib
import mimetypes
import os
import secrets
import threading
import time
import urllib.parse
from collections import deque
from typing import Any, Deque, Dict, Optional, Tuple

from flask import Blueprint, Response, jsonify, render_template, request, send_file, session, stream_with_context

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
TRANSFER_MAX_DOWNLOADS_DEFAULT = 5
TRANSFER_MAX_DOWNLOADS_MIN = 1
TRANSFER_MAX_DOWNLOADS_MAX = 50
LIVE_TRANSFER_HEARTBEAT_TIMEOUT_SECONDS = 15
LIVE_TRANSFER_EVENTS_LIMIT = 30
LIVE_TRANSFER_FILE_SIZE_MAX = 10 * 1024 * 1024 * 1024 * 1024
LIVE_TRANSFER_CHUNK_MAX_BYTES = 1024 * 1024
LIVE_TRANSFER_QUEUE_MAX_CHUNKS = 8
LIVE_TRANSFER_DOWNLOAD_WAIT_SECONDS = 45
LIVE_TRANSFER_DOWNLOAD_ID_MAX_LENGTH = 96


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


def normalize_live_download_id(value: Any) -> str:
    raw = str(value or "").strip()

    if not raw:
        raise ValueError("缺少 download_id")

    if len(raw) > LIVE_TRANSFER_DOWNLOAD_ID_MAX_LENGTH:
        raise ValueError("download_id 过长")

    for ch in raw:
        if not (ch.isalnum() or ch in {"-", "_"}):
            raise ValueError("download_id 格式错误")

    return raw


def build_attachment_content_disposition(download_name: str) -> str:
    safe_download_name = safe_filename(download_name, default="download.bin", max_len=180)
    ascii_name = safe_download_name.encode("ascii", errors="ignore").decode("ascii").strip()

    if not ascii_name:
        ascii_name = "download.bin"

    quoted_name = urllib.parse.quote(safe_download_name)

    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quoted_name}"


class LiveTransferDownloadSession:
    """单个下载请求的内存中转队列，发送端写入分片，下载端同步读出分片。"""

    def __init__(self, *, code_hash: str, download_id: str):
        self.code_hash = str(code_hash or "").strip()
        self.download_id = normalize_live_download_id(download_id)
        self.condition = threading.Condition()
        self.chunks: Deque[bytes] = deque()
        self.closed = False
        self.failed_message = ""
        self.expected_chunk_index = 0
        self.bytes_received = 0
        self.bytes_sent = 0
        self.created_at = int(time.time())
        self.updated_at = self.created_at

    def push_chunk(self, chunk_index: int, chunk: bytes) -> Dict[str, Any]:
        index = int(chunk_index)

        if index < 0:
            raise ValueError("chunk_index 不能小于 0")

        if not isinstance(chunk, (bytes, bytearray)):
            raise ValueError("分片内容必须是二进制")

        chunk_bytes = bytes(chunk)

        if not chunk_bytes:
            raise ValueError("分片内容不能为空")

        if len(chunk_bytes) > LIVE_TRANSFER_CHUNK_MAX_BYTES:
            raise ValueError(f"单个分片不能超过 {LIVE_TRANSFER_CHUNK_MAX_BYTES} 字节")

        with self.condition:
            if index != self.expected_chunk_index:
                raise ValueError(f"分片顺序错误，期待 {self.expected_chunk_index}，收到 {index}")

            while (
                len(self.chunks) >= LIVE_TRANSFER_QUEUE_MAX_CHUNKS
                and not self.closed
                and not self.failed_message
            ):
                self.condition.wait(10)

            if self.failed_message:
                raise RuntimeError(self.failed_message)

            if self.closed:
                raise RuntimeError("下载端已断开")

            self.chunks.append(chunk_bytes)
            self.expected_chunk_index += 1
            self.bytes_received += len(chunk_bytes)
            self.updated_at = int(time.time())
            self.condition.notify_all()

            return {
                "download_id": self.download_id,
                "chunk_index": index,
                "bytes_received": self.bytes_received,
                "queued_chunks": len(self.chunks),
            }

    def finish(self, expected_size: int) -> Dict[str, Any]:
        safe_expected_size = int(expected_size)

        if safe_expected_size < 0:
            raise ValueError("file_size 不能小于 0")

        with self.condition:
            if self.failed_message:
                raise RuntimeError(self.failed_message)

            if self.bytes_received != safe_expected_size:
                self.failed_message = f"传输大小不一致，期待 {safe_expected_size} 字节，收到 {self.bytes_received} 字节"
                self.closed = True
                self.condition.notify_all()
                raise ValueError(self.failed_message)

            self.closed = True
            self.updated_at = int(time.time())
            self.condition.notify_all()

            return {
                "download_id": self.download_id,
                "bytes_received": self.bytes_received,
            }

    def fail(self, message: str) -> None:
        with self.condition:
            self.failed_message = str(message or "在线传输已中断").strip() or "在线传输已中断"
            self.closed = True
            self.updated_at = int(time.time())
            self.condition.notify_all()

    def read_next_chunk(self) -> Optional[bytes]:
        deadline = time.time() + LIVE_TRANSFER_DOWNLOAD_WAIT_SECONDS

        with self.condition:
            while not self.chunks and not self.closed and not self.failed_message:
                remaining = deadline - time.time()

                if remaining <= 0:
                    self.failed_message = "发送端传输超时"
                    self.closed = True
                    self.condition.notify_all()
                    raise TimeoutError(self.failed_message)

                self.condition.wait(min(1, remaining))

            if self.failed_message:
                raise RuntimeError(self.failed_message)

            if self.chunks:
                chunk = self.chunks.popleft()
                self.bytes_sent += len(chunk)
                self.updated_at = int(time.time())
                self.condition.notify_all()

                return chunk

            return None


class LiveTransferRelayRuntime:
    """进程内实时中转运行时，只保存活跃下载请求的短期分片队列。"""

    def __init__(self):
        self.lock = threading.RLock()
        self.sessions: Dict[str, LiveTransferDownloadSession] = {}

    def create_download_session(self, *, code_hash: str) -> LiveTransferDownloadSession:
        safe_code_hash = str(code_hash or "").strip()

        if not safe_code_hash:
            raise ValueError("缺少 code_hash")

        with self.lock:
            for _ in range(100):
                download_id = secrets.token_urlsafe(24)

                if download_id not in self.sessions:
                    session_item = LiveTransferDownloadSession(
                        code_hash=safe_code_hash,
                        download_id=download_id,
                    )
                    self.sessions[download_id] = session_item

                    return session_item

        raise RuntimeError("下载会话创建失败")

    def get_download_session(self, *, code_hash: str, download_id: str) -> LiveTransferDownloadSession:
        safe_code_hash = str(code_hash or "").strip()
        safe_download_id = normalize_live_download_id(download_id)

        with self.lock:
            session_item = self.sessions.get(safe_download_id)

            if not session_item or session_item.code_hash != safe_code_hash:
                raise FileNotFoundError("接收端连接不存在或已结束")

            return session_item

    def close_download_session(self, download_id: str, message: str = "") -> None:
        safe_download_id = str(download_id or "").strip()

        if not safe_download_id:
            return

        with self.lock:
            session_item = self.sessions.pop(safe_download_id, None)

        if session_item:
            session_item.fail(message or "下载会话已关闭")

    def close_transfer_sessions(self, code_hash: str, message: str = "") -> None:
        safe_code_hash = str(code_hash or "").strip()

        if not safe_code_hash:
            return

        with self.lock:
            matched_ids = [
                download_id for download_id, session_item in self.sessions.items()
                if session_item.code_hash == safe_code_hash
            ]
            matched_sessions = [self.sessions.pop(download_id) for download_id in matched_ids]

        for session_item in matched_sessions:
            session_item.fail(message or "在线传输已关闭")


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
        file_name: str,
        file_size: int,
        mime_type: str,
        expires_in_minutes: int,
        max_downloads: int,
    ) -> Dict[str, Any]:
        safe_owner = str(owner or "").strip()

        if not safe_owner:
            raise PermissionError("login required")

        if not str(file_name or "").strip():
            raise ValueError("缺少 file_name")

        original_name = safe_filename(
            file_name,
            default="transfer.bin",
            max_len=180,
        )
        safe_size = coerce_int(file_size, 0, LIVE_TRANSFER_FILE_SIZE_MAX, "file_size")
        safe_mime_type = str(mime_type or "").strip()[:180]

        if not safe_mime_type:
            safe_mime_type = mimetypes.guess_type(original_name)[0] or "application/octet-stream"

        created_at = int(time.time())
        expires_at = created_at + expires_in_minutes * 60

        with self.lock:
            data = self._load_index()
            self._prune_expired(data, created_at)
            transfers = data["transfers"]
            code, code_hash = self._generate_code(transfers)
            record = {
                "transfer_type": "live",
                "code_hash": code_hash,
                "owner": safe_owner,
                "original_name": original_name,
                "size": int(safe_size),
                "mime_type": safe_mime_type,
                "relay_mode": "memory_stream",
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

            self._assert_live_owner_record_available(record, current_time)
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

    def touch_live_transfer_for_upload(self, *, owner: str, code: str) -> Dict[str, Any]:
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
                raise PermissionError("无权发送该在线传输")

            if str(record.get("transfer_type") or "").strip() != "live":
                raise ValueError("该读取码不是在线传输")

            self._assert_live_owner_record_available(record, current_time)
            record["last_heartbeat_at"] = current_time
            self._save_index(data)

            return dict(record)

    def append_live_transfer_event(
        self,
        *,
        code_hash: str,
        event_type: str,
        download_id: str = "",
        ip_address: str = "",
        user_agent: str = "",
        bytes_transferred: int = 0,
        message: str = "",
    ) -> None:
        safe_code_hash = str(code_hash or "").strip()
        safe_event_type = str(event_type or "").strip()

        if not safe_code_hash or not safe_event_type:
            return

        with self.lock:
            data = self._load_index()
            transfers = data["transfers"]
            record = transfers.get(safe_code_hash)

            if not isinstance(record, dict):
                return

            if str(record.get("transfer_type") or "").strip() != "live":
                return

            events = record.get("download_events")

            if not isinstance(events, list):
                events = []

            next_id = 1

            if events:
                event_ids = [int(item.get("id") or 0) for item in events if isinstance(item, dict)]

                if event_ids:
                    next_id = max(event_ids) + 1

            event = {
                "id": next_id,
                "type": safe_event_type,
                "at": int(time.time()),
            }
            safe_download_id = str(download_id or "").strip()
            safe_message = str(message or "").strip()

            if safe_download_id:
                event["download_id"] = safe_download_id

            if ip_address:
                event["ip"] = str(ip_address or "").strip()[:120]

            if user_agent:
                event["user_agent"] = str(user_agent or "").strip()[:500]

            if bytes_transferred:
                event["bytes_transferred"] = int(bytes_transferred)

            if safe_message:
                event["message"] = safe_message[:500]

            events.append(event)
            record["download_events"] = events[-LIVE_TRANSFER_EVENTS_LIMIT:]
            self._save_index(data)

    def claim_download(
        self,
        code: str,
        *,
        ip_address: str = "",
        user_agent: str = "",
        live_download_id: str = "",
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
            is_live_transfer = str(record.get("transfer_type") or "").strip() == "live"

            if not is_live_transfer:
                record["download_count"] = int(record.get("download_count") or 0) + 1

            if is_live_transfer:
                safe_download_id = normalize_live_download_id(live_download_id)
                events = record.get("download_events")

                if not isinstance(events, list):
                    events = []

                next_id = 1

                if events:
                    event_ids = [int(item.get("id") or 0) for item in events if isinstance(item, dict)]

                    if event_ids:
                        next_id = max(event_ids) + 1

                events.append({
                    "id": next_id,
                    "type": "download_request",
                    "at": current_time,
                    "download_id": safe_download_id,
                    "ip": str(ip_address or "").strip()[:120],
                    "user_agent": str(user_agent or "").strip()[:500],
                })
                record["download_events"] = events[-LIVE_TRANSFER_EVENTS_LIMIT:]

            self._save_index(data)

            return dict(record)

    def mark_live_download_complete(self, *, code_hash: str) -> None:
        safe_code_hash = str(code_hash or "").strip()

        if not safe_code_hash:
            return

        with self.lock:
            data = self._load_index()
            transfers = data["transfers"]
            record = transfers.get(safe_code_hash)

            if not isinstance(record, dict):
                return

            if str(record.get("transfer_type") or "").strip() != "live":
                return

            record["download_count"] = int(record.get("download_count") or 0) + 1
            self._save_index(data)

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

    def _assert_live_owner_record_available(self, record: Dict[str, Any], now: int) -> None:
        if bool(record.get("revoked")):
            raise PermissionError("读取码已撤销")

        expires_at = int(record.get("expires_at") or 0)

        if expires_at <= now:
            raise FileNotFoundError("读取码已过期")

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
            "mime_type": str(record.get("mime_type") or "").strip()
            or mimetypes.guess_type(file_name)[0]
            or "application/octet-stream",
            "created_at": int(record.get("created_at") or 0),
            "expires_at": int(record.get("expires_at") or 0),
            "max_downloads": max_downloads,
            "download_count": download_count,
            "remaining_downloads": remaining_downloads,
            "revoked": bool(record.get("revoked")),
            "transfer_type": str(record.get("transfer_type") or "sandbox").strip() or "sandbox",
            "relay_mode": str(record.get("relay_mode") or "").strip(),
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
        raise ValueError("在线传输必须通过实时中转流读取")

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
live_transfer_runtime = LiveTransferRelayRuntime()


def get_live_transfer_request_download_id() -> str:
    return normalize_live_download_id(
        request.headers.get("X-Live-Transfer-Download-Id")
        or request.args.get("download_id")
        or request.form.get("download_id")
    )


def get_live_transfer_request_file_size() -> int:
    data = request.get_json(silent=True) or {}

    return coerce_int(
        request.headers.get("X-Live-Transfer-File-Size")
        or request.args.get("file_size")
        or request.form.get("file_size")
        or data.get("file_size", 0),
        0,
        LIVE_TRANSFER_FILE_SIZE_MAX,
        "file_size",
    )


def build_transfer_download_headers(record: Dict[str, Any], download_name: str = "") -> Dict[str, str]:
    safe_download_name = safe_filename(
        download_name or record.get("file_name") or record.get("original_name") or record.get("alias") or "download.bin",
        default="download.bin",
        max_len=180,
    )
    size = int(record.get("size") or 0)
    headers = {
        "Content-Disposition": build_attachment_content_disposition(safe_download_name),
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
    }

    if size >= 0:
        headers["Content-Length"] = str(size)

    return headers


def build_transfer_head_response(record: Dict[str, Any]) -> Response:
    download_name = safe_filename(
        record.get("file_name") or record.get("original_name") or record.get("alias") or "download.bin",
        default="download.bin",
        max_len=180,
    )
    mimetype = str(record.get("mime_type") or "").strip() or mimetypes.guess_type(download_name)[0] or "application/octet-stream"
    return Response(headers=build_transfer_download_headers(record, download_name), mimetype=mimetype)


def stream_live_transfer_download(record: Dict[str, Any], session_item: LiveTransferDownloadSession) -> Response:
    code_hash = str(record.get("code_hash") or session_item.code_hash or "").strip()
    download_name = safe_filename(
        record.get("original_name") or "download.bin",
        default="download.bin",
        max_len=180,
    )
    mimetype = str(record.get("mime_type") or "").strip() or mimetypes.guess_type(download_name)[0] or "application/octet-stream"

    def generate():
        completed = False

        try:
            while True:
                chunk = session_item.read_next_chunk()

                if chunk is None:
                    completed = True
                    break

                yield chunk

            transfer_store.append_live_transfer_event(
                code_hash=code_hash,
                event_type="download_complete",
                download_id=session_item.download_id,
                bytes_transferred=session_item.bytes_sent,
            )
            transfer_store.mark_live_download_complete(code_hash=code_hash)
        except GeneratorExit:
            session_item.fail("接收端已断开")
            transfer_store.append_live_transfer_event(
                code_hash=code_hash,
                event_type="download_aborted",
                download_id=session_item.download_id,
                bytes_transferred=session_item.bytes_sent,
                message="接收端已断开",
            )
            raise
        except Exception as exc:
            session_item.fail(str(exc))
            transfer_store.append_live_transfer_event(
                code_hash=code_hash,
                event_type="download_failed",
                download_id=session_item.download_id,
                bytes_transferred=session_item.bytes_sent,
                message=str(exc),
            )
            print(f"[Files] live transfer stream failed: {exc}")
            raise
        finally:
            if completed:
                live_transfer_runtime.close_download_session(session_item.download_id, "下载会话已完成")
            else:
                live_transfer_runtime.close_download_session(session_item.download_id, "下载会话已结束")

    return Response(
        stream_with_context(generate()),
        headers=build_transfer_download_headers(record, download_name),
        mimetype=mimetype,
    )


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
        if request.files.get("file") is not None:
            raise ValueError("在线传输不接收文件内容，请只提交文件元数据")

        data = request.get_json(silent=True) or {}
        file_name = str(
            data.get("file_name")
            or data.get("filename")
            or request.form.get("file_name")
            or request.form.get("filename")
            or ""
        ).strip()
        file_size = data.get("file_size", request.form.get("file_size", request.form.get("size", 0)))
        mime_type = str(
            data.get("mime_type")
            or data.get("type")
            or request.form.get("mime_type")
            or request.form.get("type")
            or ""
        ).strip()
        expires_in_minutes = coerce_int(
            data.get("expires_in_minutes", request.form.get("expires_in_minutes", TRANSFER_EXPIRE_MINUTES_DEFAULT)),
            TRANSFER_EXPIRE_MINUTES_MIN,
            TRANSFER_EXPIRE_MINUTES_MAX,
            "expires_in_minutes",
        )
        max_downloads = coerce_int(
            data.get("max_downloads", request.form.get("max_downloads", TRANSFER_MAX_DOWNLOADS_DEFAULT)),
            TRANSFER_MAX_DOWNLOADS_MIN,
            TRANSFER_MAX_DOWNLOADS_MAX,
            "max_downloads",
        )
        transfer = transfer_store.create_live_transfer(
            owner=username,
            file_name=file_name,
            file_size=file_size,
            mime_type=mime_type,
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


@files_bp.route("/api/files/live-transfer/<path:code>/chunk", methods=["POST"])
def push_live_file_transfer_chunk(code):
    try:
        username = current_username()
        code_hash = hash_transfer_code(code)
        download_id = get_live_transfer_request_download_id()
        chunk_index = coerce_int(
            request.headers.get("X-Live-Transfer-Chunk-Index")
            or request.args.get("chunk_index")
            or request.form.get("chunk_index"),
            0,
            1000000000,
            "chunk_index",
        )
        content_length = int(request.content_length or 0)

        if content_length > LIVE_TRANSFER_CHUNK_MAX_BYTES:
            raise ValueError(f"单个分片不能超过 {LIVE_TRANSFER_CHUNK_MAX_BYTES} 字节")

        transfer_store.touch_live_transfer_for_upload(owner=username, code=code)
        session_item = live_transfer_runtime.get_download_session(
            code_hash=code_hash,
            download_id=download_id,
        )
        result = session_item.push_chunk(
            chunk_index=chunk_index,
            chunk=request.get_data(cache=False, as_text=False),
        )

        return jsonify({
            "success": True,
            **result,
        })
    except PermissionError as exc:
        return json_error(str(exc), 403)
    except FileNotFoundError as exc:
        return json_error(str(exc), 404)
    except ValueError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Files] push live transfer chunk failed: {exc}")
        return json_error(f"发送在线传输分片失败: {str(exc)}", 500)


@files_bp.route("/api/files/live-transfer/<path:code>/finish", methods=["POST"])
def finish_live_file_transfer_upload(code):
    try:
        username = current_username()
        code_hash = hash_transfer_code(code)
        download_id = get_live_transfer_request_download_id()
        file_size = get_live_transfer_request_file_size()
        transfer_store.touch_live_transfer_for_upload(owner=username, code=code)
        session_item = live_transfer_runtime.get_download_session(
            code_hash=code_hash,
            download_id=download_id,
        )
        result = session_item.finish(file_size)

        return jsonify({
            "success": True,
            **result,
        })
    except PermissionError as exc:
        return json_error(str(exc), 403)
    except FileNotFoundError as exc:
        return json_error(str(exc), 404)
    except ValueError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        print(f"[Files] finish live transfer failed: {exc}")
        return json_error(f"结束在线传输失败: {str(exc)}", 500)


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
        result = transfer_store.revoke_transfer(owner=username, code=code)
        live_transfer_runtime.close_transfer_sessions(
            hash_transfer_code(code),
            "在线传输已关闭",
        )

        return jsonify(result)
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


@files_bp.route("/share", methods=["GET"])
def share_download_page():
    """公开读取码下载页，不要求登录。"""
    return render_template("share.html")


@files_bp.route("/api/files/transfer/<path:code>", methods=["DELETE"])
def revoke_file_transfer(code):
    try:
        username = current_username()
        result = transfer_store.revoke_transfer(owner=username, code=code)
        live_transfer_runtime.close_transfer_sessions(
            hash_transfer_code(code),
            "读取码已撤销",
        )

        return jsonify(result)
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
    session_item = None

    try:
        if request.method == "HEAD":
            record = transfer_store.get_public_record(code)
            return build_transfer_head_response(record)

        code_hash = hash_transfer_code(code)
        session_item = live_transfer_runtime.create_download_session(code_hash=code_hash)
        record = transfer_store.claim_download(
            code,
            ip_address=get_download_client_ip(),
            user_agent=str(request.headers.get("User-Agent") or "").strip(),
            live_download_id=session_item.download_id,
        )

        if str(record.get("transfer_type") or "").strip() == "live":
            return stream_live_transfer_download(record, session_item)

        live_transfer_runtime.close_download_session(session_item.download_id, "非在线传输下载")
        session_item = None
        abs_path, download_name, mimetype = resolve_record_file(record)

        return send_file(abs_path, as_attachment=True, download_name=download_name, mimetype=mimetype)
    except FileNotFoundError as exc:
        if session_item:
            live_transfer_runtime.close_download_session(session_item.download_id, str(exc))

        return json_error(str(exc), 404)
    except PermissionError as exc:
        if session_item:
            live_transfer_runtime.close_download_session(session_item.download_id, str(exc))

        return json_error(str(exc), 403)
    except ValueError as exc:
        if session_item:
            live_transfer_runtime.close_download_session(session_item.download_id, str(exc))

        return json_error(str(exc), 400)
    except Exception as exc:
        if session_item:
            live_transfer_runtime.close_download_session(session_item.download_id, str(exc))

        print(f"[Files] download transfer failed: {exc}")
        return json_error(f"下载传输文件失败: {str(exc)}", 500)
