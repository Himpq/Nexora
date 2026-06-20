"""Scene-level renderer dispatch for mixed video generation."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Dict, List, Mapping

from .projects import append_log, project_dir
from .providers.manim import render_manim_poc

CANVAS_RENDERERS = {"canvas", "image_focus", "slide", "hybrid"}
MANIM_RENDERERS = {"manim", "physics", "formula"}
CANVAS_GRAMMARS = {"conceptmap", "annotatedimage", "comparecontrast", "summary", "cover", "factgrid", "timeline"}
MANIM_GRAMMARS = {"processflow", "forcevector", "formulaexplain", "particlemotion"}
PHYSICS_HINTS = (
    "公式",
    "力",
    "动量",
    "速度",
    "加速",
    "阻力",
    "重力",
    "平衡",
    "真空",
    "火箭",
    "喷气",
    "arrow",
    "force",
    "rocket",
    "exhaust",
)


def render_scene_clips(
    cfg: Mapping[str, Any],
    project_id: str,
    storyboard: Mapping[str, Any],
    slides: List[Mapping[str, Any]],
    audio: List[Mapping[str, Any]],
    canvas_manifest: List[Mapping[str, Any]],
) -> List[Dict[str, Any]]:
    """Render every storyboard scene into an audio-synced MP4 clip."""
    scenes = storyboard.get("scenes") if isinstance(storyboard.get("scenes"), list) else []
    slide_by_scene = _rows_by_scene(slides)
    audio_by_scene = _rows_by_scene(audio)
    canvas_by_scene = _canvas_by_scene(canvas_manifest)
    rows: List[Dict[str, Any]] = []

    for index, scene in enumerate(scenes, start=1):

        if not isinstance(scene, Mapping):
            continue

        scene_id = str(scene.get("id") or f"scene_{index}").strip()
        audio_row = audio_by_scene.get(scene_id) or {}
        slide_row = slide_by_scene.get(scene_id) or {}
        canvas_spec = canvas_by_scene.get(scene_id) or {}
        renderer = choose_scene_renderer(scene, canvas_spec)
        duration = _duration(scene, audio_row)
        append_log(cfg, project_id, "clips", f"{scene_id} 使用 {renderer} 渲染")

        if renderer == "manim":
            visual = render_manim_poc(cfg, project_id, scene_id=scene_id, render=True).get("video") or {}
            visual_path = str(visual.get("path") or "").strip()
        else:
            visual_path = _render_canvas_visual_clip(
                cfg,
                project_id,
                scene_id=scene_id,
                slide_path=str(slide_row.get("path") or "").strip(),
                duration=duration,
            )

        synced_path = _mux_audio(
            cfg,
            project_id,
            scene_id=scene_id,
            visual_path=visual_path,
            audio_path=str(audio_row.get("path") or "").strip(),
        )

        rows.append({
            "scene_id": scene_id,
            "renderer": renderer,
            "visual_grammar": _visual_grammar(scene, canvas_spec),
            "template": str(scene.get("template") or scene.get("scene_type") or canvas_spec.get("layout_type") or "").strip(),
            "duration": duration,
            "visual_path": visual_path,
            "audio_path": str(audio_row.get("path") or "").strip(),
            "path": synced_path,
        })

    return rows


def choose_scene_renderer(scene: Mapping[str, Any], canvas_spec: Mapping[str, Any]) -> str:
    """Choose a local renderer from the model's structured hints and safe heuristics."""
    explicit = _renderer_hint(scene)
    grammar = _visual_grammar(scene, canvas_spec).replace("_", "").lower()
    layout_type = str(canvas_spec.get("layout_type") or "").strip().lower()

    if layout_type == "free_canvas" or isinstance(canvas_spec.get("image_asset"), Mapping):
        return "canvas"

    if explicit in CANVAS_RENDERERS:
        return "canvas"

    if explicit in MANIM_RENDERERS:
        return "manim"

    if grammar in CANVAS_GRAMMARS:
        return "canvas"

    if grammar in MANIM_GRAMMARS:
        return "manim"

    if layout_type in {"cover", "fact_grid", "timeline", "focus", "image_focus"}:
        return "canvas"

    text = " ".join([
        str(scene.get("title") or ""),
        str(scene.get("scene_type") or ""),
        str(scene.get("template") or ""),
        str(scene.get("visual_grammar") or ""),
        str(scene.get("visual_goal") or ""),
        str(scene.get("canvas_brief") or ""),
        str(scene.get("caption") or ""),
        str(scene.get("objects") or ""),
        str(scene.get("visual") or ""),
    ]).lower()

    if any(hint.lower() in text for hint in PHYSICS_HINTS):
        return "manim"

    if layout_type in {"process", "comparison"}:
        return "manim"

    return "canvas"


