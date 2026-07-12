"""
Generic process manager for processes started by NexoraCode.
"""

import subprocess
import threading
import time
import uuid
from pathlib import Path

from core.config import config


_PROCESS_LOCK = threading.RLock()
_PROCESSES: dict[str, dict] = {}
_DANGEROUS_COMMAND_PARTS = (
    "rm -rf /",
    "del /s /q c:\\",
    "format c:",
    ":(){ :|: & };:",
    "dd if=/dev/",
)
_DEFAULT_OUTPUT_LIMIT = 20000
_MAX_OUTPUT_LIMIT = 200000


def local_process_manager(
    action: str,
    process_id: str = "",
    command: str = "",
    cwd: str = "",
    timeout: int = 0,
    encoding: str = "utf-8",
    max_output_chars: int = None,
    grace_seconds: int = 5,
) -> dict:
    normalized_action = str(action or "").strip().lower()

    if normalized_action == "start":
        return _start_process(command, cwd, timeout, encoding)

    if normalized_action == "list":
        return _list_processes()

    if normalized_action == "status":
        return _process_status(process_id)

    if normalized_action == "read":
        return _read_process_output(process_id, max_output_chars)

    if normalized_action == "stop":
        return _stop_process(process_id, grace_seconds)

    return {
        "success": False,
        "error": "action must be start, list, status, read, or stop.",
    }


def _start_process(command: str, cwd: str, timeout: int, encoding: str) -> dict:
    clean_command = str(command or "").strip()

    if not clean_command:
        return {"success": False, "error": "command is required."}

    lower_command = clean_command.lower()

    for marker in _DANGEROUS_COMMAND_PARTS:
        if marker in lower_command:
            return {"success": False, "error": f"Command blocked by security policy: {marker}"}

    whitelist = config.get("shell_whitelist", []) or []

    if whitelist and not any(clean_command.startswith(str(prefix or "")) for prefix in whitelist):
        return {
            "success": False,
            "error": f"Command not in whitelist. Allowed prefixes: {whitelist}",
        }

    work_dir = Path(str(cwd or Path.home())).resolve()

    if not work_dir.exists():
        return {"success": False, "error": f"cwd not found: {work_dir}"}

    if not work_dir.is_dir():
        return {"success": False, "error": f"cwd is not a directory: {work_dir}"}

    process_id = f"proc_{uuid.uuid4().hex[:10]}"

    try:
        proc = subprocess.Popen(
            clean_command,
            shell=True,
            cwd=str(work_dir),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=False,
        )
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    record = {
        "id": process_id,
        "pid": proc.pid,
        "command": clean_command,
        "cwd": str(work_dir),
        "encoding": str(encoding or "utf-8"),
        "created_at": time.time(),
        "updated_at": time.time(),
        "timeout": _coerce_timeout(timeout),
        "process": proc,
        "output": bytearray(),
        "output_offset": 0,
        "reader_done": False,
    }

    with _PROCESS_LOCK:
        _PROCESSES[process_id] = record

    reader = threading.Thread(target=_read_process_stream, args=(process_id,), daemon=True)
    reader.start()
    record["reader"] = reader

    return {
        "success": True,
        "process_id": process_id,
        "pid": proc.pid,
        "status": "running",
        "command": clean_command,
        "cwd": str(work_dir),
    }


def _read_process_stream(process_id: str) -> None:
    with _PROCESS_LOCK:
        record = _PROCESSES.get(process_id)

    if not record:
        return

    proc = record.get("process")

    if not proc or not proc.stdout:
        return

    try:
        while True:
            chunk = proc.stdout.read(4096)

            if not chunk:
                break

            with _PROCESS_LOCK:
                current = _PROCESSES.get(process_id)

                if not current:
                    return

                current["output"].extend(chunk)
                current["updated_at"] = time.time()
                _trim_output_buffer(current)
    finally:
        with _PROCESS_LOCK:
            current = _PROCESSES.get(process_id)

            if current:
                current["reader_done"] = True
                current["updated_at"] = time.time()


def _trim_output_buffer(record: dict) -> None:
    output = record.get("output")

    if not isinstance(output, bytearray):
        return

    if len(output) <= _MAX_OUTPUT_LIMIT:
        return

    drop_count = len(output) - _MAX_OUTPUT_LIMIT
    del output[:drop_count]
    record["output_offset"] = int(record.get("output_offset", 0) or 0) + drop_count


