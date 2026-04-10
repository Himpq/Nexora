import os
import json
import hashlib
import secrets
from typing import Any, Dict, Optional, List

#os.environ['HTTP_PROXY'] = 'http://localhost:15555'
#os.environ['HTTPS_PROXY'] = 'http://localhost:15555'

from flask import Flask, request, jsonify, render_template, session, redirect, url_for, g
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer

APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(APP_DIR, "config.json")
START_TIME = None


def load_config() -> Dict[str, Any]:
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "api_key": "nexoradb-123456",
        "host": "0.0.0.0",
        "port": 8100,
        "data_path": "./chroma_data",
        "collection_prefix": "knowledge",
        "distance": "cosine",
        "embedding": {
            "type": "sentence-transformers",
            "model": "BAAI/bge-small-zh-v1.5",
            "device": "cpu",
            "normalize": True
        }
    }


CONFIG = load_config()
app = Flask(__name__)
app.secret_key = CONFIG.get("admin", {}).get("secret_key") or "nexoradb-secret-key"
_EMBEDDER: Optional[SentenceTransformer] = None
if START_TIME is None:
    import time
    START_TIME = time.time()


def get_embedder() -> SentenceTransformer:
    global _EMBEDDER
    if _EMBEDDER is None:
        emb_cfg = CONFIG.get("embedding", {}) or {}
        model_name = emb_cfg.get("model") or "BAAI/bge-small-zh-v1.5"
        device = emb_cfg.get("device") or "cpu"
        cache_dir = emb_cfg.get("cache_dir")
        offline = bool(emb_cfg.get("offline", False))
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)
            os.environ.setdefault("HF_HOME", cache_dir)
            os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", cache_dir)
        if offline:
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        _EMBEDDER = SentenceTransformer(
            model_name,
            device=device,
            cache_folder=cache_dir,
            local_files_only=offline
        )
    return _EMBEDDER


def embed_texts(texts: List[str], batch_size: Optional[int] = None) -> List[List[float]]:
    emb_cfg = CONFIG.get("embedding", {}) or {}
    normalize = emb_cfg.get("normalize", True)
    bs = batch_size if batch_size is not None else emb_cfg.get("batch_size", 64)
    try:
        bs = max(1, int(bs))
    except Exception:
        bs = 64
    model = get_embedder()
    vectors = model.encode(texts, normalize_embeddings=normalize, batch_size=bs)
    return [v.tolist() for v in vectors]


def require_api_key():
    auth_key = request.headers.get("X-API-Key") or request.args.get("api_key")
    projects = CONFIG.get("projects") or {}
    if projects:
        for name, proj in projects.items():
            if proj.get("api_key") == auth_key:
                g.project = {"name": name, **proj}
                return True
        return False
    api_key = CONFIG.get("api_key")
    if not api_key:
        return True
    if auth_key == api_key:
        g.project = {"name": "default", "data_path": CONFIG.get("data_path")}
        return True
    return False


def _normalize_library(library: Optional[str], default: str = "knowledge") -> str:
    value = str(library or default).strip()
    return value or default


def _build_where_with_library(
    where: Optional[Dict[str, Any]],
    library: Optional[str]
) -> Optional[Dict[str, Any]]:
    base = dict(where) if isinstance(where, dict) else {}
    lib = _normalize_library(library, default="")

    # If caller already passed operator-style where (e.g. {"$and":[...]}),
    # append library via $and wrapper to keep "single operator at top-level".
    has_operator = any(str(k).startswith("$") for k in base.keys())
    if has_operator:
        if not lib:
            return base or None
        return {"$and": [base, {"library": lib}]}

    if lib:
        base.setdefault("library", lib)
    if not base:
        return None

    # Chroma where requires a single top-level operator or a single field.
    # Convert flat multi-field dict into {$and: [{k:v}, ...]}.
    if len(base) == 1:
        return base
    return {"$and": [{k: v} for k, v in base.items()]}


def safe_id(
    username: str,
    title: Optional[str],
    chunk_id: Optional[int] = None,
    library: Optional[str] = None
) -> str:
    suffix = f":{chunk_id}" if chunk_id is not None else ""
    lib = _normalize_library(library)
    base = f"{username}:{lib}:{title or ''}{suffix}"
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()
    return f"{username}:{digest}"

def save_config():
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(CONFIG, f, indent=4, ensure_ascii=False)

def _resolve_data_path(path_value: Optional[str]) -> str:
    if not path_value:
        return os.path.join(APP_DIR, "chroma_data")
    if os.path.isabs(path_value):
        return path_value
    return os.path.normpath(os.path.join(APP_DIR, path_value))

