"""Nexora.Map.config — 地图服务默认配置。"""

from typing import Any, Dict


DEFAULT_MAP_SERVICE_CONFIG: Dict[str, Any] = {
    "provider": "baidu",
    "record_ttl_seconds": 21600,
    "record_max_items": 200,
    "baidu": {
        "browser_ak": "",
        "browser_version": "1.0",
        "server_ak": "",
        "server_sk": "",
        "auth_mode": "ak",
        "timeout": 12,
        "coord_type": "bd09ll",
        "ret_coordtype": "bd09ll",
        "direction_base_url": "https://api.map.baidu.com/direction/v2",
        "geocoding_url": "https://api.map.baidu.com/geocoding/v3/",
        "place_search_url": "https://api.map.baidu.com/place/v2/search",
    },
    "tianditu": {
        "tk": "",
        "browser_tk": "",
        "server_tk": "",
        "browser_version": "4.0",
        "timeout": 12,
        "coord_type": "cgcs2000",
        "driving_style": "0",
        "transit_linetype": "7",
        "drive_url": "https://api.tianditu.gov.cn/drive",
        "transit_url": "https://api.tianditu.gov.cn/transit",
        "geocoding_url": "https://api.tianditu.gov.cn/geocoder",
        "place_search_url": "https://api.tianditu.gov.cn/v2/search",
    },
}
