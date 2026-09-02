TOOL_NAME_ALIASES = {
    # Select Tools 已下线，旧别名不再映射到可调用工具。
    # "selectTools": "runtime_tool_select",
    # "select_tools": "runtime_tool_select",
    "EnableTools": "runtime_tool_enable",
    "enable_tools": "runtime_tool_enable",
    "skill_read": "skill",
    "readSkill": "skill",
    "vectorSearch": "knowledge_search_vector",
    "vector_search": "knowledge_search_vector",
    # 已下线的两个联网搜索工具统一映射到 search，历史会话调用旧名可平滑迁移
    "server_web_search": "search",
    "relay_web_search": "search",
    "arxivSearch": "arxiv_search",
    "getKnowledgeList": "knowledge_list",
    "get_knowledge_list": "knowledge_list",
    "addBasis": "knowledge_basis_create",
    "add_basis": "knowledge_basis_create",
    "removeBasis": "knowledge_basis_delete",
    "remove_basis": "knowledge_basis_delete",
    "updateBasis": "knowledge_basis_update",
    "update_basis": "knowledge_basis_update",
    "getBasisContent": "knowledge_basis_read",
    "get_basis_content": "knowledge_basis_read",
    "searchKeyword": "knowledge_search_keyword",
    "search_keyword": "knowledge_search_keyword",
    "readTmp": "temp_context_read",
    "readtmp": "temp_context_read",
    "searchTmp": "temp_context_search",
    "searchtmp": "temp_context_search",
    "listTmp": "temp_context_list",
    "listtmp": "temp_context_list",
    "clearTmp": "temp_context_clear",
    "cleartmp": "temp_context_clear",
    "linkKnowledge": "link_knowledge",
    "categorizeKnowledge": "categorize_knowledge",
    "createCategory": "create_category",
    "analyzeConnections": "analyze_connections",
    "getKnowledgeGraphStructure": "knowledge_graph_read",
    "get_knowledge_graph_structure": "knowledge_graph_read",
    "getKnowledgeConnections": "get_knowledge_connections",
    "findPathBetweenKnowledge": "find_path_between_knowledge",
    "getContextLength": "conversation_context_length",
    "get_context_length": "conversation_context_length",
    "getContext": "conversation_context_read",
    "get_context": "conversation_context_read",
    "getContext_findKeyword": "conversation_context_search",
    "get_context_find_keyword": "conversation_context_search",
    "sendEMail": "send_email",
    "getEMail": "get_email",
    "getEMailList": "get_email_list",
    "queryShortMemory": "query_short_memory",
    "addShort": "memory_short_add",
    "add_short": "memory_short_add",
    "removeShort": "remove_short",
    "getUserProfileMemory": "memory_profile_read",
    "get_user_profile_memory": "memory_profile_read",
    "setUserProfileMemory": "memory_short_update",
    "updateUserProfileMemory": "memory_short_update",
    "updateShort": "memory_short_update",
    "longtermPlan": "longterm_plan",
    "longtermUpdate": "longterm_update",
    "serverWebSearch": "server_web_search",
    "serverRenderPage": "server_render_page",
    "mapRender": "map_render",
    "map_render_scene": "map_render",
    "mapCalcDistance": "map_calc_distance",
    "map_calc_straight_distance": "map_calc_distance",
    "mapCalcRoute": "map_calc_route",
    "map_route_plan": "map_calc_route",
    "mapGeocode": "map_geocode",
    "mapPoiSearch": "map_poi_search",
    "map_search_place": "map_poi_search",
    "generateImage": "generate_image",
    "file_create": "cloud_file_create",
    "file_read": "cloud_file_read",
    "file_write": "cloud_file_write",
    "doc_write": "cloud_doc_write",
    "word_write": "cloud_doc_write",
    "file_patch": "cloud_file_edit",
    "file_apply_diff": "cloud_file_apply_diff",
    "file_edit": "cloud_file_edit",
    "file_find": "cloud_file_find",
    "file_list": "cloud_file_list",
    "file_remove": "cloud_file_remove",
    "file_semantic_search": "cloud_file_search_semantic",
    "local_web_render": "browser_page_open",
    "local_web_get_content": "browser_page_read",
    "local_web_click": "browser_page_click",
    "local_web_input": "browser_page_input",
    "local_web_exec_js": "browser_page_eval",
    "local_web_scroll": "browser_page_scroll",
    "local_web_list_pages": "browser_page_list",
    "local_web_close_page": "browser_page_close",
}


def canonicalize_tool_name(name):
    raw = str(name or "").strip()

    if not raw:
        return ""

    seen = set()

    while raw in TOOL_NAME_ALIASES and raw not in seen:
        seen.add(raw)
        raw = str(TOOL_NAME_ALIASES.get(raw) or "").strip()

        if not raw:
            return ""

    return raw


MAP_TOOL_NAMES = {
    "map_render",
    "map_calc_distance",
    "map_calc_route",
    "map_geocode",
    "map_poi_search",
}


# 用户画像已直接注入 system prompt，写入由回复后的 MEMORY 队列独占处理。
MAIN_CONVERSATION_EXCLUDED_TOOL_NAMES = {
    "memory_profile_read",
    "memory_short_update",
    "memory_short_add",
}


# NexoraCode 项目模式下不注入的远程业务工具：
# 项目会话聚焦本地编码，裁剪知识库/云盘/记忆/地图/生图/邮件/联网搜索等无关工具，
# 减少 token 开销与误用；同时移除控制工具（runtime_tool_enable/ask_for_permission，
# 项目模式强制 force 并自动询问权限，无需模型显式调用）。
# exa_web_search 同属联网搜索，同步裁剪以保持项目模式纯净
NEXORACODE_PROJECT_EXCLUDED_TOOL_NAMES = {
    "knowledge_list",
    "knowledge_basis_create",
    "knowledge_basis_delete",
    "knowledge_basis_update",
    "knowledge_basis_read",
    "knowledge_search_keyword",
    "knowledge_search_vector",
    "knowledge_graph_read",
    "cloud_file_create",
    "cloud_file_read",
    "cloud_file_write",
    "cloud_doc_write",
    "cloud_file_apply_diff",
    "cloud_file_edit",
    "cloud_file_find",
    "cloud_file_list",
    "cloud_file_remove",
    "cloud_file_search_semantic",
    "memory_profile_read",
    "memory_short_update",
    "memory_short_add",
    "map_render",
    "map_calc_distance",
    "map_calc_route",
    "map_geocode",
    "map_poi_search",
    "generate_image",
    "send_email",
    "get_email",
    "get_email_list",
    "search",
    "exa_web_search",
    "server_render_page",
    "arxiv_search",
    "temp_context_read",
    "temp_context_search",
    "temp_context_list",
    "temp_context_clear",
    "client_js_exec",
    "runtime_tool_enable",
    "ask_for_permission",
}


