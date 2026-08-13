"""
NexoraCode.local.tools.FileTool — 本地文件工具

文件读写 / 探测 / 列目录 / 精确 patch 五个工具：
- local_file_read: 全文或按行/按字符范围读取，返回 sha256 版本锁
- local_file_probe: 只探测元信息，不返回正文
- local_file_write: 覆盖写入（原子替换）
- local_file_list: 列目录
- local_file_patch: dry_run 预览 → confirm 确认的两段式精确修改

共享实现见 FileOpsCore，本模块只定义工具类与参数 schema。
"""

from __future__ import annotations

import os
from pathlib import Path

from ..Tool import LocalTool, ToolContext
from . import FileOpsCore as core


class FileReadTool(LocalTool):
    name = "local_file_read"
    description = (
        "读取用户本地计算机上指定文件的内容（NexoraCode 本地工具）。"
        "可读取全文，也可使用 start_line/end_line 按行读取，或使用 offset/limit 按字符读取。"
        "两种范围不能混用；范围读取仍返回整个文件的 sha256 作为版本锁。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "文件绝对路径"},
            "encoding": {
                "type": "string",
                "default": "utf-8",
                "description": "文件编码，默认 utf-8。读取结果会返回 sha256、content_sha256、换行类型和 BOM 信息。",
            },
            "start_line": {
                "type": "integer",
                "description": "可选。按行读取的起始行，1 表示第一行，必须和 end_line 同时提供。",
            },
            "end_line": {
                "type": "integer",
                "description": "可选。按行读取的结束行，包含该行，必须和 start_line 同时提供。",
            },
            "offset": {
                "type": "integer",
                "description": "可选。按字符读取的起始位置，0 表示第一个字符，必须和 limit 同时提供。",
            },
            "limit": {
                "type": "integer",
                "description": "可选。按字符读取的字符数量，必须和 offset 同时提供。",
            },
        },
        "required": ["path"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        path = str(args.get("path") or "").strip()
        encoding = str(args.get("encoding") or "utf-8").strip()

        p, permission_error = core.resolve_allowed_file_path(path, context=context.as_dict(), access="read")

        if permission_error:
            return permission_error

        if not p.exists():
            return {"success": False, "error": f"File not found: {path}"}

        if not p.is_file():
            return {"success": False, "error": f"Not a file: {path}"}

        try:
            content, raw_content = core.read_text_with_raw(p, encoding)
            selected_content, mode, slice_meta, slice_error = core.slice_read_content(
                content,
                args.get("start_line"),
                args.get("end_line"),
                args.get("offset"),
                args.get("limit"),
            )

            if slice_error:
                return {
                    "success": False,
                    "error": slice_error,
                    "path": str(p),
                    "encoding": encoding,
                    **core.build_file_metadata(p, content, raw_content, encoding),
                }

            return {
                "success": True,
                "content": selected_content,
                "mode": mode,
                "slice": slice_meta,
                "total_chars": len(content),
                "returned_chars": len(selected_content),
                "returned_line_count": len(selected_content.splitlines()),
                "returned_content_sha256": core.sha256_text(selected_content, encoding),
                **core.build_file_metadata(p, content, raw_content, encoding),
            }
        except UnicodeDecodeError as e:
            return {
                "success": False,
                "error": f"文件无法按 {encoding} 解码: {e}",
                "encoding": encoding,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}


class FileProbeTool(LocalTool):
    name = "local_file_probe"
    description = (
        "探测用户本地计算机上指定文件的元信息，不返回文件正文（NexoraCode 本地工具）。"
        "用于修改前确认文件大小、BOM、编码提示、换行类型、sha256、是否二进制和写权限。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "文件绝对路径"},
        },
        "required": ["path"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        path = str(args.get("path") or "").strip()

        p, permission_error = core.resolve_allowed_file_path(path, context=context.as_dict(), access="read")

        if permission_error:
            return permission_error

        if not p.exists():
            return {"success": False, "error": f"File not found: {path}"}

        if not p.is_file():
            return {"success": False, "error": f"Not a file: {path}"}

        try:
            stat_result = p.stat()
            probe_result = core.scan_file_probe(p)

            return {
                "success": True,
                "path": str(p),
                "resolved_path": str(p.resolve()),
                "readable": os.access(p, os.R_OK),
                "writable": os.access(p, os.W_OK),
                "created_at": stat_result.st_ctime,
                "modified_at": stat_result.st_mtime,
                **probe_result,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}


class FileWriteTool(LocalTool):
    name = "local_file_write"
    description = "将内容写入用户本地计算机上的指定文件，会覆盖原有内容（NexoraCode 本地工具）。"
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "文件绝对路径"},
            "content": {"type": "string", "description": "写入内容"},
            "encoding": {"type": "string", "default": "utf-8"},
        },
        "required": ["path", "content"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        path = str(args.get("path") or "").strip()
        content = str(args.get("content") or "")
        encoding = str(args.get("encoding") or "utf-8").strip()

        p, permission_error = core.resolve_allowed_file_path(path, context=context.as_dict(), access="write")

        if permission_error:
            return permission_error

        try:
            core.raise_if_cancelled(context.cancelled)
            p.parent.mkdir(parents=True, exist_ok=True)
            raw_content = core.encode_text(content, encoding)
            core.raise_if_cancelled(context.cancelled)

            with core.get_file_lock(p):
                core.write_bytes_atomic(p, raw_content, cancel_checker=context.cancelled)

            return {
                "success": True,
                "path": str(p),
                "encoding": encoding,
                "bytes_written": len(raw_content),
                "sha256": core.sha256_bytes(raw_content),
            }
        except Exception as e:
            if str(e) == "stream_cancelled":
                return {"success": False, "error": "stream_cancelled", "message": "用户已停止生成"}

            return {"success": False, "error": str(e)}


class FileListTool(LocalTool):
    name = "local_file_list"
    description = "列出用户本地计算机指定目录下的文件和子目录（NexoraCode 本地工具）。"
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "目录绝对路径"},
        },
        "required": ["path"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        path = str(args.get("path") or "").strip()

        p, permission_error = core.resolve_allowed_file_path(path, context=context.as_dict(), access="read")

        if permission_error:
            return permission_error

        if not p.is_dir():
            return {"success": False, "error": f"Not a directory: {path}"}

        try:
            entries = []

            for item in sorted(p.iterdir()):
                entries.append({
                    "name": item.name,
                    "type": "dir" if item.is_dir() else "file",
                    "size": item.stat().st_size if item.is_file() else None,
                })

            return {"success": True, "entries": entries, "count": len(entries)}
        except Exception as e:
            return {"success": False, "error": str(e)}


class FilePatchTool(LocalTool):
    name = "local_file_patch"
    description = (
        "对用户本地计算机上的单个文件执行精确 patch（NexoraCode 本地工具）。"
        "\n\n重要：local_file_patch 必须两步调用，这不是建议，是强制流程。"
        "\n1. 预览阶段：传 path，并且必须提供 patch 或 edits 其中一种；同时设置 dry_run=true。"
        "本阶段只校验和生成 preview_id，不写入文件。"
        "\n2. 确认阶段：只传 path 和 confirm_preview_id。confirm_preview_id 必须来自第 1 步返回的 preview_id。"
        "本阶段禁止重新传 patch、edits、expected_sha256 或 dry_run=true。"
        "\n如果首次写入直接传 dry_run=false 且没有 confirm_preview_id，工具会拒绝执行，并提示必须先 dry_run=true 获取 preview_id。"
        "\n\n输入要求：必须且只能提供 patch 或 edits 其中一种。patch 使用统一 diff 格式；"
        "edits 使用结构化精确编辑，支持 replace、insert_before、insert_after、delete。"
        "edits 会按顺序串行执行，后一条 target 会在前面 edit 修改后的内容中匹配。"
        "target 会先精确匹配；未命中时允许 CRLF/CR/LF 换行归一化后的唯一匹配。"
        "replace 必须使用 replacement，insert_before/insert_after 必须使用 content。"
        "replacement/content 写入时会跟随文件原有换行类型，避免引入混合换行。"
        "建议先调用 local_file_read 获取 sha256，再通过 expected_sha256 防止基于旧内容写入。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "文件绝对路径"},
            "patch": {
                "type": "string",
                "description": "统一 diff 内容。提供 patch 时不能同时提供 edits。",
            },
            "edits": {
                "type": "array",
                "description": "结构化精确编辑列表。提供 edits 时不能同时提供 patch。",
                "items": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["replace", "insert_before", "insert_after", "delete"],
                            "description": "编辑动作",
                        },
                        "target": {"type": "string", "description": "文件中必须精确匹配的目标文本"},
                        "replacement": {"type": "string", "description": "replace 动作使用的新文本"},
                        "content": {"type": "string", "description": "insert_before/insert_after 动作插入的文本"},
                        "occurrence": {
                            "type": "integer",
                            "description": "当 target 出现多次时，指定第几处，1 表示第一处。",
                        },
                    },
                    "required": ["action", "target"],
                },
            },
            "encoding": {"type": "string", "description": "文件编码，默认 utf-8", "default": "utf-8"},
            "expected_sha256": {
                "type": "string",
                "description": "可选。修改前文件原始字节 SHA256，建议使用 local_file_read 返回的 sha256。不一致时拒绝修改。",
            },
            "dry_run": {
                "type": "boolean",
                "description": "第 1 步必须设置为 true，用于生成 preview_id 且不写入文件。第 2 步确认写入时不要传 dry_run=true，只传 path 和 confirm_preview_id。",
                "default": False,
            },
            "confirm_preview_id": {
                "type": "string",
                "description": "第 2 步确认写入使用，值必须来自第 1 步 dry_run=true 返回的 preview_id。传入 confirm_preview_id 时只能同时传 path，不能重新传 patch、edits、expected_sha256 或 dry_run=true。",
            },
        },
        "required": ["path"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        path = str(args.get("path") or "").strip()
        encoding = str(args.get("encoding") or "utf-8").strip()

        p, permission_error = core.resolve_allowed_file_path(path, context=context.as_dict(), access="write")

        if permission_error:
            return permission_error

        if not p.exists():
            return {"success": False, "error": f"File not found: {path}"}

        if not p.is_file():
            return {"success": False, "error": f"Not a file: {path}"}

        patch_text = str(args.get("patch") or "")
        has_patch = bool(patch_text.strip())
        edits = args.get("edits")
        has_edits = isinstance(edits, list) and len(edits) > 0
        confirm_preview_id = str(args.get("confirm_preview_id") or "").strip()
        has_confirm_preview = bool(confirm_preview_id)
        dry_run = bool(args.get("dry_run", False))

        if has_confirm_preview:
            if dry_run:
                return {"success": False, "error": "confirm_preview_id 不能和 dry_run=true 同时使用。"}

            if has_patch or has_edits:
                return {"success": False, "error": "确认写入时只能传入 path 和 confirm_preview_id，不能重新传 patch 或 edits。"}

            if args.get("expected_sha256"):
                return {"success": False, "error": "确认写入时不能重新传 expected_sha256，版本锁以 dry_run 预览为准。"}

            try:
                with core.get_file_lock(p):
                    return core.confirm_patch_preview_locked(p, confirm_preview_id, cancel_checker=context.cancelled)
            except RuntimeError as e:
                if str(e) == "stream_cancelled":
                    return {"success": False, "error": "stream_cancelled", "message": "用户已停止生成"}

                return {"success": False, "error": str(e)}
            except UnicodeDecodeError as e:
                return {
                    "success": False,
                    "error": f"文件无法按预览编码解码: {e}",
                    "encoding": encoding,
                }
            except Exception as e:
                return {"success": False, "error": str(e)}

        if has_patch == has_edits:
            return {"success": False, "error": "必须且只能提供 patch 或 edits 其中一种输入。"}

        if not dry_run:
            return {
                "success": False,
                "error": "local_file_patch 写入必须先 dry_run=true 获取 preview_id，再传 confirm_preview_id 确认写入。",
            }

        try:
            with core.get_file_lock(p):
                return core.build_patch_preview_locked(
                    p,
                    patch_text,
                    has_patch,
                    edits,
                    encoding,
                    str(args.get("expected_sha256") or ""),
                )
        except UnicodeDecodeError as e:
            return {
                "success": False,
                "error": f"文件无法按 {encoding} 解码: {e}",
                "encoding": encoding,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
