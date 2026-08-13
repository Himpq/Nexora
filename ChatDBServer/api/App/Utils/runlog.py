from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

_LOCK = threading.RLock()
_LOG_PATH: Optional[Path] = None
_STRUCTURED_LOG_PATH: Optional[Path] = None
_LOG_FILE_PATTERNS = ("server_*.log", "events_*.jsonl")
_MIN_LOG_RETENTION_COUNT = 2


def init_run_logger(config: Mapping[str, Any], *, service_name: str = "ChatDB") -> str:
    global _LOG_PATH, _STRUCTURED_LOG_PATH

    data_dir = Path(str((config or {}).get("data_dir") or "data"))
    logs_dir = data_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    _LOG_PATH = logs_dir / f"server_{timestamp}.log"
    _STRUCTURED_LOG_PATH = logs_dir / f"events_{timestamp}.jsonl"

    with _LOCK:
        _LOG_PATH.write_text("", encoding="utf-8")
        _STRUCTURED_LOG_PATH.write_text("", encoding="utf-8")
        _prune_old_log_files(
            logs_dir,
            _resolve_log_retention_count(config),
            protected_paths=(_LOG_PATH, _STRUCTURED_LOG_PATH),
        )

    log_event(
        "server_start",
        f"{service_name} server started",
        payload={
            "service": service_name,
            "log_file": str(_LOG_PATH),
            "events_file": str(_STRUCTURED_LOG_PATH),
        },
    )
    return str(_LOG_PATH)


def _resolve_log_retention_count(config: Mapping[str, Any]) -> int:
    raw_count = (config or {}).get("log_retention_count", 5)

    try:
        count = int(raw_count)
    except (TypeError, ValueError) as exc:
        raise ValueError("log_retention_count must be an integer") from exc

    if count < _MIN_LOG_RETENTION_COUNT:
        raise ValueError(f"log_retention_count must be >= {_MIN_LOG_RETENTION_COUNT}")

    return count


def _prune_old_log_files(
    logs_dir: Path,
    retention_count: int,
    *,
    protected_paths: tuple[Path, ...],
) -> None:
    protected = {item.resolve() for item in protected_paths}
    candidates: List[Path] = []

    for pattern in _LOG_FILE_PATTERNS:
        candidates.extend(path for path in logs_dir.glob(pattern) if path.is_file())

    unique_candidates = {path.resolve(): path for path in candidates}
    ordered = sorted(
        unique_candidates.values(),
        key=lambda path: (path.stat().st_mtime_ns, path.name),
        reverse=True,
    )

    for path in ordered[retention_count:]:
        if path.resolve() in protected:
            continue

        path.unlink()


def log_event(
    event_type: str,
    title: str,
    *,
    payload: Optional[Mapping[str, Any]] = None,
    content: str = "",
    source: str = "",
) -> None:
    path = _LOG_PATH

    if path is None:
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    payload_dict = _safe_mapping(payload)
    event_source = str(source or payload_dict.get("source") or "").strip()
    content_text = str(content or "")
    payload_text = _to_json(payload_dict)
    lines = [
        f"> {now} {event_type} {title}",
        f"> SOURCE: {event_source or '-'}",
        f"> PAYLOAD: {payload_text}",
    ]

    if content_text:
        lines.append(content_text)

    lines.append("")

    with _LOCK:
        with path.open("a", encoding="utf-8") as handle:
            handle.write("\n".join(lines))

    _write_structured_record(
        {
            "kind": "event",
            "timestamp": now,
            "event_type": str(event_type or "").strip(),
            "title": str(title or "").strip(),
            "source": event_source,
            "payload": payload_dict,
            "content": content_text,
        }
    )


def append_log_text(text: str, *, source: str = "") -> None:
    path = _LOG_PATH

    if path is None:
        return

    body = str(text or "")
    if not body:
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    prefix = f"[{now}]"
    if source:
        prefix = f"{prefix} [{source}]"

    with _LOCK:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"{prefix} {body.rstrip()}\n")


def _safe_mapping(value: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    if not isinstance(value, Mapping):
        return {}

    return {str(key): _safe_json_value(item) for key, item in dict(value).items()}


def _safe_json_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _safe_json_value(item) for key, item in value.items()}

    if isinstance(value, (list, tuple)):
        return [_safe_json_value(item) for item in value]

    try:
        json.dumps(value, ensure_ascii=False)
        return value
    except Exception:
        return str(value)


def _to_json(data: Mapping[str, Any]) -> str:
    return json.dumps(_safe_mapping(data), ensure_ascii=False, separators=(",", ":"))


def _write_structured_record(record: Mapping[str, Any]) -> None:
    path = _STRUCTURED_LOG_PATH

    if path is None:
        return

    payload = _safe_mapping(record)
    with _LOCK:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
