# NexoraLearning API（当前实现）

本文档基于当前 `NexoraLearning/api/routes.py` 代码整理，供前端联调使用。  
默认前缀：`/api`

## 0. 通用约定

- 编码：`UTF-8`
- JSON 接口统一返回 `success` 字段
- 常见失败返回：
  - `400` 参数错误
  - `404` 资源不存在
  - `502` 上游 Nexora 接口失败
  - `503` 代理未初始化
- 会话/用户识别优先级：
  1. `?username=...`
  2. Header：`X-Nexora-Username` / `X-Username` / `X-User` / `X-User-Id`
  3. 从 Nexora Cookie 会话推断

---

## 1. 前端注入与看板

### 1.1 前端入口
- `GET /api/frontend/`
- 返回嵌入页 `index.html`

### 1.2 前端静态资源
- `GET /api/frontend/assets/<path:filename>`

### 1.3 前端上下文
- `GET /api/frontend/context?username={optional}`
- 用途：获取当前用户信息、管理员身份、Nexora 模型连通状态

### 1.4 课程+教材聚合（用于列表页）
- `GET /api/frontend/materials`
- 返回：`lectures: [{ lecture, books, books_count }]`

### 1.5 学习看板数据（仅已加入学习课程）
- `GET /api/frontend/dashboard`
- 返回重点：
  - `selected_lecture_ids`
  - `lectures: [{ lecture(with study_hours), books, books_count }]`
  - `total_study_hours`

### 1.6 加入/退出学习
- `POST /api/frontend/learning/select`
- Body:
```json
{
  "lecture_id": "l_xxx",
  "selected": true,
  "actor": "username_optional"
}
```

---

## 2. 模型代理与统一调用

### 2.1 获取 Nexora 模型列表
- `GET /api/nexora/models?username={optional}`

### 2.2 代理 PAPI completions
- `POST /api/nexora/papi/completions`
- `POST /api/nexora/papi/chat/completions`
- Body 核心：
```json
{
  "model": "model_name",
  "username": "optional",
  "messages": [{"role": "user", "content": "hello"}]
}
```

### 2.3 代理 PAPI responses
- `POST /api/nexora/papi/responses`
- Body 核心：
```json
{
  "model": "model_name",
  "username": "optional",
  "input": [],
  "instructions": "optional"
}
```

### 2.4 统一完成接口（推荐给后端内部/工具）
- `POST /api/completions`
- 三种模式：
1. `model_type` 模式（走 LearningModelFactory）
2. `messages/input` 原样透传模式
3. `system_prompt + prompt` chat 模式

示例（model_type）：
```json
{
  "model_type": "coarse_reading",
  "model": "doubao-seed-1-6-250615",
  "username": "mujica",
  "prompt": "请分析教材结构",
  "context_payload": {},
  "extra_prompt_vars": {}
}
```

---

## 3. 粗读模型配置（booksproc）

### 3.1 获取粗读模型配置
- `GET /api/models/rough-reading`

### 3.2 更新粗读模型配置
- `PATCH /api/models/rough-reading`
- 可更新字段：
  - `enabled`
  - `model_name`
  - `api_mode`
  - `temperature`
  - `max_output_tokens`
  - `max_input_chars`
  - `prompt_notes`

示例：
```json
{
  "enabled": true,
  "model_name": "doubao-seed-1-6-250615",
  "temperature": 0.2,
  "max_input_chars": 120000
}
```

---

## 4. Lecture / Book 主接口（当前主线）

## 4.1 课程（lecture）

- `GET /api/lectures`
- `POST /api/lectures`
- `GET /api/lectures/{lecture_id}`
- `PATCH /api/lectures/{lecture_id}`
- `DELETE /api/lectures/{lecture_id}`

创建课程 Body：
```json
{
  "title": "机器学习导论",
  "description": "optional",
  "category": "AI",
  "status": "draft"
}
```

## 4.2 教材（book）

