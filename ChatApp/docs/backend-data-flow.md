# 后端数据流

规则：Screen 不选 base URL，service 决定后端。

## 基础客户端

- `learningApiClient` -> `EXPO_PUBLIC_NEXORA_LEARNING_BASE_URL`
- `chatApiClient` -> `EXPO_PUBLIC_CHAT_DB_SERVER_BASE_URL`
- 共用 header：`X-Nexora-Username`、`X-API-Key`
- `chatApiClient` 带 `credentials: "include"`：登录后用 Flask session cookie 访问会话类接口（`/api/chat/stream`、`/api/conversations/*`、`/api/config`）。`X-API-Key` 仍保留给 `/api/papi/*` 与 `/api/learning/chat`，两套鉴权在同一 host 并存。
- 默认真实环境：`NexoraLearning=https://chat.himpqblog.cn:5002`，`ChatDBServer=https://chat.himpqblog.cn`。
- Expo 真机和 Web 默认走公网真实环境；本地 `.env` 可覆盖，但不要用只有宿主机可访问的 `localhost` 给真机调试。

## 用户上下文

- 登录：`LoginScreen` 区分用户登录 / 管理员登录入口，但认证仍共用 `SessionProvider.signIn` -> `sessionService.login` -> `ChatDBServer POST /login`（账号+密码，写 Flask session cookie；账号与 NexoraLearning 用户名同一套）。登录后 `SessionProvider` 读取 `NexoraLearning GET /api/frontend/context`，用 `is_admin` 或 `user.role === "admin"` 校验入口角色；用户入口遇到 admin 账号会退出并提示“请使用管理员登录”，管理员入口遇到非 admin 账号会退出并提示使用用户登录。校验通过后用户名注入两个 client 的 `X-Nexora-Username`。
- `SettingsScreen` 退出 -> `SessionProvider.clearUsername` -> `sessionService.logout` -> `ChatDBServer POST /logout`。
- 上下文：`SessionProvider` -> `frontendService.getFrontendContext` -> `NexoraLearning GET /api/frontend/context`
- 管理员状态只认 `is_admin` 或 `user.role === "admin"`；Admin Tab 和管理员 Stack 页面都必须由该状态控制。

## 学习看板与课程

- `DashboardScreen` / `CourseListScreen` / `CourseDetailScreen` -> `frontendService` / `lectureService` / `learningExperienceService` / `imageService` -> `NexoraLearning`
- 接口：`GET /api/frontend/materials`、`GET /api/frontend/dashboard`、`POST /api/frontend/learning/select`、`GET /api/lectures`、`GET /api/lectures/{lecture_id}`、`GET /api/lectures/{lecture_id}/cover-assets`、`GET /api/frontend/outline/{lecture_id}`、`GET /api/frontend/lecture-videos`
- 封面优先使用 Lecture / Book 实体上的 `cover_path` / `cover`，课程详情可用 `cover-assets` 补齐 Book 封面；相对路径由 `imageService` 按 `learningApiClient` base URL 补全。

## 教材阅读

- `CourseDetailScreen` -> `BookDetailScreen` -> `BookReaderScreen` -> `bookService` / `frontendService` / `learningExperienceService` -> `NexoraLearning`
- 接口：`GET /api/lectures/{lecture_id}/books`、`POST /api/lectures/{lecture_id}/books`、`POST /api/lectures/{lecture_id}/books/{book_id}/file`、`GET /api/lectures/{lecture_id}/books/{book_id}/text`、`POST /api/lectures/{lecture_id}/books/{book_id}/text`、`GET /api/lectures/{lecture_id}/books/{book_id}/bookinfo`、`GET /api/lectures/{lecture_id}/books/{book_id}/bookdetail`、`GET /api/lectures/{lecture_id}/books/{book_id}/sections`、`GET /api/lectures/{lecture_id}/books/{book_id}/chapter/{chapter_index}`、`GET /api/lectures/{lecture_id}/books/{book_id}/annotations`、`GET /api/lectures/{lecture_id}/books/{book_id}/summary`、`POST /api/lectures/{lecture_id}/books/{book_id}/parse`、`GET /api/lectures/{lecture_id}/books/{book_id}/cover-assets`、`GET /api/lectures/{lecture_id}/books/{book_id}/images/{image_id}`、`POST /api/frontend/learning/chapter-complete`、`GET /api/frontend/knowledge-graph`、`POST /api/frontend/knowledge-graph/generate`、`GET /api/frontend/videos`、`POST /api/frontend/videos/refresh`
- 纯文本阅读页不要伪造章节完成；只有解析到真实 `chapter_name` 和 `chapter_range` 时才调用章节完成接口。

