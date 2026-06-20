"""Experimental Manim renderer for structured lesson scenes."""

from __future__ import annotations

import json
import shutil
import subprocess
import textwrap
from pathlib import Path
from typing import Any, Dict, List, Mapping

from ..projects import load_artifact, project_dir

SUPPORTED_SCENE_TYPES = {"comparison", "process"}
DEFAULT_FONT = "Microsoft YaHei"


def render_manim_poc(
    cfg: Mapping[str, Any],
    project_id: str,
    *,
    scene_id: str = "",
    render: bool = True,
) -> Dict[str, Any]:
    """Generate a Manim script from project artifacts and optionally render one MP4 clip."""
    storyboard = load_artifact(cfg, project_id, "source/storyboard.json")
    canvas_manifest = _load_optional_artifact(cfg, project_id, "source/canvas_manifest.json", [])
    audio_manifest = _load_optional_artifact(cfg, project_id, "source/audio.json", [])
    lesson_spec = build_lesson_spec(storyboard, canvas_manifest, audio_manifest, scene_id=scene_id)
    script_path = write_manim_script(cfg, project_id, lesson_spec)

    result: Dict[str, Any] = {
        "renderer": "manim_poc",
        "script_path": str(script_path),
        "scene_count": len(lesson_spec.get("scenes") or []),
        "lesson_spec": lesson_spec,
    }

    if render:
        result["video"] = render_manim_script(cfg, project_id, script_path, lesson_spec)

    return result


def build_lesson_spec(
    storyboard: Mapping[str, Any],
    canvas_manifest: List[Mapping[str, Any]],
    audio_manifest: List[Mapping[str, Any]] | None = None,
    *,
    scene_id: str = "",
) -> Dict[str, Any]:
    """Normalize storyboard + canvas specs into a deterministic Manim lesson spec."""
    canvas_by_scene = _canvas_by_scene(canvas_manifest)
    audio_by_scene = _audio_by_scene(audio_manifest or [])
    storyboard_scenes = storyboard.get("scenes") if isinstance(storyboard.get("scenes"), list) else []
    selected_scene_id = str(scene_id or "").strip()
    scenes: List[Dict[str, Any]] = []

    for index, scene in enumerate(storyboard_scenes, start=1):

        if not isinstance(scene, Mapping):
            continue

        current_scene_id = str(scene.get("id") or f"scene_{index}").strip()

        if selected_scene_id and current_scene_id != selected_scene_id:
            continue

        canvas_spec = canvas_by_scene.get(current_scene_id) or {}
        scene_type = _scene_type(scene, canvas_spec)

        if scene_type not in SUPPORTED_SCENE_TYPES:
            continue

        scenes.append(_normalize_scene(current_scene_id, scene_type, scene, canvas_spec, audio_by_scene.get(current_scene_id) or {}))

        if not selected_scene_id:
            break

    if not scenes:
        raise ValueError("没有找到可用于 Manim POC 的 comparison/process 分镜")

    return {
        "title": str(storyboard.get("title") or "Nexora Lesson").strip(),
        "font": DEFAULT_FONT,
        "background": "#f8fafc",
        "accent": "#2563eb",
        "accent_2": "#10b981",
        "ink": "#0f172a",
        "muted": "#64748b",
        "scenes": scenes,
    }


def write_manim_script(cfg: Mapping[str, Any], project_id: str, lesson_spec: Mapping[str, Any]) -> Path:
    root = project_dir(cfg, project_id)
    path = root / "source" / "manim" / "nexora_manim_scene.py"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(dict(lesson_spec or {}), ensure_ascii=False, indent=4)
    script = _script_template(payload)
    path.write_text(script, encoding="utf-8")
    return path


