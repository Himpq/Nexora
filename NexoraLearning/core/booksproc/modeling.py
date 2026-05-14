"""booksproc model configuration and runner helpers."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from ..models import (
    LearningModelFactory,
    get_intensive_reading_model_config,
    get_memory_model_config,
    get_profile_question_model_config,
    get_question_generation_model_config,
    get_rough_reading_model_config,
    get_split_chapters_model_config,
    update_intensive_reading_model_config,
    update_memory_model_config,
    update_profile_question_model_config,
    update_question_generation_model_config,
    update_rough_reading_model_config,
    update_split_chapters_model_config,
)


def get_rough_reading_settings(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    return get_rough_reading_model_config(cfg)


def update_rough_reading_settings(cfg: Mapping[str, Any], updates: Mapping[str, Any]) -> Dict[str, Any]:
    return update_rough_reading_model_config(cfg, updates)


def get_intensive_reading_settings(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    return get_intensive_reading_model_config(cfg)


def update_intensive_reading_settings(cfg: Mapping[str, Any], updates: Mapping[str, Any]) -> Dict[str, Any]:
    return update_intensive_reading_model_config(cfg, updates)


def get_question_generation_settings(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    return get_question_generation_model_config(cfg)


def update_question_generation_settings(cfg: Mapping[str, Any], updates: Mapping[str, Any]) -> Dict[str, Any]:
    return update_question_generation_model_config(cfg, updates)


def get_split_chapters_settings(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    return get_split_chapters_model_config(cfg)


def update_split_chapters_settings(cfg: Mapping[str, Any], updates: Mapping[str, Any]) -> Dict[str, Any]:
    return update_split_chapters_model_config(cfg, updates)


def get_memory_settings(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    return get_memory_model_config(cfg)


def update_memory_settings(cfg: Mapping[str, Any], updates: Mapping[str, Any]) -> Dict[str, Any]:
    return update_memory_model_config(cfg, updates)


def get_profile_question_settings(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    return get_profile_question_model_config(cfg)


def update_profile_question_settings(cfg: Mapping[str, Any], updates: Mapping[str, Any]) -> Dict[str, Any]:
    return update_profile_question_model_config(cfg, updates)


def build_coarse_reading_runner(cfg: Mapping[str, Any], model_name: str = ""):
    resolved = str(model_name or "").strip() or None
    return LearningModelFactory.create("coarse_reading", cfg, model_name=resolved)


def build_intensive_reading_runner(cfg: Mapping[str, Any], model_name: str = ""):
    resolved = str(model_name or "").strip() or None
    return LearningModelFactory.create("intensive_reading", cfg, model_name=resolved)


def build_question_generation_runner(cfg: Mapping[str, Any], model_name: str = ""):
    resolved = str(model_name or "").strip() or None
    return LearningModelFactory.create("question", cfg, model_name=resolved)


def build_split_chapters_runner(cfg: Mapping[str, Any], model_name: str = ""):
    resolved = str(model_name or "").strip() or None
    return LearningModelFactory.create("split_chapters", cfg, model_name=resolved)


def build_memory_runner(cfg: Mapping[str, Any], model_name: str = ""):
    resolved = str(model_name or "").strip() or None
    return LearningModelFactory.create("memory", cfg, model_name=resolved)


def build_profile_question_runner(cfg: Mapping[str, Any], model_name: str = ""):
    resolved = str(model_name or "").strip() or None
    return LearningModelFactory.create("profile_question", cfg, model_name=resolved)
