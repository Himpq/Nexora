"""共享的 LLM 上下文压缩构建器。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

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


def build_proxy_llm_compress_func(
    proxy: Any,
    model_name: Optional[str],
    cfg: Mapping[str, Any],
    *,
    username: str = "",
    cancel_event: Any = None,
    trace_meta: Optional[Mapping[str, Any]] = None,
) -> Callable[[str], str]:
    """基于现有代理构建统一的 LLM 上下文压缩函数。"""
    system_prompt = _load_prompt_text(
        cfg,
        "llm_compress_system",
        learning_prompts.LLM_COMPRESS_SYSTEM_PROMPT,
    )
    tool_summary_rules = _load_prompt_text(
        cfg,
        "llm_compress_tool_summary_rules",
        learning_prompts.LLM_COMPRESS_TOOL_SUMMARY_RULES,
    )
    user_template = _load_prompt_text(
        cfg,
        "llm_compress_user",
        learning_prompts.LLM_COMPRESS_USER_PROMPT,
    )
    system_prompt = "\n\n".join(
        [
            item
            for item in [
                str(system_prompt or "").strip(),
                str(tool_summary_rules or "").strip(),
            ]
            if item
        ]
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

        request_kwargs: dict[str, Any] = {
            "messages": request_messages,
            "model": model_name,
            "username": str(username or "").strip() or None,
            "api_mode": "chat",
            "options": {
                "temperature": 0.2,
                "max_tokens": 1200,
                "stream": False,
                "think": False,
            },
            "request_timeout": 60,
        }

        if cancel_event is not None:
            request_kwargs["cancel_event"] = cancel_event

        response = proxy.complete_raw(
            **request_kwargs,
        )

        if bool(response.get("success")):
            compressed = str(response.get("content") or "").strip()

            if compressed:
                return compressed

        append_llm_compress_log(
            {
                "trace_meta": {
                    "flow": "llm_compress_call",
                    "model_name": str(model_name or ""),
                    **dict(trace_meta or {}),
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


def build_llm_compress_func(runner: Any, cfg: Mapping[str, Any]) -> Callable[[str], str]:
    """基于 booksproc runner 构建统一的 LLM 上下文压缩函数。"""
    return build_proxy_llm_compress_func(
        runner.nexora_client.proxy,
        runner.model_name,
        cfg,
    )
