"""Structured canvas asset storage and PPT slide rendering."""

from __future__ import annotations

import json
import math
import re
import textwrap
from pathlib import Path
from typing import Any, Dict, List, Mapping, Tuple

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .html_renderer import render_free_canvas_slide, resolve_image_elements
from .projects import project_dir

Color = Tuple[int, int, int]

PALETTES: Dict[str, Dict[str, Color]] = {
    "emerald": {
        "accent": (16, 132, 88),
        "accent_dark": (6, 95, 70),
        "accent_soft": (209, 250, 229),
        "secondary": (37, 99, 235),
        "paper": (248, 250, 252),
    },
    "blue": {
        "accent": (37, 99, 235),
        "accent_dark": (30, 64, 175),
        "accent_soft": (219, 234, 254),
        "secondary": (16, 132, 88),
        "paper": (248, 250, 252),
    },
    "violet": {
        "accent": (124, 58, 237),
        "accent_dark": (91, 33, 182),
        "accent_soft": (237, 233, 254),
        "secondary": (14, 165, 233),
        "paper": (250, 250, 252),
    },
    "amber": {
        "accent": (217, 119, 6),
        "accent_dark": (146, 64, 14),
        "accent_soft": (254, 243, 199),
        "secondary": (15, 118, 110),
        "paper": (250, 250, 249),
    },
    "rose": {
        "accent": (225, 29, 72),
        "accent_dark": (159, 18, 57),
        "accent_soft": (255, 228, 230),
        "secondary": (37, 99, 235),
        "paper": (250, 250, 252),
    },
    "slate": {
        "accent": (71, 85, 105),
        "accent_dark": (30, 41, 59),
        "accent_soft": (226, 232, 240),
        "secondary": (16, 132, 88),
        "paper": (248, 250, 252),
    },
}

INK = (15, 23, 42)
MUTED = (71, 85, 105)
BORDER = (203, 213, 225)
WHITE = (255, 255, 255)


def save_canvas_code(cfg: Mapping[str, Any], project_id: str, scene_id: str, code: str) -> Path:
    path = project_dir(cfg, project_id) / "source" / "canvas" / f"{scene_id}.js"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(code or ""), encoding="utf-8")
    return path


def save_canvas_spec(cfg: Mapping[str, Any], project_id: str, scene_id: str, spec: Mapping[str, Any]) -> Path:
    path = project_dir(cfg, project_id) / "source" / "canvas" / f"{scene_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(spec or {}), ensure_ascii=False, indent=4), encoding="utf-8")
    return path


def build_canvas_code(spec: Mapping[str, Any], *, width: int, height: int) -> str:
    """Build deterministic browser canvas code from the structured PPT spec."""
    payload = json.dumps(dict(spec or {}), ensure_ascii=False, indent=4)
    if str(spec.get("layout_type") or "").strip() == "free_canvas":
        return _build_free_canvas_code(payload, width=width, height=height)

    return f"""const structuredSlideSpec = {payload};

function renderScene(ctx, scene, assets) {{
    const spec = structuredSlideSpec;
    const width = {int(width)};
    const height = {int(height)};
    const paletteMap = {{
        emerald: {{ accent: "#108458", accentDark: "#065f46", soft: "#d1fae5", secondary: "#2563eb", paper: "#f8fafc" }},
        blue: {{ accent: "#2563eb", accentDark: "#1e40af", soft: "#dbeafe", secondary: "#108458", paper: "#f8fafc" }},
        violet: {{ accent: "#7c3aed", accentDark: "#5b21b6", soft: "#ede9fe", secondary: "#0ea5e9", paper: "#fafafc" }},
        amber: {{ accent: "#d97706", accentDark: "#92400e", soft: "#fef3c7", secondary: "#0f766e", paper: "#fafaf9" }},
        rose: {{ accent: "#e11d48", accentDark: "#9f1239", soft: "#ffe4e6", secondary: "#2563eb", paper: "#fafafc" }},
        slate: {{ accent: "#475569", accentDark: "#1e293b", soft: "#e2e8f0", secondary: "#108458", paper: "#f8fafc" }}
    }};
    const palette = paletteMap[spec.palette];

    if (!palette) {{
        throw new Error("Unknown slide palette: " + spec.palette);
    }}

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.paper;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(0, 0, width, 18);
    ctx.fillStyle = palette.soft;
    ctx.fillRect(96, 138, 1728, 810);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 3;
    ctx.strokeRect(96, 138, 1728, 810);
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 64px Microsoft YaHei, sans-serif";
    ctx.fillText(spec.title, 140, 230);
    ctx.fillStyle = "#475569";
    ctx.font = "400 34px Microsoft YaHei, sans-serif";
    ctx.fillText(spec.subtitle, 140, 292);
    ctx.fillStyle = palette.accentDark;
    ctx.font = "700 42px Microsoft YaHei, sans-serif";
    ctx.fillText(spec.callout, 140, 875);

    const points = spec.key_points || [];
    ctx.font = "500 32px Microsoft YaHei, sans-serif";
    points.forEach((point, index) => {{
        const y = 405 + index * 82;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(150, y - 42, 720, 58);
        ctx.fillStyle = palette.accent;
        ctx.beginPath();
        ctx.arc(185, y - 12, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0f172a";
        ctx.fillText(point, 225, y);
    }});

    const items = spec.visual_items || [];
    ctx.font = "700 30px Microsoft YaHei, sans-serif";
    items.forEach((item, index) => {{
        const x = 1020 + (index % 2) * 330;
        const y = 420 + Math.floor(index / 2) * 190;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y - 80, 280, 140);
        ctx.fillStyle = index % 2 === 0 ? palette.accent : palette.secondary;
        ctx.beginPath();
        ctx.arc(x + 42, y - 20, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0f172a";
        ctx.fillText(item.label, x + 82, y - 22);
        ctx.fillStyle = "#64748b";
        ctx.font = "400 22px Microsoft YaHei, sans-serif";
        ctx.fillText(item.detail, x + 26, y + 28);
        ctx.font = "700 30px Microsoft YaHei, sans-serif";
    }});
}}
"""