def render_manim_script(
    cfg: Mapping[str, Any],
    project_id: str,
    script_path: Path,
    lesson_spec: Mapping[str, Any],
) -> Dict[str, Any]:
    render_cfg = cfg.get("render") if isinstance(cfg.get("render"), dict) else {}
    manim_command = render_cfg.get("manim_command")
    command = [str(item) for item in manim_command] if isinstance(manim_command, list) and manim_command else ["manim"]
    quality = str(render_cfg.get("manim_quality") or "-qm").strip()
    media_dir = project_dir(cfg, project_id) / "source" / "manim" / "media"
    output_name = _output_name(lesson_spec)
    command.extend([
        quality,
        "--media_dir",
        str(media_dir),
        str(script_path),
        "NexoraLessonScene",
        "-o",
        output_name,
    ])
    result = subprocess.run(command, capture_output=True, text=True, timeout=1800)

    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "Manim render failed").strip())

    rendered = _latest_mp4(media_dir)
    export_path = project_dir(cfg, project_id) / "exports" / f"{output_name}.mp4"
    export_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(rendered, export_path)
    return {
        "path": str(export_path),
        "raw_path": str(rendered),
        "stdout": result.stdout[-4000:],
        "stderr": result.stderr[-4000:],
    }


def _load_optional_artifact(cfg: Mapping[str, Any], project_id: str, name: str, default: Any) -> Any:
    try:
        return load_artifact(cfg, project_id, name)
    except FileNotFoundError:
        return default


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


def _audio_by_scene(audio_manifest: List[Mapping[str, Any]]) -> Dict[str, Mapping[str, Any]]:
    rows: Dict[str, Mapping[str, Any]] = {}

    for row in audio_manifest:

        if not isinstance(row, Mapping):
            continue

        scene_id = str(row.get("scene_id") or "").strip()

        if scene_id:
            rows[scene_id] = row

    return rows


def _scene_type(scene: Mapping[str, Any], canvas_spec: Mapping[str, Any]) -> str:
    explicit = str(scene.get("scene_type") or "").strip().lower()

    if explicit in SUPPORTED_SCENE_TYPES:
        return explicit

    layout_type = str(canvas_spec.get("layout_type") or "").strip().lower()

    if layout_type in SUPPORTED_SCENE_TYPES:
        return layout_type

    text = " ".join([
        str(scene.get("title") or ""),
        str(scene.get("visual_goal") or ""),
        str(scene.get("canvas_brief") or ""),
        str(scene.get("caption") or ""),
    ])

    if any(keyword in text for keyword in ("对比", "比较", "真空", "大气", "vs", "VS")):
        return "comparison"

    return "process"


def _normalize_scene(
    scene_id: str,
    scene_type: str,
    scene: Mapping[str, Any],
    canvas_spec: Mapping[str, Any],
    audio_row: Mapping[str, Any],
) -> Dict[str, Any]:
    key_points = _key_points(scene, canvas_spec)
    title = str(canvas_spec.get("title") or scene.get("title") or scene_id).strip()
    caption = str(scene.get("caption") or canvas_spec.get("callout") or "").strip()
    objects = _objects(scene, canvas_spec)

    if not objects:
        raise ValueError(f"{scene_id} 缺少 Manim 可渲染对象: 请提供 visual.entities 或 canvas visual_items")

    audio_duration = _positive_float(audio_row.get("duration"))
    hinted_duration = _positive_float(scene.get("duration_hint")) or 6.0

    return {
        "scene_id": scene_id,
        "scene_type": scene_type,
        "title": title[:36],
        "narration": str(scene.get("narration") or "").strip(),
        "caption": caption[:52],
        "objects": objects,
        "key_points": key_points,
        "duration": audio_duration or hinted_duration,
        "audio_path": str(audio_row.get("path") or "").strip(),
    }


def _objects(scene: Mapping[str, Any], canvas_spec: Mapping[str, Any]) -> List[Dict[str, str]]:
    raw_objects = scene.get("objects")
    rows: List[Dict[str, str]] = []

    if not isinstance(raw_objects, list):
        visual = scene.get("visual")

        if isinstance(visual, Mapping):
            raw_objects = visual.get("objects")

            if not isinstance(raw_objects, list):
                raw_objects = visual.get("entities")

    if isinstance(raw_objects, list):

        for item in raw_objects:

            if isinstance(item, Mapping):
                rows.append({
                    "type": str(item.get("type") or item.get("kind") or "concept").strip(),
                    "label": str(item.get("label") or "").strip(),
                    "detail": str(item.get("detail") or "").strip(),
                })

    visual_items = canvas_spec.get("visual_items")

    if not rows and isinstance(visual_items, list):

        for item in visual_items:

            if isinstance(item, Mapping):
                rows.append({
                    "type": "concept",
                    "label": str(item.get("label") or "").strip(),
                    "detail": str(item.get("detail") or "").strip(),
                })

    return [row for row in rows if row["label"]][:4]


