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
import hashlib
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Callable, Dict, List, Mapping, Optional

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
        raise ValueError("服务返回了空响应")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("服务返回了无效的 JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("服务返回的数据格式不正确")
    _check_result(value)
    return value


def _check_result(result: Mapping[str, Any]) -> None:
    if result.get("success") is False or result.get("ok") is False:
        raise ValueError(str(result.get("message") or result.get("error") or "服务执行失败"))


def _service_headers(cfg: Mapping[str, Any], key: str, *, bearer: bool = False) -> Dict[str, str]:
    section = cfg.get(key) if isinstance(cfg.get(key), dict) else {}
    auth = section.get("auth") if isinstance(section.get("auth"), dict) else {}
    env_key = "NEXORALEARNING_" + key.replace("_", "").upper() + "_API_KEY"
    secret = str(os.environ.get(env_key) or section.get("api_key") or section.get("token") or auth.get("token") or "").strip()
    return ({"Authorization": f"Bearer {secret}"} if bearer else {"X-API-Key": secret}) if secret else {}


def _service_url(cfg: Mapping[str, Any], key: str) -> str:
    section = cfg.get(key) if isinstance(cfg, dict) and isinstance(cfg.get(key), dict) else {}
    return str(section.get("service_url") or "").strip().rstrip("/")


def _failure(reason: str) -> Dict[str, Any]:
    return {"ok": False, "error": reason}


def requests_kb_write(command: str) -> bool:
    """Mentions of a library (or instructions quoted in a mail) are not consent."""
    if re.search(r"(?:不要|不用|别|不需要|不想|无需|禁止|不能).{0,16}(?:保存|存入|入库|存到|加入|知识库)", command):
        return False
    if re.search(r"(?:怎么|如何|为什么).{0,16}(?:保存|存入|入库|知识库)", command):
        return False
    return bool(re.search(r"(?:保存|存入|存到|收进|加入).{0,10}知识库|知识库.{0,10}(?:保存|存入)|(?:正文|资料|邮件|内容).{0,10}入库", command))


def requests_mail_plan(command: str) -> bool:
    if "邮件" not in command or re.search(r"(?:不要|不用|别|不需要|不想|无需).{0,16}(?:安排|计划|复习|整理|出题)", command):
        return False
    return bool(re.search(r"(?:整理成|安排成|转成|变成|生成|制定|规划).{0,24}(?:学习|复习|计划)|(?:整理|处理).{0,20}邮件.{0,20}(?:计划|复习)|(?:根据|按照|按).{0,20}邮件.{0,20}(?:安排|出题|复习|计划)", command))


def kb_upsert(cfg: Mapping[str, Any], username: str, project_id: str, texts: List[str]) -> Dict[str, Any]:
    """T1：资料入库（NexoraDB）。返回 kbfile 卡数据。"""
    base = _service_url(cfg, "nexoradb")
    if not base:
        return _failure("NexoraDB 未配置")
    headers = _service_headers(cfg, "nexoradb")
    try:
        clean_texts = [str(item).strip() for item in texts if str(item).strip()]
        if not clean_texts:
            return _failure("没有可存入知识库的文字")
        # NexoraDB projects are selected by the server API key; library is the
        # user-visible namespace. Stable document IDs make a retried upsert safe.
        payload = {"username": username, "library": str(project_id or "default"), "items": [
            {"title": "agent_" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:24],
             "text": text, "chunk_id": 0, "metadata": {"source": "agent_toolbox"}}
            for text in clean_texts
        ]}
        result = _http_json(f"{base}/upsert_texts", method="POST", payload=payload, headers=headers, timeout=int(_params(cfg)["timeout_seconds"]))
        _check_result(result)
        count = int(result.get("count", len(payload["items"])))
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
    headers = _service_headers(cfg, "nexoradb")
    try:
        payload = {"username": username, "library": str(project_id or "default"), "text": str(query).strip(), "top_k": max(1, min(10, int(k)))}
        result = _http_json(f"{base}/query_text", method="POST", payload=payload, headers=headers, timeout=int(_params(cfg)["timeout_seconds"]))
        _check_result(result)
        found = result.get("result") if isinstance(result.get("result"), dict) else {}
        documents = (found.get("documents") or [[]])[0]
        metadatas = (found.get("metadatas") or [[]])[0]
        chunks = [{"text": text, "metadata": metadatas[index] if index < len(metadatas) else {}}
                  for index, text in enumerate(documents)] if documents else result.get("chunks") or result.get("results") or []
        if not isinstance(chunks, list):
            chunks = []
        cards: List[Dict[str, Any]] = []
        for row in chunks[: max(1, int(k))]:
            if not isinstance(row, dict):
                continue
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            cards.append({
                "type": "citation",
                "book": str(metadata.get("title") or row.get("source") or "知识库"),
                "chapter": str(metadata.get("chapter_name") or ""),
                "excerpt": str(row.get("text") or row.get("content") or "")[:4000],
                "anchor": str(metadata.get("url") or ""),
            })
        return {"ok": True, "cards": cards, "detail": result}
    except Exception as exc:
        log_event("toolbox_kb_query_failed", "知识库检索失败", payload={"user_id": username, "error": str(exc)})
        return _failure(f"检索失败：{exc}")


