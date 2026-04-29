"""booksproc 模型配置与调用辅助。"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from ..models import (
    LearningModelFactory,
    get_rough_reading_model_config,
    update_rough_reading_model_config,
)


def get_rough_reading_settings(cfg: Mapping[str, Any]) -> Dict[str, Any]:
    """读取粗读模型配置。"""
    return get_rough_reading_model_config(cfg)


def update_rough_reading_settings(cfg: Mapping[str, Any], updates: Mapping[str, Any]) -> Dict[str, Any]:
    """更新粗读模型配置。"""
    return update_rough_reading_model_config(cfg, updates)


def build_coarse_reading_runner(cfg: Mapping[str, Any], model_name: str = ""):
    """构建粗读模型执行器。"""
    resolved = str(model_name or "").strip() or None
    return LearningModelFactory.create("coarse_reading", cfg, model_name=resolved)

