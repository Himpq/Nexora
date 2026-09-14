"""排练用：用服务进程同款环境探测模型代理，看 Judgment Loop 为何回退到规则。"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

env_file = ROOT / ".env.local"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())

import main  # noqa: E402

loader = next((name for name in ("ensure_bootstrap", "load_config", "_load_config", "build_config") if hasattr(main, name)), None)
cfg = getattr(main, loader)() if loader else json.load(open(ROOT / "data" / "config.json", encoding="utf-8"))
nexora = cfg.get("nexora", {})
print("loader", loader)
print("base_url", nexora.get("base_url"), "| key set", bool(nexora.get("api_key")), "| default model", repr(cfg.get("models", {}).get("default_nexora_model")))

from core.decision import judgment  # noqa: E402

print("enabled", judgment._enabled(cfg), "| model", judgment._model_name(cfg))
result = judgment._client(cfg).complete_raw(
    messages=[{"role": "system", "content": "只回复 JSON"}, {"role": "user", "content": '{"ping": 1}'}],
    model=judgment._model_name(cfg),
    api_mode="chat",
    options={"temperature": 0.2, "max_tokens": 50},
    request_timeout=25,
)
print("success", result.get("success"), "| status", result.get("status"), "| endpoint", result.get("endpoint"))
print("message", str(result.get("message"))[:300])
print("content", str(result.get("content"))[:200])
if not result.get("success"):
    print("payload", json.dumps(result.get("payload"), ensure_ascii=False)[:400])
    sys.exit(1)

# 第二段：真实 bundle + 裁决 prompt，看原始回复与解析结果。
import time  # noqa: E402

username = sys.argv[1] if len(sys.argv) > 1 else "demo_student"
bundle = judgment.build_context_bundle(
    cfg, username, now=int(time.time()), trigger="prep_done",
    signals={"prep_done": True}, target={"chapter_name": "第三章 傅里叶变换"}, minutes=15,
)
print("bundle chars", len(json.dumps(bundle, ensure_ascii=False)), "| cognition", bundle["cognition"], "| history", len(bundle["history"]))
started = time.time()
params = judgment._params(cfg)
raw = judgment._client(cfg).complete_raw(
    messages=[{"role": "system", "content": judgment._JUDGE_SYSTEM}, {"role": "user", "content": json.dumps(bundle, ensure_ascii=False)}],
    model=judgment._model_name(cfg), api_mode="chat",
    options=judgment._model_options(params, max_tokens=int(params["max_tokens"]), temperature=float(params["temperature"])),
    request_timeout=float(params["timeout"]),
)
print("judge call %.1fs success=%s status=%s options=%s" % (time.time() - started, raw.get("success"), raw.get("status"), judgment._model_options(params, max_tokens=int(params["max_tokens"]), temperature=0.2)))
content, why = judgment._completion_text(raw)
print("content(%s):" % (why or "ok"), content[:700])
if not content:
    print("raw payload:", json.dumps(raw.get("payload"), ensure_ascii=False)[:600])
parsed = judgment._parse_object(content)
print("parsed:", parsed is not None, "| normalized:", judgment._normalize(parsed) if parsed else None)
