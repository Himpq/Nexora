# NexoraSearch 分布式搜索节点

这是一个独立、可分布部署的搜索与网页渲染节点。由于 ChatDB 等核心服务所在的服务器（如 1H1G）资源有限，不适合运行 Playwright 无头浏览器进行重度渲染，故将其拆分为独立服务。

你可以将此服务部署在资源较丰富的边缘节点（如家里的闲置电脑、配置较高的子服务器），核心服务只需通过 HTTP API 与其通信。

## 部署执行
```bash
pip install -r requirements.txt
playwright install --with-deps chromium
uvicorn app:app --host 0.0.0.0 --port 8080
```

## API 文档
- `GET /api/search/ddg`：DuckDuckGo 搜索
- `GET /api/render/webview`：通用 Headless 网页渲染（带最终 URL 跳转解析）
