"""运行日志工具。

说明：
1. 每次服务启动创建一个新日志文件：data/logs/server_YYYYMMDD_HHMMSS.log
2. 不做请求级访问日志，仅记录关键业务事件。
3. 所有日志均使用 UTF-8 编码。
"""

from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

_MODEL_SOURCES = {
    "rough_reading",
    "intensive_reading",
    "split_chapters",
    "question_generation",
    "memory",
    "profile_question",
}

_LOCK = threading.RLock()
_LOG_PATH: Optional[Path] = None
_MODEL_LOG_PATH: Optional[Path] = None
_STRUCTURED_LOG_PATH: Optional[Path] = None


def init_run_logger(cfg: Mapping[str, Any]) -> str:
    """初始化本次启动日志文件并返回文件路径。"""
    global _LOG_PATH, _MODEL_LOG_PATH, _STRUCTURED_LOG_PATH
    data_dir = Path(str((cfg or {}).get("data_dir") or "data"))
    logs_dir = data_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    _LOG_PATH = logs_dir / f"server_{ts}.log"
    _MODEL_LOG_PATH = logs_dir / f"models_{ts}.log"
    _STRUCTURED_LOG_PATH = logs_dir / f"events_{ts}.jsonl"
    with _LOCK:
        _LOG_PATH.write_text("", encoding="utf-8")
        _MODEL_LOG_PATH.write_text("", encoding="utf-8")
        _STRUCTURED_LOG_PATH.write_text("", encoding="utf-8")
    log_event(
        "server_start",
        "NexoraLearning server started",
        payload={"log_file": str(_LOG_PATH)},
        content="",
    )
    return str(_LOG_PATH)


def log_event(event_type: str, title: str, *, payload: Optional[Mapping[str, Any]] = None, content: str = "") -> None:
    """写入简化结构化事件日志。"""
    path = _LOG_PATH
    if path is None:
        return
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    payload_dict = dict(payload or {})
    payload_text = _to_json(payload_dict)
    body = str(content or "")
    lines = [f"> {now} {event_type} {title}", f"> PAYLOAD: {payload_text}"]
    if body:
        lines.append(body)
    lines.append("")
    with _LOCK:
        with path.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(lines))
    _write_structured_record(
        {
            "kind": "event",
            "timestamp": now,
            "event_type": str(event_type or "").strip(),
            "title": str(title or "").strip(),
            "source": str(payload_dict.get("source") or payload_dict.get("model_key") or "").strip(),
            "payload": payload_dict,
            "content": body,
        }
    )


def log_tool_flow(
    *,
    tool_name: str,
    arguments: Mapping[str, Any],
    tool_output: Any,
    model_output: str = "",
    source: str = "",
) -> None:
    """按固定格式记录工具调用与模型回合输出。"""
    path = _LOG_PATH
    if path is None:
        return
    args_text = _to_json(arguments or {})
    output_text = _to_json(tool_output or {})
    model_text = str(model_output or "")
    lines = [
        f"> {tool_name}({args_text})",
        output_text,
        f">>> {model_text}",
        "",
    ]
    with _LOCK:
        with path.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(lines))
    _write_structured_record(
        {
            "kind": "tool_flow",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source": str(source or "").strip(),
            "tool_name": str(tool_name or "").strip(),
            "arguments": _safe_json_value(arguments),
            "tool_output": _safe_json_value(tool_output),
            "model_output": model_text,
        }
    )


def append_log_text(text: str) -> None:
    """向当前日志文件直接追加原始文本（无额外事件包裹）。"""
    path = _LOG_PATH
    if path is None:
        return
    body = str(text or "")
    if not body:
        return
    with _LOCK:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(body)


def log_model_text(text: str, *, source: str = "") -> None:
    """仅记录模型文本输出到 models.log，并将 \\n 转义还原为真实换行。"""
    path = _MODEL_LOG_PATH
    if path is None:
        return
    raw = str(text or "")
    if not raw.strip():
        return
    normalized = raw.replace("\\r\\n", "\n").replace("\\n", "\n")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    head = f"\n[{now}] {source or 'model'}\n"
    with _LOCK:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(head)
            fh.write(normalized)
            if not normalized.endswith("\n"):
                fh.write("\n")
    _write_structured_record(
        {
            "kind": "model_text",
            "timestamp": now,
            "source": str(source or "").strip(),
            "content": normalized,
        }
    )


