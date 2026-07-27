import json
import math
import hashlib
import re
import ssl
import xml.etree.ElementTree as ET
from html import unescape
from typing import Any, Dict, List, Tuple
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request


EARTH_RADIUS_METERS = 6371008.8
BAIDU_PROVIDER = "baidu"
TIANDITU_PROVIDER = "tianditu"
SUPPORTED_MAP_PROVIDERS = {BAIDU_PROVIDER, TIANDITU_PROVIDER}
SUPPORTED_ROUTE_MODES = {"driving", "walking", "riding", "transit"}
TIANDITU_ROUTE_MODES = {"driving", "transit"}
TIANDITU_ROUTE_RESULT_MESSAGES = {
    0: "正常返回线路",
    1: "找不到起点",
    2: "找不到终点",
    3: "规划线路失败",
    4: "起终点距离200米以内，不规划线路，建议步行",
    5: "起终点距离500米内，返回线路",
    6: "输入参数错误",
}


class MapToolService:
    """地图工具服务：负责标准化地图 scene、距离计算和 provider API 调用。"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config if isinstance(config, dict) else {}

    def render(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        scene = self._build_scene_from_args(safe_args)

        payload = {
            "success": True,
            "tool": "map_render",
            "scene": scene,
            "markdown": self._scene_to_markdown(scene),
        }

        return json.dumps(payload, ensure_ascii=False)

    def calc_distance(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        provider = self._resolve_provider(safe_args)
        self._assert_supported_provider(provider)
        origin = self._normalize_point(safe_args.get("origin") or safe_args.get("start"), "origin")
        destination = self._normalize_point(safe_args.get("destination") or safe_args.get("end"), "destination")
        distance_meters = self._haversine_distance(origin, destination)
        bearing_degrees = self._initial_bearing(origin, destination)
        title = str(safe_args.get("title") or "直线距离").strip()
        render_scene = self._coerce_bool(safe_args.get("render"), True)

        result = {
            "success": True,
            "tool": "map_calc_distance",
            "origin": origin,
            "destination": destination,
            "distance_meters": round(distance_meters, 3),
            "distance_kilometers": round(distance_meters / 1000, 3),
            "bearing_degrees": round(bearing_degrees, 3),
        }

        if render_scene:
            scene = self._build_distance_scene(title, origin, destination, provider)
            result["scene"] = scene
            result["markdown"] = self._scene_to_markdown(scene)

        return json.dumps(result, ensure_ascii=False)

    def calc_route(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        provider = self._resolve_provider(safe_args)
        self._assert_supported_provider(provider)

        mode = str(safe_args.get("mode") or "driving").strip().lower()

        if mode not in SUPPORTED_ROUTE_MODES:
            raise ValueError("mode 必须是 driving、walking、riding 或 transit")

        origin = self._normalize_point(safe_args.get("origin") or safe_args.get("start"), "origin")
        destination = self._normalize_point(safe_args.get("destination") or safe_args.get("end"), "destination")
        render_scene = self._coerce_bool(safe_args.get("render"), True)
        title = str(safe_args.get("title") or self._route_title(mode)).strip()

        if provider == TIANDITU_PROVIDER:
            return self._calc_tianditu_route(safe_args, mode, origin, destination, render_scene, title)

        return self._calc_baidu_route(safe_args, mode, origin, destination, render_scene, title)

    def _calc_baidu_route(
        self,
        safe_args: Dict[str, Any],
        mode: str,
        origin: Dict[str, float],
        destination: Dict[str, float],
        render_scene: bool,
        title: str,
    ) -> str:
        response = self._request_baidu_route(safe_args, mode, origin, destination)
        status = self._safe_int(response.get("status"), -1)
        message = str(response.get("message") or "").strip()

        if status != 0:
            payload = {
                "success": False,
                "tool": "map_calc_route",
                "provider": BAIDU_PROVIDER,
                "mode": mode,
                "message": message or f"百度路线接口返回状态 {status}",
                "provider_status": {
                    "status": status,
                    "message": message,
                },
            }

            return json.dumps(payload, ensure_ascii=False)

        result = response.get("result") if isinstance(response.get("result"), dict) else {}
        routes = result.get("routes") if isinstance(result.get("routes"), list) else []
        route = routes[0] if routes and isinstance(routes[0], dict) else {}
        transit_schemes = self._extract_baidu_transit_schemes(routes) if mode == "transit" else []
        points = self._extract_baidu_route_points(route)
        distance_meters = self._optional_float(route.get("distance"))
        duration_seconds = self._optional_float(route.get("duration"))
        route_summary = {
            "distance_meters": distance_meters,
            "distance_kilometers": round(distance_meters / 1000, 3) if distance_meters is not None else None,
            "duration_seconds": duration_seconds,
            "duration_minutes": round(duration_seconds / 60, 1) if duration_seconds is not None else None,
            "route_count": len(routes),
            "point_count": len(points),
        }

        if mode == "transit":
            route_summary["transit_schemes"] = transit_schemes

        if not points:
            if mode == "transit" and transit_schemes:
                return json.dumps({
                    "success": True,
                    "tool": "map_calc_route",
                    "provider": BAIDU_PROVIDER,
                    "mode": mode,
                    "origin": origin,
                    "destination": destination,
                    "route": route_summary,
                    "transit_schemes": transit_schemes,
                    "message": "百度公交路线接口未返回可渲染路径点，已返回公共交通方案。",
                    "provider_status": {
                        "status": status,
                        "message": message,
                    },
                }, ensure_ascii=False)

            return json.dumps({
                "success": False,
                "tool": "map_calc_route",
                "provider": BAIDU_PROVIDER,
                "mode": mode,
                "message": "百度路线接口未返回可渲染的真实路径点",
                "provider_status": {
                    "status": status,
                    "message": message,
                },
            }, ensure_ascii=False)

        payload = {
            "success": True,
            "tool": "map_calc_route",
            "provider": BAIDU_PROVIDER,
            "mode": mode,
            "origin": origin,
            "destination": destination,
            "route": route_summary,
            "provider_status": {
                "status": status,
                "message": message,
            },
        }

        if mode == "transit":
            payload["transit_schemes"] = route_summary["transit_schemes"]

        if render_scene:
            scene = self._build_route_scene(title, origin, destination, points, route_summary, BAIDU_PROVIDER)
            payload["scene"] = scene
            payload["markdown"] = self._scene_to_markdown(scene)

        return json.dumps(payload, ensure_ascii=False)

    def _calc_tianditu_route(
        self,
        safe_args: Dict[str, Any],
        mode: str,
        origin: Dict[str, float],
        destination: Dict[str, float],
        render_scene: bool,
        title: str,
    ) -> str:
        if mode not in TIANDITU_ROUTE_MODES:
            raise ValueError("天地图路线规划目前支持 driving 和 transit")

        response = self._request_tianditu_route(safe_args, mode, origin, destination)
        status = self._tianditu_route_status(response, mode)
        message = self._tianditu_route_message(status, response)

        if status != 0:
            return json.dumps({
                "success": False,
                "tool": "map_calc_route",
                "provider": TIANDITU_PROVIDER,
                "mode": mode,
                "message": message or f"天地图路线接口返回状态 {status}",
                "provider_status": {
                    "status": status,
                    "message": message,
                },
            }, ensure_ascii=False)

        route_info = self._extract_tianditu_route_info(response, mode)
        points = route_info.get("points") if isinstance(route_info.get("points"), list) else []
        route_summary = {
            "distance_meters": route_info.get("distance_meters"),
            "distance_kilometers": route_info.get("distance_kilometers"),
            "duration_seconds": route_info.get("duration_seconds"),
            "duration_minutes": route_info.get("duration_minutes"),
            "route_count": route_info.get("route_count"),
            "point_count": len(points),
            "line_name": route_info.get("line_name"),
        }

        if mode == "transit":
            route_summary["has_subway"] = route_info.get("has_subway")
            route_summary["transit_schemes"] = route_info.get("transit_schemes") or []

        if not points:
            if mode == "transit" and route_summary.get("transit_schemes"):
                return json.dumps({
                    "success": True,
                    "tool": "map_calc_route",
                    "provider": TIANDITU_PROVIDER,
                    "mode": mode,
                    "origin": origin,
                    "destination": destination,
                    "route": route_summary,
                    "transit_schemes": route_summary["transit_schemes"],
                    "message": "天地图公交路线接口未返回可渲染路径点，已返回公共交通方案。",
                    "provider_status": {
                        "status": status,
                        "message": message,
                    },
                }, ensure_ascii=False)

            return json.dumps({
                "success": False,
                "tool": "map_calc_route",
                "provider": TIANDITU_PROVIDER,
                "mode": mode,
                "message": "天地图路线接口未返回可渲染的真实路径点",
                "provider_status": {
                    "status": status,
                    "message": message,
                },
            }, ensure_ascii=False)

        payload = {
            "success": True,
            "tool": "map_calc_route",
            "provider": TIANDITU_PROVIDER,
            "mode": mode,
            "origin": origin,
            "destination": destination,
            "route": route_summary,
            "provider_status": {
                "status": status,
                "message": message,
            },
        }

        if mode == "transit":
            payload["transit_schemes"] = route_summary["transit_schemes"]

        if render_scene:
            scene = self._build_route_scene(title, origin, destination, points, route_summary, TIANDITU_PROVIDER)
            payload["scene"] = scene
            payload["markdown"] = self._scene_to_markdown(scene)

        return json.dumps(payload, ensure_ascii=False)

    def geocode(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        address = str(safe_args.get("address") or "").strip()

        if not address:
            raise ValueError("address 不能为空")

        provider = self._resolve_provider(safe_args)
        self._assert_supported_provider(provider)

        if provider == TIANDITU_PROVIDER:
            return self._geocode_tianditu(safe_args, address)

        response = self._request_baidu_geocode(safe_args, address)
        status = self._safe_int(response.get("status"), -1)
        message = str(response.get("message") or response.get("msg") or "").strip()

        if status != 0:
            return json.dumps({
                "success": False,
                "tool": "map_geocode",
                "provider": BAIDU_PROVIDER,
                "message": message or f"百度地理编码接口返回状态 {status}",
                "provider_status": {
                    "status": status,
                    "message": message,
                },
            }, ensure_ascii=False)

        result = response.get("result") if isinstance(response.get("result"), dict) else {}
        location = result.get("location") if isinstance(result.get("location"), dict) else {}
        point = self._normalize_point(location, "result.location")
        scene = self._build_marker_scene(str(safe_args.get("title") or address).strip(), point, address, BAIDU_PROVIDER)
        payload = {
            "success": True,
            "tool": "map_geocode",
            "provider": BAIDU_PROVIDER,
            "address": address,
            "city": str(safe_args.get("city") or "").strip(),
            "point": point,
            "precise": result.get("precise"),
            "confidence": result.get("confidence"),
            "comprehension": result.get("comprehension"),
            "level": result.get("level"),
            "scene": scene,
            "markdown": self._scene_to_markdown(scene),
        }

        return json.dumps(payload, ensure_ascii=False)

    def _geocode_tianditu(self, safe_args: Dict[str, Any], address: str) -> str:
        response = self._request_tianditu_geocode(safe_args, address)
        status = str(response.get("status") or "").strip()
        message = str(response.get("msg") or "").strip()

        if status != "0":
            return json.dumps({
                "success": False,
                "tool": "map_geocode",
                "provider": TIANDITU_PROVIDER,
                "message": message or f"天地图地理编码接口返回状态 {status}",
                "provider_status": {
                    "status": status,
                    "message": message,
                },
            }, ensure_ascii=False)

        point = self._extract_tianditu_geocode_point(response)
        location = response.get("location") if isinstance(response.get("location"), dict) else {}
        scene = self._build_marker_scene(str(safe_args.get("title") or address).strip(), point, address, TIANDITU_PROVIDER)
        payload = {
            "success": True,
            "tool": "map_geocode",
            "provider": TIANDITU_PROVIDER,
            "address": address,
            "city": str(safe_args.get("city") or "").strip(),
            "point": point,
            "precise": None,
            "confidence": self._safe_float(location.get("score"), None) if location.get("score") is not None else None,
            "comprehension": None,
            "level": str(location.get("level") or "").strip(),
            "scene": scene,
            "markdown": self._scene_to_markdown(scene),
        }

        return json.dumps(payload, ensure_ascii=False)

    def poi_search(self, args: Dict[str, Any]) -> str:
        safe_args = args if isinstance(args, dict) else {}
        query = str(safe_args.get("query") or "").strip()

        if not query:
            raise ValueError("query 不能为空")

        provider = self._resolve_provider(safe_args)
        self._assert_supported_provider(provider)

        if provider == TIANDITU_PROVIDER:
            return self._poi_search_tianditu(safe_args, query)

        response = self._request_baidu_place_search(safe_args, query)
        status = self._safe_int(response.get("status"), -1)
        message = str(response.get("message") or response.get("msg") or "").strip()

        if status != 0:
            return json.dumps({
                "success": False,
                "tool": "map_poi_search",
                "provider": BAIDU_PROVIDER,
                "message": message or f"百度地点检索接口返回状态 {status}",
                "provider_status": {
                    "status": status,
                    "message": message,
                },
            }, ensure_ascii=False)

        raw_results = response.get("results") if isinstance(response.get("results"), list) else []
        limit = self._clamp_int(safe_args.get("limit"), 1, 20, 8)
        results = []

        for item in raw_results[:limit]:
            if not isinstance(item, dict):
                continue

            location = item.get("location") if isinstance(item.get("location"), dict) else {}
            point = self._normalize_point(location, "result.location")
            results.append({
                "name": str(item.get("name") or "").strip(),
                "address": str(item.get("address") or "").strip(),
                "province": str(item.get("province") or "").strip(),
                "city": str(item.get("city") or "").strip(),
                "area": str(item.get("area") or "").strip(),
                "uid": str(item.get("uid") or "").strip(),
                "point": point,
            })

        scene = self._build_poi_scene(str(safe_args.get("title") or query).strip(), results, BAIDU_PROVIDER)
        payload = {
            "success": True,
            "tool": "map_poi_search",
            "provider": BAIDU_PROVIDER,
            "query": query,
            "total": len(raw_results),
            "returned": len(results),
            "results": results,
            "scene": scene,
            "markdown": self._scene_to_markdown(scene),
        }

        return json.dumps(payload, ensure_ascii=False)

    def _poi_search_tianditu(self, safe_args: Dict[str, Any], query: str) -> str:
        response = self._request_tianditu_place_search(safe_args, query)
        status = response.get("status") if isinstance(response.get("status"), dict) else {}
        infocode = self._safe_int(status.get("infocode"), -1)
        message = str(status.get("cndesc") or response.get("msg") or "").strip()

        if infocode != 1000:
            return json.dumps({
                "success": False,
                "tool": "map_poi_search",
                "provider": TIANDITU_PROVIDER,
                "message": message or f"天地图地点检索接口返回状态 {infocode}",
                "provider_status": {
                    "status": infocode,
                    "message": message,
                },
            }, ensure_ascii=False)

        raw_results = response.get("pois") if isinstance(response.get("pois"), list) else []
        limit = self._clamp_int(safe_args.get("limit"), 1, 20, 8)
        results = []

        for item in raw_results[:limit]:
            if not isinstance(item, dict):
                continue

            point = self._parse_single_path_point(item.get("lonlat"), "poi.lonlat")
            results.append({
                "name": str(item.get("name") or "").strip(),
                "address": str(item.get("address") or "").strip(),
                "province": "",
                "city": "",
                "area": "",
                "uid": str(item.get("hotPointID") or "").strip(),
                "point": point,
            })

        scene = self._build_poi_scene(str(safe_args.get("title") or query).strip(), results, TIANDITU_PROVIDER)
        payload = {
            "success": True,
            "tool": "map_poi_search",
            "provider": TIANDITU_PROVIDER,
            "query": query,
            "total": self._safe_int(response.get("count"), len(raw_results)),
            "returned": len(results),
            "results": results,
            "scene": scene,
            "markdown": self._scene_to_markdown(scene),
        }

        return json.dumps(payload, ensure_ascii=False)

    def _resolve_provider(self, args: Dict[str, Any]) -> str:
        map_cfg = self._map_config()
        provider = str(args.get("provider") or map_cfg.get("provider") or BAIDU_PROVIDER).strip().lower()

        return provider or BAIDU_PROVIDER

    def _assert_supported_provider(self, provider: str) -> None:
        if provider not in SUPPORTED_MAP_PROVIDERS:
            raise ValueError(f"暂不支持地图 provider：{provider}")

    def _provider_coordinate_system(self, provider: str) -> str:
        if provider == TIANDITU_PROVIDER:
            tianditu_cfg = self._tianditu_config()

            return str(tianditu_cfg.get("coord_type") or "cgcs2000").strip() or "cgcs2000"

        baidu_cfg = self._baidu_config()

        return str(baidu_cfg.get("ret_coordtype") or baidu_cfg.get("coord_type") or "bd09ll").strip() or "bd09ll"

    def _map_config(self) -> Dict[str, Any]:
        cfg = self.config.get("map_service") if isinstance(self.config.get("map_service"), dict) else {}

        return cfg

    def _baidu_config(self) -> Dict[str, Any]:
        map_cfg = self._map_config()
        baidu_cfg = map_cfg.get("baidu") if isinstance(map_cfg.get("baidu"), dict) else {}

        return baidu_cfg

    def _tianditu_config(self) -> Dict[str, Any]:
        map_cfg = self._map_config()
        tianditu_cfg = map_cfg.get("tianditu") if isinstance(map_cfg.get("tianditu"), dict) else {}

        return tianditu_cfg

    def _baidu_server_ak(self) -> str:
        ak = str(self._baidu_config().get("server_ak") or "").strip()

        if not ak:
            raise ValueError("map_service.baidu.server_ak 未配置")

        return ak

    def _baidu_auth_mode(self) -> str:
        mode = str(self._baidu_config().get("auth_mode") or "ak").strip().lower()

        if mode not in {"ak", "sn"}:
            raise ValueError("map_service.baidu.auth_mode 必须是 ak 或 sn")

        return mode

    def _baidu_server_sk(self) -> str:
        sk = str(self._baidu_config().get("server_sk") or "").strip()

        if self._baidu_auth_mode() == "sn" and not sk:
            raise ValueError("map_service.baidu.server_sk 未配置，无法为 SN 校验 AK 计算 sn")

        return sk

    def _baidu_timeout(self) -> float:
        timeout = self._safe_float(self._baidu_config().get("timeout"), 12.0)

        return max(1.0, min(float(timeout or 12.0), 60.0))

    def _tianditu_server_tk(self) -> str:
        tk = str(self._tianditu_config().get("server_tk") or self._tianditu_config().get("tk") or "").strip()

        if not tk:
            raise ValueError("map_service.tianditu.server_tk 未配置")

        return tk

    def _tianditu_timeout(self) -> float:
        timeout = self._safe_float(self._tianditu_config().get("timeout"), 12.0)

        return max(1.0, min(float(timeout or 12.0), 60.0))

    def _build_baidu_url(self, base_url: str, params: Dict[str, Any], path_suffix: str = "") -> str:
        base_text = str(base_url or "").strip()

        if not base_text:
            raise ValueError("百度地图接口地址不能为空")

        parts = urllib_parse.urlsplit(base_text)

        if not parts.scheme or not parts.netloc:
            raise ValueError(f"百度地图接口地址无效：{base_text}")

        path = parts.path or "/"
        suffix = str(path_suffix or "").strip("/")

        if suffix:
            path = path.rstrip("/") + "/" + suffix

        query_parts = []

        if parts.query:
            query_parts.append(parts.query)

        query_parts.append(urllib_parse.urlencode(params))
        query = "&".join(part for part in query_parts if part)
        sk = self._baidu_server_sk()

        if sk:
            query = self._append_baidu_sn(path, query, sk)

        return urllib_parse.urlunsplit((parts.scheme, parts.netloc, path, query, ""))

    def _append_baidu_sn(self, path: str, query: str, sk: str) -> str:
        unsigned_query = f"{path}?{query}"
        encoded_source = urllib_parse.quote_plus(unsigned_query + sk)
        sn = hashlib.md5(encoded_source.encode("utf-8")).hexdigest()

        return f"{query}&sn={sn}"

    def _build_tianditu_url(self, base_url: str, params: Dict[str, Any]) -> str:
        base_text = str(base_url or "").strip()

        if not base_text:
            raise ValueError("天地图接口地址不能为空")

        parts = urllib_parse.urlsplit(base_text)

        if not parts.scheme or not parts.netloc:
            raise ValueError(f"天地图接口地址无效：{base_text}")

        query_parts = []

        if parts.query:
            query_parts.append(parts.query)

        query_parts.append(urllib_parse.urlencode(params))
        query = "&".join(part for part in query_parts if part)

        return urllib_parse.urlunsplit((parts.scheme, parts.netloc, parts.path or "/", query, ""))

    def _build_ssl_context(self) -> ssl.SSLContext:
        try:
            import certifi
            return ssl.create_default_context(cafile=certifi.where())
        except Exception:
            return ssl.create_default_context()

    def _request_text(self, url: str, timeout: float, user_agent: str = "NexoraMapTools/1.0") -> str:
        req = urllib_request.Request(url, headers={
            "User-Agent": str(user_agent or "NexoraMapTools/1.0"),
        })

        ctx = self._build_ssl_context()

        try:
            with urllib_request.urlopen(req, timeout=timeout, context=ctx) as resp:
                data = resp.read()
        except urllib_error.HTTPError as exc:
            data = exc.read()

        return data.decode("utf-8-sig")

    def _request_json(
        self,
        url: str,
        timeout: Any = None,
        user_agent: str = "NexoraMapTools/1.0",
    ) -> Dict[str, Any]:
        actual_timeout = self._safe_float(timeout, self._baidu_timeout())
        text = self._request_text(url, actual_timeout, user_agent)
        payload = json.loads(text)

        if not isinstance(payload, dict):
            raise ValueError("地图 provider 返回了非对象 JSON")

        return payload

    def _request_baidu_route(self, args: Dict[str, Any], mode: str, origin: Dict[str, float], destination: Dict[str, float]) -> Dict[str, Any]:
        baidu_cfg = self._baidu_config()
        base_url = str(baidu_cfg.get("direction_base_url") or "https://api.map.baidu.com/direction/v2").rstrip("/")
        coord_type = str(args.get("coord_type") or args.get("coordType") or baidu_cfg.get("coord_type") or "bd09ll").strip()
        ret_coordtype = str(args.get("ret_coordtype") or args.get("retCoordtype") or baidu_cfg.get("ret_coordtype") or "bd09ll").strip()
        params = {
            "origin": self._baidu_lat_lng(origin),
            "destination": self._baidu_lat_lng(destination),
            "coord_type": coord_type,
            "ret_coordtype": ret_coordtype,
            "ak": self._baidu_server_ak(),
        }

        if mode == "transit":
            for key in ("origin_region", "destination_region", "city"):
                value = str(args.get(key) or "").strip()

                if value:
                    params[key] = value

        tactics = args.get("tactics")

        if tactics is not None and str(tactics).strip() != "":
            params["tactics"] = str(tactics).strip()

        url = self._build_baidu_url(base_url, params, mode)

        return self._request_json(url)

    def _request_baidu_geocode(self, args: Dict[str, Any], address: str) -> Dict[str, Any]:
        baidu_cfg = self._baidu_config()
        base_url = str(baidu_cfg.get("geocoding_url") or "https://api.map.baidu.com/geocoding/v3/").strip()
        city = self._require_geocode_city(args, address)
        params = {
            "address": address,
            "output": "json",
            "ak": self._baidu_server_ak(),
            "city": city,
        }

        url = self._build_baidu_url(base_url, params)

        return self._request_json(url)

    def _request_baidu_place_search(self, args: Dict[str, Any], query_text: str) -> Dict[str, Any]:
        baidu_cfg = self._baidu_config()
        base_url = str(baidu_cfg.get("place_search_url") or "https://api.map.baidu.com/place/v2/search").strip()
        params = {
            "query": query_text,
            "output": "json",
            "ak": self._baidu_server_ak(),
        }
        location = args.get("location")

        if location is not None:
            point = self._normalize_point(location, "location")
            params["location"] = self._baidu_lat_lng(point)
            params["radius"] = str(self._clamp_int(args.get("radius"), 1, 50000, 3000))
        else:
            region = str(args.get("region") or "").strip()

            if not region:
                raise ValueError("map_poi_search 需要 region，或者提供 location + radius")

            params["region"] = region

        page_size = self._clamp_int(args.get("limit"), 1, 20, 8)
        params["page_size"] = str(page_size)
        params["page_num"] = str(max(0, self._safe_int(args.get("page_num"), 0)))

        url = self._build_baidu_url(base_url, params)

        return self._request_json(url)

    def _request_tianditu_route(self, args: Dict[str, Any], mode: str, origin: Dict[str, float], destination: Dict[str, float]) -> Dict[str, Any]:
        tianditu_cfg = self._tianditu_config()
        tk = self._tianditu_server_tk()

        if mode == "driving":
            base_url = str(tianditu_cfg.get("drive_url") or "https://api.tianditu.gov.cn/drive").strip()
            post_data = {
                "orig": self._tianditu_lng_lat(origin),
                "dest": self._tianditu_lng_lat(destination),
                "style": str(args.get("style") or args.get("tactics") or tianditu_cfg.get("driving_style") or "0").strip(),
            }
            url = self._build_tianditu_url(base_url, {
                "postStr": json.dumps(post_data, ensure_ascii=False, separators=(",", ":")),
                "type": "search",
                "tk": tk,
            })
            text = self._request_text(url, self._tianditu_timeout(), "Mozilla/5.0")

            return {
                "format": "xml",
                "text": text,
            }

        base_url = str(tianditu_cfg.get("transit_url") or "https://api.tianditu.gov.cn/transit").strip()
        post_data = {
            "startposition": self._tianditu_lng_lat(origin),
            "endposition": self._tianditu_lng_lat(destination),
            "linetype": str(args.get("linetype") or args.get("line_type") or args.get("tactics") or tianditu_cfg.get("transit_linetype") or "7").strip(),
        }
        url = self._build_tianditu_url(base_url, {
            "postStr": json.dumps(post_data, ensure_ascii=False, separators=(",", ":")),
            "type": "busline",
            "tk": tk,
        })
        payload = self._request_json(url, self._tianditu_timeout(), "Mozilla/5.0")
        payload["format"] = "json"

        return payload

    def _request_tianditu_geocode(self, args: Dict[str, Any], address: str) -> Dict[str, Any]:
        tianditu_cfg = self._tianditu_config()
        base_url = str(tianditu_cfg.get("geocoding_url") or "https://api.tianditu.gov.cn/geocoder").strip()
        city = self._require_geocode_city(args, address)
        ds = {
            "keyWord": self._tianditu_geocode_keyword(city, address),
        }
        url = self._build_tianditu_url(base_url, {
            "ds": json.dumps(ds, ensure_ascii=False, separators=(",", ":")),
            "tk": self._tianditu_server_tk(),
        })

        return self._request_json(url, self._tianditu_timeout(), "Mozilla/5.0")

    def _request_tianditu_place_search(self, args: Dict[str, Any], query_text: str) -> Dict[str, Any]:
        tianditu_cfg = self._tianditu_config()
        base_url = str(tianditu_cfg.get("place_search_url") or "https://api.tianditu.gov.cn/v2/search").strip()
        post_data = {
            "keyWord": query_text,
            "level": str(args.get("level") or tianditu_cfg.get("search_level") or "12").strip(),
            "start": str(max(0, self._safe_int(args.get("page_num"), 0)) * self._clamp_int(args.get("limit"), 1, 20, 8)),
            "count": str(self._clamp_int(args.get("limit"), 1, 20, 8)),
        }
        location = args.get("location")

        if location is not None:
            point = self._normalize_point(location, "location")
            post_data["queryType"] = "3"
            post_data["pointLonlat"] = self._tianditu_lng_lat(point)
            post_data["queryRadius"] = str(self._clamp_int(args.get("radius"), 1, 50000, 3000))
        else:
            region = str(args.get("region") or "").strip()

            if not region:
                raise ValueError("map_poi_search 使用天地图时需要 region，或者提供 location + radius")

            post_data["queryType"] = "12"
            post_data["specify"] = region

        url = self._build_tianditu_url(base_url, {
            "postStr": json.dumps(post_data, ensure_ascii=False, separators=(",", ":")),
            "type": "query",
            "tk": self._tianditu_server_tk(),
        })

        return self._request_json(url, self._tianditu_timeout(), "Mozilla/5.0")

    def _require_geocode_city(self, args: Dict[str, Any], address: str) -> str:
        """文本地理编码必须带城市或行政区，避免短名称被 provider 匹配到同名地点。"""
        city = str(args.get("city") or args.get("region") or "").strip()

        if city:
            return city

        raise ValueError(
            f"地图文本地理编码必须提供 city 或 region。address={address!r}；"
            "例如 city='上海' address='东方明珠广播电视塔'。"
            "海外地点不要使用百度/天地图文本地理编码，请直接传经纬度给 map_render。"
        )

    def _tianditu_geocode_keyword(self, city: str, address: str) -> str:
        """天地图地理编码没有独立 city 参数，需要把行政区写入 keyWord。"""
        city_text = str(city or "").strip()
        address_text = str(address or "").strip()

        if not city_text or address_text.startswith(city_text):
            return address_text

        return f"{city_text}{address_text}"

    def _build_scene_from_args(self, args: Dict[str, Any]) -> Dict[str, Any]:
        if isinstance(args.get("scene"), dict):
            scene = dict(args.get("scene") or {})
        else:
            provider = self._resolve_provider(args)
            self._assert_supported_provider(provider)
            scene = {
                "type": "nexora-map",
                "provider": provider,
                "title": str(args.get("title") or "地图").strip(),
                "coordinateSystem": str(args.get("coordinate_system") or args.get("coordinateSystem") or self._provider_coordinate_system(provider)).strip(),
                "viewport": {
                    "fitBounds": self._coerce_bool(args.get("fit_bounds"), True),
                },
                "layers": [],
            }
            center = args.get("center")
            zoom = args.get("zoom")

            if center is not None:
                scene["center"] = self._normalize_point(center, "center")

            if zoom is not None:
                scene["zoom"] = self._clamp_int(zoom, 3, 19, 11)

            for marker in self._normalize_markers(args.get("markers")):
                scene["layers"].append(marker)

            for route in self._normalize_route_layers(args.get("routes") or args.get("polylines"), provider):
                scene["layers"].append(route)

            for layer in args.get("layers") or []:
                if isinstance(layer, dict):
                    scene["layers"].append(layer)

        scene["type"] = "nexora-map"
        scene["provider"] = str(scene.get("provider") or self._resolve_provider(args)).strip().lower()
        self._assert_supported_provider(scene["provider"])
        scene["coordinateSystem"] = str(scene.get("coordinateSystem") or scene.get("coordinate_system") or self._provider_coordinate_system(scene["provider"])).strip()

        return scene

    def _normalize_markers(self, raw_markers: Any) -> List[Dict[str, Any]]:
        if raw_markers is None:
            return []

        if not isinstance(raw_markers, list):
            raise ValueError("markers 必须是数组")

        layers = []

        for index, marker in enumerate(raw_markers):
            if not isinstance(marker, dict):
                raise ValueError(f"markers[{index}] 必须是对象")

            point = self._normalize_point(marker.get("point") or marker.get("position") or marker, f"markers[{index}]")
            layers.append({
                "type": "marker",
                "id": str(marker.get("id") or f"marker-{index + 1}"),
                "label": str(marker.get("label") or marker.get("name") or marker.get("title") or f"标记 {index + 1}").strip(),
                "position": point,
            })

        return layers

    def _normalize_route_layers(self, raw_routes: Any, provider: str = BAIDU_PROVIDER) -> List[Dict[str, Any]]:
        if raw_routes is None:
            return []

        if not isinstance(raw_routes, list):
            raise ValueError("routes 必须是数组")

        layers = []

        for index, route in enumerate(raw_routes):
            if not isinstance(route, dict):
                raise ValueError(f"routes[{index}] 必须是对象")

            points = self._normalize_points(route.get("points") or route.get("path") or route.get("coordinates"), f"routes[{index}].points")
            layers.append({
                "type": str(route.get("type") or "route"),
                "id": str(route.get("id") or f"route-{index + 1}"),
                "label": str(route.get("label") or route.get("name") or route.get("title") or f"路线 {index + 1}").strip(),
                "geometry": {
                    "coordType": str(route.get("coordType") or route.get("coord_type") or self._provider_coordinate_system(provider)),
                    "points": points,
                },
                "style": {
                    "color": str(route.get("color") or "#2563eb"),
                    "width": self._safe_float(route.get("width") or route.get("weight"), 6),
                },
            })

        return layers

    def _build_distance_scene(
        self,
        title: str,
        origin: Dict[str, float],
        destination: Dict[str, float],
        provider: str = BAIDU_PROVIDER,
    ) -> Dict[str, Any]:
        return {
            "type": "nexora-map",
            "provider": provider,
            "title": title,
            "coordinateSystem": self._provider_coordinate_system(provider),
            "viewport": {
                "fitBounds": True,
            },
            "layers": [
                {
                    "type": "marker",
                    "id": "origin",
                    "label": "起点",
                    "position": origin,
                },
                {
                    "type": "marker",
                    "id": "destination",
                    "label": "终点",
                    "position": destination,
                },
                {
                    "type": "route",
                    "id": "straight-distance",
                    "label": "直线距离",
                    "geometry": {
                        "coordType": self._provider_coordinate_system(provider),
                        "points": [origin, destination],
                    },
                    "style": {
                        "color": "#64748b",
                        "width": 4,
                        "opacity": 0.72,
                    },
                },
            ],
        }

    def _build_route_scene(
        self,
        title: str,
        origin: Dict[str, float],
        destination: Dict[str, float],
        route_points: List[Dict[str, float]],
        route_summary: Dict[str, Any],
        provider: str = BAIDU_PROVIDER,
    ) -> Dict[str, Any]:
        if not route_points:
            raise ValueError("路线 scene 必须包含真实路径点")

        route_color = "#0f766e" if provider == TIANDITU_PROVIDER else "#2563eb"
        coordinate_system = self._provider_coordinate_system(provider)

        return {
            "type": "nexora-map",
            "provider": provider,
            "title": title,
            "subtitle": self._route_subtitle(route_summary),
            "coordinateSystem": coordinate_system,
            "viewport": {
                "fitBounds": True,
            },
            "layers": [
                {
                    "type": "marker",
                    "id": "origin",
                    "label": "起点",
                    "position": origin,
                },
                {
                    "type": "marker",
                    "id": "destination",
                    "label": "终点",
                    "position": destination,
                },
                {
                    "type": "route",
                    "id": "route-main",
                    "label": title,
                    "geometry": {
                        "coordType": coordinate_system,
                        "points": route_points,
                    },
                    "style": {
                        "color": route_color,
                        "width": 7,
                        "outlineColor": "#ffffff",
                        "outlineWidth": 11,
                        "opacity": 0.9,
                    },
                },
            ],
        }

    def _build_marker_scene(
        self,
        title: str,
        point: Dict[str, float],
        label: str,
        provider: str = BAIDU_PROVIDER,
    ) -> Dict[str, Any]:
        return {
            "type": "nexora-map",
            "provider": provider,
            "title": title,
            "center": point,
            "zoom": 14,
            "coordinateSystem": self._provider_coordinate_system(provider),
            "layers": [
                {
                    "type": "marker",
                    "id": "geocode-result",
                    "label": label,
                    "position": point,
                },
            ],
        }

    def _build_poi_scene(
        self,
        title: str,
        results: List[Dict[str, Any]],
        provider: str = BAIDU_PROVIDER,
    ) -> Dict[str, Any]:
        layers = []

        for index, item in enumerate(results):
            layers.append({
                "type": "marker",
                "id": str(item.get("uid") or f"poi-{index + 1}"),
                "label": str(item.get("name") or f"地点 {index + 1}"),
                "position": item.get("point"),
            })

        return {
            "type": "nexora-map",
            "provider": provider,
            "title": title,
            "coordinateSystem": self._provider_coordinate_system(provider),
            "viewport": {
                "fitBounds": True,
            },
            "layers": layers,
        }

    def _extract_baidu_route_points(self, route: Dict[str, Any]) -> List[Dict[str, float]]:
        raw_paths = []
        self._collect_path_values(route.get("steps"), raw_paths)
        points = []

        for raw_path in raw_paths:
            points.extend(self._parse_path_points(raw_path))

        return self._dedupe_adjacent_points(points)

    def _extract_baidu_transit_schemes(self, routes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        schemes = []

        for index, route in enumerate(routes[:5]):
            if not isinstance(route, dict):
                continue

            distance_meters = self._optional_float(route.get("distance"))
            duration_seconds = self._optional_float(route.get("duration"))
            steps = self._extract_baidu_transit_steps(route.get("steps"))
            line_names = [str(step.get("line_name") or "").strip() for step in steps if str(step.get("line_name") or "").strip()]
            scheme = {
                "index": index + 1,
                "line_name": " - ".join(line_names),
                "distance_meters": distance_meters,
                "distance_kilometers": round(distance_meters / 1000, 3) if distance_meters is not None else None,
                "duration_seconds": duration_seconds,
                "duration_minutes": round(duration_seconds / 60, 1) if duration_seconds is not None else None,
                "step_count": len(steps),
                "steps": steps,
            }
            schemes.append(self._compact_dict(scheme))

        return schemes

    def _extract_baidu_transit_steps(self, raw_steps: Any) -> List[Dict[str, Any]]:
        steps = []

        for index, item in enumerate(self._flatten_baidu_steps(raw_steps)):
            vehicle = item.get("vehicle_info") if isinstance(item.get("vehicle_info"), dict) else {}
            detail = vehicle.get("detail") if isinstance(vehicle.get("detail"), dict) else {}
            line_name = self._first_text(
                detail.get("name"),
                detail.get("line_name"),
                detail.get("lineName"),
                item.get("line_name"),
                item.get("lineName"),
            )
            instruction = self._clean_provider_text(self._first_text(
                item.get("stepInstruction"),
                item.get("instructions"),
                item.get("instruction"),
            ))
            step = {
                "index": index + 1,
                "type": self._first_text(vehicle.get("type"), item.get("type")),
                "instruction": instruction,
                "line_name": line_name,
                "distance_meters": self._optional_float(item.get("distance")),
                "duration_seconds": self._optional_float(item.get("duration")),
                "start_station": self._baidu_station_name(detail.get("on_station") or detail.get("start_station")),
                "end_station": self._baidu_station_name(detail.get("off_station") or detail.get("end_station")),
                "stop_count": self._optional_int(detail.get("stop_num") or detail.get("stop_count")),
            }
            steps.append(self._compact_dict(step))

        return steps

    def _flatten_baidu_steps(self, value: Any) -> List[Dict[str, Any]]:
        if isinstance(value, dict):
            return [value]

        if not isinstance(value, list):
            return []

        steps = []

        for item in value:
            if isinstance(item, dict):
                steps.append(item)

            elif isinstance(item, list):
                steps.extend(self._flatten_baidu_steps(item))

        return steps

    def _baidu_station_name(self, value: Any) -> str:
        if isinstance(value, dict):
            return self._first_text(value.get("name"), value.get("title"), value.get("uid"))

        return self._first_text(value)

    def _tianditu_route_status(self, response: Dict[str, Any], mode: str) -> int:
        if mode == "driving":
            text = str(response.get("text") or "").strip()

            if not text:
                return -1

            try:
                root = ET.fromstring(text)
            except ET.ParseError:
                return -1

            if root.findtext("distance") is None or root.findtext("duration") is None:
                return -1

            return 0

        return self._safe_int(response.get("resultCode"), -1)

    def _tianditu_route_message(self, status: int, response: Dict[str, Any]) -> str:
        if status in TIANDITU_ROUTE_RESULT_MESSAGES:
            return TIANDITU_ROUTE_RESULT_MESSAGES[status]

        if response.get("msg"):
            return str(response.get("msg") or "").strip()

        return ""

    def _extract_tianditu_route_info(self, response: Dict[str, Any], mode: str) -> Dict[str, Any]:
        if mode == "driving":
            return self._extract_tianditu_driving_route_info(response)

        return self._extract_tianditu_transit_route_info(response)

    def _extract_tianditu_driving_route_info(self, response: Dict[str, Any]) -> Dict[str, Any]:
        text = str(response.get("text") or "").strip()
        root = ET.fromstring(text)
        raw_path = root.findtext("routelatlon") or ""
        points = self._dedupe_adjacent_points(self._parse_path_points(raw_path))
        distance_kilometers = self._safe_float(root.findtext("distance"), None, "tianditu.distance")
        duration_seconds = self._safe_float(root.findtext("duration"), None, "tianditu.duration")
        routes = root.find("routes")
        route_count = self._safe_int(routes.attrib.get("count") if routes is not None else 1, 1)

        return {
            "points": points,
            "distance_meters": round(distance_kilometers * 1000, 3),
            "distance_kilometers": round(distance_kilometers, 3),
            "duration_seconds": duration_seconds,
            "duration_minutes": round(duration_seconds / 60, 1),
            "route_count": route_count,
            "line_name": "",
        }

    def _extract_tianditu_transit_route_info(self, response: Dict[str, Any]) -> Dict[str, Any]:
        lines = self._collect_tianditu_transit_lines(response)
        line = lines[0] if lines else {}
        points = self._extract_tianditu_transit_points(line)
        schemes = self._extract_tianditu_transit_schemes(lines)
        first_scheme = schemes[0] if schemes else {}
        distance_meters = self._optional_float(first_scheme.get("distance_meters"))
        duration_seconds = self._optional_float(first_scheme.get("duration_seconds"))

        return {
            "points": points,
            "distance_meters": distance_meters,
            "distance_kilometers": round(distance_meters / 1000, 3) if distance_meters is not None else None,
            "duration_seconds": duration_seconds,
            "duration_minutes": round(duration_seconds / 60, 1) if duration_seconds is not None else None,
            "route_count": len(lines),
            "line_name": str(line.get("lineName") or "").strip(),
            "has_subway": self._safe_int(response.get("hasSubway"), 0),
            "transit_schemes": schemes,
        }

    def _collect_tianditu_transit_lines(self, response: Dict[str, Any]) -> List[Dict[str, Any]]:
        results = response.get("results") if isinstance(response.get("results"), list) else []
        lines = []

        for result in results:
            if not isinstance(result, dict):
                continue

            for line in result.get("lines") or []:
                if isinstance(line, dict):
                    lines.append(line)

        return lines

    def _extract_tianditu_transit_points(self, line: Dict[str, Any]) -> List[Dict[str, float]]:
        points = []

        for segment in line.get("segments") or []:
            if not isinstance(segment, dict):
                continue

            for item in self._dict_items(segment.get("segmentLine")):
                points.extend(self._parse_path_points(item.get("linePoint")))

        return self._dedupe_adjacent_points(points)

    def _extract_tianditu_transit_schemes(self, lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        schemes = []

        for index, line in enumerate(lines[:5]):
            if not isinstance(line, dict):
                continue

            steps = self._extract_tianditu_transit_steps(line)
            distance_meters = sum(self._optional_float(step.get("distance_meters")) or 0.0 for step in steps)
            duration_seconds = sum(self._optional_float(step.get("duration_seconds")) or 0.0 for step in steps)
            scheme = {
                "index": index + 1,
                "line_name": str(line.get("lineName") or "").strip(),
                "distance_meters": round(distance_meters, 3) if distance_meters > 0 else None,
                "distance_kilometers": round(distance_meters / 1000, 3) if distance_meters > 0 else None,
                "duration_seconds": round(duration_seconds, 3) if duration_seconds > 0 else None,
                "duration_minutes": round(duration_seconds / 60, 1) if duration_seconds > 0 else None,
                "step_count": len(steps),
                "steps": steps,
            }
            schemes.append(self._compact_dict(scheme))

        return schemes

    def _extract_tianditu_transit_steps(self, line: Dict[str, Any]) -> List[Dict[str, Any]]:
        steps = []

        for index, segment in enumerate(line.get("segments") or []):
            if not isinstance(segment, dict):
                continue

            segment_lines = self._dict_items(segment.get("segmentLine"))
            line_item = segment_lines[0] if segment_lines else {}
            distance_meters = self._optional_float(line_item.get("segmentDistance"))
            minutes = self._optional_float(line_item.get("segmentTime"))
            step = {
                "index": index + 1,
                "type": self._tianditu_segment_type_name(segment.get("segmentType")),
                "segment_type": self._optional_int(segment.get("segmentType")),
                "line_name": self._first_text(line_item.get("segmentName"), line_item.get("direction")),
                "direction": self._first_text(line_item.get("direction")),
                "start_station": self._tianditu_station_name(segment.get("stationStart")),
                "end_station": self._tianditu_station_name(segment.get("stationEnd")),
                "distance_meters": distance_meters,
                "duration_seconds": round(minutes * 60, 3) if minutes is not None else None,
            }
            steps.append(self._compact_dict(step))

        return steps

    def _tianditu_station_name(self, value: Any) -> str:
        if isinstance(value, dict):
            return self._first_text(value.get("name"), value.get("uuid"))

        return self._first_text(value)

    def _tianditu_segment_type_name(self, value: Any) -> str:
        names = {
            1: "步行",
            2: "公交",
            3: "地铁",
            4: "铁路",
        }
        code = self._optional_int(value)

        return names.get(code, str(value or "").strip())

    def _extract_tianditu_geocode_point(self, response: Dict[str, Any]) -> Dict[str, float]:
        location = response.get("location") if isinstance(response.get("location"), dict) else {}

        return {
            "lng": self._safe_float(location.get("lon"), None, "location.lon"),
            "lat": self._safe_float(location.get("lat"), None, "location.lat"),
        }

    def _collect_path_values(self, value: Any, paths: List[Any]) -> None:
        if isinstance(value, dict):
            raw_path = value.get("path")

            if raw_path:
                paths.append(raw_path)

            for item in value.values():
                self._collect_path_values(item, paths)

        elif isinstance(value, list):
            for item in value:
                self._collect_path_values(item, paths)

    def _parse_path_points(self, raw_path: Any) -> List[Dict[str, float]]:
        if isinstance(raw_path, list):
            return [self._normalize_point(item, "path.point") for item in raw_path]

        text = str(raw_path or "").strip()

        if not text:
            return []

        points = []

        for chunk in text.split(";"):
            point = self._parse_single_path_point(chunk, "path.point")

            if not point:
                continue

            points.append(point)

        return points

    def _parse_single_path_point(self, raw_point: Any, field_name: str) -> Dict[str, float]:
        text = str(raw_point or "").strip()

        if not text:
            return {}

        parts = [p.strip() for p in text.split(",")]

        if len(parts) != 2:
            raise ValueError(f"{field_name} 必须是 lng,lat 格式")

        return {
            "lng": self._safe_float(parts[0], None, f"{field_name}.lng"),
            "lat": self._safe_float(parts[1], None, f"{field_name}.lat"),
        }

    def _normalize_point(self, value: Any, field_name: str) -> Dict[str, float]:
        if isinstance(value, (list, tuple)):
            if len(value) < 2:
                raise ValueError(f"{field_name} 必须包含经度和纬度")

            return {
                "lng": self._safe_float(value[0], None, f"{field_name}.lng"),
                "lat": self._safe_float(value[1], None, f"{field_name}.lat"),
            }

        if not isinstance(value, dict):
            raise ValueError(f"{field_name} 必须是坐标对象或坐标数组")

        lng_value = value.get("lng", value.get("lon", value.get("longitude")))
        lat_value = value.get("lat", value.get("latitude"))

        return {
            "lng": self._safe_float(lng_value, None, f"{field_name}.lng"),
            "lat": self._safe_float(lat_value, None, f"{field_name}.lat"),
        }

    def _normalize_points(self, value: Any, field_name: str) -> List[Dict[str, float]]:
        if not isinstance(value, list):
            raise ValueError(f"{field_name} 必须是坐标数组")

        if len(value) < 2:
            raise ValueError(f"{field_name} 至少需要两个坐标")

        return [self._normalize_point(item, f"{field_name}[{index}]") for index, item in enumerate(value)]

    def _dedupe_adjacent_points(self, points: List[Dict[str, float]]) -> List[Dict[str, float]]:
        out = []

        for point in points:
            if out and out[-1].get("lng") == point.get("lng") and out[-1].get("lat") == point.get("lat"):
                continue

            out.append(point)

        return out

    def _haversine_distance(self, origin: Dict[str, float], destination: Dict[str, float]) -> float:
        lat1 = math.radians(origin["lat"])
        lat2 = math.radians(destination["lat"])
        dlat = math.radians(destination["lat"] - origin["lat"])
        dlng = math.radians(destination["lng"] - origin["lng"])
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        return EARTH_RADIUS_METERS * c

    def _initial_bearing(self, origin: Dict[str, float], destination: Dict[str, float]) -> float:
        lat1 = math.radians(origin["lat"])
        lat2 = math.radians(destination["lat"])
        dlng = math.radians(destination["lng"] - origin["lng"])
        y = math.sin(dlng) * math.cos(lat2)
        x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)

        return (math.degrees(math.atan2(y, x)) + 360) % 360

    def _baidu_lat_lng(self, point: Dict[str, float]) -> str:
        return f"{point['lat']},{point['lng']}"

    def _tianditu_lng_lat(self, point: Dict[str, float]) -> str:
        return f"{point['lng']},{point['lat']}"

    def _scene_to_markdown(self, scene: Dict[str, Any]) -> str:
        body = json.dumps(scene, ensure_ascii=False, indent=4)

        return f"```nexora-map\n{body}\n```"

    def _route_title(self, mode: str) -> str:
        names = {
            "driving": "驾车路线",
            "walking": "步行路线",
            "riding": "骑行路线",
            "transit": "公共交通路线",
        }

        return names.get(mode, "路线")

    def _route_subtitle(self, route_summary: Dict[str, Any]) -> str:
        parts = []

        if route_summary.get("distance_kilometers") is not None:
            parts.append(f"{route_summary['distance_kilometers']} 公里")

        if route_summary.get("duration_minutes") is not None:
            parts.append(f"{route_summary['duration_minutes']} 分钟")

        return "，".join(parts)

    def _safe_int(self, value: Any, default: int = 0) -> int:
        try:
            return int(str(value).strip())
        except Exception:
            return int(default)

    def _clamp_int(self, value: Any, min_value: int, max_value: int, default: int) -> int:
        num = self._safe_int(value, default)

        return max(min_value, min(max_value, num))

    def _safe_float(self, value: Any, default: Any = 0.0, field_name: str = ""):
        try:
            num = float(str(value).strip())
        except Exception:
            if default is None:
                raise ValueError(f"{field_name or 'value'} 必须是有效数字")

            return default

        if not math.isfinite(num):
            if default is None:
                raise ValueError(f"{field_name or 'value'} 必须是有限数字")

            return default

        return num

    def _optional_float(self, value: Any):
        if value is None:
            return None

        text = str(value).strip()

        if not text:
            return None

        try:
            num = float(text)
        except Exception:
            return None

        if not math.isfinite(num):
            return None

        return num

    def _optional_int(self, value: Any):
        if value is None:
            return None

        text = str(value).strip()

        if not text:
            return None

        try:
            return int(float(text))
        except Exception:
            return None

    def _dict_items(self, value: Any) -> List[Dict[str, Any]]:
        if isinstance(value, dict):
            return [value]

        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]

        return []

    def _first_text(self, *values: Any) -> str:
        for value in values:
            text = str(value or "").strip()

            if text:
                return text

        return ""

    def _clean_provider_text(self, value: Any) -> str:
        text = unescape(str(value or "").strip())
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"\s+", " ", text)

        return text.strip()

    def _compact_dict(self, value: Dict[str, Any]) -> Dict[str, Any]:
        out = {}

        for key, item in value.items():
            if item is None:
                continue

            if item == "":
                continue

            if item == []:
                continue

            out[key] = item

        return out

    def _coerce_bool(self, value: Any, default: bool = False) -> bool:
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
