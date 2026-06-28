"""TTS stage orchestration."""

from __future__ import annotations

from typing import Any, Dict, List, Mapping

from .projects import project_dir
from .providers.windows_sapi import WindowsSapiTTSProvider


def synthesize_storyboard_audio(cfg: Mapping[str, Any], project_id: str, storyboard: Mapping[str, Any]) -> List[Dict[str, Any]]:
    provider = WindowsSapiTTSProvider(cfg)
    scenes = storyboard.get("scenes") if isinstance(storyboard.get("scenes"), list) else []
    rows: List[Dict[str, Any]] = []
    for index, scene in enumerate(scenes, start=1):
        if not isinstance(scene, Mapping):
            continue
        scene_id = str(scene.get("id") or f"scene_{index}").strip()
        narration = str(scene.get("narration") or scene.get("caption") or "").strip()
        output_path = project_dir(cfg, project_id) / "source" / "audio" / f"{scene_id}.wav"
        result = provider.synthesize(narration, output_path)
        result["scene_id"] = scene_id
        result["text"] = narration
        rows.append(result)
    return rows
