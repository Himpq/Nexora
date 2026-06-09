"""共享的 LLM 上下文压缩构建器。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable, Mapping

try:
    from NexoraLearning import prompts as learning_prompts
except ImportError:
    import prompts as learning_prompts

from ..runlog import append_llm_compress_log


def _render_prompt(template: str, values: Mapping[str, Any]) -> str:
    """Render {{var}} placeholders with plain string substitution."""
    text = str(template or "")
    pattern = re.compile(r"\{\{\s*([a-zA-Z0-9_\-]+)\s*\}\}")

    def _replace(match: re.Match[str]) -> str:
        key = str(match.group(1) or "").strip()
        return str(values.get(key, ""))

    return pattern.sub(_replace, text)


def _load_prompt_text(cfg: Mapping[str, Any], key: str, fallback_text: str) -> str:
    """Load prompt from data/prompts/<key>.md, fallback to code prompt text."""
    base_dir = Path(str((cfg or {}).get("data_dir") or "./data")).resolve()
    prompt_dir = base_dir / "prompts"
    prompt_file = prompt_dir / f"{str(key or '').strip()}.md"

    try:
        prompt_dir.mkdir(parents=True, exist_ok=True)

        if prompt_file.exists():
            text = prompt_file.read_text(encoding="utf-8")

            if str(text).strip():
                return str(text)

        prompt_file.write_text(str(fallback_text or ""), encoding="utf-8")
    except Exception:
        pass

    return str(fallback_text or "")


def build_llm_compress_func(runner: Any, cfg: Mapping[str, Any]) -> Callable[[str], str]:
    """构建统一的 LLM 上下文压缩函数。"""
    system_prompt = _load_prompt_text(
        cfg,
        "llm_compress_system",
        learning_prompts.LLM_COMPRESS_SYSTEM_PROMPT,
    )
    user_template = _load_prompt_text(
        cfg,
        "llm_compress_user",
        learning_prompts.LLM_COMPRESS_USER_PROMPT,
    )

    def _llm_compress_func(text: str) -> str:
        user_prompt = _render_prompt(
            user_template,
            {
                "dialogue_history": str(text or "").strip(),
            },
        )

        request_messages = [
            {"role": "system", "content": str(system_prompt or "").strip()},
            {"role": "user", "content": str(user_prompt or "").strip()},
        ]

        response = runner.nexora_client.proxy.complete_raw(
            messages=request_messages,
            model=runner.model_name,
            username=None,
            api_mode="chat",
            options={
                "temperature": 0.2,
                "max_tokens": 1200,
                "stream": False,
                "think": False,
            },
            request_timeout=60,
        )

        if bool(response.get("success")):
            compressed = str(response.get("content") or "").strip()

            if compressed:
                return compressed

        append_llm_compress_log(
            {
                "trace_meta": {
                    "flow": "llm_compress_call",
                    "model_name": str(runner.model_name or ""),
                },
                "request": {
                    "messages": request_messages,
                    "history_chars": len(str(text or "")),
                },
                "response": response,
                "error": "LLM compression failed: no valid response",
            }
        )
        raise RuntimeError(
            f"LLM compression failed: no valid response | details={str(response.get('message') or response.get('content') or '')[:300]}"
        )

    return _llm_compress_func