def _function_tool_name(tool):
    if not isinstance(tool, dict):
        return ""

    if str(tool.get("type") or "").strip() != "function":
        return ""

    function_def = tool.get("function")

    if isinstance(function_def, dict):
        return canonicalize_tool_name(function_def.get("name"))

    return canonicalize_tool_name(tool.get("name"))


def is_map_service_configured(config):
    map_cfg = config.get("map_service") if isinstance(config, dict) and isinstance(config.get("map_service"), dict) else {}
    provider = str(map_cfg.get("provider") or "").strip().lower()

    if provider == "baidu":
        baidu_cfg = map_cfg.get("baidu") if isinstance(map_cfg.get("baidu"), dict) else {}
        auth_mode = str(baidu_cfg.get("auth_mode") or "ak").strip().lower()
        browser_ready = bool(str(baidu_cfg.get("browser_ak") or "").strip())
        server_ready = bool(str(baidu_cfg.get("server_ak") or "").strip())
        sn_ready = auth_mode != "sn" or bool(str(baidu_cfg.get("server_sk") or "").strip())

        return auth_mode in {"ak", "sn"} and browser_ready and server_ready and sn_ready

    if provider == "tianditu":
        tianditu_cfg = map_cfg.get("tianditu") if isinstance(map_cfg.get("tianditu"), dict) else {}
        shared_tk = str(tianditu_cfg.get("tk") or "").strip()
        browser_ready = bool(str(tianditu_cfg.get("browser_tk") or "").strip() or shared_tk)
        server_ready = bool(str(tianditu_cfg.get("server_tk") or "").strip() or shared_tk)

        return browser_ready and server_ready

    return False


def get_tools_for_config(config):
    excluded_names = set(MAIN_CONVERSATION_EXCLUDED_TOOL_NAMES)

    if not is_map_service_configured(config):
        excluded_names.update(MAP_TOOL_NAMES)

    return [tool for tool in TOOLS if _function_tool_name(tool) not in excluded_names]