def _visual_grammar(scene: Mapping[str, Any], canvas_spec: Mapping[str, Any]) -> str:
    for key in ("visual_grammar", "grammar"):
        value = str(scene.get(key) or "").strip()

        if value:
            return value

    visual = scene.get("visual")

    if isinstance(visual, Mapping):
        value = str(visual.get("visual_grammar") or visual.get("grammar") or "").strip()

        if value:
            return value

    layout_type = str(canvas_spec.get("visual_grammar") or canvas_spec.get("layout_type") or "").strip()

    if layout_type == "image_focus":
        return "AnnotatedImage"

    if layout_type == "comparison":
        return "CompareContrast"

    if layout_type == "process":
        return "ProcessFlow"

    if layout_type:
        return layout_type

    return ""


def _renderer_hint(scene: Mapping[str, Any]) -> str:
    for key in ("renderer", "render_mode"):
        value = str(scene.get(key) or "").strip().lower()

        if value:
            return value

    visual = scene.get("visual")

    if isinstance(visual, Mapping):
        return str(visual.get("renderer") or "").strip().lower()

    return ""


def _render_canvas_visual_clip(
    cfg: Mapping[str, Any],
    project_id: str,
    *,
    scene_id: str,
    slide_path: str,
    duration: float,
) -> str:
    if not slide_path or not Path(slide_path).exists():
        raise ValueError(f"{scene_id} 缺少 canvas slide 图片: {slide_path}")

    render_cfg = cfg.get("render") if isinstance(cfg.get("render"), dict) else {}
    width = int(render_cfg.get("width") or 1920)
    height = int(render_cfg.get("height") or 1080)
    fps = int(render_cfg.get("fps") or 30)
    ffmpeg_path = str(render_cfg.get("ffmpeg_path") or "ffmpeg").strip() or "ffmpeg"
    output_path = project_dir(cfg, project_id) / "source" / "clips" / f"{scene_id}_visual.mp4"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_path,
        "-y",
        "-loop",
        "1",
        "-t",
        f"{duration:.3f}",
        "-i",
        slide_path,
        "-vf",
        f"scale={width}:{height},setsar=1,fps={fps}",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        str(output_path),
    ]
    _run_ffmpeg(command, timeout=300)
    return str(output_path)


def _mux_audio(
    cfg: Mapping[str, Any],
    project_id: str,
    *,
    scene_id: str,
    visual_path: str,
    audio_path: str,
) -> str:
    if not visual_path or not Path(visual_path).exists():
        raise ValueError(f"{scene_id} 缺少视觉片段: {visual_path}")

    if not audio_path or not Path(audio_path).exists():
        raise ValueError(f"{scene_id} 缺少音频文件: {audio_path}")

    render_cfg = cfg.get("render") if isinstance(cfg.get("render"), dict) else {}
    width = int(render_cfg.get("width") or 1920)
    height = int(render_cfg.get("height") or 1080)
    fps = int(render_cfg.get("fps") or 30)
    ffmpeg_path = str(render_cfg.get("ffmpeg_path") or "ffmpeg").strip() or "ffmpeg"
    output_path = project_dir(cfg, project_id) / "source" / "clips" / f"{scene_id}.mp4"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_path,
        "-y",
        "-i",
        visual_path,
        "-i",
        audio_path,
        "-filter_complex",
        f"[0:v]scale={width}:{height},setsar=1,fps={fps},tpad=stop_mode=clone:stop_duration=3[v]",
        "-map",
        "[v]",
        "-map",
        "1:a",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        str(output_path),
    ]
    _run_ffmpeg(command, timeout=300)
    return str(output_path)


def _run_ffmpeg(command: List[str], *, timeout: int) -> None:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)

    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "ffmpeg failed").strip())


def _rows_by_scene(rows: List[Mapping[str, Any]]) -> Dict[str, Mapping[str, Any]]:
    return {
        str(item.get("scene_id") or "").strip(): item
        for item in rows
        if isinstance(item, Mapping) and str(item.get("scene_id") or "").strip()
    }


def _canvas_by_scene(canvas_manifest: List[Mapping[str, Any]]) -> Dict[str, Mapping[str, Any]]:
    rows: Dict[str, Mapping[str, Any]] = {}

    for row in canvas_manifest:

        if not isinstance(row, Mapping):
            continue

        scene_id = str(row.get("scene_id") or "").strip()
        spec = row.get("spec")

        if scene_id and isinstance(spec, Mapping):
            rows[scene_id] = spec

    return rows


def _duration(scene: Mapping[str, Any], audio_row: Mapping[str, Any]) -> float:
    for value in (audio_row.get("duration"), scene.get("duration_hint"), 5):
        try:
            number = float(value)
        except Exception:
            continue

        if number > 0:
            return number

    return 5.0