def _build_free_canvas_code(payload: str, *, width: int, height: int) -> str:
    return f"""const structuredSlideSpec = {payload};

function renderScene(ctx, scene, assets) {{
    const spec = structuredSlideSpec;
    const width = {int(width)};
    const height = {int(height)};

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = spec.background;
    ctx.fillRect(0, 0, width, height);

    (spec.elements || []).forEach((element) => {{
        if (element.type === "rect") {{
            drawRoundRect(ctx, element.x, element.y, element.w, element.h, element.radius || 0);
            ctx.fillStyle = element.fill;
            ctx.fill();
            if (element.stroke) {{
                ctx.strokeStyle = element.stroke;
                ctx.lineWidth = 2;
                ctx.stroke();
            }}
        }}

        if (element.type === "circle") {{
            ctx.beginPath();
            ctx.ellipse(element.x + element.w / 2, element.y + element.h / 2, element.w / 2, element.h / 2, 0, 0, Math.PI * 2);
            ctx.fillStyle = element.fill;
            ctx.fill();
            if (element.stroke) {{
                ctx.strokeStyle = element.stroke;
                ctx.lineWidth = 2;
                ctx.stroke();
            }}
        }}

        if (element.type === "line") {{
            ctx.strokeStyle = element.stroke;
            ctx.lineWidth = element.width || 4;
            ctx.beginPath();
            ctx.moveTo(element.x1, element.y1);
            ctx.lineTo(element.x2, element.y2);
            ctx.stroke();
        }}

        if (element.type === "text") {{
            ctx.fillStyle = element.color;
            ctx.font = `${{fontWeight(element.weight)}} ${{element.font_size}}px Microsoft YaHei, sans-serif`;
            ctx.textAlign = element.align || "left";
            ctx.textBaseline = "top";
            ctx.fillText(element.text, element.x, element.y);
        }}
    }});
}}

function drawRoundRect(ctx, x, y, w, h, r) {{
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}}

function fontWeight(weight) {{
    if (weight === "bold") return 700;
    if (weight === "semibold") return 600;
    if (weight === "medium") return 500;
    return 400;
}}
"""


def render_storyboard_slides(
    cfg: Mapping[str, Any],
    project_id: str,
    storyboard: Mapping[str, Any],
    canvas_rows: List[Mapping[str, Any]],
) -> List[Dict[str, Any]]:
    render_cfg = cfg.get("render") if isinstance(cfg.get("render"), dict) else {}
    width = int(render_cfg.get("width") or 1920)
    height = int(render_cfg.get("height") or 1080)
    scenes = storyboard.get("scenes") if isinstance(storyboard.get("scenes"), list) else []
    specs = _specs_by_scene(canvas_rows)
    rows: List[Dict[str, Any]] = []

    for index, scene in enumerate(scenes, start=1):

        if not isinstance(scene, Mapping):
            continue

        scene_id = str(scene.get("id") or f"scene_{index}").strip()
        spec = specs.get(scene_id)

        if not isinstance(spec, Mapping):
            raise ValueError(f"{scene_id} 缺少结构化 canvas 页面 spec")

        layout_type = str(spec.get("layout_type") or "").strip()
        path = project_dir(cfg, project_id) / "source" / "slides" / f"{scene_id}.png"
        _render_slide_png(
            cfg,
            project_id,
            scene_id=scene_id,
            spec=spec,
            path=path,
            width=width,
            height=height,
            index=index,
            total=len(scenes),
        )
        rows.append({
            "scene_id": scene_id,
            "path": str(path),
            "width": width,
            "height": height,
            "renderer": _slide_renderer_name(layout_type),
            "layout_type": layout_type,
        })

    return rows


