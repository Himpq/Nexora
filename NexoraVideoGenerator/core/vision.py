"""Vision description stage for generated images."""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import time
from pathlib import Path
from typing import Any, Dict, List, Mapping

from .nexora_proxy import NexoraProxy
from .projects import project_dir, write_json

VISION_SYSTEM_PROMPT = """
你是 NexoraVideoGenerator 的图片描述与分镜对齐审核 Agent。
你只根据传入图片和分镜信息判断，不引用外部知识。
只输出 JSON 对象，不要输出 Markdown，不要解释过程。
""".strip()

VISION_USER_PROMPT = """
请分析这张生成图片，并与分镜目标进行对齐检查。

分镜 JSON:
{scene}

输出格式:
{
    "description": "客观描述图片里出现的主体、文字、布局、颜色和视觉关系",
    "alignment_notes": "说明图片是否符合分镜 visual_goal / canvas_brief / image_prompt",
    "usable": true,
    "issues": ["如无问题则为空数组"]
}
""".strip()


class ImageDescriptionAgent:
    """Describe generated images and store provider results per scene."""

    def __init__(self, cfg: Mapping[str, Any]):
        self.cfg = cfg
        self.proxy = NexoraProxy(cfg)
        self.vision_model = self._vision_model()

    def describe_project_images(
        self,
        project_id: str,
        storyboard: Mapping[str, Any],
        images: List[Mapping[str, Any]],
    ) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        output_path = project_dir(self.cfg, project_id) / "source" / "image_descriptions.json"
        image_by_scene = {str(item.get("scene_id") or ""): item for item in images if isinstance(item, Mapping)}
        scenes = storyboard.get("scenes") if isinstance(storyboard.get("scenes"), list) else []

        for index, scene in enumerate(scenes, start=1):

            if not isinstance(scene, Mapping):
                continue

            scene_id = str(scene.get("id") or f"scene_{index}").strip()
            image_row = image_by_scene.get(scene_id) or {}
            image_path = str(image_row.get("path") or "").strip()

            if not image_path:
                rows.append(self._not_required_row(scene_id))
                self._save_rows(output_path, rows)
                continue

            try:
                row = self._describe_one(scene_id, scene, Path(image_path))
            except Exception as exc:
                row = self._failed_row(scene_id, image_path, str(exc))
                rows.append(row)
                self._save_rows(output_path, rows)
                raise RuntimeError(f"{scene_id} 图片描述失败: {exc}") from exc

            rows.append(row)
            self._save_rows(output_path, rows)

        return rows

    def _describe_one(self, scene_id: str, scene: Mapping[str, Any], image_path: Path) -> Dict[str, Any]:
        if not image_path.exists():
            raise ValueError(f"图片文件不存在: {image_path}")

        raw = image_path.read_bytes()
        response = self.proxy.analyze_image(
            model=self.vision_model,
            system_prompt=VISION_SYSTEM_PROMPT,
            prompt=_render_prompt(VISION_USER_PROMPT, {
                "scene": json.dumps(dict(scene), ensure_ascii=False, indent=2),
            }),
            image_b64=base64.b64encode(raw).decode("ascii"),
            image_mime=_guess_mime(image_path),
            request_timeout=900,
        )
        text = str(response.get("text") or "").strip()
        parsed = _parse_json_object(text)

        return {
            "scene_id": scene_id,
            "image_path": str(image_path),
            "image_sha256": hashlib.sha256(raw).hexdigest(),
            "model": self.vision_model,
            "provider": str(response.get("provider") or "").strip(),
            "status": "done",
            "description": str(parsed.get("description") or "").strip(),
            "alignment_notes": str(parsed.get("alignment_notes") or "").strip(),
            "usable": bool(parsed.get("usable")),
            "issues": parsed.get("issues") if isinstance(parsed.get("issues"), list) else [],
            "provider_error": "",
            "created_at": int(time.time()),
        }

    def _vision_model(self) -> str:
        nexora_cfg = self.cfg.get("nexora") if isinstance(self.cfg.get("nexora"), dict) else {}
        model = str(nexora_cfg.get("vision_model") or "").strip()

        if not model:
            raise ValueError("nexora.vision_model 未配置")

        return model

    def _not_required_row(self, scene_id: str) -> Dict[str, Any]:
        return {
            "scene_id": scene_id,
            "image_path": "",
            "image_sha256": "",
            "model": self.vision_model,
            "provider": "",
            "status": "not_required",
            "description": "",
            "alignment_notes": "该分镜没有生成图片资源。",
            "usable": True,
            "issues": [],
            "provider_error": "",
            "created_at": int(time.time()),
        }

    def _failed_row(self, scene_id: str, image_path: str, error: str) -> Dict[str, Any]:
        return {
            "scene_id": scene_id,
            "image_path": image_path,
            "image_sha256": "",
            "model": self.vision_model,
            "provider": "",
            "status": "failed",
            "description": "",
            "alignment_notes": "",
            "usable": False,
            "issues": [],
            "provider_error": str(error or "").strip(),
            "created_at": int(time.time()),
        }

    def _save_rows(self, output_path: Path, rows: List[Dict[str, Any]]) -> None:
        write_json(output_path, rows)


def describe_project_images(
    cfg: Mapping[str, Any],
    project_id: str,
    storyboard: Mapping[str, Any],
    images: List[Mapping[str, Any]],
) -> List[Dict[str, Any]]:
    """Run image description for generated storyboard images."""
    return ImageDescriptionAgent(cfg).describe_project_images(project_id, storyboard, images)


def _render_prompt(template: str, values: Mapping[str, str]) -> str:
    text = str(template or "")

    for key, value in values.items():
        text = text.replace("{" + str(key) + "}", str(value))

    return text


def _guess_mime(path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    return str(mime or "image/png")


def _parse_json_object(text: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(text)
    except Exception as exc:
        raise ValueError(f"视觉模型没有返回合法 JSON: {exc} | output={text[:800]}") from exc

    if not isinstance(parsed, dict):
        raise ValueError("视觉模型 JSON 顶层必须是对象")

    return parsed
