"""Stable prompt-module loader for both standalone and embedded runtimes."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Optional

_PROMPTS_MODULE: Optional[ModuleType] = None


def load_prompts_module() -> ModuleType:
    global _PROMPTS_MODULE
    if _PROMPTS_MODULE is not None:
        return _PROMPTS_MODULE

    prompts_path = Path(__file__).resolve().parents[1] / "prompts.py"
    spec = importlib.util.spec_from_file_location("nexoralearning_prompts", prompts_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load prompts module from {prompts_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _PROMPTS_MODULE = module
    return module