def _key_points(scene: Mapping[str, Any], canvas_spec: Mapping[str, Any]) -> List[str]:
    raw_points = scene.get("key_points")

    if not isinstance(raw_points, list):
        raw_points = canvas_spec.get("key_points")

    if not isinstance(raw_points, list):
        raw_points = []

    return [str(item or "").strip()[:28] for item in raw_points if str(item or "").strip()][:4]


def _positive_float(value: Any) -> float:
    try:
        number = float(value)
    except Exception:
        return 0.0
    return number if number > 0 else 0.0


def _output_name(lesson_spec: Mapping[str, Any]) -> str:
    scenes = lesson_spec.get("scenes") if isinstance(lesson_spec.get("scenes"), list) else []
    scene = scenes[0] if scenes and isinstance(scenes[0], Mapping) else {}
    scene_id = str(scene.get("scene_id") or "scene").strip()
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in scene_id)[:48] or "scene"
    return f"manim_{safe}"


def _latest_mp4(media_dir: Path) -> Path:
    candidates = sorted(media_dir.rglob("*.mp4"), key=lambda item: item.stat().st_mtime, reverse=True)

    if not candidates:
        raise FileNotFoundError(f"Manim 没有生成 mp4: {media_dir}")

    return candidates[0]


def _script_template(payload: str) -> str:
    payload_literal = repr(payload)
    script = textwrap.dedent('''
        from __future__ import annotations

        import json
        import textwrap

        from manim import *

        LESSON_SPEC = json.loads(__LESSON_SPEC__)


        class NexoraLessonScene(Scene):
            def construct(self):
                self.font = LESSON_SPEC.get("font") or "Microsoft YaHei"
                self.accent = LESSON_SPEC.get("accent") or "#2563eb"
                self.accent_2 = LESSON_SPEC.get("accent_2") or "#10b981"
                self.ink = LESSON_SPEC.get("ink") or "#0f172a"
                self.muted = LESSON_SPEC.get("muted") or "#64748b"
                self.camera.background_color = LESSON_SPEC.get("background") or "#f8fafc"

                for scene in LESSON_SPEC.get("scenes", []):
                    scene_start = self._scene_time()
                    scene_duration = max(2.0, float(scene.get("duration") or 5.0))
                    intro_time = min(0.55, scene_duration * 0.12)
                    outro_time = min(0.35, scene_duration * 0.08)
                    group = self._scene_group(scene)
                    self.play(FadeIn(group, shift=DOWN * 0.2), run_time=intro_time)
                    if scene.get("scene_type") == "comparison":
                        self._animate_comparison(group)
                    else:
                        self._animate_process(group)
                    elapsed = self._scene_time() - scene_start
                    hold_time = scene_duration - elapsed - outro_time
                    if hold_time > 0:
                        self.wait(hold_time)
                    self.play(FadeOut(group), run_time=outro_time)

            def _scene_time(self):
                return float(getattr(self.renderer, "time", 0.0))

            def _scene_group(self, scene):
                title = Text(str(scene.get("title") or ""), font=self.font, color=self.ink, weight=BOLD)
                title.scale(0.56).to_edge(UP).shift(DOWN * 0.12)
                caption = Text(str(scene.get("caption") or ""), font=self.font, color=self.muted)
                caption.scale(0.32).next_to(title, DOWN, buff=0.12)

                if scene.get("scene_type") == "comparison":
                    body = self._comparison_body(scene)
                else:
                    body = self._process_body(scene)

                group = VGroup(title, caption, body)
                return group

            def _process_body(self, scene):
                object_types = {str(item.get("type") or "") for item in (scene.get("objects") or [])}
                if {"rocket", "exhaust"} & object_types:
                    return self._rocket_process_body(scene)

                objects = scene.get("objects") or []
                points = scene.get("key_points") or []
                cards = VGroup()
                count = max(1, min(len(objects), 4))

                for index in range(count):
                    item = objects[index]
                    card = RoundedRectangle(width=2.55, height=1.75, corner_radius=0.12, color="#cbd5e1", fill_color=WHITE, fill_opacity=1)
                    number = Circle(radius=0.2, color=self.accent, fill_color=self.accent, fill_opacity=1)
                    number_text = Text(str(index + 1), font=self.font, color=WHITE, weight=BOLD).scale(0.28)
                    number_group = VGroup(number, number_text).move_to(card.get_corner(UL) + RIGHT * 0.35 + DOWN * 0.35)
                    label = Text(str(item.get("label") or ""), font=self.font, color=self.ink, weight=BOLD).scale(0.32)
                    label.next_to(number_group, RIGHT, buff=0.16).align_to(number_group, UP)
                    detail = self._small_text(str(item.get("detail") or (points[index] if index < len(points) else "")), 12, 2, 0.22, self.muted)
                    detail.move_to(card.get_center() + DOWN * 0.23)
                    cards.add(VGroup(card, number_group, label, detail))

                cards.arrange(RIGHT, buff=0.45).move_to(ORIGIN).shift(DOWN * 0.15)
                arrows = VGroup()
                for index in range(len(cards) - 1):
                    arrows.add(Arrow(cards[index].get_right(), cards[index + 1].get_left(), buff=0.12, color=self.accent, stroke_width=5))

                callout = self._point_band(points[:3])
                callout.next_to(cards, DOWN, buff=0.55)
                return VGroup(cards, arrows, callout)

            def _comparison_body(self, scene):
                objects = scene.get("objects") or []
                points = scene.get("key_points") or []
                left_item = objects[0] if objects else {{"label": "对照项 A", "detail": ""}}
                right_item = objects[1] if len(objects) > 1 else {{"label": "对照项 B", "detail": ""}}
                left = self._comparison_panel(left_item, points[:2], self.accent, LEFT * 2.55)
                right = self._comparison_panel(right_item, points[2:] or points[:2], self.accent_2, RIGHT * 2.55)
                arrow = Arrow(left.get_right() + RIGHT * 0.12, right.get_left() + LEFT * 0.12, buff=0.0, color=self.ink, stroke_width=4)
                label = Text("关系", font=self.font, color=self.muted).scale(0.23).next_to(arrow, UP, buff=0.08)
                return VGroup(left, right, arrow, label)

            def _comparison_panel(self, item, points, color, offset):
                panel = RoundedRectangle(width=4.25, height=3.15, corner_radius=0.16, color="#cbd5e1", fill_color=WHITE, fill_opacity=1)
                stripe = Rectangle(width=0.10, height=3.15, stroke_opacity=0, fill_color=color, fill_opacity=1)
                stripe.move_to(panel.get_left() + RIGHT * 0.05)
                title = self._small_text(str(item.get("label") or "对照项"), 13, 2, 0.42, color)
                title.move_to(panel.get_top() + DOWN * 0.46)
                detail = self._small_text(str(item.get("detail") or ""), 16, 3, 0.28, self.ink)
                detail.move_to(panel.get_center() + DOWN * 0.16)
                point_group = VGroup()
                for point in points[:2]:
                    dot = Circle(radius=0.07, color=color, fill_color=color, fill_opacity=1)
                    text = self._small_text(str(point), 16, 1, 0.22, self.muted)
                    point_group.add(VGroup(dot, text).arrange(RIGHT, buff=0.10))
                if len(point_group) > 0:
                    point_group.arrange(DOWN, aligned_edge=LEFT, buff=0.14)
                    point_group.move_to(panel.get_bottom() + UP * 0.45)
                group = VGroup(panel, stripe, title, detail, point_group)
                group.shift(offset + DOWN * 0.10)
                return group

            def _rocket_process_body(self, scene):
                points = scene.get("key_points") or []
                diagram = VGroup()
                rocket = self._rocket_icon(2.1, color=self.accent).move_to(ORIGIN + RIGHT * 0.65)
                exhaust = VGroup(
                    Polygon(LEFT * 3.45 + UP * 0.62, LEFT * 1.22 + UP * 0.25, LEFT * 1.22 + DOWN * 0.25, LEFT * 3.45 + DOWN * 0.62, color="#f97316", fill_color="#f97316", fill_opacity=0.75),
                    Polygon(LEFT * 2.75 + UP * 0.42, LEFT * 1.18 + UP * 0.14, LEFT * 1.18 + DOWN * 0.14, LEFT * 2.75 + DOWN * 0.42, color="#fed7aa", fill_color="#fed7aa", fill_opacity=0.9),
                )
                backward = Arrow(LEFT * 1.25 + DOWN * 1.18, LEFT * 4.25 + DOWN * 1.18, color="#f97316", stroke_width=11, buff=0.0)
                forward = Arrow(RIGHT * 0.75 + UP * 1.28, RIGHT * 4.05 + UP * 1.28, color=self.accent_2, stroke_width=11, buff=0.0)
                backward_label = Text("燃气动量向后", font=self.font, color="#f97316", weight=BOLD).scale(0.34).next_to(backward, DOWN, buff=0.10)
                forward_label = Text("火箭动量向前", font=self.font, color=self.accent_2, weight=BOLD).scale(0.34).next_to(forward, UP, buff=0.10)
                law = self._small_text("动量守恒：内部互推，不需要空气当支点", 28, 1, 0.36, self.ink)
                law.to_edge(DOWN).shift(UP * 0.42)
                point_group = VGroup()
                for index, point in enumerate(points[:3]):
                    dot = Circle(radius=0.12, color=self.accent, fill_color=self.accent, fill_opacity=1)
                    text = Text(str(point), font=self.font, color=self.muted).scale(0.30)
                    row = VGroup(dot, text).arrange(RIGHT, buff=0.12)
                    point_group.add(row)
                if len(point_group) > 0:
                    point_group.arrange(DOWN, aligned_edge=LEFT, buff=0.22)
                    point_group.to_edge(LEFT).shift(RIGHT * 0.42 + DOWN * 0.20)
                diagram.add(exhaust, rocket, backward, forward, backward_label, forward_label, point_group, law)
                return diagram

            def _rocket_icon(self, scale, color):
                body = RoundedRectangle(width=1.05, height=0.42, corner_radius=0.2, color=color, fill_color=WHITE, fill_opacity=1, stroke_width=3)
                nose = Triangle(color=color, fill_color=color, fill_opacity=1).scale(0.23).rotate(-PI / 2)
                nose.next_to(body, RIGHT, buff=-0.03)
                fin_top = Polygon(LEFT * 0.42 + UP * 0.21, LEFT * 0.05 + UP * 0.21, LEFT * 0.42 + UP * 0.48, color=color, fill_color=color, fill_opacity=1)
                fin_bottom = Polygon(LEFT * 0.42 + DOWN * 0.21, LEFT * 0.05 + DOWN * 0.21, LEFT * 0.42 + DOWN * 0.48, color=color, fill_color=color, fill_opacity=1)
                window = Circle(radius=0.08, color=color, fill_color="#dbeafe", fill_opacity=1).move_to(body.get_center() + RIGHT * 0.18)
                rocket = VGroup(body, nose, fin_top, fin_bottom, window)
                rocket.scale(scale)
                return rocket

            def _point_band(self, points):
                if not points:
                    return VGroup()
                band = RoundedRectangle(width=7.0, height=0.7, corner_radius=0.16, color=self.accent, fill_color=self.accent, fill_opacity=1)
                text = self._small_text(" | ".join(str(point) for point in points), 36, 1, 0.25, WHITE)
                text.move_to(band.get_center())
                return VGroup(band, text)

            def _small_text(self, text, width, lines, scale, color):
                wrapped = textwrap.wrap(str(text or ""), width=width, max_lines=lines, placeholder="...")
                content = "\\n".join(wrapped) if wrapped else ""
                return Text(content, font=self.font, color=color, line_spacing=0.75).scale(scale)

            def _animate_process(self, group):
                body = group[-1]
                cards = body[0]
                arrows = body[1]
                for card in cards:
                    self.play(card.animate.shift(UP * 0.08), run_time=0.18)
                    self.play(card.animate.shift(DOWN * 0.08), run_time=0.18)
                if len(arrows) > 0:
                    self.play(*[Indicate(arrow, color=self.accent) for arrow in arrows], run_time=0.55)

            def _animate_comparison(self, group):
                body = group[-1]
                self.play(Indicate(body[0], color=self.accent), run_time=0.45)
                self.play(GrowArrow(body[2]), FadeIn(body[3]), run_time=0.35)
                self.play(Indicate(body[1], color=self.accent_2), run_time=0.55)
    ''').lstrip()
    return script.replace("__LESSON_SPEC__", payload_literal)