## 学习体验扩展

- `learningExperienceService` 承接 NexoraLearning 新增前端学习体验 API。
- 已有 service contract：`GET /api/frontend/notifications`、`POST /api/frontend/notifications/{notification_id}/remove`、`GET /api/frontend/profile`、`POST /api/frontend/learning-path`、`POST /api/frontend/personalized-learning/load-path`、`GET /api/frontend/videos`、`GET /api/frontend/lecture-videos`、`POST /api/frontend/videos/refresh`、`GET /api/frontend/knowledge-graph`、`POST /api/frontend/knowledge-graph/generate`、`GET /api/frontend/outline/{lecture_id}`、`POST /api/frontend/outline/{lecture_id}/generate`、`POST /api/frontend/learning/session-complete`、`POST /api/frontend/learning/chapter-record/clear`、`POST /api/frontend/quiz/chapter`。
- `learningContentService` 已锁定扩展 contract：`POST /api/frontend/reader-guide/generate`、`POST /api/frontend/reader-guide/stream`、`POST /api/frontend/reader-guide/pre-questions`、`POST /api/frontend/reader-guide/pre-questions/save`、`POST /api/frontend/reader-guide/pre-questions/check`、`POST /api/frontend/reader-guide/user-profile`、`POST /api/frontend/quiz/generate`、`POST /api/frontend/quiz/submit`、`POST /api/frontend/quiz/submit-batch`、`GET /api/frontend/mindmap/{lecture_id}`、`GET /api/frontend/mindmap/{lecture_id}/generate-stream`、`POST /api/frontend/mindmap/{lecture_id}/section`、`POST /api/frontend/personalized-learning/generate-path`、`GET /api/frontend/personalized-learning/generate-path-stream`、`POST /api/frontend/personalized-learning/load-path`、`POST /api/frontend/personalized-learning/generate-chapter`、`POST /api/frontend/personalized-learning/generate-chapter-stream`、`POST /api/frontend/personalized-learning/load-chapter`、`POST /api/frontend/personalized-learning/chapter-complete`、`POST /api/frontend/personalized-learning/chapter-quiz`、`POST /api/frontend/personalized-learning/save-qa`、`POST /api/frontend/personalized-learning/load-qa`、`GET /api/frontend/personalized-learning/generate-qa-stream`、`GET /api/frontend/learning/report`、`GET /api/frontend/teacher/class-overview`、`GET /api/frontend/teacher/student-analysis`、`POST /api/frontend/card`、`GET /api/frontend/question-bank`、`GET /api/frontend/users/search`、`GET /api/frontend/learning-feeds/users/search`。
- 当前移动端 UI 已接入课程大纲、课程推荐视频、Book 知识图谱和可验证章节完成；通知、画像、reader guide、mindmap、个性化学习路径、章节/课时测验、学习报告、教师视图和题库等先锁定 service contract，后续再补完整导航和交互。

## 通用 AI 对话（问答 Tab）

- 「问答」Tab 已整页重构为通用 AI 对话，剥离 NexoraLearning 学习上下文，直接接 Nexora（ChatDBServer）会话内核，鉴权用 session cookie。
- 模型列表：`ConversationScreen` -> `chatConfigService.getChatConfig` -> `ChatDBServer GET /api/config`（`models` + `default_model`）。
- 流式对话：`ConversationScreen` -> `chatService.streamChat` -> `ChatDBServer POST /api/chat/stream`，字段 `message / conversation_id / model_name / enable_thinking / enable_web_search / enable_tools / is_regenerate`。
- SSE 为 `{type,...}` 运行时帧：`content` / `reasoning_content` / `conversation_id` / `error`，结尾 `[DONE]`；解析在 `services/sse.ts` + `chatService.mapChatStreamChunk`，未知帧通过 `type: "unknown"` 事件交给调用方，不静默丢弃。
- 取消：`/api/chat/stream` 的 `stream_session` 帧提供 `stream_id`；`ConversationScreen` 停止、切换对话或新建对话时会先请求 `POST /api/chat/stream/cancel`，再用 `AbortController` 中断本地读流。
- 重生成：`is_regenerate=true` + `regenerate_index`（历史消息的真实服务端 index，前端在按最近 80 条截断时仍保留原 index 对齐后端；流式新消息无 index 时省略，由后端按「最后一条 assistant」默认处理）。
- 流式竞态：`ConversationScreen` 用单调递增的 stream token 守卫回调，切换对话/新会话时令旧流失效，避免旧流把内容写进新对话或把 `activeId` 改回旧对话；`activeId` 经 `activeIdRef` + 函数式 `setActiveId` 更新，避免闭包捕获陈旧值。
- 会话历史/管理：`conversationService` -> `ChatDBServer`：`GET /api/conversations`、`GET /api/conversations/{id}`、`POST /api/conversations`、`DELETE /api/conversations/{id}`、`PUT /api/conversations/{id}/title`、`POST /api/conversations/{id}/pin`。历史由 Nexora 服务端持久化，App 内可新建/切换/删除/重命名/置顶。

