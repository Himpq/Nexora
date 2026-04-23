"""
datastorage.py — 统一的数据存储层
负责所有 JSON / 文本文件的安全读写、锁管理和备份。
上层模块（database.py, conversation_manager.py 等）应通过此模块进行文件 IO。

核心保证:
  1. 所有写入都是原子的 (tmp → fsync → rename)，崩溃不会产生半截文件
  2. 所有读-改-写操作在同一把锁内完成，消除并发覆盖
  3. 写入前自动保留 .bak 备份，可用于灾后恢复
"""

import json
import os
import shutil
import threading
from typing import Any, Dict, Optional


# ==================== 锁管理 ====================

_user_locks: Dict[str, threading.RLock] = {}
_user_locks_guard = threading.Lock()

_path_locks: Dict[str, threading.RLock] = {}
_path_locks_guard = threading.Lock()

# 全局文件锁 — 用于保护少量共享文件（如 user.json），兼容旧代码
global_file_lock = threading.Lock()


def get_user_lock(username: str) -> threading.RLock:
    """
    获取用户级别的锁。
    同一用户的所有知识库 / 配置写入共享同一把锁。
    """
    key = str(username or "").strip() or "__anonymous__"
    with _user_locks_guard:
        lock = _user_locks.get(key)
        if lock is None:
            # Use re-entrant lock to avoid self-deadlock when a locked operation
            # writes timeline or other user-scoped files that also request this lock.
            lock = threading.RLock()
            _user_locks[key] = lock
        return lock


def get_path_lock(path: str) -> threading.RLock:
    """
    获取路径级别的可重入锁。
    适用于需要按文件路径粒度加锁的场景（如单个会话文件）。
    """
    normalized = os.path.normpath(os.path.abspath(str(path or "")))
    with _path_locks_guard:
        lock = _path_locks.get(normalized)
        if lock is None:
            lock = threading.RLock()
            _path_locks[normalized] = lock
        return lock


# ==================== 安全读取 ====================


def safe_read_json(
    path: str,
    default: Any = None,
    ensure_dict: bool = False,
) -> Any:
    """
    安全地读取一个 JSON 文件。

    - 文件不存在 → 返回 default
    - 编码异常 → 尝试 utf-8-sig / 容错解码
    - 解析失败 → 返回 default
    - ensure_dict=True 时，若解析结果不是 dict 也返回 default
    """
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return default
    except Exception:
        return default

    if not raw:
        return default

    # 尝试多种编码
    for encoding in ("utf-8", "utf-8-sig"):
        try:
            parsed = json.loads(raw.decode(encoding))
            if ensure_dict and not isinstance(parsed, dict):
                return default
            return parsed
        except UnicodeDecodeError:
            continue
        except json.JSONDecodeError:
            break
        except Exception:
            break

    # 最后兜底：用 errors='replace' 容错解码
    try:
        parsed = json.loads(raw.decode("utf-8", errors="replace"))
        if ensure_dict and not isinstance(parsed, dict):
            return default
        return parsed
    except Exception:
        return default


def safe_read_text(path: str, default: str = "") -> str:
    """
    安全读取文本文件。

    依次尝试 utf-8 → utf-8-sig → utf-8(replace)。
    """
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return default
    except Exception:
        return default

    for encoding in ("utf-8", "utf-8-sig"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
        except Exception:
            break

    try:
        return raw.decode("utf-8", errors="replace")
    except Exception:
        return default


# ==================== 安全写入 ====================


def safe_write_json(
    path: str,
    payload: Any,
    *,
    indent: int = 4,
    backup: bool = True,
) -> None:
    """
    原子写入 JSON 文件。

    步骤:
      1. 将 payload 序列化为 JSON 文本
      2. 回读验证（确认是合法 JSON）
      3. 写入 .tmp 临时文件
      4. fsync 刷盘
      5. 若原文件存在且 backup=True，则复制为 .bak
      6. os.replace 原子替换

    如果任何步骤失败，原文件保持不变。
    """
    path = str(path or "").strip()
    if not path:
        raise ValueError("path is required")

    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)

    temp_path = f"{path}.tmp"
    backup_path = f"{path}.bak"

    try:
        # Step 1-2: 序列化 + 回读验证
        text = json.dumps(payload, ensure_ascii=False, indent=indent)
        json.loads(text)  # 验证序列化结果是合法 JSON

        # Step 3-4: 写入临时文件 + fsync
        with open(temp_path, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())

        # Step 5: 备份旧文件
        if backup and os.path.exists(path):
            try:
                shutil.copy2(path, backup_path)
            except Exception:
                pass  # 备份失败不应阻止写入

        # Step 6: 原子替换
        os.replace(temp_path, path)

    except Exception:
        # 清理临时文件
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass
        raise


