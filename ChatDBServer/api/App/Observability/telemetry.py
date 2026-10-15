"""Small allowlisted ingestion endpoint for NexoraCode usage statistics."""

from __future__ import annotations

from contextlib import contextmanager
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, jsonify, request


telemetry_bp = Blueprint(
    "nexoracode_telemetry",
    __name__,
    url_prefix="/api/nexoracode/telemetry",
)
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
_DATA_DIR = Path(__file__).resolve().parents[3] / "data"
_DATABASE_PATH = _DATA_DIR / "nexoracode_telemetry.sqlite3"


def _open_database() -> sqlite3.Connection:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(_DATABASE_PATH, timeout=5)
    connection.execute("PRAGMA busy_timeout = 5000")

    return connection


@contextmanager
def _database_connection():
    """Create the aggregate tables, commit one update and always close SQLite."""
    connection = _open_database()

    try:
        with connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS nexoracode_daily_activity (
                    installation_id TEXT NOT NULL,
                    day_utc TEXT NOT NULL,
                    active_seconds INTEGER NOT NULL DEFAULT 0,
                    provider_errors INTEGER NOT NULL DEFAULT 0,
                    tool_errors INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (installation_id, day_utc)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS nexoracode_daily_errors (
                    installation_id TEXT NOT NULL,
                    day_utc TEXT NOT NULL,
                    category TEXT NOT NULL,
                    error_type TEXT NOT NULL,
                    error_count INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (installation_id, day_utc, category, error_type)
                )
                """
            )
            yield connection
    finally:
        connection.close()


def _record_activity(installation_id: str, day_utc: str, active_seconds: int) -> None:
    with _database_connection() as connection:
        connection.execute(
            """
            INSERT INTO nexoracode_daily_activity (
                installation_id, day_utc, active_seconds
            ) VALUES (?, ?, ?)
            ON CONFLICT(installation_id, day_utc) DO UPDATE SET
                active_seconds = MIN(86400, active_seconds + excluded.active_seconds)
            """,
            (installation_id, day_utc, active_seconds),
        )


def _record_error(
    installation_id: str,
    day_utc: str,
    category: str,
    error_type: str,
) -> None:
    count_column = "provider_errors" if category == "provider" else "tool_errors"

    with _database_connection() as connection:
        connection.execute(
            f"""
            INSERT INTO nexoracode_daily_activity (
                installation_id, day_utc, {count_column}
            ) VALUES (?, ?, 1)
            ON CONFLICT(installation_id, day_utc) DO UPDATE SET
                {count_column} = MIN(10000, {count_column} + 1)
            """,
            (installation_id, day_utc),
        )
        connection.execute(
            """
            INSERT INTO nexoracode_daily_errors (
                installation_id, day_utc, category, error_type, error_count
            ) VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(installation_id, day_utc, category, error_type) DO UPDATE SET
                error_count = MIN(10000, error_count + 1)
            """,
            (installation_id, day_utc, category, error_type),
        )


@telemetry_bp.route("/events", methods=["POST"])
def receive_nexoracode_event():
    """Accept only daily activity increments and sanitized provider/tool error types."""
    if request.content_length is None or request.content_length > 1024:
        return jsonify({"success": False}), 413

    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return jsonify({"success": False}), 400

    installation_id = payload.get("installation_id")

    if not isinstance(installation_id, str) or not _INSTALLATION_ID_PATTERN.fullmatch(installation_id):
        return jsonify({"success": False}), 400

    event_type = payload.get("event_type")
    day_utc = datetime.now(timezone.utc).date().isoformat()

    if event_type == "activity":
        if set(payload) != {"installation_id", "event_type", "active_seconds"}:
            return jsonify({"success": False}), 400

        active_seconds = payload.get("active_seconds")

        if type(active_seconds) is not int or not 1 <= active_seconds <= 60:
            return jsonify({"success": False}), 400

        _record_activity(installation_id, day_utc, active_seconds)

        return jsonify({"success": True}), 201

    if event_type == "error":
        if set(payload) != {"installation_id", "event_type", "error_category", "error_type"}:
            return jsonify({"success": False}), 400

        category = payload.get("error_category")
        error_type = payload.get("error_type")

        if (
            not isinstance(category, str)
            or category not in {"provider", "tool"}
            or not isinstance(error_type, str)
            or error_type not in _ERROR_TYPES
        ):
            return jsonify({"success": False}), 400

        _record_error(installation_id, day_utc, category, error_type)

        return jsonify({"success": True}), 201

    return jsonify({"success": False}), 400
