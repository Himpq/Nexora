"""Append an idempotent, auditable provider-billing reconciliation."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List


USERNAME = "mujica"
MODEL = "DeepSeek-V4.1-Flash"
PROVIDER = "超算互联网"
CONVERSATION_ID = "330"

RECONCILIATIONS = (
    {
        "id": "scnet-20260920-cid330-round3-partial",
        "timestamp": "2026-09-20 17:19:00",
        "round": 3,
        "assistant_index": 231,
        "input": 102083,
        "output": 5236,
        "raw_input": 102083,
        "cached": 0,
        "provider_input": 120900,
        "provider_cached": 0,
        "provider_output": 6428,
        "provider_total": 127328,
        "replaces_estimated": 20009,
        "trace_id": "7750844af660487c89033ba5df2e81ae",
        "reason": "上游 incomplete chunked read；原日志已有 20,009 估算，补入 Provider 实际值与估算值的差额。",
    },
    {
        "id": "scnet-20260920-cid330-round4-sdk-retry",
        "timestamp": "2026-09-20 17:20:00",
        "round": 4,
        "assistant_index": 231,
        "input": 8147,
        "output": 2476,
        "raw_input": 32211,
        "cached": 24064,
        "provider_input": 8147,
        "provider_cached": 24064,
        "provider_output": 2476,
        "provider_total": 34687,
        "replaces_estimated": 0,
        "trace_id": "",
        "reason": "Provider 显示同一原始上下文的额外请求，归因于 OpenAI SDK 隐式重试。",
    },
    {
        "id": "scnet-20260920-cid330-round2-timeout",
        "timestamp": "2026-09-20 18:49:00",
        "round": 2,
        "assistant_index": 239,
        "input": 6437,
        "output": 2599,
        "raw_input": 74789,
        "cached": 68352,
        "provider_input": 6437,
        "provider_cached": 68352,
        "provider_output": 2599,
        "provider_total": 77388,
        "replaces_estimated": 0,
        "trace_id": "",
        "reason": "上游 ReadTimeout；服务器收到 832 个流事件后未收到 usage，Provider 账单确认实际消耗。",
    },
)

GLOBAL_RECONCILIATIONS = (
    {
        "id": "scnet-20260923-request-fdb758c5e2646e9c",
        "provider_request_id": "fdb758c5e2646e9c",
        "timestamp": "2026-09-23 19:11:00",
        "provider": PROVIDER,
        "model": MODEL,
        "input": 101401,
        "output": 2650,
        "provider_total": 104051,
        "reason": "Provider billing record returned HTTP 200; matching request usage is absent from the chat and PAPI usage logs.",
    },
    {
        "id": "scnet-20260925-request-0cb3dca07b4f75bd",
        "provider_request_id": "0cb3dca07b4f75bd",
        "timestamp": "2026-09-25 00:12:00",
        "provider": PROVIDER,
        "model": MODEL,
        "input": 113014,
        "raw_input": 115190,
        "cached": 2176,
        "output": 9824,
        "provider_input": 113014,
        "provider_cached": 2176,
        "provider_output": 9824,
        "provider_total": 125014,
        "reason": "Provider billing record returned HTTP 200; the 00:12 aggregate has this 125,014-token request beyond the two requests already present in chat and PAPI usage logs.",
    },
)


def _integer(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []

    rows = []

    with path.open("r", encoding="utf-8-sig") as handle:
        for line in handle:
            text = line.strip()

            if text:
                row = json.loads(text)

                if isinstance(row, dict):
                    rows.append(row)

    return rows


def _write_jsonl_atomic(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))

    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
                handle.write("\n")

        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))

    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=4)
            handle.write("\n")

        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _billing(spec: Dict[str, Any]) -> Dict[str, Any]:
    uncached = _integer(spec["raw_input"]) - _integer(spec["cached"])
    cached = _integer(spec["cached"])
    output = _integer(spec["output"])
    input_cost = Decimal(uncached) / Decimal(1000000)
    cache_cost = Decimal(cached) * Decimal("0.02") / Decimal(1000000)
    output_cost = Decimal(output) * Decimal(4) / Decimal(1000000)
    return {
        "configured": True,
        "estimated": False,
        "source": "provider_reconciliation",
        "currency": "CNY",
        "input_per_million": 1.0,
        "output_per_million": 4.0,
        "cache_hit_per_million": 0.02,
        "raw_input_tokens": _integer(spec["raw_input"]),
        "uncached_input_tokens": uncached,
        "cached_tokens": cached,
        "output_tokens": output,
        "cost": float(input_cost + cache_cost + output_cost),
        "input_cost": float(input_cost),
        "output_cost": float(output_cost),
        "cache_hit_cost": float(cache_cost),
    }


def _record(spec: Dict[str, Any]) -> Dict[str, Any]:
    record = {
        "log_id": uuid.uuid4().hex,
        "timestamp": spec["timestamp"],
        "conversation_id": CONVERSATION_ID,
        "conversation_title": "镰仓有什么玩的吗",
        "action": "billing_reconciliation",
        "input_tokens": _integer(spec["input"]),
        "output_tokens": _integer(spec["output"]),
        "total_tokens": _integer(spec["raw_input"]) + _integer(spec["output"]),
        "raw_input_tokens": _integer(spec["raw_input"]),
        "cached_input_tokens": _integer(spec["cached"]),
        "provider": PROVIDER,
        "model": MODEL,
        "source": "chat",
        "token_details": {
            "reconciliation": True,
            "estimated": False,
            "usage_source": "provider_billing",
            "raw_input_tokens": _integer(spec["raw_input"]),
            "effective_input_tokens": _integer(spec["input"]),
            "cached_tokens": _integer(spec["cached"]),
            "cached_tokens_source": "provider_billing",
            "provider_input_tokens": _integer(spec["provider_input"]),
            "provider_cached_tokens": _integer(spec["provider_cached"]),
            "provider_output_tokens": _integer(spec["provider_output"]),
            "provider_total_tokens": _integer(spec["provider_total"]),
        },
        "has_web_search": False,
        "tool_call_count": 0,
        "duration_ms": 0,
        "ttft_ms": 0,
        "output_tps": 0.0,
        "memory_analysis": False,
        "memory_job_id": "",
        "memory_action": "",
        "is_regenerate": False,
        "regenerate_index": -1,
        "round_index": _integer(spec["round"]),
        "source_assistant_index": _integer(spec["assistant_index"]),
        "response_trace_id": str(spec.get("trace_id") or ""),
        "estimated": False,
        "usage_source": "provider_billing_reconciliation",
        "billing_source": "provider_reconciliation",
        "reconciliation_id": spec["id"],
        "reconciliation_status": "reconciled",
        "reconciliation": {
            "id": spec["id"],
            "source": "SCNet provider billing console",
            "verified_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
            "reason": spec["reason"],
            "provider_total_tokens": _integer(spec["provider_total"]),
            "replaces_estimated_total": _integer(spec["replaces_estimated"]),
        },
    }
    record["billing"] = _billing(spec)
    return record


def _global_record(spec: Dict[str, Any]) -> Dict[str, Any]:
    input_tokens = _integer(spec["input"])
    raw_input = _integer(spec.get("raw_input", input_tokens))
    cached = _integer(spec.get("cached", max(0, raw_input - input_tokens)))
    output = _integer(spec["output"])
    provider_total = _integer(spec["provider_total"])
    reconciliation_id = str(spec["id"])

    return {
        "log_id": f"provider_reconciliation_{reconciliation_id}",
        "timestamp": spec["timestamp"],
        "action": "billing_reconciliation",
        "input_tokens": input_tokens,
        "raw_input_tokens": raw_input,
        "cached_input_tokens": cached,
        "output_tokens": output,
        "total_tokens": raw_input + output,
        "provider": str(spec["provider"]),
        "model": str(spec["model"]),
        "source": "provider_billing_reconciliation",
        "usage_source": "provider_billing_reconciliation",
        "billing_source": "provider_reconciliation",
        "reconciliation_id": reconciliation_id,
        "reconciliation_status": "reconciled",
        "provider_request_id": str(spec["provider_request_id"]),
        "token_details": {
            "raw_input_tokens": raw_input,
            "provider_input_tokens": _integer(spec.get("provider_input", input_tokens)),
            "provider_cached_tokens": _integer(spec.get("provider_cached", cached)),
            "provider_output_tokens": _integer(spec.get("provider_output", output)),
            "provider_total_tokens": provider_total,
            "estimated": False,
        },
        "reconciliation": {
            "id": reconciliation_id,
            "source": "SCNet provider billing console",
            "provider_total_tokens": provider_total,
            "reason": str(spec["reason"]),
        },
    }


def apply_reconciliation(server_root: Path, dry_run: bool) -> Dict[str, Any]:
    usage_path = server_root / "data" / "users" / USERNAME / "token_usage.jsonl"
    user_meta_path = server_root / "data" / "user.json"
    global_usage_path = server_root / "data" / "provider_billing_reconciliations.jsonl"
    rows = _read_jsonl(usage_path)
    existing_ids = {str(row.get("reconciliation_id") or "") for row in rows}
    pending = [spec for spec in RECONCILIATIONS if spec["id"] not in existing_ids]
    additions = [_record(spec) for spec in pending]
    global_rows = _read_jsonl(global_usage_path)
    global_existing_ids = {str(row.get("reconciliation_id") or "") for row in global_rows}
    global_pending = [spec for spec in GLOBAL_RECONCILIATIONS if spec["id"] not in global_existing_ids]
    global_additions = [_global_record(spec) for spec in global_pending]
    added_total = sum(_integer(row.get("total_tokens")) for row in additions)
    global_added_total = sum(_integer(row.get("total_tokens")) for row in global_additions)
    current_total = sum(
        _integer(row.get("raw_input_tokens") or (row.get("token_details") or {}).get("raw_input_tokens") or row.get("input_tokens"))
        + _integer(row.get("output_tokens"))
        for row in rows
    )
    report = {
        "username": USERNAME,
        "usage_path": str(usage_path),
        "before_records": len(rows),
        "before_total_tokens": current_total,
        "pending_reconciliations": [spec["id"] for spec in pending],
        "added_total_tokens": added_total,
        "after_total_tokens": current_total + added_total,
        "pending_global_reconciliations": [spec["id"] for spec in global_pending],
        "global_added_total_tokens": global_added_total,
        "dry_run": bool(dry_run),
    }

    if dry_run or (not pending and not global_pending):
        return report

    if pending:
        _write_jsonl_atomic(usage_path, [*rows, *additions])

    if global_pending:
        _write_jsonl_atomic(global_usage_path, [*global_rows, *global_additions])

    if not pending:
        report["after_records"] = len(rows)
        return report

    with user_meta_path.open("r", encoding="utf-8-sig") as handle:
        users = json.load(handle)

    if not isinstance(users, dict) or not isinstance(users.get(USERNAME), dict):
        raise RuntimeError(f"用户元数据不存在: {USERNAME}")

    users[USERNAME]["token_usage"] = _integer(users[USERNAME].get("token_usage")) + added_total
    _write_json_atomic(user_meta_path, users)
    report["after_records"] = len(rows) + len(additions)
    report["user_meta_after_total"] = users[USERNAME]["token_usage"]
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Reconcile provider billing into Nexora token usage")
    parser.add_argument("--server-root", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(apply_reconciliation(args.server_root, not args.apply), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