def _specs_by_scene(canvas_rows: List[Mapping[str, Any]]) -> Dict[str, Mapping[str, Any]]:
    specs: Dict[str, Mapping[str, Any]] = {}

    for row in canvas_rows:

        if not isinstance(row, Mapping):
            continue

        scene_id = str(row.get("scene_id") or "").strip()
        spec = row.get("spec")

        if scene_id and isinstance(spec, Mapping):
            specs[scene_id] = spec

    return specs


def _render_slide_png(
    cfg: Mapping[str, Any],
    project_id: str,
    *,
    scene_id: str,
    spec: Mapping[str, Any],
    path: Path,
    width: int,
    height: int,
    index: int,
    total: int,
) -> None:
    """Render a slide PNG with the renderer required by its layout type."""
    layout_type = str(spec.get("layout_type") or "").strip()

    if layout_type == "free_canvas":
        html_spec = resolve_image_elements(spec)
        render_free_canvas_slide(
            cfg,
            project_id,
            scene_id=scene_id,
            spec=html_spec,
            output_path=path,
            width=width,
            height=height,
        )
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    _render_scene_png(spec, path, width=width, height=height, index=index, total=total)


def _slide_renderer_name(layout_type: str) -> str:
    if layout_type == "free_canvas":
        return "html_free_canvas"

    return "structured_ppt_template"


def _render_scene_png(spec: Mapping[str, Any], path: Path, *, width: int, height: int, index: int, total: int) -> None:
    palette = _palette(str(spec.get("palette") or "").strip())
    image = Image.new("RGB", (width, height), palette["paper"])
    draw = ImageDraw.Draw(image)
    layout_type = str(spec.get("layout_type") or "").strip()

    if layout_type == "free_canvas":
        _draw_free_canvas_layout(image, draw, spec, width, height)
        image.save(path)
        return

    _draw_page_shell(draw, spec, palette, width, height, index, total)

    if layout_type == "cover":
        _draw_cover_layout(draw, spec, palette, width, height)

    elif layout_type == "process":
        _draw_process_layout(draw, spec, palette, width, height)

    elif layout_type == "comparison":
        _draw_comparison_layout(draw, spec, palette, width, height)

    elif layout_type == "fact_grid":
        _draw_fact_grid_layout(draw, spec, palette, width, height)

    elif layout_type == "timeline":
        _draw_timeline_layout(draw, spec, palette, width, height)

    elif layout_type == "focus":
        _draw_focus_layout(draw, spec, palette, width, height)

    elif layout_type == "image_focus":
        _draw_image_focus_layout(image, draw, spec, palette, width, height)

    else:
        raise ValueError(f"未知 PPT 模板类型: {layout_type}")

    image.save(path)


def _draw_page_shell(
    draw: ImageDraw.ImageDraw,
    spec: Mapping[str, Any],
    palette: Mapping[str, Color],
    width: int,
    height: int,
    index: int,
    total: int,
) -> None:
    title_font = _font(58, bold=True)
    subtitle_font = _font(29)
    label_font = _font(22, bold=True)
    margin_x = 118
    draw.rectangle([0, 0, width, 10], fill=palette["accent"])
    draw.rounded_rectangle([margin_x, 72, margin_x + 178, 112], radius=20, fill=palette["accent_soft"])
    draw.text((margin_x + 28, 92), "NEXORA", fill=palette["accent_dark"], font=label_font, anchor="lm")
    draw.text((margin_x, 138), str(spec.get("title") or ""), fill=INK, font=title_font)
    draw.text((margin_x + 3, 213), str(spec.get("subtitle") or ""), fill=MUTED, font=subtitle_font)
    draw.rounded_rectangle([width - 260, 82, width - 122, 130], radius=24, fill=WHITE, outline=(226, 232, 240), width=2)
    draw.text((width - 191, 106), f"{index}/{total}", fill=palette["accent_dark"], font=label_font, anchor="mm")


def _draw_cover_layout(draw: ImageDraw.ImageDraw, spec: Mapping[str, Any], palette: Mapping[str, Color], width: int, height: int) -> None:
    title_font = _font(92, bold=True)
    body_font = _font(34)
    callout_font = _font(42, bold=True)
    callout = _required_text(spec, "callout")
    subtitle = str(spec.get("subtitle") or "").strip()
    points = _text_rows(spec, "key_points")
    items = _visual_items(spec)
    draw.rounded_rectangle([118, 306, width - 118, 642], radius=18, fill=WHITE)
    draw.rectangle([118, 306, 132, 642], fill=palette["accent"])
    _draw_text_lines(draw, callout, 188, 388, 16, 2, title_font, INK, 98)

    if subtitle:
        _draw_text_lines(draw, subtitle, 192, 566, 31, 1, callout_font, palette["accent_dark"], 54)

    for idx, point in enumerate(points[:3]):
        x = 150 + idx * 520
        draw.rounded_rectangle([x, 722, x + 430, 810], radius=14, fill=palette["accent_soft"])
        draw.text((x + 32, 748), point, fill=INK, font=body_font)

    _draw_visual_strip(draw, items, 150, 872, width - 300, palette)


