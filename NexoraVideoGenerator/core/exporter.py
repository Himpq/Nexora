"""Timeline and MP4 export helpers."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Dict, List, Mapping

from .projects import project_dir
from .providers.remotion import write_remotion_props


def build_timeline(
    storyboard: Mapping[str, Any],
    slides: List[Mapping[str, Any]],
    audio: List[Mapping[str, Any]],
    *,
    fps: int,
    clips: List[Mapping[str, Any]] | None = None,
) -> Dict[str, Any]:
    audio_by_scene = {str(item.get("scene_id") or ""): item for item in audio if isinstance(item, Mapping)}
    slide_by_scene = {str(item.get("scene_id") or ""): item for item in slides if isinstance(item, Mapping)}
    clip_by_scene = {str(item.get("scene_id") or ""): item for item in clips or [] if isinstance(item, Mapping)}
    scenes = storyboard.get("scenes") if isinstance(storyboard.get("scenes"), list) else []
    cursor = 0.0
    rows: List[Dict[str, Any]] = []
    for index, scene in enumerate(scenes, start=1):
        if not isinstance(scene, Mapping):
            continue
        scene_id = str(scene.get("id") or f"scene_{index}").strip()
        audio_row = audio_by_scene.get(scene_id) or {}
        slide_row = slide_by_scene.get(scene_id) or {}
        clip_row = clip_by_scene.get(scene_id) or {}
        duration = float(audio_row.get("duration") or scene.get("duration_hint") or 5)
        rows.append({
            "scene_id": scene_id,
            "start": cursor,
            "duration": duration,
            "end": cursor + duration,
            "frame_start": int(round(cursor * fps)),
            "frame_duration": max(1, int(round(duration * fps))),
            "slide_path": str(slide_row.get("path") or ""),
            "audio_path": str(audio_row.get("path") or ""),
            "scene_clip_path": str(clip_row.get("path") or ""),
            "renderer": str(clip_row.get("renderer") or ""),
            "caption": str(scene.get("caption") or ""),
            "title": str(scene.get("title") or ""),
        })
        cursor += duration
    return {
        "fps": fps,
        "duration": cursor,
        "scenes": rows,
    }


def write_subtitle_file(cfg: Mapping[str, Any], project_id: str, timeline: Mapping[str, Any]) -> Path:
    """Write timeline captions as a standard SRT subtitle file."""
    path = project_dir(cfg, project_id) / "exports" / "subtitles.srt"
    scenes = timeline.get("scenes") if isinstance(timeline.get("scenes"), list) else []
    rows: List[str] = []

    for index, scene in enumerate(scenes, start=1):

        if not isinstance(scene, Mapping):
            continue

        caption = str(scene.get("caption") or scene.get("title") or "").strip()

        if not caption:
            continue

        rows.extend([
            str(index),
            f"{_srt_time(float(scene.get('start') or 0.0))} --> {_srt_time(float(scene.get('end') or 0.0))}",
            _clean_subtitle_text(caption),
            "",
        ])

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(rows), encoding="utf-8-sig")
    return path


def export_mp4(cfg: Mapping[str, Any], project_id: str, timeline: Mapping[str, Any]) -> Dict[str, Any]:
    render_cfg = cfg.get("render") if isinstance(cfg.get("render"), dict) else {}
    width = int(render_cfg.get("width") or 1920)
    height = int(render_cfg.get("height") or 1080)
    fps = int(render_cfg.get("fps") or 30)
    ffmpeg_path = str(render_cfg.get("ffmpeg_path") or "ffmpeg").strip() or "ffmpeg"
    root = project_dir(cfg, project_id)
    output_path = root / "exports" / "video.mp4"
    props_path = write_remotion_props(cfg, project_id, {
        "project_id": project_id,
        "width": width,
        "height": height,
        "fps": fps,
        "timeline": timeline,
    })

    scenes = timeline.get("scenes") if isinstance(timeline.get("scenes"), list) else []
    if not scenes:
        raise ValueError("timeline.scenes 不能为空")

    if _has_scene_clips(scenes):
        return concat_scene_clips(cfg, project_id, scenes)

    scene_count = len(scenes)
    command = [ffmpeg_path, "-y"]
    for scene in scenes:
        slide_path = str(scene.get("slide_path") or "").strip()
        duration = float(scene.get("duration") or 5)
        if not slide_path or not Path(slide_path).exists():
            raise ValueError(f"缺少 slide 图片: {slide_path}")
        command.extend(["-loop", "1", "-t", f"{duration:.3f}", "-i", slide_path])
    for scene in scenes:
        audio_path = str(scene.get("audio_path") or "").strip()
        if not audio_path or not Path(audio_path).exists():
            raise ValueError(f"缺少音频文件: {audio_path}")
        command.extend(["-i", audio_path])

    subtitle_path = str(timeline.get("subtitle_path") or "").strip()
    subtitle_input_index = -1

    if subtitle_path:

        if not Path(subtitle_path).exists():
            raise ValueError(f"缺少字幕文件: {subtitle_path}")

        subtitle_input_index = scene_count * 2
        command.extend(["-i", subtitle_path])

    video_filters = []
    audio_filters = []
    for idx in range(scene_count):
        video_filters.append(f"[{idx}:v]scale={width}:{height},setsar=1,fps={fps}[v{idx}]")
    for idx in range(scene_count):
        audio_filters.append(f"[{scene_count + idx}:a]aresample=44100[a{idx}]")
    video_concat_inputs = "".join(f"[v{idx}]" for idx in range(scene_count))
    audio_concat_inputs = "".join(f"[a{idx}]" for idx in range(scene_count))
    filter_complex = ";".join(video_filters + audio_filters + [
        f"{video_concat_inputs}concat=n={scene_count}:v=1:a=0[v]",
        f"{audio_concat_inputs}concat=n={scene_count}:v=0:a=1[a]",
    ])

    command.extend([
        "-filter_complex",
        filter_complex,
        "-map",
        "[v]",
        "-map",
        "[a]",
    ])

    if subtitle_input_index >= 0:
        command.extend([
            "-map",
            f"{subtitle_input_index}:0",
        ])

    command.extend([
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
    ])

    if subtitle_input_index >= 0:
        command.extend([
            "-c:s",
            "mov_text",
            "-metadata:s:s:0",
            "language=chi",
        ])

    command.extend([
        "-shortest",
        str(output_path),
    ])
    result = subprocess.run(command, capture_output=True, text=True, timeout=1800)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "ffmpeg export failed").strip())
    return {
        "path": str(output_path),
        "renderer": "ffmpeg_static_slides",
        "remotion_props": str(props_path),
        "stdout": result.stdout[-4000:],
        "stderr": result.stderr[-4000:],
    }


def concat_scene_clips(cfg: Mapping[str, Any], project_id: str, scenes: List[Mapping[str, Any]]) -> Dict[str, Any]:
    render_cfg = cfg.get("render") if isinstance(cfg.get("render"), dict) else {}
    ffmpeg_path = str(render_cfg.get("ffmpeg_path") or "ffmpeg").strip() or "ffmpeg"
    root = project_dir(cfg, project_id)
    output_path = root / "exports" / "video.mp4"
    list_path = root / "exports" / "scene_clips.txt"
    rows: List[str] = []

    for scene in scenes:
        clip_path = str(scene.get("scene_clip_path") or "").strip()

        if not clip_path or not Path(clip_path).exists():
            raise ValueError(f"缺少 scene clip: {clip_path}")

        rows.append(f"file '{Path(clip_path).as_posix()}'")

    list_path.parent.mkdir(parents=True, exist_ok=True)
    list_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    command = [
        ffmpeg_path,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_path),
        "-c",
        "copy",
        str(output_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=1800)

    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "ffmpeg concat failed").strip())

    return {
        "path": str(output_path),
        "renderer": "ffmpeg_scene_clips",
        "clip_count": len(scenes),
        "clip_list": str(list_path),
        "stdout": result.stdout[-4000:],
        "stderr": result.stderr[-4000:],
    }


def _has_scene_clips(scenes: List[Mapping[str, Any]]) -> bool:
    return bool(scenes) and all(
        isinstance(scene, Mapping) and str(scene.get("scene_clip_path") or "").strip()
        for scene in scenes
    )


def _srt_time(seconds: float) -> str:
    total_ms = max(0, int(round(float(seconds) * 1000)))
    ms = total_ms % 1000
    total_seconds = total_ms // 1000
    sec = total_seconds % 60
    total_minutes = total_seconds // 60
    minute = total_minutes % 60
    hour = total_minutes // 60
    return f"{hour:02}:{minute:02}:{sec:02},{ms:03}"


def _clean_subtitle_text(text: str) -> str:
    return str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
