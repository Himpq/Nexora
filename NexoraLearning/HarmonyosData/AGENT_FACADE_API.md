# Nexora Learning Agent Facade

第一阶段的目标是给“主动学习伙伴”一个稳定、窄而明确的 HTTP 工具面。它复用现有
NexoraLearning 的用户、课程、教材、进度和模型服务，不要求 Agent 直接理解 Flask
前端内部接口。

## 1. 运行前提

- 服务入口：`NexoraLearning/main.py`
- 默认 API 前缀：`/api/agent/v1`
- 配置文件：`NexoraLearning/data/config.json`
- 可选鉴权配置：

```json
{
  "runtime_api": {
    "enabled": true,
    "api_key": "replace-with-a-long-random-secret"
  }
}
```

请求可以使用 `X-API-Key`、`X-NexoraLearning-Key` 或 `Authorization: Bearer ...`。
当配置中的 `api_key` 为空时，开发环境不强制 API Key，但仍必须提供用户标识。

部署到云端或从本地临时连接云端模型时，优先使用环境变量覆盖配置，不要把密钥写进
`config.json`：

```text
NEXORALEARNING_NEXORA_BASE_URL=https://chat.himpqblog.cn
NEXORALEARNING_NEXORA_API_KEY=<secret>
NEXORALEARNING_RUNTIME_API_KEY=<agent-api-secret>
```

同样支持 `NEXORALEARNING_NEXORADB_SERVICE_URL`、`NEXORALEARNING_NEXORADB_API_KEY`
和 `NEXORALEARNING_PORT`。这些覆盖只存在于当前进程内，不会回写配置文件。

每个需要用户数据的请求都必须通过 JSON `username`、查询参数 `username`，或请求头
`X-Nexora-Username` / `X-Username` / `X-User-Id` 之一传入用户标识。当前用户标识是
NexoraLearning 用户目录名，不是自动推断的华为账号。

## 2. 统一响应

成功和失败都返回同一外层结构：

```json
{
  "success": true,
  "request_id": "req_abc123",
  "action": "plan",
  "data": {},
  "next_actions": [],
  "error": null
}
```

失败时 `success` 为 `false`，`error` 至少包含 `code` 和 `message`。Agent 应优先根据
`next_actions` 继续调用工具，不要依赖面向 Web UI 的内部字段。

## 3. 工具接口

### `GET /context`

读取用户画像、已选择课程、教材摘要、进度、最近学习记录和可恢复的主动学习会话。

可选查询参数：`lecture_id`。返回数据中的 `active_session` 为空对象表示没有未关闭会话。

### `POST /plan`

根据课程进度生成下一步学习目标。请求体：

```json
{
  "username": "student-001",
  "intent": "continue_learning",
  "available_minutes": 30,
  "lecture_id": "lecture_x",
  "book_id": "book_x",
  "chapter_index": 2
}
```

课程、教材和章节均可省略，省略时按用户已选课程和最近进度解析。无选课时返回
`data.status = "needs_course"` 及 `select_course` 下一动作。

### `POST /open-session`

创建一个主动学习会话，返回可直接打开现有 NexoraLearning Web 工作区的深链接：

```json
{
  "data": {
    "session_id": "session_x",
    "target": {
      "lecture_id": "lecture_x",
      "book_id": "book_x",
      "chapter_index": 2,
      "chapter_name": "第三章 ..."
    },
    "entry_url": "http://host/api/frontend/?source=agent&...",
    "entry_type": "nexoralearning_web",
    "resume": true
  }
}
```

该调用会将 `agent_session_opened` 记录追加到用户的 `learning.jsonl`，因此服务重启后
仍可由 `/context` 读取 `active_session`。Web 深链接只有带 `source=agent` 才会驱动
前端自动打开课程、教材和章节。

### `POST /ask-in-context`

在教材上下文中回答问题。请求体至少包含 `question`（也接受 `message`）；建议同时
传入 `lecture_id`、`book_id`、`chapter_index`。也可以直接传 `context_text` 或
`selected_text`，适合阅读器选中文本提问。上下文不足时模型必须明确说明，不应把联网
搜索结果伪装成教材内容。

### `POST /review-plan`

异步创建章节复习小测任务。请求体可传课程定位字段和 `limit`（服务端限制为 1--10）。
建议使用 `Idempotency-Key`，重复请求会得到同一个任务响应。

### `GET /tasks/{task_id}`

轮询复习任务。必须同时提供任务所属用户标识；缺少用户标识返回 `AUTH_REQUIRED`，
其他用户读取返回 `PERMISSION_DENIED`。任务状态为 `queued`、`running`、`completed` 或
`failed`。

### `POST /events`

记录 Agent 与学习工作区之间的事件。请求体至少包含 `event`，可选传入
`event_id`、`session_id`、课程定位字段和 `source`。同一用户的同一 `event_id` 只会
落盘一次，重复请求返回 `duplicate: true`。`session_completed`、`session_closed` 或
`learning_session_completed` 会让对应会话不再出现在 `active_session`。

## 4. 小艺 Agent 编排建议

推荐主流程：

```text
context -> plan -> open-session -> (ask-in-context | events) -> review-plan -> tasks/{id}
```

Agent 不应把教材全文放进长期记忆；问答上下文由服务端按课程、教材和章节即时裁剪。
演示时可先使用 `X-Nexora-Username` 固定测试用户，正式部署再替换为登录态映射。

## 5. 官方资料边界

本文件描述的是 NexoraLearning 自有服务契约，不是华为平台的官方接口定义。鸿蒙端、
小艺开放平台的 Agent 配置和权限字段必须以当期官方页面为准，不能把本文件中的 HTTP
字段直接当作 ArkUI 或鸿蒙系统 API。

- [鸿蒙高校创新赛总页](https://developer.huawei.com/consumer/cn/activity/incentive/C4)
- [Agent 赛题页](https://developer.huawei.com/consumer/cn/forum/topic/0204215524083454315?fid=0101215456814572136)
- [华为开发 Agent 文档](https://developer.huawei.com/consumer/cn/doc/service/developing-intelligent-agents-0000002435989592)
- [华为开发者文档中心](https://developer.huawei.com/consumer/cn/doc/)

## 6. 本地验证

在 `NexoraLearning` 目录执行：

```text
python -m unittest discover -s tests -p "test_agent_facade.py" -v
python -m py_compile api/agent_facade.py main.py
node --check frontend/assets/app.js
```
