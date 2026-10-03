"""管理员只读内存诊断接口。"""

import collections
import ctypes
import gc
import os
import platform
import re
import sys
import threading
import tracemalloc
from datetime import datetime, timezone

from flask import Blueprint, jsonify

from basis.Permission import require_admin


memory_diagnostics_bp = Blueprint("memory_diagnostics", __name__)

_PROC_STATUS_FIELDS = {
    "VmPeak",
    "VmSize",
    "VmHWM",
    "VmRSS",
    "RssAnon",
    "RssFile",
    "RssShmem",
    "VmSwap",
    "Threads",
}
_SMAPS_FIELDS = {
    "Rss",
    "Pss",
    "Private_Clean",
    "Private_Dirty",
    "Anonymous",
    "Swap",
}
_MAP_HEADER = re.compile(r"^([0-9a-fA-F]+)-([0-9a-fA-F]+)\s+")
_BUILTIN_CONTAINER_TYPES = (dict, list, set, tuple, frozenset)


class _Mallinfo2(ctypes.Structure):
    """glibc malloc statistics structure returned by mallinfo2()."""

    _fields_ = [
        ("arena", ctypes.c_size_t),
        ("ordblks", ctypes.c_size_t),
        ("smblks", ctypes.c_size_t),
        ("hblks", ctypes.c_size_t),
        ("hblkhd", ctypes.c_size_t),
        ("usmblks", ctypes.c_size_t),
        ("fsmblks", ctypes.c_size_t),
        ("uordblks", ctypes.c_size_t),
        ("fordblks", ctypes.c_size_t),
        ("keepcost", ctypes.c_size_t),
    ]


def _parse_proc_fields(text, allowed_fields):
    """Parse numeric kB counters from Linux procfs text without retaining it."""
    result = {}

    for line in text.splitlines():
        name, separator, raw_value = line.partition(":")

        if not separator or name not in allowed_fields:
            continue

        parts = raw_value.split()

        if parts and parts[0].isdigit():
            result[name] = int(parts[0])

    return result


def _parse_anonymous_mappings(text):
    """Summarize anonymous resident mappings, returning sizes but no addresses."""
    mappings = []
    current = None
    total_rss_kb = 0

    def save_current():
        nonlocal total_rss_kb

        if current is None or current["rss_kb"] <= 0:
            return

        total_rss_kb += current["rss_kb"]

        if current["rss_kb"] > 0:
            mappings.append(dict(current))

    for line in text.splitlines():
        match = _MAP_HEADER.match(line)

        if match:
            save_current()
            start, end = (int(value, 16) for value in match.groups())
            fields = line.split(maxsplit=5)
            label = fields[5] if len(fields) > 5 else ""
            is_anonymous = (
                not label
                or label == "[heap]"
                or label.startswith("[anon")
                or label.startswith("[stack")
            )

            if is_anonymous:
                if label == "[heap]":
                    kind = "heap"
                elif label.startswith("[stack"):
                    kind = "stack"
                else:
                    kind = "anonymous"

                current = {
                    "kind": kind,
                    "virtual_kb": (end - start) // 1024,
                    "rss_kb": 0,
                    "anonymous_kb": 0,
                    "swap_kb": 0,
                }
            else:
                current = None

            continue

        if current is None:
            continue

        name, separator, raw_value = line.partition(":")

        if not separator or name not in {"Rss", "Anonymous", "Swap"}:
            continue

        parts = raw_value.split()

        if not parts or not parts[0].isdigit():
            continue

        metric_name = {
            "Rss": "rss_kb",
            "Anonymous": "anonymous_kb",
            "Swap": "swap_kb",
        }[name]
        current[metric_name] = int(parts[0])

    save_current()
    mappings.sort(key=lambda item: item["rss_kb"], reverse=True)

    return {
        "count": len(mappings),
        "rss_kb": total_rss_kb,
        "top": mappings[:12],
    }


