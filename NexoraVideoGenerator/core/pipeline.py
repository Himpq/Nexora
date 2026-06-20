"""Pipeline orchestration for NexoraVideoGenerator."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Mapping

from .canvas_renderer import build_canvas_code, render_storyboard_slides, save_canvas_code, save_canvas_spec
from .exporter import build_timeline, export_mp4, write_subtitle_file
from .images import generate_storyboard_images
from .planner import CanvasSpecValidationError, generate_canvas_code, generate_outline, generate_script, generate_storyboard
from .projects import (
    append_log,
    create_project,
    get_project,
    load_artifact,
    load_source_context,
    project_dir,
    save_artifact,
    update_stage,
)
from .scene_renderers import render_scene_clips
from .tts import synthesize_storyboard_audio
from .vision import describe_project_images


class VideoGenerationPipeline:
    """Run video generation stages and persist every stage artifact."""

    STAGES = (
        "outline",
        "script",
        "storyboard",
        "images",
        "vision_description",
        "canvas",
        "audio",
        "clips",
        "timeline",
        "export",
    )

    def __init__(self, cfg: Mapping[str, Any]):
        self.cfg = cfg

    def create_and_generate(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        project = create_project(self.cfg, payload)
        project_id = str(project.get("id") or "").strip()
        result = self.run_all(project_id)
        result["project"] = get_project(self.cfg, project_id)
        return result

    def run_all(self, project_id: str) -> Dict[str, Any]:
        artifacts: Dict[str, Any] = {}

        for stage in self.STAGES:
            artifacts[stage] = self.run_stage(project_id, stage)

        return {
            "project_id": project_id,
            "project_dir": str(project_dir(self.cfg, project_id)),
            "artifacts": artifacts,
        }

    def run_stage(self, project_id: str, stage: str) -> Any:
        stage_name = str(stage or "").strip()

        if stage_name not in self.STAGES:
            raise ValueError(f"未知生成阶段: {stage_name}")

        handler = getattr(self, f"_run_{stage_name}")
        update_stage(self.cfg, project_id, stage_name, "running", f"{stage_name} 开始")

        try:
            result = handler(project_id)
        except Exception as exc:
            update_stage(self.cfg, project_id, stage_name, "failed", f"{stage_name} 失败: {exc}")
            raise

        update_stage(self.cfg, project_id, stage_name, "done", f"{stage_name} 完成")
        return result

    def _project_payload(self, project_id: str) -> Dict[str, Any]:
        project = get_project(self.cfg, project_id)

        if not isinstance(project, dict):
            raise ValueError("project not found")

        project["source"] = load_source_context(self.cfg, project_id)
        return project

    def _run_outline(self, project_id: str) -> Dict[str, Any]:
        payload = self._project_payload(project_id)
        outline = generate_outline(self.cfg, payload)
        save_artifact(self.cfg, project_id, "source/outline.json", outline)
        return outline

    def _run_script(self, project_id: str) -> Dict[str, Any]:
        payload = self._project_payload(project_id)
        outline = load_artifact(self.cfg, project_id, "source/outline.json")
        script = generate_script(self.cfg, payload, outline)
        save_artifact(self.cfg, project_id, "source/script.json", script)
        return script

    def _run_storyboard(self, project_id: str) -> Dict[str, Any]:
        payload = self._project_payload(project_id)
        script = load_artifact(self.cfg, project_id, "source/script.json")
        storyboard = generate_storyboard(self.cfg, payload, script)
        save_artifact(self.cfg, project_id, "source/storyboard.json", storyboard)
        return storyboard

    def _run_images(self, project_id: str) -> List[Dict[str, Any]]:
        storyboard = load_artifact(self.cfg, project_id, "source/storyboard.json")
        images = generate_storyboard_images(self.cfg, project_id, storyboard)
        save_artifact(self.cfg, project_id, "source/images.json", images)
        return images

    def _run_vision_description(self, project_id: str) -> List[Dict[str, Any]]:
        storyboard = load_artifact(self.cfg, project_id, "source/storyboard.json")
        images = load_artifact(self.cfg, project_id, "source/images.json")
        descriptions = describe_project_images(self.cfg, project_id, storyboard, images)
        save_artifact(self.cfg, project_id, "source/image_descriptions.json", descriptions)
        return descriptions

    def _run_canvas(self, project_id: str) -> Dict[str, Any]:
        storyboard = load_artifact(self.cfg, project_id, "source/storyboard.json")
        source = load_source_context(self.cfg, project_id)
        images = self._load_optional_artifact(project_id, "source/images.json", [])
        image_descriptions = self._load_optional_artifact(project_id, "source/image_descriptions.json", [])
        canvas_rows = self._generate_canvas_code(project_id, storyboard, source, images, image_descriptions)
        slides = render_storyboard_slides(self.cfg, project_id, storyboard, canvas_rows)

        save_artifact(self.cfg, project_id, "source/canvas_manifest.json", canvas_rows)
        save_artifact(self.cfg, project_id, "source/slides.json", slides)
        update_stage(self.cfg, project_id, "slides", "done", "slides 完成")

        return {
            "canvas": canvas_rows,
            "slides": slides,
        }

    def _run_audio(self, project_id: str) -> List[Dict[str, Any]]:
        storyboard = load_artifact(self.cfg, project_id, "source/storyboard.json")
        audio = synthesize_storyboard_audio(self.cfg, project_id, storyboard)
        save_artifact(self.cfg, project_id, "source/audio.json", audio)
        return audio

    def _run_clips(self, project_id: str) -> List[Dict[str, Any]]:
        storyboard = load_artifact(self.cfg, project_id, "source/storyboard.json")
        audio = load_artifact(self.cfg, project_id, "source/audio.json")
        slides = self._load_optional_artifact(project_id, "source/slides.json", [])
        canvas_manifest = self._load_optional_artifact(project_id, "source/canvas_manifest.json", [])
        clips = render_scene_clips(self.cfg, project_id, storyboard, slides, audio, canvas_manifest)
        save_artifact(self.cfg, project_id, "source/clips.json", clips)
        return clips

    def _run_timeline(self, project_id: str) -> Dict[str, Any]:
        render_cfg = self.cfg.get("render") if isinstance(self.cfg.get("render"), dict) else {}
        fps = int(render_cfg.get("fps") or 30)
        storyboard = load_artifact(self.cfg, project_id, "source/storyboard.json")
        slides = load_artifact(self.cfg, project_id, "source/slides.json")
        audio = load_artifact(self.cfg, project_id, "source/audio.json")
        clips = self._load_optional_artifact(project_id, "source/clips.json", [])
        timeline = build_timeline(storyboard, slides, audio, fps=fps, clips=clips)
        subtitle_path = write_subtitle_file(self.cfg, project_id, timeline)
        timeline["subtitle_path"] = str(subtitle_path)
        save_artifact(self.cfg, project_id, "source/timeline.json", timeline)
        return timeline

    def _run_export(self, project_id: str) -> Dict[str, Any]:
        timeline = load_artifact(self.cfg, project_id, "source/timeline.json")
        result = export_mp4(self.cfg, project_id, timeline)
        save_artifact(self.cfg, project_id, "exports/export.json", result)
        return result

    def _generate_canvas_code(
        self,
        project_id: str,
        storyboard: Mapping[str, Any],
        source: Mapping[str, Any],
        images: List[Mapping[str, Any]],
        image_descriptions: List[Mapping[str, Any]],
    ) -> List[Dict[str, Any]]:
        scenes = storyboard.get("scenes") if isinstance(storyboard.get("scenes"), list) else []
        extra_prompts = source.get("extra_prompts") if isinstance(source.get("extra_prompts"), dict) else {}
        template = self._canvas_template()
        visual_assets = self._visual_assets_by_scene(images, image_descriptions)
        rows: List[Dict[str, Any]] = []

        for index, scene in enumerate(scenes, start=1):

            if not isinstance(scene, Mapping):
                continue

            scene_id = str(scene.get("id") or f"scene_{index}").strip()
            append_log(self.cfg, project_id, "canvas", f"{scene_id} PPT 页面 spec 生成开始")

            try:
                canvas = generate_canvas_code(
                    self.cfg,
                    scene,
                    template=template,
                    visual_assets=visual_assets.get(scene_id) or {},
                    extra_prompt=str(extra_prompts.get("canvas") or extra_prompts.get("all") or "").strip(),
                )
            except CanvasSpecValidationError as exc:
                rejected_path = self._save_rejected_canvas_spec(project_id, scene_id, exc.spec)
                append_log(self.cfg, project_id, "canvas", f"{scene_id} rejected canvas spec 已保存: {rejected_path}")
                raise RuntimeError(f"{scene_id} PPT 页面 spec 生成失败: {exc}") from exc
            except Exception as exc:
                raise RuntimeError(f"{scene_id} PPT 页面 spec 生成失败: {exc}") from exc

            spec = canvas.get("spec") if isinstance(canvas.get("spec"), Mapping) else canvas
            spec = self._attach_visual_asset(scene_id, spec, visual_assets.get(scene_id) or {})
            code = build_canvas_code(
                spec,
                width=int(template.get("width") or 1920),
                height=int(template.get("height") or 1080),
            )

            if not code:
                raise ValueError(f"{scene_id} canvas 代码为空")

            path = save_canvas_code(self.cfg, project_id, scene_id, code)
            spec_path = save_canvas_spec(self.cfg, project_id, scene_id, spec)
            append_log(self.cfg, project_id, "canvas", f"{scene_id} PPT 页面 spec 已保存: {spec_path}")
            rows.append({
                "scene_id": scene_id,
                "path": str(path),
                "spec_path": str(spec_path),
                "code_chars": len(code),
                "layout_type": str(spec.get("layout_type") or ""),
                "spec": dict(spec),
            })

        return rows

    def _save_rejected_canvas_spec(self, project_id: str, scene_id: str, spec: Mapping[str, Any]) -> str:
        path = project_dir(self.cfg, project_id) / "source" / "canvas" / f"{scene_id}.rejected.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(dict(spec or {}), ensure_ascii=False, indent=4), encoding="utf-8")
        return str(path)

    def _canvas_template(self) -> Dict[str, Any]:
        render_cfg = self.cfg.get("render") if isinstance(self.cfg.get("render"), dict) else {}
        return {
            "width": int(render_cfg.get("width") or 1920),
            "height": int(render_cfg.get("height") or 1080),
            "style": "free educational slide canvas; model controls composition through explicit elements",
            "available_visual_grammars": ["Cover", "ConceptMap", "ProcessFlow", "CompareContrast", "AnnotatedImage", "Timeline", "Summary"],
            "available_layout_types": ["free_canvas"],
            "available_palettes": ["emerald", "blue", "violet", "amber", "rose", "slate"],
            "element_types": ["text", "rect", "circle", "line", "image"],
            "image_asset_key": "scene_image",
        }

    def _load_optional_artifact(self, project_id: str, name: str, default: Any) -> Any:
        try:
            return load_artifact(self.cfg, project_id, name)
        except FileNotFoundError:
            return default

    def _visual_assets_by_scene(
        self,
        images: List[Mapping[str, Any]],
        image_descriptions: List[Mapping[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        image_by_scene = {str(item.get("scene_id") or ""): item for item in images if isinstance(item, Mapping)}
        description_by_scene = {
            str(item.get("scene_id") or ""): item
            for item in image_descriptions
            if isinstance(item, Mapping)
        }
        rows: Dict[str, Dict[str, Any]] = {}

        for scene_id, image in image_by_scene.items():
            description = description_by_scene.get(scene_id) or {}
            image_path = str(image.get("path") or "").strip()

            if not image_path:
                continue

            rows[scene_id] = {
                "scene_id": scene_id,
                "image_path": image_path,
                "prompt": str(image.get("prompt") or "").strip(),
                "description": str(description.get("description") or "").strip(),
                "alignment_notes": str(description.get("alignment_notes") or "").strip(),
                "usable": bool(description.get("usable", True)),
            }

        return rows

    def _attach_visual_asset(
        self,
        scene_id: str,
        spec: Mapping[str, Any],
        visual_asset: Mapping[str, Any],
    ) -> Dict[str, Any]:
        row = dict(spec or {})
        image_path = str(visual_asset.get("image_path") or "").strip()

        if not image_path:
            return row

        row["image_asset"] = {
            "path": image_path,
        }
        return row


def run_project_stage(cfg: Mapping[str, Any], project_id: str, stage: str) -> Any:
    """Run one named generation stage for an existing project."""
    return VideoGenerationPipeline(cfg).run_stage(project_id, stage)


def run_project_generation(cfg: Mapping[str, Any], payload: Mapping[str, Any]) -> Dict[str, Any]:
    """Create a project and run the complete generation pipeline."""
    return VideoGenerationPipeline(cfg).create_and_generate(payload)
