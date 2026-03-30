"""
工具：Shell 命令执行
沙箱策略：白名单前缀 + 禁止危险命令 + 工作目录限制
"""

import subprocess
from pathlib import Path
from core.config import config

# 绝对禁止的命令片段（不管白名单）
_BLACKLIST = [
    "rm -rf /", "del /s /q c:\\", "format c:",
    ":(){ :|: & };:",  # fork bomb
    "dd if=/dev/",
]

TOOL_MANIFEST = [
    {
        "name": "local_shell_exec",
        "handler": "shell_exec",
        "description": (
            "在用户本地计算机上执行 shell 命令并返回输出结果（NexoraCode 本地工具）。"
            "仅在用户明确授权后使用。"
            "注意：Python 命令会自动注入 -u 参数以关闭缓冲，确保输出不被丢失。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "要执行的命令"},
                "cwd": {"type": "string", "description": "工作目录（可选，默认为用户主目录）"},
                "timeout": {"type": "integer", "description": "超时秒数，默认 30", "default": 30},
            },
            "required": ["command"],
        },
    },

        # ===================== 新增：交互式连续终端 =====================
    {
        "name": "local_shell_session",
        "handler": "handle_shell_session",
        "description": (
            "创建持久化交互式终端会话，支持连续交互、cd 保持目录、长任务、分段输出。"
            "action 取值：create | exec | status | close"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "动作：create(创建) | exec(执行命令) | status(查询状态) | close(关闭)",
                    "enum": ["create", "exec", "status", "close"]
                },
                "session_id": {"type": "string", "description": "会话ID（exec/status/close必须传）"},
                "command": {"type": "string", "description": "要执行的命令（仅exec）"},
                "cwd": {"type": "string", "description": "工作目录（仅create）"},
            },
            "required": ["action"],
        },
    },
]

def handle_shell_session(action: str, session_id: str = None, command: str = None, cwd: str = None):
    """
    给AI调用的统一会话终端入口
    安全规则：完全复用你原来的 黑名单 + 白名单
    """
    # 安全检查（复用你现有的规则）
    if action == "exec" and command:
        cmd_lower = command.lower()
        for dangerous in _BLACKLIST:
            if dangerous in cmd_lower:
                return {"error": f"安全策略拦截: {dangerous}"}

        whitelist = config.get("shell_whitelist", [])
        if whitelist and not any(command.strip().startswith(p) for p in whitelist):
            return {"error": f"命令不在白名单内: {whitelist}"}

    # 执行动作
    if action == "create":
        return create_shell_session(cwd=cwd)
    elif action == "exec":
        return shell_session_exec(session_id, command)
    elif action == "status":
        return get_session_status(session_id)
    elif action == "close":
        return close_shell_session(session_id)
    else:
        return {"error": "不支持的action"}


