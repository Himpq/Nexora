import copy
from typing import Any, Dict

from map.baidu import BaiduMapToolService
from basis.Map import BAIDU_PROVIDER, TIANDITU_PROVIDER


class TiandituMapToolService(BaiduMapToolService):
    """天地图地图工具：沿用会话地图记录层，默认 provider 切到 tianditu。"""

    def __init__(self, config: Dict[str, Any], username: str = "", conversation_id: str = ""):
        next_config = copy.deepcopy(config) if isinstance(config, dict) else {}
        map_cfg = next_config.setdefault("map_service", {})

        if isinstance(map_cfg, dict) and not str(map_cfg.get("provider") or "").strip():
            map_cfg["provider"] = TIANDITU_PROVIDER

        super().__init__(next_config, username=username, conversation_id=conversation_id)


def create_map_tool_service(config: Dict[str, Any], username: str = "", conversation_id: str = "") -> BaiduMapToolService:
    map_cfg = config.get("map_service") if isinstance(config.get("map_service"), dict) else {}
    provider = str(map_cfg.get("provider") or BAIDU_PROVIDER).strip().lower()

    if provider == TIANDITU_PROVIDER:
        return TiandituMapToolService(config, username=username, conversation_id=conversation_id)

    if provider == BAIDU_PROVIDER:
        return BaiduMapToolService(config, username=username, conversation_id=conversation_id)

    raise ValueError(f"暂不支持地图 provider：{provider}")