def _read_proc_memory():
    """Read the current Linux process memory counters from procfs."""
    with open("/proc/self/status", "r", encoding="ascii") as file:
        status = _parse_proc_fields(file.read(), _PROC_STATUS_FIELDS)

    with open("/proc/self/smaps_rollup", "r", encoding="ascii") as file:
        smaps_rollup = _parse_proc_fields(file.read(), _SMAPS_FIELDS)

    with open("/proc/self/smaps", "r", encoding="ascii") as file:
        anonymous_mappings = _parse_anonymous_mappings(file.read())

    return {
        "status_kb": status,
        "smaps_rollup_kb": smaps_rollup,
        "anonymous_mappings": anonymous_mappings,
    }


def _read_glibc_malloc_stats():
    """Read glibc allocator totals; these are not Python-object byte counts."""
    libc_name, libc_version = platform.libc_ver()

    if libc_name != "glibc":
        return {
            "available": False,
            "libc": libc_name or "unknown",
            "version": libc_version or "unknown",
        }

    libc = ctypes.CDLL(None)
    mallinfo2 = libc.mallinfo2
    mallinfo2.argtypes = []
    mallinfo2.restype = _Mallinfo2
    stats = mallinfo2()

    return {
        "available": True,
        "libc": libc_name,
        "version": libc_version,
        "arena_bytes": int(stats.arena),
        "allocated_bytes": int(stats.uordblks),
        "free_bytes": int(stats.fordblks),
        "free_fastbin_bytes": int(stats.fsmblks),
        "mmap_region_count": int(stats.hblks),
        "mmap_bytes": int(stats.hblkhd),
        "releasable_top_bytes": int(stats.keepcost),
    }


def _summarize_gc_objects():
    """Count GC-tracked types and shallow built-in container sizes only."""
    objects = gc.get_objects()
    counts = collections.Counter()
    shallow_bytes = collections.Counter()

    for value in objects:
        value_type = type(value)
        type_name = f"{value_type.__module__}.{value_type.__qualname__}"
        counts[type_name] += 1

        if value_type in _BUILTIN_CONTAINER_TYPES:
            shallow_bytes[type_name] += sys.getsizeof(value)

    top_types = [
        {"type": type_name, "count": count}
        for type_name, count in counts.most_common(20)
    ]
    top_containers = [
        {"type": type_name, "shallow_bytes": size}
        for type_name, size in shallow_bytes.most_common(20)
    ]

    return {
        "tracked_object_count": len(objects),
        "top_types_by_count": top_types,
        "top_builtin_containers_by_shallow_bytes": top_containers,
    }


def _find_module_attribute(module_names, attribute_name):
    for module_name in module_names:
        module = sys.modules.get(module_name)

        if module is None:
            continue

        value = vars(module).get(attribute_name)

        if isinstance(value, _BUILTIN_CONTAINER_TYPES):
            return module_name, value

    return None, None


def _summarize_application_caches():
    """Return container counts only; never serialize cached values or user data."""
    specs = [
        (("__main__", "server"), "JS_BUNDLE_CACHE"),
        (("__main__", "server"), "_UPLOAD_TASKS"),
        (("__main__", "server"), "_BROWSER_WS_CLIENTS"),
        (("__main__", "server"), "_PUBLIC_KNOWLEDGE_WS_CLIENTS"),
        (("__main__", "server"), "_NEXORACODE_PROJECT_TREE_CACHE"),
        (("__main__", "server"), "_PROVIDER_MODELS_CACHE"),
        (("__main__", "server"), "_BROWSER_OLLAMA_STATUS_CACHE"),
        (("__main__", "server"), "_CLIENT_CACHE"),
        (("App.Core.model",), "_CLIENT_CACHE"),
        (("App.Agent.agent_tunnel",), "_ACTIVE_AGENTS"),
        (("App.Agent.agent_tunnel",), "_PENDING_TASKS"),
    ]
    cache_counts = {}

    for module_names, attribute_name in specs:
        module_name, value = _find_module_attribute(module_names, attribute_name)

        if value is not None:
            cache_counts[f"{module_name}.{attribute_name}"] = len(value)

    stream_module_name, sessions = _find_module_attribute(
        ("App.Core.stream_runtime",), "_SESSIONS"
    )

    if sessions is not None:
        lock = vars(sys.modules[stream_module_name]).get("_SESSIONS_LOCK")

        if lock is not None:
            with lock:
                session_count = len(sessions)
                chunk_count = sum(
                    len(session.get("chunks") or [])
                    for session in sessions.values()
                    if isinstance(session, dict)
                )
                running_count = sum(
                    1
                    for session in sessions.values()
                    if isinstance(session, dict)
                    and session.get("status") in {"running", "cancelling"}
                )
        else:
            session_count = len(sessions)
            chunk_count = 0
            running_count = 0

        cache_counts[f"{stream_module_name}._SESSIONS"] = {
            "sessions": session_count,
            "running_sessions": running_count,
            "chunks": chunk_count,
        }

    return cache_counts