## 教材阅读浮窗助手

- `BookReaderScreen` 挂 `FloatingAssistant`（`src/features/reading/`）：可拖动书本气泡（贴边自动隐藏/点击恢复）+ 可拖动/缩放面板，布局持久化 AsyncStorage。
- 面板 Tab：导读 | AI | 测验 | 知识点 | 进度，全部复用既有 service contract（无新增后端接口）：
  - 导读 -> `learningContentService.generateReaderGuide`（本地缓存，不写对话历史）。
  - AI（教材问答）-> `learningChatService.getLearningRuntimeContext` + `streamLearningChat` -> `ChatDBServer POST /api/learning/chat`（公钥鉴权），conversation 按 `lecture_id + book_id + chapter` 分区；前端会把浮窗本地最近对话作为上下文块补入，并在流式不可用时走非流式兜底，兜底请求带 `skip_user_message=true`，避免重复写入同一条用户消息。
  - 测验 -> `learningExperienceService.getChapterQuiz` + `learningContentService.submitQuizAnswerBatch`。
  - 知识点 -> `learningExperienceService.getKnowledgeGraph` / `generateKnowledgeGraph`。
  - 进度 -> `learningContentService.getLearningReport` + `frontendService.completeLearningChapter`。

## 管理员内容流

- `AdminHomeScreen` -> `BookUploadScreen` / `RefinementQueueScreen` / `VectorizeScreen` -> `bookService` / `refinementService` / `vectorizeService` -> `NexoraLearning`
- 能力：Book metadata 和文件上传、refinement settings/start/intensive/section/annotation/summary/video/stop/queue；settings 列表显示后端返回的状态、错误和队列态；视频状态仅在列表实际返回 `video_status` / `video_error` / `video_job_status` 时展示，避免把缺失字段误显示成“未开始”；单本 Book vectorize 状态和触发
- 管理员入口必须由 frontend context 控制，不要靠客户端猜

## Learning Feed

- `LearningFeedScreen` -> `learningFeedService` -> `NexoraLearning`
- 接口：`GET /api/frontend/learning-feeds/channels`、`GET /api/frontend/learning-feeds`、`POST /api/frontend/learning-feeds`、`POST /api/frontend/learning-feeds/{feed_id}/like`、`POST /api/frontend/learning-feeds/{feed_id}/comments`、`POST /api/frontend/learning-feeds/{feed_id}/comments/{comment_id}/like`、`DELETE /api/frontend/learning-feeds/{feed_id}`、`DELETE /api/frontend/learning-feeds/{feed_id}/comments/{comment_id}`、`POST /api/frontend/settings/feed-channels`、`PATCH /api/frontend/settings/feed-channels/{channel_id}`、`DELETE /api/frontend/settings/feed-channels/{channel_id}`
- Feed author 的 `avatar_url` 由 `Avatar` / `imageService` 渲染，失败时回退到用户名首字。
- Screen 内的写操作用 FIFO 队列串行执行；忙时新操作不得静默丢弃。

## 设置与管理

- `SettingsScreen` -> `SessionProvider` / `frontendService` -> `NexoraLearning`
- `settingsAdminService` 锁定管理员设置 contract：`GET /api/frontend/settings/users`、`PATCH /api/frontend/settings/users/{user_id}`、`GET /api/frontend/settings/models`、`PATCH /api/frontend/settings/models`、`GET /api/models/rough-reading`、`PATCH /api/models/rough-reading`、`GET /api/frontend/settings/logs`
- Settings 用户头像可来自 `context.user.avatar_url` 或 `context.user.avatar`，由 `Avatar` / `imageService` 渲染，失败时回退到 username 首字。