def _folder_size_bytes(path_value: str) -> int:
    total = 0
    if not os.path.exists(path_value):
        return 0
    for root, _dirs, files in os.walk(path_value):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                continue
    return total

def _format_bytes(num: int) -> str:
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if num < 1024:
            return f"{num:.0f} {unit}" if unit == "B" else f"{num:.2f} {unit}"
        num /= 1024
    return f"{num:.2f} PB"

def get_project_config() -> Dict[str, Any]:
    proj = getattr(g, "project", None)
    if proj:
        return proj
    return {
        "name": "default",
        "data_path": CONFIG.get("data_path"),
        "collection_prefix": CONFIG.get("collection_prefix"),
        "distance": CONFIG.get("distance")
    }

def get_client():
    proj = get_project_config()
    data_path = proj.get("data_path") or "./chroma_data"
    try:
        return chromadb.PersistentClient(
            path=data_path,
            settings=Settings(anonymized_telemetry=False)
        )
    except Exception as e:
        # Retry with explicit tenant/database to avoid default_tenant issues
        print(f"[WARN] PersistentClient failed, retry with tenant/database: {e}")
        return chromadb.PersistentClient(
            path=data_path,
            settings=Settings(anonymized_telemetry=False),
            tenant="default_tenant",
            database="default_database"
        )


def get_collection(username: str):
    proj = get_project_config()
    prefix = proj.get("collection_prefix") or CONFIG.get("collection_prefix") or "knowledge"
    distance = proj.get("distance") or CONFIG.get("distance") or "cosine"
    name = f"{prefix}_{username}"
    client = get_client()
    return client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": distance}
    )


@app.before_request
def _auth():
    if request.path in ["/health", "/"] or request.path.startswith("/admin"):
        return None
    if not require_api_key():
        return jsonify({"success": False, "message": "Invalid or missing API key"}), 401
    return None


@app.route("/", methods=["GET"])
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"success": True, "service": "NexoraDB"})

@app.route("/stats", methods=["GET"])
def stats():
    client = get_client()
    cols = client.list_collections()
    items = []
    total = 0
    for col in cols:
        try:
            count = col.count()
        except Exception:
            count = 0
        items.append({"name": col.name, "count": count})
        total += count
    return jsonify({"success": True, "collections": items, "total_vectors": total})

# ---------------- Admin UI ----------------
def is_admin():
    return bool(session.get("admin_user"))

@app.route("/admin", methods=["GET"])
def admin_index():
    if not is_admin():
        return redirect(url_for("admin_login"))
    return render_template("admin.html")

@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "GET":
        return render_template("admin_login.html")
    data = request.get_json() or {}
    username = data.get("username")
    password = data.get("password")
    admins = CONFIG.get("admin", {}).get("users") or [{"username": CONFIG.get("admin", {}).get("username"), "password": CONFIG.get("admin", {}).get("password")}]
    for admin in admins:
        if admin and admin.get("username") == username and admin.get("password") == password:
            session["admin_user"] = username
            return jsonify({"success": True})
    return jsonify({"success": False, "message": "Invalid credentials"}), 401

@app.route("/admin/logout", methods=["POST"])
def admin_logout():
    session.pop("admin_user", None)
    return jsonify({"success": True})

@app.route("/admin/api/projects", methods=["GET"])
def admin_projects():
    if not is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    return jsonify({"success": True, "projects": CONFIG.get("projects") or {}})

@app.route("/admin/api/projects", methods=["POST"])
def admin_add_project():
    if not is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    data = request.get_json() or {}
    name = data.get("name")
    if not name:
        return jsonify({"success": False, "message": "Missing name"}), 400
    projects = CONFIG.setdefault("projects", {})
    if name in projects:
        return jsonify({"success": False, "message": "Project exists"}), 400
    api_key = data.get("api_key") or f"nexoradb-{secrets.token_hex(16)}"
    data_path = data.get("data_path") or f"./chroma_data/{name}"
    projects[name] = {
        "api_key": api_key,
        "data_path": data_path,
        "collection_prefix": data.get("collection_prefix") or "knowledge",
        "distance": data.get("distance") or "cosine"
    }
    save_config()
    return jsonify({"success": True, "project": projects[name]})

@app.route("/admin/api/projects/<name>", methods=["DELETE"])
def admin_delete_project(name):
    if not is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    projects = CONFIG.setdefault("projects", {})
    if name not in projects:
        return jsonify({"success": False, "message": "Not found"}), 404
    del projects[name]
    save_config()
    return jsonify({"success": True})