def _list_processes() -> dict:
    items = []

    with _PROCESS_LOCK:
        for process_id in sorted(_PROCESSES.keys()):
            items.append(_snapshot_process(_PROCESSES[process_id]))

    return {
        "success": True,
        "processes": items,
        "count": len(items),
    }


def _process_status(process_id: str) -> dict:
    record, error = _get_process_record(process_id)

    if error:
        return error

    return {
        "success": True,
        "process": _snapshot_process(record),
    }


def _read_process_output(process_id: str, max_output_chars: int) -> dict:
    record, error = _get_process_record(process_id)

    if error:
        return error

    default_limit = _coerce_output_limit(config.get("local_process_output_max_chars", _DEFAULT_OUTPUT_LIMIT))
    limit = _coerce_output_limit(max_output_chars, default_limit=default_limit)

    with _PROCESS_LOCK:
        output = bytes(record.get("output") or b"")
        encoding = str(record.get("encoding") or "utf-8")
        base_offset = int(record.get("output_offset", 0) or 0)

    text = output.decode(encoding, errors="replace")

    if len(text) > limit:
        text = text[-limit:]
        truncated = True
    else:
        truncated = False

    return {
        "success": True,
        "process_id": str(record.get("id") or ""),
        "pid": record.get("pid"),
        "status": _status_name(record),
        "returncode": _returncode(record),
        "output": text,
        "truncated": truncated,
        "buffer_start_byte": base_offset,
        "buffer_bytes": len(output),
    }


def _stop_process(process_id: str, grace_seconds: int) -> dict:
    record, error = _get_process_record(process_id)

    if error:
        return error

    proc = record.get("process")

    if not proc:
        return {"success": False, "error": "process record is invalid."}

    if proc.poll() is not None:
        return {
            "success": True,
            "process_id": str(record.get("id") or ""),
            "pid": record.get("pid"),
            "status": "exited",
            "returncode": proc.returncode,
        }

    try:
        proc.terminate()
        proc.wait(timeout=_coerce_grace_seconds(grace_seconds))
        stopped_by = "terminate"
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
        stopped_by = "kill"
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    return {
        "success": True,
        "process_id": str(record.get("id") or ""),
        "pid": record.get("pid"),
        "status": "stopped",
        "returncode": proc.returncode,
        "stopped_by": stopped_by,
    }


def _get_process_record(process_id: str) -> tuple[dict | None, dict | None]:
    clean_id = str(process_id or "").strip()

    if not clean_id:
        return None, {"success": False, "error": "process_id is required."}

    with _PROCESS_LOCK:
        record = _PROCESSES.get(clean_id)

    if not record:
        return None, {
            "success": False,
            "error": f"Unknown process_id: {clean_id}. Only processes started by local_process_manager can be managed.",
        }

    _enforce_process_timeout(record)

    return record, None


def _snapshot_process(record: dict) -> dict:
    _enforce_process_timeout(record)

    return {
        "process_id": str(record.get("id") or ""),
        "pid": record.get("pid"),
        "command": str(record.get("command") or ""),
        "cwd": str(record.get("cwd") or ""),
        "status": _status_name(record),
        "returncode": _returncode(record),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "buffer_bytes": len(record.get("output") or b""),
    }


def _status_name(record: dict) -> str:
    proc = record.get("process")

    if not proc:
        return "unknown"

    if proc.poll() is None:
        return "running"

    return "exited"


def _returncode(record: dict):
    proc = record.get("process")

    if not proc:
        return None

    return proc.poll()


def _coerce_timeout(timeout: int) -> int:
    try:
        value = int(timeout or 0)
    except (TypeError, ValueError):
        return 0

    return max(0, min(24 * 60 * 60, value))


def _coerce_output_limit(value, default_limit: int = _DEFAULT_OUTPUT_LIMIT) -> int:
    try:
        parsed = int(value if value is not None else default_limit)
    except (TypeError, ValueError):
        parsed = default_limit

    return max(1, min(_MAX_OUTPUT_LIMIT, parsed))


def _coerce_grace_seconds(value) -> int:
    try:
        parsed = int(value if value is not None else 5)
    except (TypeError, ValueError):
        parsed = 5

    return max(1, min(30, parsed))


def _enforce_process_timeout(record: dict) -> None:
    timeout = int(record.get("timeout", 0) or 0)

    if timeout <= 0:
        return

    proc = record.get("process")

    if not proc or proc.poll() is not None:
        return

    created_at = float(record.get("created_at", 0) or 0)

    if time.time() - created_at <= timeout:
        return

    try:
        proc.terminate()
    except Exception:
        pass
