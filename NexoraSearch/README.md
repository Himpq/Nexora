# NexoraSearch

这是一个独立部署的搜索与网页处理节点。当前版本保留原有搜索与渲染能力，同时新增一个最小可用的页面解析入口，直接通过 Nexora 的 PAPI 调用指定模型完成页面解析。

## 部署
```bash
pip install -r requirements.txt
python app.py
```

首次启动时会自动生成 `config/config.json`。你也可以先复制 `config.example.json` 作为配置模板。

## 新增配置
`config.json` 新增了两块关键内容：

- `nexora`：PAPI 基地址、API Key、用户名和请求路径
- `models.page_parse_agent`：页面解析模型定义，包括 `model_name`、`api_mode`、`temperature`、`max_output_tokens` 和 `system_prompt`

## API
- `GET /api/search/ddg`：DuckDuckGo 搜索
- `GET /api/search/render`：搜索结果页抓取
- `GET /api/render/webview`：网页渲染
- `POST /api/agent/parse`：调用 Nexora 模型解析页面

## `POST /api/agent/parse`
请求体示例：
```json
{
    "url": "https://example.com/article",
    "title": "Example Article",
    "text": "page text",
    "html": "<html>...</html>",
    "instructions": "只输出 JSON",
    "model": "page_parse_agent"
}
```

返回值包含：

- `parsed`：模型解析出的 JSON
- `raw_text`：模型原始输出
- `endpoint`：实际调用的 PAPI 路径
- `model`：实际使用的 Nexora 模型 ID

## 这版为什么不需要 Tavily / Firecrawl
第一版不必先接 Tavily 或 Firecrawl。现在这条链路已经能做到：

- 由你自己控制 PAPI 和模型
- 直接把页面内容交给 Nexora 模型解析
- 不额外引入第三方爬取服务、额外费用和新的失败面

如果后面你要的是“强爬取 + JS 渲染 + 抽取正文”的外部服务，或者你希望把网页抓取也外包出去，再考虑 Tavily / Firecrawl 会更合适。
