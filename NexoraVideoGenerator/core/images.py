"""Image generation stage for NexoraVideoGenerator."""

from __future__ import annotations

import base64
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Mapping

from .nexora_proxy import NexoraProxy
from .projects import project_dir


class StoryboardImageGenerator:
    """Generate and store scene images through the Nexora image PAPI."""

    def __init__(self, cfg: Mapping[str, Any]):
        self.cfg = cfg
        self.proxy = NexoraProxy(cfg)

    def generate(self, project_id: str, storyboard: Mapping[str, Any]) -> List[Dict[str, Any]]:
        scenes = storyboard.get("scenes") if isinstance(storyboard.get("scenes"), list) else []
        rows: List[Dict[str, Any]] = []

        for index, scene in enumerate(scenes, start=1):

            if not isinstance(scene, Mapping):
                continue

            scene_id = str(scene.get("id") or f"scene_{index}").strip()
            image_prompt = str(scene.get("image_prompt") or "").strip()

            if not image_prompt:
                rows.append({
                    "scene_id": scene_id,
                    "required": False,
                    "prompt": "",
                    "path": "",
                    "review_status": "not_required",
                })
                continue

            output_path = project_dir(self.cfg, project_id) / "source" / "imgs" / f"{scene_id}.png"
            response = self.proxy.generate_image(
                prompt=image_prompt,
                model=self._image_model(),
                size=self._image_size(),
                n=1,
                request_timeout=600,
            )
            image_row = self._first_image_row(response)
            self._write_image(image_row, output_path)

            rows.append({
                "scene_id": scene_id,
                "required": True,
                "prompt": image_prompt,
                "path": str(output_path),
                "review_status": "generated",
                "created_at": int(time.time()),
                "revised_prompt": str(image_row.get("revised_prompt") or "").strip(),
            })

        return rows

    def _image_size(self) -> str:
        render_cfg = self.cfg.get("render") if isinstance(self.cfg.get("render"), dict) else {}
        width = int(render_cfg.get("image_width") or 1024)
        height = int(render_cfg.get("image_height") or 1024)
        return f"{width}x{height}"

    def _image_model(self) -> str:
        nexora_cfg = self.cfg.get("nexora") if isinstance(self.cfg.get("nexora"), dict) else {}
        return str(nexora_cfg.get("image_model") or "").strip()

    def _first_image_row(self, response: Mapping[str, Any]) -> Dict[str, Any]:
        rows = response.get("data") if isinstance(response.get("data"), list) else []

        if not rows or not isinstance(rows[0], Mapping):
            raise ValueError("生图接口没有返回可用图片数据")

        return dict(rows[0])

    def _write_image(self, row: Mapping[str, Any], output_path: Path) -> None:
        b64_json = str(row.get("b64_json") or "").strip()
        image_url = str(row.get("url") or "").strip()

        output_path.parent.mkdir(parents=True, exist_ok=True)

        if b64_json:
            output_path.write_bytes(base64.b64decode(b64_json))
            return

        if image_url:
            request = urllib.request.Request(image_url, headers={"User-Agent": "NexoraVideoGenerator/1.0"})

            with urllib.request.urlopen(request, timeout=600) as response:
                output_path.write_bytes(response.read())
            return

        raise ValueError("生图接口返回数据缺少 b64_json 或 url")


def generate_storyboard_images(cfg: Mapping[str, Any], project_id: str, storyboard: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """Generate image assets for storyboard scenes and return the image manifest."""
    return StoryboardImageGenerator(cfg).generate(project_id, storyboard)
