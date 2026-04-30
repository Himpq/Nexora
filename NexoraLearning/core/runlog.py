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
from typing import Any, Mapping, Optional

_LOCK = threading.RLock()
_LOG_PATH: Optional[Path] = None
_MODEL_LOG_PATH: Optional[Path] = None


def init_run_logger(cfg: Mapping[str, Any]) -> str:
    """初始化本次启动日志文件并返回文件路径。"""
    global _LOG_PATH, _MODEL_LOG_PATH
    data_dir = Path(str((cfg or {}).get("data_dir") or "data"))
    logs_dir = data_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    _LOG_PATH = logs_dir / f"server_{ts}.log"
    _MODEL_LOG_PATH = logs_dir / f"models_{ts}.log"
    with _LOCK:
        _LOG_PATH.write_text("", encoding="utf-8")
        _MODEL_LOG_PATH.write_text("", encoding="utf-8")
    log_event(
        "server_start",
        "NexoraLearning server started",
        payload={"log_file": str(_LOG_PATH)},
        content="",
    )
    return str(_LOG_PATH)


def log_event(event_type: str, title: str, *, payload: Optional[Mapping[str, Any]] = None, content: str = "") -> None:
    """写入结构化事件日志。"""
    path = _LOG_PATH
    if path is None:
        return
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    payload_text = _to_json(payload or {})
    body = str(content or "")
    lines = [
        "\n" + "=" * 32 + " NEXORALEARNING EVENT BEGIN " + "=" * 32,
        f"TIME: {now}",
        f"TYPE: {event_type}",
        f"TITLE: {title}",
        "-" * 84,
        "[PAYLOAD]",
        payload_text,
        "-" * 84,
        "[CONTENT]",
        body,
        "=" * 34 + " NEXORALEARNING EVENT END " + "=" * 34,
        "",
    ]
    with _LOCK:
        with path.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(lines))


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


def _to_json(data: Mapping[str, Any]) -> str:
    try:
        return json.dumps(dict(data), ensure_ascii=False, indent=2)
    except Exception:
        return json.dumps({"_raw": str(data)}, ensure_ascii=False, indent=2)
