"""HTTP routes for NexoraLearning."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from flask import Blueprint, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from core import chroma, parser, storage
from core.lectures import (
    create_book as create_lecture_book,
    create_lecture as create_learning_lecture,
    delete_book as delete_lecture_book,
    delete_lecture as delete_learning_lecture,
    get_book as get_lecture_book,
    get_lecture as get_learning_lecture,
    list_books as list_lecture_books,
    list_lectures as list_learning_lectures,
    load_book_text,
    save_book_text,
    update_book as update_lecture_book,
    update_lecture as update_learning_lecture,
)
from core.models import LearningModelFactory
from core.nexora_proxy import NexoraProxy
from core.vectorization import queue_vectorize_book, vectorize_book

bp = Blueprint("learning", __name__, url_prefix="/api")
_cfg: Dict[str, Any] = {}
_proxy: Optional[NexoraProxy] = None
_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
_FRONTEND_ASSETS_DIR = _FRONTEND_DIR / "assets"

ALLOWED_EXT = {".pdf", ".txt", ".md", ".docx", ".doc", ".c", ".h", ".py", ".rst"}


def init_routes(cfg: Dict[str, Any]) -> None:
    global _cfg, _proxy
    _cfg = cfg
    _proxy = NexoraProxy(cfg)


def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXT


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _lecture_or_404(lecture_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    lecture = get_learning_lecture(_cfg, lecture_id)
    if lecture is None:
        return None, (jsonify({"success": False, "error": "Lecture not found."}), 404)
    return lecture, None


def _book_or_404(
    lecture_id: str,
    book_id: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return None, None, error_response

    book = get_lecture_book(_cfg, lecture_id, book_id)
    if book is None:
        return lecture, None, (jsonify({"success": False, "error": "Book not found."}), 404)
    return lecture, book, None


@bp.route("/frontend/", methods=["GET"])
def frontend_index():
    return send_from_directory(str(_FRONTEND_DIR), "index.html")


@bp.route("/frontend/assets/<path:filename>", methods=["GET"])
def frontend_assets(filename: str):
    return send_from_directory(str(_FRONTEND_ASSETS_DIR), filename)


@bp.route("/completions", methods=["POST"])
def completions():
    if _proxy is None:
        return jsonify({"success": False, "error": "Nexora proxy not initialized."}), 503

    data = request.get_json(silent=True) or {}
    model_type = str(data.get("model_type") or "").strip()
    system_prompt = str(data.get("system_prompt") or "").strip()
    prompt = str(data.get("prompt") or data.get("message") or data.get("input") or "").strip()
    model = str(data.get("model") or "").strip() or None
    username = str(data.get("username") or "").strip() or None
    context_payload = data.get("context_payload") or {}
    extra_prompt_vars = data.get("extra_prompt_vars") or {}

    if not prompt:
        return jsonify({"success": False, "error": "prompt is required."}), 400

    try:
        if model_type:
            runner = LearningModelFactory.create(model_type, _cfg, model_name=model)
            safe_context_payload = context_payload if isinstance(context_payload, dict) else {}
            safe_extra_prompt_vars = extra_prompt_vars if isinstance(extra_prompt_vars, dict) else {}
            content = runner.run(
                prompt,
                context_payload=safe_context_payload,
                extra_prompt_vars=safe_extra_prompt_vars,
                username=username,
            )
            preview = runner.preview_prompts(
                prompt,
                context_payload=safe_context_payload,
                extra_prompt_vars=safe_extra_prompt_vars,
            )
            return jsonify({
                "success": True,
                "content": content,
                "model": model,
                "model_type": model_type,
                "username": username,
                "resolved_prompts": preview,
            })

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
            "model_type": model_type or None,
            "username": username,
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/courses", methods=["GET"])
def list_courses():
    courses = storage.list_courses(_cfg)
    return jsonify({"success": True, "courses": courses, "total": len(courses)})


@bp.route("/courses", methods=["POST"])
def create_course():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "name is required."}), 400

    course = storage.create_course(
        _cfg,
        name,
        str(data.get("description") or "").strip(),
    )
    return jsonify({"success": True, "course": course}), 201


@bp.route("/courses/<course_id>", methods=["GET"])
def get_course(course_id: str):
    meta = storage.get_course(_cfg, course_id)
    if not meta:
        return jsonify({"success": False, "error": "Course not found."}), 404

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
    allowed_fields = {"name", "description", "status"}
    updates = {key: value for key, value in data.items() if key in allowed_fields}
    if not updates:
        return jsonify({"success": False, "error": "No valid course fields provided."}), 400

    result = storage.update_course_meta(_cfg, course_id, updates)
    if result is None:
        return jsonify({"success": False, "error": "Course not found."}), 404
    return jsonify({"success": True, "course": result})


@bp.route("/courses/<course_id>", methods=["DELETE"])
def delete_course(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "Course not found."}), 404

    chroma.delete_course_collection(_cfg, course_id)
    storage.delete_course(_cfg, course_id)
    return jsonify({"success": True, "message": f"Course {course_id} deleted."})


@bp.route("/courses/<course_id>/materials", methods=["GET"])
def list_materials(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "Course not found."}), 404

    materials = storage.list_materials(_cfg, course_id)
    return jsonify({"success": True, "materials": materials, "total": len(materials)})


@bp.route("/courses/<course_id>/materials", methods=["POST"])
def upload_material(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "Course not found."}), 404

    if "file" not in request.files:
        return jsonify({"success": False, "error": "file is required."}), 400

    upload = request.files["file"]
    if not upload.filename:
        return jsonify({"success": False, "error": "filename is required."}), 400
    if not _allowed(upload.filename):
        return jsonify({"success": False, "error": f"Unsupported extension. Allowed: {sorted(ALLOWED_EXT)}"}), 400

    max_mb = int(_cfg.get("max_upload_mb") or 50)
    content = upload.read()
    if len(content) > max_mb * 1024 * 1024:
        return jsonify({"success": False, "error": f"file exceeds {max_mb}MB"}), 413

    safe_name = secure_filename(upload.filename)
    material = storage.create_material(_cfg, course_id, safe_name, len(content), "")

    from core.storage import _material_dir

    original_dir = _material_dir(_cfg, course_id, material["id"]) / "original"
    original_dir.mkdir(parents=True, exist_ok=True)
    saved_path = str(original_dir / safe_name)
    with open(saved_path, "wb") as output:
        output.write(content)

    storage.update_material_meta(_cfg, course_id, material["id"], {"saved_path": saved_path})
    material["saved_path"] = saved_path

    threading.Thread(
        target=_parse_and_store,
        args=(_cfg, course_id, material["id"], saved_path, safe_name),
        daemon=True,
    ).start()

    return jsonify({"success": True, "material": material}), 201


@bp.route("/courses/<course_id>/materials/<material_id>", methods=["DELETE"])
def delete_material(course_id: str, material_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "Course not found."}), 404
    if not storage.get_material(_cfg, course_id, material_id):
        return jsonify({"success": False, "error": "Material not found."}), 404

    try:
        chroma.delete_material_chunks(_cfg, course_id, material_id)
    except Exception:
        pass

    storage.delete_material(_cfg, course_id, material_id)
    return jsonify({"success": True, "message": f"Material {material_id} deleted."})


@bp.route("/courses/<course_id>/materials/<material_id>/ingest", methods=["POST"])
def ingest_material(course_id: str, material_id: str):
    material = storage.get_material(_cfg, course_id, material_id)
    if not material:
        return jsonify({"success": False, "error": "Material not found."}), 404

    chunks = storage.load_chunks(_cfg, course_id, material_id)
    if not chunks:
        return jsonify({"success": False, "error": "No parsed chunks available."}), 400

    threading.Thread(
        target=_ingest_chunks,
        args=(_cfg, course_id, material_id, chunks, material.get("filename", "")),
        daemon=True,
    ).start()

    return jsonify({
        "success": True,
        "message": "Vector ingestion started.",
        "chunks_count": len(chunks),
    })


@bp.route("/courses/<course_id>/query", methods=["GET"])
def query_course(course_id: str):
    if not storage.get_course(_cfg, course_id):
        return jsonify({"success": False, "error": "Course not found."}), 404

    query_text = str(request.args.get("q") or "").strip()
    if not query_text:
        return jsonify({"success": False, "error": "q is required."}), 400

    top_k = min(int(request.args.get("top_k") or 5), 20)
    results = chroma.query(_cfg, course_id, query_text, top_k=top_k)
    return jsonify({"success": True, "results": results, "count": len(results)})


@bp.route("/courses/<course_id>/stats", methods=["GET"])
def course_stats(course_id: str):
    meta = storage.get_course(_cfg, course_id)
    if not meta:
        return jsonify({"success": False, "error": "Course not found."}), 404

    stats = chroma.collection_stats(_cfg, course_id)
    materials = storage.list_materials(_cfg, course_id)
    return jsonify({
        "success": True,
        "course": meta,
        "materials_count": len(materials),
        "vector_stats": stats,
    })


@bp.route("/lectures", methods=["GET"])
def list_lectures():
    lectures = list_learning_lectures(_cfg)
    return jsonify({"success": True, "lectures": lectures, "total": len(lectures)})


@bp.route("/lectures", methods=["POST"])
def create_lecture():
    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return jsonify({"success": False, "error": "title is required."}), 400

    lecture = create_learning_lecture(
        _cfg,
        title,
        description=str(data.get("description") or "").strip(),
        category=str(data.get("category") or "").strip(),
        status=str(data.get("status") or "draft").strip() or "draft",
    )
    return jsonify({"success": True, "lecture": lecture}), 201


@bp.route("/lectures/<lecture_id>", methods=["GET"])
def get_lecture(lecture_id: str):
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    books = list_lecture_books(_cfg, lecture_id)
    return jsonify({
        "success": True,
        "lecture": lecture,
        "books": books,
        "total_books": len(books),
    })


@bp.route("/lectures/<lecture_id>", methods=["PATCH"])
def update_lecture(lecture_id: str):
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    allowed_fields = {"title", "description", "category", "status"}
    updates = {key: value for key, value in data.items() if key in allowed_fields}
    if not updates:
        return jsonify({"success": False, "error": "No valid lecture fields provided."}), 400

    updated = update_learning_lecture(_cfg, lecture_id, updates) or lecture
    return jsonify({"success": True, "lecture": updated})


@bp.route("/lectures/<lecture_id>", methods=["DELETE"])
def delete_lecture(lecture_id: str):
    lecture, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    delete_learning_lecture(_cfg, lecture_id)
    return jsonify({"success": True, "lecture": lecture})


@bp.route("/lectures/<lecture_id>/books", methods=["GET"])
def list_books(lecture_id: str):
    _, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    books = list_lecture_books(_cfg, lecture_id)
    return jsonify({"success": True, "books": books, "total": len(books)})


@bp.route("/lectures/<lecture_id>/books", methods=["POST"])
def create_book(lecture_id: str):
    _, error_response = _lecture_or_404(lecture_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return jsonify({"success": False, "error": "title is required."}), 400

    book = create_lecture_book(
        _cfg,
        lecture_id,
        title,
        description=str(data.get("description") or "").strip(),
        source_type=str(data.get("source_type") or "text").strip() or "text",
        cover_path=str(data.get("cover_path") or "").strip(),
    )
    return jsonify({"success": True, "book": book}), 201


@bp.route("/lectures/<lecture_id>/books/<book_id>", methods=["GET"])
def get_book(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response
    return jsonify({"success": True, "book": book})


@bp.route("/lectures/<lecture_id>/books/<book_id>", methods=["PATCH"])
def update_book(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    allowed_fields = {
        "title",
        "description",
        "source_type",
        "cover_path",
        "current_chapter",
        "next_chapter",
        "status",
    }
    updates = {key: value for key, value in data.items() if key in allowed_fields}
    if not updates:
        return jsonify({"success": False, "error": "No valid book fields provided."}), 400

    updated = update_lecture_book(_cfg, lecture_id, book_id, updates) or book
    return jsonify({"success": True, "book": updated})


@bp.route("/lectures/<lecture_id>/books/<book_id>", methods=["DELETE"])
def delete_book(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    delete_lecture_book(_cfg, lecture_id, book_id)
    return jsonify({"success": True, "book": book})


@bp.route("/lectures/<lecture_id>/books/<book_id>/text", methods=["GET"])
def get_book_text(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    content = load_book_text(_cfg, lecture_id, book_id)
    return jsonify({
        "success": True,
        "book": book,
        "content": content,
        "chars": len(content),
    })


@bp.route("/lectures/<lecture_id>/books/<book_id>/text", methods=["POST"])
def upload_book_text(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    content = str(data.get("content") or "")
    if not content.strip():
        return jsonify({"success": False, "error": "content is required."}), 400

    filename = secure_filename(str(data.get("filename") or "content.txt").strip()) or "content.txt"
    current_chapter = str(data.get("current_chapter") or "").strip()
    next_chapter = str(data.get("next_chapter") or "").strip()
    auto_vectorize = _as_bool(data.get("auto_vectorize"), default=True)

    saved = save_book_text(_cfg, lecture_id, book_id, content, filename=filename)
    if current_chapter or next_chapter:
        saved = update_lecture_book(
            _cfg,
            lecture_id,
            book_id,
            {
                "current_chapter": current_chapter,
                "next_chapter": next_chapter,
            },
        ) or saved

    vectorization_result = None
    if auto_vectorize:
        vectorization_result = queue_vectorize_book(_cfg, lecture_id, book_id, force=True)

    return jsonify({
        "success": True,
        "book": saved,
        "vectorization": vectorization_result,
    }), 201


@bp.route("/lectures/<lecture_id>/books/<book_id>/vectorize", methods=["GET"])
def get_book_vectorize_status(lecture_id: str, book_id: str):
    _, book, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    return jsonify({
        "success": True,
        "book_id": book_id,
        "vector_status": book.get("vector_status"),
        "vector_provider": book.get("vector_provider"),
        "chunks_count": book.get("chunks_count"),
        "vector_count": book.get("vector_count"),
        "request_path": book.get("vector_request_path") or "",
        "error": book.get("error") or "",
    })


@bp.route("/lectures/<lecture_id>/books/<book_id>/vectorize", methods=["POST"])
def trigger_book_vectorize(lecture_id: str, book_id: str):
    _, _, error_response = _book_or_404(lecture_id, book_id)
    if error_response is not None:
        return error_response

    data = request.get_json(silent=True) or {}
    force = _as_bool(data.get("force"), default=False)
    async_mode = _as_bool(data.get("async"), default=True)

    if async_mode:
        result = queue_vectorize_book(_cfg, lecture_id, book_id, force=force)
        return jsonify({"success": True, "vectorization": result}), 202

    result = vectorize_book(_cfg, lecture_id, book_id, force=force)
    return jsonify({"success": True, "vectorization": result})


def _parse_and_store(cfg: Dict[str, Any], course_id: str, material_id: str, file_path: str, filename: str) -> None:
    try:
        storage.update_material_meta(cfg, course_id, material_id, {"parse_status": "parsing"})
        text = parser.extract_text(file_path)
        chunks = parser.chunk_text(text)
        chunk_count = storage.save_chunks(cfg, course_id, material_id, chunks)
        storage.update_material_meta(
            cfg,
            course_id,
            material_id,
            {
                "parse_status": "done",
                "chunks_count": chunk_count,
            },
        )
        _ingest_chunks(cfg, course_id, material_id, chunks, filename)
    except Exception as exc:
        storage.update_material_meta(
            cfg,
            course_id,
            material_id,
            {
                "parse_status": "error",
                "error": str(exc),
            },
        )


def _ingest_chunks(cfg: Dict[str, Any], course_id: str, material_id: str, chunks, title: str) -> None:
    try:
        storage.update_material_meta(cfg, course_id, material_id, {"ingest_status": "ingesting"})
        vector_count = chroma.upsert_chunks(cfg, course_id, material_id, chunks, title)
        storage.update_material_meta(
            cfg,
            course_id,
            material_id,
            {
                "ingest_status": "done",
                "vector_count": vector_count,
            },
        )
        storage.update_course_meta(cfg, course_id, {"status": "ready"})
    except Exception as exc:
        storage.update_material_meta(
            cfg,
            course_id,
            material_id,
            {
                "ingest_status": "error",
                "error": str(exc),
            },
        )
