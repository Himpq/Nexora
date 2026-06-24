TOOL_NAME_ALIASES = {
    "selectTools": "runtime_tool_select",
    "select_tools": "runtime_tool_select",
    "EnableTools": "runtime_tool_enable",
    "enable_tools": "runtime_tool_enable",
    "vectorSearch": "knowledge_search_vector",
    "vector_search": "knowledge_search_vector",
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
    "generateImage": "generate_image",
    "file_create": "cloud_file_create",
    "file_read": "cloud_file_read",
    "file_write": "cloud_file_write",
    "file_patch": "cloud_file_patch",
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


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "server_web_search",
            "description": "进行系统级互联网搜索引擎实时检索。当你需要搜集网络资讯（如国内某物近况等）或者用户要求联网查询时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词"
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
            "name": "runtime_tool_select",
            "description": "可选：在 Auto 模式下按工具名请求当前轮更具体的工具子集。调用后立即生效，仅影响当前回复。",
            "parameters": {
                "type": "object",
                "properties": {
                    "tools": {
                        "type": "array",
                        "description": "要启用的工具名数组，例如 [\"client_js_exec\",\"knowledge_search_vector\"]。",
                        "items": {"type": "string"}
                    },
                    "tool_names": {
                        "type": "array",
                        "description": "可选，和 tools 等价。",
                        "items": {"type": "string"}
                    },
                    "name_text": {
                        "type": "string",
                        "description": "可选，逗号分隔的工具名字符串，例如 \"client_js_exec,knowledge_search_vector\"。"
                    },
                    "reason": {
                        "type": "string",
                        "description": "可选，简要说明选择理由。"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "runtime_tool_enable",
            "description": "仅用于 Auto(OFF) 模式：调用后当前回复后续轮次立即进入 Force（开放全部业务工具）。本工具不做精确工具选择。",
            "parameters": {
                "type": "object",
                "properties": {
                    "tools": {
                        "type": "array",
                        "description": "可选，占位参数。runtime_tool_enable 会忽略精确列表并直接切换到 Force。",
                        "items": {"type": "string"}
                    },
                    "tool_names": {
                        "type": "array",
                        "description": "可选，占位参数。runtime_tool_enable 会忽略精确列表并直接切换到 Force。",
                        "items": {"type": "string"}
                    },
                    "name_text": {
                        "type": "string",
                        "description": "可选，占位参数。runtime_tool_enable 会忽略精确列表并直接切换到 Force。"
                    },
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
            "name": "knowledge_search_vector",
            "description": "在向量库中做语义检索，仅能检索知识库的内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索文本"
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "返回条数，默认5"
                    },
                    "library": {
                        "type": "string",
                        "description": "可选，向量库命名空间。默认 knowledge。"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_file_search_semantic",
            "description": "在用户云端文件向量库 temp_file 中做语义检索；不传 file_alias 时检索当前用户全部云端文件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "语义检索问题"
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "返回条数，默认5，范围1-20"
                    },
                    "file_alias": {
                        "type": "string",
                        "description": "可选，单文件筛选参数（支持 user/files/xxx、alias、原始文件名）。不传则默认全文件库检索。"
                    }
                },
                "required": ["query"]
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
            "description": "Read knowledge info: _type=0 returns current user profile short-memory; _type=1 returns basis entries with title and basis_id.",

            "parameters": {
                "type": "object",
                "properties": {
                    "_type": {
                        "type": "integer",
                        "description": "知识类型：0=用户画像短期记忆，1=基础知识库。",
                        "enum": [0, 1]
                    }
                },
                "required": ["_type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "memory_profile_read",
            "description": "读取当前用户短期记忆中的用户画像（约400字）。",
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
            "description": "覆盖更新当前用户短期记忆画像（无文本长度限制）",
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
            "description": "向用户短期记忆追加一条记录，适合补充近期偏好、事项或临时关注点。",

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
                        "description": "基础知识正文，使用 Markdown。支持模板：{{file:path}}、{{file:path,lines,1,200}}、{{basis:title,chars,start,end}}。"
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
    
    {
        "type": "function",
        "function": {
            "name": "knowledge_basis_update",
            "description": "更新基础知识。支持重命名、整段覆盖、URL更新、公开/协作设置、按字符索引区间替换，以及统一 diff/结构化 edits 精确 patch。内容更新方式 context、区间替换、patch/edits 三选一。",

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
                        "description": "新的知识内容（Markdown格式，如果需要更新内容，否则不填）。支持参数模板 {{file:...}} / {{basis:...}}。"
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
                    "from_pos": {
                        "type": "integer",
                        "description": "单次区间替换的起始索引（包含）。与 to_pos + replacement 配合使用。"
                    },
                    "to_pos": {
                        "type": "integer",
                        "description": "单次区间替换的结束索引（不包含）。"
                    },
                    "replacement": {
                        "type": "string",
                        "description": "单次区间替换的新文本。支持参数模板 {{file:...}} / {{basis:...}}。"
                    },
                    "replacements": {
                        "type": "array",
                        "description": "批量区间替换列表。每项包含 from_pos、to_pos、replacement。",
                        "items": {
                            "type": "object",
                            "properties": {
                                "from_pos": {
                                    "type": "integer"
                                },
                                "to_pos": {
                                    "type": "integer"
                                },
                                "replacement": {
                                    "type": "string"
                                }
                            },
                            "required": ["from_pos", "to_pos", "replacement"]
                        }
                    },
                    "patch": {
                        "type": "string",
                        "description": "统一 diff 内容。提供 patch 时不能同时提供 context、区间替换或 edits。支持参数模板 {{file:...}} / {{basis:...}}。"
                    },
                    "edits": {
                        "type": "array",
                        "description": "结构化精确编辑列表。提供 edits 时不能同时提供 context、区间替换或 patch。",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": {
                                    "type": "string",
                                    "enum": ["replace", "insert_before", "insert_after", "delete"],
                                    "description": "编辑动作。"
                                },
                                "target": {
                                    "type": "string",
                                    "description": "必须精确匹配的目标文本。"
                                },
                                "replacement": {
                                    "type": "string",
                                    "description": "replace 动作的新文本。支持参数模板 {{file:...}} / {{basis:...}}。"
                                },
                                "content": {
                                    "type": "string",
                                    "description": "insert_before/insert_after 动作插入的新文本。支持参数模板 {{file:...}} / {{basis:...}}。"
                                },
                                "occurrence": {
                                    "type": "integer",
                                    "description": "target 多次出现时指定第几处，从 1 开始。"
                                }
                            },
                            "required": ["action", "target"]
                        }
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "是否只预览不写入，默认 false。仅用于 patch/edits 或区间替换。"
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
            "description": "读取基础知识内容。三种读取方式三选一：不传范围参数读全文；传 offset+length 按字符切片；传 keyword 按关键词或 regex 返回命中邻域。",

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
    
    {
        "type": "function",
        "function": {
            "name": "relay_web_search",
            "description": "本地中转联网搜索工具（relay）。仅在当前模型缺少原生联网搜索能力或本地知识不足时使用。必须返回可验证来源，严禁编造URL/日期/来源。",

            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词或问题描述。要求具体、可检索，避免过宽泛。"
                    }
                },
                "required": ["query"]
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
            "name": "knowledge_search_keyword",
            "description": "在知识库（短期记忆和基础知识）中搜索关键词，返回包含关键词的标题和内容片段。用于快速查找知识库中的相关信息。",

            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {
                        "type": "string",
                        "description": "要搜索的关键词"
                    },
                    "range": {
                        "type": "integer",
                        "description": "关键词前后返回的字符数，默认10"
                    }
                },
                "required": ["keyword"]
            }
        }
    },

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
            "description": "在用户云端文件区创建新文本文件。文件已存在时默认失败，可通过 overwrite=true 覆盖。",
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
            "description": "读取用户云端文件区中的文本文件。三种读取方式三选一：不传范围参数读全文；传 from_line/to_line 按行读取；传 offset/length 按字符切片读取。单次最多返回500行且10000字符。",
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
            "description": "写入用户云端文件区中的文本文件。三种写入方式三选一：content 整文件覆盖；from_line/to_line+replacement 按行替换；old_text/new_text 按文本或正则替换。",
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
            "name": "cloud_file_patch",
            "description": "对用户云端文件区中的单个文本文件执行精确 patch。必须且只能提供 patch 或 edits 其中一种；patch 使用统一 diff 格式，edits 使用结构化精确编辑。dry_run=true 时只返回预览 diff，不写入。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径，格式如 {username}/files/{filename} 或仅 filename。"},
                    "patch": {"type": "string", "description": "统一 diff 内容。提供 patch 时不能同时提供 edits。"},
                    "edits": {
                        "type": "array",
                        "description": "结构化精确编辑列表。提供 edits 时不能同时提供 patch。",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": {
                                    "type": "string",
                                    "enum": ["replace", "insert_before", "insert_after", "delete"],
                                    "description": "编辑动作。"
                                },
                                "target": {"type": "string", "description": "必须精确匹配的目标文本。"},
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
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cloud_file_find",
            "description": "在用户云端文件区的文本文件内查找关键词或正则，返回行号、列号和命中文本。",
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
            "description": "分页列出用户云端文件区中的文件，按更新时间倒序返回。可用 query 筛选 alias、original_name 或 path。",
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
                    "content": {"type": "string", "description": "邮件正文。支持模板：{{file:path}}、{{file:path,lines,1,200}}、{{basis:title,chars,start,end}}。"},
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


