"""
工具：文件操作（读取、写入、列目录）
安全策略：只允许操作 config 中 allowed_dirs 内的路径
"""

import codecs
import difflib
import hashlib
import os
import re
import threading
import time
import uuid
from pathlib import Path
from core.config import config


_FILE_LOCKS = {}
_FILE_LOCKS_GUARD = threading.RLock()
_PATCH_PREVIEW_CACHE = {}
_PATCH_PREVIEW_GUARD = threading.RLock()
_PATCH_PREVIEW_TTL_SECONDS = 30 * 60
_PATCH_PREVIEW_MAX_ITEMS = 128
_PROBE_ENCODINGS = ("utf-8-sig", "utf-8", "gbk", "utf-16", "utf-16-le", "utf-16-be")
_PROBE_CHUNK_SIZE = 64 * 1024

TOOL_MANIFEST = [
    {
        "name": "local_file_read",
        "handler": "file_read",
        "description": "读取用户本地计算机上指定文件的内容（NexoraCode 本地工具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件绝对路径"},
                "encoding": {"type": "string", "default": "utf-8"},
                "start_line": {"type": "integer", "description": "可选。按行读取的起始行，1 表示第一行，必须和 end_line 同时提供。"},
                "end_line": {"type": "integer", "description": "可选。按行读取的结束行，包含该行，必须和 start_line 同时提供。"},
                "offset": {"type": "integer", "description": "可选。按字符读取的起始位置，0 表示第一个字符，必须和 limit 同时提供。"},
                "limit": {"type": "integer", "description": "可选。按字符读取的字符数量，必须和 offset 同时提供。"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "local_file_probe",
        "handler": "file_probe",
        "description": "探测用户本地计算机上指定文件的元信息，不返回文件正文（NexoraCode 本地工具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件绝对路径"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "local_file_write",
        "handler": "file_write",
        "description": "将内容写入用户本地计算机上的指定文件，会覆盖原有内容（NexoraCode 本地工具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件绝对路径"},
                "content": {"type": "string", "description": "写入内容"},
                "encoding": {"type": "string", "default": "utf-8"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "local_file_list",
        "handler": "file_list",
        "description": "列出用户本地计算机指定目录下的文件和子目录（NexoraCode 本地工具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "目录绝对路径"},
            },
            "required": ["path"],
        },
    },
]


def _check_allowed(target: Path) -> bool:
    allowed_dirs: list = config.get("allowed_dirs", [])
    if not allowed_dirs:
        # 未配置白名单：拒绝，提示用户在设置中添加
        return False
    resolved = target.resolve()
    for d in allowed_dirs:
        allowed_root = Path(d).resolve()
        try:
            resolved.relative_to(allowed_root)
            return True
        except ValueError:
            continue
    return False


def _sha256_text(content: str, encoding: str) -> str:
    return hashlib.sha256(content.encode(encoding)).hexdigest()


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _get_file_lock(path: Path):
    """同一路径的读改写流程必须串行，避免并发 patch 覆盖彼此结果。"""
    lock_key = str(path.resolve())

    with _FILE_LOCKS_GUARD:
        if lock_key not in _FILE_LOCKS:
            _FILE_LOCKS[lock_key] = threading.RLock()

        return _FILE_LOCKS[lock_key]


def _detect_bom(content: bytes) -> str:
    if content.startswith(b"\xff\xfe\x00\x00"):
        return "utf-32-le"

    if content.startswith(b"\x00\x00\xfe\xff"):
        return "utf-32-be"

    if content.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"

    if content.startswith(b"\xff\xfe"):
        return "utf-16-le"

    if content.startswith(b"\xfe\xff"):
        return "utf-16-be"

    return ""


def _detect_line_separator(content: str) -> str:
    if "\r\n" in content:
        return "\r\n"

    if "\r" in content:
        return "\r"

    return "\n"


def _line_separator_name(content: str) -> str:
    separator = _detect_line_separator(content)

    if separator == "\r\n":
        return "crlf"

    if separator == "\r":
        return "cr"

    if "\n" in content:
        return "lf"

    return "none"


def _read_text_with_raw(path: Path, encoding: str) -> tuple[str, bytes]:
    """读取原始字节后解码，避免文本模式自动改写换行符。"""
    raw_content = path.read_bytes()
    return raw_content.decode(encoding), raw_content


