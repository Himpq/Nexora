#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse
import contextlib
import io
import json
import os
import sys
from typing import Any, Dict, Optional


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(BASE_DIR, "api")
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

# 关键：CLI 运行时统一切到 ChatDBServer 根目录，
# 以兼容项目内仍使用相对路径（./data/...）的模块。
os.chdir(BASE_DIR)
os.environ.setdefault("NEXORA_CLI_SUPPRESS_CHUNK_DEBUG", "1")

from model import Model  # type: ignore
from longterm.orchestrator import LongTermOrchestrator  # type: ignore


DEBUG_PREFIXES = (
    "[DEBUG]",
    "[DEBUG_REQ]",
    "[DEBUG_API]",
    "[DEBUG_HIST]",
    "[CHUNK_DEBUG]",
    "[TOKEN_DEBUG]",
    "[CACHE]",
    "[INIT]",
    "[FILE]",
    "[FUNCTION]",
    "[SEARCH]",
    "[WEB_SEARCH]",
    "[WARNING]",
    "[TITLE]",
)


class _DebugFilterStdout(io.TextIOBase):
    def __init__(self, target):
        self._target = target
        self._buf = ""

    def writable(self) -> bool:
        return True

    def write(self, s):
        if not isinstance(s, str):
            s = str(s)
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            self._write_line(line + "\n")
        return len(s)

    def flush(self):
        if self._buf:
            self._write_line(self._buf)
            self._buf = ""
        try:
            self._target.flush()
        except Exception:
            pass

    def _write_line(self, line: str):
        striped = line.lstrip()
        for prefix in DEBUG_PREFIXES:
            if striped.startswith(prefix):
                return
        self._target.write(line)


@contextlib.contextmanager
def _suppress_model_debug_stdout():
    stream = _DebugFilterStdout(sys.stdout)
    with contextlib.redirect_stdout(stream):
        yield
    stream.flush()


def load_default_model() -> Optional[str]:
    cfg_path = os.path.join(BASE_DIR, "config.json")
    if not os.path.exists(cfg_path):
        return None
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return str(cfg.get("default_model") or "").strip() or None
    except Exception:
        return None


def short(s: Any, n: int = 80) -> str:
    text = str(s or "")
    if len(text) <= n:
        return text
    return text[: n - 3] + "..."


