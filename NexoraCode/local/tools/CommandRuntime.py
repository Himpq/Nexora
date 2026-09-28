"""短命令执行期间响应取消；复用进程核心终止完整进程树。"""
import os
import subprocess
import time

from .ProcessCore import _terminate_process_tree


def run_command(command, *, cwd, env, timeout, cancel_checker):
    if cancel_checker():
        raise RuntimeError("stream_cancelled")

    process = subprocess.Popen(
        command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=cwd, env=env, start_new_session=os.name != "nt",
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    deadline = time.monotonic() + timeout

    try:
        while True:
            if cancel_checker():
                _terminate_process_tree(process, 5)
                raise RuntimeError("stream_cancelled")

            remaining = deadline - time.monotonic()

            if remaining <= 0:
                _terminate_process_tree(process, 5)
                raise subprocess.TimeoutExpired(command, timeout)

            try:
                stdout, stderr = process.communicate(timeout=min(0.2, remaining))
                return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
            except subprocess.TimeoutExpired:
                continue
    finally:
        if process.poll() is None:
            _terminate_process_tree(process, 5)

        process.communicate()
