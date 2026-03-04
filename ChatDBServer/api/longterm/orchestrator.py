import json
import re
import time
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

from .store import LongTermTaskStore


class LongTermOrchestrator:
    """
    Long-term 任务编排器（第一版）
    - 目标 -> 计划(steps)
    - steps 顺序推进，产出 transit
    - End Review 可回跳到指定 step
    """

    VALID_STATUS = {"created", "planning", "ready", "running", "paused", "review", "done", "stopped", "failed"}

    def __init__(self, username: str):
        self.username = str(username or "").strip()
        self.store = LongTermTaskStore(self.username)

    def _now_ts(self) -> int:
        return int(time.time())

    def _now_str(self) -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _as_bool(self, value: Any, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            v = value.strip().lower()
            if v in {"1", "true", "yes", "y", "on"}:
                return True
            if v in {"0", "false", "no", "n", "off"}:
                return False
        if value is None:
            return default
        return bool(value)

    def _clamp_step_count(self, step_count: Any) -> int:
        try:
            n = int(step_count or 5)
        except Exception:
            n = 5
        return max(1, min(n, 20))

    def _make_task_id(self) -> str:
        return f"lt_{self._now_ts()}_{uuid.uuid4().hex[:8]}"

    def _build_default_steps(self, goal: str, step_count: int) -> List[Dict[str, Any]]:
        # 第一版为规则生成，后续可替换成 Planner 模型调用
        templates = [
            ("A1", "明确目标与约束", "提取需求、边界、交付标准", "输出明确的执行目标与验收标准"),
            ("A2", "资料搜集与证据整理", "收集必要信息与参考资料", "形成可引用的资料清单"),
            ("A3", "产出初稿/初版实现", "根据目标完成主要内容", "形成可运行或可阅读的初版成果"),
            ("A4", "自检与修正", "对照目标做一致性检查和修正", "关键问题被修复，风险项已标注"),
            ("A5", "结项与交付整理", "整理成果、说明、下一步建议", "形成最终交付和简明总结"),
        ]

        steps: List[Dict[str, Any]] = []
        n = self._clamp_step_count(step_count)
        for i in range(n):
            if i < len(templates):
                sid, title, objective, acceptance = templates[i]
            else:
                idx = i + 1
                sid = f"A{idx}"
                title = f"执行子任务 {idx}"
                objective = f"围绕总目标推进第 {idx} 步"
                acceptance = f"第 {idx} 步结果可被下一步复用"

            steps.append({
                "id": sid,
                "title": title,
                "objective": objective,
                "acceptance": acceptance,
                "status": "pending",
                "attempts": 0,
                "notes": "",
                "artifacts": [],
            })
        return steps

    def _build_plan(self, goal: str, step_count: int = 5, source: str = "bootstrap") -> Dict[str, Any]:
        steps = self._build_default_steps(goal, step_count)
        return {
            "version": 1,
            "source": source,
            "goal": goal,
            "steps": steps,
        }

    def _task_log(self, task: Dict[str, Any], event: str, detail: Any) -> None:
        logs = task.get("logs")
        if not isinstance(logs, list):
            logs = []
        logs.insert(0, {
            "time": self._now_str(),
            "event": str(event),
            "detail": detail,
        })
        if len(logs) > 2000:
            logs = logs[:2000]
        task["logs"] = logs

    def _touch(self, task: Dict[str, Any]) -> None:
        task["updated_at"] = self._now_ts()

    def _get_steps(self, task: Dict[str, Any]) -> List[Dict[str, Any]]:
        plan = task.get("plan")
        if not isinstance(plan, dict):
            raise ValueError("task.plan missing")
        steps = plan.get("steps")
        if not isinstance(steps, list):
            raise ValueError("task.plan.steps missing")
        return steps

    def _resolve_step_index(self, task: Dict[str, Any], step_ref: Any) -> int:
        steps = self._get_steps(task)
        if isinstance(step_ref, int):
            idx = step_ref
            if 0 <= idx < len(steps):
                return idx
            raise ValueError(f"step index out of range: {idx}")
        step_str = str(step_ref or "").strip()
        if not step_str:
            raise ValueError("step_ref is required")
        for i, step in enumerate(steps):
            if str(step.get("id") or "") == step_str:
                return i
        raise ValueError(f"step not found: {step_str}")

    def _pointer_to(self, task: Dict[str, Any], idx: int, phase: str = "execution") -> None:
        steps = self._get_steps(task)
        if not (0 <= idx < len(steps)):
            raise ValueError("pointer index out of range")
        task["pointer"] = {
            "phase": phase,
            "current_step_index": idx,
            "current_step_id": steps[idx].get("id"),
        }

    def _mark_step_in_progress(self, step: Dict[str, Any]) -> None:
        step["status"] = "in_progress"
        step["attempts"] = int(step.get("attempts", 0) or 0) + 1

    def _build_transit_payload(self, step: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "step_id": step.get("id"),
            "result_summary": str(payload.get("result_summary") or "").strip(),
            "key_facts": payload.get("key_facts") if isinstance(payload.get("key_facts"), list) else [],
            "artifact_refs": payload.get("artifact_refs") if isinstance(payload.get("artifact_refs"), list) else [],
            "next_step_hint": str(payload.get("next_step_hint") or "").strip(),
            "open_issues": payload.get("open_issues") if isinstance(payload.get("open_issues"), list) else [],
            "quality_score": payload.get("quality_score"),
            "created_at": self._now_ts(),
        }

    def _task_overview(self, task: Dict[str, Any]) -> Dict[str, Any]:
        steps = self._get_steps(task)
        done = 0
        for s in steps:
            if str(s.get("status") or "") == "done":
                done += 1
        return {
            "id": task.get("id"),
            "title": task.get("title"),
            "goal": task.get("goal"),
            "status": task.get("status"),
            "pointer": task.get("pointer"),
            "step_total": len(steps),
            "step_done": done,
            "updated_at": task.get("updated_at"),
            "created_at": task.get("created_at"),
        }

    def create_task(
        self,
        goal: str,
        title: Optional[str] = None,
        auto_plan: bool = True,
        step_count: int = 5,
        system_prompt: str = "",
    ) -> Dict[str, Any]:
        clean_goal = str(goal or "").strip()
        if not clean_goal:
            raise ValueError("goal is required")

        now = self._now_ts()
        task_id = self._make_task_id()
        do_plan = self._as_bool(auto_plan, True)
        plan = self._build_plan(clean_goal, step_count=step_count, source="bootstrap") if do_plan else {
            "version": 1,
            "source": "manual",
            "goal": clean_goal,
            "steps": [],
        }
        steps = plan.get("steps", [])

        task = {
            "id": task_id,
            "username": self.username,
            "title": str(title or clean_goal[:80]),
            "goal": clean_goal,
            "status": "ready" if steps else "created",
            "created_at": now,
            "updated_at": now,
            "plan": plan,
            "pointer": {
                "phase": "plan" if steps else "created",
                "current_step_index": 0 if steps else None,
                "current_step_id": steps[0].get("id") if steps else None,
            },
            "transit_history": [],
            "artifacts": [],
            "settings": {
                "max_retries_per_step": 3,
                "auto_plan": do_plan,
            },
            "context": {
                "system_prompt": str(system_prompt or ""),
            },
            "logs": [],
        }
        self._task_log(task, "task.created", {"auto_plan": do_plan, "step_count": len(steps)})
        self.store.save_task(task)
        return task

    def list_tasks(self, limit: int = 100, status: Optional[str] = None) -> List[Dict[str, Any]]:
        return self.store.list_tasks(limit=limit, status=status)

    def get_task(self, task_id: str) -> Dict[str, Any]:
        return self.store.load_task(task_id)

    def regenerate_plan(self, task_id: str, step_count: int = 5) -> Dict[str, Any]:
        task = self.store.load_task(task_id)
        task["plan"] = self._build_plan(task.get("goal", ""), step_count=step_count, source="regen")
        steps = self._get_steps(task)
        if steps:
            self._pointer_to(task, 0, phase="plan")
            task["status"] = "ready"
        else:
            task["status"] = "created"
            task["pointer"] = {"phase": "created", "current_step_index": None, "current_step_id": None}
        self._touch(task)
        self._task_log(task, "plan.regenerated", {"step_count": len(steps)})
        self.store.save_task(task)
        return task

    def start(self, task_id: str) -> Dict[str, Any]:
        task = self.store.load_task(task_id)
        steps = self._get_steps(task)
        if not steps:
            raise ValueError("plan has no steps, cannot start")

        pointer = task.get("pointer") if isinstance(task.get("pointer"), dict) else {}
        idx = pointer.get("current_step_index")
        if idx is None:
            idx = 0
        idx = int(idx)
        if idx < 0 or idx >= len(steps):
            idx = 0

        self._pointer_to(task, idx, phase="execution")
        if steps[idx].get("status") in {"pending", "rework"}:
            self._mark_step_in_progress(steps[idx])

        task["status"] = "running"
        self._touch(task)
        self._task_log(task, "task.started", {"current_step": steps[idx].get("id")})
        self.store.save_task(task)
        return task

    def submit_step_result(self, task_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        task = self.store.load_task(task_id)
        if str(task.get("status") or "") not in {"running", "review"}:
            raise ValueError(f"task status does not allow step submit: {task.get('status')}")

        steps = self._get_steps(task)
        pointer = task.get("pointer") if isinstance(task.get("pointer"), dict) else {}
        idx = int(pointer.get("current_step_index", 0) or 0)
        if idx < 0 or idx >= len(steps):
            raise ValueError("current_step_index invalid")

        step = steps[idx]
        action = str(payload.get("action") or "complete").strip().lower()
        if action not in {"complete", "rework"}:
            action = "complete"

        transit = self._build_transit_payload(step, payload)
        history = task.get("transit_history")
        if not isinstance(history, list):
            history = []
        history.insert(0, transit)
        task["transit_history"] = history[:5000]

        if action == "rework":
            step["status"] = "rework"
            step["notes"] = str(payload.get("reason") or "需要重做").strip()
            self._touch(task)
            self._task_log(task, "step.rework", {"step_id": step.get("id"), "reason": step.get("notes")})
            self.store.save_task(task)
            return task

        step["status"] = "done"
        step["notes"] = str(payload.get("notes") or "").strip()
        if isinstance(payload.get("artifact_refs"), list):
            step["artifacts"] = payload.get("artifact_refs")

        if idx + 1 < len(steps):
            next_idx = idx + 1
            self._pointer_to(task, next_idx, phase="execution")
            if steps[next_idx].get("status") in {"pending", "rework"}:
                self._mark_step_in_progress(steps[next_idx])
            task["status"] = "running"
            self._task_log(task, "step.completed", {
                "step_id": step.get("id"),
                "next_step": steps[next_idx].get("id"),
            })
        else:
            task["status"] = "review"
            task["pointer"] = {
                "phase": "end_review",
                "current_step_index": idx,
                "current_step_id": step.get("id"),
            }
            self._task_log(task, "steps.finished", {"last_step": step.get("id")})

        self._touch(task)
        self.store.save_task(task)
        return task

    def rework(self, task_id: str, step_ref: Any, reason: str = "") -> Dict[str, Any]:
        task = self.store.load_task(task_id)
        steps = self._get_steps(task)
        idx = self._resolve_step_index(task, step_ref)

        for i in range(idx, len(steps)):
            if i == idx:
                steps[i]["status"] = "in_progress"
                steps[i]["attempts"] = int(steps[i].get("attempts", 0) or 0) + 1
                steps[i]["notes"] = str(reason or "").strip()
            else:
                if steps[i].get("status") != "done":
                    steps[i]["status"] = "pending"
                # 保留 done 步骤结果，不主动清空

        self._pointer_to(task, idx, phase="execution")
        task["status"] = "running"
        self._touch(task)
        self._task_log(task, "task.rework", {"step_id": steps[idx].get("id"), "reason": str(reason or "")})
        self.store.save_task(task)
        return task

    def end_review(self, task_id: str, passed: bool, rework_step: Any = None, comments: str = "") -> Dict[str, Any]:
        task = self.store.load_task(task_id)
        ok = self._as_bool(passed, False)
        if ok:
            task["status"] = "done"
            task["pointer"] = {
                "phase": "completed",
                "current_step_index": None,
                "current_step_id": None,
            }
            self._touch(task)
            self._task_log(task, "end_review.passed", {"comments": str(comments or "")})
            self.store.save_task(task)
            return task

        if rework_step is None:
            raise ValueError("rework_step is required when passed=false")
        return self.rework(task_id, rework_step, reason=comments or "end review requires rework")

    def set_status(self, task_id: str, status: str, reason: str = "") -> Dict[str, Any]:
        task = self.store.load_task(task_id)
        st = str(status or "").strip().lower()
        if st not in self.VALID_STATUS:
            raise ValueError(f"invalid status: {status}")

        if st == "running":
            # running 走 start 逻辑更稳
            return self.start(task_id)

        task["status"] = st
        if st == "paused":
            pointer = task.get("pointer") if isinstance(task.get("pointer"), dict) else {}
            if pointer.get("phase") == "execution":
                pointer["phase"] = "paused"
                task["pointer"] = pointer
        if st == "stopped":
            pointer = task.get("pointer") if isinstance(task.get("pointer"), dict) else {}
            pointer["phase"] = "stopped"
            task["pointer"] = pointer
        if st == "done":
            task["pointer"] = {"phase": "completed", "current_step_index": None, "current_step_id": None}

        self._touch(task)
        self._task_log(task, "status.updated", {"status": st, "reason": str(reason or "")})
        self.store.save_task(task)
        return task

    def task_overview(self, task_id: str) -> Dict[str, Any]:
        task = self.store.load_task(task_id)
        return self._task_overview(task)

    def summarize_for_transit(self, task_id: str) -> Dict[str, Any]:
        """
        返回面向下一轮执行的 transit 摘要（Plan + 最近结果）
        """
        task = self.store.load_task(task_id)
        steps = self._get_steps(task)
        pointer = task.get("pointer") if isinstance(task.get("pointer"), dict) else {}
        current_idx = pointer.get("current_step_index")
        if current_idx is None:
            current_idx = 0
        current_idx = max(0, min(int(current_idx), max(0, len(steps) - 1)))

        history = task.get("transit_history") if isinstance(task.get("transit_history"), list) else []
        latest = history[0] if history else {}
        return {
            "task": self._task_overview(task),
            "plan": task.get("plan"),
            "current_step": steps[current_idx] if steps else None,
            "latest_transit": latest,
        }

    # ==================== AI 驱动层 ====================

    def _emit(self, callback: Optional[Callable[[Dict[str, Any]], None]], event: Dict[str, Any]) -> None:
        if callback is None:
            return
        try:
            callback(event)
        except Exception:
            pass

    def _extract_json_block(self, text: str) -> Dict[str, Any]:
        raw = str(text or "").strip()
        if not raw:
            return {}

        fence = re.search(r"```json\s*(\{[\s\S]*?\})\s*```", raw, flags=re.IGNORECASE)
        if fence:
            block = fence.group(1)
            try:
                parsed = json.loads(block)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass

        obj_match = re.search(r"(\{[\s\S]*\})", raw)
        if obj_match:
            block = obj_match.group(1)
            try:
                parsed = json.loads(block)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass
        return {}

    def _normalize_plan_steps(self, raw_steps: Any) -> List[Dict[str, Any]]:
        if not isinstance(raw_steps, list):
            return []

        normalized: List[Dict[str, Any]] = []
        idx = 1
        for item in raw_steps:
            if not isinstance(item, dict):
                continue
            sid = str(item.get("id") or f"A{idx}").strip()
            if not sid:
                sid = f"A{idx}"
            if not sid.upper().startswith("A"):
                sid = f"A{idx}"
            title = str(item.get("title") or f"步骤{idx}").strip() or f"步骤{idx}"
            objective = str(item.get("objective") or item.get("goal") or "").strip()
            acceptance = str(item.get("acceptance") or item.get("done_when") or "").strip()
            normalized.append({
                "id": sid,
                "title": title,
                "objective": objective,
                "acceptance": acceptance,
                "status": "pending",
                "attempts": 0,
                "notes": "",
                "artifacts": [],
            })
            idx += 1
            if idx > 20:
                break
        return normalized

    def _run_model_once(
        self,
        message: str,
        model_name: Optional[str] = None,
        enable_tools: bool = False,
        enable_web_search: bool = False,
        event_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
        system_prompt: Optional[str] = None,
    ) -> str:
        # 延迟导入，避免模块初始化时循环依赖
        from model import Model  # type: ignore

        mdl = Model(
            self.username,
            model_name=model_name,
            system_prompt=system_prompt,
            conversation_id=None,
            auto_create=True,
        )

        content = ""
        for chunk in mdl.sendMessage(
            message,
            stream=True,
            enable_thinking=True,
            enable_web_search=enable_web_search,
            enable_tools=enable_tools,
            show_token_usage=False,
        ):
            ctype = str(chunk.get("type") or "")
            if ctype in {"reasoning_content", "content", "error", "done", "function_call", "function_result", "web_search"}:
                self._emit(event_callback, chunk)
            if ctype == "content":
                content += str(chunk.get("content") or "")
            elif ctype == "done":
                done_text = chunk.get("content")
                if isinstance(done_text, str):
                    content = done_text
        return content

    def route_message(
        self,
        user_message: str,
        model_name: Optional[str] = None,
        event_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        让模型判断当前输入应进入普通对话还是 long-term 任务。
        """
        msg = str(user_message or "").strip()
        if not msg:
            return {"mode": "chat", "reason": "empty message", "confidence": 0.0}

        router_prompt = (
            "你是任务分流器。请判断用户输入更适合：\n"
            "1) chat：一次性问答/短任务\n"
            "2) task：需要多步骤规划与持续执行的长流程任务\n\n"
            "仅输出 JSON，不要额外文字。格式：\n"
            "{"
            "\"mode\":\"chat|task\","
            "\"confidence\":0~1,"
            "\"reason\":\"简短原因\","
            "\"task_goal\":\"若 mode=task 则填写目标，否则空\","
            "\"task_title\":\"若 mode=task 可给短标题，否则空\""
            "}"
        )

        raw = self._run_model_once(
            message=msg,
            model_name=model_name,
            enable_tools=False,
            enable_web_search=False,
            event_callback=event_callback,
            system_prompt=router_prompt,
        )
        data = self._extract_json_block(raw)
        if not data:
            # 兜底：弱启发式
            hard_task_keywords = ["完整", "从零", "项目", "计划", "步骤", "论文", "应用", "长流程", "自动完成", "重构", "实现整个"]
            is_task = any(k in msg for k in hard_task_keywords)
            return {
                "mode": "task" if is_task else "chat",
                "confidence": 0.55 if is_task else 0.45,
                "reason": "fallback heuristic",
                "task_goal": msg if is_task else "",
                "task_title": msg[:24] if is_task else "",
            }

        mode = str(data.get("mode") or "chat").strip().lower()
        if mode not in {"chat", "task"}:
            mode = "chat"
        return {
            "mode": mode,
            "confidence": float(data.get("confidence") or 0),
            "reason": str(data.get("reason") or "").strip(),
            "task_goal": str(data.get("task_goal") or "").strip(),
            "task_title": str(data.get("task_title") or "").strip(),
            "raw": raw,
        }

    def ai_generate_plan(
        self,
        task_id: str,
        model_name: Optional[str] = None,
        max_steps: int = 6,
        event_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        task = self.store.load_task(task_id)
        goal = str(task.get("goal") or "").strip()
        if not goal:
            raise ValueError("task goal is empty")

        prompt = (
            "你是 Long-term 计划器。根据用户目标生成执行计划。\n"
            "要求：\n"
            f"- 步骤数量 3~{max(3, min(int(max_steps or 6), 12))}\n"
            "- 每步包含 id/title/objective/acceptance\n"
            "- id 用 A1/A2... 形式\n"
            "- 只输出 JSON，不要其他文本\n"
            "格式：{\"steps\":[{\"id\":\"A1\",\"title\":\"...\",\"objective\":\"...\",\"acceptance\":\"...\"}]}\n"
            f"目标：{goal}"
        )

        raw = self._run_model_once(
            message=prompt,
            model_name=model_name,
            enable_tools=False,
            enable_web_search=False,
            event_callback=event_callback,
            system_prompt="你只输出严格 JSON。",
        )
        parsed = self._extract_json_block(raw)
        steps = self._normalize_plan_steps(parsed.get("steps"))
        if not steps:
            # 回退规则计划
            fallback = self._build_plan(goal, step_count=max_steps, source="bootstrap_fallback")
            steps = fallback.get("steps", [])
            source = "bootstrap_fallback"
        else:
            source = "ai"

        task["plan"] = {"version": 1, "source": source, "goal": goal, "steps": steps}
        if steps:
            self._pointer_to(task, 0, phase="plan")
            task["status"] = "ready"
        else:
            task["status"] = "created"
            task["pointer"] = {"phase": "created", "current_step_index": None, "current_step_id": None}

        self._touch(task)
        self._task_log(task, "plan.ai_generated", {"step_count": len(steps), "source": source})
        self.store.save_task(task)
        return task

    def ai_execute_current_step(
        self,
        task_id: str,
        model_name: Optional[str] = None,
        event_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        task = self.store.load_task(task_id)
        if str(task.get("status") or "") not in {"running", "review"}:
            task = self.start(task_id)

        steps = self._get_steps(task)
        pointer = task.get("pointer") if isinstance(task.get("pointer"), dict) else {}
        idx = int(pointer.get("current_step_index", 0) or 0)
        idx = max(0, min(idx, len(steps) - 1))
        step = steps[idx]

        history = task.get("transit_history") if isinstance(task.get("transit_history"), list) else []
        latest = history[0] if history else {}
        plan_outline = []
        for s in steps:
            plan_outline.append({
                "id": s.get("id"),
                "title": s.get("title"),
                "objective": s.get("objective"),
                "acceptance": s.get("acceptance"),
                "status": s.get("status"),
            })

        step_prompt = (
            "你是 Long-term Step 执行器。你当前只执行一个步骤。\n"
            "你可以调用工具（知识库、文件沙箱、联网搜索等）来完成步骤。\n"
            "执行完后只输出 JSON，不要其他文本。\n"
            "JSON 格式："
            "{"
            "\"action\":\"complete|rework\","
            "\"result_summary\":\"本步结果总结\","
            "\"key_facts\":[\"关键事实\"],"
            "\"artifact_refs\":[\"文件路径\"],"
            "\"next_step_hint\":\"给下一步的提示\","
            "\"open_issues\":[\"未解决问题\"],"
            "\"quality_score\":0~100,"
            "\"notes\":\"备注\","
            "\"reason\":\"若 action=rework 填写重做原因\""
            "}\n"
            f"任务目标: {task.get('goal')}\n"
            f"当前步骤: {json.dumps(step, ensure_ascii=False)}\n"
            f"计划总览: {json.dumps(plan_outline, ensure_ascii=False)}\n"
            f"上一轮结果(可为空): {json.dumps(latest, ensure_ascii=False)}\n"
        )

        raw = self._run_model_once(
            message=step_prompt,
            model_name=model_name,
            enable_tools=True,
            enable_web_search=True,
            event_callback=event_callback,
            system_prompt="你是严谨的任务执行器，必须先执行再汇报，输出严格 JSON。",
        )
        parsed = self._extract_json_block(raw)
        if not parsed:
            parsed = {
                "action": "complete",
                "result_summary": raw.strip()[:2000],
                "key_facts": [],
                "artifact_refs": [],
                "next_step_hint": "",
                "open_issues": [],
                "quality_score": 60,
                "notes": "模型未返回结构化 JSON，已降级为文本结果",
            }

        payload = {
            "action": str(parsed.get("action") or "complete").strip().lower(),
            "result_summary": str(parsed.get("result_summary") or "").strip(),
            "key_facts": parsed.get("key_facts") if isinstance(parsed.get("key_facts"), list) else [],
            "artifact_refs": parsed.get("artifact_refs") if isinstance(parsed.get("artifact_refs"), list) else [],
            "next_step_hint": str(parsed.get("next_step_hint") or "").strip(),
            "open_issues": parsed.get("open_issues") if isinstance(parsed.get("open_issues"), list) else [],
            "quality_score": parsed.get("quality_score"),
            "notes": str(parsed.get("notes") or "").strip(),
            "reason": str(parsed.get("reason") or "").strip(),
        }
        if payload["action"] not in {"complete", "rework"}:
            payload["action"] = "complete"
        if not payload["result_summary"]:
            payload["result_summary"] = "本步骤已执行（无结构化总结）"

        updated = self.submit_step_result(task_id, payload)
        return updated, payload

    def ai_end_review(
        self,
        task_id: str,
        model_name: Optional[str] = None,
        event_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        task = self.store.load_task(task_id)
        steps = self._get_steps(task)
        transits = task.get("transit_history") if isinstance(task.get("transit_history"), list) else []
        latest_transits = transits[:8]

        review_prompt = (
            "你是 Long-term 终审器。请复查当前项目是否可以结束。\n"
            "如有明显缺口，必须回跳到某一步重做。\n"
            "仅输出 JSON："
            "{"
            "\"passed\": true|false,"
            "\"rework_step_id\": \"A2\","
            "\"comments\": \"终审意见\","
            "\"improvements\": [\"改进点\"]"
            "}\n"
            f"任务目标: {task.get('goal')}\n"
            f"计划步骤: {json.dumps(steps, ensure_ascii=False)}\n"
            f"最近执行结果: {json.dumps(latest_transits, ensure_ascii=False)}\n"
        )

        raw = self._run_model_once(
            message=review_prompt,
            model_name=model_name,
            enable_tools=False,
            enable_web_search=False,
            event_callback=event_callback,
            system_prompt="你是终审器，输出严格 JSON。",
        )
        parsed = self._extract_json_block(raw)
        if not parsed:
            parsed = {
                "passed": True,
                "rework_step_id": None,
                "comments": "终审降级：未获取结构化结果，默认通过",
                "improvements": [],
            }

        passed = self._as_bool(parsed.get("passed"), False)
        rework_step = parsed.get("rework_step_id")
        comments = str(parsed.get("comments") or "").strip()
        updated = self.end_review(task_id, passed=passed, rework_step=rework_step, comments=comments)
        return updated, parsed

    def run_auto(
        self,
        task_id: str,
        model_name: Optional[str] = None,
        max_cycles: int = 20,
        event_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        自动执行任务直到 done 或达到最大轮次。
        """
        task = self.store.load_task(task_id)
        steps = self._get_steps(task)
        if not steps:
            task = self.ai_generate_plan(task_id, model_name=model_name, event_callback=event_callback)
            steps = self._get_steps(task)
            if not steps:
                raise ValueError("无法生成可执行计划")

        if str(task.get("status") or "") in {"created", "ready", "paused"}:
            task = self.start(task_id)

        cycles = max(1, min(int(max_cycles or 20), 200))
        for _ in range(cycles):
            task = self.store.load_task(task_id)
            status = str(task.get("status") or "")
            if status == "done":
                return task
            if status in {"stopped", "failed"}:
                return task
            if status == "review":
                self._emit(event_callback, {"type": "longterm_stage", "stage": "end_review"})
                task, review_payload = self.ai_end_review(
                    task_id=task_id,
                    model_name=model_name,
                    event_callback=event_callback,
                )
                self._emit(event_callback, {"type": "longterm_review_result", "payload": review_payload})
                continue

            pointer = task.get("pointer") if isinstance(task.get("pointer"), dict) else {}
            self._emit(event_callback, {
                "type": "longterm_stage",
                "stage": "step_execute",
                "step_id": pointer.get("current_step_id"),
                "step_index": pointer.get("current_step_index"),
            })
            task, step_payload = self.ai_execute_current_step(
                task_id=task_id,
                model_name=model_name,
                event_callback=event_callback,
            )
            self._emit(event_callback, {"type": "longterm_step_result", "payload": step_payload})

        # 超过循环上限，自动暂停
        task = self.set_status(task_id, "paused", reason="run_auto reached max_cycles")
        return task
