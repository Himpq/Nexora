# 后端数据流

规则：Screen 不选 base URL，service 决定后端。

## 基础客户端

- `learningApiClient` -> `EXPO_PUBLIC_NEXORA_LEARNING_BASE_URL`
- `chatApiClient` -> `EXPO_PUBLIC_CHAT_DB_SERVER_BASE_URL`
- 共用 header：`X-Nexora-Username`、`X-API-Key`
- 默认真实环境：`NexoraLearning=https://chat.himpqblog.cn:5002`，`ChatDBServer=https://chat.himpqblog.cn`。
- Expo 真机和 Web 默认走公网真实环境；本地 `.env` 可覆盖，但不要用只有宿主机可访问的 `localhost` 给真机调试。

## 用户上下文

- `UserSetupScreen` / `SettingsScreen` -> `SessionProvider` -> `frontendService.getFrontendContext` -> `NexoraLearning GET /api/frontend/context`
- 管理员状态只认 `is_admin` 或 `user.role === "admin"`

## 学习看板与课程

- `DashboardScreen` / `CourseListScreen` / `CourseDetailScreen` -> `frontendService` / `lectureService` / `learningExperienceService` -> `NexoraLearning`
- 接口：`GET /api/frontend/materials`、`GET /api/frontend/dashboard`、`POST /api/frontend/learning/select`、`GET /api/lectures`、`GET /api/lectures/{lecture_id}`、`GET /api/frontend/outline/{lecture_id}`、`GET /api/frontend/lecture-videos`

## 教材阅读

- `CourseDetailScreen` -> `BookDetailScreen` -> `BookReaderScreen` -> `bookService` / `frontendService` / `learningExperienceService` -> `NexoraLearning`
- 接口：`GET /api/lectures/{lecture_id}/books`、`POST /api/lectures/{lecture_id}/books`、`POST /api/lectures/{lecture_id}/books/{book_id}/file`、`GET /api/lectures/{lecture_id}/books/{book_id}/text`、`GET /api/lectures/{lecture_id}/books/{book_id}/bookinfo`、`GET /api/lectures/{lecture_id}/books/{book_id}/bookdetail`、`POST /api/frontend/learning/chapter-complete`、`GET /api/frontend/knowledge-graph`、`POST /api/frontend/knowledge-graph/generate`、`GET /api/frontend/videos`、`POST /api/frontend/videos/refresh`
- 纯文本阅读页不要伪造章节完成；只有解析到真实 `chapter_name` 和 `chapter_range` 时才调用章节完成接口。

## 学习体验扩展

- `learningExperienceService` 承接 NexoraLearning 新增前端学习体验 API。
- 已有 service contract：`GET /api/frontend/notifications`、`POST /api/frontend/notifications/{notification_id}/remove`、`GET /api/frontend/profile`、`POST /api/frontend/learning-path`、`POST /api/frontend/personalized-learning/load-path`、`GET /api/frontend/videos`、`GET /api/frontend/lecture-videos`、`POST /api/frontend/videos/refresh`、`GET /api/frontend/knowledge-graph`、`POST /api/frontend/knowledge-graph/generate`、`GET /api/frontend/outline/{lecture_id}`、`POST /api/frontend/outline/{lecture_id}/generate`、`POST /api/frontend/learning/session-complete`、`POST /api/frontend/learning/chapter-record/clear`、`POST /api/frontend/quiz/chapter`。
- 当前移动端 UI 已接入课程大纲、课程推荐视频、Book 知识图谱和可验证章节完成；通知、画像、个性化学习路径、章节测验等先锁定 service contract，后续再补完整导航和交互。

## AI 学习问答

- 模型发现：`ConversationScreen` -> `learningApiClient GET /api/nexora/models`
- 前端用后端返回的 `default_model`，否则取首个可用模型 id；发给聊天接口的是模型 id，不是展示名。
- 上下文：`ConversationScreen` -> `learningChatService.getLearningRuntimeContext` -> `NexoraLearning POST /api/runtime/context`
- 流式/非流式：`ConversationScreen` -> `learningChatService.streamLearningChat` / `sendLearningChat` -> `ChatDBServer POST /api/learning/chat`
- 流式上下文固定走 `ChatDBServer /api/learning/chat`，运行时上下文仍走 `NexoraLearning /api/runtime/context`
- SSE 解析不能静默丢弃未知帧；未知帧通过 `type: "unknown"` 事件交给调用方，便于发现后端流式协议变化。

## 管理员内容流

- `AdminHomeScreen` -> `BookUploadScreen` / `RefinementQueueScreen` / `VectorizeScreen` -> `bookService` / `refinementService` / `vectorizeService` -> `NexoraLearning`
- 能力：Book metadata 和文件上传、refinement settings/start/intensive/section/stop/queue、单本 Book vectorize 状态和触发
- 管理员入口必须由 frontend context 控制，不要靠客户端猜

## Learning Feed

- `LearningFeedScreen` -> `learningFeedService` -> `NexoraLearning`
- 接口：`GET /api/frontend/learning-feeds/channels`、`GET /api/frontend/learning-feeds`、`POST /api/frontend/learning-feeds`、`POST /api/frontend/learning-feeds/{feed_id}/like`、`POST /api/frontend/learning-feeds/{feed_id}/comments`、`DELETE /api/frontend/learning-feeds/{feed_id}`、`DELETE /api/frontend/learning-feeds/{feed_id}/comments/{comment_id}`、`POST /api/frontend/settings/feed-channels`、`DELETE /api/frontend/settings/feed-channels/{channel_id}`
- Screen 内的写操作用 FIFO 队列串行执行；忙时新操作不得静默丢弃。
