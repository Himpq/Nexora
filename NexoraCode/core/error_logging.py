"""Persistent error logging for the NexoraCode desktop process."""

from __future__ import annotations

import logging
import re
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path
from types import TracebackType


_MAX_ERROR_CHARS = 8000
_LOG_FILE_NAME = "nexoracode-errors.log"
_CONFIGURED_LOG_PATH: Path | None = None

_BEARER_PATTERN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
_SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|agent[_-]?token|token|password|secret|authorization)\b\s*[=:]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)"
)


def _log_file_path() -> Path:
    if getattr(sys, "frozen", False):
        app_root = Path(sys.executable).resolve().parent
    else:
        app_root = Path(__file__).resolve().parents[1]

    return app_root / "data" / "logs" / _LOG_FILE_NAME


def _redact_log_text(value: object) -> str:
    text = str(value or "")
    text = _BEARER_PATTERN.sub("Bearer [REDACTED]", text)
    text = _SECRET_ASSIGNMENT_PATTERN.sub(r"\1[REDACTED]", text)

    return text[:_MAX_ERROR_CHARS]


class _RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return _redact_log_text(super().format(record))


def _log_uncaught_exception(
    exc_type: type[BaseException],
    exc_value: BaseException,
    exc_traceback: TracebackType | None,
) -> None:
    if issubclass(exc_type, (KeyboardInterrupt, SystemExit)):
        if sys.stderr is not None:
            sys.__excepthook__(exc_type, exc_value, exc_traceback)

        return

    logging.getLogger("NexoraCode.uncaught").critical(
        "Uncaught main-thread exception",
        exc_info=(exc_type, exc_value, exc_traceback),
    )

    if sys.stderr is not None:
        sys.__excepthook__(exc_type, exc_value, exc_traceback)


def _log_uncaught_thread_exception(args: threading.ExceptHookArgs) -> None:
    if issubclass(args.exc_type, SystemExit):
        return

    thread_name = args.thread.name if args.thread else "unknown"
    logging.getLogger("NexoraCode.uncaught").critical(
        "Uncaught exception in thread %s",
        thread_name,
        exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
    )

    if sys.stderr is not None:
        threading.__excepthook__(args)


def _log_unraisable_exception(args: sys.UnraisableHookArgs) -> None:
    logging.getLogger("NexoraCode.uncaught").error(
        "Unraisable exception",
        exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
    )

    if sys.stderr is not None:
        sys.__unraisablehook__(args)


def configure_error_logging() -> Path:
    """Install a rotating file handler and process-wide exception hooks."""
    global _CONFIGURED_LOG_PATH

    if _CONFIGURED_LOG_PATH is not None:
        return _CONFIGURED_LOG_PATH

    log_path = _log_file_path()
    log_path.parent.mkdir(parents=True, exist_ok=True)

    handler = RotatingFileHandler(
        log_path,
        maxBytes=4 * 1024 * 1024,
        backupCount=4,
        encoding="utf-8",
        errors="backslashreplace",
    )
    handler.setLevel(logging.ERROR)
    handler.setFormatter(_RedactingFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.ERROR)
    root_logger.addHandler(handler)

    sys.excepthook = _log_uncaught_exception
    threading.excepthook = _log_uncaught_thread_exception
    sys.unraisablehook = _log_unraisable_exception

    _CONFIGURED_LOG_PATH = log_path

    return log_path


def write_frontend_error(kind: object, message: object) -> dict[str, object]:
    """Persist a sanitized Vue or browser runtime error from the WebView."""
    safe_kind = _redact_log_text(kind).strip()[:120] or "frontend"
    safe_message = _redact_log_text(message).strip()

    if not safe_message:
        return {"success": False, "message": "empty error message"}

    logging.getLogger("NexoraCode.frontend").error("[%s] %s", safe_kind, safe_message)

    return {"success": True}
