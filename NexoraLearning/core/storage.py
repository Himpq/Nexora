"""
NexoraLearning — 课程与教材存储层

目录结构:
  data/
  └── courses/
      └── {course_id}/
          ├── meta.json          课程元数据
          └── materials/
              └── {material_id}/
                  ├── meta.json  教材元数据
                  ├── original/  原始上传文件
                  └── chunks.jsonl  解析后的文本切片
"""

from __future__ import annotations

import json
import time
import uuid
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

_lock = threading.RLock()


# ──────────────────────────────────────────────
#  路径工具
# ──────────────────────────────────────────────

def _data_root(cfg: Dict[str, Any]) -> Path:
    return Path(cfg.get("data_dir") or "data") / "courses"


def _course_dir(cfg: Dict[str, Any], course_id: str) -> Path:
    return _data_root(cfg) / course_id


def _material_dir(cfg: Dict[str, Any], course_id: str, material_id: str) -> Path:
    return _course_dir(cfg, course_id) / "materials" / material_id


# ──────────────────────────────────────────────
#  课程 CRUD
# ──────────────────────────────────────────────

def list_courses(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    root = _data_root(cfg)
    if not root.exists():
        return []
    courses = []
    for d in sorted(root.iterdir()):
        meta_path = d / "meta.json"
        if d.is_dir() and meta_path.exists():
            try:
                courses.append(json.loads(meta_path.read_text(encoding="utf-8")))
            except Exception:
                pass
    return courses


def get_course(cfg: Dict[str, Any], course_id: str) -> Optional[Dict[str, Any]]:
    p = _course_dir(cfg, course_id) / "meta.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def create_course(cfg: Dict[str, Any], name: str, description: str = "") -> Dict[str, Any]:
    course_id = f"c_{uuid.uuid4().hex[:12]}"
    d = _course_dir(cfg, course_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "materials").mkdir(exist_ok=True)
    meta = {
        "id": course_id,
        "name": name.strip(),
        "description": description.strip(),
        "created_at": int(time.time()),
        "material_count": 0,
        "vector_count": 0,
        "status": "empty",          # empty | ready
    }
    _write_json(d / "meta.json", meta)
    return meta


def update_course_meta(cfg: Dict[str, Any], course_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    meta = get_course(cfg, course_id)
    if meta is None:
        return None
    meta.update(updates)
    _write_json(_course_dir(cfg, course_id) / "meta.json", meta)
    return meta


def delete_course(cfg: Dict[str, Any], course_id: str) -> bool:
    """删除课程目录（物理删除所有文件）。"""
    import shutil
    d = _course_dir(cfg, course_id)
    if not d.exists():
        return False
    shutil.rmtree(str(d))
    return True


# ──────────────────────────────────────────────
#  教材 CRUD
# ──────────────────────────────────────────────

def list_materials(cfg: Dict[str, Any], course_id: str) -> List[Dict[str, Any]]:
    mat_root = _course_dir(cfg, course_id) / "materials"
    if not mat_root.exists():
        return []
    materials = []
    for d in sorted(mat_root.iterdir()):
        meta_path = d / "meta.json"
        if d.is_dir() and meta_path.exists():
            try:
                materials.append(json.loads(meta_path.read_text(encoding="utf-8")))
            except Exception:
                pass
    return materials


def get_material(cfg: Dict[str, Any], course_id: str, material_id: str) -> Optional[Dict[str, Any]]:
    p = _material_dir(cfg, course_id, material_id) / "meta.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def create_material(
    cfg: Dict[str, Any],
    course_id: str,
    filename: str,
    size_bytes: int,
    saved_path: str,
) -> Dict[str, Any]:
    material_id = f"m_{uuid.uuid4().hex[:12]}"
    d = _material_dir(cfg, course_id, material_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "original").mkdir(exist_ok=True)

    meta = {
        "id": material_id,
        "course_id": course_id,
        "filename": filename,
        "size_bytes": size_bytes,
        "saved_path": saved_path,
        "uploaded_at": int(time.time()),
        "parse_status": "pending",   # pending | parsing | done | error
        "ingest_status": "pending",  # pending | ingesting | done | error
        "chunks_count": 0,
        "vector_count": 0,
        "error": None,
    }
    _write_json(d / "meta.json", meta)

    # 更新课程 material_count
    _increment_course_field(cfg, course_id, "material_count", 1)
    return meta


def update_material_meta(
    cfg: Dict[str, Any], course_id: str, material_id: str, updates: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    meta = get_material(cfg, course_id, material_id)
    if meta is None:
        return None
    meta.update(updates)
    _write_json(_material_dir(cfg, course_id, material_id) / "meta.json", meta)
    return meta


def delete_material(cfg: Dict[str, Any], course_id: str, material_id: str) -> bool:
    """物理删除教材目录（chunks + original file）。"""
    import shutil
    d = _material_dir(cfg, course_id, material_id)
    if not d.exists():
        return False
    shutil.rmtree(str(d))
    _increment_course_field(cfg, course_id, "material_count", -1)
    return True


def save_chunks(cfg: Dict[str, Any], course_id: str, material_id: str, chunks: List[str]) -> int:
    """将切片以 JSONL 格式写入 chunks.jsonl。返回写入数量。"""
    d = _material_dir(cfg, course_id, material_id)
    chunks_path = d / "chunks.jsonl"
    with open(str(chunks_path), "w", encoding="utf-8") as f:
        for i, chunk in enumerate(chunks):
            f.write(json.dumps({"index": i, "text": chunk}, ensure_ascii=False) + "\n")
    return len(chunks)


def load_chunks(cfg: Dict[str, Any], course_id: str, material_id: str) -> List[str]:
    """从 chunks.jsonl 读取切片列表。"""
    p = _material_dir(cfg, course_id, material_id) / "chunks.jsonl"
    if not p.exists():
        return []
    chunks = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                chunks.append(json.loads(line)["text"])
            except Exception:
                pass
    return chunks


# ──────────────────────────────────────────────
#  内部工具
# ──────────────────────────────────────────────

def _write_json(path: Path, data: Any) -> None:
    with _lock:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _increment_course_field(cfg: Dict[str, Any], course_id: str, field: str, delta: int) -> None:
    with _lock:
        meta = get_course(cfg, course_id)
        if meta:
            meta[field] = max(0, int(meta.get(field) or 0) + delta)
            _write_json(_course_dir(cfg, course_id) / "meta.json", meta)