def safe_write_text(
    path: str,
    content: str,
    *,
    backup: bool = False,
) -> None:
    """
    原子写入文本文件。

    与 safe_write_json 相同的 tmp → fsync → replace 模式。
    """
    path = str(path or "").strip()
    if not path:
        raise ValueError("path is required")

    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)

    temp_path = f"{path}.tmp"
    backup_path = f"{path}.bak"

    try:
        with open(temp_path, "w", encoding="utf-8") as f:
            f.write(str(content or ""))
            f.flush()
            os.fsync(f.fileno())

        if backup and os.path.exists(path):
            try:
                shutil.copy2(path, backup_path)
            except Exception:
                pass

        os.replace(temp_path, path)
    except Exception:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass
        raise


# ==================== 复合操作 ====================


def locked_read_modify_write_json(
    path: str,
    lock: threading.Lock,
    modifier,
    *,
    default: Any = None,
    indent: int = 4,
    backup: bool = True,
) -> Any:
    """
    在锁保护下执行 读取 → 修改 → 写回 的完整事务。

    Args:
        path: JSON 文件路径
        lock: 要持有的锁
        modifier: 回调函数 modifier(data) -> result
                  - 在锁内被调用
                  - 可以原地修改 data
                  - 返回值作为本函数的返回值
        default: 文件不存在时的默认值
        indent: JSON 缩进
        backup: 是否保留 .bak

    Returns:
        modifier 的返回值
    """
    with lock:
        data = safe_read_json(path, default=default)
        result = modifier(data)
        safe_write_json(path, data, indent=indent, backup=backup)
        return result


def ensure_file_exists(
    path: str,
    default_content: Any = None,
    *,
    is_json: bool = True,
) -> None:
    """
    确保文件存在。若不存在则使用 default_content 安全创建。
    """
    if os.path.exists(path):
        return

    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)

    if is_json:
        safe_write_json(path, default_content, backup=False)
    else:
        safe_write_text(path, str(default_content or ""), backup=False)


# ==================== 流式增量操作 (JSONL) ====================

def safe_append_jsonl(path: str, item: Any, *, lock: Optional[threading.RLock] = None) -> None:
    """
    极速且并发安全地在文件末尾追加一行 JSON。
    适用于极高频写入的纯追加日志 (如 timeline.jsonl)。
    """
    path = str(path or "").strip()
    if not path:
        raise ValueError("path is required")

    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)

    line = json.dumps(item, ensure_ascii=False) + "\n"
    
    if lock:
        with lock:
            with open(path, "a", encoding="utf-8") as f:
                f.write(line)
                f.flush()
    else:
        with get_path_lock(path):
            with open(path, "a", encoding="utf-8") as f:
                f.write(line)
                f.flush()


def safe_read_jsonl_tail(path: str, limit: int = 120) -> list:
    """
    极速逆向读取 .jsonl 文件的最后 limit 行。
    不用加载全量数据即可获取最新日志，有效规避超大文件性能瓶颈。
    返回的列表第一项是最新记录 (倒序)。
    """
    lim = max(1, int(limit))
    if not os.path.exists(path):
        return []
    
    lines = []
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            file_size = f.tell()
            block_size = 65536 # 64KB
            offset = 0
            overflow = b""
            
            while len(lines) < lim and offset < file_size:
                read_size = min(block_size, file_size - offset)
                offset += read_size
                f.seek(file_size - offset, 0)
                
                chunk = f.read(read_size) + overflow
                split_lines = chunk.split(b'\n')
                
                if offset < file_size:
                    overflow = split_lines[0]
                    complete_lines = split_lines[1:]
                else:
                    complete_lines = split_lines
                    
                lines = complete_lines + lines
                
                if len(lines) >= lim + (0 if offset >= file_size else 1):
                    break
                    
        # 截取最后的 lim 行
        lines = lines[-lim:]
        
        result = []
        for raw_line in reversed(lines):  # 最新发生的在前
            if not raw_line.strip():
                continue
            try:
                text = raw_line.decode('utf-8', errors='replace')
                result.append(json.loads(text))
            except Exception:
                pass
        return result
    except Exception:
        return []