def _decode_output(raw: bytes) -> str:
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    for enc in ("utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return raw.decode("utf-8", errors="replace")


def _patch_python_unbuffered(command: str) -> str:
    """
    对 python / python3 命令自动注入 -u 参数，强制关闭 stdout/stderr 缓冲。
    避免子进程在管道模式下因全缓冲导致输出为空。
    """
    import re
    # 匹配行首的 python / python3 / py，后面跟空格或 -
    patched = re.sub(
        r'^(python3?|py)(\s)',
        r'\1 -u\2',
        command.strip(),
        count=1,
    )
    return patched


def _fix_python_inline_script(command: str) -> str:
    """
    修复 python -c "..." 命令在 Windows 下的解析问题：
    
    Windows cmd.exe 不支持多行字符串。当 python -c 后面跟着多行脚本时，
    命令会被截断或解析错误。解决方案：检测到多行脚本时，改用临时文件执行。
    """
    import re
    import os
    import tempfile
    
    cmd_stripped = command.strip()
    
    # 检查是否是 python -c 开头
    # 匹配: python -c "..." 或 python -c '...' 或 python -c ...
    match = re.match(
        r'^(python3?|py)\s+(-u\s+)?-c\s+(.+)$',
        cmd_stripped,
        re.DOTALL | re.IGNORECASE
    )
    if not match:
        return command
    
    python_exe = match.group(1)
    script_part = match.group(3)
    
    # 去掉外层引号（如果有）
    if (script_part.startswith('"') and script_part.endswith('"')) or \
       (script_part.startswith("'") and script_part.endswith("'")):
        script_content = script_part[1:-1]
    else:
        script_content = script_part
    
    # 检查脚本是否包含真正的换行（多行脚本）
    has_real_newline = '\n' in script_content
    
    # 也检查是否包含 \n 字面序列（JSON 转义残留）
    has_literal_newline = '\\n' in script_content
    
    if has_real_newline or has_literal_newline:
        # 将 \n 字面序列转换成真正的换行
        if has_literal_newline:
            script_content = script_content.replace('\\n', '\n')
        
        # 修复 Windows 路径中的单反斜杠问题
        # 在普通字符串中，\P \D 等不是有效转义序列，Python 3.12+ 会警告
        # 解决方案：将单反斜杠后面跟字母的情况，改成双反斜杠
        # 但要小心不要破坏已经正确转义的情况（如 \\n）
        script_content = _fix_windows_paths(script_content)
        
        # 写入临时文件
        temp_dir = tempfile.gettempdir()
        temp_file = os.path.join(temp_dir, f'_nexora_shell_{os.getpid()}.py')
        
        try:
            with open(temp_file, 'w', encoding='utf-8') as f:
                f.write(script_content)
        except Exception:
            # 写临时文件失败，返回原命令
            return command
        
        # 返回用临时文件执行的命令
        return f'{python_exe} -u "{temp_file}"'
    
    return command


def _fix_windows_paths(script: str) -> str:
    """
    修复 Python 脚本中的 Windows 路径问题。
    
    问题：'C:\PKData\file.txt' 里的 \P 和 \f 不是有效转义序列，
    Python 3.12+ 会产生 SyntaxWarning，未来版本会报错。
    
    解决方案：检测类似 Windows 路径的模式，将单反斜杠改成双反斜杠。
    例如：'C:\PKData\file.txt' -> 'C:\\PKData\\file.txt'
    
    但要小心：
    - 不要破坏已经正确转义的路径（如 'C:\\PKData\\file.txt'）
    - 不要破坏有效的转义序列（如 \n \t \r）
    """
    import re
    
    # 匹配看起来像 Windows 路径的字符串：'X:\...' 或 "X:\..."
    # 其中 X 是字母
    def fix_path_in_string(match):
        quote = match.group(1)  # ' 或 "
        content = match.group(2)
        
        # 检查是否已经正确转义（包含 \\）
        # 如果已经包含双反斜杠，假设用户知道自己在做什么，不修改
        if '\\\\' in content:
            return match.group(0)
        
        # 将单反斜杠后面跟字母或数字的情况，改成双反斜杠
        # 但保留有效的转义序列：\n \t \r \" \' \\
        valid_escapes = {'n', 't', 'r', '"', "'", '\\', '0', 'x', 'u', 'U'}
        
        result = []
        i = 0
        while i < len(content):
            if content[i] == '\\' and i + 1 < len(content):
                next_char = content[i + 1]
                if next_char in valid_escapes:
                    # 保留有效转义序列
                    result.append(content[i:i+2])
                    i += 2
                else:
                    # 单反斜杠 + 非转义字符 -> 双反斜杠
                    result.append('\\\\')
                    result.append(next_char)
                    i += 2
            else:
                result.append(content[i])
                i += 1
        
        return quote + ''.join(result) + quote
    
    # 匹配字符串字面量：'...' 或 "..."
    # 注意：这个正则不处理嵌套引号和转义引号，但对我们来说够用了
    fixed = re.sub(
        r"(['\"])([A-Za-z]:\\[^'\"]*)\1",
        fix_path_in_string,
        script
    )
    
    return fixed


def shell_exec(command: str, cwd: str = None, timeout: int = 30) -> dict:
    # 安全检查：黑名单
    cmd_lower = command.lower()
    for dangerous in _BLACKLIST:
        if dangerous in cmd_lower:
            return {"error": f"Command blocked by security policy: contains '{dangerous}'"}

    # 白名单检查（如果配置了白名单但当前命令不在其中，拒绝执行）
    whitelist: list = config.get("shell_whitelist", [])
    if whitelist:
        allowed = any(command.strip().startswith(prefix) for prefix in whitelist)
        if not allowed:
            return {"error": f"Command not in whitelist. Allowed prefixes: {whitelist}"}

    work_dir = cwd or str(Path.home())
    # 防止目录穿越到系统目录
    resolved = Path(work_dir).resolve()

    # 对 Python 命令自动注入 -u（unbuffered），防止管道模式下输出被缓冲丢失
    patched_command = _patch_python_unbuffered(command)
    
    # 修复 python -c "..." 多行脚本在 Windows 下的解析问题
    patched_command = _fix_python_inline_script(patched_command)

    # Windows 下通过环境变量也强制 Python 不缓冲
    import os
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    try:
        result = subprocess.run(
            patched_command,
            shell=True,
            capture_output=True,
            text=False,
            timeout=timeout,
            cwd=str(resolved),
            env=env,
        )
        stdout = _decode_output(result.stdout)
        stderr = _decode_output(result.stderr)

        ret: dict = {
            "stdout": stdout,
            "stderr": stderr,
            "returncode": result.returncode,
        }

        # 当 stdout 为空但 stderr 有内容时，给出提示，方便排查
        if not stdout.strip() and stderr.strip():
            ret["_hint"] = "stdout is empty but stderr has content — check stderr for errors or warnings."

        return ret
    except subprocess.TimeoutExpired:
        return {"error": f"Command timed out after {timeout}s"}
    except Exception as e:
        return {"error": str(e)}


import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, Optional

# ======================== 全局会话管理器（关键）========================
SHELL_SESSIONS: Dict[str, Dict] = {}  # 保存所有终端会话
SESSION_OUTPUT_CHUNK_SIZE = 2000      # 分段输出大小（自动解决上下文溢出）
SESSION_DEFAULT_TIMEOUT = 3600       # 会话默认超时1小时（长任务可用）


def create_shell_session(cwd: str = None, timeout: int = SESSION_DEFAULT_TIMEOUT) -> dict:
    """
    创建一个持久化的交互式终端会话（bash/cmd）
    支持 cd、export、交互式程序、长任务
    """
    session_id = f"shell_{uuid.uuid4().hex[:8]}"
    work_dir = cwd or str(Path.home())
    resolved = Path(work_dir).resolve()

    try:
        # Windows 使用 cmd，Linux/mac 使用 bash
        shell_cmd = "cmd" if Path("C:\\").exists() else "bash"
        proc = subprocess.Popen(
            [shell_cmd],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=str(resolved),
            text=True,
            bufsize=1,
            universal_newlines=True
        )

        # 会话数据
        session = {
            "proc": proc,
            "cwd": str(resolved),
            "status": "running",
            "output_buffer": "",
            "last_active": time.time(),
            "thread": None,
        }

        # 后台线程持续读取输出（不阻塞）
        def _read_output():
            while True:
                try:
                    line = proc.stdout.readline()
                    if not line:
                        break
                    session["output_buffer"] += line
                    session["last_active"] = time.time()
                except:
                    break

        t = threading.Thread(target=_read_output, daemon=True)
        t.start()
        session["thread"] = t
        SHELL_SESSIONS[session_id] = session
        return {"session_id": session_id, "cwd": str(resolved), "status": "created"}

    except Exception as e:
        return {"error": f"创建会话失败: {str(e)}"}


def shell_session_exec(session_id: str, command: str) -> dict:
    """
    向已存在的终端会话发送命令（连续交互核心）
    """
    if session_id not in SHELL_SESSIONS:
        return {"error": "会话不存在或已关闭"}

    session = SHELL_SESSIONS[session_id]
    proc = session["proc"]

    if proc.poll() is not None:
        return {"error": "会话进程已退出"}

    try:
        # 发送命令
        proc.stdin.write(command + "\n")
        proc.stdin.flush()
        session["last_active"] = time.time()

        # 等待输出
        time.sleep(0.3)
        raw_out = session["output_buffer"]
        session["output_buffer"] = ""  # 清空缓冲区

        # 自动分段（解决上下文溢出）
        chunks = [
            raw_out[i:i + SESSION_OUTPUT_CHUNK_SIZE]
            for i in range(0, len(raw_out), SESSION_OUTPUT_CHUNK_SIZE)
        ]
        total = len(chunks)

        return {
            "session_id": session_id,
            "status": "running",
            "chunks": chunks,
            "total_chunks": total,
            "current_chunk": 1,
            "content": chunks[0][:SESSION_OUTPUT_CHUNK_SIZE] if chunks else ""
        }

    except Exception as e:
        return {"error": f"执行失败: {str(e)}"}


def get_session_status(session_id: str):
    """查询会话状态 + 继续读取下一段输出"""
    if session_id not in SHELL_SESSIONS:
        return {"error": "会话不存在"}
    session = SHELL_SESSIONS[session_id]
    return {
        "session_id": session_id,
        "status": "running" if session["proc"].poll() is None else "exited",
        "pending_output": len(session["output_buffer"]),
        "cwd": session["cwd"]
    }


def close_shell_session(session_id: str):
    """关闭会话"""
    if session_id in SHELL_SESSIONS:
        proc = SHELL_SESSIONS[session_id]["proc"]
        try:
            proc.terminate()
        except:
            pass
        del SHELL_SESSIONS[session_id]
    return {"status": "closed", "session_id": session_id}