def _encode_text(content: str, encoding: str) -> bytes:
    return content.encode(encoding)


def _write_bytes_atomic(path: Path, content: bytes) -> None:
    """通过临时文件和 os.replace 写入，保证单次写入不会留下半截文件。"""
    temp_path = path.with_name(f".{path.name}.nexora_patch_tmp")
    try:
        temp_path.write_bytes(content)
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def _build_file_metadata(path: Path, content: str, raw_content: bytes, encoding: str) -> dict:
    """返回给模型使用的文件版本和格式元信息。"""
    return {
        "path": str(path),
        "encoding": encoding,
        "size": len(raw_content),
        "sha256": _sha256_bytes(raw_content),
        "content_sha256": _sha256_text(content, encoding),
        "line_count": len(content.splitlines()),
        "line_separator": _line_separator_name(content),
        "has_trailing_newline": content.endswith(("\n", "\r")),
        "bom": _detect_bom(raw_content),
    }


def _build_probe_line_separator(line_endings: dict) -> str:
    active_endings = [
        name
        for name in ("crlf", "lf", "cr")
        if int(line_endings.get(name, 0)) > 0
    ]

    if not active_endings:
        return "none"

    if len(active_endings) == 1:
        return active_endings[0]

    return "mixed"


def _build_probe_encoding_checks(decoder_status: dict) -> list[dict]:
    checks = []

    for encoding in _PROBE_ENCODINGS:
        status = decoder_status.get(encoding) or {}
        item = {
            "encoding": encoding,
            "decodable": bool(status.get("decodable", False)),
        }

        if status.get("error"):
            item["error"] = str(status.get("error"))

        checks.append(item)

    return checks


def _build_probe_encoding_hint(size: int, bom: str, is_binary: bool, encoding_checks: list[dict]) -> str:
    if size == 0:
        return "empty"

    if bom:
        return bom

    if is_binary:
        return "binary"

    decodable = {
        str(item.get("encoding") or ""): bool(item.get("decodable"))
        for item in encoding_checks
        if isinstance(item, dict)
    }

    if decodable.get("utf-8") or decodable.get("utf-8-sig"):
        return "utf-8"

    if decodable.get("gbk"):
        return "gbk"

    if decodable.get("utf-16"):
        return "utf-16"

    if decodable.get("utf-16-le"):
        return "utf-16-le"

    if decodable.get("utf-16-be"):
        return "utf-16-be"

    return "unknown"