def list_structured_logs(
    cfg: Mapping[str, Any],
    *,
    limit: int = 200,
    category: str = "",
    source: str = "",
) -> List[Dict[str, Any]]:
    data_dir = Path(str((cfg or {}).get("data_dir") or "data"))
    logs_dir = data_dir / "logs"
    if not logs_dir.exists():
        return []
    wanted_source = str(source or "").strip().lower()
    wanted_category = str(category or "").strip().lower()
    target_limit = max(1, min(1000, int(limit or 200)))
    rows: List[Dict[str, Any]] = []
    for path in sorted(logs_dir.glob("events_*.jsonl"), reverse=True):
        try:
            file_lines = path.read_text(encoding="utf-8").splitlines()
        except Exception:
            continue
        for raw_line in reversed(file_lines):
            raw_line = str(raw_line or "").strip()
            if not raw_line:
                continue
            try:
                record = json.loads(raw_line)
            except Exception:
                continue
            if not isinstance(record, dict):
                continue
            record_source = str(record.get("source") or "").strip().lower()
            if wanted_category and not _record_matches_category(record, wanted_category):
                continue
            if wanted_source and record_source != wanted_source:
                continue
            rows.append(record)
            if len(rows) >= target_limit:
                return rows
    return rows


def available_log_sources(cfg: Mapping[str, Any], *, limit: int = 1000, category: str = "model") -> List[str]:
    rows = list_structured_logs(cfg, limit=limit, category=category)
    sources: List[str] = []
    seen = set()
    for row in rows:
        source = str((row or {}).get("source") or "").strip()
        if not source or source in seen:
            continue
        seen.add(source)
        sources.append(source)
    return sources


def _to_json(data: Mapping[str, Any]) -> str:
    try:
        return json.dumps(dict(data), ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return json.dumps({"_raw": str(data)}, ensure_ascii=False, separators=(",", ":"))


def _safe_json_value(value: Any) -> Any:
    try:
        json.dumps(value, ensure_ascii=False)
        return value
    except Exception:
        return str(value)


def _record_matches_category(record: Mapping[str, Any], category: str) -> bool:
    wanted = str(category or "").strip().lower()
    if not wanted or wanted == "all":
        return True
    if wanted == "model":
        return _is_model_record(record)
    if wanted == "error":
        return _is_error_record(record)
    return True


def _is_model_record(record: Mapping[str, Any]) -> bool:
    kind = str(record.get("kind") or "").strip().lower()
    source = str(record.get("source") or "").strip().lower()
    if source in _MODEL_SOURCES:
        return True
    if kind in {"tool_flow", "model_text"} and bool(source):
        return True
    return False


def _is_error_record(record: Mapping[str, Any]) -> bool:
    kind = str(record.get("kind") or "").strip().lower()
    title = str(record.get("title") or record.get("event_type") or "").strip().lower()
    content = str(record.get("content") or "").strip().lower()
    model_output = str(record.get("model_output") or "").strip().lower()
    source = str(record.get("source") or "").strip().lower()
    payload_text = _to_json(record.get("payload") if isinstance(record.get("payload"), Mapping) else {}).lower()
    tool_output_text = json.dumps(record.get("tool_output"), ensure_ascii=False).lower() if record.get("tool_output") is not None else ""
    combined = "\n".join([kind, title, content, model_output, payload_text, tool_output_text, source])
    keywords = ["error", "failed", "failure", "exception", "traceback", "错误", "失败", "异常"]
    if any(word in combined for word in keywords):
        return True
    tool_output = record.get("tool_output")
    if isinstance(tool_output, Mapping) and tool_output.get("ok") is False:
        return True
    payload = record.get("payload")
    if isinstance(payload, Mapping) and payload.get("ok") is False:
        return True
    return False


def _write_structured_record(record: Mapping[str, Any]) -> None:
    path = _STRUCTURED_LOG_PATH
    if path is None:
        return
    payload = dict(record or {})
    with _LOCK:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
