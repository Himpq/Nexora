#!/usr/bin/env python3
"""agent_smoke.py — NexoraLearning Agent Facade 冒烟测试脚本

本地和云端用同一套脚本: 本地日常开发跑 127.0.0.1:5001, 关键节点部署后
立刻对云端跑一遍做回归。

用法:
  # 本地默认端口
  python tools/agent_smoke.py
  # 指定目标
  python tools/agent_smoke.py --base-url http://127.0.0.1:5001 --username cjbpq
  # 云端回归(密钥建议走环境变量, 不留在命令行历史)
  $env:NEXORALEARNING_RUNTIME_API_KEY = "<secret>"
  python tools/agent_smoke.py --base-url https://chat.himpqblog.cn:5002 --username cjbpq --check-auth
  # 只读模式: 跳过 open-session 等写接口
  python tools/agent_smoke.py --read-only

步骤:
  1. GET /health                         服务存活(硬性)
  2. GET /api/agent/v1/context           用户上下文与信封结构
  3. GET /api/agent/v1/today             今日摘要(ready/resume/needs_course 均合法)
  4. POST /api/agent/v1/plan             学习计划(依赖模型, 不可用时降级为 WARN)
  5. POST /api/agent/v1/open-session     学习会话与深链接(可 --read-only 跳过)
  6. POST /api/agent/v1/ask-in-context   教材上下文问答(依赖模型, 降级为 WARN)
  7. (--check-auth) 错误 key 必须 401    公网部署鉴权回归项

退出码: 0 = 无硬性失败(WARN 允许); 1 = 存在 FAIL。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

ENVELOPE_KEYS = ("success", "request_id", "action", "data", "next_actions", "error")
MODEL_UNAVAILABLE_CODES = {"MODEL_UNAVAILABLE", "MODEL_TIMEOUT", "UPSTREAM_ERROR"}

PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"
SKIP = "SKIP"


def _request(base_url: str, method: str, path: str, *, key: str = "", headers: dict | None = None,
             body: dict | None = None, username: str = "", timeout: int = 20):
    url = base_url.rstrip("/") + path
    req_headers = {"Accept": "application/json"}
    if key:
        req_headers["X-API-Key"] = key
    if username:
        req_headers["X-Nexora-Username"] = username
    if headers:
        req_headers.update(headers)
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, {"_raw": raw[:200]}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, {"_raw": raw[:200]}
    except Exception as exc:  # URLError/超时等
        return None, {"_transport_error": str(exc)}


def _check_envelope(name: str, status: int, body: dict, results: list) -> bool:
    ok = isinstance(body, dict) and "success" in body
    if not ok:
        results.append((name, FAIL, f"HTTP {status}, 非标准信封: {str(body)[:160]}"))
        return False
    if not isinstance(body.get("success"), bool) or "error" not in body or "action" not in body:
        results.append((name, FAIL, f"信封字段缺失: {list(body)[:10]}"))
        return False
    if not body["success"]:
        results.append((name, FAIL, f"success=false: {body.get('error')}"))
        return False
    return True


def main() -> int:
    # Windows 控制台(GBK)与重定向输出下保持 UTF-8, 避免特殊字符/中文编码崩溃
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="NexoraLearning Agent Facade 冒烟测试")
    parser.add_argument("--base-url", default=os.environ.get("NEXORALEARNING_BASE_URL", "http://127.0.0.1:5001"))
    parser.add_argument("--username", default=os.environ.get("NEXORALEARNING_USERNAME", "cjbpq"))
    parser.add_argument("--key", default=os.environ.get("NEXORALEARNING_RUNTIME_API_KEY", ""))
    parser.add_argument("--check-auth", action="store_true", help="验证错误 API key 被 401 拒绝(部署前必跑)")
    parser.add_argument("--read-only", action="store_true", help="跳过 open-session 等写接口")
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()

    results: list[tuple[str, str, str]] = []
    print(f"目标: {args.base_url}  用户: {args.username}\n")

    def run(name, method, path, **kw):
        status, body = _request(args.base_url, method, path, key=args.key,
                                username=kw.pop("username", args.username), timeout=args.timeout, **kw)
        if status is None:
            results.append((name, FAIL, f"连接失败: {body.get('_transport_error')}"))
            return None, None
        return status, body

    # 1. health
    status, body = run("health", "GET", "/health")
    if status == 200:
        results.append(("health", PASS, f"HTTP 200 {body.get('service', '')} {body.get('version', '')}"))
    else:
        results.append(("health", FAIL, f"HTTP {status}"))
        _print_results(results)
        return 1

    # 2. context
    status, body = run("context", "GET", f"/api/agent/v1/context?username={args.username}")
    if _check_envelope("context", status, body, results):
        data = body.get("data") or {}
        lectures = data.get("lectures") or []
        results.append(("context", PASS,
                        f"action={body['action']}, 课程数={len(lectures)}, 活跃会话={bool(data.get('active_session'))}"))

    # 3. today
    status, body = run("today", "GET", f"/api/agent/v1/today?username={args.username}")
    if _check_envelope("today", status, body, results):
        data = body.get("data") or {}
        st = data.get("status", "-")
        if st in ("ready", "resume", "needs_course"):
            results.append(("today", PASS, f"status={st}, next={[a.get('type') for a in body.get('next_actions', [])]}"))
        else:
            results.append(("today", WARN, f"未知 status={st}"))

    # 4. plan
    status, body = run("plan", "POST", "/api/agent/v1/plan",
                       body={"username": args.username, "intent": "continue_learning", "available_minutes": 30})
    if isinstance(body, dict) and "success" in body:
        data = body.get("data") or {}
        code = (body.get("error") or {}).get("code", "")
        if body["success"]:
            plan_obj = data.get("plan") or data
            results.append(("plan", PASS,
                            f"status={plan_obj.get('status', '-')}, 目标={plan_obj.get('target', {})}"))
        elif code in MODEL_UNAVAILABLE_CODES:
            results.append(("plan", WARN, f"模型不可用({code}): {body['error'].get('message', '')[:120]}"))
        elif data.get("status") == "needs_course":
            results.append(("plan", PASS, "needs_course(正常业务分支): 用户尚未选课"))
        else:
            results.append(("plan", FAIL, f"{code}: {body['error'].get('message', '')[:160]}"))
    else:
        results.append(("plan", FAIL, f"HTTP {status} 非信封响应"))

    # 5. open-session (写)
    if args.read_only:
        results.append(("open-session", SKIP, "--read-only"))
    else:
        status, body = run("open-session", "POST", "/api/agent/v1/open-session",
                           body={"username": args.username, "idempotency": uuid.uuid4().hex[:8]})
        if _check_envelope("open-session", status, body, results):
            data = body.get("data") or {}
            target = data.get("target") or {}
            results.append(("open-session", PASS,
                            f"session={data.get('session_id', '-')}, 章节={target.get('chapter_index', '-')}, entry={data.get('entry_type', '-')}"))

    # 6. ask-in-context (模型)
    status, body = run("ask-in-context", "POST", "/api/agent/v1/ask-in-context",
                       body={"username": args.username, "question": "请用一句话概括第一章的核心内容。"})
    if isinstance(body, dict) and "success" in body:
        code = (body.get("error") or {}).get("code", "")
        if body["success"]:
            answer = (body.get("data") or {}).get("answer", "")
            results.append(("ask-in-context", PASS, f"回答 {len(str(answer))} 字"))
        elif code in MODEL_UNAVAILABLE_CODES:
            results.append(("ask-in-context", WARN, f"模型不可用({code}): {body['error'].get('message', '')[:120]}"))
        else:
            results.append(("ask-in-context", FAIL, f"{code}: {body['error'].get('message', '')[:160]}"))
    else:
        results.append(("ask-in-context", FAIL, f"HTTP {status} 非信封响应"))

    # 7. 鉴权回归(可选): 错误 key 必须 401
    if args.check_auth:
        status, body = _request(args.base_url, "GET", f"/api/agent/v1/context?username={args.username}",
                                key="definitely-wrong-key", username=args.username, timeout=args.timeout)
        if status == 401:
            results.append(("auth-reject", PASS, "错误 key 返回 401"))
        elif status == 200:
            results.append(("auth-reject", WARN,
                            "错误 key 仍返回 200: runtime_api.api_key 为空。接入小艺/公网部署前必须设置 NEXORALEARNING_RUNTIME_API_KEY"))
        else:
            results.append(("auth-reject", FAIL, f"HTTP {status}(预期 401)"))

    _print_results(results)
    return 0 if not any(r == FAIL for _, r, _ in results) else 1


def _print_results(results):
    print("\n" + "=" * 72)
    for name, verdict, detail in results:
        mark = {"PASS": "[PASS]", "WARN": "[WARN]", "FAIL": "[FAIL]", "SKIP": "[SKIP]"}[verdict]
        print(f"{mark} {name:<16} {detail}")
    fails = sum(1 for _, v, _ in results if v == FAIL)
    warns = sum(1 for _, v, _ in results if v == WARN)
    print("-" * 72)
    print(f"共 {len(results)} 项: FAIL={fails}, WARN={warns}")
    print("结论: " + ("FAIL - 存在硬性失败" if fails else "PASS - 冒烟通过(本地开发) / 可进入平台联调(云端)"))


if __name__ == "__main__":
    sys.exit(main())
