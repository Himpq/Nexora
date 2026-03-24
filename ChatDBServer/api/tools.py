TOOL_NAME_ALIASES = {
    "selectTools": "select_tools",
    "EnableTools": "enable_tools",
    "vectorSearch": "vector_search",
    "arxivSearch": "arxiv_search",
    "getKnowledgeList": "get_knowledge_list",
    "addBasis": "add_basis",
    "removeBasis": "remove_basis",
    "updateBasis": "update_basis",
    "getBasisContent": "get_basis_content",
    "searchKeyword": "search_keyword",
    "linkKnowledge": "link_knowledge",
    "categorizeKnowledge": "categorize_knowledge",
    "createCategory": "create_category",
    "analyzeConnections": "analyze_connections",
    "getKnowledgeGraphStructure": "get_knowledge_graph_structure",
    "getKnowledgeConnections": "get_knowledge_connections",
    "findPathBetweenKnowledge": "find_path_between_knowledge",
    "getContextLength": "get_context_length",
    "getContext": "get_context",
    "getContext_findKeyword": "get_context_find_keyword",
    "getMainTitle": "get_main_title",
    "sendEMail": "send_email",
    "getEMail": "get_email",
    "getEMailList": "get_email_list",
    "queryShortMemory": "query_short_memory",
    "addShort": "add_short",
    "removeShort": "remove_short",
    "getUserProfileMemory": "get_user_profile_memory",
    "setUserProfileMemory": "set_user_profile_memory",
    "updateUserProfileMemory": "set_user_profile_memory",
}


