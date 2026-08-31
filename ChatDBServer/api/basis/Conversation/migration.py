"""
Nexora.basis.Conversation.migration — v1-v3 -> v4 迁移

规则要点：
- 迁移前复制原文件到 data/users/<username>/conversation_migrations/<timestamp>/
- 失败时原文件不变，不产半成品 v4
- 旧 messages 中仅 user/assistant 进入新 messages，system 按 metadata.kind 分类到 context
- assistant metadata 归一化，不迁移 longterm，resume 字段迁移到 runtime.resume
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
from datetime import datetime
from typing import Any, Dict, List, Tuple

from App.Utils import sanitize_assistant_visible_content

from .errors import ConversationMigrationError
from .repository import conversation_base_path, conversation_file_path, conversation_index_path, load_json_compat
from .schema import SCHEMA_VERSION, build_v4_skeleton, normalize_scope, sha16
from .telemetry import build_trace_from_process_steps


def _coerce_str(value: Any) -> str:
    return str(value or "").strip()


def _extract_workspace_id(old: Dict[str, Any]) -> str:
    # 优先级: workspace_id > metadata.workspace_id > metadata.nexoracode_project.project_id > branch.workspace_id
    candidates: List[str] = []
    candidates.append(_coerce_str(old.get("workspace_id")))
    metadata = old.get("metadata") if isinstance(old.get("metadata"), dict) else {}
    if isinstance(metadata, dict):
        candidates.append(_coerce_str(metadata.get("workspace_id")))
        nexora = metadata.get("nexoracode_project") if isinstance(metadata.get("nexoracode_project"), dict) else {}
        if isinstance(nexora, dict):
            candidates.append(_coerce_str(nexora.get("project_id")))
    branch = old.get("branch") if isinstance(old.get("branch"), dict) else {}
    if isinstance(branch, dict):
        candidates.append(_coerce_str(branch.get("workspace_id")))
    for cand in candidates:
        if cand:
            return cand
    return ""


def _extract_learning(old: Dict[str, Any]) -> Dict[str, Any]:
    metadata = old.get("metadata") if isinstance(old.get("metadata"), dict) else {}
    tags = old.get("tags") if isinstance(old.get("tags"), list) else []
    conversation_mode = _coerce_str(old.get("conversation_mode"))

    enabled = False
    lecture_id = ""
    course_id = ""
    course_title = ""

    # conversation_mode == learning
    if conversation_mode.lower() == "learning":
        enabled = True

    # tags contains learning
    for tag in tags:
        if _coerce_str(tag).lower() == "learning":
            enabled = True
            break

    if isinstance(metadata, dict):
        # metadata.learning
        learning_block = metadata.get("learning") if isinstance(metadata.get("learning"), dict) else None
        if isinstance(learning_block, dict):
            if _coerce_str(learning_block.get("lecture_id")):
                lecture_id = _coerce_str(learning_block.get("lecture_id"))
                enabled = True
            if _coerce_str(learning_block.get("course_id")):
                course_id = _coerce_str(learning_block.get("course_id"))
                enabled = True
            if _coerce_str(learning_block.get("course_title")):
                course_title = _coerce_str(learning_block.get("course_title"))
            if _coerce_str(learning_block.get("learning_course_id")):
                course_id = _coerce_str(learning_block.get("learning_course_id"))
                enabled = True
            if _coerce_str(learning_block.get("learning_course_title")):
                course_title = _coerce_str(learning_block.get("learning_course_title"))
            if bool(learning_block.get("enabled")):
                enabled = True

        # 平铺字段
        for key in ("learning_lecture_id", "lecture_id"):
            if _coerce_str(metadata.get(key)):
                lecture_id = _coerce_str(metadata.get(key))
                enabled = True
                break
        for key in ("learning_course_id", "course_id"):
            if _coerce_str(metadata.get(key)):
                course_id = _coerce_str(metadata.get(key))
                enabled = True
                break
        for key in ("learning_course_title", "course_title"):
            if _coerce_str(metadata.get(key)):
                course_title = _coerce_str(metadata.get(key))
                break

    # 兜底：tags 里无法解析 lecture/course，则仅标记 enabled
    return {
        "enabled": bool(enabled) if (lecture_id or course_id or enabled) else False,
        "lecture_id": lecture_id,
        "course_id": course_id,
        "course_title": course_title,
    }


def _migrate_assistant_metadata_to_v4(old_msg: Dict[str, Any]) -> Dict[str, Any]:
    metadata = old_msg.get("metadata") if isinstance(old_msg.get("metadata"), dict) else {}
    if not isinstance(metadata, dict):
        metadata = {}

    # model
    model_name = _coerce_str(old_msg.get("model_name") or metadata.get("model_name"))
    provider = _coerce_str(metadata.get("provider"))

    # summary
    summary = _coerce_str(old_msg.get("exchange_summary") or metadata.get("exchange_summary"))

    # usage: io_tokens -> usage
    usage = {}
    io_tokens = metadata.get("io_tokens") if isinstance(metadata.get("io_tokens"), dict) else None
    if isinstance(io_tokens, dict):
        usage = {
            "input": int(io_tokens.get("input") or 0),
            "output": int(io_tokens.get("output") or 0),
            "raw_input": int(io_tokens.get("raw_input") or 0),
            "cached_input": int(io_tokens.get("cached_input") or 0),
            "effective_input": int(io_tokens.get("effective_input") or 0),
        }
    else:
        # 兼容顶层 io_tokens
        top_io = old_msg.get("io_tokens") if isinstance(old_msg.get("io_tokens"), dict) else {}
        if isinstance(top_io, dict) and top_io:
            usage = {
                "input": int(top_io.get("input") or 0),
                "output": int(top_io.get("output") or 0),
                "raw_input": int(top_io.get("raw_input") or 0),
                "cached_input": int(top_io.get("cached_input") or 0),
                "effective_input": int(top_io.get("effective_input") or 0),
            }

    process_steps = metadata.get("process_steps") if isinstance(metadata.get("process_steps"), list) else []
    trace = build_trace_from_process_steps(process_steps)

    # versions 保留并归一
    versions = metadata.get("versions") if isinstance(metadata.get("versions"), list) else []

    # error: terminal_error -> error
    error: Dict[str, Any] = {}
    if "terminal_error" in metadata:
        error = {"message": _coerce_str(metadata.get("terminal_error"))}
    elif isinstance(metadata.get("error"), dict):
        error = dict(metadata.get("error"))

    return {
        "model": {"name": model_name, "provider": provider} if (model_name or provider) else {"name": model_name, "provider": provider},
        "summary": summary,
        "usage": usage,
        "trace": trace,
        "versions": versions,
        "error": error,
        "reasoning_content": metadata.get("reasoning_content"),
        "request_debug": metadata.get("request_debug"),
    }


def migrate_single_conversation_data(old: Dict[str, Any]) -> Dict[str, Any]:
    """纯内存迁移，不触碰文件。"""
    if not isinstance(old, dict):
        raise ConversationMigrationError("旧会话数据必须是 dict")

    # 若已是 v4，直接返回（幂等）
    if int(old.get("schema_version") or 0) == SCHEMA_VERSION:
        return copy.deepcopy(old)

    conversation_id = _coerce_str(old.get("conversation_id"))
    if not conversation_id:
        raise ConversationMigrationError("旧会话缺少 conversation_id")

    title = _coerce_str(old.get("title") or "未命名对话") or "未命名对话"
    created_at = _coerce_str(old.get("created_at")) or datetime.now().isoformat()
    updated_at = _coerce_str(old.get("updated_at")) or datetime.now().isoformat()
    pin = bool(old.get("pin", False))

    # scope
    workspace_id = _extract_workspace_id(old)
    learning = _extract_learning(old)
    tags_raw = old.get("tags") if isinstance(old.get("tags"), list) else []
    tags: List[str] = []
    for item in tags_raw:
        tag = _coerce_str(item).lower()
        if tag and tag not in tags:
            tags.append(tag)

    scope = {
        "workspace_id": workspace_id,
        "learning": learning,
        "tags": tags,
    }
    # 若 learning.enabled 则确保 tags 含 learning
    if learning.get("enabled") and "learning" not in tags:
        scope["tags"] = tags + ["learning"]

    # messages 迁移：仅 user/assistant 进入新 messages
    old_messages = old.get("messages", [])
    if not isinstance(old_messages, list):
        old_messages = []

    new_messages: List[Dict[str, Any]] = []
    system_snapshots: List[Dict[str, Any]] = []
    knowledge_events: List[Dict[str, Any]] = []
    legacy_events: List[Dict[str, Any]] = []
    compressions: List[Dict[str, Any]] = []

    # 记录可见消息计数，用于 effective_from_message
    visible_count = 0

    # 收集知识快照用于 hash
    knowledge_snapshot_docs = old.get("knowledge_snapshot")
    global_knowledge_snapshot_docs = old.get("global_knowledge_snapshot")

    for msg in old_messages:
        if not isinstance(msg, dict):
            continue
        role = _coerce_str(msg.get("role"))
        if role == "user":
            attachments = msg.get("attachments") if isinstance(msg.get("attachments"), list) else []
            # 旧 user 可能无 metadata.attachments
            new_messages.append({
                "role": "user",
                "content": msg.get("content", ""),
                "timestamp": _coerce_str(msg.get("timestamp")) or datetime.now().isoformat(),
                "attachments": list(attachments),
            })
            visible_count += 1
        elif role == "assistant":
            migrated = _migrate_assistant_metadata_to_v4(msg)
            content = sanitize_assistant_visible_content(msg.get("content", ""))
            assistant_msg: Dict[str, Any] = {
                "role": "assistant",
                "content": content,
                "timestamp": _coerce_str(msg.get("timestamp")) or datetime.now().isoformat(),
                "status": "completed",
                "model": migrated["model"],
                "summary": migrated["summary"],
                "usage": migrated["usage"],
                "trace": migrated["trace"],
                "versions": migrated["versions"] if isinstance(migrated["versions"], list) else [],
            }
            if migrated["error"]:
                assistant_msg["error"] = migrated["error"]
            new_messages.append(assistant_msg)
            visible_count += 1
        elif role == "system":
            metadata = msg.get("metadata", {}) if isinstance(msg.get("metadata"), dict) else {}
            kind = _coerce_str(metadata.get("kind"))
            if kind == "system_snapshot":
                system_snapshots.append({
                    "epoch": int(metadata.get("epoch") or len(system_snapshots) + 1),
                    "hash": _coerce_str(metadata.get("hash")) or sha16(str(msg.get("content") or "")),
                    "content": str(msg.get("content") or ""),
                    "effective_from_message": int(visible_count),
                    "reason": _coerce_str(metadata.get("reason") or "migrated"),
                    "created_at": _coerce_str(msg.get("timestamp")) or datetime.now().isoformat(),
                })
            elif kind in {"knowledge_diff", "global_knowledge_diff"}:
                scope_val = _coerce_str(metadata.get("scope") or ("global" if kind == "global_knowledge_diff" else "workspace"))
                knowledge_events.append({
                    "scope": scope_val,
                    "added": [],
                    "removed": [],
                    "hash": _coerce_str(metadata.get("hash")),
                    "prev_hash": _coerce_str(metadata.get("prev_hash")),
                    "content": str(msg.get("content") or ""),
                    "effective_from_message": int(visible_count),
                    "created_at": _coerce_str(msg.get("timestamp")) or datetime.now().isoformat(),
                })
            else:
                legacy_events.append({
                    "kind": kind or "system",
                    "content": str(msg.get("content") or ""),
                    "metadata": dict(metadata),
                    "effective_from_message": int(visible_count),
                    "created_at": _coerce_str(msg.get("timestamp")) or datetime.now().isoformat(),
                })
        else:
            # 其他角色直接丢弃（v4 只允许 user/assistant）
            legacy_events.append({
                "kind": role,
                "content": str(msg.get("content") or ""),
                "metadata": dict(msg.get("metadata", {})) if isinstance(msg.get("metadata"), dict) else {},
                "effective_from_message": int(visible_count),
            })

    # 知识快照结构化
    knowledge: Dict[str, Any] = {
        "workspace": {"hash": "", "documents": []},
        "global": {"hash": "", "titles": []},
    }
    if isinstance(knowledge_snapshot_docs, dict) and isinstance(knowledge_snapshot_docs.get("documents"), list):
        docs = [dict(d) for d in knowledge_snapshot_docs.get("documents", []) if isinstance(d, dict)]
        knowledge["workspace"] = {
            "hash": _coerce_str(knowledge_snapshot_docs.get("hash")) or _hash_docs(docs),
            "documents": docs,
        }
    elif isinstance(knowledge_snapshot_docs, list):
        docs = [dict(d) for d in knowledge_snapshot_docs if isinstance(d, dict)]
        knowledge["workspace"] = {
            "hash": _hash_docs(docs),
            "documents": docs,
        }

    if isinstance(global_knowledge_snapshot_docs, dict) and isinstance(global_knowledge_snapshot_docs.get("documents"), list):
        titles = [str(d.get("title") or "").strip() for d in global_knowledge_snapshot_docs.get("documents", []) if isinstance(d, dict) and str(d.get("title") or "").strip()]
        knowledge["global"] = {
            "hash": _coerce_str(global_knowledge_snapshot_docs.get("hash")) or _hash_docs([{"title": t} for t in titles]),
            "titles": titles,
        }
    elif isinstance(global_knowledge_snapshot_docs, list):
        titles = [str(d.get("title") or "").strip() for d in global_knowledge_snapshot_docs if isinstance(d, dict) and str(d.get("title") or "").strip()]
        if not titles:
            # 也可能是 list[str]
            titles = [str(t or "").strip() for t in global_knowledge_snapshot_docs if str(t or "").strip()]
        knowledge["global"] = {
            "hash": _hash_docs([{"title": t} for t in titles]),
            "titles": titles,
        }

    # compressions
    raw_compressions = old.get("context_compressions", [])
    if isinstance(raw_compressions, list):
        for item in raw_compressions:
            if isinstance(item, dict):
                compressions.append(dict(item))

    # branch
    branch = old.get("branch") if isinstance(old.get("branch"), dict) else None

    # runtime.resume
    runtime = {"resume": None}
    if _coerce_str(old.get("last_volc_response_id")) or _coerce_str(old.get("last_response_id")):
        response_id = _coerce_str(old.get("last_volc_response_id") or old.get("last_response_id"))
        model_used = _coerce_str(old.get("last_model_used"))
        runtime["resume"] = {
            "response_id": response_id,
            "model": model_used,
        }

    # longterm 直接丢弃

    v4: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "conversation_id": conversation_id,
        "title": title,
        "created_at": created_at,
        "updated_at": updated_at,
        "pin": pin,
        "scope": normalize_scope(scope),
        "messages": new_messages,
        "context": {
            "system_snapshots": system_snapshots,
            "knowledge": knowledge,
            "knowledge_events": knowledge_events,
            "compressions": compressions,
            "legacy_events": legacy_events,
        },
        "branch": copy.deepcopy(branch) if isinstance(branch, dict) else None,
        "runtime": runtime,
    }

    # 保留 puzzle_states 等少量运行时扩展（若存在）
    if isinstance(old.get("puzzle_states"), dict):
        v4["puzzle_states"] = copy.deepcopy(old.get("puzzle_states"))

    return v4


def _hash_docs(docs: List[Dict[str, Any]]) -> str:
    import hashlib as _hashlib
    import json as _json
    normalized: List[Dict[str, Any]] = []
    for item in docs:
        if not isinstance(item, dict):
            continue
        title = _coerce_str(item.get("title") or item.get("name") or "")
        if not title:
            continue
        normalized.append({
            "title": title,
            "knowledge_type": _coerce_str(item.get("knowledge_type") or item.get("type") or "basis"),
            "basis_id": _coerce_str(item.get("basis_id") or ""),
            "pin": bool(item.get("pin", False)),
        })
    normalized.sort(key=lambda x: (x["title"].lower(), x["basis_id"]))
    try:
        raw = _json.dumps(normalized, ensure_ascii=False, sort_keys=True)
    except Exception:
        raw = str(normalized)
    return _hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def migrate_conversation_file(username: str, conversation_id: str, *, dry_run: bool = False, timestamp: str | None = None) -> Dict[str, Any]:
    """
    迁移单个会话文件。
    返回报告：{conversation_id, migrated, backup_path, error}
    dry_run 时不写盘。
    """
    base_path = conversation_base_path(username)
    file_path = conversation_file_path(username, conversation_id)
    # dry-run：零写入，只解析
    if dry_run:
        data = load_json_compat(file_path, default=None)
        if not isinstance(data, dict):
            return {"conversation_id": conversation_id, "migrated": False, "error": "无法解析原文件", "backup_path": ""}
        if int(data.get("schema_version") or 0) == SCHEMA_VERSION:
            return {"conversation_id": conversation_id, "migrated": False, "error": "已是 v4，无需迁移", "backup_path": ""}
        try:
            v4 = migrate_single_conversation_data(data)
        except Exception as exc:
            return {"conversation_id": conversation_id, "migrated": False, "error": f"迁移失败: {exc}", "backup_path": ""}
        return {"conversation_id": conversation_id, "migrated": True, "dry_run": True, "backup_path": "", "v4_preview": v4}

    # 正式迁移：在文件锁内完成 读 -> 备份 -> 写，保证并发安全
    from basis.Database import get_path_lock, safe_write_json as _safe_write
    from .repository import conversation_migration_backup_dir

    ts = str(timestamp or datetime.now().strftime("%Y%m%d_%H%M%S"))
    backup_dir = conversation_migration_backup_dir(username, ts)
    backup_path = os.path.join(backup_dir, f"{conversation_id}.json")

    with get_path_lock(file_path):
        data = load_json_compat(file_path, default=None)
        if not isinstance(data, dict):
            return {"conversation_id": conversation_id, "migrated": False, "error": "无法解析原文件", "backup_path": ""}
        if int(data.get("schema_version") or 0) == SCHEMA_VERSION:
            return {"conversation_id": conversation_id, "migrated": False, "error": "已是 v4，无需迁移", "backup_path": ""}
        os.makedirs(backup_dir, exist_ok=True)
        try:
            shutil.copy2(file_path, backup_path)
        except Exception as exc:
            return {"conversation_id": conversation_id, "migrated": False, "error": f"备份失败: {exc}", "backup_path": ""}
        try:
            v4 = migrate_single_conversation_data(data)
        except Exception as exc:
            return {"conversation_id": conversation_id, "migrated": False, "error": f"迁移失败: {exc}", "backup_path": backup_path}
        try:
            _safe_write(file_path, v4, indent=2)
            from .index import sync_index_from_file as _sync
            _sync(username, file_path, v4)
        except Exception as exc:
            try:
                shutil.copy2(backup_path, file_path)
            except Exception:
                pass
            return {"conversation_id": conversation_id, "migrated": False, "error": f"写入失败已回滚: {exc}", "backup_path": backup_path}
    return {"conversation_id": conversation_id, "migrated": True, "backup_path": backup_path}


def migrate_all(username: str, *, dry_run: bool = False) -> Dict[str, Any]:
    base_path = conversation_base_path(username)
    if not os.path.exists(base_path):
        return {"username": username, "total": 0, "migrated": 0, "errors": [], "reports": []}

    reports: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    migrated = 0
    # 单次批量迁移共用同一备份时间戳，避免产生多个目录
    batch_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    for filename in os.listdir(base_path):
        if not filename.endswith(".json"):
            continue
        if filename == os.path.basename(conversation_index_path(username)):
            continue
        cid = filename[:-5].strip()
        if not cid:
            continue
        # 快速检查：已是 v4 跳过
        data = load_json_compat(os.path.join(base_path, filename), default=None)
        if isinstance(data, dict) and int(data.get("schema_version") or 0) == SCHEMA_VERSION:
            continue
        report = migrate_conversation_file(username, cid, dry_run=dry_run, timestamp=batch_timestamp)
        reports.append(report)
        if report.get("migrated"):
            migrated += 1
        if report.get("error") and "无需迁移" not in str(report.get("error")):
            # dry_run 的 migrated=True 不算 error
            if not (report.get("migrated") and dry_run):
                if report.get("migrated") is False:
                    errors.append(report)

    # dry_run 时 errors 包含的应是真失败
    return {
        "username": username,
        "total": len(reports),
        "migrated": migrated,
        "errors": errors,
        "reports": reports,
        "dry_run": bool(dry_run),
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Conversation v4 迁移")
    parser.add_argument("--user", required=True, help="用户名")
    parser.add_argument("--dry-run", action="store_true", help="仅预览，不写盘")
    parser.add_argument("--conversation", default="", help="单会话 ID（可选）")
    args = parser.parse_args()

    # 兼容 Windows GBK 终端
    try:
        import sys as _sys
        if hasattr(_sys.stdout, "reconfigure"):
            _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    if args.conversation:
        result = migrate_conversation_file(args.user, args.conversation.strip(), dry_run=args.dry_run)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        result = migrate_all(args.user, dry_run=args.dry_run)
        print(json.dumps(result, ensure_ascii=False, indent=2))