import prompts


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "question",
            "description": "向用户提出结构化问题并等待明确回答。当继续执行前必须确认用户意图、选择方案或补充缺失信息时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_answer": {
                        "type": "boolean",
                        "description": "仅当该回答需要作为长期状态追踪或复用时设为 true。一次性澄清问题设为 false。"
                    },
                    "question_id": {
                        "type": "string",
                        "description": "可追踪问题的稳定 ID。track_answer 为 true 时必填；一次性澄清问题留空。"
                    },
                    "question_title": {
                        "type": "string",
                        "description": "问题标题，简短说明需要用户决定什么。"
                    },
                    "question_content": {
                        "type": "string",
                        "description": "问题正文，清楚说明需要用户补充的信息。"
                    },
                    "choices": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "可选选项列表。没有明确互斥选项时传空数组。"
                    },
                    "allow_other": {
                        "type": "boolean",
                        "description": "是否允许用户自由输入其他答案，默认 true。"
                    }
                },
                "required": ["question_title", "question_content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "ask_for_permission",
            "description": (
                "Ask the user for explicit temporary permission before accessing a local file or directory outside "
                "the current NexoraCode allowed_dirs. Use this when a local tool returns permission_required."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "The exact local path requiring access."},
                    "operation": {
                        "type": "string",
                        "enum": ["read", "write", "read_write"],
                        "default": "read",
                        "description": "Requested access type.",
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["file", "dir"],
                        "default": "file",
                        "description": "Whether the request is for one file or a directory.",
                    },
                    "reason": {"type": "string", "description": "Why this path is needed."},
                    "sensitive": {
                        "type": "boolean",
                        "default": False,
                        "description": "Set true when the path may contain secrets or private data.",
                    },
                },
                "required": ["path", "operation", "scope", "reason"],
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search",
            "description": (
                "统一搜索工具：一次查询用户的知识库（标题+内容关键词，向量库启用时自动融合语义命中）、"
                "云盘文件（文件名匹配）与互联网（NexoraSearch 启用时）。"
                "返回按来源分组的结果；某来源未启用时会在 notes 中说明。需要查找任何资料时优先使用本工具。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词。要求具体、可检索，避免过宽泛。"
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["all", "knowledge", "files", "web"],
                        "description": "搜索范围：all=全部来源（默认），knowledge=知识库，files=云盘文件，web=互联网"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "每个来源最多返回的条数，默认 8，上限 20"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "exa_web_search",
            "description": (
                "Exa AI 神经搜索：面向编码与研究场景的高质量联网检索，返回标题、URL、"
                "高亮片段（highlights）、发布日期与相关度评分。适合文档查阅、API 参考、论文与技术调研。"
                "当需要精确、可追溯的网页来源时优先使用本工具。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词或自然语言问题，要求具体、可检索"
                    },
                    "num_results": {
                        "type": "integer",
                        "description": "返回条数，默认 8，上限 20"
                    },
                    "type": {
                        "type": "string",
                        "enum": ["auto", "fast", "instant", "deep-lite", "deep", "deep-reasoning"],
                        "description": "搜索深度：auto 为默认平衡，fast/instant 低延迟，deep 系列适合复杂调研"
                    },
                    "include_domains": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "限定来源域名，例如 [\"arxiv.org\", \"github.com\"]"
                    },
                    "exclude_domains": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "排除域名，例如 [\"pinterest.com\"]"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "server_render_page",
            "description": "使用 NexoraSearch 渲染指定网页 URL，返回最终页面地址、标题和正文文本。当你需要抓取网页原文、动态渲染后的内容或页面可见文本时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "要渲染的网页 URL"
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "description": "可选，渲染超时毫秒数，默认15000"
                    }
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "map_render",
            "description": "生成 Nexora 前端可渲染的地图 scene。只负责渲染标记、路线图层和视野，不做真实路线规划；需要计算路线时先调用 map_calc_route。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "地图标题"
                    },
                    "provider": {
                        "type": "string",
                        "enum": ["baidu", "tianditu"],
                        "description": "地图 provider，目前支持 baidu、tianditu"
                    },
                    "coordinate_system": {
                        "type": "string",
                        "description": "坐标系标记，例如 bd09ll"
                    },
                    "center": {
                        "type": "object",
                        "description": "地图中心点，包含 lng 和 lat",
                        "properties": {
                            "lng": {"type": "number"},
                            "lat": {"type": "number"}
                        },
                        "required": ["lng", "lat"]
                    },
                    "zoom": {
                        "type": "integer",
                        "description": "缩放级别，范围 3-19"
                    },
                    "markers": {
                        "type": "array",
                        "description": "标记点列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string"},
                                "lng": {"type": "number"},
                                "lat": {"type": "number"}
                            },
                            "required": ["lng", "lat"]
                        }
                    },
                    "routes": {
                        "type": "array",
                        "description": "路线或折线图层。points 必须是真实路径点，避免只连起终点。",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string"},
                                "color": {"type": "string"},
                                "width": {"type": "number"},
                                "points": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "lng": {"type": "number"},
                                            "lat": {"type": "number"}
                                        },
                                        "required": ["lng", "lat"]
                                    }
                                }
                            },
                            "required": ["points"]
                        }
                    },
                    "layers": {
                        "type": "array",
                        "description": "开放图层数组，支持 marker 和 route。高级场景可直接传 layers。",
                        "items": {"type": "object"}
                    },
                    "scene": {
                        "type": "object",
                        "description": "完整 nexora-map scene；提供 scene 时优先使用 scene。"
                    },
                    "fit_bounds": {
                        "type": "boolean",
                        "description": "是否自动适配所有图层视野，默认 true。"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "map_calc_distance",
            "description": "计算两个坐标点之间的球面直线距离和初始方位角，并可返回可渲染地图 scene。只用于直线距离，不代表真实道路距离。",
            "parameters": {
                "type": "object",
                "properties": {
                    "provider": {
                        "type": "string",
                        "enum": ["baidu", "tianditu"],
                        "description": "地图 provider，目前支持 baidu、tianditu"
                    },
                    "origin": {
                        "type": "object",
                        "description": "起点，包含 lng 和 lat",
                        "properties": {
                            "lng": {"type": "number"},
                            "lat": {"type": "number"}
                        },
                        "required": ["lng", "lat"]
                    },
                    "origin_text": {
                        "type": "string",
                        "description": "起点文本。提供文本时必须同时提供 origin_city、origin_region 或 city，工具会先做地理编码再计算。"
                    },
                    "origin_city": {
                        "type": "string",
                        "description": "起点文本所属城市/行政区；origin_text 为文本时必填，例如 南宁、上海。"
                    },
                    "origin_region": {
                        "type": "string",
                        "description": "起点文本所属行政区；可替代 origin_city。"
                    },
                    "destination": {
                        "type": "object",
                        "description": "终点，包含 lng 和 lat",
                        "properties": {
                            "lng": {"type": "number"},
                            "lat": {"type": "number"}
                        },
                        "required": ["lng", "lat"]
                    },
                    "destination_text": {
                        "type": "string",
                        "description": "终点文本。提供文本时必须同时提供 destination_city、destination_region 或 city，工具会先做地理编码再计算。"
                    },
                    "destination_city": {
                        "type": "string",
                        "description": "终点文本所属城市/行政区；destination_text 为文本时必填，例如 南宁、上海。"
                    },
                    "destination_region": {
                        "type": "string",
                        "description": "终点文本所属行政区；可替代 destination_city。"
                    },
                    "city": {
                        "type": "string",
                        "description": "起终点在同一城市时使用的统一城市限定；文本地理编码不能省略城市限定。"
                    },
                    "title": {
                        "type": "string",
                        "description": "可选地图标题"
                    },
                    "render": {
                        "type": "boolean",
                        "description": "是否保存 scene 并让前端根据 map_id 渲染地图，默认 true。false 时只返回基础信息摘要。"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "map_calc_route",
            "description": "调用地图 provider 规划路线并返回距离、耗时、路径点和可渲染地图 scene。用于真实驾车、步行、骑行或公共交通路线计算；mode=transit 时会额外返回公共交通方案 transit_schemes。",
            "parameters": {
                "type": "object",
                "properties": {
                    "provider": {
                        "type": "string",
                        "enum": ["baidu", "tianditu"],
                        "description": "地图 provider，目前支持 baidu、tianditu"
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["driving", "walking", "riding", "transit"],
                        "description": "路线类型：driving 驾车，walking 步行，riding 骑行，transit 公共交通"
                    },
                    "origin": {
                        "type": "object",
                        "description": "起点，包含 lng 和 lat",
                        "properties": {
                            "lng": {"type": "number"},
                            "lat": {"type": "number"}
                        },
                        "required": ["lng", "lat"]
                    },
                    "origin_text": {
                        "type": "string",
                        "description": "起点文本，例如 上海理工大学。提供文本时必须同时提供 origin_city、origin_region 或 city。"
                    },
                    "origin_city": {
                        "type": "string",
                        "description": "起点文本所属城市/行政区；origin_text 为文本时必填，例如 上海、南宁。"
                    },
                    "destination": {
                        "type": "object",
                        "description": "终点，包含 lng 和 lat",
                        "properties": {
                            "lng": {"type": "number"},
                            "lat": {"type": "number"}
                        },
                        "required": ["lng", "lat"]
                    },
                    "destination_text": {
                        "type": "string",
                        "description": "终点文本，例如 东方明珠广播电视塔。提供文本时必须同时提供 destination_city、destination_region 或 city。"
                    },
                    "destination_city": {
                        "type": "string",
                        "description": "终点文本所属城市/行政区；destination_text 为文本时必填，例如 上海、南宁。"
                    },
                    "coord_type": {
                        "type": "string",
                        "description": "输入坐标系，百度常用 bd09ll、gcj02、wgs84"
                    },
                    "ret_coordtype": {
                        "type": "string",
                        "description": "返回坐标系，默认 bd09ll"
                    },
                    "origin_region": {
                        "type": "string",
                        "description": "起点文本所属行政区；可替代 origin_city，公共交通路线也会传给 provider。"
                    },
                    "destination_region": {
                        "type": "string",
                        "description": "终点文本所属行政区；可替代 destination_city，公共交通路线也会传给 provider。"
                    },
                    "city": {
                        "type": "string",
                        "description": "起终点在同一城市时使用的统一城市限定；文本地理编码不能省略城市限定。"
                    },
                    "tactics": {
                        "type": "string",
                        "description": "provider 支持的路线策略参数"
                    },
                    "title": {
                        "type": "string",
                        "description": "可选地图标题"
                    },
                    "render": {
                        "type": "boolean",
                        "description": "是否保存 scene 并让前端根据 map_id 渲染地图，默认 true。false 时只返回基础信息摘要。"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "map_geocode",
            "description": "把地址解析成坐标，并返回可渲染地图标记。适合用户给出地点文本但后续工具需要经纬度时调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "provider": {
                        "type": "string",
                        "enum": ["baidu", "tianditu"],
                        "description": "地图 provider，目前支持 baidu、tianditu"
                    },
                    "address": {
                        "type": "string",
                        "description": "要解析的地址或地点文本"
                    },
                    "city": {
                        "type": "string",
                        "description": "必填城市名/行政区，用于限定 provider 的文本地理编码结果，例如 上海、南宁。"
                    },
                    "region": {
                        "type": "string",
                        "description": "行政区限定；可替代 city。"
                    },
                    "title": {
                        "type": "string",
                        "description": "可选地图标题"
                    },
                    "render": {
                        "type": "boolean",
                        "description": "是否保存 scene 并让前端根据 map_id 渲染地图，默认 true。false 时只返回坐标信息。"
                    }
                },
                "required": ["address"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "map_poi_search",
            "description": "搜索地点 POI，返回地点列表和可渲染地图标记。必须提供 region，或提供 location + radius。",
            "parameters": {
                "type": "object",
                "properties": {
                    "provider": {
                        "type": "string",
                        "enum": ["baidu", "tianditu"],
                        "description": "地图 provider，目前支持 baidu、tianditu"
                    },
                    "query": {
                        "type": "string",
                        "description": "地点关键词，例如 北京南站、咖啡馆"
                    },
                    "region": {
                        "type": "string",
                        "description": "检索区域，例如 北京、上海"
                    },
                    "location": {
                        "type": "object",
                        "description": "中心点，提供后按周边检索",
                        "properties": {
                            "lng": {"type": "number"},
                            "lat": {"type": "number"}
                        },
                        "required": ["lng", "lat"]
                    },
                    "radius": {
                        "type": "integer",
                        "description": "周边检索半径，单位米，范围 1-50000"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回条数，范围 1-20，默认 8"
                    },
                    "page_num": {
                        "type": "integer",
                        "description": "页码，从 0 开始"
                    },
                    "title": {
                        "type": "string",
                        "description": "可选地图标题"
                    },
                    "render": {
                        "type": "boolean",
                        "description": "是否保存 scene 并让前端根据 map_id 渲染地图，默认 true。false 时只返回地点列表。"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_image",
            "description": "根据用户的自然语言描述生成图片。仅当用户明确要求画图、生成图片、生成视觉素材、海报、插画、照片或图像方案时使用。工具只向模型返回生成成功或错误信息，图片会由系统自动展示在聊天记录中。",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "用于生图的详细提示词，尽量包含主体、场景、风格、构图、光线、色彩和比例要求。"
                    },
                    "size": {
                        "type": "string",
                        "description": "可选图片尺寸，例如 1024x1024、1024x1536、1536x1024。"
                    },
                    "n": {
                        "type": "integer",
                        "description": "可选生成数量，默认 1，最大 4。"
                    },
                    "quality": {
                        "type": "string",
                        "description": "可选质量参数，例如 auto、standard、hd、high。"
                    }
                },
                "required": ["prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "longterm_plan",
            "description": "Longterm 模式专用工具，用于任务开始时的一次性规划。必须且只能在开始时调用一次。",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "任务摘要。"
                    },
                    "plan": {
                        "type": "array",
                        "description": "规划项列表，例如 ['分析需求', '编写代码', '测试', '总结']。",
                        "items": {"type": "string"}
                    }
                },
                "required": ["plan"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "longterm_update",
            "description": "Longterm 模式专用工具，用于提交当前步骤完成态或任务完成态。若只是某个 step 完成，请填写 step_index/step_no/step_id，并将 step_status 设为 done；只有整个 longterm 任务结束时才把 done 设为 true。",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "任务完成摘要。"
                    },
                    "step_index": {
                        "type": "integer",
                        "description": "当前完成的步骤索引，0-based。"
                    },
                    "step_no": {
                        "type": "integer",
                        "description": "当前完成的步骤编号，1-based。可与 step_index 二选一。"
                    },
                    "step_id": {
                        "type": "string",
                        "description": "当前完成的步骤 ID。"
                    },
                    "step_title": {
                        "type": "string",
                        "description": "当前完成的步骤标题。"
                    },
                    "step_status": {
                        "type": "string",
                        "enum": ["done", "active", "pending"],
                        "description": "步骤状态。标记步骤完成时通常填 done。"
                    },
                    "context": {
                        "type": "string",
                        "description": "可选，最终上下文。"
                    },
                    "done": {
                        "type": "boolean",
                        "description": "是否完成任务，默认 true。"
                    }
                },
                "required": ["summary"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "skill",
            "description": "读取按需加载的 Longdoc Skill 长文档正文。仅用于已在系统提示中列出的 longdoc 文档，不读取普通 tool skill。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Longdoc Skill 的 id、标题或别名，例如 nexora。"
                    }
                },
                "required": ["name"]
            }
        }
    },
    # Select Tools 已下线：保留旧定义注释，避免后续误恢复为用户可见工具。
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "runtime_tool_select",
    #         "description": "已下线：旧 Auto(Select tools) 精确选工具入口。",
    #         "parameters": {
    #             "type": "object",
    #             "properties": {},
    #             "required": []
    #         }
    #     }
    # },
    {
        "type": "function",
        "function": {
            "name": "runtime_tool_enable",
            "description": "仅用于 Auto(OFF) 模式：调用后当前回复后续轮次立即进入 Force，开放全部业务工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "可选，简要说明启用理由。"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "arxiv_search",
            "description": "在 arXiv 中搜索论文，返回标题、作者、摘要、时间和 PDF 链接。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "检索关键词，例如 'multimodal rag' 或 'cat:cs.CL AND transformer'"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "返回条数，默认5，范围1-20"
                    },
                    "sort_by": {
                        "type": "string",
                        "description": "排序字段：relevance / submittedDate / lastUpdatedDate"
                    },
                    "sort_order": {
                        "type": "string",
                        "description": "排序方向：descending / ascending"
                    },
                    "strict": {
                        "type": "boolean",
                        "description": "是否启用相关性过滤（默认 true）。true 时会过滤明显不相关结果。"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "client_js_exec",
            "description": "在当前聊天页的隔离 JS Worker 中执行纯 JavaScript。适合轻量计算、文本处理和 Canvas 渲染；不能访问 DOM、页面状态或网络。操作真实网页请使用 browser_page_* 工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "可直接执行的纯 JS 代码；建议显式 return 结果。"
                    },
                    "context": {
                        "type": "object",
                        "description": "可选，传入上下文对象，在代码中通过 context 读取。"
                    },
                    "timeout_ms": {
                        "type": "integer",
                        "description": "可选，执行超时毫秒数，默认8000，范围500-30000。"
                    }
                },
                "required": ["code"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "knowledge_list",
            "description": "列出当前用户的基础知识库条目，返回标题、basis_id 和共享状态。",

            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "memory_profile_read",
            "description": "读取当前用户短期记忆中的用户画像。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "memory_short_update",
            "description": "覆盖更新当前用户画像短期记忆（会归一化保存）。适合合并、修正或重写用户偏好、背景、目标和沟通风格。",
            "parameters": {
                "type": "object",
                "properties": {
                    "profile": {
                        "type": "string",
                        "description": "新的用户画像文本。"
                    },
                    "reset": {
                        "type": "boolean",
                        "description": "是否重置为默认画像。true 时忽略 profile。"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "memory_short_add",
            "description": "旧版短期条目追加工具，仅在用户明确要求追加一条旧式短期记忆时使用；用户画像更新请使用 memory_short_update。",

            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "添加的短期记忆内容，简短总结。"
                    }
                },
                "required": ["title"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "knowledge_basis_create",
            "description": "向用户长期知识库新增一条基础知识。仅在用户要求保存、沉淀或复用资料时调用；context 应是已经整理好的完整 Markdown 内容。",

            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "基础知识的标题。"
                    },
                    "context": {
                        "type": "string",
                        "description": "基础知识正文，使用 Markdown。参数必须直接传入最终文本；需要外部内容时先调用对应读取工具取得正文。"
                    },
                    "url": {
                        "type": "string",
                        "description": "基础知识的来源链接。"
                    }
                },
                "required": ["title", "context", "url"]
            }
        }
    },

    # {
    #     "type": "function",
    #     "function": {
    #         "name": "removeShort",
    #         "description": "删除用户知识库中的短期记忆。",
    #
    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "ID": {
    #                     "type": "integer",
    #                     "description": "删除的短期记忆内容。"
    #                 }
    #             },
    #             "required": ["ID"]
    #         }
    #     }
    # },

    {
        "type": "function",
        "function": {
            "name": "knowledge_basis_delete",
            "description": "删除用户知识库中的基础知识。",

            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "根据标题删除的基础知识，请注意谨慎调用。"
                    }
                },
                "required": ["title"]
            }
        }
    },
    
    # 旧批量 knowledge_basis_update 已试点下线（保留注释便于回滚）：
    # 原 Tool 支持 context / 区间替换 / patch / edits 批量四选一，导致长累计文本下批量 edits 易产生 JSON 语法错误（如 Flash 0731 批量 5 edits 出现 {"action": "target":...}）。
    # 试点改为仅允许单次原子修改：单次调用仅允许一种内容修改方式，需多次修改请多次调用。
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "knowledge_basis_update",
    #         "description": "更新基础知识。支持重命名、整段覆盖、URL更新、公开/协作设置、按字符索引区间替换，以及统一 diff/结构化 edits patch。结构化 edits 支持精确 target、Markdown 标题/HTML 注释锚点 target、换行归一化 target、忽略首尾空白/连续空白/换行/全半角差异的 Markdown 噪声归一化 target。内容更新方式 context、区间替换、patch/edits 三选一。",
    #         ...（旧批量定义，含 from_pos/to_pos/replacement/replacements/patch/edits[]）已注释
    #     }
    # },

    {
        "type": "function",
        "function": {
            "name": "knowledge_basis_update",
            "description": "更新基础知识（单次原子修改）。支持重命名、整段覆盖、URL/公开/协作设置，或单次结构化编辑。单次调用仅允许一种内容修改方式：context 整段覆盖 与 单 edit（action+target）二选一；需多次修改请多次调用。单 edit 优先使用短而稳定的 Markdown 标题或 HTML 注释锚点作为 target；target 多次出现时传 occurrence。长累计文本禁止批量 edits。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "要更新的基础知识的当前标题（用于定位）。"
                    },
                    "new_title": {
                        "type": "string",
                        "description": "新的标题（如果需要重命名，否则不填）。"
                    },
                    "context": {
                        "type": "string",
                        "description": "新的知识内容（Markdown格式，整段覆盖。提供 context 时不能同时提供单 edit 参数）。参数必须直接传入最终文本；需要外部内容时先调用对应读取工具取得正文。"
                    },
                    "url": {
                        "type": "string",
                        "description": "新的来源链接（如果需要更新，否则不填）。"
                    },
                    "public": {
                        "type": "boolean",
                        "description": "是否公开该知识点（true=公开，false=私有）。"
                    },
                    "collaborative": {
                        "type": "boolean",
                        "description": "是否允许协作编辑（true=可编辑，false=只读）。"
                    },
                    "action": {
                        "type": "string",
                        "enum": ["replace", "insert_before", "insert_after", "delete"],
                        "description": "单次结构化编辑动作。提供 action 时必须同时提供 target，且不能同时提供 context。"
                    },
                    "target": {
                        "type": "string",
                        "description": "单次编辑的目标文本。支持精确匹配、Markdown 标题/HTML 注释锚点匹配、换行归一化匹配和 Markdown 噪声归一化匹配。"
                    },
                    "replacement": {
                        "type": "string",
                        "description": "replace 动作的新文本，必须直接传入最终文本。仅 action=replace 时使用。"
                    },
                    "content": {
                        "type": "string",
                        "description": "insert_before/insert_after 动作插入的新文本，必须直接传入最终文本。仅 action=insert_before/insert_after 时使用。"
                    },
                    "occurrence": {
                        "type": "integer",
                        "description": "target 多次出现时指定第几处，从 1 开始。"
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "是否只预览不写入，默认 false。仅单 edit 时可用。"
                    },
                    "expected_sha256": {
                        "type": "string",
                        "description": "可选的知识内容当前 SHA256；不一致时拒绝修改。"
                    }
                },
                "required": ["title"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "knowledge_basis_read",
            "description": "读取基础知识内容。三种读取方式三选一：不传范围参数读全文；传 offset+length 按字符切片；传 keyword 按关键词或 regex 返回命中邻域。" + prompts.knowledge_citation_tool_hint,

            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "基础知识标题。title 和 basis_id 二选一。"
                    },
                    "basis_id": {
                        "type": "string",
                        "description": "基础知识 ID。title 和 basis_id 二选一。"
                    },
                    "keyword": {
                        "type": "string",
                        "description": "关键词；当 match_mode=regex/rg 时按正则表达式解释。不要和 offset/length 同时使用。"
                    },
                    "range": {
                        "type": "integer",
                        "description": "关键词匹配时返回前后字符范围。默认 120。"
                    },
                    "offset": {
                        "type": "integer",
                        "description": "字符切片起始位置，0 表示第一个字符。必须和 length 同时提供，不要和 keyword 同时使用。"
                    },
                    "length": {
                        "type": "integer",
                        "description": "字符切片读取数量。必须和 offset 同时提供，不要和 keyword 同时使用。"
                    },
                    "match_mode": {
                        "type": "string",
                        "description": "匹配模式：keyword（默认）或 regex（支持 rg）。",
                        "enum": ["keyword", "regex", "rg"]
                    },
                    "max_matches": {
                        "type": "integer",
                        "description": "关键词/regex 匹配返回的最大命中数，默认 5。"
                    },
                    "case_sensitive": {
                        "type": "boolean",
                        "description": "关键词/regex 是否区分大小写，默认 true。"
                    }
                },
                "required": []
            }
        }
    },

    # {
    #     "type": "function",
    #     "function": {
    #         "name": "analyzeConnections",
    #         "description": "分析知识库中指定知识的串联关系，返回与该知识相关联的其他知识及其关系类型（关联/依赖/扩展/对比/补充）。用于发现知识之间的联系和构建知识网络。",

    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "title": {
    #                     "type": "string",
    #                     "description": "要分析串联关系的知识标题。"
    #                 }
    #             },
    #             "required": ["title"]
    #         }
    #     }
    # },
    
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "linkKnowledge",
    #         "description": "建立两个知识点之间的关联连接。用于构建知识网络，帮助AI理解知识间的逻辑关系。",
    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "source": {
    #                     "type": "string",
    #                     "description": "源知识标题"
    #                 },
    #                 "target": {
    #                     "type": "string",
    #                     "description": "目标知识标题"
    #                 },
    #                 "relation": {
    #                     "type": "string",
    #                     "description": "关系类型，如：包含、属于、导致、相关、对比、前置、后续等"
    #                 },
    #                 "description": {
    #                     "type": "string",
    #                     "description": "关系的详细描述"
    #                 }
    #             },
    #             "required": ["source", "target", "relation"]
    #         }
    #     }
    # },
    
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "categorizeKnowledge",
    #         "description": "将知识点归类到指定的分类中。如果知识点未分类，使用此工具将其整理到合适的类别。",
    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "title": {
    #                     "type": "string",
    #                     "description": "知识标题"
    #                 },
    #                 "category": {
    #                     "type": "string",
    #                     "description": "目标分类名称"
    #                 }
    #             },
    #             "required": ["title", "category"]
    #         }
    #     }
    # },
    
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "createCategory",
    #         "description": "创建一个新的知识分类。",
    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "name": {
    #                     "type": "string",
    #                     "description": "分类名称"
    #                 },
    #                 "description": {
    #                     "type": "string",
    #                     "description": "分类描述（可选）"
    #                 }
    #             },
    #             "required": ["name"]
    #         }
    #     }
    # },

    {
        "type": "function",
        "function": {
            "name": "knowledge_graph_read",
            "description": "获取当前知识图谱的整体结构，包括所有分类及其包含的知识点列表。用于了解知识库的宏观组织结构。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },

    # {
    #     "type": "function",
    #     "function": {
    #         "name": "getKnowledgeConnections",
    #         "description": "获取指定知识点的所有连接关系（父子、关联、依赖等）。如果不指定知识点，则返回图谱中所有的连接关系。",
    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "title": {
    #                     "type": "string",
    #                     "description": "知识点标题（可选）"
    #                 }
    #             },
    #             "required": []
    #         }
    #     }
    # },
    
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "findPathBetweenKnowledge",
    #         "description": "查找两个知识点之间的关联路径。用于发现两个看似无关的知识点之间是否存在间接联系。",
    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "start": {
    #                     "type": "string",
    #                     "description": "起始知识点标题"
    #                 },
    #                 "end": {
    #                     "type": "string",
    #                     "description": "结束知识点标题"
    #                 }
    #             },
    #             "required": ["start", "end"]
    #         }
    #     }
    # },

    # {
    #     "type": "function",
    #     "function": {
    #         "name": "getContextLength",
    #         "description": "获取前offset个对话的总字符长度。用于评估对话内容的规模，帮助决定是否需要分段读取。",

    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "offset": {
    #                     "type": "integer",
    #                     "description": "从最新往前数第offset个对话（0=当前对话，1=上一个对话）"
    #                 }
    #             },
    #             "required": ["offset"]
    #         }
    #     }
    # },
    
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "getContext",
    #         "description": "获取前offset个对话从from位置到to位置的内容切片。用于分段读取长对话内容，避免一次性加载过多token。",

    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "offset": {
    #                     "type": "integer",
    #                     "description": "从最新往前数第offset个对话"
    #                 },
    #                 "from_pos": {
    #                     "type": "integer",
    #                     "description": "起始字符位置"
    #                 },
    #                 "to_pos": {
    #                     "type": "integer",
    #                     "description": "结束字符位置（不填则读取到结尾）"
    #                 }
    #             },
    #             "required": ["offset", "from_pos"]
    #         }
    #     }
    # },
    
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "getContext_findKeyword",
    #         "description": "在前offset个对话中搜索关键词，返回关键词前后range个字符的上下文。用于快速定位历史对话中的特定内容。",

    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "offset": {
    #                     "type": "integer",
    #                     "description": "从最新往前数第offset个对话"
    #                 },
    #                 "keyword": {
    #                     "type": "string",
    #                     "description": "要搜索的关键词"
    #                 },
    #                 "range": {
    #                     "type": "integer",
    #                     "description": "关键词前后返回的字符数，默认10"
    #                 }
    #             },
    #             "required": ["offset", "keyword"]
    #         }
    #     }
    # },
    {
        "type": "function",
        "function": {
            "name": "temp_context_read",
            "description": "读取当前回复作用域中的临时长文本缓存。先从长工具结果中取得 resource_id，再用 offset+length 分段读取。",
            "parameters": {
                "type": "object",
                "properties": {
                    "resource_id": {
                        "type": "string",
                        "description": "临时资源 ID，由前一次长工具结果返回。"
                    },
                    "offset": {
                        "type": "integer",
                        "description": "读取起始位置，0 表示第一个字符，默认 0。"
                    },
                    "length": {
                        "type": "integer",
                        "description": "读取字符数量，默认 2000。"
                    }
                },
                "required": ["resource_id"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "temp_context_search",
            "description": "在当前回复作用域的临时长文本缓存中搜索。传 keyword 做普通匹配，传 regex 做正则匹配。",
            "parameters": {
                "type": "object",
                "properties": {
                    "resource_id": {
                        "type": "string",
                        "description": "可选。为空时搜索当前回复作用域内的全部临时资源。"
                    },
                    "keyword": {
                        "type": "string",
                        "description": "普通搜索关键词。keyword 和 regex 二选一。"
                    },
                    "regex": {
                        "type": "string",
                        "description": "正则表达式。keyword 和 regex 二选一。"
                    },
                    "case_sensitive": {
                        "type": "boolean",
                        "description": "是否区分大小写，默认 false。"
                    },
                    "range": {
                        "type": "integer",
                        "description": "每个命中前后返回的上下文字符数，默认 80。"
                    },
                    "max_matches": {
                        "type": "integer",
                        "description": "最大返回命中数，默认 20。"
                    }
                },
                "required": []
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "temp_context_list",
            "description": "列出当前回复作用域中仍可读取的临时长文本资源。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "temp_context_clear",
            "description": "清空当前回复作用域中的临时长文本资源。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_file_create",
            "description": "在用户云端文件区创建新文本文件。文件已存在时默认失败，可通过 overwrite=true 覆盖。" + prompts.cloud_file_reference_tool_hint,
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径，格式如 {username}/files/{filename} 或仅 filename"},
                    "content": {"type": "string", "description": "初始文件内容，默认空字符串"},
                    "overwrite": {"type": "boolean", "description": "文件已存在时是否覆盖，默认 false"}
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_file_read",
            "description": prompts.cloud_file_read_tool_description,
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径，格式如 {username}/files/{filename} 或仅 filename"},
                    "from_line": {"type": "integer", "description": "按行读取的起始行，1 表示第一行。不要和 offset/length 同时使用。"},
                    "to_line": {"type": "integer", "description": "按行读取的结束行，包含该行。不要和 offset/length 同时使用。"},
                    "offset": {"type": "integer", "description": "按字符切片读取的起始位置，0 表示第一个字符。必须和 length 同时提供，不要和 from_line/to_line 同时使用。"},
                    "length": {"type": "integer", "description": "按字符切片读取的字符数量。必须和 offset 同时提供，不要和 from_line/to_line 同时使用。"}
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_file_write",
            "description": "写入用户云端文件区中的文本文件。三种写入方式三选一：content 整文件覆盖；from_line/to_line+replacement 按行替换；old_text/new_text 按文本或正则替换。" + prompts.cloud_file_reference_tool_hint,
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径，格式如 {username}/files/{filename} 或仅 filename"},
                    "content": {"type": "string", "description": "整文件覆盖内容。不要和其它替换参数同时使用。"},
                    "from_line": {"type": "integer", "description": "按行替换的起始行，1 表示第一行。与 to_line 和 replacement 配合使用。"},
                    "to_line": {"type": "integer", "description": "按行替换的结束行，包含该行。与 from_line 和 replacement 配合使用。"},
                    "replacement": {"type": "string", "description": "按行替换的新内容，可多行。"},
                    "old_text": {"type": "string", "description": "要查找的旧文本。与 new_text 配合使用。"},
                    "new_text": {"type": "string", "description": "替换后的新文本。与 old_text 配合使用。"},
                    "regex": {"type": "boolean", "description": "old_text 是否按正则表达式匹配，默认 false。"},
                    "max_replace": {"type": "integer", "description": "最大替换次数，默认全部替换"}
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_doc_write",
            "description": "根据 Markdown 正文生成真正的 Word .docx 文件并写入用户云端文件区。创建或更新 Word 文件必须使用本工具，不要使用 cloud_file_write 写 .docx。" + prompts.cloud_file_reference_tool_hint,
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Word 文件路径，格式如 {username}/files/{filename}.docx 或仅 filename.docx；不带后缀时自动补 .docx"},
                    "markdown": {"type": "string", "description": "用于生成 Word 正文的 Markdown 内容，支持标题、段落、列表、引用、表格、代码块、链接、加粗、斜体和行内代码。"},
                    "title": {"type": "string", "description": "可选 Word 文档标题，会写入文档开头。"},
                    "overwrite": {"type": "boolean", "description": "文件已存在时是否覆盖，默认 false。"},
                    "doc_options": {
                        "type": "object",
                        "description": "可选 Word 样式参数。",
                        "properties": {
                            "font_name": {"type": "string", "description": "正文中文字体，默认 Microsoft YaHei。"},
                            "font_size": {"type": "number", "description": "正文字号，默认 10.5。"},
                            "line_spacing": {"type": "number", "description": "正文行距，默认 1.15。"},
                            "top_margin": {"type": "number", "description": "上页边距，单位英寸，默认 1.0。"},
                            "bottom_margin": {"type": "number", "description": "下页边距，单位英寸，默认 1.0。"},
                            "left_margin": {"type": "number", "description": "左页边距，单位英寸，默认 1.25。"},
                            "right_margin": {"type": "number", "description": "右页边距，单位英寸，默认 1.25。"}
                        }
                    }
                },
                "required": ["file_path", "markdown"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_file_apply_diff",
            "description": "对用户云端文件区中的单个文本文件应用统一 diff。只接受 patch 文本；需要按 target 编辑时改用 cloud_file_edit。dry_run=true 时只返回预览 diff，不写入。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径，格式如 {username}/files/{filename} 或仅 filename。"},
                    "patch": {"type": "string", "description": "统一 diff 内容，必须直接传入最终 patch 文本。"},
                    "dry_run": {"type": "boolean", "description": "是否只预览不写入，默认 false。"},
                    "expected_sha256": {"type": "string", "description": "可选的文件当前内容 SHA256；不一致时拒绝修改。"}
                },
                "required": ["file_path", "patch"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_file_edit",
            "description": "对用户云端文件区中的单个文本文件执行结构化编辑。只接受 edits 数组；需要使用统一 diff 时改用 cloud_file_apply_diff。支持精确 target、Markdown 标题/HTML 注释锚点 target、换行归一化 target、忽略首尾空白/连续空白/换行/全半角差异的 Markdown 噪声归一化 target。dry_run=true 时只返回预览 diff，不写入。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径，格式如 {username}/files/{filename} 或仅 filename。"},
                    "edits": {
                        "type": "array",
                        "description": "结构化编辑列表。优先使用短而稳定的 Markdown 标题或 HTML 注释锚点作为 target；target 多次出现时必须传 occurrence。",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": {
                                    "type": "string",
                                    "enum": ["replace", "insert_before", "insert_after", "delete"],
                                    "description": "编辑动作。"
                                },
                                "target": {"type": "string", "description": "目标文本。支持精确匹配、Markdown 标题/HTML 注释锚点匹配、换行归一化匹配和 Markdown 噪声归一化匹配。"},
                                "replacement": {"type": "string", "description": "replace 动作的新文本。"},
                                "content": {"type": "string", "description": "insert_before/insert_after 动作插入的新文本。"},
                                "occurrence": {"type": "integer", "description": "target 多次出现时指定第几处，从 1 开始。"}
                            },
                            "required": ["action", "target"]
                        }
                    },
                    "dry_run": {"type": "boolean", "description": "是否只预览不写入，默认 false。"},
                    "expected_sha256": {"type": "string", "description": "可选的文件当前内容 SHA256；不一致时拒绝修改。"}
                },
                "required": ["file_path", "edits"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_file_find",
            "description": "在用户云端文件区的文本文件内查找关键词或正则，返回行号、列号和命中文本。" + prompts.cloud_file_reference_tool_hint,
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径，格式如 {username}/files/{filename} 或仅 filename"},
                    "keyword": {"type": "string", "description": "搜索关键词或正则表达式"},
                    "regex": {"type": "boolean", "description": "是否按正则匹配，默认 false"},
                    "case_sensitive": {"type": "boolean", "description": "是否区分大小写，默认 true"},
                    "max_results": {"type": "integer", "description": "最大返回命中数，默认 200"}
                },
                "required": ["file_path", "keyword"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_file_list",
            "description": "分页列出用户云端文件区中的文件，按更新时间倒序返回。可用 query 筛选 alias、original_name 或 path。" + prompts.cloud_file_reference_tool_hint,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "筛选关键词（匹配 alias/original_name/path）"},
                    "regex": {"type": "boolean", "description": "是否按 regex 匹配 query，默认 false"},
                    "offset": {"type": "integer", "description": "分页起始位置，0 表示第一条，默认 0。"},
                    "limit": {"type": "integer", "description": "分页返回数量，默认 200，最大 1000。"}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_file_remove",
            "description": "删除用户云端文件区中的文件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径，格式如 {username}/files/{filename} 或仅 filename"}
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "send_email",
            "description": "使用用户绑定邮箱发送邮件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "recipient": {"type": "string", "description": "收件人邮箱地址。"},
                    "subject": {"type": "string", "description": "邮件主题。"},
                    "content": {"type": "string", "description": "邮件正文。参数必须直接传入最终文本；需要外部内容时先调用对应读取工具取得正文。"},
                    "knowledge_title": {"type": "string", "description": "可选。content 为空时，从该标题的基础知识读取正文。"},
                    "is_html": {"type": "boolean", "description": "是否按 HTML 邮件发送，默认 false。"}
                },
                "required": ["recipient", "subject"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_email",
            "description": "按 mail_id 获取用户绑定邮箱中的一封邮件。默认返回轻量文本内容，需要 HTML 或原始内容时设置 content_type=1。",
            "parameters": {
                "type": "object",
                "properties": {
                    "mail_id": {"type": "string", "description": "要读取的邮件 ID，来自 get_email_list 的返回结果。"},
                    "content_type": {
                        "type": "integer",
                        "description": "返回内容类型：0=提取文本（默认，轻量），1=完整内容（含HTML与原始内容）",
                        "enum": [0, 1]
                    },
                    "truncate": {
                        "type": "boolean",
                        "description": "是否截断长内容，默认true"
                    },
                    "max_chars": {
                        "type": "integer",
                        "description": "截断长度上限（字符），默认12000"
                    }
                },
                "required": ["mail_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_email_list",
            "description": "获取用户绑定邮箱的邮件列表。流程：邮箱服务先按时间倒序执行 offset/limit 分页；随后在当前页内应用 type 和 date_range 过滤。",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "integer",
                        "description": "邮件列表类型：0=新邮件（未读），1=全部邮件",
                        "enum": [0, 1]
                    },
                    "date_range": {
                        "type": "integer",
                        "description": "时间范围（天），默认15，表示仅返回最近N天邮件"
                    },
                    "offset": {
                        "type": "integer",
                        "description": "分页起始位置，0 表示第一封邮件，默认 0。与 limit 配合使用，例如 offset=80, limit=20 表示从第 80 封开始返回 20 封。"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "分页返回数量，默认 20，范围 1-100。与 offset 配合使用。"
                    }
                },
                "required": []
            }
        }
    }
]




# 工具结果展示层（Presenter）
from .Presenter import ToolResultPresenter

__all__ = [n for n in globals() if not n.startswith('_')]