def _scan_file_probe(path: Path) -> dict:
    """逐块扫描文件字节，返回元信息，不返回正文内容。"""
    sha256 = hashlib.sha256()
    decoder_status = {
        encoding: {"decodable": True, "error": ""}
        for encoding in _PROBE_ENCODINGS
    }
    decoders = {
        encoding: codecs.getincrementaldecoder(encoding)(errors="strict")
        for encoding in _PROBE_ENCODINGS
    }
    first_bytes = bytearray()
    last_bytes = b""
    total_size = 0
    null_bytes = 0
    control_bytes = 0
    crlf_count = 0
    lf_count = 0
    cr_count = 0
    pending_cr = False

    with path.open("rb") as file_obj:

        while True:
            chunk = file_obj.read(_PROBE_CHUNK_SIZE)

            if not chunk:
                break

            sha256.update(chunk)
            total_size += len(chunk)
            null_bytes += chunk.count(0)

            if len(first_bytes) < 8:
                first_bytes.extend(chunk[:8 - len(first_bytes)])

            last_bytes = (last_bytes + chunk)[-4:]

            for byte_value in chunk:

                if byte_value < 32 and byte_value not in (9, 10, 12, 13):
                    control_bytes += 1

                if pending_cr:

                    if byte_value == 10:
                        crlf_count += 1
                        pending_cr = False
                        continue

                    cr_count += 1
                    pending_cr = False

                if byte_value == 13:
                    pending_cr = True
                elif byte_value == 10:
                    lf_count += 1

            for encoding, decoder in list(decoders.items()):

                try:
                    decoder.decode(chunk, final=False)
                except UnicodeDecodeError as exc:
                    decoder_status[encoding] = {
                        "decodable": False,
                        "error": str(exc),
                    }
                    decoders.pop(encoding, None)

    if pending_cr:
        cr_count += 1

    for encoding, decoder in list(decoders.items()):

        try:
            decoder.decode(b"", final=True)
        except UnicodeDecodeError as exc:
            decoder_status[encoding] = {
                "decodable": False,
                "error": str(exc),
            }

    bom = _detect_bom(bytes(first_bytes))
    text_bom = bom in {"utf-8-sig", "utf-16-le", "utf-16-be", "utf-32-le", "utf-32-be"}
    control_ratio = 0 if total_size == 0 else control_bytes / total_size
    has_null_bytes = null_bytes > 0
    is_binary = False
    binary_reason = ""

    if has_null_bytes and not text_bom:
        is_binary = True
        binary_reason = "contains_nul_byte"
    elif control_ratio > 0.30:
        is_binary = True
        binary_reason = "control_byte_ratio"

    line_endings = {
        "crlf": crlf_count,
        "lf": lf_count,
        "cr": cr_count,
        "total": crlf_count + lf_count + cr_count,
    }
    encoding_checks = _build_probe_encoding_checks(decoder_status)
    encoding_hint = _build_probe_encoding_hint(total_size, bom, is_binary, encoding_checks)

    return {
        "size": total_size,
        "sha256": sha256.hexdigest(),
        "bom": bom,
        "encoding_hint": encoding_hint,
        "encoding_checks": encoding_checks,
        "is_binary": is_binary,
        "binary_reason": binary_reason,
        "null_bytes": null_bytes,
        "control_bytes": control_bytes,
        "control_byte_ratio": round(control_ratio, 6),
        "line_separator": _build_probe_line_separator(line_endings),
        "line_endings": line_endings,
        "has_trailing_newline": last_bytes.endswith((b"\n", b"\r")),
    }


def _has_argument_value(value) -> bool:
    return value is not None and str(value).strip() != ""


def _parse_integer_argument(value, name: str, minimum: int) -> tuple[int, str]:
    if isinstance(value, bool):
        return 0, f"{name} 必须是整数。"

    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0, f"{name} 必须是整数。"

    if parsed < minimum:
        return 0, f"{name} 必须大于等于 {minimum}。"

    return parsed, ""


def _slice_read_content(
    content: str,
    start_line,
    end_line,
    offset,
    limit,
) -> tuple[str, str, dict, str]:
    """根据显式范围读取文件内容，范围非法时直接返回错误。"""
    line_range_requested = _has_argument_value(start_line) or _has_argument_value(end_line)
    char_range_requested = _has_argument_value(offset) or _has_argument_value(limit)

    if line_range_requested and char_range_requested:
        return "", "", {}, "start_line/end_line 不能和 offset/limit 同时使用。"

    if not line_range_requested and not char_range_requested:
        return content, "full", {}, ""

    if line_range_requested:

        if not _has_argument_value(start_line) or not _has_argument_value(end_line):
            return "", "", {}, "start_line 和 end_line 必须同时提供。"

        start, start_error = _parse_integer_argument(start_line, "start_line", 1)

        if start_error:
            return "", "", {}, start_error

        end, end_error = _parse_integer_argument(end_line, "end_line", 1)

        if end_error:
            return "", "", {}, end_error

        if end < start:
            return "", "", {}, "end_line 必须大于等于 start_line。"

        lines = content.splitlines(keepends=True)
        total_lines = len(lines)

        if total_lines == 0:
            return "", "", {}, "空文件无法按行范围读取。"

        if start > total_lines:
            return "", "", {}, f"start_line 超出文件总行数: {total_lines}。"

        if end > total_lines:
            return "", "", {}, f"end_line 超出文件总行数: {total_lines}。"

        selected_content = "".join(lines[start - 1:end])
        slice_meta = {
            "type": "line_range",
            "start_line": start,
            "end_line": end,
            "returned_lines": end - start + 1,
            "total_lines": total_lines,
        }
        return selected_content, "line_range", slice_meta, ""

    if not _has_argument_value(offset) or not _has_argument_value(limit):
        return "", "", {}, "offset 和 limit 必须同时提供。"

    start, start_error = _parse_integer_argument(offset, "offset", 0)

    if start_error:
        return "", "", {}, start_error

    read_limit, limit_error = _parse_integer_argument(limit, "limit", 1)

    if limit_error:
        return "", "", {}, limit_error

    total_chars = len(content)
    end = start + read_limit

    if start > total_chars:
        return "", "", {}, f"offset 超出文件总字符数: {total_chars}。"

    if end > total_chars:
        return "", "", {}, f"offset + limit 超出文件总字符数: {total_chars}。"

    selected_content = content[start:end]
    slice_meta = {
        "type": "char_range",
        "offset": start,
        "limit": read_limit,
        "end_offset": end,
        "returned_chars": len(selected_content),
        "total_chars": total_chars,
    }
    return selected_content, "char_range", slice_meta, ""


