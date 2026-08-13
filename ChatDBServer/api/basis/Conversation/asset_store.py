import base64
import binascii
import json
import os
import re
import shutil
import time
import uuid
from typing import Any, Dict, Optional, Tuple

from App.Utils import safe_join_path


IMAGE_MIME_TO_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/heic": ".heic",
    "image/heif": ".heif",
}

MAX_IMAGE_BYTES = 12 * 1024 * 1024
ASSET_URL_PATTERN = re.compile(r"/api/conversations/([^/\s]+)/assets/([A-Za-z0-9_-]+)")


def conversation_asset_root(username: str) -> str:
    return safe_join_path(
        os.path.dirname(os.path.dirname(__file__)),
        "data",
        "users",
        str(username or ""),
        "conversation_assets",
    )


def conversation_asset_dir(username: str, conversation_id: str) -> str:
    return safe_join_path(conversation_asset_root(username), str(conversation_id or ""))


def conversation_asset_index_path(username: str, conversation_id: str) -> str:
    return safe_join_path(conversation_asset_dir(username, conversation_id), "index.json")


def load_conversation_asset_index(username: str, conversation_id: str) -> Dict[str, Any]:
    idx_path = conversation_asset_index_path(username, conversation_id)

    if not os.path.exists(idx_path):
        return {"assets": {}}

    try:
        with open(idx_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if not isinstance(data, dict):
            return {"assets": {}}

        assets = data.get("assets", {})

        if not isinstance(assets, dict):
            assets = {}

        data["assets"] = assets
        return data
    except Exception:
        return {"assets": {}}


def save_conversation_asset_index(username: str, conversation_id: str, data: Dict[str, Any]) -> None:
    conv_dir = conversation_asset_dir(username, conversation_id)
    os.makedirs(conv_dir, exist_ok=True)

    idx_path = conversation_asset_index_path(username, conversation_id)
    payload = data if isinstance(data, dict) else {"assets": {}}

    if "assets" not in payload or not isinstance(payload.get("assets"), dict):
        payload["assets"] = {}

    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def parse_image_data_url(raw_url: str) -> Tuple[str, bytes]:
    text = str(raw_url or "").strip()
    m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", text, re.IGNORECASE | re.DOTALL)

    if not m:
        raise ValueError("invalid image data url")

    mime = str(m.group(1) or "").strip().lower()
    b64 = str(m.group(2) or "").strip()

    try:
        raw = base64.b64decode(b64, validate=True)
    except (ValueError, binascii.Error) as e:
        raise ValueError(f"invalid base64 image data: {str(e)}")

    return mime, raw


def safe_asset_ext(mime: str) -> str:
    mt = str(mime or "").strip().lower()
    return IMAGE_MIME_TO_EXT.get(mt, ".bin")


def persist_conversation_image_bytes(
    username: str,
    conversation_id: str,
    image_bytes: bytes,
    mime: str,
    name: str = "",
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    raw = bytes(image_bytes or b"")

    if not raw:
        raise ValueError("empty image content")

    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("image too large (>12MB)")

    normalized_mime = str(mime or "image/png").strip().lower() or "image/png"
    asset_id = uuid.uuid4().hex
    ext = safe_asset_ext(normalized_mime)
    filename = f"{asset_id}{ext}"
    conv_dir = conversation_asset_dir(username, conversation_id)
    os.makedirs(conv_dir, exist_ok=True)

    file_path = os.path.join(conv_dir, filename)

    with open(file_path, "wb") as wf:
        wf.write(raw)

    index_data = load_conversation_asset_index(username, conversation_id)
    assets_map = index_data.setdefault("assets", {})
    created_at = int(time.time())
    meta = metadata if isinstance(metadata, dict) else {}
    assets_map[asset_id] = {
        "asset_id": asset_id,
        "file_name": filename,
        "mime": normalized_mime,
        "size": len(raw),
        "name": str(name or filename),
        "created_at": created_at,
        **meta,
    }
    save_conversation_asset_index(username, conversation_id, index_data)

    return {
        "asset_id": asset_id,
        "asset_url": f"/api/conversations/{conversation_id}/assets/{asset_id}",
        "mime": normalized_mime,
        "size": len(raw),
        "name": str(name or filename),
    }


def persist_conversation_image_asset(username: str, conversation_id: str, file_item: Dict[str, Any]) -> Dict[str, Any]:
    item = file_item if isinstance(file_item, dict) else {}
    raw_url = str(item.get("url") or item.get("image_url") or "").strip()

    if not raw_url.startswith("data:image/"):
        return item

    mime, raw = parse_image_data_url(raw_url)
    asset = persist_conversation_image_bytes(
        username=username,
        conversation_id=conversation_id,
        image_bytes=raw,
        mime=mime,
        name=str(item.get("name") or ""),
    )
    normalized = dict(item)
    normalized.update(asset)
    return normalized


def collect_referenced_asset_ids(conversation_data: Dict[str, Any]) -> set:
    out = set()

    def collect_from_value(value: Any) -> None:
        if isinstance(value, str):

            for match in ASSET_URL_PATTERN.finditer(value):
                asset_id = str(match.group(2) or "").strip()

                if asset_id:
                    out.add(asset_id)

        elif isinstance(value, dict):

            for nested in value.values():
                collect_from_value(nested)

        elif isinstance(value, list):

            for nested in value:
                collect_from_value(nested)

    if not isinstance(conversation_data, dict):
        return out

    msgs = conversation_data.get("messages", [])

    if not isinstance(msgs, list):
        return out

    for msg in msgs:

        if not isinstance(msg, dict):
            continue

        meta = msg.get("metadata", {})

        attachments = meta.get("attachments", []) if isinstance(meta, dict) else []

        if isinstance(attachments, list):

            for att in attachments:

                if not isinstance(att, dict):
                    continue

                aid = str(att.get("asset_id") or "").strip()

                if aid:
                    out.add(aid)

        collect_from_value(msg)

    return out


def rewrite_conversation_asset_urls(value: Any, source_conversation_id: str, target_conversation_id: str) -> Any:
    """将会话快照中的附件 URL 改写到新会话资源目录。"""
    source_id = str(source_conversation_id or "").strip()
    target_id = str(target_conversation_id or "").strip()

    if not source_id or not target_id:
        raise ValueError("source_conversation_id and target_conversation_id are required")

    source_prefix = f"/api/conversations/{source_id}/assets/"
    target_prefix = f"/api/conversations/{target_id}/assets/"

    if isinstance(value, str):
        return value.replace(source_prefix, target_prefix)

    if isinstance(value, list):
        return [
            rewrite_conversation_asset_urls(item, source_id, target_id)
            for item in value
        ]

    if isinstance(value, dict):
        return {
            key: rewrite_conversation_asset_urls(item, source_id, target_id)
            for key, item in value.items()
        }

    return value


def clone_referenced_assets(
    username: str,
    source_conversation_id: str,
    target_conversation_id: str,
    conversation_data: Dict[str, Any],
) -> Dict[str, Any]:
    """复制分支历史真正引用的图片，并返回已改写 URL 的会话快照。"""
    source_id = str(source_conversation_id or "").strip()
    target_id = str(target_conversation_id or "").strip()

    if not source_id or not target_id:
        raise ValueError("source_conversation_id and target_conversation_id are required")

    snapshot = conversation_data if isinstance(conversation_data, dict) else {}
    referenced_ids = collect_referenced_asset_ids(snapshot)
    rewritten_snapshot = rewrite_conversation_asset_urls(snapshot, source_id, target_id)

    if not referenced_ids:
        return rewritten_snapshot

    source_index = load_conversation_asset_index(username, source_id)
    source_assets = source_index.get("assets", {}) if isinstance(source_index.get("assets"), dict) else {}
    target_dir = conversation_asset_dir(username, target_id)
    os.makedirs(target_dir, exist_ok=True)
    target_assets = {}

    try:

        for asset_id in sorted(referenced_ids):
            metadata = source_assets.get(asset_id)

            if not isinstance(metadata, dict):
                raise FileNotFoundError(f"分支引用的附件索引不存在: {asset_id}")

            file_name = str(metadata.get("file_name") or "").strip()

            if not file_name:
                raise FileNotFoundError(f"分支引用的附件文件名为空: {asset_id}")

            source_path = safe_join_path(conversation_asset_dir(username, source_id), file_name)
            target_path = safe_join_path(target_dir, file_name)

            if not os.path.isfile(source_path):
                raise FileNotFoundError(f"分支引用的附件文件不存在: {asset_id}")

            shutil.copy2(source_path, target_path)
            target_assets[asset_id] = dict(metadata)

        save_conversation_asset_index(username, target_id, {"assets": target_assets})
    except Exception:
        remove_conversation_assets_dir(username, target_id)
        raise

    return rewritten_snapshot


def cleanup_conversation_assets(username: str, conversation_id: str, keep_asset_ids: Optional[set] = None) -> None:
    conv_dir = conversation_asset_dir(username, conversation_id)

    if not os.path.isdir(conv_dir):
        return

    keep = keep_asset_ids if isinstance(keep_asset_ids, set) else set()
    idx = load_conversation_asset_index(username, conversation_id)
    assets = idx.get("assets", {}) if isinstance(idx.get("assets"), dict) else {}
    kept_assets = {}

    for aid, meta in assets.items():
        aid_s = str(aid or "").strip()

        if not aid_s:
            continue

        if aid_s in keep:
            kept_assets[aid_s] = meta
            continue

        file_name = str((meta or {}).get("file_name") or "").strip()

        if file_name:
            fpath = os.path.join(conv_dir, file_name)

            try:
                if os.path.exists(fpath):
                    os.remove(fpath)
            except Exception:
                pass

    idx["assets"] = kept_assets
    save_conversation_asset_index(username, conversation_id, idx)


def remove_conversation_assets_dir(username: str, conversation_id: str) -> None:
    conv_dir = conversation_asset_dir(username, conversation_id)

    if not os.path.isdir(conv_dir):
        return

    try:
        shutil.rmtree(conv_dir)
    except Exception:
        pass


def get_conversation_asset_file(username: str, conversation_id: str, asset_id: str) -> Tuple[str, str, Dict[str, Any]]:
    aid = str(asset_id or "").strip()

    if not aid:
        raise ValueError("invalid asset id")

    idx = load_conversation_asset_index(username, conversation_id)
    assets = idx.get("assets", {}) if isinstance(idx.get("assets"), dict) else {}
    meta = assets.get(aid)

    if not isinstance(meta, dict):
        raise FileNotFoundError("asset not found")

    file_name = str(meta.get("file_name") or "").strip()

    if not file_name:
        raise FileNotFoundError("asset file missing")

    fpath = safe_join_path(conversation_asset_dir(username, conversation_id), file_name)

    if not os.path.exists(fpath):
        raise FileNotFoundError("asset file not found")

    mime = str(meta.get("mime") or "").strip() or "application/octet-stream"
    return fpath, mime, meta
