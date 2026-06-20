"""LLM planning stages for NexoraVideoGenerator."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Mapping

try:
    from NexoraVideoGenerator import prompts
except ImportError:
    import prompts

from .nexora_proxy import NexoraProxy

CANVAS_LAYOUT_TYPES = {
    "cover",
    "process",
    "comparison",
    "fact_grid",
    "timeline",
    "focus",
    "image_focus",
    "free_canvas",
}

CANVAS_PALETTES = {
    "emerald",
    "blue",
    "violet",
    "amber",
    "rose",
    "slate",
}

STORYBOARD_SCENE_COUNT_BY_DURATION = {
    "60": 8,
    "90": 12,
    "180": 24,
}


class CanvasSpecValidationError(ValueError):
    """Raised when model returned JSON but the canvas spec contract is invalid."""

    def __init__(self, message: str, spec: Mapping[str, Any]):
        super().__init__(message)
        self.spec = dict(spec or {})


def generate_outline(cfg: Mapping[str, Any], project_payload: Mapping[str, Any]) -> Dict[str, Any]:
    title = str(project_payload.get("title") or "未命名视频").strip()
    source = project_payload.get("source") if isinstance(project_payload.get("source"), dict) else {}
    text = _complete_json(
        cfg,
        system_prompt=prompts.VIDEO_OUTLINE_SYSTEM_PROMPT,
        user_prompt=_render_prompt(prompts.VIDEO_OUTLINE_USER_PROMPT, {
            "title": title,
            "context": _json_text(source.get("context")),
            "extra_prompt": _stage_extra_prompt(source, "outline"),
            "tools": _json_text(source.get("tools")),
            "tool_results": _json_text(source.get("tool_results")),
        }),
        model=_stage_model(cfg, "outline"),
    )
    return text


def generate_script(cfg: Mapping[str, Any], project_payload: Mapping[str, Any], outline: Mapping[str, Any]) -> Dict[str, Any]:
    source = project_payload.get("source") if isinstance(project_payload.get("source"), dict) else {}
    return _complete_json(
        cfg,
        system_prompt=prompts.VIDEO_SCRIPT_SYSTEM_PROMPT,
        user_prompt=_render_prompt(prompts.VIDEO_SCRIPT_USER_PROMPT, {
            "outline": _json_text(outline),
            "context": _json_text(source.get("context")),
            "extra_prompt": _stage_extra_prompt(source, "script"),
        }),
        model=_stage_model(cfg, "script"),
    )


def generate_storyboard(cfg: Mapping[str, Any], project_payload: Mapping[str, Any], script: Mapping[str, Any]) -> Dict[str, Any]:
    source = project_payload.get("source") if isinstance(project_payload.get("source"), dict) else {}
    target_scene_count = _target_storyboard_scene_count(project_payload)
    extra_prompt = _stage_extra_prompt(source, "storyboard")
    scene_count_prompt = _storyboard_scene_count_prompt(target_scene_count)

    if scene_count_prompt:
        extra_prompt = "\n".join(text for text in (extra_prompt, scene_count_prompt) if text)

    storyboard = _complete_json(
        cfg,
        system_prompt=prompts.VIDEO_STORYBOARD_SYSTEM_PROMPT,
        user_prompt=_render_prompt(prompts.VIDEO_STORYBOARD_USER_PROMPT, {
            "script": _json_text(script),
            "context": _json_text(source.get("context")),
            "extra_prompt": extra_prompt,
        }),
        model=_stage_model(cfg, "storyboard"),
    )
    scenes = storyboard.get("scenes") if isinstance(storyboard.get("scenes"), list) else []

    if not scenes:
        raise ValueError("分镜 JSON 缺少 scenes")

    _validate_storyboard_scene_count(scenes, target_scene_count)

    for index, scene in enumerate(scenes, start=1):
        if isinstance(scene, dict) and not str(scene.get("id") or "").strip():
            scene["id"] = f"scene_{index}"

    return storyboard


def generate_canvas_code(
    cfg: Mapping[str, Any],
    scene: Mapping[str, Any],
    *,
    template: Mapping[str, Any],
    visual_assets: Mapping[str, Any] = None,
    extra_prompt: str = "",
) -> Dict[str, Any]:
    data = _complete_json(
        cfg,
        system_prompt=prompts.VIDEO_CANVAS_SYSTEM_PROMPT,
        user_prompt=_render_prompt(prompts.VIDEO_CANVAS_USER_PROMPT, {
            "scene": _json_text(scene),
            "template": _json_text(template),
            "visual_assets": _json_text(visual_assets),
            "extra_prompt": str(extra_prompt or "").strip(),
        }),
        model=_stage_model(cfg, "canvas"),
    )
    try:
        return _validate_canvas_spec(data, scene)
    except Exception as exc:
        raise CanvasSpecValidationError(str(exc), data) from exc


def _complete_json(cfg: Mapping[str, Any], *, system_prompt: str, user_prompt: str, model: str) -> Dict[str, Any]:
    proxy = NexoraProxy(cfg)
    text = proxy.complete_text(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model=model,
        temperature=0.2,
        request_timeout=900,
    )
    try:
        data = json.loads(text)
    except Exception as exc:
        raise ValueError(f"模型没有返回合法 JSON: {str(exc)} | output={text[:800]}") from exc
    if not isinstance(data, dict):
        raise ValueError("模型 JSON 顶层必须是对象")
    return data


def _stage_extra_prompt(source: Mapping[str, Any], stage: str) -> str:
    extra = source.get("extra_prompts") if isinstance(source.get("extra_prompts"), dict) else {}
    return str(extra.get(stage) or extra.get("all") or "").strip()


def _stage_model(cfg: Mapping[str, Any], stage: str) -> str:
    nexora_cfg = cfg.get("nexora") if isinstance(cfg.get("nexora"), dict) else {}
    stage_models = nexora_cfg.get("stage_models") if isinstance(nexora_cfg.get("stage_models"), dict) else {}
    model = str(stage_models.get(stage) or nexora_cfg.get("default_model") or "").strip()

    if not model:
        raise ValueError(f"nexora.stage_models.{stage} 或 nexora.default_model 必须配置")

    return model


def _target_storyboard_scene_count(project_payload: Mapping[str, Any]) -> int:
    options = project_payload.get("options") if isinstance(project_payload.get("options"), Mapping) else {}
    duration = str(options.get("duration") or "").strip()

    if not duration:
        return 0

    if duration not in STORYBOARD_SCENE_COUNT_BY_DURATION:
        raise ValueError(f"不支持的视频目标时长: {duration}")

    return STORYBOARD_SCENE_COUNT_BY_DURATION[duration]


def _storyboard_scene_count_prompt(target_scene_count: int) -> str:
    if target_scene_count <= 0:
        return ""

    return (
        f"分镜页数硬性要求: scenes 必须刚好生成 {target_scene_count} 个对象。"
        f"必须从 scene_1 连续编号到 scene_{target_scene_count}，不能少页、不能多页。"
        "每个 scene 对应一页 PPT-like 视频页面。"
    )


def _validate_storyboard_scene_count(scenes: list, target_scene_count: int) -> None:
    if target_scene_count <= 0:
        return

    actual_count = len(scenes)

    if actual_count != target_scene_count:
        raise ValueError(f"分镜页数不符合目标时长要求: 需要 {target_scene_count} 页，实际 {actual_count} 页")


def _validate_canvas_spec(data: Mapping[str, Any], scene: Mapping[str, Any]) -> Dict[str, Any]:
    """Validate the structured PPT contract used by the local renderer."""
    scene_id = str(scene.get("id") or "").strip()

    if not scene_id:
        raise ValueError("分镜缺少 scene id")

    model_scene_id = str(data.get("scene_id") or "").strip()

    if model_scene_id != scene_id:
        raise ValueError(f"canvas 页面 scene_id 不匹配: {model_scene_id} != {scene_id}")

    layout_type = str(data.get("layout_type") or "").strip()

    if layout_type not in CANVAS_LAYOUT_TYPES:
        raise ValueError(f"canvas 页面 layout_type 非法: {layout_type}")

    palette = str(data.get("palette") or "").strip()

    if palette not in CANVAS_PALETTES:
        raise ValueError(f"canvas 页面 palette 非法: {palette}")

    title = _required_short_text(data, "title", max_chars=36)
    subtitle = _required_short_text(data, "subtitle", max_chars=60)

    if layout_type == "free_canvas":
        background = _required_hex_color(data, "background")
        elements = _required_canvas_elements(data)

        return {
            "scene_id": scene_id,
            "visual_grammar": str(data.get("visual_grammar") or scene.get("visual_grammar") or "").strip(),
            "layout_type": layout_type,
            "title": title,
            "subtitle": subtitle,
            "background": background,
            "palette": palette,
            "elements": elements,
            "notes": _optional_short_text(data, "notes", max_chars=500),
        }

    callout = _required_short_text(data, "callout", max_chars=48)
    key_points = _required_text_list(data, "key_points", min_count=2, max_count=5, max_chars=42)
    visual_items = _required_visual_items(data)

    return {
        "scene_id": scene_id,
        "layout_type": layout_type,
        "title": title,
        "subtitle": subtitle,
        "key_points": key_points,
        "visual_items": visual_items,
        "callout": callout,
        "palette": palette,
    }


def _optional_short_text(data: Mapping[str, Any], key: str, *, max_chars: int) -> str:
    text = str(data.get(key) or "").strip()

    if len(text) > max_chars:
        raise ValueError(f"canvas 页面 {key} 过长: {len(text)} > {max_chars}")

    return text


def _required_short_text(data: Mapping[str, Any], key: str, *, max_chars: int) -> str:
    text = str(data.get(key) or "").strip()

    if not text:
        raise ValueError(f"canvas 页面缺少 {key}")

    if len(text) > max_chars:
        raise ValueError(f"canvas 页面 {key} 过长: {len(text)} > {max_chars}")

    return text


def _required_text_list(
    data: Mapping[str, Any],
    key: str,
    *,
    min_count: int,
    max_count: int,
    max_chars: int,
) -> list:
    raw_rows = data.get(key)

    if not isinstance(raw_rows, list):
        raise ValueError(f"canvas 页面 {key} 必须是数组")

    if len(raw_rows) < min_count or len(raw_rows) > max_count:
        raise ValueError(f"canvas 页面 {key} 数量必须在 {min_count} 到 {max_count} 之间")

    rows = []

    for index, item in enumerate(raw_rows, start=1):
        text = str(item or "").strip()

        if not text:
            raise ValueError(f"canvas 页面 {key}[{index}] 为空")

        if len(text) > max_chars:
            raise ValueError(f"canvas 页面 {key}[{index}] 过长: {len(text)} > {max_chars}")

        rows.append(text)

    return rows


def _required_visual_items(data: Mapping[str, Any]) -> list:
    raw_rows = data.get("visual_items")

    if not isinstance(raw_rows, list):
        raise ValueError("canvas 页面 visual_items 必须是数组")

    if len(raw_rows) < 1 or len(raw_rows) > 5:
        raise ValueError("canvas 页面 visual_items 数量必须在 1 到 5 之间")

    rows = []

    for index, item in enumerate(raw_rows, start=1):

        if not isinstance(item, Mapping):
            raise ValueError(f"canvas 页面 visual_items[{index}] 必须是对象")

        label = str(item.get("label") or "").strip()
        detail = str(item.get("detail") or "").strip()

        if not label or not detail:
            raise ValueError(f"canvas 页面 visual_items[{index}] 缺少 label 或 detail")

        if len(label) > 30:
            raise ValueError(f"canvas 页面 visual_items[{index}].label 过长")

        if len(detail) > 80:
            raise ValueError(f"canvas 页面 visual_items[{index}].detail 过长")

        rows.append({
            "label": label,
            "detail": detail,
        })

    return rows


def _required_canvas_elements(data: Mapping[str, Any]) -> list:
    raw_rows = data.get("elements")

    if not isinstance(raw_rows, list):
        raise ValueError("free_canvas 页面 elements 必须是数组")

    if len(raw_rows) < 1 or len(raw_rows) > 48:
        raise ValueError("free_canvas 页面 elements 数量必须在 1 到 48 之间")

    rows = []

    for index, item in enumerate(raw_rows, start=1):

        if not isinstance(item, Mapping):
            raise ValueError(f"free_canvas elements[{index}] 必须是对象")

        element_type = str(item.get("type") or "").strip()

        if element_type == "text":
            rows.append(_validate_text_element(item, index))

        elif element_type in {"rect", "circle", "image"}:
            rows.append(_validate_box_element(item, index, element_type))

        elif element_type == "line":
            rows.append(_validate_line_element(item, index))

        else:
            raise ValueError(f"free_canvas elements[{index}].type 非法: {element_type}")

    return rows


def _validate_text_element(item: Mapping[str, Any], index: int) -> Dict[str, Any]:
    text = str(item.get("text") or "").strip()

    if not text:
        raise ValueError(f"free_canvas text 元素[{index}] 缺少 text")

    font_size = _number_in_range(item, "font_size", 14, 320, f"free_canvas text 元素[{index}]")
    weight = _normalize_text_weight(item, index)
    align = str(item.get("align") or "left").strip()

    if align not in {"left", "center", "right"}:
        raise ValueError(f"free_canvas text 元素[{index}].align 非法: {align}")

    row = _validate_text_box_element(item, index, align)
    row.update({
        "text": text,
        "font_size": int(font_size),
        "weight": weight,
        "color": _hex_color_value(item, "color", f"free_canvas text 元素[{index}]"),
        "align": align,
    })
    return row


def _validate_text_box_element(item: Mapping[str, Any], index: int, align: str) -> Dict[str, Any]:
    prefix = f"free_canvas text 元素[{index}]"
    row = {
        "type": "text",
        "x": int(_number_in_range(item, "x", 0, 1920, prefix)),
        "y": int(_number_in_range(item, "y", 0, 1080, prefix)),
        "w": int(_number_in_range(item, "w", 1, 1920, prefix)),
        "h": int(_number_in_range(item, "h", 1, 1080, prefix)),
    }
    left = _text_box_left(row["x"], row["w"], align)

    if left >= 1920 or left + row["w"] <= 0:
        raise ValueError(f"{prefix} 超出画布宽度")

    if row["y"] >= 1080 or row["y"] + row["h"] <= 0:
        raise ValueError(f"{prefix} 超出画布高度")

    return row


def _text_box_left(x: int, width: int, align: str) -> int:
    if align == "center":
        return int(x - width / 2)

    if align == "right":
        return int(x - width)

    return x


def _normalize_text_weight(item: Mapping[str, Any], index: int) -> str:
    raw_weight = item.get("weight")

    if raw_weight is None:
        raise ValueError(f"free_canvas text 元素[{index}] 缺少 weight")

    weight = str(raw_weight).strip().lower()

    if weight in {"regular", "normal", "400"}:
        return "normal"

    if weight in {"medium", "500"}:
        return "medium"

    if weight in {"semibold", "semi-bold", "600"}:
        return "semibold"

    if weight in {"bold", "700", "800", "900"}:
        return "bold"

    raise ValueError(f"free_canvas text 元素[{index}].weight 非法: {raw_weight}")


def _validate_box_element(item: Mapping[str, Any], index: int, element_type: str) -> Dict[str, Any]:
    prefix = f"free_canvas {element_type} 元素[{index}]"
    row = {
        "type": element_type,
        "x": int(_number_in_range(item, "x", 0, 1920, prefix)),
        "y": int(_number_in_range(item, "y", 0, 1080, prefix)),
        "w": int(_number_in_range(item, "w", 1, 1920, prefix)),
        "h": int(_number_in_range(item, "h", 1, 1080, prefix)),
    }
    row["x"] = _normalize_box_axis(row["x"], row["w"], 1920, prefix, "x")
    row["y"] = _normalize_box_axis(row["y"], row["h"], 1080, prefix, "y")

    if row["x"] + row["w"] > 1920:
        raise ValueError(f"{prefix} 超出画布宽度")

    if row["y"] + row["h"] > 1080:
        raise ValueError(f"{prefix} 超出画布高度")

    if element_type in {"rect", "circle"}:
        row["fill"] = _optional_hex_color_value(item, "fill", prefix)
        row["stroke"] = _optional_hex_color_value(item, "stroke", prefix)
        row["radius"] = int(_optional_number_in_range(item, "radius", 0, 120, prefix, default=0))

    if element_type == "image":
        asset_key = str(item.get("asset_key") or "").strip()
        fit = str(item.get("fit") or "cover").strip()

        if asset_key != "scene_image":
            raise ValueError(f"{prefix}.asset_key 非法: {asset_key}")

        if fit not in {"cover", "contain"}:
            raise ValueError(f"{prefix}.fit 非法: {fit}")

        row["asset_key"] = asset_key
        row["fit"] = fit
        row["radius"] = int(_optional_number_in_range(item, "radius", 0, 80, prefix, default=0))

    return row


def _normalize_box_axis(position: int, size: int, limit: int, prefix: str, key: str) -> int:
    if position + size <= limit:
        return position

    centered = int(position - size / 2)

    if centered >= 0 and centered + size <= limit:
        return centered

    raise ValueError(f"{prefix}.{key} 超出画布范围")


def _validate_line_element(item: Mapping[str, Any], index: int) -> Dict[str, Any]:
    prefix = f"free_canvas line 元素[{index}]"
    return {
        "type": "line",
        "x1": int(_number_in_range(item, "x1", 0, 1920, prefix)),
        "y1": int(_number_in_range(item, "y1", 0, 1080, prefix)),
        "x2": int(_number_in_range(item, "x2", 0, 1920, prefix)),
        "y2": int(_number_in_range(item, "y2", 0, 1080, prefix)),
        "stroke": _hex_color_value(item, "stroke", prefix),
        "width": int(_number_in_range(item, "width", 1, 24, prefix)),
        "arrow": bool(item.get("arrow", False)),
    }


def _required_hex_color(data: Mapping[str, Any], key: str) -> str:
    return _hex_color_value(data, key, "free_canvas 页面")


def _hex_color_value(data: Mapping[str, Any], key: str, prefix: str) -> str:
    value = str(data.get(key) or "").strip()

    if not _is_hex_color(value):
        raise ValueError(f"{prefix}.{key} 必须是 #RRGGBB 颜色")

    return value


def _optional_hex_color_value(data: Mapping[str, Any], key: str, prefix: str) -> str:
    value = str(data.get(key) or "").strip()

    if not value or value.lower() in {"none", "transparent", "null"}:
        return ""

    if not _is_hex_color(value) and not _is_css_rgb_color(value):
        raise ValueError(f"{prefix}.{key} 必须是 #RRGGBB、rgb(...) 或 rgba(...) 颜色")

    return value


def _is_hex_color(value: str) -> bool:
    if len(value) != 7 or not value.startswith("#"):
        return False

    return all(ch in "0123456789abcdefABCDEF" for ch in value[1:])


def _is_css_rgb_color(value: str) -> bool:
    text = str(value or "").strip()
    match = re.fullmatch(
        r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)",
        text,
        flags=re.IGNORECASE,
    )

    if not match:
        return False

    channels = [int(match.group(index)) for index in (1, 2, 3)]

    return all(0 <= channel <= 255 for channel in channels)


def _number_in_range(data: Mapping[str, Any], key: str, minimum: float, maximum: float, prefix: str) -> float:
    try:
        number = float(data.get(key))
    except Exception as exc:
        raise ValueError(f"{prefix}.{key} 必须是数字") from exc

    if number < minimum or number > maximum:
        raise ValueError(f"{prefix}.{key} 超出范围: {number}")

    return number


def _optional_number_in_range(
    data: Mapping[str, Any],
    key: str,
    minimum: float,
    maximum: float,
    prefix: str,
    *,
    default: float,
) -> float:
    if key not in data or data.get(key) is None or str(data.get(key)).strip() == "":
        return default

    return _number_in_range(data, key, minimum, maximum, prefix)


def _render_prompt(template: str, values: Mapping[str, str]) -> str:
    text = str(template or "")

    for key, value in values.items():
        text = text.replace("{" + str(key) + "}", str(value))

    return text


def _json_text(value: Any) -> str:
    try:
        return json.dumps(value if value is not None else {}, ensure_ascii=False, indent=2)
    except Exception:
        return str(value or "")