def _build_preview_diff(path: Path, original: str, new_content: str) -> str:
    """生成预览 diff，供 dry_run 和工具调用结果展示。"""
    if original == new_content:
        return ""

    return "".join(difflib.unified_diff(
        original.splitlines(keepends=True),
        new_content.splitlines(keepends=True),
        fromfile=f"a/{path.name}",
        tofile=f"b/{path.name}",
    ))


def _cleanup_patch_previews(now: float) -> None:
    expired_ids = [
        preview_id
        for preview_id, preview in _PATCH_PREVIEW_CACHE.items()
        if float(preview.get("expires_at", 0)) <= now
    ]

    for preview_id in expired_ids:
        _PATCH_PREVIEW_CACHE.pop(preview_id, None)

    if len(_PATCH_PREVIEW_CACHE) <= _PATCH_PREVIEW_MAX_ITEMS:
        return

    ordered_items = sorted(
        _PATCH_PREVIEW_CACHE.items(),
        key=lambda item: float(item[1].get("created_at", 0)),
    )
    remove_count = len(_PATCH_PREVIEW_CACHE) - _PATCH_PREVIEW_MAX_ITEMS

    for preview_id, _preview in ordered_items[:remove_count]:
        _PATCH_PREVIEW_CACHE.pop(preview_id, None)


def _store_patch_preview(preview: dict) -> str:
    """保存 dry_run 生成的写入预览，确认写入只能使用这份内容。"""
    now = time.time()
    preview_id = f"patch_preview_{uuid.uuid4().hex}"
    preview["preview_id"] = preview_id
    preview["created_at"] = now
    preview["expires_at"] = now + _PATCH_PREVIEW_TTL_SECONDS

    with _PATCH_PREVIEW_GUARD:
        _cleanup_patch_previews(now)
        _PATCH_PREVIEW_CACHE[preview_id] = preview

    return preview_id


def _load_patch_preview(preview_id: str) -> tuple[dict, str]:
    clean_id = str(preview_id or "").strip()

    if not clean_id:
        return {}, "confirm_preview_id 不能为空。"

    now = time.time()

    with _PATCH_PREVIEW_GUARD:
        _cleanup_patch_previews(now)
        preview = _PATCH_PREVIEW_CACHE.get(clean_id)

        if preview is None:
            return {}, "preview_id 不存在或已过期，请重新 dry_run 生成预览。"

        return dict(preview), ""


def _remove_patch_preview(preview_id: str) -> None:
    clean_id = str(preview_id or "").strip()

    if not clean_id:
        return

    with _PATCH_PREVIEW_GUARD:
        _PATCH_PREVIEW_CACHE.pop(clean_id, None)


_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _parse_unified_diff(patch_text: str) -> tuple[list[dict], str]:
    hunks = []
    current = None

    for line_number, raw_line in enumerate(patch_text.splitlines(), start=1):
        hunk_match = _HUNK_RE.match(raw_line)

        if hunk_match:
            old_start = int(hunk_match.group(1))
            old_count = int(hunk_match.group(2) or "1")
            new_start = int(hunk_match.group(3))
            new_count = int(hunk_match.group(4) or "1")
            current = {
                "old_start": old_start,
                "old_count": old_count,
                "new_start": new_start,
                "new_count": new_count,
                "lines": [],
                "line_number": line_number,
            }
            hunks.append(current)
            continue

        if current is None:

            if (
                not raw_line.strip()
                or raw_line.startswith("diff ")
                or raw_line.startswith("index ")
                or raw_line.startswith("--- ")
                or raw_line.startswith("+++ ")
            ):
                continue

            return [], f"第 {line_number} 行不是支持的统一 diff 头或 hunk。"

        if raw_line.startswith((" ", "+", "-", "\\")):
            current["lines"].append(raw_line)
            continue

        return [], f"第 {line_number} 行不是有效的 hunk 内容。"

    if not hunks:
        return [], "patch 中没有找到统一 diff hunk。"

    return hunks, ""


