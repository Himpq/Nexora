import copy
import json
import os
import re
import time
import uuid
from typing import Any, Dict, List, Optional

from datastorage import safe_read_json, safe_write_json
from map_tools import BAIDU_PROVIDER, TIANDITU_PROVIDER, MapToolService
from secure import safe_join_path


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(ROOT_DIR, "data")
MAP_RECORD_MAX_ITEMS = 2000


def _safe_username(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"[^a-zA-Z0-9_.@-]", "_", text)

    return text[:128] or "anonymous"


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default

    if isinstance(value, bool):
        return value

    if isinstance(value, str):
        text = value.strip().lower()

        if text in {"1", "true", "yes", "y", "on"}:
            return True

        if text in {"0", "false", "no", "n", "off"}:
            return False

        return default

    return bool(value)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return int(default)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).strip())
    except Exception:
        return float(default)


def _clip_text(value: Any, limit: int = 160) -> str:
    text = str(value or "").strip()

    if len(text) <= limit:
        return text

    return text[:limit] + "..."


class BaiduMapRecordStore:
    """会话旁路地图记录，让对话只保存轻量引用，完整 scene 跟随会话保存。"""

    def __init__(self, username: str, conversation_id: str, config: Optional[Dict[str, Any]] = None):
        self.username = str(username or "").strip()
        self.safe_username = _safe_username(username)
        self.conversation_id = str(conversation_id or "").strip()
        self.config = config if isinstance(config, dict) else {}
        self.max_items = self._resolve_max_items()
        self.index_path = self._resolve_index_path()

        os.makedirs(os.path.dirname(self.index_path), exist_ok=True)

    def _resolve_index_path(self) -> str:
        if not self.conversation_id:
            raise ValueError("地图记录需要 conversation_id")

        users_root = safe_join_path(DATA_DIR, "users")
        conversation_dir = safe_join_path(users_root, self.username, "conversations")
        file_name = f"{self.conversation_id}.maps.json"

        return safe_join_path(conversation_dir, file_name)

    def _resolve_max_items(self) -> int:
        map_cfg = self.config.get("map_service") if isinstance(self.config.get("map_service"), dict) else {}
        raw_value = map_cfg.get("record_max_items", MAP_RECORD_MAX_ITEMS)

        return max(10, min(_safe_int(raw_value, MAP_RECORD_MAX_ITEMS), 5000))

    def _load_index(self) -> Dict[str, Any]:
        payload = safe_read_json(self.index_path, default={})

        if not isinstance(payload, dict):
            payload = {}

        records = payload.get("maps")

        if not isinstance(records, dict):
            legacy_records = payload.get("records")
            payload["maps"] = legacy_records if isinstance(legacy_records, dict) else {}

        return self._prune_payload(payload)

    def _save_index(self, payload: Dict[str, Any]) -> None:
        payload = self._prune_payload(payload)
        payload["version"] = 1
        payload["username"] = self.username
        payload["conversation_id"] = self.conversation_id
        payload["updated_at"] = time.time()
        safe_write_json(self.index_path, payload)

    def _prune_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        records = payload.get("maps") if isinstance(payload.get("maps"), dict) else {}
        alive: Dict[str, Dict[str, Any]] = {}

        for key, record in records.items():
            if not isinstance(record, dict):
                continue

            alive[str(key)] = record

        ordered = sorted(
            alive.items(),
            key=lambda item: float((item[1] or {}).get("created_at") or 0),
            reverse=True,
        )
        payload["maps"] = dict(ordered[:self.max_items])
        payload.pop("records", None)

        return payload

    def create_record(
        self,
        *,
        tool: str,
        kind: str,
        title: str,
        scene: Dict[str, Any],
        data: Dict[str, Any],
        conversation_id: str = "",
    ) -> Dict[str, Any]:
        now_ts = time.time()
        map_id = f"map_{uuid.uuid4().hex[:12]}"
        provider = self._record_provider(scene, data)
        record = {
            "map_id": map_id,
            "record_id": map_id,
            "render_id": map_id,
            "username": self.safe_username,
            "conversation_id": str(conversation_id or self.conversation_id or "").strip(),
            "tool": str(tool or "").strip(),
            "kind": str(kind or "").strip(),
            "provider": provider,
            "title": str(title or "地图").strip() or "地图",
            "created_at": now_ts,
            "scene": scene if isinstance(scene, dict) else {},
            "data": data if isinstance(data, dict) else {},
        }
        payload = self._load_index()
        records = payload.setdefault("maps", {})
        records[map_id] = record
        self._save_index(payload)

        return self._record_summary(record)

    def _record_provider(self, scene: Dict[str, Any], data: Dict[str, Any]) -> str:
        scene_provider = str((scene if isinstance(scene, dict) else {}).get("provider") or "").strip().lower()

        if scene_provider:
            return scene_provider

        data_provider = str((data if isinstance(data, dict) else {}).get("provider") or "").strip().lower()

        return data_provider or BAIDU_PROVIDER

    def get_record(self, map_id: str = "", record_id: str = "", render_id: str = "") -> Optional[Dict[str, Any]]:
        map_key = str(map_id or record_id or render_id or "").strip()
        render_key = str(render_id or "").strip()
        payload = self._load_index()
        records = payload.get("maps") if isinstance(payload.get("maps"), dict) else {}

        if map_key:
            record = records.get(map_key)

            if isinstance(record, dict):
                return copy.deepcopy(record)

        if render_key:
            for record in records.values():
                if isinstance(record, dict) and str(record.get("render_id") or "") == render_key:
                    return copy.deepcopy(record)

        return None

    def list_records(self, limit: int = 20) -> List[Dict[str, Any]]:
        payload = self._load_index()
        records = payload.get("maps") if isinstance(payload.get("maps"), dict) else {}
        items = [self._record_summary(record) for record in records.values() if isinstance(record, dict)]
        items.sort(key=lambda item: float(item.get("created_at") or 0), reverse=True)

        return items[:max(1, min(int(limit or 20), 100))]

    def scene_for_map_id(self, map_id: str) -> Optional[Dict[str, Any]]:
        record = self.get_record(map_id=map_id)

        if not isinstance(record, dict):
            return None

        scene = record.get("scene")

        return copy.deepcopy(scene) if isinstance(scene, dict) else None

    def _record_summary(self, record: Dict[str, Any]) -> Dict[str, Any]:
        data = record.get("data") if isinstance(record.get("data"), dict) else {}
        summary = data.get("summary") if isinstance(data.get("summary"), dict) else {}
        scene = record.get("scene") if isinstance(record.get("scene"), dict) else {}
        layers = scene.get("layers") if isinstance(scene.get("layers"), list) else []

        return {
            "map_id": str(record.get("map_id") or record.get("record_id") or ""),
            "record_id": str(record.get("record_id") or ""),
            "render_id": str(record.get("render_id") or ""),
            "tool": str(record.get("tool") or ""),
            "kind": str(record.get("kind") or ""),
            "provider": str(record.get("provider") or BAIDU_PROVIDER),
            "title": str(record.get("title") or "地图"),
            "created_at": record.get("created_at"),
            "conversation_id": str(record.get("conversation_id") or ""),
            "summary": summary,
            "layer_count": len(layers),
        }