def web_search(cfg: Mapping[str, Any], username: str, query: str, limit: int = 3) -> Dict[str, Any]:
    """T3：联网补充（NexoraSearch）→ search 卡。"""
    service_key = "nexorasearch"
    base = _service_url(cfg, service_key)
    if not base:
        service_key = "nexora_search"
        base = _service_url(cfg, service_key)
    if not base:
        return _failure("NexoraSearch 未配置")
    try:
        params = urllib.parse.urlencode({"query": str(query), "max_results": max(1, min(10, int(limit))), "fetch_content": "false"})
        result = _http_json(f"{base}/api/search/ddg?{params}", headers=_service_headers(cfg, service_key, bearer=True), timeout=int(_params(cfg)["timeout_seconds"]))
        _check_result(result)
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


def mail_fetch(cfg: Mapping[str, Any], username: str, group: str = "", user: str = "", limit: int = 5, *, include_content: bool = False) -> Dict[str, Any]:
    """T4：邮件读取 → mail 卡。"""
    base = _service_url(cfg, "nexora_mail")
    if not base:
        return _failure("NexoraMail 未配置")
    resolved_group = str(_params(cfg)["mail_group"])
    if (user and str(user) != username) or (group and str(group) != resolved_group):
        return _failure("只能读取当前账号绑定的邮箱")
    mailbox = f"{urllib.parse.quote(resolved_group, safe='')}/{urllib.parse.quote(username, safe='')}"
    headers = _service_headers(cfg, "nexora_mail")
    try:
        result = _http_json(f"{base}/api/mailboxes/{mailbox}/mails?limit={max(1, min(20, int(limit)))}", headers=headers, timeout=int(_params(cfg)["timeout_seconds"]))
        _check_result(result)
        rows = result.get("mails") if isinstance(result.get("mails"), list) else []
        cards: List[Dict[str, Any]] = []
        for row in rows[: max(1, min(20, int(limit)))]:
            if not isinstance(row, dict):
                continue
            if include_content and row.get("id"):
                detail = _http_json(f"{base}/api/mailboxes/{mailbox}/mails/{urllib.parse.quote(str(row['id']), safe='')}", headers=headers, timeout=int(_params(cfg)["timeout_seconds"]))
                _check_result(detail)
                row = detail.get("mail") if isinstance(detail.get("mail"), dict) else row
            cards.append({
                "type": "mail",
                "mailId": str(row.get("id") or ""),
                "from": str(row.get("sender") or row.get("from") or ""),
                "subject": str(row.get("subject") or ""),
                "summary": str(row.get("preview_text") or row.get("preview") or row.get("summary") or row.get("body") or "")[:500],
                "content": str(row.get("content_text") or row.get("body") or "")[:50000] if include_content else "",
                "dueDate": str(row.get("due_date") or "") or None,
            })
        return {"ok": True, "cards": cards, "detail": result}
    except Exception as exc:
        log_event("toolbox_mail_fetch_failed", "邮件读取失败", payload={"user_id": username, "error": str(exc)})
        return _failure(f"邮件读取失败：{exc}")


def _tool_step(cfg: Mapping[str, Any], username: str, text: str, reason: str, *, card: Optional[Dict[str, Any]] = None, status: str = "completed") -> None:
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
        "card": card,
        "status": status,
        "source": "toolbox",
    })


def video_for_lecture(cfg: Mapping[str, Any], username: str, lecture_id: str, limit: int = 3) -> Dict[str, Any]:
    """T6：章节配套视频（NexoraLearning 自身 /frontend/lecture-videos，只读缓存不触发搜索）。"""
    try:
        from core.lectures import list_books
        from core.video_search import load_cached_videos

        if lecture_id not in user_store.list_selected_lecture_ids(dict(cfg), username):
            return _failure("请先选择这门课程")
        items = []
        seen = set()
        for book in list_books(dict(cfg), lecture_id):
            for row in load_cached_videos(dict(cfg), lecture_id, str(book.get("id") or "")):
                url = str(row.get("url") or "") if isinstance(row, dict) else ""
                if url and url not in seen:
                    seen.add(url)
                    items.append(row)
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
        return {"ok": True, "cards": cards, "cached": True}
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