def _apply_unified_diff(original: str, patch_text: str) -> tuple[str, dict, str]:
    hunks, parse_error = _parse_unified_diff(patch_text)

    if parse_error:
        return original, {}, parse_error

    source_lines = original.splitlines()
    result_lines = []
    source_index = 0
    added_lines = 0
    removed_lines = 0

    for hunk in hunks:
        old_start = int(hunk["old_start"])
        old_count = int(hunk["old_count"])
        old_index = old_start if old_count == 0 else old_start - 1

        if old_index < source_index:
            return original, {}, f"第 {hunk['line_number']} 行 hunk 与前一个 hunk 范围重叠。"

        if old_index > len(source_lines):
            return original, {}, f"第 {hunk['line_number']} 行 hunk 起点超出文件范围。"

        result_lines.extend(source_lines[source_index:old_index])
        source_index = old_index
        old_seen = 0
        new_seen = 0

        for raw_line in hunk["lines"]:

            if raw_line.startswith("\\"):
                continue

            marker = raw_line[:1]
            value = raw_line[1:]

            if marker == " ":

                if source_index >= len(source_lines):
                    return original, {}, f"上下文行超出文件范围: {value}"

                if source_lines[source_index] != value:
                    return original, {}, f"上下文不匹配: 期望 `{value}`，实际 `{source_lines[source_index]}`。"

                result_lines.append(source_lines[source_index])
                source_index += 1
                old_seen += 1
                new_seen += 1
                continue

            if marker == "-":

                if source_index >= len(source_lines):
                    return original, {}, f"删除行超出文件范围: {value}"

                if source_lines[source_index] != value:
                    return original, {}, f"删除行不匹配: 期望 `{value}`，实际 `{source_lines[source_index]}`。"

                source_index += 1
                old_seen += 1
                removed_lines += 1
                continue

            if marker == "+":
                result_lines.append(value)
                new_seen += 1
                added_lines += 1
                continue

            return original, {}, f"不支持的 hunk 标记: {marker}"

        if old_seen != old_count:
            return original, {}, f"第 {hunk['line_number']} 行 hunk 的旧行数不一致: 声明 {old_count}，实际 {old_seen}。"

        if new_seen != int(hunk["new_count"]):
            return original, {}, f"第 {hunk['line_number']} 行 hunk 的新行数不一致: 声明 {hunk['new_count']}，实际 {new_seen}。"

    result_lines.extend(source_lines[source_index:])
    line_separator = _detect_line_separator(original)
    new_content = line_separator.join(result_lines)

    if original.endswith(("\n", "\r")):
        new_content += line_separator

    stats = {
        "mode": "unified_diff",
        "hunk_count": len(hunks),
        "added_lines": added_lines,
        "removed_lines": removed_lines,
    }
    return new_content, stats, ""


def _find_target_occurrence(content: str, target: str, occurrence) -> tuple[int, str]:
    if not target:
        return -1, "target 不能为空。"

    positions = []
    start = 0

    while True:
        index = content.find(target, start)

        if index < 0:
            break

        positions.append(index)
        start = index + len(target)

    if not positions:
        return -1, "target 在文件中不存在。"

    if occurrence is None:

        if len(positions) != 1:
            return -1, f"target 出现 {len(positions)} 次，请传入 occurrence 指定第几处。"

        return positions[0], ""

    try:
        occurrence_index = int(occurrence)
    except Exception:
        return -1, "occurrence 必须是正整数。"

    if occurrence_index <= 0:
        return -1, "occurrence 必须是正整数。"

    if occurrence_index > len(positions):
        return -1, f"target 只出现 {len(positions)} 次，无法选择第 {occurrence_index} 处。"

    return positions[occurrence_index - 1], ""


