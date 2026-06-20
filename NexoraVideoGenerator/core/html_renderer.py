"""HTML/CSS renderer for free-canvas slide specs."""

from __future__ import annotations

import html
import shutil
import subprocess
from pathlib import Path
from typing import Any, List, Mapping

from .projects import project_dir


def render_free_canvas_slide(
    cfg: Mapping[str, Any],
    project_id: str,
    *,
    scene_id: str,
    spec: Mapping[str, Any],
    output_path: Path,
    width: int,
    height: int,
) -> Path:
    """Render a free_canvas spec through browser CSS layout and screenshot it."""
    html_path = _write_free_canvas_html(
        cfg,
        project_id,
        scene_id=scene_id,
        spec=spec,
        width=width,
        height=height,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    _screenshot_html(cfg, html_path, output_path, width=width, height=height)
    return output_path


def _write_free_canvas_html(
    cfg: Mapping[str, Any],
    project_id: str,
    *,
    scene_id: str,
    spec: Mapping[str, Any],
    width: int,
    height: int,
) -> Path:
    path = project_dir(cfg, project_id) / "source" / "canvas_html" / f"{scene_id}.html"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_free_canvas_html(spec, width=width, height=height), encoding="utf-8")
    return path


def _screenshot_html(
    cfg: Mapping[str, Any],
    html_path: Path,
    output_path: Path,
    *,
    width: int,
    height: int,
) -> None:
    render_cfg = cfg.get("render") if isinstance(cfg.get("render"), Mapping) else {}
    command = _playwright_command(render_cfg)
    command.extend([
        "screenshot",
        "--browser",
        "chromium",
        "--viewport-size",
        f"{int(width)},{int(height)}",
        "--wait-for-selector",
        ".stage[data-ready='1']",
        "--timeout",
        str(int(render_cfg.get("playwright_timeout_ms") or 120000)),
        html_path.as_uri(),
        str(output_path),
    ])
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=int(render_cfg.get("playwright_process_timeout_sec") or 180),
    )

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Playwright screenshot failed").strip()
        raise RuntimeError(detail)


def _playwright_command(render_cfg: Mapping[str, Any]) -> List[str]:
    configured = render_cfg.get("playwright_command")

    if isinstance(configured, list) and configured:
        return [str(item) for item in configured]

    npx_path = shutil.which("npx")

    if not npx_path:
        raise RuntimeError("缺少 npx，无法执行 Playwright 截图")

    return [npx_path, "--yes", "playwright"]


def _free_canvas_html(spec: Mapping[str, Any], *, width: int, height: int) -> str:
    background = _css_color(spec.get("background"), default="#f8fafc")
    body = "\n".join(_element_html(element) for element in _elements(spec))
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
* {{
    box-sizing: border-box;
}}
html,
body {{
    width: {int(width)}px;
    height: {int(height)}px;
    margin: 0;
    overflow: hidden;
    background: {background};
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
}}
.stage {{
    position: relative;
    width: {int(width)}px;
    height: {int(height)}px;
    overflow: hidden;
    background: {background};
}}
.layer {{
    position: absolute;
}}
.text-layer {{
    display: flex;
    align-items: flex-start;
    overflow: hidden;
    white-space: normal;
    word-break: break-word;
    line-height: 1.18;
}}
.image-layer {{
    overflow: hidden;
}}
.image-layer img {{
    width: 100%;
    height: 100%;
    display: block;
}}
.line-layer {{
    position: absolute;
    height: 0;
    transform-origin: 0 50%;
}}
.line-layer[data-arrow="1"]::after {{
    content: "";
    position: absolute;
    right: -1px;
    top: 50%;
    width: 0;
    height: 0;
    border-top: calc(var(--line-width) * 1.8) solid transparent;
    border-bottom: calc(var(--line-width) * 1.8) solid transparent;
    border-left: calc(var(--line-width) * 3.2) solid var(--line-color);
    transform: translateY(-50%);
}}
</style>
</head>
<body>
<main class="stage">
{body}
</main>
<script>
function fitText(node) {{
    const minSize = 12;
    let size = Number.parseFloat(node.dataset.fontSize || "24");
    node.style.fontSize = size + "px";

    while (size > minSize && (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight)) {{
        size -= 2;
        node.style.fontSize = size + "px";
    }}
}}

