import os
import re
import json
import hashlib
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple


def _strip_scheme(host: str) -> str:
    if not host:
        return host
    return re.sub(r"^https?://", "", host).rstrip("/")


def _safe_id(username: str, title: Optional[str], chunk_id: Optional[int] = None) -> str:
    suffix = f":{chunk_id}" if chunk_id is not None else ""
    base = f"{username}:{title or ''}{suffix}"
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()
    return f"{username}:{digest}"


class ChromaStore:
    def __init__(self, config: Dict[str, Any]):
        self.config = config or {}
        self.mode = (self.config.get("mode") or "http").lower()
        self.api_key = self.config.get("api_key")

        if self.mode == "service":
            service_url = self.config.get("service_url")
            if not service_url:
                host = _strip_scheme(self.config.get("host") or "127.0.0.1")
                port = int(self.config.get("port") or 8100)
                service_url = f"http://{host}:{port}"
            self.service_url = service_url.rstrip("/")
            self.client = None
            return

        try:
            import chromadb  # noqa: F401
        except Exception as e:
            raise RuntimeError(f"chromadb not installed: {e}")

        import chromadb

        if self.mode == "embedded":
            path = self.config.get("path") or os.path.join("data", "chroma")
            self.client = chromadb.PersistentClient(path=path)
        elif self.mode == "memory":
            self.client = chromadb.Client()
        else:
            host = _strip_scheme(self.config.get("host") or "127.0.0.1")
            port = int(self.config.get("port") or 8000)
            headers = {"X-API-Key": self.api_key} if self.api_key else None
            self.client = chromadb.HttpClient(host=host, port=port, headers=headers)

    def _collection_name(self, username: str) -> str:
        prefix = self.config.get("collection_prefix") or "knowledge"
        return f"{prefix}_{username}"

    def _get_collection(self, username: str):
        if self.mode == "service":
            return None
        name = self._collection_name(username)
        distance = self.config.get("distance") or "cosine"
        return self.client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": distance}
        )

    def _service_post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.service_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            try:
                body = e.read().decode("utf-8")
                return json.loads(body) if body else {"success": False, "message": str(e)}
            except Exception:
                return {"success": False, "message": str(e)}

    def _service_get(self, path: str) -> Dict[str, Any]:
        url = f"{self.service_url}{path}"
        headers = {}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            try:
                body = e.read().decode("utf-8")
                return json.loads(body) if body else {"success": False, "message": str(e)}
            except Exception:
                return {"success": False, "message": str(e)}

    def upsert_knowledge(
        self,
        username: str,
        title: Optional[str],
        text: str,
        embedding: List[float],
        extra_metadata: Optional[Dict[str, Any]] = None,
        chunk_id: Optional[int] = None
    ) -> str:
        if self.mode == "service":
            return self.upsert_text(username, title, text, extra_metadata, chunk_id=chunk_id)
        collection = self._get_collection(username)
        doc_id = _safe_id(username, title, chunk_id)
        metadata = {
            "username": username,
            "title": title or "",
            "source": "nexora"
        }
        if extra_metadata:
            metadata.update(extra_metadata)
        collection.upsert(
            ids=[doc_id],
            embeddings=[embedding],
            documents=[text],
            metadatas=[metadata]
        )
        return doc_id

    def upsert_text(
        self,
        username: str,
        title: Optional[str],
        text: str,
        extra_metadata: Optional[Dict[str, Any]] = None,
        chunk_id: Optional[int] = None
    ) -> str:
        if self.mode != "service":
            raise RuntimeError("upsert_text only supported in service mode")
        resp = self._service_post("/upsert_text", {
            "username": username,
            "title": title,
            "text": text,
            "metadata": extra_metadata or {},
            "chunk_id": chunk_id
        })
        if not resp.get("success", True):
            raise RuntimeError(resp.get("message") or "upsert_text failed")
        return resp.get("vector_id") or ""

    def query(
        self,
        username: str,
        embedding: List[float],
        top_k: int = 5
    ) -> Dict[str, Any]:
        if self.mode == "service":
            raise RuntimeError("query embedding is not supported in service mode")
        collection = self._get_collection(username)
        return collection.query(
            query_embeddings=[embedding],
            n_results=top_k,
            include=["documents", "metadatas", "distances", "ids"]
        )

    def query_text(
        self,
        username: str,
        text: str,
        top_k: int = 5
    ) -> Dict[str, Any]:
        if self.mode != "service":
            raise RuntimeError("query_text only supported in service mode")
        resp = self._service_post("/query_text", {
            "username": username,
            "text": text,
            "top_k": top_k
        })
        if not resp.get("success", True):
            raise RuntimeError(resp.get("message") or "query_text failed")
        return resp.get("result") or {}

    def delete_by_title(self, username: str, title: str) -> None:
        if self.mode == "service":
            resp = self._service_post("/delete", {
                "username": username,
                "title": title
            })
            if not resp.get("success", True):
                raise RuntimeError(resp.get("message") or "delete failed")
            return
        collection = self._get_collection(username)
        try:
            collection.delete(where={"title": title})
        except Exception:
            doc_id = _safe_id(username, title)
            collection.delete(ids=[doc_id])

    def delete_by_id(self, username: str, vector_id: str) -> None:
        if self.mode == "service":
            resp = self._service_post("/delete", {
                "username": username,
                "vector_id": vector_id
            })
            if not resp.get("success", True):
                raise RuntimeError(resp.get("message") or "delete failed")
            return
        collection = self._get_collection(username)
        collection.delete(ids=[vector_id])

    def stats(self) -> Dict[str, Any]:
        if self.mode == "service":
            resp = self._service_get("/stats")
            if not resp.get("success", True):
                raise RuntimeError(resp.get("message") or "stats failed")
            return resp

        cols = self.client.list_collections()
        items = []
        total = 0
        for col in cols:
            try:
                count = col.count()
            except Exception:
                count = 0
            items.append({"name": col.name, "count": count})
            total += count
        return {"success": True, "collections": items, "total_vectors": total}

    def get_chunks(self, username: str, title: str) -> List[Dict[str, Any]]:
        if self.mode == "service":
            resp = self._service_post("/chunks", {
                "username": username,
                "title": title
            })
            if not resp.get("success", True):
                raise RuntimeError(resp.get("message") or "chunks failed")
            return resp.get("chunks") or []

        collection = self._get_collection(username)
        result = collection.get(where={"title": title}, include=["documents", "metadatas", "ids"])
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
        return chunks