def _apply_structured_edits(original: str, edits: list) -> tuple[str, dict, str]:
    if not isinstance(edits, list) or not edits:
        return original, {}, "edits 必须是非空数组。"

    content = original
    applied_count = 0

    for edit_index, edit in enumerate(edits, start=1):

        if not isinstance(edit, dict):
            return original, {}, f"第 {edit_index} 个 edit 必须是对象。"

        action = str(edit.get("action") or "").strip()
        target = str(edit.get("target") or "")
        occurrence = edit.get("occurrence")
        target_index, target_error = _find_target_occurrence(content, target, occurrence)

        if target_error:
            return original, {}, f"第 {edit_index} 个 edit 失败: {target_error}"

        before = content[:target_index]
        after = content[target_index + len(target):]

        if action == "replace":
            replacement = str(edit.get("replacement") or "")
            content = before + replacement + after
        elif action == "insert_before":
            insert_content = str(edit.get("content") or "")
            content = before + insert_content + target + after
        elif action == "insert_after":
            insert_content = str(edit.get("content") or "")
            content = before + target + insert_content + after
        elif action == "delete":
            content = before + after
        else:
            return original, {}, f"第 {edit_index} 个 edit 的 action 不支持: {action}"

        applied_count += 1

    stats = {
        "mode": "structured_edits",
        "edit_count": applied_count,
        "added_lines": max(0, len(content.splitlines()) - len(original.splitlines())),
        "removed_lines": max(0, len(original.splitlines()) - len(content.splitlines())),
    }
    return content, stats, ""