for (const node of document.querySelectorAll(".text-layer")) {{
    fitText(node);
}}

document.querySelector(".stage").dataset.ready = "1";
</script>
</body>
</html>
"""


def _elements(spec: Mapping[str, Any]) -> List[Mapping[str, Any]]:
    raw = spec.get("elements")

    if not isinstance(raw, list):
        raise ValueError("free_canvas spec elements 必须是数组")

    rows: List[Mapping[str, Any]] = []

    for index, item in enumerate(raw, start=1):

        if not isinstance(item, Mapping):
            raise ValueError(f"free_canvas elements[{index}] 必须是对象")

        rows.append(item)

    return rows


def _element_html(element: Mapping[str, Any]) -> str:
    element_type = str(element.get("type") or "").strip()

    if element_type == "rect":
        return _rect_html(element)

    if element_type == "circle":
        return _circle_html(element)

    if element_type == "text":
        return _text_html(element)

    if element_type == "line":
        return _line_html(element)

    if element_type == "image":
        return _image_html(element)

    raise ValueError(f"未知 free_canvas 元素类型: {element_type}")


def _rect_html(element: Mapping[str, Any]) -> str:
    x, y, w, h = _box(element)
    radius = _number(element.get("radius"), 0)
    fill = _css_optional_color(element.get("fill"))
    stroke = _css_optional_color(element.get("stroke"))
    style = [
        f"left:{x}px",
        f"top:{y}px",
        f"width:{w}px",
        f"height:{h}px",
        f"border-radius:{radius}px",
    ]

    if fill:
        style.append(f"background:{fill}")

    if stroke:
        style.append(f"border:2px solid {stroke}")

    return f'<div class="layer" style="{_style(style)}"></div>'


def _circle_html(element: Mapping[str, Any]) -> str:
    x, y, w, h = _box(element)
    fill = _css_optional_color(element.get("fill"))
    stroke = _css_optional_color(element.get("stroke"))
    style = [
        f"left:{x}px",
        f"top:{y}px",
        f"width:{w}px",
        f"height:{h}px",
        "border-radius:9999px",
    ]

    if fill:
        style.append(f"background:{fill}")

    if stroke:
        style.append(f"border:2px solid {stroke}")

    return f'<div class="layer" style="{_style(style)}"></div>'


def _text_html(element: Mapping[str, Any]) -> str:
    x = _number(element.get("x"), 0)
    y = _number(element.get("y"), 0)
    w = _number(element.get("w"), 1)
    h = _number(element.get("h"), 1)
    align = str(element.get("align") or "left").strip()
    left = _text_left(x, w, align)
    font_size = _number(element.get("font_size"), 24)
    weight = _font_weight(element.get("weight"))
    color = _css_color(element.get("color"), default="#0f172a")
    text = html.escape(str(element.get("text") or ""))
    style = [
        f"left:{left}px",
        f"top:{y}px",
        f"width:{w}px",
        f"height:{h}px",
        f"font-size:{font_size}px",
        f"font-weight:{weight}",
        f"color:{color}",
        f"text-align:{align}",
        f"justify-content:{_justify_content(align)}",
    ]
    return (
        f'<div class="layer text-layer" data-font-size="{font_size}" '
        f'style="{_style(style)}">{text}</div>'
    )


def _line_html(element: Mapping[str, Any]) -> str:
    x1 = _number(element.get("x1"), 0)
    y1 = _number(element.get("y1"), 0)
    x2 = _number(element.get("x2"), 0)
    y2 = _number(element.get("y2"), 0)
    dx = x2 - x1
    dy = y2 - y1
    length = max(1, (dx * dx + dy * dy) ** 0.5)
    angle = _atan2_degrees(dy, dx)
    line_width = max(1, _number(element.get("width"), 1))
    stroke = _css_color(element.get("stroke"), default="#0f172a")
    arrow = "1" if bool(element.get("arrow")) else "0"
    style = [
        f"left:{x1}px",
        f"top:{y1}px",
        f"width:{length}px",
        f"border-top:{line_width}px solid {stroke}",
        f"transform:rotate({angle}deg)",
        f"--line-width:{line_width}px",
        f"--line-color:{stroke}",
    ]
    return f'<div class="line-layer" data-arrow="{arrow}" style="{_style(style)}"></div>'


def _image_html(element: Mapping[str, Any]) -> str:
    x, y, w, h = _box(element)
    asset = str(element.get("resolved_asset_path") or "").strip()

    if not asset:
        raise ValueError("free_canvas image 元素缺少 image_asset.path")

    image_path = Path(asset).resolve()

    if not image_path.is_file():
        raise ValueError(f"free_canvas image 资产不存在: {image_path}")

    radius = _number(element.get("radius"), 0)
    fit = str(element.get("fit") or "cover").strip()
    object_fit = "contain" if fit == "contain" else "cover"
    src = html.escape(image_path.as_uri(), quote=True)
    style = [
        f"left:{x}px",
        f"top:{y}px",
        f"width:{w}px",
        f"height:{h}px",
        f"border-radius:{radius}px",
    ]
    return (
        f'<div class="layer image-layer" style="{_style(style)}">'
        f'<img src="{src}" style="object-fit:{object_fit};" alt="">'
        "</div>"
    )


def resolve_image_elements(spec: Mapping[str, Any]) -> dict:
    """Return a copy where image elements include concrete local asset paths."""
    row = dict(spec or {})
    asset = row.get("image_asset") if isinstance(row.get("image_asset"), Mapping) else {}
    asset_path = str(asset.get("path") or "").strip()
    elements: List[Mapping[str, Any]] = []

    for item in _elements(row):
        element = dict(item)

        if str(element.get("type") or "") == "image":
            element["resolved_asset_path"] = asset_path

        elements.append(element)

    row["elements"] = elements
    return row


def _box(element: Mapping[str, Any]) -> tuple[int, int, int, int]:
    return (
        _number(element.get("x"), 0),
        _number(element.get("y"), 0),
        _number(element.get("w"), 1),
        _number(element.get("h"), 1),
    )


def _number(value: Any, default: float) -> int:
    try:
        return int(round(float(value)))
    except Exception:
        return int(round(default))


def _style(rows: List[str]) -> str:
    return ";".join(rows)


def _css_color(value: Any, *, default: str) -> str:
    text = str(value or "").strip()

    if not text:
        return default

    return html.escape(text, quote=True)


def _css_optional_color(value: Any) -> str:
    text = str(value or "").strip()

    if not text or text.lower() in {"none", "transparent", "null"}:
        return ""

    return html.escape(text, quote=True)


def _font_weight(value: Any) -> int:
    weight = str(value or "normal").strip().lower()

    if weight in {"bold", "700", "800", "900"}:
        return 700

    if weight in {"semibold", "semi-bold", "600"}:
        return 600

    if weight in {"medium", "500"}:
        return 500

    return 400


def _text_left(x: int, width: int, align: str) -> int:
    if align == "center":
        return int(x - width / 2)

    if align == "right":
        return int(x - width)

    return x


def _justify_content(align: str) -> str:
    if align == "center":
        return "center"

    if align == "right":
        return "flex-end"

    return "flex-start"


def _atan2_degrees(y: float, x: float) -> float:
    import math

    return math.degrees(math.atan2(y, x))