def _draw_free_canvas_layout(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: Mapping[str, Any],
    width: int,
    height: int,
) -> None:
    background = _parse_hex_color(str(spec.get("background") or ""))
    draw.rectangle([0, 0, width, height], fill=background)
    elements = spec.get("elements")

    if not isinstance(elements, list):
        raise ValueError("free_canvas spec elements 必须是数组")

    for index, element in enumerate(elements, start=1):

        if not isinstance(element, Mapping):
            raise ValueError(f"free_canvas elements[{index}] 必须是对象")

        element_type = str(element.get("type") or "").strip()

        if element_type == "rect":
            _draw_free_rect(image, draw, element)

        elif element_type == "circle":
            _draw_free_circle(image, draw, element)

        elif element_type == "line":
            _draw_free_line(draw, element)

        elif element_type == "text":
            _draw_free_text(draw, element)

        elif element_type == "image":
            _draw_free_image(image, element, spec)

        else:
            raise ValueError(f"未知 free_canvas 元素类型: {element_type}")


def _draw_free_rect(image: Image.Image, draw: ImageDraw.ImageDraw, element: Mapping[str, Any]) -> None:
    box = _element_box(element)
    fill_text = str(element.get("fill") or "").strip()
    fill = _parse_canvas_color(fill_text) if fill_text else None
    stroke = str(element.get("stroke") or "").strip()
    radius = int(element.get("radius") or 0)

    if _has_alpha(fill):
        _draw_alpha_rounded_rectangle(image, box, radius, fill)
    else:
        draw.rounded_rectangle(box, radius=radius, fill=fill)

    if stroke:
        draw.rounded_rectangle(box, radius=radius, outline=_parse_canvas_color(stroke)[:3], width=2)


def _draw_free_circle(image: Image.Image, draw: ImageDraw.ImageDraw, element: Mapping[str, Any]) -> None:
    box = _element_box(element)
    fill_text = str(element.get("fill") or "").strip()
    fill = _parse_canvas_color(fill_text) if fill_text else None
    stroke = str(element.get("stroke") or "").strip()

    if _has_alpha(fill):
        _draw_alpha_ellipse(image, box, fill)
    else:
        draw.ellipse(box, fill=fill)

    if stroke:
        draw.ellipse(box, outline=_parse_canvas_color(stroke)[:3], width=2)


def _draw_free_line(draw: ImageDraw.ImageDraw, element: Mapping[str, Any]) -> None:
    x1 = int(element.get("x1") or 0)
    y1 = int(element.get("y1") or 0)
    x2 = int(element.get("x2") or 0)
    y2 = int(element.get("y2") or 0)
    stroke = _parse_canvas_color(str(element.get("stroke") or ""))[:3]
    line_width = int(element.get("width") or 1)

    draw.line([x1, y1, x2, y2], fill=stroke, width=line_width)

    if bool(element.get("arrow")):
        _draw_arrow_head(draw, x1, y1, x2, y2, stroke, line_width)


def _draw_free_text(draw: ImageDraw.ImageDraw, element: Mapping[str, Any]) -> None:
    x = int(element.get("x") or 0)
    y = int(element.get("y") or 0)
    w = int(element.get("w") or 1)
    h = int(element.get("h") or 1)
    fill = _parse_hex_color(str(element.get("color") or ""))
    align = str(element.get("align") or "left").strip()
    box_left = _free_text_box_left(x, w, align)
    font, line_height, lines = _fit_free_text(draw, element, w, h)

    for line in lines:
        left = box_left

        if align != "left":
            text_width = _text_width(draw, line, font)

            if align == "center":
                left = box_left + (w - text_width) // 2

            elif align == "right":
                left = box_left + w - text_width

        draw.text((left, y), line, fill=fill, font=font)
        y += line_height


