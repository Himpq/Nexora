"""Model-layer abstractions for NexoraLearning.


"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import threading
import re
from pathlib import Path
from typing import Any, Callable, Dict, Mapping, Optional, Type

import prompts
from .nexora_proxy import NexoraProxy
from .runlog import log_event


DEFAULT_NEXORA_MODEL = ""
PLACEHOLDER_PATTERN = re.compile(r"{{\s*([^{}]+?)\s*}}")
_MODEL_CONFIG_LOCK = threading.RLock()
_PROMPT_FILE_LOCK = threading.RLock()


DEFAULT_SCHEDULER_MODELS_CONFIG: Dict[str, Any] = {
    "default_nexora_model": DEFAULT_NEXORA_MODEL,
    "rough_reading": {
        "enabled": True,
        "model_name": "",
        "api_mode": "chat",
        "temperature": 0.2,
        "max_output_tokens": 4000,
        "max_output_chars": 240000,
        "request_timeout": 240,
        "prompt_notes": "",
    }
}


def _prompts_dir(cfg: Mapping[str, Any]) -> Path:
    """Return external prompt directory path: <data_dir>/prompts."""
    data_dir = Path(str(cfg.get("data_dir") or "data"))
    return data_dir / "prompts"


def _prompt_file_path(cfg: Mapping[str, Any], model_key: str, prompt_role: str) -> Path:
    """Map prompt key/role to markdown file path."""
    safe_key = re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(model_key or "").strip())
    safe_role = "system" if str(prompt_role or "").strip().lower() == "system" else "user"
    return _prompts_dir(cfg) / f"{safe_key}.{safe_role}.md"


def _load_external_prompt_or_init(
    cfg: Mapping[str, Any],
    *,
    model_key: str,
    prompt_role: str,
    fallback_text: str,
) -> str:
    """Read external prompt file in UTF-8; initialize from fallback if missing."""
    target = _prompt_file_path(cfg, model_key, prompt_role)
    target.parent.mkdir(parents=True, exist_ok=True)
    with _PROMPT_FILE_LOCK:
        if not target.exists():
            target.write_text(str(fallback_text or ""), encoding="utf-8")
            return str(fallback_text or "")
        try:
            return target.read_text(encoding="utf-8")
        except Exception:
            # If broken file encoding/content causes read failure, keep service usable.
            return str(fallback_text or "")


def _scheduler_models_config_path(cfg: Mapping[str, Any]) -> Path:
    """定位全局配置文件路径（models 分支存储在 config.json 中）。"""
    raw = str(cfg.get("_config_path") or "").strip()
    if raw:
        return Path(raw)
    data_dir = Path(str(cfg.get("data_dir") or "data"))
    return data_dir.parent / "config.json"


def load_scheduler_models_config(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    """读取并合并模型调度配置（来源：config.json -> models）。"""
    path = _scheduler_models_config_path(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    base = json.loads(json.dumps(DEFAULT_SCHEDULER_MODELS_CONFIG, ensure_ascii=False))
    if not path.exists():
        root = {"models": base}
        path.write_text(json.dumps(root, ensure_ascii=False, indent=2), encoding="utf-8")
        return base
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return base
    except Exception:
        return base
    models_branch = raw.get("models") if isinstance(raw, dict) else {}
    if not isinstance(models_branch, dict):
        models_branch = {}
    merged = dict(base)
    for key, value in models_branch.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            branch = dict(merged[key])
            branch.update(value)
            merged[key] = branch
        else:
            merged[key] = value
    return merged


def save_scheduler_models_config(cfg: Mapping[str, Any], payload: Mapping[str, Any]) -> Dict[str, Any]:
    """写回模型调度配置到 config.json 的 models 分支。"""
    with _MODEL_CONFIG_LOCK:
        path = _scheduler_models_config_path(cfg)
        path.parent.mkdir(parents=True, exist_ok=True)
        current = load_scheduler_models_config(cfg)
        merged = dict(current)
        for key, value in dict(payload or {}).items():
            if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
                branch = dict(merged[key])
                branch.update(value)
                merged[key] = branch
            else:
                merged[key] = value
        try:
            root = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
            if not isinstance(root, dict):
                root = {}
        except Exception:
            root = {}
        root["models"] = merged
        path.write_text(json.dumps(root, ensure_ascii=False, indent=2), encoding="utf-8")
        return merged


def get_rough_reading_model_config(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    """读取粗读模型配置。"""
    data = load_scheduler_models_config(cfg)
    rough = data.get("rough_reading")
    if isinstance(rough, dict):
        return dict(rough)
    return dict(DEFAULT_SCHEDULER_MODELS_CONFIG["rough_reading"])


def get_default_nexora_model(cfg: Mapping[str, Any]) -> str:
    """读取默认 Nexora 模型名。"""
    data = load_scheduler_models_config(cfg)
    return str(data.get("default_nexora_model") or "").strip()


def update_default_nexora_model(cfg: Mapping[str, Any], model_name: str) -> str:
    """更新默认 Nexora 模型名。空字符串表示不设默认模型。"""
    normalized = str(model_name or "").strip()
    save_scheduler_models_config(cfg, {"default_nexora_model": normalized})
    return normalized


def update_rough_reading_model_config(cfg: Mapping[str, Any], updates: Mapping[str, Any]) -> Dict[str, Any]:
    """更新粗读模型配置并做基础类型校验。"""
    current = get_rough_reading_model_config(cfg)
    allowed_fields = {
        "enabled",
        "model_name",
        "api_mode",
        "temperature",
        "max_output_tokens",
        "max_output_chars",
        "request_timeout",
        "prompt_notes",
    }
    sanitized: Dict[str, Any] = {}
    for key, value in dict(updates or {}).items():
        if key not in allowed_fields:
            continue
        sanitized[key] = value
    if "enabled" in sanitized:
        sanitized["enabled"] = bool(sanitized["enabled"])
    for int_field in ("max_output_tokens", "max_output_chars", "request_timeout"):
        if int_field in sanitized:
            try:
                sanitized[int_field] = max(1, int(sanitized[int_field]))
            except Exception:
                sanitized[int_field] = current.get(int_field)
    if "temperature" in sanitized:
        try:
            sanitized["temperature"] = float(sanitized["temperature"])
        except Exception:
            sanitized["temperature"] = current.get("temperature")
    merged_branch = dict(current)
    merged_branch.update(sanitized)
    save_scheduler_models_config(cfg, {"rough_reading": merged_branch})
    return merged_branch


@dataclass(frozen=True)
class ModelToolSpec:
    """Describes a tool available to a learning model."""

    name: str
    description: str


@dataclass
class ModelContext:
    """Structured context used for prompt rendering."""

    username: str = ""
    course_id: str = ""
    course_name: str = ""
    lecture_id: str = ""
    lecture_title: str = ""
    user_progress: Dict[str, Any] = field(default_factory=dict)
    variables: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: Optional[Mapping[str, Any]] = None) -> "ModelContext":
        raw = dict(payload or {})
        user_progress = raw.get("user_progress") or raw.get("userProgress") or {}
        if not isinstance(user_progress, dict):
            user_progress = {}

        reserved = {
            "username",
            "course_id",
            "course_name",
            "lecture_id",
            "lectureID",
            "lecture_title",
            "user_progress",
            "userProgress",
        }
        extra_vars = {key: value for key, value in raw.items() if key not in reserved}

        lecture_id = str(raw.get("lecture_id") or raw.get("lectureID") or "").strip()
        return cls(
            username=str(raw.get("username") or "").strip(),
            course_id=str(raw.get("course_id") or "").strip(),
            course_name=str(raw.get("course_name") or "").strip(),
            lecture_id=lecture_id,
            lecture_title=str(raw.get("lecture_title") or "").strip(),
            user_progress=user_progress,
            variables=extra_vars,
        )

    def to_prompt_vars(self) -> Dict[str, str]:
        vars_map: Dict[str, str] = {
            "username": self.username,
            "course_id": self.course_id,
            "course_name": self.course_name,
            "lecture_id": self.lecture_id,
            "lectureID": self.lecture_id,
            "lecture_title": self.lecture_title,
        }
        for key, value in self.variables.items():
            vars_map[key] = self._stringify(value)
        return vars_map

    @staticmethod
    def _stringify(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return str(value)


class PromptContextManager:
    """Resolves placeholder variables inside prompt templates."""

    def build_context(self, payload: Optional[Mapping[str, Any]] = None) -> ModelContext:
        return ModelContext.from_payload(payload)

    def render(
        self,
        template: str,
        context: ModelContext,
        extra_vars: Optional[Mapping[str, Any]] = None,
    ) -> str:
        prompt_vars = context.to_prompt_vars()
        for key, value in dict(extra_vars or {}).items():
            prompt_vars[key] = ModelContext._stringify(value)

        def replace(match: re.Match[str]) -> str:
            token = match.group(1).strip()
            return self.resolve_token(token, context, prompt_vars)

        return PLACEHOLDER_PATTERN.sub(replace, template)

    def resolve_token(
        self,
        token: str,
        context: ModelContext,
        prompt_vars: Mapping[str, str],
    ) -> str:
        if ":" not in token:
            return prompt_vars.get(token, "")

        namespace, raw_arg = [part.strip() for part in token.split(":", 1)]
        if namespace == "userProgress":
            progress_key = prompt_vars.get(raw_arg, raw_arg)
            return ModelContext._stringify(context.user_progress.get(progress_key, ""))
        return prompt_vars.get(token, "")


class NexoraCompletionClient:
    """Small wrapper around NexoraProxy for model-layer calls."""

    def __init__(self, cfg: Mapping[str, Any], proxy: Optional[NexoraProxy] = None):
        self.proxy = proxy or NexoraProxy(dict(cfg))

    def complete(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: Optional[str] = None,
        username: Optional[str] = None,
        api_mode: str = "chat",
        options: Optional[Mapping[str, Any]] = None,
        request_timeout: Optional[float] = None,
        on_delta: Optional[Callable[[str], None]] = None,
    ) -> str:
        messages = []
        if str(system_prompt or "").strip():
            messages.append({"role": "system", "content": str(system_prompt)})
        messages.append({"role": "user", "content": str(user_prompt or "")})
        merged_options = dict(options or {})
        if "temperature" not in merged_options:
            merged_options["temperature"] = 0.3
        result = self.proxy.complete_raw(
            messages=messages,
            model=model,
            username=username,
            api_mode=api_mode,
            options=merged_options,
            request_timeout=request_timeout,
            on_delta=on_delta,
        )
        if not result.get("success"):
            raise RuntimeError(f"Nexora API Error: {result.get('message') or 'request failed'}")
        return str(result.get("content") or "")


class BaseLearningModel:
    """Shared implementation for task-specific learning models."""

    model_key = ""
    default_model_name = DEFAULT_NEXORA_MODEL
    tools = (
        ModelToolSpec("context_manager", "Manage prompt variables and shared runtime context."),
        ModelToolSpec("nexora_client", "Call the Nexora completion interface."),
    )

    def __init__(
        self,
        cfg: Mapping[str, Any],
        *,
        model_name: Optional[str] = None,
        context_manager: Optional[PromptContextManager] = None,
        nexora_client: Optional[NexoraCompletionClient] = None,
    ):
        if not self.model_key:
            raise ValueError("model_key must be defined on subclasses.")

        self.cfg = dict(cfg)
        models_cfg = load_scheduler_models_config(self.cfg)
        configured_default = str(models_cfg.get("default_nexora_model") or "").strip()
        self.model_name = model_name or configured_default or self.default_model_name
        self.context_manager = context_manager or PromptContextManager()
        self.nexora_client = nexora_client or NexoraCompletionClient(self.cfg)

    def get_prompt_templates(self) -> Dict[str, str]:
        try:
            prompt_pack = prompts.MODEL_PROMPTS[self.model_key]
        except KeyError as exc:
            raise KeyError(f"Unknown prompt pack: {self.model_key}") from exc
        system_fallback = str(prompt_pack.get("system") or "")
        user_fallback = str(prompt_pack.get("user") or "")
        # Hot-reload behavior: always read external files on every call.
        # If file does not exist, initialize once from code fallback.
        system_text = _load_external_prompt_or_init(
            self.cfg,
            model_key=self.model_key,
            prompt_role="system",
            fallback_text=system_fallback,
        )
        user_text = _load_external_prompt_or_init(
            self.cfg,
            model_key=self.model_key,
            prompt_role="user",
            fallback_text=user_fallback,
        )
        return {"system": system_text, "user": user_text}

    def build_prompts(
        self,
        request: str,
        *,
        context_payload: Optional[Mapping[str, Any]] = None,
        extra_prompt_vars: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, str]:
        context = self.context_manager.build_context(context_payload)
        prompt_pack = self.get_prompt_templates()
        merged_extra_vars = {
            "request": request,
            "notes": "",
        }
        merged_extra_vars.update(dict(extra_prompt_vars or {}))

        return {
            "system": self.context_manager.render(
                prompt_pack["system"],
                context,
                merged_extra_vars,
            ),
            "user": self.context_manager.render(
                prompt_pack["user"],
                context,
                merged_extra_vars,
            ),
            "username": context.username,
        }

    def run(
        self,
        request: str,
        *,
        context_payload: Optional[Mapping[str, Any]] = None,
        extra_prompt_vars: Optional[Mapping[str, Any]] = None,
        model_name: Optional[str] = None,
        username: Optional[str] = None,
        api_mode: str = "chat",
        options: Optional[Mapping[str, Any]] = None,
        request_timeout: Optional[float] = None,
        on_delta: Optional[Callable[[str], None]] = None,
    ) -> str:
        prompt_bundle = self.build_prompts(
            request,
            context_payload=context_payload,
            extra_prompt_vars=extra_prompt_vars,
        )
        target_username = username or prompt_bundle["username"] or None
        log_event(
            "model_context_input",
            "模型输入（BaseLearningModel.run）",
            payload={
                "model_key": self.model_key,
                "model_name": model_name or self.model_name,
                "username": target_username or "",
            },
            content=json.dumps(
                {"system": prompt_bundle["system"], "user": prompt_bundle["user"]},
                ensure_ascii=False,
                indent=2,
            )[:12000],
        )
        output = self.nexora_client.complete(
            system_prompt=prompt_bundle["system"],
            user_prompt=prompt_bundle["user"],
            model=model_name or self.model_name,
            username=target_username,
            api_mode=api_mode,
            options=options,
            request_timeout=request_timeout,
            on_delta=on_delta,
        )
        log_event(
            "model_output",
            "模型输出（BaseLearningModel.run）",
            payload={
                "model_key": self.model_key,
                "model_name": model_name or self.model_name,
                "username": target_username or "",
            },
            content=output[:12000],
        )
        return output

    def preview_prompts(
        self,
        request: str,
        *,
        context_payload: Optional[Mapping[str, Any]] = None,
        extra_prompt_vars: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, str]:
        bundle = self.build_prompts(
            request,
            context_payload=context_payload,
            extra_prompt_vars=extra_prompt_vars,
        )
        return {
            "system": bundle["system"],
            "user": bundle["user"],
        }


class QuestionGenerationModel(BaseLearningModel):
    """Placeholder model for quiz or exercise generation."""

    model_key = "question"


class IntensiveReadingModel(BaseLearningModel):
    """Placeholder model for close reading and study guidance."""

    model_key = "intensive_reading"


class CoarseReadingModel(BaseLearningModel):
    """Model used for rough reading / chapter structure extraction."""

    model_key = "coarse_reading"


class AnswerModel(BaseLearningModel):
    """Placeholder model for learning-oriented answers."""

    model_key = "answer"


class QuestionVerifyModel(BaseLearningModel):
    """Model used to review and fix generated questions."""

    model_key = "question_verify"


class MemoryProfileModel(BaseLearningModel):
    """Model used to update soul/user/context memory files."""

    model_key = "memory"

    def update_memory(
        self,
        memory_type: str,
        new_input: str,
        *,
        current_memory: str = "",
        context_payload: Optional[Mapping[str, Any]] = None,
        extra_prompt_vars: Optional[Mapping[str, Any]] = None,
        model_name: Optional[str] = None,
        username: Optional[str] = None,
    ) -> str:
        merged_extra_vars = {
            "memory_type": memory_type,
            "current_memory": current_memory,
        }
        merged_extra_vars.update(dict(extra_prompt_vars or {}))
        return self.run(
            new_input,
            context_payload=context_payload,
            extra_prompt_vars=merged_extra_vars,
            model_name=model_name,
            username=username,
        )


class LearningModelFactory:
    """Factory for model instances by logical task name."""

    _registry: Dict[str, Type[BaseLearningModel]] = {
        "coarse_reading": CoarseReadingModel,
        "question": QuestionGenerationModel,
        "question_verify": QuestionVerifyModel,
        "intensive_reading": IntensiveReadingModel,
        "answer": AnswerModel,
        "memory": MemoryProfileModel,
    }

    @classmethod
    def create(
        cls,
        model_type: str,
        cfg: Mapping[str, Any],
        *,
        model_name: Optional[str] = None,
        context_manager: Optional[PromptContextManager] = None,
        nexora_client: Optional[NexoraCompletionClient] = None,
    ) -> BaseLearningModel:
        try:
            model_cls = cls._registry[model_type]
        except KeyError as exc:
            raise ValueError(f"Unsupported model type: {model_type}") from exc

        return model_cls(
            cfg,
            model_name=model_name,
            context_manager=context_manager,
            nexora_client=nexora_client,
        )