class NexoraLongTermCLI:
    def __init__(self, username: str, model_name: Optional[str], mode: str = "auto"):
        self.username = username
        self.model_name = model_name
        self.mode = mode  # auto | chat | task
        self.orchestrator = LongTermOrchestrator(username)
        self._stream_state = {"content": False, "reasoning": False}

    def _reset_stream_state(self) -> None:
        self._stream_state = {"content": False, "reasoning": False}

    def _close_stream_lines(self) -> None:
        if self._stream_state.get("reasoning"):
            print("")
        if self._stream_state.get("content"):
            print("")
        self._reset_stream_state()

    def event_callback(self, event: Dict[str, Any]) -> None:
        et = str(event.get("type") or "")
        if et == "reasoning_content":
            if not self._stream_state["reasoning"]:
                self._close_stream_lines()
                print("[思考] ", end="", flush=True)
                self._stream_state["reasoning"] = True
            print(str(event.get("content") or ""), end="", flush=True)
            return

        if et == "content":
            if not self._stream_state["content"]:
                self._close_stream_lines()
                print("[输出] ", end="", flush=True)
                self._stream_state["content"] = True
            print(str(event.get("content") or ""), end="", flush=True)
            return

        if et == "function_call":
            self._close_stream_lines()
            print(f"[工具调用] {event.get('name')} args={short(event.get('arguments'), 120)}")
            return

        if et == "function_result":
            self._close_stream_lines()
            print(f"[工具结果] {event.get('name')} -> {short(event.get('result'), 140)}")
            return

        if et == "web_search":
            self._close_stream_lines()
            print(f"[联网搜索] {short(event.get('content'), 120)}")
            return

        if et == "error":
            self._close_stream_lines()
            print(f"[错误] {event.get('content')}")
            return

        if et == "longterm_stage":
            self._close_stream_lines()
            stage = event.get("stage")
            if stage == "step_execute":
                print(f"[任务阶段] 执行步骤 {event.get('step_id')} (index={event.get('step_index')})")
            elif stage == "end_review":
                print("[任务阶段] 终审中")
            else:
                print(f"[任务阶段] {stage}")
            return

        if et == "longterm_step_result":
            self._close_stream_lines()
            payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
            print(f"[步骤结果] action={payload.get('action')} summary={short(payload.get('result_summary'), 90)}")
            return

        if et == "longterm_review_result":
            self._close_stream_lines()
            payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
            print(f"[终审结果] passed={payload.get('passed')} comments={short(payload.get('comments'), 90)}")
            return

    def print_plan(self, task: Dict[str, Any]) -> None:
        plan = task.get("plan") if isinstance(task.get("plan"), dict) else {}
        steps = plan.get("steps") if isinstance(plan.get("steps"), list) else []
        print("\n=== 任务计划 ===")
        print(f"Task: {task.get('id')} | 标题: {task.get('title')} | 状态: {task.get('status')}")
        for idx, step in enumerate(steps, start=1):
            if not isinstance(step, dict):
                continue
            print(
                f"{idx}. {step.get('id')} [{step.get('status')}] "
                f"{step.get('title')} | objective={short(step.get('objective'), 45)}"
            )
        print("==============\n")

    def show_task(self, task_id: str) -> None:
        task = self.orchestrator.get_task(task_id)
        ov = self.orchestrator.task_overview(task_id)
        print(json.dumps(ov, ensure_ascii=False, indent=2))
        self.print_plan(task)

    def list_tasks(self, limit: int = 20) -> None:
        items = self.orchestrator.list_tasks(limit=limit)
        print("\n=== 任务列表 ===")
        for t in items:
            print(
                f"{t.get('id')} | {t.get('status')} | {t.get('step_done')}/{t.get('step_total')} | "
                f"{short(t.get('title'), 24)}"
            )
        if not items:
            print("(空)")
        print("=============\n")

    def run_chat(self, user_message: str) -> None:
        self.run_chat_with_options(
            user_message=user_message,
            enable_tools=True,
            enable_web_search=True,
        )

    def run_chat_with_options(self, user_message: str, enable_tools: bool, enable_web_search: bool) -> None:
        self._reset_stream_state()
        with _suppress_model_debug_stdout():
            model = Model(self.username, model_name=self.model_name)
            for chunk in model.sendMessage(
                user_message,
                stream=True,
                enable_thinking=True,
                enable_web_search=enable_web_search,
                enable_tools=enable_tools,
                show_token_usage=False,
            ):
                self.event_callback(chunk)
        self._close_stream_lines()

    def _is_simple_greeting(self, text: str) -> bool:
        s = str(text or "").strip().lower()
        if not s:
            return False
        if len(s) > 16:
            return False
        greeting_tokens = {
            "你好", "您好", "hi", "hello", "hey", "早上好", "晚上好", "在吗",
            "嗨", "哈喽", "hello!", "hi!", "你好呀", "你好啊", "浣犲ソ"
        }
        if s in greeting_tokens:
            return True
        compact = s.replace("！", "").replace("!", "").replace("。", "").replace("，", "").strip()
        if compact in greeting_tokens:
            return True
        if compact.startswith("你好") and len(compact) <= 4:
            return True
        return False

    def create_task_from_goal(self, goal: str, title: Optional[str] = None, auto_run: bool = True) -> Optional[str]:
        task = self.orchestrator.create_task(
            goal=goal,
            title=title or short(goal, 30),
            auto_plan=False,
            step_count=5,
        )
        task_id = str(task.get("id"))
        print(f"[任务创建] {task_id} goal={short(goal, 80)}")

        with _suppress_model_debug_stdout():
            task = self.orchestrator.ai_generate_plan(
                task_id=task_id,
                model_name=self.model_name,
                max_steps=6,
                event_callback=self.event_callback,
            )
        self._close_stream_lines()
        self.print_plan(task)

        if auto_run:
            print("[任务执行] 开始自动执行...")
            with _suppress_model_debug_stdout():
                task = self.orchestrator.run_auto(
                    task_id=task_id,
                    model_name=self.model_name,
                    max_cycles=24,
                    event_callback=self.event_callback,
                )
            self._close_stream_lines()
            print(f"[任务完成] status={task.get('status')} task_id={task_id}")
        return task_id

    def auto_dispatch(self, user_message: str) -> None:
        if self.mode == "chat":
            if self._is_simple_greeting(user_message):
                self.run_chat_with_options(user_message, enable_tools=False, enable_web_search=False)
            else:
                self.run_chat(user_message)
            return
        if self.mode == "task":
            self.create_task_from_goal(user_message, auto_run=True)
            return

        if self._is_simple_greeting(user_message):
            self.run_chat_with_options(user_message, enable_tools=False, enable_web_search=False)
            return

        with _suppress_model_debug_stdout():
            decision = self.orchestrator.route_message(
                user_message=user_message,
                model_name=self.model_name,
                event_callback=self.event_callback,
            )
        self._close_stream_lines()
        mode = str(decision.get("mode") or "chat")

        if mode == "task":
            goal = str(decision.get("task_goal") or "").strip() or user_message
            title = str(decision.get("task_title") or "").strip() or None
            self.create_task_from_goal(goal, title=title, auto_run=True)
        else:
            if self._is_simple_greeting(user_message):
                self.run_chat_with_options(user_message, enable_tools=False, enable_web_search=False)
            else:
                self.run_chat(user_message)

    def repl(self) -> None:
        print("Nexora Long-term CLI")
        print(f"用户: {self.username} | 模式: {self.mode} | 模型: {self.model_name or '(default)'}")
        print("输入 /help 查看命令")
        while True:
            try:
                line = input("nexora> ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\n退出")
                break
            if not line:
                continue

            if line.startswith("/"):
                if line in {"/quit", "/exit"}:
                    print("退出")
                    break
                if line == "/help":
                    print(
                        "\n命令:\n"
                        "/help                     显示帮助\n"
                        "/mode auto|chat|task      切换分流模式\n"
                        "/model <model_id>         切换模型\n"
                        "/tasks                    列出任务\n"
                        "/task <task_id>           查看任务详情\n"
                        "/run <task_id>            继续自动执行任务\n"
                        "/new <goal>               强制创建任务并自动执行\n"
                        "/quit                     退出\n"
                    )
                    continue

                if line.startswith("/mode "):
                    mode = line.split(" ", 1)[1].strip().lower()
                    if mode not in {"auto", "chat", "task"}:
                        print("mode 仅支持 auto|chat|task")
                        continue
                    self.mode = mode
                    print(f"模式已切换为 {self.mode}")
                    continue

                if line.startswith("/model "):
                    model_name = line.split(" ", 1)[1].strip()
                    self.model_name = model_name or None
                    print(f"模型已切换为 {self.model_name or '(default)'}")
                    continue

                if line == "/tasks":
                    self.list_tasks()
                    continue

                if line.startswith("/task "):
                    task_id = line.split(" ", 1)[1].strip()
                    try:
                        self.show_task(task_id)
                    except Exception as e:
                        print(f"查看任务失败: {e}")
                    continue

                if line.startswith("/run "):
                    task_id = line.split(" ", 1)[1].strip()
                    try:
                        task = self.orchestrator.run_auto(
                            task_id=task_id,
                            model_name=self.model_name,
                            max_cycles=24,
                            event_callback=self.event_callback,
                        )
                        self._close_stream_lines()
                        print(f"[任务执行结束] {task_id} status={task.get('status')}")
                    except Exception as e:
                        print(f"执行任务失败: {e}")
                    continue

                if line.startswith("/new "):
                    goal = line.split(" ", 1)[1].strip()
                    if not goal:
                        print("goal 不能为空")
                        continue
                    try:
                        self.create_task_from_goal(goal, auto_run=True)
                    except Exception as e:
                        print(f"创建任务失败: {e}")
                    continue

                print("未知命令，输入 /help 查看帮助")
                continue

            try:
                self.auto_dispatch(line)
            except Exception as e:
                self._close_stream_lines()
                print(f"[失败] {e}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Nexora Long-term CLI")
    parser.add_argument("--username", required=True, help="Nexora 用户名")
    parser.add_argument("--model", default=None, help="模型ID（不填使用默认模型）")
    parser.add_argument("--mode", default="auto", choices=["auto", "chat", "task"], help="分流模式")
    args = parser.parse_args()

    model_name = args.model or load_default_model()
    cli = NexoraLongTermCLI(username=args.username, model_name=model_name, mode=args.mode)
    cli.repl()


if __name__ == "__main__":
    main()
