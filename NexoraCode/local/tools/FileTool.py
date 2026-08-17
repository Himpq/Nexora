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


DEFAULT_READ_CHAR_LIMIT = 2000


class FileReadTool(LocalTool):
    name = "local_file_read"
    description = (
        "读取用户本地计算机上指定文件的内容（NexoraCode 本地工具）。"
        "可读取全文，也可使用 start_line/end_line 按行读取，或使用 offset/limit 按字符读取。"
        "两种范围不能混用。"
        "范围参数可单独提供：start_line 单独提供表示从该行读到文件末尾；"
        "end_line 单独提供表示从第 1 行读到该行；"
        "offset 单独提供表示从该字符位置读到文件末尾；"
        "limit 单独提供表示读取开头 limit 个字符。"
        "范围超出文件总长时会自动截断到可用范围并在 slice 元信息中提示，不会报错。"
        "无范围参数读取全文时，默认只返回前 2000 字符；若文件更长会在返回中标注已截断与总长度，"
        "请按 start_line/end_line 或 offset/limit 分段继续读取以获取完整信息。"
        "读取结果始终返回整个文件的 sha256 作为版本锁。"
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
                "description": "可选。按行读取的起始行，1 表示第一行；单独提供时从该行读到文件末尾。",
            },
            "end_line": {
                "type": "integer",
                "description": "可选。按行读取的结束行，包含该行；单独提供时从第 1 行读到该行。",
            },
            "offset": {
                "type": "integer",
                "description": "可选。按字符读取的起始位置，0 表示第一个字符；单独提供时从该位置读到文件末尾。",
            },
            "limit": {
                "type": "integer",
                "description": "可选。按字符读取的字符数量；单独提供时读取开头 limit 个字符。",
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
            return core.build_file_not_found_error(path)

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

            if mode == "full" and len(content) > DEFAULT_READ_CHAR_LIMIT:
                slice_meta = {
                    "type": "truncated_head",
                    "returned_chars": DEFAULT_READ_CHAR_LIMIT,
                    "total_chars": len(content),
                    "truncated": True,
                    "hint": (
                        f"文件总长度 {len(content)} 字符，超过单次读取上限 {DEFAULT_READ_CHAR_LIMIT} 字符，"
                        "以下仅返回开头部分。如需完整内容，请使用 local_file_read 按 "
                        "start_line/end_line 或 offset/limit 分段读取。"
                    ),
                }
                selected_content = content[:DEFAULT_READ_CHAR_LIMIT]
                mode = "truncated_head"

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
            return core.build_file_not_found_error(path)

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
        "对用户本地计算机上的单个文件执行精确修改（NexoraCode 本地工具）。"
        "\n\n最简单用法（推荐）：传 path + old_string + new_string 直接替换，一步写入，"
        "old_string 必须精确唯一匹配文件中的一段文本，new_string 为替换后的内容。"
        "old_string 出现多次时传 occurrence 指定第几处（1 表示第一处）。"
        "\n\n高级用法：传 path + edits（结构化编辑数组，支持 replace / insert_before / insert_after / delete，"
        "按顺序串行执行，replace 用 target+replacement）；或传 path + patch（统一 diff 格式）。"
        "可选 dry_run=true 只预览不写入（返回 diff 与 preview_id），预览后可用 path + confirm_preview_id 确认写入。"
        "\n\n建议先调用 local_file_read 获取最新 sha256 与内容。若提供 expected_sha256 且与当前文件不一致，"
        "工具会拒绝基于旧内容修改，并返回当前实际 sha256 与匹配状态，请重新读取最新内容后重试。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "文件绝对路径"},
            "old_string": {
                "type": "string",
                "description": "可选。文件中必须精确唯一匹配的旧文本（推荐用 old_string+new_string 做简单替换，不需要构造 edits 数组）。",
            },
            "new_string": {
                "type": "string",
                "description": "可选。替换 old_string 的新文本；提供 old_string 时必须提供 new_string（可为空字符串表示删除）。",
            },
            "occurrence": {
                "type": "integer",
                "description": "可选。old_string 出现多次时指定第几处，1 表示第一处。",
            },
            "patch": {
                "type": "string",
                "description": "统一 diff 内容。提供 patch 时不能同时提供 edits 或 old_string。",
            },
            "edits": {
                "type": "array",
                "description": "结构化精确编辑列表。提供 edits 时不能同时提供 patch 或 old_string。",
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
                "description": "可选。修改前文件原始字节 SHA256，建议使用 local_file_read 返回的 sha256。不一致时拒绝修改并返回当前文件状态。",
            },
            "dry_run": {
                "type": "boolean",
                "description": "可选。为 true 时只校验并返回 diff 与 preview_id，不写入文件；确认写入用 path + confirm_preview_id。不传则直接一步写入。",
                "default": False,
            },
            "confirm_preview_id": {
                "type": "string",
                "description": "可选。dry_run=true 返回的 preview_id，传入时按该预览内容写入，只能同时传 path。",
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
            return core.build_file_not_found_error(path)

        if not p.is_file():
            return {"success": False, "error": f"Not a file: {path}"}

        # 扁平 old_string/new_string → 单条 replace edit，简化模型调用（DSH edit 风格）。
        old_string = str(args.get("old_string") or "")
        new_string = str(args.get("new_string") or "")
        has_old_string = "old_string" in args
        has_new_string_arg = "new_string" in args
        edits = args.get("edits")
        has_edits = isinstance(edits, list) and len(edits) > 0
        patch_text = str(args.get("patch") or "")
        has_patch = bool(patch_text.strip())

        if has_old_string or has_new_string_arg:
            if has_patch or has_edits:
                return {"success": False, "error": "old_string/new_string 不能和 patch 或 edits 同时使用。"}

            if not has_old_string or not str(old_string):
                return {"success": False, "error": "提供 new_string 时必须同时提供非空 old_string。"}

            occurrence = args.get("occurrence")

            try:
                occurrence_int = int(occurrence) if occurrence is not None else None
            except (TypeError, ValueError):
                occurrence_int = None

            edits = [{
                "action": "replace",
                "target": old_string,
                "replacement": new_string,
                "occurrence": occurrence_int,
            }]
            has_edits = True

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

        # 单步写入：未指定 dry_run 时在同一文件锁内「校验 + 写入」一步完成；
        # dry_run=true 只生成预览不写入，供模型确认后再用 confirm_preview_id 提交。
        try:
            with core.get_file_lock(p):
                preview_result = core.build_patch_preview_locked(
                    p,
                    patch_text,
                    has_patch,
                    edits,
                    encoding,
                    str(args.get("expected_sha256") or ""),
                )

                if not preview_result.get("success"):
                    return preview_result

                if dry_run:
                    return preview_result

                return core.confirm_patch_preview_locked(
                    p,
                    preview_result.get("preview_id"),
                    cancel_checker=context.cancelled,
                )
        except RuntimeError as e:
            if str(e) == "stream_cancelled":
                return {"success": False, "error": "stream_cancelled", "message": "用户已停止生成"}

            return {"success": False, "error": str(e)}
        except UnicodeDecodeError as e:
            return {
                "success": False,
                "error": f"文件无法按 {encoding} 解码: {e}",
                "encoding": encoding,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
