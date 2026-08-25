"""
NexoraCode.local.tools.CodeScanTool — 代码结构扫描工具

local_code_scan：按文件类型用行级标识提取类 / 函数 / 方法符号，
返回"符号名 + 行号"的代码地图，供模型快速了解项目结构后再精读目标位置。
"""

from __future__ import annotations

import re
from pathlib import Path

from ..PathGuard import build_permission_required, is_sensitive_path, resolve_allowed_path
from ..Tool import LocalTool, ToolContext


MAX_FILE_BYTES = 1024 * 1024
MAX_TOTAL_SYMBOLS = 4000

SKIP_DIR_NAMES = {
    ".git", ".svn", ".idea", ".vscode", "__pycache__", "node_modules",
    "venv", ".venv", "env", "dist", "build", "target", "vendor", ".next",
}

JS_METHOD_EXCLUDES = {
    "if", "for", "while", "switch", "catch", "return", "else", "do",
    "new", "typeof", "function", "async", "await", "constructor",
}

C_FUNCTION_EXCLUDES = {"if", "for", "while", "switch", "return", "sizeof", "defined"}


class CodeScanTool(LocalTool):
    name = "local_code_scan"
    description = (
        "扫描本地项目代码结构（NexoraCode 本地工具）：按文件类型提取类、函数、方法符号列表，"
        "返回符号名与行号构成的代码地图。支持 Python/JS/TS/C/C++/Java/C#/Go/Rust。"
        "用于接手项目时快速了解代码结构，再用 local_file_read 按行号精读目标位置，避免盲目通读文件。"
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "要扫描的文件或目录路径（目录会递归，自动跳过依赖/构建目录）。"},
            "max_files": {"type": "integer", "default": 200, "description": "最多扫描的代码文件数，上限 1000。"},
        },
        "required": ["path"],
    }

    def run(self, args: dict, context: ToolContext) -> dict:
        path = str(args.get("path") or "").strip()

        resolved, error = resolve_allowed_path(path, context=context.as_dict(), access="read")

        if error:
            return build_permission_required(
                path,
                operation="read",
                sensitive=is_sensitive_path(Path(str(path or ""))),
            )

        root = Path(resolved)

        if not root.exists():
            return {"success": False, "error": f"Path not found: {path}"}

        if root.is_file() and root.suffix.lower() not in LANGUAGE_SCANNERS:
            return {"success": False, "error": f"Unsupported file type: {root.suffix}"}

        try:
            max_files = int(args.get("max_files") or 200)
        except (TypeError, ValueError):
            max_files = 200

        safe_max_files = max(1, min(max_files, 1000))
        files = _iter_code_files(root, safe_max_files)
        results = []
        total_symbols = 0
        skipped = 0
        truncated = False

        for file_path in files:
            try:
                if file_path.stat().st_size > MAX_FILE_BYTES:
                    skipped += 1
                    continue

                text = file_path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                skipped += 1
                continue

            language, scanner = LANGUAGE_SCANNERS[file_path.suffix.lower()]
            symbols = scanner(text.splitlines())

            if not symbols:
                continue

            if total_symbols + len(symbols) > MAX_TOTAL_SYMBOLS:
                symbols = symbols[:MAX_TOTAL_SYMBOLS - total_symbols]
                truncated = True

            relative = str(file_path.relative_to(root)) if root.is_dir() else file_path.name
            results.append({"file": relative, "language": language, "symbols": symbols})
            total_symbols += len(symbols)

            if truncated:
                break

        return {
            "success": True,
            "root": str(root),
            "scanned_files": len(files),
            "skipped_files": skipped,
            "total_symbols": total_symbols,
            "truncated": truncated,
            "files": results,
        }


def _scan_python(lines):
    """Python：class/def 提取，靠缩进把 def 归属到最近的 class（输出 Class.method）。"""

    symbols = []
    class_stack = []

    for line_no, line in enumerate(lines, 1):
        class_match = re.match(r"^(\s*)class\s+(\w+)", line)
        def_match = re.match(r"^(\s*)(?:async\s+)?def\s+(\w+)", line)

        if class_match:
            indent = len(class_match.group(1).expandtabs(4))

            while class_stack and class_stack[-1][0] >= indent:
                class_stack.pop()

            class_stack.append((indent, class_match.group(2)))
            symbols.append({"type": "class", "name": class_match.group(2), "line": line_no})

        elif def_match:
            indent = len(def_match.group(1).expandtabs(4))

            while class_stack and class_stack[-1][0] >= indent:
                class_stack.pop()

            if class_stack:
                symbols.append({
                    "type": "method",
                    "name": f"{class_stack[-1][1]}.{def_match.group(2)}",
                    "line": line_no,
                })
            else:
                symbols.append({"type": "function", "name": def_match.group(2), "line": line_no})

    return symbols