def orchestrate(
    cfg: Mapping[str, Any], username: str, command: str, *,
    create_plan: Optional[Callable[[str], Dict[str, Any]]] = None,
    create_review: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    run_once: Optional[Callable[[str, Callable[[], Dict[str, Any]]], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Read the actual mail, optionally store its text, then create real work.

    The facade supplies its normal planning/task services. Missing services or
    failed steps are reported explicitly, never represented as completed work.
    """
    current = int(time.time())
    execute = run_once or (lambda name, callback: callback())
    steps: List[Dict[str, Any]] = []
    store_requested = requests_kb_write(command)
    plan_requested = requests_mail_plan(command)
    if not store_requested and not plan_requested:
        return {"ok": False, "error": "请明确说明要将邮件正文保存到知识库，或整理成学习计划。", "steps": []}
    fetch = execute("mail_source", lambda: mail_fetch(cfg, username, limit=1, include_content=True))
    if not fetch.get("ok"):
        return {"ok": False, "error": fetch.get("error"), "steps": steps}
    cards = fetch.get("cards") or []
    if not cards:
        return {"ok": False, "error": "没有可处理的邮件", "steps": steps}
    mail = cards[0]
    subject = str(mail.get("subject") or "")
    _tool_step(cfg, username, f"已读取邮件：{subject}。", "读取当前账号的最新邮件。", card=mail)
    steps.append({"type": "mail", "status": "completed", "mail_id": mail.get("mailId", "")})
    output_cards = [mail]
    warnings = []
    if "附件" in command:
        warnings.append("邮件服务暂未提供附件导入；本次处理的是邮件正文。")
    if store_requested:
        text = str(mail.get("content") or mail.get("summary") or "").strip()
        upsert = execute("kb_upsert", lambda: kb_upsert(cfg, username, "default", [f"邮件：{subject}\n{text}"]))
        if not upsert.get("ok"):
            _tool_step(cfg, username, f"邮件已读取，正文入库失败：{upsert.get('error')}。", "入库失败。", status="failed")
            return {"ok": False, "error": upsert.get("error"), "steps": steps, "cards": output_cards}
        card = upsert.get("card")
        _tool_step(cfg, username, "邮件正文已存进知识库。", "已收到知识库服务确认。", card=card)
        if isinstance(card, dict):
            output_cards.append(card)
        steps.append({"type": "kb_upsert", "status": "completed"})
    if not plan_requested:
        return {"ok": True, "mail": mail, "steps": steps, "cards": output_cards, "warnings": warnings,
                "answer": "邮件正文已存入知识库。", "generated_at": current}
    if not callable(create_plan) or not callable(create_review):
        return {"ok": False, "error": "学习计划执行服务未初始化，尚未创建计划或复习题。", "steps": steps, "cards": output_cards}
    intent = f"{command}\n邮件主题：{subject}\n邮件正文：{str(mail.get('content') or mail.get('summary') or '')[:4000]}"
    planned = execute("plan", lambda: create_plan(intent))
    plan = planned.get("plan") if isinstance(planned.get("plan"), dict) else None
    if plan is None:
        return {"ok": False, "error": str(planned.get("error") or "请先选择课程，再安排学习计划。"), "steps": steps, "cards": output_cards}
    steps.append({"type": "plan", "status": "completed", "target": plan["target"]})
    task = execute("review_plan", lambda: create_review(plan["target"]))
    steps.append({"type": "review_plan", "status": task["status"], "task_id": task["task_id"]})
    quiz_card = {"type": "quiz", "taskId": task["task_id"], "questionId": task["task_id"],
                 "stem": "复习任务已创建，打开后查看出题进度。", "options": [], "target": plan["target"]}
    output_cards.append(quiz_card)
    _tool_step(cfg, username, "学习计划已创建，复习出题任务已提交。", "任务状态以出题服务返回为准。", card=quiz_card)
    result = {
        "ok": True,
        "mail": mail,
        "intent": intent,
        "steps": steps,
        "plan": plan,
        "task": task,
        "task_id": task["task_id"],
        "cards": output_cards,
        "warnings": warnings,
        "next_actions": [{"type": "review_task", "task_id": task["task_id"], "target": plan["target"]}],
        "generated_at": current,
    }
    log_event("toolbox_orchestrate", "跨域编排完成", payload={"user_id": username, "subject": subject, "intent": intent})
    return result