def file_read(
    path: str,
    encoding: str = "utf-8",
    start_line=None,
    end_line=None,
    offset=None,
    limit=None,
) -> dict:
    p = Path(path)
    if not _check_allowed(p):
        return {"success": False, "error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}
    if not p.exists():
        return {"success": False, "error": f"File not found: {path}"}
    if not p.is_file():
        return {"success": False, "error": f"Not a file: {path}"}
    try:
        content, raw_content = _read_text_with_raw(p, encoding)
        selected_content, mode, slice_meta, slice_error = _slice_read_content(
            content,
            start_line,
            end_line,
            offset,
            limit,
        )

        if slice_error:
            return {
                "success": False,
                "error": slice_error,
                "path": str(p),
                "encoding": encoding,
                **_build_file_metadata(p, content, raw_content, encoding),
            }

        return {
            "success": True,
            "content": selected_content,
            "mode": mode,
            "slice": slice_meta,
            "total_chars": len(content),
            "returned_chars": len(selected_content),
            "returned_line_count": len(selected_content.splitlines()),
            "returned_content_sha256": _sha256_text(selected_content, encoding),
            **_build_file_metadata(p, content, raw_content, encoding),
        }
    except UnicodeDecodeError as e:
        return {
            "success": False,
            "error": f"文件无法按 {encoding} 解码: {e}",
            "encoding": encoding,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def file_probe(path: str) -> dict:
    p = Path(path)

    if not _check_allowed(p):
        return {"success": False, "error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}

    if not p.exists():
        return {"success": False, "error": f"File not found: {path}"}

    if not p.is_file():
        return {"success": False, "error": f"Not a file: {path}"}

    try:
        stat_result = p.stat()
        probe_result = _scan_file_probe(p)

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


def file_write(path: str, content: str, encoding: str = "utf-8") -> dict:
    p = Path(path)
    if not _check_allowed(p):
        return {"success": False, "error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        raw_content = _encode_text(content, encoding)

        with _get_file_lock(p):
            _write_bytes_atomic(p, raw_content)

        return {
            "success": True,
            "path": str(p),
            "encoding": encoding,
            "bytes_written": len(raw_content),
            "sha256": _sha256_bytes(raw_content),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def _build_patch_preview_locked(
    p: Path,
    patch_text: str,
    has_patch: bool,
    edits: list,
    encoding: str,
    expected_sha256: str,
) -> dict:
    """执行 patch 校验并生成确认写入预览。调用方必须持有该文件锁。"""
    original, old_raw_content = _read_text_with_raw(p, encoding)
    old_sha256 = _sha256_bytes(old_raw_content)
    old_content_sha256 = _sha256_text(original, encoding)

    if expected_sha256 and str(expected_sha256).strip().lower() != old_sha256:
        return {
            "success": False,
            "error": "文件内容 SHA256 与 expected_sha256 不一致，已拒绝修改。",
            "actual_sha256": old_sha256,
            "expected_sha256": str(expected_sha256).strip().lower(),
        }

    if has_patch:
        new_content, stats, apply_error = _apply_unified_diff(original, patch_text)
    else:
        new_content, stats, apply_error = _apply_structured_edits(original, edits)

    if apply_error:
        return {"success": False, "error": apply_error, "old_sha256": old_sha256}

    new_raw_content = _encode_text(new_content, encoding)
    new_sha256 = _sha256_bytes(new_raw_content)
    new_content_sha256 = _sha256_text(new_content, encoding)
    preview_diff = _build_preview_diff(p, original, new_content)

    if new_content == original:
        preview = {
            "path": str(p),
            "resolved_path": str(p.resolve()),
            "encoding": encoding,
            "changed": False,
            "old_sha256": old_sha256,
            "new_sha256": old_sha256,
            "old_content_sha256": old_content_sha256,
            "new_content_sha256": old_content_sha256,
            "new_raw_content": old_raw_content,
            "diff": "",
            "line_separator": _line_separator_name(original),
            "bom": _detect_bom(old_raw_content),
            "bytes_to_write": len(old_raw_content),
            "stats": dict(stats),
        }
        preview_id = _store_patch_preview(preview)

        return {
            "success": True,
            "changed": False,
            "dry_run": True,
            "requires_confirm": False,
            "preview_id": preview_id,
            "preview_expires_in_seconds": _PATCH_PREVIEW_TTL_SECONDS,
            "path": str(p),
            "encoding": encoding,
            "old_sha256": old_sha256,
            "new_sha256": old_sha256,
            "old_content_sha256": old_content_sha256,
            "new_content_sha256": old_content_sha256,
            "diff": "",
            "line_separator": _line_separator_name(original),
            "bom": _detect_bom(old_raw_content),
            **stats,
        }

    preview = {
        "path": str(p),
        "resolved_path": str(p.resolve()),
        "encoding": encoding,
        "changed": True,
        "old_sha256": old_sha256,
        "new_sha256": new_sha256,
        "old_content_sha256": old_content_sha256,
        "new_content_sha256": new_content_sha256,
        "new_raw_content": new_raw_content,
        "diff": preview_diff,
        "line_separator": _line_separator_name(new_content),
        "bom": _detect_bom(new_raw_content),
        "bytes_to_write": len(new_raw_content),
        "stats": dict(stats),
    }
    preview_id = _store_patch_preview(preview)

    result = {
        "success": True,
        "changed": True,
        "dry_run": True,
        "requires_confirm": True,
        "preview_id": preview_id,
        "preview_expires_in_seconds": _PATCH_PREVIEW_TTL_SECONDS,
        "path": str(p),
        "encoding": encoding,
        "old_sha256": old_sha256,
        "new_sha256": new_sha256,
        "old_content_sha256": old_content_sha256,
        "new_content_sha256": new_content_sha256,
        "bytes_to_write": len(new_raw_content),
        "diff": preview_diff,
        "line_separator": _line_separator_name(new_content),
        "bom": _detect_bom(new_raw_content),
        **stats,
    }

    return result


def _confirm_patch_preview_locked(p: Path, preview_id: str) -> dict:
    """按 dry_run 保存的预览内容写入文件。调用方必须持有该文件锁。"""
    preview, preview_error = _load_patch_preview(preview_id)

    if preview_error:
        return {"success": False, "error": preview_error}

    if str(p.resolve()) != str(preview.get("resolved_path") or ""):
        return {
            "success": False,
            "error": "confirm_preview_id 对应的文件路径与当前 path 不一致，已拒绝写入。",
            "preview_path": preview.get("path", ""),
            "path": str(p),
        }

    preview_encoding = str(preview.get("encoding") or "")
    expected_sha256 = str(preview.get("old_sha256") or "")
    new_sha256 = str(preview.get("new_sha256") or "")
    old_content_sha256 = str(preview.get("old_content_sha256") or "")
    new_content_sha256 = str(preview.get("new_content_sha256") or "")

    if not preview_encoding or not expected_sha256 or not new_sha256:
        return {"success": False, "error": "preview 版本信息不完整，请重新 dry_run 生成预览。"}

    if not old_content_sha256 or not new_content_sha256:
        return {"success": False, "error": "preview 内容哈希不完整，请重新 dry_run 生成预览。"}

    if not isinstance(preview.get("stats"), dict):
        return {"success": False, "error": "preview 统计信息不完整，请重新 dry_run 生成预览。"}

    if "bytes_to_write" not in preview or "diff" not in preview or "line_separator" not in preview or "bom" not in preview:
        return {"success": False, "error": "preview 写入信息不完整，请重新 dry_run 生成预览。"}

    try:
        bytes_to_write = int(preview.get("bytes_to_write"))
    except (TypeError, ValueError):
        return {"success": False, "error": "preview 写入字节数无效，请重新 dry_run 生成预览。"}

    original, old_raw_content = _read_text_with_raw(p, preview_encoding)
    actual_sha256 = _sha256_bytes(old_raw_content)

    if actual_sha256 != expected_sha256:
        return {
            "success": False,
            "error": "文件内容已变化，confirm_preview_id 对应的预览不再可写入，请重新 dry_run。",
            "actual_sha256": actual_sha256,
            "expected_sha256": expected_sha256,
            "path": str(p),
        }

    stats = dict(preview.get("stats"))
    changed = bool(preview.get("changed", False))
    new_raw_content = preview.get("new_raw_content")

    if not isinstance(new_raw_content, bytes):
        return {"success": False, "error": "preview 内容无效，请重新 dry_run 生成预览。"}

    if changed:
        _write_bytes_atomic(p, new_raw_content)

    _remove_patch_preview(preview_id)

    result = {
        "success": True,
        "changed": changed,
        "dry_run": False,
        "confirmed_preview_id": str(preview_id or "").strip(),
        "path": str(p),
        "encoding": preview_encoding,
        "old_sha256": expected_sha256,
        "new_sha256": new_sha256,
        "old_content_sha256": old_content_sha256,
        "new_content_sha256": new_content_sha256,
        "bytes_to_write": bytes_to_write,
        "diff": str(preview.get("diff")),
        "line_separator": str(preview.get("line_separator")),
        "bom": str(preview.get("bom")),
        **stats,
    }

    if changed:
        result["bytes_written"] = len(new_raw_content)

    return result


def file_patch(
    path: str,
    patch: str = "",
    edits: list = None,
    encoding: str = "utf-8",
    expected_sha256: str = "",
    dry_run: bool = False,
    confirm_preview_id: str = "",
) -> dict:
    """对单个文件执行精确 patch，支持统一 diff 或结构化编辑。"""
    p = Path(path)

    if not _check_allowed(p):
        return {"success": False, "error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}

    if not p.exists():
        return {"success": False, "error": f"File not found: {path}"}

    if not p.is_file():
        return {"success": False, "error": f"Not a file: {path}"}

    patch_text = str(patch or "")
    has_patch = bool(patch_text.strip())
    has_edits = isinstance(edits, list) and len(edits) > 0
    has_confirm_preview = bool(str(confirm_preview_id or "").strip())

    if has_confirm_preview:

        if dry_run:
            return {"success": False, "error": "confirm_preview_id 不能和 dry_run=true 同时使用。"}

        if has_patch or has_edits:
            return {"success": False, "error": "确认写入时只能传入 path 和 confirm_preview_id，不能重新传 patch 或 edits。"}

        if expected_sha256:
            return {"success": False, "error": "确认写入时不能重新传 expected_sha256，版本锁以 dry_run 预览为准。"}

        try:
            with _get_file_lock(p):
                return _confirm_patch_preview_locked(p, confirm_preview_id)
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
        with _get_file_lock(p):
            return _build_patch_preview_locked(
                p,
                patch_text,
                has_patch,
                edits,
                encoding,
                expected_sha256,
            )
    except UnicodeDecodeError as e:
        return {
            "success": False,
            "error": f"文件无法按 {encoding} 解码: {e}",
            "encoding": encoding,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def file_list(path: str) -> dict:
    p = Path(path)
    if not _check_allowed(p):
        return {"success": False, "error": f"Path not in allowed_dirs: {path}. Add it in NexoraCode settings."}
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
