"""Remotion export preparation provider."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Dict, Mapping

from ..projects import project_dir


def write_remotion_props(cfg: Mapping[str, Any], project_id: str, payload: Mapping[str, Any]) -> Path:
    path = project_dir(cfg, project_id) / "exports" / "remotion_props.json"
    path.write_text(json.dumps(dict(payload or {}), ensure_ascii=False, indent=4), encoding="utf-8")
    return path


def render_with_remotion(cfg: Mapping[str, Any], project_id: str, props_path: Path, output_path: Path) -> Dict[str, Any]:
    render_cfg = cfg.get("render") if isinstance(cfg.get("render"), dict) else {}
    entry = str(render_cfg.get("remotion_entry") or "").strip()
    composition = str(render_cfg.get("remotion_composition") or "NexoraVideo").strip()
    command_prefix = render_cfg.get("remotion_command")
    if isinstance(command_prefix, list) and command_prefix:
        command = [str(item) for item in command_prefix]
    else:
        command = ["npx", "remotion", "render"]

    if not entry:
        raise ValueError("render.remotion_entry 未配置，无法调用 Remotion")

    command.extend([
        entry,
        composition,
        str(output_path),
        "--props",
        str(props_path),
    ])
    result = subprocess.run(command, capture_output=True, text=True, timeout=1800)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "Remotion render failed").strip())
    return {"path": str(output_path), "renderer": "remotion", "stdout": result.stdout[-4000:]}

