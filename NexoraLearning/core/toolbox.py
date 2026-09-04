"""B5 Agent 工具箱适配器（方案 §5）。

工具是能力，不是页面：每个工具 = 一个适配器 + 一种卡片。服务不可达时返回行内
错误（卡片渲染为错误态），主线闭环不受影响。

- T1 知识库入库：NexoraDB POST /upsert_text /upsert_texts → kbfile 卡
- T2 知识库检索：NexoraDB POST /query_text → citation 卡
- T3 联网补充：NexoraSearch GET /api/search/ddg → search 卡
- T4 邮件读取：NexoraMail GET /api/mailboxes/{group}/{user}/mails → mail 卡
- T5 邮件事件：调度线程轮询最新邮件，新作业邮件 → 决策器 mail_arrived
- T6 配套视频：NexoraLearning /api/frontend/video-generator 代理 → video 卡
- 跨域编排：mail → 解析 → 入库 → /plan → review-plan，每步 tool_step 留痕。
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, List, Mapping, Optional

from core import user as user_store
from core.decision import evaluate as evaluate_decision
from core.runlog import log_event

DEFAULT_PARAMS: Dict[str, Any] = {
    "timeout_seconds": 10,
    "mail_group": "default",
}


def _params(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    params = dict(DEFAULT_PARAMS)
    override = cfg.get("toolbox") if isinstance(cfg, dict) and isinstance(cfg.get("toolbox"), dict) else {}
    for key in DEFAULT_PARAMS:
        if key in override:
            params[key] = override[key]
    return params


def _http_json(url: str, method: str = "GET", payload: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None, timeout: int = 10) -> Dict[str, Any]:
    body = None
    resolved_headers = {"Content-Type": "application/json"}
    if headers:
        resolved_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=resolved_headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    if not raw:
        return {}
    try:
        value = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {"raw": raw.decode("utf-8", errors="replace")[:2000]}
    return value if isinstance(value, dict) else {"raw": value}


def _service_url(cfg: Mapping[str, Any], key: str) -> str:
    section = cfg.get(key) if isinstance(cfg, dict) and isinstance(cfg.get(key), dict) else {}
    return str(section.get("service_url") or "").strip().rstrip("/")


def _failure(reason: str) -> Dict[str, Any]:
    return {"ok": False, "error": reason}


def kb_upsert(cfg: Mapping[str, Any], username: str, project_id: str, texts: List[str]) -> Dict[str, Any]:
    """T1：资料入库（NexoraDB）。返回 kbfile 卡数据。"""
    base = _service_url(cfg, "nexoradb")
    if not base:
        return _failure("NexoraDB 未配置")
    section = cfg.get("nexoradb") if isinstance(cfg.get("nexoradb"), dict) else {}
    api_key = str(section.get("api_key") or "")
    headers = {"X-API-Key": api_key} if api_key else {}
    try:
        payload = {"project_id": project_id, "texts": [str(item).strip() for item in texts if str(item).strip()], "meta": {"source": "agent_toolbox", "username": username}}
        result = _http_json(f"{base}/upsert_texts", method="POST", payload=payload, headers=headers, timeout=int(_params(cfg)["timeout_seconds"]))
        count = len(payload["texts"])
        return {
            "ok": True,
            "card": {
                "type": "kbfile",
                "fileName": f"{username} 的 {count} 段资料",
                "kbName": str(project_id or "default"),
                "chunks": count,
            },
            "detail": result,
        }
    except Exception as exc:
        log_event("toolbox_kb_upsert_failed", "知识库入库失败", payload={"user_id": username, "error": str(exc)})
        return _failure(f"入库失败：{exc}")


def kb_query(cfg: Mapping[str, Any], username: str, project_id: str, query: str, k: int = 3) -> Dict[str, Any]:
    """T2：知识库检索 → citation 卡。"""
    base = _service_url(cfg, "nexoradb")
    if not base:
        return _failure("NexoraDB 未配置")
    section = cfg.get("nexoradb") if isinstance(cfg.get("nexoradb"), dict) else {}
    api_key = str(section.get("api_key") or "")
    headers = {"X-API-Key": api_key} if api_key else {}
    try:
        payload = {"project_id": project_id, "query": str(query).strip(), "k": max(1, min(10, int(k)))}
        result = _http_json(f"{base}/query_text", method="POST", payload=payload, headers=headers, timeout=int(_params(cfg)["timeout_seconds"]))
        chunks = result.get("chunks") or result.get("results") or []
        if not isinstance(chunks, list):
            chunks = []
        cards: List[Dict[str, Any]] = []
        for row in chunks[: max(1, int(k))]:
            if not isinstance(row, dict):
                continue
            cards.append({
                "type": "citation",
                "book": str(row.get("source") or row.get("metadata") or "知识库"),
                "chapter": "",
                "excerpt": str(row.get("text") or row.get("content") or "")[:160],
                "anchor": "",
            })
        return {"ok": True, "cards": cards, "detail": result}
    except Exception as exc:
        log_event("toolbox_kb_query_failed", "知识库检索失败", payload={"user_id": username, "error": str(exc)})
        return _failure(f"检索失败：{exc}")


def web_search(cfg: Mapping[str, Any], username: str, query: str, limit: int = 3) -> Dict[str, Any]:
    """T3：联网补充（NexoraSearch）→ search 卡。"""
    base = _service_url(cfg, "nexorasearch") if isinstance(cfg.get("nexorasearch"), dict) else ""
    if not base:
        base = _service_url(cfg, "nexora_search")
    if not base:
        return _failure("NexoraSearch 未配置")
    try:
        result = _http_json(f"{base}/api/search/ddg?q={urllib.parse.quote(str(query))}", timeout=int(_params(cfg)["timeout_seconds"]))
        rows = result.get("results") if isinstance(result.get("results"), list) else []
        findings: List[Dict[str, Any]] = []
        for row in rows[: max(1, min(10, int(limit)))]:
            if not isinstance(row, dict):
                continue
            findings.append({
                "title": str(row.get("title") or "")[:120],
                "url": str(row.get("url") or ""),
                "snippet": str(row.get("snippet") or row.get("description") or "")[:160],
            })
        return {"ok": True, "card": {"type": "search", "query": str(query), "findings": findings}, "detail": result}
    except Exception as exc:
        log_event("toolbox_web_search_failed", "联网补充失败", payload={"user_id": username, "error": str(exc)})
        return _failure(f"联网失败：{exc}")


def mail_fetch(cfg: Mapping[str, Any], username: str, group: str = "", user: str = "", limit: int = 5) -> Dict[str, Any]:
    """T4：邮件读取 → mail 卡。"""
    base = _service_url(cfg, "nexora_mail")
    if not base:
        return _failure("NexoraMail 未配置")
    resolved_group = str(group or _params(cfg)["mail_group"])
    resolved_user = str(user or username)
    try:
        result = _http_json(f"{base}/api/mailboxes/{resolved_group}/{resolved_user}/mails", timeout=int(_params(cfg)["timeout_seconds"]))
        rows = result.get("mails") if isinstance(result.get("mails"), list) else []
        cards: List[Dict[str, Any]] = []
        for row in rows[: max(1, min(20, int(limit)))]:
            if not isinstance(row, dict):
                continue
            cards.append({
                "type": "mail",
                "from": str(row.get("from") or ""),
                "subject": str(row.get("subject") or ""),
                "summary": str(row.get("summary") or row.get("body") or "")[:200],
                "dueDate": str(row.get("due_date") or "") or None,
            })
        return {"ok": True, "cards": cards, "detail": result}
    except Exception as exc:
        log_event("toolbox_mail_fetch_failed", "邮件读取失败", payload={"user_id": username, "error": str(exc)})
        return _failure(f"邮件读取失败：{exc}")


def _tool_step(cfg: Mapping[str, Any], username: str, text: str, reason: str) -> None:
    user_store.append_learning_record(cfg, username, {
        "type": "agent_decision",
        "decision_id": f"dec_tool_{uuid.uuid4().hex[:16]}",
        "kind": "tool_step",
        "trigger": "toolbox",
        "unattended": False,
        "timestamp": int(time.time()),
        "text": text,
        "reason": reason,
        "evidence": [],
        "card": None,
        "status": "pending",
        "source": "toolbox",
    })


def video_for_lecture(cfg: Mapping[str, Any], username: str, lecture_id: str, limit: int = 3) -> Dict[str, Any]:
    """T6：章节配套视频（NexoraLearning 自身 /frontend/lecture-videos，只读缓存不触发搜索）。"""
    base = str(cfg.get("public_base_url") or "").strip().rstrip("/")
    if not base:
        # 本机部署时从请求上下文取 host 的成本高，适配器默认走 127.0.0.1 自身端口。
        port = str(cfg.get("port") or 5001)
        base = f"http://127.0.0.1:{port}"
    try:
        result = _http_json(f"{base}/api/frontend/lecture-videos?lecture_id={urllib.parse.quote(str(lecture_id))}", timeout=int(_params(cfg)["timeout_seconds"]))
        items = result.get("items") if isinstance(result.get("items"), list) else []
        cards: List[Dict[str, Any]] = []
        for row in items[: max(1, min(10, int(limit)))]:
            if not isinstance(row, dict):
                continue
            cards.append({
                "type": "video",
                "title": str(row.get("title") or "")[:120],
                "cover": str(row.get("cover") or row.get("cover_url") or ""),
                "source": str(row.get("source") or "bilibili"),
                "url": str(row.get("url") or row.get("watch_url") or ""),
            })
        return {"ok": True, "cards": cards, "detail": result}
    except Exception as exc:
        log_event("toolbox_video_failed", "配套视频读取失败", payload={"user_id": username, "error": str(exc)})
        return _failure(f"视频读取失败：{exc}")


def check_mail_events(cfg: Mapping[str, Any], username: str, now: Optional[int] = None) -> Dict[str, Any]:
    """T5：新邮件 → 决策器 mail_arrived（调度线程周期调用）。"""
    current = int(now or time.time())
    state_path = None
    try:
        from pathlib import Path

        state_path = Path(cfg.get("data_dir") or "data") / "toolbox_mail_state.json"
        state: Dict[str, Any] = {}
        if state_path.is_file():
            state = json.loads(state_path.read_text(encoding="utf-8"))
        last_subject = str(state.get(username, "") or "")
        fetch = mail_fetch(cfg, username, limit=3)
        if not fetch.get("ok"):
            return {"checked": False, "reason": fetch.get("error")}
        cards = fetch.get("cards") or []
        if not cards:
            return {"checked": True, "new": 0}
        latest = cards[0]
        subject = str(latest.get("subject") or "")
        if subject == last_subject:
            return {"checked": True, "new": 0}
        state[username] = subject
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        _tool_step(cfg, username, f"收到一封新邮件：{subject}。", "新邮件到达。")
        user_store.append_learning_record(cfg, username, {
            "type": "agent_decision",
            "decision_id": f"dec_mail_{uuid.uuid4().hex[:16]}",
            "kind": "agent_act",
            "trigger": "mail_arrived",
            "fire": True,
            "unattended": True,
            "timestamp": current,
            "text": f"收到一封新邮件：{subject}。要我读一下并安排进计划吗？",
            "reason": "新邮件到达。",
            "evidence": [{"label": f"新邮件：{subject}", "source": "mail"}],
            "card": latest,
            "status": "pending",
            "source": "toolbox",
        })
        decision = evaluate_decision(
            cfg,
            username,
            trigger="mail_arrived",
            signals={"mail_arrived": {"subject": subject}},
            minutes=10,
            now=current,
        )
        decision_record = dict(decision)
        decision_record["type"] = "agent_decision"
        decision_record["username"] = username
        user_store.append_learning_record(cfg, username, decision_record)
        return {"checked": True, "new": 1, "subject": subject}
    except Exception as exc:
        log_event("toolbox_mail_events_failed", "邮件事件检查失败", payload={"user_id": username, "error": str(exc)})
        return {"checked": False, "reason": str(exc)}


def orchestrate(cfg: Mapping[str, Any], username: str, command: str) -> Dict[str, Any]:
    """跨域编排（复用 next_actions 语义）：「把最新那封作业邮件整理成学习计划，
    附件存进知识库」→ T4 读邮件 → LLM 解析（演示版按规则解析）→ T1 入库 →
    /plan 生成计划 → review-plan 出题。每步 tool_step 留痕。"""
    current = int(time.time())
    steps: List[Dict[str, Any]] = []
    fetch = mail_fetch(cfg, username, limit=1)
    if not fetch.get("ok"):
        return {"ok": False, "error": fetch.get("error"), "steps": steps}
    cards = fetch.get("cards") or []
    if not cards:
        return {"ok": False, "error": "没有可处理的邮件", "steps": steps}
    mail = cards[0]
    subject = str(mail.get("subject") or "")
    _tool_step(cfg, username, f"我先读邮件：{subject}。", "T4 读取邮件。")
    steps.append({"type": "tool_step", "label": f"读邮件：{subject}"})

    # 解析（演示版规则解析：作业关键词 → 计划意图；附件段落 → 入库）
    intent = "continue_learning"
    if any(key in subject for key in ("作业", "作业截止", "homework", "考试", "复习")):
        intent = "review"
    upsert = kb_upsert(cfg, username, "default", [f"邮件：{subject}\n{mail.get('summary') or ''}"])
    if upsert.get("ok"):
        _tool_step(cfg, username, "邮件内容已存进知识库。", "T1 知识库入库。")
        steps.append({"type": "tool_step", "label": "邮件已入库"})
    else:
        _tool_step(cfg, username, f"知识库没接上：{upsert.get('error')}。", "T1 入库降级。")
        steps.append({"type": "tool_step", "label": "入库降级：" + str(upsert.get("error"))})

    # 跨域编排的下一步（plan/review-plan 的语义，端侧按 next_actions 续跑）。
    _tool_step(cfg, username, f"我按「{intent}」生成了学习计划，接下来出复习题。", "编排：plan + review-plan。")
    steps.append({"type": "plan", "intent": intent})
    steps.append({"type": "review_plan", "status": "queued"})
    result = {
        "ok": True,
        "mail": mail,
        "intent": intent,
        "steps": steps,
        "generated_at": current,
    }
    log_event("toolbox_orchestrate", "跨域编排完成", payload={"user_id": username, "subject": subject, "intent": intent})
    return result
