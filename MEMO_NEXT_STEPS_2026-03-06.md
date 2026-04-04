# Nexora 备忘与下一步（2026-03-06）

## 当前目标
- 提升多模态能力（图像输入/生成）
- 增强检索工具（学术 + 百科）
- 建立可扩展工具协议（MCP）
- 保持 token 统计可解释、可追踪

---

## 待办清单（按优先级）

## P0（建议先做）
1. 图片上传持久化到服务器，并与会话绑定  
2. ArXiv / Wikipedia 工具接入（优先官方 API，不建议先爬虫）

## P1
3. MCP 工具接入（先做一个最小可用桥接）  
4. 图片生成 AI 接入（provider 适配层统一）

## P2
5. 知识库自动插图（Volcengine 相关能力接入）

## P1
6. AI 自动流程排布（如收到邮件->自动阅读->总结，...等类dify工作流程）

## P2
7. 添加一个类似笔记的功能，快速查阅重要消息，而不用翻聊天记录
---

## 1) 图片上传持久化（会话级资产）

## 需求确认
- 图片上传后不随刷新丢失
- 删除消息/删除会话时清理对应图片
- 消息回放/重渲染时可复现图片附件

## 建议方案
- 新增会话资产目录：`ChatDBServer/data/users/<user>/conversation_assets/<conversation_id>/`
- 上传时保存原图（或转存标准格式），生成资产 ID（如 `asset_<uuid>.jpg`）
- 消息 metadata 保存引用，不保存 base64 全量内容：
  - `attachments: [{type: "image", asset_id, name, mime, size}]`
- 聊天发送时把 asset 映射成可访问 URL（受鉴权）再传给模型
- 删除逻辑：
  - 删除单条消息：若无其他消息引用该资产，则删除文件
  - 删除会话：直接清理 `conversation_assets/<conversation_id>/`

## 额外建议
- 限制单图大小（如 8MB）
- 记录图片尺寸与 hash，便于去重

---

## 2) ArXiv / Wikipedia 工具（先 API，后爬虫）

## 结论
- **Wikipedia**：优先 `MediaWiki Action API` / Wikimedia 官方接口  
- **arXiv**：优先 arXiv 官方 API（Atom 查询），再加 `arxiv` Python SDK 封装  
- “国内百科爬虫”建议后置：稳定性、封禁率、合规风险都更高

## 可直接接入的现成方案
- Wikipedia：
  - MediaWiki API: https://www.mediawiki.org/wiki/API:Main_page
  - Wikimedia API 门户: https://api.wikimedia.org/
- arXiv：
  - arXiv API 说明入口: https://info.arxiv.org/help/api/
  - Python SDK（arxiv.py）: https://github.com/lukasschwab/arxiv.py

## Nexora 内部工具设计（建议）
- `wiki_search(query, lang="zh", limit=5)`
- `wiki_page(title, lang="zh", section=None)`
- `arxiv_search(query, max_results=5, sort_by="relevance")`
- `arxiv_get(paper_id_or_url)`

## 输出规范
- 一律返回结构化 JSON：`title/url/summary/snippet/source/published/authors`
- 工具结果必须附来源 URL，便于前端显示引用链

---

## 3) MCP 工具接入（最小可用）

## 现成生态
- 官方 Python SDK：`modelcontextprotocol/python-sdk`  
  https://github.com/modelcontextprotocol/python-sdk
- MCP 规范站点：  
  https://modelcontextprotocol.io/specification/

## 建议最小落地
- 新增 `mcp_gateway.py`：
  - 负责注册外部 MCP server
  - 拉取 tools schema
  - 统一执行与超时控制
- 在 `ToolExecutor` 增加一类“透传工具”（带白名单）
- 先接 1 个示例 MCP server 验证链路（不一次性全开）

---

## 4) 图片生成 AI 接入

## 架构建议
- 放到 provider 适配层（`api/providers/*`）
- 统一接口：
  - `generate_image(prompt, size, style, seed, ...) -> {url/base64, revised_prompt, usage}`
- 前端先支持“生成结果卡片 + 一键存到会话资产”

---

## 5) 知识库自动插图（Volcengine）

## 建议流程
- 在知识点生成/更新后，异步触发：
  1. 摘要抽取  
  2. 生成插图 prompt  
  3. 调用图像生成接口  
  4. 资产入库并与 knowledge 绑定
- 先做“手动触发”，稳定后再做自动触发

---

## 实施顺序（推荐）
1. 会话资产化图片上传（P0）  
2. Wikipedia + arXiv API 工具（P0）  
3. MCP 最小桥接（P1）  
4. 图片生成（P1）  
5. 知识库自动插图（P2）

---

## 风险与边界
- “百科爬虫”不是首选：页面结构易变、封禁高、维护成本高
- token 统计对图片仍依赖 provider usage 返回；若无 usage 只能估算
- MCP 接入必须做工具白名单 + 超时 + 并发限制

