"""Model-layer abstractions for NexoraLearning.


"""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any, Dict, Mapping, Optional, Type

import prompts
from .nexora_proxy import NexoraProxy


DEFAULT_NEXORA_MODEL = "doubao-seed-1-6-250615"
PLACEHOLDER_PATTERN = re.compile(r"{{\s*([^{}]+?)\s*}}")


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
    ) -> str:
        return self.proxy.chat_complete(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=model,
            username=username,
        )


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
        self.model_name = model_name or self.default_model_name
        self.context_manager = context_manager or PromptContextManager()
        self.nexora_client = nexora_client or NexoraCompletionClient(self.cfg)

    def get_prompt_templates(self) -> Dict[str, str]:
        try:
            prompt_pack = prompts.MODEL_PROMPTS[self.model_key]
        except KeyError as exc:
            raise KeyError(f"Unknown prompt pack: {self.model_key}") from exc
        return dict(prompt_pack)

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
    ) -> str:
        prompt_bundle = self.build_prompts(
            request,
            context_payload=context_payload,
            extra_prompt_vars=extra_prompt_vars,
        )
        target_username = username or prompt_bundle["username"] or None
        return self.nexora_client.complete(
            system_prompt=prompt_bundle["system"],
            user_prompt=prompt_bundle["user"],
            model=model_name or self.model_name,
            username=target_username,
        )

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