def _scan_javascript(lines):
    """JS/TS：function 声明、class 声明、箭头函数赋值、类方法。"""

    symbols = []

    for line_no, line in enumerate(lines, 1):
        func_match = re.match(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)", line)

        if func_match:
            symbols.append({"type": "function", "name": func_match.group(1), "line": line_no})
            continue

        class_match = re.match(r"^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)", line)

        if class_match:
            symbols.append({"type": "class", "name": class_match.group(1), "line": line_no})
            continue

        arrow_match = re.match(
            r"^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|\w+\s*=>)",
            line,
        )

        if arrow_match:
            symbols.append({"type": "function", "name": arrow_match.group(1), "line": line_no})
            continue

        method_match = re.match(r"^\s{2,}(?:static\s+|async\s+|get\s+|set\s+)*(\w+)\s*\([^)]*\)\s*\{\s*$", line)

        if method_match and method_match.group(1) not in JS_METHOD_EXCLUDES:
            symbols.append({"type": "method", "name": method_match.group(1), "line": line_no})

    return symbols


def _scan_c_like(lines):
    """C/C++：顶层函数签名（行尾带 {）与 class/struct 声明。"""

    symbols = []

    for line_no, line in enumerate(lines, 1):
        type_match = re.match(r"^\s*(?:typedef\s+)?(?:class|struct)\s+(\w+)", line)

        if type_match:
            symbols.append({"type": "class", "name": type_match.group(1), "line": line_no})
            continue

        func_match = re.match(r"^[A-Za-z_][\w\s\*&:<>,]*?[\s\*](\w+)\s*\([^;{}]*\)\s*\{", line)

        if func_match and func_match.group(1) not in C_FUNCTION_EXCLUDES:
            symbols.append({"type": "function", "name": func_match.group(1), "line": line_no})

    return symbols


def _scan_java_like(lines):
    """Java/C#：class/interface/enum 与带访问修饰符的方法。"""

    symbols = []

    for line_no, line in enumerate(lines, 1):
        type_match = re.match(r"^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|sealed\s+)*(?:class|interface|enum)\s+(\w+)", line)

        if type_match:
            symbols.append({"type": "class", "name": type_match.group(1), "line": line_no})
            continue

        method_match = re.match(
            r"^\s+(?:public|private|protected)[\w\s<>\[\],\?]*?\s(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{",
            line,
        )

        if method_match:
            symbols.append({"type": "method", "name": method_match.group(1), "line": line_no})

    return symbols


def _scan_go(lines):
    """Go：func（含接收者方法）与 type struct/interface。"""

    symbols = []

    for line_no, line in enumerate(lines, 1):
        func_match = re.match(r"^func\s+(?:\([^)]+\)\s*)?(\w+)\s*\(", line)

        if func_match:
            symbols.append({"type": "function", "name": func_match.group(1), "line": line_no})
            continue

        type_match = re.match(r"^type\s+(\w+)\s+(?:struct|interface)\b", line)

        if type_match:
            symbols.append({"type": "class", "name": type_match.group(1), "line": line_no})

    return symbols


def _scan_rust(lines):
    """Rust：fn 与 struct/enum/trait。"""

    symbols = []

    for line_no, line in enumerate(lines, 1):
        func_match = re.match(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)", line)

        if func_match:
            symbols.append({"type": "function", "name": func_match.group(1), "line": line_no})
            continue

        type_match = re.match(r"^\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)", line)

        if type_match:
            symbols.append({"type": "class", "name": type_match.group(1), "line": line_no})

    return symbols


LANGUAGE_SCANNERS = {
    ".py": ("python", _scan_python),
    ".js": ("javascript", _scan_javascript),
    ".jsx": ("javascript", _scan_javascript),
    ".mjs": ("javascript", _scan_javascript),
    ".cjs": ("javascript", _scan_javascript),
    ".ts": ("typescript", _scan_javascript),
    ".tsx": ("typescript", _scan_javascript),
    ".c": ("c", _scan_c_like),
    ".h": ("c", _scan_c_like),
    ".cpp": ("cpp", _scan_c_like),
    ".cc": ("cpp", _scan_c_like),
    ".hpp": ("cpp", _scan_c_like),
    ".java": ("java", _scan_java_like),
    ".cs": ("csharp", _scan_java_like),
    ".go": ("go", _scan_go),
    ".rs": ("rust", _scan_rust),
}


def _iter_code_files(root: Path, max_files: int):
    """递归收集受支持的代码文件，跳过依赖/构建等目录，按路径排序保证输出稳定。"""

    collected = []

    if root.is_file():
        return [root]

    stack = [root]

    while stack and len(collected) < max_files:
        current = stack.pop()

        try:
            entries = sorted(current.iterdir(), reverse=True)
        except OSError:
            continue

        for entry in entries:
            if entry.name.startswith(".") or entry.name in SKIP_DIR_NAMES:
                continue

            if entry.is_dir():
                stack.append(entry)
                continue

            if entry.suffix.lower() in LANGUAGE_SCANNERS:
                collected.append(entry)

                if len(collected) >= max_files:
                    break

    collected.sort()
    return collected