@app.route("/admin/api/projects/<name>/rotate", methods=["POST"])
def admin_rotate_project_key(name):
    if not is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    projects = CONFIG.setdefault("projects", {})
    if name not in projects:
        return jsonify({"success": False, "message": "Not found"}), 404
    projects[name]["api_key"] = f"nexoradb-{secrets.token_hex(16)}"
    save_config()
    return jsonify({"success": True, "api_key": projects[name]["api_key"]})

@app.route("/admin/api/status", methods=["GET"])
def admin_status():
    if not is_admin():
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    projects = CONFIG.get("projects") or {}
    status_items = []
    total_bytes = 0
    total_vectors = 0
    for name, proj in projects.items():
        data_path = _resolve_data_path(proj.get("data_path"))
        size_bytes = _folder_size_bytes(data_path)
        total_bytes += size_bytes
        vector_count = None
        try:
            client = chromadb.PersistentClient(path=data_path)
            cols = client.list_collections()
            vector_count = 0
            for col in cols:
                try:
                    vector_count += col.count()
                except Exception:
                    continue
            total_vectors += vector_count
        except Exception:
            pass
        status_items.append({
            "name": name,
            "data_path": data_path,
            "size_bytes": size_bytes,
            "size_human": _format_bytes(size_bytes),
            "vector_count": vector_count
        })
    import time
    uptime_sec = int(time.time() - (START_TIME or time.time()))
    return jsonify({
        "success": True,
        "service": "NexoraDB",
        "uptime_sec": uptime_sec,
        "projects": status_items,
        "total_bytes": total_bytes,
        "total_human": _format_bytes(total_bytes),
        "total_vectors": total_vectors,
        "embedding_model": (CONFIG.get("embedding") or {}).get("model") or ""
    })

@app.route("/upsert", methods=["POST"])
def upsert():
    data = request.get_json() or {}
    username = data.get("username")
    title = data.get("title")
    text = data.get("text")
    embedding = data.get("embedding")
    metadata = data.get("metadata") or {}
    chunk_id = data.get("chunk_id")
    library = _normalize_library(data.get("library"))

    if not username or text is None or embedding is None:
        return jsonify({"success": False, "message": "missing username/text/embedding"}), 400

    collection = get_collection(username)
    doc_id = safe_id(username, title, chunk_id, library=library)
    meta = {
        "username": username,
        "title": title or "",
        "source": "nexoradb",
        "library": library
    }
    if chunk_id is not None:
        meta["chunk_id"] = chunk_id
    meta.update(metadata)

    collection.upsert(
        ids=[doc_id],
        embeddings=[embedding],
        documents=[text],
        metadatas=[meta]
    )

    return jsonify({"success": True, "vector_id": doc_id})


@app.route("/upsert_text", methods=["POST"])
def upsert_text():
    data = request.get_json() or {}
    username = data.get("username")
    title = data.get("title")
    text = data.get("text")
    metadata = data.get("metadata") or {}
    chunk_id = data.get("chunk_id")
    library = _normalize_library(data.get("library"))

    if not username or text is None:
        return jsonify({"success": False, "message": "missing username/text"}), 400

    embedding = embed_texts([text])[0]
    collection = get_collection(username)
    doc_id = safe_id(username, title, chunk_id, library=library)
    meta = {
        "username": username,
        "title": title or "",
        "source": "nexoradb",
        "library": library
    }
    if chunk_id is not None:
        meta["chunk_id"] = chunk_id
    meta.update(metadata)

    collection.upsert(
        ids=[doc_id],
        embeddings=[embedding],
        documents=[text],
        metadatas=[meta]
    )

    return jsonify({"success": True, "vector_id": doc_id})


@app.route("/upsert_texts", methods=["POST"])
def upsert_texts():
    data = request.get_json() or {}
    username = data.get("username")
    items = data.get("items")
    fallback_library = _normalize_library(data.get("library"))

    if not username or not isinstance(items, list) or not items:
        return jsonify({"success": False, "message": "missing username/items"}), 400

    texts: List[str] = []
    doc_ids: List[str] = []
    metas: List[Dict[str, Any]] = []
    docs: List[str] = []

    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            return jsonify({"success": False, "message": f"items[{idx}] must be object"}), 400
        title = item.get("title")
        text = item.get("text")
        metadata = item.get("metadata") or {}
        chunk_id = item.get("chunk_id")
        library = _normalize_library(item.get("library"), default=fallback_library or "knowledge")

        if text is None:
            return jsonify({"success": False, "message": f"items[{idx}] missing text"}), 400

        text_str = str(text)
        doc_id = safe_id(username, title, chunk_id, library=library)
        meta = {
            "username": username,
            "title": title or "",
            "source": "nexoradb",
            "library": library
        }
        if chunk_id is not None:
            meta["chunk_id"] = chunk_id
        if isinstance(metadata, dict):
            meta.update(metadata)

        texts.append(text_str)
        docs.append(text_str)
        doc_ids.append(doc_id)
        metas.append(meta)

    embeddings = embed_texts(texts)
    collection = get_collection(username)
    collection.upsert(
        ids=doc_ids,
        embeddings=embeddings,
        documents=docs,
        metadatas=metas
    )

    return jsonify({
        "success": True,
        "vector_ids": doc_ids,
        "count": len(doc_ids)
    })