def _fit_free_text(
    draw: ImageDraw.ImageDraw,
    element: Mapping[str, Any],
    width: int,
    height: int,
) -> Tuple[ImageFont.FreeTypeFont, int, List[str]]:
    requested_size = int(element.get("font_size") or 24)
    bold = str(element.get("weight") or "") in {"semibold", "bold"}
    text = str(element.get("text") or "")

    for font_size in range(min(320, requested_size), 13, -2):
        font = _font(font_size, bold=bold)
        line_height = max(font_size + 6, int(font_size * 1.18))
        max_lines = max(1, height // line_height)
        width_chars = max(1, int(width / max(1, font_size * 0.56)))
        lines = _wrap_text(text, width_chars=width_chars, max_lines=max_lines)
        total_height = len(lines) * line_height

        if total_height > height:
            continue

        if all(_text_width(draw, line, font) <= width for line in lines):
            return font, line_height, lines

    font = _font(14, bold=bold)
    line_height = 20
    max_lines = max(1, height // line_height)
    lines = _wrap_text(text, width_chars=max(1, width // 8), max_lines=max_lines)
    return font, line_height, lines


def _draw_free_image(image: Image.Image, element: Mapping[str, Any], spec: Mapping[str, Any]) -> None:
    asset_key = str(element.get("asset_key") or "").strip()
    asset = spec.get("image_asset")

    if asset_key != "scene_image" or not isinstance(asset, Mapping):
        raise ValueError("free_canvas image 元素缺少可用 scene_image 资产")

    source_path = str(asset.get("path") or "").strip()

    if not source_path:
        raise ValueError("free_canvas image 元素缺少 image_asset.path")

    x = int(element.get("x") or 0)
    y = int(element.get("y") or 0)
    w = int(element.get("w") or 1)
    h = int(element.get("h") or 1)
    fit = str(element.get("fit") or "cover").strip()
    radius = int(element.get("radius") or 0)
    pasted = _fit_free_asset_image(source_path, w, h, fit)

    if radius > 0:
        mask = Image.new("L", (w, h), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([0, 0, w, h], radius=radius, fill=255)
        image.paste(pasted, (x, y), mask)
    else:
        image.paste(pasted, (x, y))


def _draw_process_layout(draw: ImageDraw.ImageDraw, spec: Mapping[str, Any], palette: Mapping[str, Color], width: int, height: int) -> None:
    items = _visual_items(spec)
    card_top = 360
    card_width = 420
    gap = 70
    start_x = (width - (card_width * len(items[:3]) + gap * (len(items[:3]) - 1))) // 2

    for idx, item in enumerate(items[:3]):
        x = start_x + idx * (card_width + gap)
        _draw_step_card(draw, item, idx + 1, x, card_top, card_width, 300, palette)

        if idx < len(items[:3]) - 1:
            y = card_top + 150
            draw.line([x + card_width + 15, y, x + card_width + gap - 15, y], fill=palette["accent"], width=8)
            draw.polygon([
                (x + card_width + gap - 15, y),
                (x + card_width + gap - 38, y - 16),
                (x + card_width + gap - 38, y + 16),
            ], fill=palette["accent"])

    _draw_callout_band(draw, spec, palette, width, height)


def _draw_comparison_layout(draw: ImageDraw.ImageDraw, spec: Mapping[str, Any], palette: Mapping[str, Color], width: int, height: int) -> None:
    items = _visual_items(spec)
    points = _text_rows(spec, "key_points")
    left_items = items[: max(1, len(items) // 2)]
    right_items = items[max(1, len(items) // 2):]
    columns = [
        (170, 338, 760, 500, palette["accent_soft"], left_items, points[:2]),
        (990, 338, 760, 500, (239, 246, 255), right_items, points[2:]),
    ]

    for x, y, w, h, fill, column_items, column_points in columns:
        draw.rounded_rectangle([x, y, x + w, y + h], radius=18, fill=fill)

        for idx, item in enumerate(column_items[:2]):
            _draw_compact_item(draw, item, x + 58, y + 68 + idx * 146, w - 100, palette)

        for idx, point in enumerate(column_points[:2]):
            point_y = y + 382 + idx * 56
            draw.ellipse([x + 66, point_y - 9, x + 84, point_y + 9], fill=palette["accent"])
            _draw_text_lines(draw, point, x + 106, point_y - 18, 18, 1, _font(30), INK, 38)

    _draw_callout_band(draw, spec, palette, width, height)


def _draw_fact_grid_layout(draw: ImageDraw.ImageDraw, spec: Mapping[str, Any], palette: Mapping[str, Color], width: int, height: int) -> None:
    items = _visual_items(spec)
    points = _text_rows(spec, "key_points")
    cells = items[:4]

    for idx, item in enumerate(cells):
        col = idx % 2
        row = idx // 2
        x = 310 + col * 665
        y = 340 + row * 235
        _draw_fact_card(draw, item, x, y, 560, 180, palette, idx)

    for idx, point in enumerate(points[:4]):
        x = 340 + idx * 390
        draw.rounded_rectangle([x, 850, x + 320, 920], radius=20, fill=WHITE, outline=BORDER, width=2)
        draw.text((x + 32, 868), point, fill=INK, font=_font(30, bold=True))


def _draw_timeline_layout(draw: ImageDraw.ImageDraw, spec: Mapping[str, Any], palette: Mapping[str, Color], width: int, height: int) -> None:
    items = _visual_items(spec)
    center_y = 560
    start_x = 280
    end_x = width - 260
    draw.line([start_x, center_y, end_x, center_y], fill=palette["accent"], width=10)

    for idx, item in enumerate(items[:5]):
        x = start_x + idx * ((end_x - start_x) // max(1, len(items[:5]) - 1))
        draw.ellipse([x - 38, center_y - 38, x + 38, center_y + 38], fill=WHITE, outline=palette["accent"], width=8)
        draw.text((x, center_y), str(idx + 1), fill=palette["accent_dark"], font=_font(30, bold=True), anchor="mm")
        box_top = center_y - 210 if idx % 2 == 0 else center_y + 80
        _draw_timeline_note(draw, item, x - 160, box_top, 320, 130, palette)

    _draw_callout_band(draw, spec, palette, width, height)


def _draw_focus_layout(draw: ImageDraw.ImageDraw, spec: Mapping[str, Any], palette: Mapping[str, Color], width: int, height: int) -> None:
    points = _text_rows(spec, "key_points")
    items = _visual_items(spec)
    center_x = width // 2
    center_y = 565
    callout = _required_text(spec, "callout")
    center_box = [center_x - 270, center_y - 92, center_x + 270, center_y + 92]
    draw.rounded_rectangle(center_box, radius=18, fill=WHITE)
    draw.rectangle([center_box[0], center_box[1], center_box[0] + 12, center_box[3]], fill=palette["accent"])
    _draw_text_lines(draw, callout, center_box[0] + 46, center_box[1] + 40, 14, 2, _font(36, bold=True), palette["accent_dark"], 48)

    for idx, point in enumerate(points[:4]):
        target_x = 190 if idx < 2 else 1280
        target_y = 410 + (idx % 2) * 150
        draw.rounded_rectangle([target_x - 24, target_y - 28, target_x + 430, target_y + 52], radius=14, fill=WHITE)
        draw.ellipse([target_x, target_y - 10, target_x + 24, target_y + 14], fill=palette["accent"])
        draw.text((target_x + 48, target_y - 22), point, fill=INK, font=_font(34, bold=True))

    _draw_visual_strip(draw, items, 300, 870, width - 600, palette)


def _draw_image_focus_layout(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    spec: Mapping[str, Any],
    palette: Mapping[str, Color],
    width: int,
    height: int,
) -> None:
    points = _text_rows(spec, "key_points")
    asset = _image_asset(spec)
    image_box = [900, 306, 1746, 922]
    left_box = [150, 326, 770, 790]

    draw.rounded_rectangle(left_box, radius=18, fill=WHITE)
    draw.rectangle([left_box[0], left_box[1], left_box[0] + 12, left_box[3]], fill=palette["accent"])
    draw.text((left_box[0] + 46, left_box[1] + 44), "核心要点", fill=palette["accent_dark"], font=_font(34, bold=True))

    for idx, point in enumerate(points[:5]):
        y = left_box[1] + 118 + idx * 70
        draw.ellipse([left_box[0] + 48, y - 20, left_box[0] + 88, y + 20], fill=palette["accent_soft"])
        draw.text((left_box[0] + 68, y), str(idx + 1), fill=palette["accent_dark"], font=_font(21, bold=True), anchor="mm")
        _draw_text_lines(draw, point, left_box[0] + 112, y - 22, 16, 1, _font(30, bold=True), INK, 34)

    draw.rounded_rectangle(image_box, radius=18, fill=WHITE)
    pasted = _fit_asset_image(asset["path"], image_box[2] - image_box[0] - 24, image_box[3] - image_box[1] - 24)
    image.paste(pasted, (image_box[0] + 12, image_box[1] + 12))
    _draw_callout_band(draw, spec, palette, width, height)


def _draw_step_card(
    draw: ImageDraw.ImageDraw,
    item: Mapping[str, str],
    number: int,
    x: int,
    y: int,
    width: int,
    height: int,
    palette: Mapping[str, Color],
) -> None:
    draw.rounded_rectangle([x, y, x + width, y + height], radius=16, fill=WHITE)
    draw.ellipse([x + 34, y + 34, x + 104, y + 104], fill=palette["accent"])
    draw.text((x + 69, y + 70), str(number), fill=WHITE, font=_font(32, bold=True), anchor="mm")
    draw.text((x + 130, y + 42), item["label"], fill=INK, font=_font(38, bold=True))
    _draw_text_lines(draw, item["detail"], x + 46, y + 142, 14, 3, _font(30), MUTED, 44)


def _draw_compact_item(draw: ImageDraw.ImageDraw, item: Mapping[str, str], x: int, y: int, width: int, palette: Mapping[str, Color]) -> None:
    draw.ellipse([x, y, x + 54, y + 54], fill=palette["accent"])
    draw.text((x + 78, y - 2), item["label"], fill=INK, font=_font(34, bold=True))
    _draw_text_lines(draw, item["detail"], x + 78, y + 47, 18, 2, _font(26), MUTED, 36)


def _draw_fact_card(
    draw: ImageDraw.ImageDraw,
    item: Mapping[str, str],
    x: int,
    y: int,
    width: int,
    height: int,
    palette: Mapping[str, Color],
    index: int,
) -> None:
    fill = WHITE if index % 2 == 0 else palette["accent_soft"]
    draw.rounded_rectangle([x, y, x + width, y + height], radius=16, fill=fill)
    draw.rectangle([x, y, x + 12, y + height], fill=palette["accent"])
    draw.text((x + 52, y + 34), item["label"], fill=INK, font=_font(36, bold=True))
    _draw_text_lines(draw, item["detail"], x + 52, y + 92, 23, 2, _font(28), MUTED, 40)


def _draw_timeline_note(
    draw: ImageDraw.ImageDraw,
    item: Mapping[str, str],
    x: int,
    y: int,
    width: int,
    height: int,
    palette: Mapping[str, Color],
) -> None:
    draw.rounded_rectangle([x, y, x + width, y + height], radius=14, fill=WHITE)
    draw.text((x + 28, y + 24), item["label"], fill=palette["accent_dark"], font=_font(30, bold=True))
    _draw_text_lines(draw, item["detail"], x + 28, y + 70, 14, 2, _font(24), MUTED, 32)


def _draw_callout_band(draw: ImageDraw.ImageDraw, spec: Mapping[str, Any], palette: Mapping[str, Color], width: int, height: int) -> None:
    callout_font = _font(34, bold=True)
    callout = _required_text(spec, "callout")
    box = [150, height - 158, width - 150, height - 94]
    draw.rounded_rectangle(box, radius=16, fill=WHITE)
    draw.rectangle([box[0], box[1], box[0] + 12, box[3]], fill=palette["accent"])
    _draw_text_lines(draw, callout, box[0] + 48, box[1] + 16, 42, 1, callout_font, palette["accent_dark"], 42)


def _draw_visual_strip(
    draw: ImageDraw.ImageDraw,
    items: List[Mapping[str, str]],
    x: int,
    y: int,
    width: int,
    palette: Mapping[str, Color],
) -> None:
    count = min(len(items), 4)

    if count <= 0:
        raise ValueError("visual_items 不能为空")

    card_width = width // count - 22

    for idx, item in enumerate(items[:count]):
        left = x + idx * (card_width + 28)
        draw.rounded_rectangle([left, y, left + card_width, y + 86], radius=14, fill=WHITE)
        draw.ellipse([left + 24, y + 25, left + 58, y + 59], fill=palette["accent"] if idx % 2 == 0 else palette["secondary"])
        draw.text((left + 78, y + 16), item["label"], fill=INK, font=_font(26, bold=True))
        draw.text((left + 78, y + 50), item["detail"], fill=MUTED, font=_font(20))


def _image_asset(spec: Mapping[str, Any]) -> Mapping[str, str]:
    asset = spec.get("image_asset")

    if not isinstance(asset, Mapping):
        raise ValueError("image_focus 布局缺少 image_asset")

    path = str(asset.get("path") or "").strip()

    if not path:
        raise ValueError("image_focus 布局缺少 image_asset.path")

    return {
        "path": path,
    }


def _fit_asset_image(path: str, width: int, height: int) -> Image.Image:
    source_path = Path(path)

    if not source_path.exists():
        raise ValueError(f"图片资产不存在: {source_path}")

    with Image.open(source_path) as source:
        return ImageOps.fit(source.convert("RGB"), (width, height), method=Image.Resampling.LANCZOS)


def _fit_free_asset_image(path: str, width: int, height: int, fit: str) -> Image.Image:
    source_path = Path(path)

    if not source_path.exists():
        raise ValueError(f"图片资产不存在: {source_path}")

    with Image.open(source_path) as source:
        rgb = source.convert("RGB")

        if fit == "cover":
            return ImageOps.fit(rgb, (width, height), method=Image.Resampling.LANCZOS)

        if fit == "contain":
            canvas = Image.new("RGB", (width, height), WHITE)
            contained = ImageOps.contain(rgb, (width, height), method=Image.Resampling.LANCZOS)
            x = (width - contained.width) // 2
            y = (height - contained.height) // 2
            canvas.paste(contained, (x, y))
            return canvas

        raise ValueError(f"未知图片填充模式: {fit}")


def _draw_text_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    x: int,
    y: int,
    width_chars: int,
    max_lines: int,
    font: ImageFont.FreeTypeFont,
    fill: Color,
    line_height: int,
) -> None:
    for line in _wrap_text(text, width_chars=width_chars, max_lines=max_lines):
        draw.text((x, y), line, fill=fill, font=font)
        y += line_height


def _palette(name: str) -> Mapping[str, Color]:
    palette = PALETTES.get(name)

    if not palette:
        raise ValueError(f"未知 PPT 配色: {name}")

    return palette


def _parse_hex_color(value: str) -> Color:
    text = str(value or "").strip()

    if len(text) != 7 or not text.startswith("#"):
        raise ValueError(f"颜色必须是 #RRGGBB: {value}")

    try:
        return (
            int(text[1:3], 16),
            int(text[3:5], 16),
            int(text[5:7], 16),
        )
    except ValueError as exc:
        raise ValueError(f"颜色必须是 #RRGGBB: {value}") from exc


def _parse_canvas_color(value: str) -> Tuple[int, ...]:
    text = str(value or "").strip()

    if text.startswith("#"):
        return _parse_hex_color(text)

    match = re.fullmatch(
        r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)",
        text,
        flags=re.IGNORECASE,
    )

    if not match:
        raise ValueError(f"颜色必须是 #RRGGBB、rgb(...) 或 rgba(...): {value}")

    red = _rgb_channel(match.group(1), value)
    green = _rgb_channel(match.group(2), value)
    blue = _rgb_channel(match.group(3), value)
    alpha_text = match.group(4)

    if alpha_text is None:
        return red, green, blue

    alpha = int(round(float(alpha_text) * 255))
    return red, green, blue, max(0, min(255, alpha))


def _rgb_channel(value: str, source: str) -> int:
    channel = int(value)

    if channel < 0 or channel > 255:
        raise ValueError(f"RGB 通道超出范围: {source}")

    return channel


def _has_alpha(color: Tuple[int, ...] | None) -> bool:
    return bool(color and len(color) == 4 and color[3] < 255)


def _draw_alpha_rounded_rectangle(image: Image.Image, box: List[int], radius: int, fill: Tuple[int, ...]) -> None:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rounded_rectangle(box, radius=radius, fill=fill)
    _alpha_composite_into(image, overlay)


def _draw_alpha_ellipse(image: Image.Image, box: List[int], fill: Tuple[int, ...]) -> None:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.ellipse(box, fill=fill)
    _alpha_composite_into(image, overlay)


def _alpha_composite_into(image: Image.Image, overlay: Image.Image) -> None:
    composited = Image.alpha_composite(image.convert("RGBA"), overlay)
    image.paste(composited.convert("RGB"))


def _element_box(element: Mapping[str, Any]) -> List[int]:
    x = int(element.get("x") or 0)
    y = int(element.get("y") or 0)
    w = int(element.get("w") or 1)
    h = int(element.get("h") or 1)
    return [x, y, x + w, y + h]


def _free_text_box_left(x: int, width: int, align: str) -> int:
    if align == "center":
        return int(x - width / 2)

    if align == "right":
        return int(x - width)

    return x


def _draw_arrow_head(
    draw: ImageDraw.ImageDraw,
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    fill: Color,
    line_width: int,
) -> None:
    angle = math.atan2(y2 - y1, x2 - x1)
    size = max(14, line_width * 4)
    left_angle = angle + math.pi * 0.82
    right_angle = angle - math.pi * 0.82
    points = [
        (x2, y2),
        (x2 + math.cos(left_angle) * size, y2 + math.sin(left_angle) * size),
        (x2 + math.cos(right_angle) * size, y2 + math.sin(right_angle) * size),
    ]
    draw.polygon(points, fill=fill)


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> int:
    box = draw.textbbox((0, 0), str(text or ""), font=font)
    return int(box[2] - box[0])


def _text_rows(spec: Mapping[str, Any], key: str) -> List[str]:
    rows = spec.get(key)

    if not isinstance(rows, list):
        raise ValueError(f"PPT spec {key} 必须是数组")

    return [str(item).strip() for item in rows]


def _visual_items(spec: Mapping[str, Any]) -> List[Mapping[str, str]]:
    rows = spec.get("visual_items")

    if not isinstance(rows, list):
        raise ValueError("PPT spec visual_items 必须是数组")

    return rows


def _required_text(spec: Mapping[str, Any], key: str) -> str:
    value = str(spec.get(key) or "").strip()

    if not value:
        raise ValueError(f"PPT spec {key} 不能为空")

    return value


def _font(size: int, *, bold: bool = False):
    path = Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc")

    if not path.exists():
        raise FileNotFoundError(f"缺少 PPT 渲染字体: {path}")

    return ImageFont.truetype(str(path), size)


def _wrap_text(text: str, *, width_chars: int, max_lines: int) -> List[str]:
    cleaned = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    rows: List[str] = []

    for paragraph in cleaned.split("\n"):
        paragraph = paragraph.strip()

        if not paragraph:
            continue

        rows.extend(textwrap.wrap(paragraph, width=width_chars, replace_whitespace=False))

        if len(rows) >= max_lines:
            break

    return rows[:max_lines] or [""]