class BaiduMapToolService(MapToolService):
    """百度地图工具：调用 provider 后保存地图记录，只向模型返回短句柄。"""

    def __init__(self, config: Dict[str, Any], username: str = "", conversation_id: str = ""):
        super().__init__(config)
        self.username = _safe_username(username)
        self.conversation_id = str(conversation_id or "").strip()
        self.record_store = BaiduMapRecordStore(username, self.conversation_id, config)

    def render(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        scene = self._build_scene_from_args(safe_args)
        title = str(scene.get("title") or safe_args.get("title") or "地图").strip()
        data = {
            "summary": self._scene_summary(scene),
            "source": "manual_scene",
        }
        record = self._save_record(
            tool="map_render",
            kind="scene",
            title=title,
            scene=scene,
            data=data,
            render_map=_as_bool(safe_args.get("render"), True),
        )

        return json.dumps(record, ensure_ascii=False)

    def calc_distance(self, args: Dict[str, Any]) -> str:
        safe_args = self._resolve_origin_destination_args(args if isinstance(args, dict) else {})
        payload = self._load_json(super().calc_distance(safe_args))

        if payload.get("success") is False:
            return json.dumps(payload, ensure_ascii=False)

        return json.dumps(self._record_payload(payload, safe_args, "map_calc_distance", "distance"), ensure_ascii=False)

    def calc_route(self, args: Dict[str, Any]) -> str:
        safe_args = self._resolve_origin_destination_args(args if isinstance(args, dict) else {})
        payload = self._load_json(super().calc_route(safe_args))

        if payload.get("success") is False:
            return json.dumps(payload, ensure_ascii=False)

        return json.dumps(self._record_payload(payload, safe_args, "map_calc_route", "route"), ensure_ascii=False)

    def geocode(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        payload = self._load_json(super().geocode(safe_args))

        if payload.get("success") is False:
            return json.dumps(payload, ensure_ascii=False)

        return json.dumps(self._record_payload(payload, safe_args, "map_geocode", "geocode"), ensure_ascii=False)

    def poi_search(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        payload = self._load_json(super().poi_search(safe_args))

        if payload.get("success") is False:
            return json.dumps(payload, ensure_ascii=False)

        return json.dumps(self._record_payload(payload, safe_args, "map_poi_search", "poi"), ensure_ascii=False)

    def _record_payload(self, payload: Dict[str, Any], args: Dict[str, Any], tool: str, kind: str) -> Dict[str, Any]:
        scene = payload.get("scene") if isinstance(payload.get("scene"), dict) else {}
        render_map = _as_bool(args.get("render"), True)

        if not render_map:
            data = self._data_without_scene(payload)
            data["summary"] = self._payload_summary(payload, kind)
            return data

        if not scene:
            raise ValueError(f"{tool} 未生成可保存的地图 scene")

        title = str(scene.get("title") or args.get("title") or self._default_title(payload, kind)).strip()
        data = self._data_without_scene(payload)
        data["summary"] = self._payload_summary(payload, kind)

        return self._save_record(
            tool=tool,
            kind=kind,
            title=title,
            scene=scene,
            data=data,
            render_map=render_map,
        )

    def _save_record(
        self,
        *,
        tool: str,
        kind: str,
        title: str,
        scene: Dict[str, Any],
        data: Dict[str, Any],
        render_map: bool,
    ) -> Dict[str, Any]:
        record = self.record_store.create_record(
            tool=tool,
            kind=kind,
            title=title,
            scene=scene,
            data=data,
            conversation_id=self.conversation_id,
        )
        provider = str((scene if isinstance(scene, dict) else {}).get("provider") or record.get("provider") or BAIDU_PROVIDER).strip().lower()
        payload = {
            "success": True,
            "tool": tool,
            "provider": provider,
            "kind": kind,
            "map_id": record.get("map_id"),
            "record_id": record.get("record_id"),
            "render_id": record.get("render_id"),
            "conversation_id": self.conversation_id,
            "title": record.get("title"),
            "summary": record.get("summary"),
            "layer_count": record.get("layer_count"),
            "hint": "地图 scene 已保存到当前会话旁路 maps 文件；对话中只保留 map_id 和摘要。",
        }

        if render_map:
            payload["markdown"] = self._render_ref_markdown(record.get("map_id"), record.get("title"))

        return payload

    def _resolve_origin_destination_args(self, args: Dict[str, Any]) -> Dict[str, Any]:
        out = dict(args)
        provider = self._resolve_provider(out)
        self._assert_supported_provider(provider)
        origin = out.get("origin", out.get("start"))
        destination = out.get("destination", out.get("end"))

        if isinstance(origin, str):
            out["origin"] = self._geocode_text(origin, self._route_geocode_city(out, "origin"), provider)

        if isinstance(destination, str):
            out["destination"] = self._geocode_text(destination, self._route_geocode_city(out, "destination"), provider)

        origin_text = str(out.get("origin_text") or out.get("start_text") or "").strip()
        destination_text = str(out.get("destination_text") or out.get("end_text") or "").strip()

        if origin_text:
            out["origin"] = self._geocode_text(origin_text, self._route_geocode_city(out, "origin"), provider)

        if destination_text:
            out["destination"] = self._geocode_text(destination_text, self._route_geocode_city(out, "destination"), provider)

        return out

    def _route_geocode_city(self, args: Dict[str, Any], endpoint: str) -> str:
        """路线文本起终点转坐标时，优先使用端点自己的城市限定。"""
        endpoint_text = str(endpoint or "").strip()
        city = str(
            args.get(f"{endpoint_text}_city")
            or args.get(f"{endpoint_text}_region")
            or args.get("city")
            or args.get("region")
            or ""
        ).strip()

        return city

    def _geocode_text(self, address: str, city: Any = "", provider: str = "") -> Dict[str, float]:
        active_provider = str(provider or BAIDU_PROVIDER).strip().lower()
        self._assert_supported_provider(active_provider)
        args = {
            "address": str(address or "").strip(),
            "provider": active_provider,
        }
        city_text = str(city or "").strip()

        if city_text:
            args["city"] = city_text

        if active_provider == TIANDITU_PROVIDER:
            response = self._request_tianditu_geocode(args, args["address"])
            status = str(response.get("status") or "").strip()
            message = str(response.get("msg") or "").strip()

            if status != "0":
                raise ValueError(message or f"天地图地理编码接口返回状态 {status}")

            return self._extract_tianditu_geocode_point(response)

        response = self._request_baidu_geocode(args, args["address"])
        status = self._safe_int(response.get("status"), -1)
        message = str(response.get("message") or response.get("msg") or "").strip()

        if status != 0:
            raise ValueError(message or f"百度地理编码接口返回状态 {status}")

        result = response.get("result") if isinstance(response.get("result"), dict) else {}
        location = result.get("location") if isinstance(result.get("location"), dict) else {}

        return self._normalize_point(location, "geocode.location")

    def _load_json(self, text: str) -> Dict[str, Any]:
        payload = json.loads(str(text or "{}"))

        if not isinstance(payload, dict):
            raise ValueError("地图工具返回了非对象 JSON")

        return payload

    def _data_without_scene(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        data = copy.deepcopy(payload)
        data.pop("scene", None)
        data.pop("markdown", None)

        return data

    def _payload_summary(self, payload: Dict[str, Any], kind: str) -> Dict[str, Any]:
        if kind == "route":
            route = payload.get("route") if isinstance(payload.get("route"), dict) else {}
            summary = {
                "distance_kilometers": route.get("distance_kilometers"),
                "duration_minutes": route.get("duration_minutes"),
                "point_count": route.get("point_count"),
                "route_count": route.get("route_count"),
                "mode": payload.get("mode"),
                "origin": payload.get("origin"),
                "destination": payload.get("destination"),
            }

            if payload.get("mode") == "transit":
                summary["line_name"] = route.get("line_name")
                summary["has_subway"] = route.get("has_subway")
                summary["transit_schemes"] = route.get("transit_schemes") or payload.get("transit_schemes") or []

            return summary

        if kind == "distance":
            return {
                "distance_kilometers": payload.get("distance_kilometers"),
                "bearing_degrees": payload.get("bearing_degrees"),
                "origin": payload.get("origin"),
                "destination": payload.get("destination"),
            }

        if kind == "geocode":
            return {
                "address": payload.get("address"),
                "city": payload.get("city"),
                "point": payload.get("point"),
                "level": payload.get("level"),
                "confidence": payload.get("confidence"),
            }

        if kind == "poi":
            results = payload.get("results") if isinstance(payload.get("results"), list) else []
            preview = []

            for item in results[:5]:
                if isinstance(item, dict):
                    preview.append({
                        "name": item.get("name"),
                        "address": item.get("address"),
                        "point": item.get("point"),
                    })

            return {
                "query": payload.get("query"),
                "total": payload.get("total"),
                "returned": payload.get("returned"),
                "results_preview": preview,
            }

        return self._scene_summary(payload.get("scene") if isinstance(payload.get("scene"), dict) else {})

    def _scene_summary(self, scene: Dict[str, Any]) -> Dict[str, Any]:
        layers = scene.get("layers") if isinstance(scene.get("layers"), list) else []
        marker_count = 0
        route_count = 0
        point_count = 0

        for layer in layers:
            if not isinstance(layer, dict):
                continue

            layer_type = str(layer.get("type") or "").strip().lower()

            if layer_type == "marker":
                marker_count += 1

            if layer_type in {"route", "polyline", "line"}:
                route_count += 1
                geometry = layer.get("geometry") if isinstance(layer.get("geometry"), dict) else {}
                points = geometry.get("points") if isinstance(geometry.get("points"), list) else []
                point_count += len(points)

        return {
            "marker_count": marker_count,
            "route_count": route_count,
            "point_count": point_count,
        }

    def _default_title(self, payload: Dict[str, Any], kind: str) -> str:
        if kind == "route":
            return self._route_title(str(payload.get("mode") or "driving"))

        if kind == "distance":
            return "直线距离"

        if kind == "geocode":
            return str(payload.get("address") or "地点")

        if kind == "poi":
            return str(payload.get("query") or "地点搜索")

        return "地图"

    def _render_ref_markdown(self, map_id: Any, title: Any) -> str:
        mid = str(map_id or "").strip()
        payload = {
            "type": "nexora-map-ref",
            "mapId": mid,
            "map_id": mid,
            "renderId": mid,
            "conversationId": self.conversation_id,
            "conversation_id": self.conversation_id,
            "title": _clip_text(title, 120) or "地图",
        }
        body = json.dumps(payload, ensure_ascii=False, indent=4)

        return f"```nexora-map-ref\n{body}\n```"


def load_map_scene_for_map_id(username: str, conversation_id: str, map_id: str) -> Optional[Dict[str, Any]]:
    return BaiduMapRecordStore(username, conversation_id).scene_for_map_id(map_id)
