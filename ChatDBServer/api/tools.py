
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "vectorSearch",
            "description": "在向量数据库中搜索内容，返回最相关的文章ID列表（含标题与相似度分数）。仅在启用向量数据库时可用。",
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
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "getKnowledgeList",
            "description": "获取用户知识库的标题列表，分为短期记忆和基础知识库两种，请优先使用本函数查阅知识库内容。",

            "parameters": {
                "type": "object",
                "properties": {
                    "_type": {
                        "type": "integer",
                        "description": "知识库的类型，例如短期记忆为0，基础知识库为1",
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
            "name": "addShort",
            "description": "向用户知识库添加短期记忆，短期记忆用于记录用户的喜好偏向、最近在做的事，这个需要频繁主动记录。",

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
            "name": "addBasis",
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
                        "description": "基础知识的内容。"
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

    {
        "type": "function",
        "function": {
            "name": "removeShort",
            "description": "删除用户知识库中的短期记忆。",

            "parameters": {
                "type": "object",
                "properties": {
                    "ID": {
                        "type": "integer",
                        "description": "删除的短期记忆内容。"
                    }
                },
                "required": ["ID"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "removeBasis",
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
            "name": "updateBasis",
            "description": "更新用户知识库中已存在的基础知识内容。可以修改知识的标题、内容或来源链接。如果要重命名，需要同时提供旧标题和新标题。",

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
                        "description": "新的知识内容（Markdown格式，如果需要更新内容，否则不填）。"
                    },
                    "url": {
                        "type": "string",
                        "description": "新的来源链接（如果需要更新，否则不填）。"
                    }
                },
                "required": ["title"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "getBasisContent",
            "description": "通过title key读取基础知识库内容，title key不存在会报错。",

            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "根据标题获取基础知识的内容。"
                    }
                },
                "required": ["title"]
            }
        }
    },
    
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "联网搜索功能，用于查询实时信息、新闻、天气、或知识库中不存在的特定产品信息及对比。当本地知识库搜索不到结果时，必须调用此工具。",

            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索问题，应该是清晰、完整的问题描述。"
                    }
                },
                "required": ["query"]
            }
        }
    },
    
    {
        "type": "function",
        "function": {
            "name": "analyzeConnections",
            "description": "分析知识库中指定知识的串联关系，返回与该知识相关联的其他知识及其关系类型（关联/依赖/扩展/对比/补充）。用于发现知识之间的联系和构建知识网络。",

            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "要分析串联关系的知识标题。"
                    }
                },
                "required": ["title"]
            }
        }
    },
    
    {
        "type": "function",
        "function": {
            "name": "linkKnowledge",
            "description": "建立两个知识点之间的关联连接。用于构建知识网络，帮助AI理解知识间的逻辑关系。",
            "parameters": {
                "type": "object",
                "properties": {
                    "source": {
                        "type": "string",
                        "description": "源知识标题"
                    },
                    "target": {
                        "type": "string",
                        "description": "目标知识标题"
                    },
                    "relation": {
                        "type": "string",
                        "description": "关系类型，如：包含、属于、导致、相关、对比、前置、后续等"
                    },
                    "description": {
                        "type": "string",
                        "description": "关系的详细描述"
                    }
                },
                "required": ["source", "target", "relation"]
            }
        }
    },
    
    {
        "type": "function",
        "function": {
            "name": "categorizeKnowledge",
            "description": "将知识点归类到指定的分类中。如果知识点未分类，使用此工具将其整理到合适的类别。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "知识标题"
                    },
                    "category": {
                        "type": "string",
                        "description": "目标分类名称"
                    }
                },
                "required": ["title", "category"]
            }
        }
    },
    
    {
        "type": "function",
        "function": {
            "name": "createCategory",
            "description": "创建一个新的知识分类。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "分类名称"
                    },
                    "description": {
                        "type": "string",
                        "description": "分类描述（可选）"
                    }
                },
                "required": ["name"]
            }
        }
    },

    {
        "type": "function",
        "function": {
            "name": "getKnowledgeGraphStructure",
            "description": "获取当前知识图谱的整体结构，包括所有分类及其包含的知识点列表。用于了解知识库的宏观组织结构。",
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
            "name": "getKnowledgeConnections",
            "description": "获取指定知识点的所有连接关系（父子、关联、依赖等）。如果不指定知识点，则返回图谱中所有的连接关系。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "知识点标题（可选）"
                    }
                },
                "required": []
            }
        }
    },
    
    {
        "type": "function",
        "function": {
            "name": "findPathBetweenKnowledge",
            "description": "查找两个知识点之间的关联路径。用于发现两个看似无关的知识点之间是否存在间接联系。",
            "parameters": {
                "type": "object",
                "properties": {
                    "start": {
                        "type": "string",
                        "description": "起始知识点标题"
                    },
                    "end": {
                        "type": "string",
                        "description": "结束知识点标题"
                    }
                },
                "required": ["start", "end"]
            }
        }
    },
    
    {
        "type": "function",
        "function": {
            "name": "getContextLength",
            "description": "获取前offset个对话的总字符长度。用于评估对话内容的规模，帮助决定是否需要分段读取。",

            "parameters": {
                "type": "object",
                "properties": {
                    "offset": {
                        "type": "integer",
                        "description": "从最新往前数第offset个对话（0=当前对话，1=上一个对话）"
                    }
                },
                "required": ["offset"]
            }
        }
    },
    
    {
        "type": "function",
        "function": {
            "name": "getContext",
            "description": "获取前offset个对话从from位置到to位置的内容切片。用于分段读取长对话内容，避免一次性加载过多token。",

            "parameters": {
                "type": "object",
                "properties": {
                    "offset": {
                        "type": "integer",
                        "description": "从最新往前数第offset个对话"
                    },
                    "from_pos": {
                        "type": "integer",
                        "description": "起始字符位置"
                    },
                    "to_pos": {
                        "type": "integer",
                        "description": "结束字符位置（不填则读取到结尾）"
                    }
                },
                "required": ["offset", "from_pos"]
            }
        }
    },
    
    {
        "type": "function",
        "function": {
            "name": "getContext_findKeyword",
            "description": "在前offset个对话中搜索关键词，返回关键词前后range个字符的上下文。用于快速定位历史对话中的特定内容。",

            "parameters": {
                "type": "object",
                "properties": {
                    "offset": {
                        "type": "integer",
                        "description": "从最新往前数第offset个对话"
                    },
                    "keyword": {
                        "type": "string",
                        "description": "要搜索的关键词"
                    },
                    "range": {
                        "type": "integer",
                        "description": "关键词前后返回的字符数，默认10"
                    }
                },
                "required": ["offset", "keyword"]
            }
        }
    },
    
    {
        "type": "function",
        "function": {
            "name": "searchKeyword",
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
            "name": "getMainTitle",
            "description": "获取之前某次交流的总结。用于快速了解历史交流的核心内容，无需加载完整对话。offset=1表示上一次交流，offset=2表示上上次。",

            "parameters": {
                "type": "object",
                "properties": {
                    "offset": {
                        "type": "integer",
                        "description": "从最新往前数第offset次交流（1=上一次交流，2=上上次交流）"
                    }
                },
                "required": ["offset"]
            }
        }
    }
]