@app.route("/query", methods=["POST"])
def query():
    data = request.get_json() or {}
    username = data.get("username")
    embedding = data.get("embedding")
    top_k = int(data.get("top_k") or 5)
    where = _build_where_with_library(data.get("where"), data.get("library"))

    if not username or embedding is None:
        return jsonify({"success": False, "message": "missing username/embedding"}), 400

    collection = get_collection(username)
    kwargs: Dict[str, Any] = {}
    if where:
        kwargs["where"] = where
    result = collection.query(
        query_embeddings=[embedding],
        n_results=top_k,
        include=["documents", "metadatas", "distances"],
        **kwargs
    )

    return jsonify({"success": True, "result": result})


@app.route("/query_text", methods=["POST"])
def query_text():
    data = request.get_json() or {}
    username = data.get("username")
    text = data.get("text")
    top_k = int(data.get("top_k") or 5)
    where = _build_where_with_library(data.get("where"), data.get("library"))

    if not username or text is None:
        return jsonify({"success": False, "message": "missing username/text"}), 400

    embedding = embed_texts([text])[0]
    collection = get_collection(username)
    kwargs: Dict[str, Any] = {}
    if where:
        kwargs["where"] = where
    result = collection.query(
        query_embeddings=[embedding],
        n_results=top_k,
        include=["documents", "metadatas", "distances"],
        **kwargs
    )

    return jsonify({"success": True, "result": result})


@app.route("/chunks", methods=["POST"])
def chunks():
    data = request.get_json() or {}
    username = data.get("username")
    title = data.get("title")
    where = _build_where_with_library({"title": title} if title else None, data.get("library"))

    if not username or not title:
        return jsonify({"success": False, "message": "missing username/title"}), 400

    collection = get_collection(username)
    result = collection.get(where=where or {"title": title}, include=["documents", "metadatas"])
    ids = result.get("ids", [])
    docs = result.get("documents", [])
    metas = result.get("metadatas", [])
    chunks = []
    for i in range(len(ids)):
        meta = metas[i] if i < len(metas) else {}
        chunks.append({
            "id": ids[i],
            "chunk_id": meta.get("chunk_id"),
            "text": docs[i] if i < len(docs) else "",
            "metadata": meta
        })
    return jsonify({"success": True, "chunks": chunks})

@app.route("/titles", methods=["POST"])
def titles():
    data = request.get_json() or {}
    username = data.get("username")
    library = _normalize_library(data.get("library"), default="")

    if not username:
        return jsonify({"success": False, "message": "missing username"}), 400

    collection = get_collection(username)
    result = collection.get(include=["metadatas"])
    metas = result.get("metadatas", []) or []
    titles = []
    seen = set()
    for meta in metas:
        if not meta:
            continue
        if library and str(meta.get("library") or "") != library:
            continue
        t = meta.get("title") or ""
        if t and t not in seen:
            seen.add(t)
            titles.append(t)
    titles.sort()
    return jsonify({"success": True, "titles": titles})

@app.route("/delete", methods=["POST"])
def delete():
    data = request.get_json() or {}
    username = data.get("username")
    title = data.get("title")
    vector_id = data.get("vector_id")
    where = data.get("where") if isinstance(data.get("where"), dict) else None
    library = _normalize_library(data.get("library"), default="")

    if not username:
        return jsonify({"success": False, "message": "missing username"}), 400
    if not title and not vector_id and not where:
        return jsonify({"success": False, "message": "missing title/vector_id/where"}), 400

    collection = get_collection(username)
    if vector_id:
        collection.delete(ids=[vector_id])
    elif where:
        delete_where = _build_where_with_library(where, library)
        collection.delete(where=delete_where or where)
    else:
        delete_where = _build_where_with_library({"title": title}, library)
        try:
            collection.delete(where=delete_where or {"title": title})
        except Exception:
            doc_id = safe_id(username, title, library=library or None)
            collection.delete(ids=[doc_id])
    return jsonify({"success": True})


if __name__ == "__main__":
    host = CONFIG.get("host") or "0.0.0.0"
    port = int(CONFIG.get("port") or 8100)
    app.run(host=host, port=port, debug=False)
