# 当前状态

最后核对日期：2026-06-29。

这是 ChatApp 的当前事实快照，不是流水账。和历史切片冲突时，以这里为准。

## 必须更新

只要一次开发改到下面任一项，就要同步更新本文：

- 用户可见主路径。
- 后端 endpoint、payload、header、认证方式或服务归属。
- 已解决或新增的重要限制。
- 用户可见版本线。
- 测试覆盖范围或验证方式。

纯 UI 微调、小重构、只补测试、文案和机械改动，不强制更新。

## 已接入

- 本地 username 会话和 `/api/frontend/context`。
- 登录页已区分用户登录和管理员登录入口；两者共用后端 `/login` 认证，登录后以 `/api/frontend/context` 的 `is_admin` / `user.role` 校验入口角色，不匹配时退出并提示切换入口。
- 学习看板、已选课程、课程进度。
- Lecture / Book 列表、详情、阅读。
- Dashboard、Courses、Course Detail、Book 列表已接入后端封面资源；Feed 和 Settings 已接入头像 URL，失败时回退到字母占位。
- `bookinfo` / `bookdetail` 原文展示；读取到真实 `chapter_name` + `chapter_range` 时可标记章节完成。
- 课程附加学习数据：课程大纲、已缓存推荐视频。
- Book 附加学习数据：知识图谱读取和手动生成。
- AI 学习问答：运行时上下文、模型加载、SSE、取消、非流式兜底、失败后重试。
- 管理员内容流：上传、提炼队列、向量化监控。
- 提炼队列页除粗读/精读/分节/停止外，已接入批注、全书概述、视频搜索触发器（`POST /api/frontend/settings/refinement/{annotation,summary,video}`）。
- 管理员 Runtime/记忆控制台：读取 runtime 配置、已注册工具、记忆队列；可触发记忆分析、记录学习轮次、查看记忆块（`/api/runtime/*`）。
- 课程详情页可流式重新生成大纲（`GET /api/frontend/outline/<id>/generate-stream`，SSE status/delta/done）。
- Learning Feed：频道、发布、点赞、评论、删除、频道管理；写操作按队列串行执行。
- 已补齐并测试的 service contract：Book 分节/章节原文/注释/摘要/解析/文本上传，封面资源，reader guide，session quiz，mindmap，个性化学习路径，学习报告，教师视图，题库，用户搜索，设置页用户/模型/日志管理，提炼触发器，Runtime/记忆 API，大纲流式生成。
- 设置页（"我的"）：仅展示头像、昵称、角色、应用版本，含刷新与退出登录（带确认）；不再向普通用户暴露任何后端连通性 / API 地址 / Key / 模型数等技术信息。后端连通性、API 地址、原始 context 等诊断信息已整块移入管理员专属的"内容管理"（AdminHome）页"系统诊断"卡，仅 `isAdmin` 可见。

## 关键事实

- 学习域主要走 `NexoraLearning`。
- 通用聊天模型列表走 ChatDBServer `GET /api/config`；NexoraLearning/PAPI 模型能力仍保留 `GET /api/nexora/models` service contract。
- 学习聊天走 `ChatDBServer /api/learning/chat`。
- 课程大纲、推荐视频、知识图谱、学习进度记录走 `NexoraLearning /api/frontend/*`，由 `learningExperienceService` / `frontendService` 承接。大纲流式生成复用 `sse.ts` 的 `readSseStream`（`onEvent` 按 SSE event 名分发）。
- Runtime/记忆系（`/api/runtime/*`）由 `runtimeService` 承接，复用 `learningApiClient` 注入的 runtime API key（`X-API-Key`）鉴权；`/runtime/context` 仍由 `learningChatService` 用于学习问答上下文。
- Lecture / Book 封面资源走 `NexoraLearning /api/lectures/*/cover-assets` 以及实体上的 `cover_path` / `cover` 字段，由 `imageService` 统一补全 URL。
- 头像 URL 可来自 frontend context 或 Learning Feed author 的 `avatar_url`，由 `imageService` 统一解析相对路径。
- `SessionProvider` 持有 username，并通过 `setApiUsername` 给两个 client 注入 `X-Nexora-Username`。
- `SessionProvider` 登录时可接收期望角色；普通用户只进入学习主路径，管理员进入带 Admin 的路径，Admin Tab 和管理员 Stack 页面都由真实 admin 状态控制。
- public API key 由 `src/config/env.ts` 读取，再由 `apiClient` 注入 `X-API-Key`。
- Expo 默认真实环境地址为 `NexoraLearning=https://chat.himpqblog.cn:5002` 和 `ChatDBServer=https://chat.himpqblog.cn`；真机调试不要把后端改成仅宿主机可访问的 `localhost`。

## 仍未解决

- 正式移动端登录/token。
- 章节级完成 UI 只覆盖 `bookinfo` / `bookdetail` 可解析出真实章节边界的场景；原文阅读仍不伪造章节边界。
- `bookinfo` / `bookdetail` 的富格式化。
- 全面 UI/UX 统一。
- 长期聊天历史（当前前端按最近 80 条截断展示，保留真实 server index 供 regenerate 对齐；「加载更多」未接入）、断线重连、多模态、Web Chat 对齐。
- 工具调用：`chatService` 已把 `function_call_*` 等未知帧作为 `type: "unknown"` 事件透出（不静默丢弃）；问答输入栏可开启工具，流式期间会显示工具/搜索活动提示，但完整工具结果卡片仍未接入。
- 通用问答已捕获 `/api/chat/stream` 的 `stream_session.stream_id`，停止生成时会请求 ChatDBServer `POST /api/chat/stream/cancel` 并同时中断本地读流；教材浮窗学习聊天仍为客户端中断。

## 验证

重要改动后运行：

```bash
npm run typecheck
npm run test:unit
```

当前单测重点：

- API client URL、header、错误处理。
- Book、Image、Learning Content、Learning Feed、Learning Experience、Settings Admin、Vectorize、Model、Refinement、Runtime service endpoint。
- Learning Chat SSE frame 解析，包括未知帧可观测性；`sse.ts` 的 `onEvent` 命名事件分发与 `onData` 向后兼容。
- 大纲流式生成（`streamCourseOutline` GET SSE + 失败兜底）。
