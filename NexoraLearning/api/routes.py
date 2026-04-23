"""
NexoraLearning — Flask 路由蓝图
API 设计（类 NexoraMail 风格）：

  课程管理:
    GET    /api/courses                      列出所有课程
    POST   /api/courses                      新建课程
    GET    /api/courses/<course_id>          获取课程详情 + 教材列表
    PATCH  /api/courses/<course_id>          修改课程名/描述
    DELETE /api/courses/<course_id>          删除课程（含所有教材和向量）

  教材管理:
    GET    /api/courses/<course_id>/materials          列出教材
    POST   /api/courses/<course_id>/materials          上传新教材（multipart/form-data）
    DELETE /api/courses/<course_id>/materials/<mid>    删除教材

  RAG:
    POST   /api/courses/<course_id>/materials/<mid>/ingest   触发解析+向量化（后台）
    GET    /api/courses/<course_id>/query                    检索（?q=...&top_k=5）
    GET    /api/courses/<course_id>/stats                    向量库统计
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Dict

from flask import Blueprint, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from core import storage, parser, chroma
from core.nexora_proxy import NexoraProxy

bp = Blueprint("learning", __name__, url_prefix="/api")
_cfg: Dict[str, Any] = {}
_proxy: NexoraProxy = None
_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
_FRONTEND_ASSETS_DIR = _FRONTEND_DIR / "assets"

ALLOWED_EXT = {".pdf", ".txt", ".md", ".docx", ".c", ".h"}


def init_routes(cfg: Dict[str, Any]) -> None:
    global _cfg, _proxy
    _cfg = cfg
    _proxy = NexoraProxy(cfg)


def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXT


@bp.route("/frontend/", methods=["GET"])
def frontend_index():
    """嵌入式学习面板入口页面。"""
    return send_from_directory(str(_FRONTEND_DIR), "index.html")


@bp.route("/frontend/assets/<path:filename>", methods=["GET"])
def frontend_assets(filename: str):
    """学习面板静态资源。"""
    return send_from_directory(str(_FRONTEND_ASSETS_DIR), filename)


@bp.route("/completions", methods=["POST"])
def completions():
    """调用 ChatDBServer 的 /api/papi/completions。"""
    if _proxy is None:
        return jsonify({"success": False, "error": "Nexora proxy 未初始化"}), 503

    data = request.get_json(silent=True) or {}
    system_prompt = str(data.get("system_prompt") or "").strip()
    prompt = str(data.get("prompt") or data.get("message") or data.get("input") or "").strip()
    model = str(data.get("model") or "").strip() or None
    username = str(data.get("username") or "").strip() or None

    if not prompt:
        return jsonify({"success": False, "error": "prompt 不能为空"}), 400

    try:
        content = _proxy.chat_complete(
            system_prompt=system_prompt,
            user_prompt=prompt,
            model=model,
            username=username,
        )
        return jsonify({
            "success": True,
            "content": content,
            "model": model,
            "username": username,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ══════════════════════════════════════════════
#  课程管理
# ══════════════════════════════════════════════

@bp.route("/courses", methods=["GET"])
def list_courses():
    courses = storage.list_courses(_cfg)
    return jsonify({"success": True, "courses": courses, "total": len(courses)})


@bp.route("/courses", methods=["POST"])
def create_course():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "课程名称不能为空"}), 400
    desc = str(data.get("description") or "").strip()
    course = storage.create_course(_cfg, name, desc)
    return jsonify({"success": True, "course": course}), 201


@bp.route("/courses/<course_id>", methods=["GET"])
def get_course(course_id: str):
    meta = storage.get_course(_cfg, course_id)
    if not meta:
        return jsonify({"success": False, "error": "课程不存在"}), 404
    materials = storage.list_materials(_cfg, course_id)
    stats = chroma.collection_stats(_cfg, course_id)
    return jsonify({
        "success": True,
        "course": meta,
        "materials": materials,
        "vector_stats": stats,
    })


@bp.route("/courses/<course_id>", methods=["PATCH"])
def update_course(course_id: str):
    data = request.get_json(silent=True) or {}
    allowed_fields = {"name", "description"}
    updates = {k: v for k, v in data.items() if k in allowed_fields}
    if not updates:
        return jsonify({"success": False, "error": "没有合法的更新字段"}), 400
    result = storage.update_course_meta(_cfg, course_id, updates)
    if result is None:
        return jsonify({"success": False, "error": "课程不存在"}), 404
    return jsonify({"success": True, "course": result})


@bp.route("/courses/<course_id>", methods=["DELETE"])
def delete_course(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "课程不存在"}), 404
    # 同时删除 ChromaDB collection
    chroma.delete_course_collection(_cfg, course_id)
    storage.delete_course(_cfg, course_id)
    return jsonify({"success": True, "message": f"课程 {course_id} 及所有教材已删除"})


# ══════════════════════════════════════════════
#  教材管理
# ══════════════════════════════════════════════

@bp.route("/courses/<course_id>/materials", methods=["GET"])
def list_materials(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "课程不存在"}), 404
    materials = storage.list_materials(_cfg, course_id)
    return jsonify({"success": True, "materials": materials, "total": len(materials)})


@bp.route("/courses/<course_id>/materials", methods=["POST"])
def upload_material(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "课程不存在"}), 404

    if "file" not in request.files:
        return jsonify({"success": False, "error": "缺少 file 字段"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"success": False, "error": "文件名为空"}), 400
    if not _allowed(f.filename):
        return jsonify({"success": False, "error": f"不支持的文件类型，允许：{ALLOWED_EXT}"}), 400

    max_mb = int(_cfg.get("max_upload_mb") or 50)
    content = f.read()
    if len(content) > max_mb * 1024 * 1024:
        return jsonify({"success": False, "error": f"文件超过 {max_mb}MB 限制"}), 413

    # 创建教材记录（先占位）
    safe_name = secure_filename(f.filename)
    material = storage.create_material(_cfg, course_id, safe_name, len(content), "")

    # 保存原始文件
    from core.storage import _material_dir
    orig_dir = _material_dir(_cfg, course_id, material["id"]) / "original"
    orig_dir.mkdir(parents=True, exist_ok=True)
    saved_path = str(orig_dir / safe_name)
    with open(saved_path, "wb") as out:
        out.write(content)

    storage.update_material_meta(_cfg, course_id, material["id"], {"saved_path": saved_path})
    material["saved_path"] = saved_path

    # 自动触发后台解析（不等待结果）
    threading.Thread(
        target=_parse_and_store,
        args=(_cfg, course_id, material["id"], saved_path, safe_name),
        daemon=True,
    ).start()

    return jsonify({"success": True, "material": material}), 201


@bp.route("/courses/<course_id>/materials/<material_id>", methods=["DELETE"])
def delete_material(course_id: str, material_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "课程不存在"}), 404
    if not storage.get_material(_cfg, course_id, material_id):
        return jsonify({"success": False, "error": "教材不存在"}), 404

    # 删除向量
    try:
        chroma.delete_material_chunks(_cfg, course_id, material_id)
    except Exception:
        pass
    # 删除文件
    storage.delete_material(_cfg, course_id, material_id)
    return jsonify({"success": True, "message": f"教材 {material_id} 已删除"})


# ══════════════════════════════════════════════
#  RAG — 向量化 & 查询
# ══════════════════════════════════════════════

@bp.route("/courses/<course_id>/materials/<material_id>/ingest", methods=["POST"])
def ingest_material(course_id: str, material_id: str):
    """手动触发向量化（解析已完成时重新向量化用）。"""
    mat = storage.get_material(_cfg, course_id, material_id)
    if not mat:
        return jsonify({"success": False, "error": "教材不存在"}), 404

    chunks = storage.load_chunks(_cfg, course_id, material_id)
    if not chunks:
        return jsonify({"success": False, "error": "尚无切片，请等待解析完成"}), 400

    threading.Thread(
        target=_ingest_chunks,
        args=(_cfg, course_id, material_id, chunks, mat.get("filename", "")),
        daemon=True,
    ).start()

    return jsonify({"success": True, "message": "向量化任务已启动", "chunks_count": len(chunks)})


@bp.route("/courses/<course_id>/query", methods=["GET"])
def query_course(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "课程不存在"}), 404

    q = str(request.args.get("q") or "").strip()
    if not q:
        return jsonify({"success": False, "error": "缺少查询词 q"}), 400
    top_k = min(int(request.args.get("top_k") or 5), 20)

    results = chroma.query(_cfg, course_id, q, top_k=top_k)
    return jsonify({"success": True, "results": results, "count": len(results)})


@bp.route("/courses/<course_id>/stats", methods=["GET"])
def course_stats(course_id: str):
    meta = storage.get_course(_cfg, course_id)
    if not meta:
        return jsonify({"success": False, "error": "课程不存在"}), 404
    stats = chroma.collection_stats(_cfg, course_id)
    materials = storage.list_materials(_cfg, course_id)
    return jsonify({
        "success": True,
        "course": meta,
        "materials_count": len(materials),
        "vector_stats": stats,
    })


# ══════════════════════════════════════════════
#  后台任务
# ══════════════════════════════════════════════

def _parse_and_store(cfg, course_id: str, material_id: str, file_path: str, filename: str):
    """解析文件 → 切片 → 存 JSONL → 自动触发向量化。"""
    try:
        storage.update_material_meta(cfg, course_id, material_id, {"parse_status": "parsing"})
        text = parser.extract_text(file_path)
        chunks = parser.chunk_text(text)
        n = storage.save_chunks(cfg, course_id, material_id, chunks)
        storage.update_material_meta(cfg, course_id, material_id, {
            "parse_status": "done",
            "chunks_count": n,
        })
        # 立即触发向量化
        _ingest_chunks(cfg, course_id, material_id, chunks, filename)
    except Exception as e:
        storage.update_material_meta(cfg, course_id, material_id, {
            "parse_status": "error",
            "error": str(e),
        })


def _ingest_chunks(cfg, course_id: str, material_id: str, chunks, title: str):
    """将切片写入 ChromaDB，更新状态。"""
    try:
        storage.update_material_meta(cfg, course_id, material_id, {"ingest_status": "ingesting"})
        n = chroma.upsert_chunks(cfg, course_id, material_id, chunks, title)
        storage.update_material_meta(cfg, course_id, material_id, {
            "ingest_status": "done",
            "vector_count": n,
        })
        # 更新课程状态
        storage.update_course_meta(cfg, course_id, {"status": "ready"})
    except Exception as e:
        storage.update_material_meta(cfg, course_id, material_id, {
            "ingest_status": "error",
            "error": str(e),
        })
