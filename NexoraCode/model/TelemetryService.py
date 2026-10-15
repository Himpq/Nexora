"""Local collection and privacy filtering for optional NexoraCode telemetry."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import queue
import re
import secrets
import sqlite3
import threading
from urllib.request import Request, urlopen

from core.config import config, get_app_root


_LOGGER = logging.getLogger(__name__)
_TELEMETRY_URL = "https://chat.himpqblog.cn/api/nexoracode/telemetry/events"
_INSTALLATION_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
_ERROR_TYPES = {
    "ProviderError",
    "EmptyResponse",
    "ToolReportedFailure",
    "TimeoutError",
    "ConnectionError",
    "OSError",
    "PermissionError",
    "FileNotFoundError",
    "ValueError",
    "TypeError",
    "RuntimeError",
    "JSONDecodeError",
    "HTTPError",
    "OtherError",
}


class TelemetryService:
    """Keep project fingerprints local and upload only an allowlisted event schema."""

    def __init__(self):
        self._lock = threading.RLock()
        self._queue: queue.Queue[tuple[int, dict]] = queue.Queue(maxsize=256)
        self._worker_started = False
        self._generation = 0
        self._active_project_path = ""
        self._active_project_hash = ""

    def status(self) -> dict:
        return {
            "enabled": bool(config.get("local_telemetry_enabled", True)),
            "notice_seen": bool(config.get("local_telemetry_notice_seen", False)),
        }

    def acknowledge_notice(self) -> None:
        config.set("local_telemetry_notice_seen", True)

    def set_enabled(self, enabled: bool) -> None:
        with self._lock:
            previous = bool(config.get("local_telemetry_enabled", True))
            config.set("local_telemetry_enabled", enabled)

            if previous == enabled:
                return

            self._generation += 1

            if not enabled:
                self._discard_pending_events()

    def set_active_project(self, conversation: dict) -> None:
        metadata = conversation.get("metadata") if isinstance(conversation, dict) else {}
        metadata = metadata if isinstance(metadata, dict) else {}
        project = metadata.get("nexoracode_project")
        project = project if isinstance(project, dict) else {}
        project_path = str(project.get("path") or "").strip()

        with self._lock:
            self._active_project_path = project_path
            self._active_project_hash = ""

    def record_active_seconds(self, seconds: int) -> None:
        if (
            not self._collection_enabled()
            or type(seconds) is not int
            or not 1 <= seconds <= 60
        ):
            return

        project_hash = self._active_project_fingerprint()

        if project_hash:
            self._record_local_project_metric(project_hash, active_seconds=seconds)

        self._enqueue({
            "event_type": "activity",
            "active_seconds": seconds,
        })

    def record_error(self, category: str, error_type: str, *, project_path: str) -> None:
        """Associate failures with their execution project, never the selected UI project."""
        if not self._collection_enabled() or category not in {"provider", "tool"}:
            return

        safe_error_type = error_type if error_type in _ERROR_TYPES else "OtherError"
        project_hash = self._project_fingerprint(project_path)

        if project_hash:
            self._record_local_project_metric(
                project_hash,
                provider_errors=1 if category == "provider" else 0,
                tool_errors=1 if category == "tool" else 0,
            )

        self._enqueue({
            "event_type": "error",
            "error_category": category,
            "error_type": safe_error_type,
        })

    def _collection_enabled(self) -> bool:
        return bool(config.get("local_telemetry_enabled", True)) and bool(
            config.get("local_telemetry_notice_seen", False)
        )

    def _active_project_fingerprint(self) -> str:
        if not self._collection_enabled():
            return ""

        with self._lock:
            if self._active_project_hash:
                return self._active_project_hash

            if not self._active_project_path:
                return ""

            self._active_project_hash = self._project_fingerprint(self._active_project_path)

            return self._active_project_hash

    def _project_fingerprint(self, project_path: str) -> str:
        """Hash an explicit local execution path without adding it to upload payloads."""
        if not project_path:
            return ""

        with self._lock:
            try:
                return self._hash_project_path(project_path)
            except (OSError, ValueError) as exc:
                _LOGGER.debug("local project fingerprint unavailable error_type=%s", type(exc).__name__)
                return ""

    def _hash_project_path(self, project_path: str) -> str:
        """Create a stable project key using a random secret stored only locally."""
        normalized_path = os.path.normcase(os.path.normpath(project_path))
        secret_path = get_app_root() / "data" / "nexoracode_telemetry.key"
        secret_path.parent.mkdir(parents=True, exist_ok=True)

        if secret_path.is_file():
            secret = bytes.fromhex(secret_path.read_text(encoding="ascii").strip())
        else:
            secret = secrets.token_bytes(32)
            secret_path.write_text(secret.hex(), encoding="ascii")

        if len(secret) != 32:
            raise ValueError("local telemetry project key is invalid")

        return hmac.new(secret, normalized_path.encode("utf-8"), hashlib.sha256).hexdigest()

    def _record_local_project_metric(
        self,
        project_hash: str,
        *,
        active_seconds: int = 0,
        provider_errors: int = 0,
        tool_errors: int = 0,
    ) -> None:
        """Aggregate activity and error counts under a local HMAC project key."""
        database_path = get_app_root() / "data" / "nexoracode_telemetry.sqlite3"

        try:
            database_path.parent.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(database_path, timeout=5)

            try:
                with connection:
                    connection.execute(
                        """
                        CREATE TABLE IF NOT EXISTS local_project_metrics (
                            project_hash TEXT PRIMARY KEY,
                            active_seconds INTEGER NOT NULL DEFAULT 0,
                            provider_errors INTEGER NOT NULL DEFAULT 0,
                            tool_errors INTEGER NOT NULL DEFAULT 0
                        )
                        """
                    )
                    connection.execute(
                        """
                        INSERT INTO local_project_metrics (
                            project_hash, active_seconds, provider_errors, tool_errors
                        ) VALUES (?, ?, ?, ?)
                        ON CONFLICT(project_hash) DO UPDATE SET
                            active_seconds = active_seconds + excluded.active_seconds,
                            provider_errors = provider_errors + excluded.provider_errors,
                            tool_errors = tool_errors + excluded.tool_errors
                        """,
                        (project_hash, active_seconds, provider_errors, tool_errors),
                    )
            finally:
                connection.close()
        except (OSError, sqlite3.Error) as exc:
            _LOGGER.debug("local telemetry aggregation failed error_type=%s", type(exc).__name__)

    def _enqueue(self, event: dict) -> None:
        if not self._collection_enabled():
            return

        with self._lock:
            if not self._worker_started:
                worker = threading.Thread(
                    target=self._upload_worker,
                    name="nexoracode-telemetry",
                    daemon=True,
                )
                worker.start()
                self._worker_started = True

            try:
                self._queue.put_nowait((self._generation, event))
            except queue.Full:
                _LOGGER.debug("telemetry queue full; event was not queued")

    def _discard_pending_events(self) -> None:
        while True:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                return

            self._queue.task_done()

    def _upload_worker(self) -> None:
        """Send bounded event dictionaries without retrying or logging payloads."""
        while True:
            generation, event = self._queue.get()

            try:
                with self._lock:
                    is_current_generation = generation == self._generation

                if not is_current_generation or not self._collection_enabled():
                    continue

                payload = {
                    "installation_id": self._installation_id(),
                    **event,
                }
                body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
                upload = Request(
                    _TELEMETRY_URL,
                    data=body,
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "NexoraCode-Telemetry/1.0",
                    },
                    method="POST",
                )

                with urlopen(upload, timeout=6) as response:
                    if response.status != 201:
                        raise RuntimeError("telemetry endpoint rejected event")
            except Exception as exc:
                _LOGGER.debug("telemetry upload failed error_type=%s", type(exc).__name__)
            finally:
                self._queue.task_done()

    @staticmethod
    def _installation_id() -> str:
        identifier_path = get_app_root() / "data" / "nexoracode_installation_id"
        identifier_path.parent.mkdir(parents=True, exist_ok=True)

        if identifier_path.is_file():
            identifier = identifier_path.read_text(encoding="ascii").strip()
        else:
            identifier = secrets.token_hex(16)
            identifier_path.write_text(identifier, encoding="ascii")

        if not _INSTALLATION_ID_PATTERN.fullmatch(identifier):
            raise ValueError("local telemetry installation ID is invalid")

        return identifier


_TELEMETRY_SERVICE = TelemetryService()


def get_telemetry_service() -> TelemetryService:
    return _TELEMETRY_SERVICE