def _summarize_tracemalloc():
    if not tracemalloc.is_tracing():
        return {"enabled": False}

    current_bytes, peak_bytes = tracemalloc.get_traced_memory()
    snapshot = tracemalloc.take_snapshot()
    snapshot = snapshot.filter_traces((
        tracemalloc.Filter(
            inclusive=False,
            filename_pattern="*memory_diagnostics.py",
        ),
    ))
    top_allocations = []

    for statistic in snapshot.statistics("traceback")[:10]:
        frames = [
            {
                "file": os.path.basename(frame.filename),
                "line": frame.lineno,
            }
            for frame in statistic.traceback[-3:]
        ]
        top_allocations.append({
            "size_bytes": statistic.size,
            "block_count": statistic.count,
            "frames": frames,
        })

    return {
        "enabled": True,
        "current_bytes": current_bytes,
        "peak_bytes": peak_bytes,
        "top_live_allocations_since_tracing_started": top_allocations,
    }


def _build_memory_report():
    return {
        "success": True,
        "captured_at_utc": datetime.now(timezone.utc).isoformat(),
        "process": {
            "pid": os.getpid(),
            "python_version": platform.python_version(),
            "loaded_module_count": len(sys.modules),
            "allocated_python_blocks": sys.getallocatedblocks(),
            "python_thread_count": threading.active_count(),
            "memory": _read_proc_memory(),
            "glibc_malloc": _read_glibc_malloc_stats(),
        },
        "python_gc": {
            "enabled": gc.isenabled(),
            "generation_counts": gc.get_count(),
            "generation_stats": gc.get_stats(),
            "objects": _summarize_gc_objects(),
        },
        "application_container_counts": _summarize_application_caches(),
        "loaded_optional_modules": [
            name
            for name in (
                "torch",
                "transformers",
                "sentence_transformers",
                "chromadb",
                "numpy",
                "onnxruntime",
            )
            if name in sys.modules
        ],
        "tracemalloc": _summarize_tracemalloc(),
    }


def _no_store_json(payload, status_code=200):
    response = jsonify(payload)
    response.status_code = status_code
    response.headers["Cache-Control"] = "no-store"
    return response


@memory_diagnostics_bp.route("/api/admin/diagnostics/memory", methods=["GET"])
@require_admin
def get_memory_diagnostics():
    """Return process memory counters, safe object counts and cache sizes."""
    return _no_store_json(_build_memory_report())


@memory_diagnostics_bp.route(
    "/api/admin/diagnostics/memory/tracemalloc/start",
    methods=["POST"],
)
@require_admin
def start_memory_tracing():
    """Start temporary Python allocation tracing after explicit admin action."""
    if tracemalloc.is_tracing():
        return _no_store_json({"success": True, "already_enabled": True})

    tracemalloc.start(5)
    return _no_store_json({
        "success": True,
        "enabled": True,
        "note": "仅跟踪启用后的 Python 分配，不包含此前已分配的内存。",
    })


@memory_diagnostics_bp.route(
    "/api/admin/diagnostics/memory/tracemalloc/stop",
    methods=["POST"],
)
@require_admin
def stop_memory_tracing():
    """Stop temporary allocation tracing and release its snapshots."""
    if not tracemalloc.is_tracing():
        return _no_store_json({"success": True, "already_disabled": True})

    current_bytes, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return _no_store_json({
        "success": True,
        "enabled": False,
        "last_current_bytes": current_bytes,
        "last_peak_bytes": peak_bytes,
    })