- `GET /api/lectures/{lecture_id}/books`
- `POST /api/lectures/{lecture_id}/books`
- `GET /api/lectures/{lecture_id}/books/{book_id}`
- `PATCH /api/lectures/{lecture_id}/books/{book_id}`
- `DELETE /api/lectures/{lecture_id}/books/{book_id}`
- `GET /api/lectures/{lecture_id}/books/{book_id}/text`
- `POST /api/lectures/{lecture_id}/books/{book_id}/text`
- `POST /api/lectures/{lecture_id}/books/{book_id}/file`（上传原件，不自动提炼）
- `GET /api/lectures/{lecture_id}/books/{book_id}/bookinfo`
- `POST /api/lectures/{lecture_id}/books/{book_id}/bookinfo`
- `GET /api/lectures/{lecture_id}/books/{book_id}/bookdetail`
- `POST /api/lectures/{lecture_id}/books/{book_id}/bookdetail`

上传文件（multipart/form-data）：
- 字段：`file`
- 支持后缀：`.pdf .txt .md .docx .doc .epub .c .h .py .rst`

返回示例：
```json
{
  "success": true,
  "book": {},
  "message": "File uploaded. Refinement is not started automatically."
}
```

说明：
- `book.json` 仅存教材元数据与状态，不再存模型摘要字段（如 `coarse_output/current_chapter/next_chapter`）。
- 粗读模型输出统一写入：`data/lectures/{lecture_id}/books/{book_id}/bookinfo.xml`
- 精读模型输出统一写入：`data/lectures/{lecture_id}/books/{book_id}/bookdetail.xml`

---

## 5. 教材提炼队列（booksproc）

说明：上传后不会自动提炼，需要手动选择教材入队。

### 5.1 提炼候选列表
- 全局：
  - `GET /api/books/refinement/list`
  - `GET /api/books/extract/list`（别名）
- 指定课程：
  - `GET /api/lectures/{lecture_id}/books/refinement/list`
  - `GET /api/lectures/{lecture_id}/books/extract/list`（别名）
- 可选 query：`status=uploaded|queued|extracting|extracted|error`

### 5.2 队列快照
- `GET /api/refinement/queue`
- `GET /api/extract/queue`（别名）

### 5.3 批量入队
- `POST /api/lectures/{lecture_id}/books/refinement`
- `POST /api/lectures/{lecture_id}/books/extract`（别名）

Body：
```json
{
  "book_ids": ["b_xxx", "b_yyy"],
  "actor": "admin_name",
  "force": false
}
```

### 5.4 单本入队
- `POST /api/lectures/{lecture_id}/books/{book_id}/refinement`
- `POST /api/lectures/{lecture_id}/books/{book_id}/extract`（别名）

Body：
```json
{
  "actor": "admin_name",
  "force": false
}
```

---

## 6. 向量化接口（book）

### 6.1 查询向量化状态
- `GET /api/lectures/{lecture_id}/books/{book_id}/vectorize`

### 6.2 触发向量化
- `POST /api/lectures/{lecture_id}/books/{book_id}/vectorize`

Body：
```json
{
  "force": false,
  "async": true
}
```

---

## 7. 旧版 Course/Material 接口（仍可用，建议新开发优先 Lecture/Book）

- `GET/POST /api/courses`
- `GET/PATCH/DELETE /api/courses/{course_id}`
- `GET/POST /api/courses/{course_id}/materials`
- `DELETE /api/courses/{course_id}/materials/{material_id}`
- `POST /api/courses/{course_id}/materials/{material_id}/ingest`
- `GET /api/courses/{course_id}/query?q=...&top_k=...`
- `GET /api/courses/{course_id}/stats`

---

## 8. 前端开发推荐调用流程（教材管理页）

1. 拉课程列表  
`GET /api/frontend/materials` 或 `GET /api/lectures`

2. 新建教材元数据  
`POST /api/lectures/{lecture_id}/books`

3. 上传教材文件（仅存原件）  
`POST /api/lectures/{lecture_id}/books/{book_id}/file`

4. 查看待提炼列表  
`GET /api/lectures/{lecture_id}/books/refinement/list?status=uploaded`

5. 选中后手动提炼入队  
`POST /api/lectures/{lecture_id}/books/refinement`

6. 轮询队列与教材状态  
`GET /api/refinement/queue` + `GET /api/lectures/{lecture_id}/books/{book_id}`

7. 提炼后触发向量化（可异步）  
`POST /api/lectures/{lecture_id}/books/{book_id}/vectorize`
