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

## 存储结构说明（NexoraDB）
**按项目隔离**：
- 通过 `api_key` 选择项目配置（`data_path`、`collection_prefix`、`distance`）。
- 每个项目独立存储在自己的 `data_path` 下。

**按用户隔离**：
- collection 名称：`{collection_prefix}_{username}`
- 不同 `username` 会落到不同 collection。

**向量条目结构**：
- `id`：由 `username + title + chunk_id` 生成的 SHA1（自动生成）
- `document`：你传入的 `text`（分块内容）
- `embedding`：
  - `/upsert` 直接使用你传入的 embedding
  - `/upsert_text` 由 NexoraDB 内部模型生成
- `metadata`：至少包含
  - `username`
  - `title`
  - `source: "nexoradb"`
  - 若有分块：`chunk_id`

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

**请求体参数（逐条解释）**：
- `username` (string, 必填)：你的用户标识，用于决定写入哪个 collection（`{prefix}_{username}`）。
- `title` (string, 可选)：文档标题/分组键，用于 `/chunks` 查询与 `/delete` 按标题删除。
- `text` (string, 必填)：本次写入的文本块内容（分块文本）。
- `embedding` (float[], 必填)：该文本块的向量表示，维度需与模型一致。
- `metadata` (object, 可选)：附加元数据（任意键值），用于业务检索或定位。
- `chunk_id` (int, 可选)：分块序号（同一文档内第几块）。

请求体示例：
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

**请求体参数（逐条解释）**：
- `username` (string, 必填)：用户标识，决定写入的 collection。
- `title` (string, 可选)：文档标题/分组键。
- `text` (string, 必填)：分块文本内容。
- `metadata` (object, 可选)：附加元数据（任意键值）。
- `chunk_id` (int, 可选)：分块序号。

**metadata 要传什么？**
- **非必填**，可留空 `{}`。
- 推荐字段：
  - `chunk_start` / `chunk_end`：分块在原文中的起止位置（用于定位/跳转）。
  - `source`：数据来源（如 `nexoradb`、`user_upload`）。
  - `tag` / `category`：标签分类。
  - `note_id` / `doc_id`：你的业务侧主键。

请求体示例：
```
{
  "username": "user",
  "title": "文档标题",
  "text": "分块内容",
  "metadata": {
    "chunk_start": 1200,
    "chunk_end": 1560,
    "tag": "camera"
  },
  "chunk_id": 3
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

**请求体参数（逐条解释）**：
- `username` (string, 必填)：在哪个用户 collection 内查询。
- `embedding` (float[], 必填)：查询向量。
- `top_k` (int, 可选，默认 5)：返回最相近的前 K 条。

请求体示例：
```
{ "username": "user", "embedding": [..], "top_k": 5 }
```

返回：
```
{ "success": true, "result": {"documents": [...], "metadatas": [...], "distances": [...], "ids": [...]} }
```

### `POST /query_text`
传入文本查询（embedding 由 NexoraDB 内部生成）。

**请求体参数（逐条解释）**：
- `username` (string, 必填)：在哪个用户 collection 内查询。
- `text` (string, 必填)：查询文本。
- `top_k` (int, 可选，默认 5)：返回最相近的前 K 条。

请求体示例：
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

**请求体参数（逐条解释）**：
- `username` (string, 必填)：在哪个用户 collection 内查询。
- `title` (string, 必填)：要查询的文档标题。

请求体示例：
```
{ "username": "user", "title": "文档标题" }
```

返回：
```
{ "success": true, "chunks": [{"id": "...", "chunk_id": 0, "text": "...", "metadata": {...}}] }
```

---

## 标题列表
### `POST /titles`
获取用户下所有标题（去重、排序）。

**请求体参数（逐条解释）**：
- `username` (string, 必填)：目标用户。

返回：
```
{ "success": true, "titles": ["title1", "title2"] }
```

---

## 删除
### `POST /delete`
按 `vector_id` 删除，或按 `title` 批量删除。

**请求体参数（逐条解释）**：
- `username` (string, 必填)：目标用户。
- `vector_id` (string, 可选)：要删除的向量 ID（优先级高）。
- `title` (string, 可选)：删除该标题的所有块。

请求体示例（删除单条）：
```
{ "username": "user", "vector_id": "user:<sha1>" }
```

请求体示例（删除整标题的所有块）：
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
**请求体参数（逐条解释）**：
- `username`：管理员用户名
- `password`：管理员密码

请求体：
```
{ "username": "admin", "password": "pass" }
```

### `POST /admin/logout`

### `GET /admin/api/projects`
获取项目列表。

### `POST /admin/api/projects`
新建项目。

**请求体参数（逐条解释）**：
- `name` (string, 必填)：项目名
- `api_key` (string, 可选)：不传则自动生成
- `data_path` (string, 可选)：不传则默认 `./chroma_data/<name>`
- `collection_prefix` (string, 可选)：默认 `knowledge`
- `distance` (string, 可选)：默认 `cosine`

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
