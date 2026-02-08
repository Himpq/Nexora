# NexoraDB API（中文说明）

基础地址：`http://<host>:<port>`

## 鉴权
除 `GET /`、`GET /health` 和 `/admin/*` 之外的接口都需要 API Key。

支持两种传递方式：
- Header：`X-API-Key: <api_key>`（推荐）
- Query：`?api_key=<api_key>`

### 多项目说明
如果 `config.json` 配置了 `projects`，每个项目有独立的 `api_key` 与 `data_path`。访问该项目数据时需使用对应 `api_key`。若未配置 `projects`，使用根配置中的 `api_key`。

---

## 健康检查与统计
### `GET /`
健康检查。

返回：
```
{ "success": true, "service": "NexoraDB" }
```

### `GET /health`
同 `/`。

### `GET /stats`
列出全部 collection 及向量总数。

返回：
```
{ "success": true, "collections": [{"name": "...", "count": 123}], "total_vectors": 123 }
```

---

## 向量写入
### `POST /upsert`
写入**已计算 embedding**的向量。

请求体：
```
{
  "username": "user",
  "title": "文档标题",
  "text": "分块内容",
  "embedding": [0.1, 0.2, ...],
  "metadata": {"any": "value"},
  "chunk_id": 0
}
```

返回：
```
{ "success": true, "vector_id": "user:<sha1>" }
```

### `POST /upsert_text`
写入文本，embedding 由 NexoraDB 内部生成。

请求体：
```
{
  "username": "user",
  "title": "文档标题",
  "text": "分块内容",
  "metadata": {"any": "value"},
  "chunk_id": 0
}
```

返回：
```
{ "success": true, "vector_id": "user:<sha1>" }
```

---

## 查询
### `POST /query`
传入**已计算 embedding**进行查询。

请求体：
```
{ "username": "user", "embedding": [..], "top_k": 5 }
```

返回：
```
{ "success": true, "result": {"documents": [...], "metadatas": [...], "distances": [...], "ids": [...]} }
```

### `POST /query_text`
传入文本查询（embedding 由 NexoraDB 内部生成）。

请求体：
```
{ "username": "user", "text": "query", "top_k": 5 }
```

返回：
```
{ "success": true, "result": {"documents": [...], "metadatas": [...], "distances": [...], "ids": [...]} }
```

---

## 分块查询
### `POST /chunks`
按标题查询分块内容。

请求体：
```
{ "username": "user", "title": "文档标题" }
```

返回：
```
{ "success": true, "chunks": [{"id": "...", "chunk_id": 0, "text": "...", "metadata": {...}}] }
```

---

## 删除
### `POST /delete`
按 `vector_id` 删除，或按 `title` 批量删除。

请求体（删除单条）：
```
{ "username": "user", "vector_id": "user:<sha1>" }
```

请求体（删除整标题的所有块）：
```
{ "username": "user", "title": "文档标题" }
```

返回：
```
{ "success": true }
```

---

## 管理接口（Session 登录）
这些接口不需要 API Key，通过管理员登录后产生的 Session Cookie 访问。

### `GET /admin`
管理后台页面。

### `POST /admin/login`
请求体：
```
{ "username": "admin", "password": "pass" }
```

### `POST /admin/logout`

### `GET /admin/api/projects`
获取项目列表。

### `POST /admin/api/projects`
新建项目。

请求体：
```
{
  "name": "proj_name",
  "api_key": "可选",
  "data_path": "可选",
  "collection_prefix": "knowledge",
  "distance": "cosine"
}
```

### `DELETE /admin/api/projects/<name>`
删除项目。

### `POST /admin/api/projects/<name>/rotate`
轮换项目 API Key。

### `GET /admin/api/status`
获取服务状态 / 存储大小 / 向量统计。

---

## 调用示例
### cURL
```
curl -X POST http://127.0.0.1:8100/query_text \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <api_key>" \
  -d '{"username":"mujica","text":"hello","top_k":3}'
```

### fetch
```
await fetch('http://127.0.0.1:8100/query_text', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': '<api_key>' },
  body: JSON.stringify({ username: 'mujica', text: 'hello', top_k: 3 })
});
```