def canonicalize_tool_name(name):
    raw = str(name or "").strip()
    if not raw:
        return ""
    return TOOL_NAME_ALIASES.get(raw, raw)


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "select_tools",
            "description": "可选：在 Auto 模式下按工具名请求当前轮更具体的工具子集。调用后立即生效，仅影响当前回复。",
            "parameters": {
                "type": "object",
                "properties": {
                    "tools": {
                        "type": "array",
                        "description": "要启用的工具名数组，例如 [\"client_js_exec\",\"vector_search\"]。",
                        "items": {"type": "string"}
                    },
                    "tool_names": {
                        "type": "array",
                        "description": "可选，和 tools 等价。",
                        "items": {"type": "string"}
                    },
                    "name_text": {
                        "type": "string",
                        "description": "可选，逗号分隔的工具名字符串，例如 \"client_js_exec,vector_search\"。"
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
            "name": "enable_tools",
            "description": "仅用于 Auto(OFF) 模式：调用后当前回复后续轮次立即进入 Force（开放全部业务工具）。本工具不做精确工具选择。",
            "parameters": {
                "type": "object",
                "properties": {
                    "tools": {
                        "type": "array",
                        "description": "可选，占位参数。enable_tools 会忽略精确列表并直接切换到 Force。",
                        "items": {"type": "string"}
                    },
                    "tool_names": {
                        "type": "array",
                        "description": "可选，占位参数。enable_tools 会忽略精确列表并直接切换到 Force。",
                        "items": {"type": "string"}
                    },
                    "name_text": {
                        "type": "string",
                        "description": "可选，占位参数。enable_tools 会忽略精确列表并直接切换到 Force。"
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
            "name": "vector_search",
            "description": "在向量库中做语义检索，默认检索 knowledge 库。",
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
            "name": "file_semantic_search",
            "description": "在临时文件向量库 temp_file 中做语义检索；不传 file_alias 时检索当前用户全部临时文件。",
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
            "description": """在当前聊天页的隔离 JS Worker 中执行纯 JavaScript。适合轻量计算、文本处理和 Canvas；不能访问 DOM、页面状态或网络。若要操作真实网页 DOM，请用 local_web_render / web_exec_js。可用 const canvas = context.canvas 访问内置 canvas。Three.js 入口示例：const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 1000); camera.position.z = 3; renderer.render(scene, camera); 如需拖拽/触摸绕原点旋转，可调用：const orbit = context.enableThreeOrbit({ camera, renderer, scene, target:[0,0,0] });""",
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
            "name": "get_knowledge_list",
            "description": "读取知识信息：_type=0 返回当前用户画像短期记忆，_type=1 返回基础知识库标题列表。",

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
            "name": "get_user_profile_memory",
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
            "name": "set_user_profile_memory",
            "description": "覆盖更新当前用户短期记忆画像（建议控制在400字以内）。",
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
    # 短期记忆工具已停用（保留定义仅用于回溯）。
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "queryShortMemory",
    #         "description": "查询用户短期记忆。支持按关键词过滤，返回短期记忆的ID与标题列表。",
    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "keyword": {
    #                     "type": "string",
    #                     "description": "可选，按关键词匹配短期记忆标题。为空时返回全部。"
    #                 },
    #                 "limit": {
    #                     "type": "integer",
    #                     "description": "返回条数上限，默认20，范围1-200。"
    #                 }
    #             },
    #             "required": []
    #         }
    #     }
    # },
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "addShort",
    #         "description": "向用户知识库添加短期记忆，短期记忆用于记录用户的喜好偏向、最近在做的事，这个需要频繁主动记录。",
    #
    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "title": {
    #                     "type": "string",
    #                     "description": "添加的短期记忆内容，简短总结。"
    #                 }
    #             },
    #             "required": ["title"]
    #         }
    #     }
    # },

    {
        "type": "function",
        "function": {
            "name": "add_basis",
            "description": "向用户知识库添加基础知识（长期记忆）- 学术报告级别要求。\n\n必须满足以下标准：\n1. 字数要求：最低3000字，推荐5000-10000字\n2. 结构完整：背景-核心概念-详细分析-数据支撑-对比总结-结论展望\n3. 数据精确：所有数据必须标注来源、时间、样本量，使用表格对比\n4. 引用规范：文中标注[来源](链接)，文末列出完整参考资料\n5. 格式严谨：Markdown格式，多级标题，表格对比，代码块标注\n6. 内容深度：横向对比覆盖所有关键维度，技术说明包含原理/实现/优缺点/场景/实践\n\n禁止简短概述，必须像撰写技术白皮书或学术论文那样全面、严谨、数据翔实。",

            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "基础知识的标题。"
                    },
                    "context": {
                        "type": "string",
                        "description": "基础知识的内容。支持参数模板：{{file:path}}、{{file:path,lines,1,200}}、{{basis:title,chars,0,2000}}。"
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
            "name": "remove_basis",
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
            "name": "update_basis",
            "description": "更新基础知识。支持重命名、整段覆盖、URL更新、公开/协作设置，以及按字符索引区间替换（单次或批量）。",

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
                    }
                },
                "required": ["title"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "get_basis_content",
            "description": "读取基础知识内容。支持全文读取、按字符索引区间读取、按关键词邻域读取，以及 regex（rg风格）匹配读取。",

            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "根据标题获取基础知识的内容。"
                    },
                    "keyword": {
                        "type": "string",
                        "description": "关键词或正则表达式（match_mode=regex/rg 时）。"
                    },
                    "range": {
                        "type": "integer",
                        "description": "关键词匹配时返回前后字符范围。默认 120。"
                    },
                    "from_pos": {
                        "type": "integer",
                        "description": "按字符区间读取的起始索引（包含）。"
                    },
                    "to_pos": {
                        "type": "integer",
                        "description": "按字符区间读取的结束索引（不包含）。"
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
                "required": ["title"]
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
            "name": "get_knowledge_graph_structure",
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
            "name": "search_keyword",
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
    
    # {
    #     "type": "function",
    #     "function": {
    #         "name": "getMainTitle",
    #         "description": "获取之前某次交流的总结。用于快速了解历史交流的核心内容，无需加载完整对话。offset=1表示上一次交流，offset=2表示上上次。",

    #         "parameters": {
    #             "type": "object",
    #             "properties": {
    #                 "offset": {
    #                     "type": "integer",
    #                     "description": "从最新往前数第offset次交流（1=上一次交流，2=上上次交流）"
    #                 }
    #             },
    #             "required": ["offset"]
    #         }
    #     }
    # }
    {
        "type": "function",
        "function": {
            "name": "file_create",
            "description": "在用户文件沙箱中创建新文本文件。文件已存在时默认失败，可通过 overwrite=true 覆盖。",
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
            "name": "file_read",
            "description": "读取用户文件沙箱中的文本文件，自动解析为纯文本。支持全文读取、按行范围读取、按字符索引范围读取。单次调用最多返回500行且10000字符，超出部分会自动截断并返回截断位置(line, column)。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径，格式如 {username}/files/{filename} 或仅 filename"},
                    "from_line": {"type": "integer", "description": "起始行（1-based，包含）"},
                    "to_line": {"type": "integer", "description": "结束行（1-based，包含）"},
                    "from_pos": {"type": "integer", "description": "起始字符索引（0-based，包含）"},
                    "to_pos": {"type": "integer", "description": "结束字符索引（0-based，不包含）"}
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "file_write",
            "description": "写入用户文件沙箱中的文本文件。支持整文件覆盖、按行范围替换、按句子/关键词替换。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径，格式如 {username}/files/{filename} 或仅 filename"},
                    "content": {"type": "string", "description": "整文件覆盖内容（与其他替换参数互斥）"},
                    "from_line": {"type": "integer", "description": "按行替换的起始行（1-based，包含）"},
                    "to_line": {"type": "integer", "description": "按行替换的结束行（1-based，包含）"},
                    "replacement": {"type": "string", "description": "按行替换内容（可多行）"},
                    "old_text": {"type": "string", "description": "旧文本（用于文本替换）"},
                    "new_text": {"type": "string", "description": "新文本（用于文本替换）"},
                    "regex": {"type": "boolean", "description": "old_text 是否作为正则表达式，默认 false"},
                    "max_replace": {"type": "integer", "description": "最大替换次数，默认全部替换"}
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "file_find",
            "description": "在用户文件沙箱中的文本文件内查找关键词或正则，返回行号、列号和命中文本。",
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
            "name": "file_list",
            "description": "读取用户文件沙箱中的文件，支持关键词筛选和 regex 匹配文件名。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "筛选关键词（匹配 alias/original_name/path）"},
                    "regex": {"type": "boolean", "description": "是否按 regex 匹配 query，默认 false"},
                    "max_items": {"type": "integer", "description": "最大返回条数，默认 200"}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "file_remove",
            "description": "删除用户文件沙箱中的文件。",
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
                    "recipient": {"type": "string", "description": "Recipient email address"},
                    "subject": {"type": "string", "description": "Email subject"},
                    "content": {"type": "string", "description": "Email body content. 支持参数模板 {{file:path}}、{{file:path,lines,1,200}}、{{basis:title,chars,0,2000}}"},
                    "knowledge_title": {"type": "string", "description": "Optional basis knowledge title; used when content is empty"},
                    "is_html": {"type": "boolean", "description": "Send as HTML when true"}
                },
                "required": ["recipient", "subject"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_email",
            "description": "获取用户绑定邮箱中的指定邮件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "mail_id": {"type": "string", "description": "The ID of the email to retrieve"},
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
            "description": "获取用户绑定邮箱中的邮件列表。",
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
                    }
                },
                "required": []
            }
        }
    }
]
