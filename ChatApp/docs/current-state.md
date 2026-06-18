# 当前状态

最后核对日期：2026-06-17。

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
- 学习看板、已选课程、课程进度。
- Lecture / Book 列表、详情、阅读。
- Dashboard、Courses、Course Detail、Book 列表已接入后端封面资源；Feed 和 Settings 已接入头像 URL，失败时回退到字母占位。
- `bookinfo` / `bookdetail` 原文展示；读取到真实 `chapter_name` + `chapter_range` 时可标记章节完成。
- 课程附加学习数据：课程大纲、已缓存推荐视频。
- Book 附加学习数据：知识图谱读取和手动生成。
- AI 学习问答：运行时上下文、模型加载、SSE、取消、非流式兜底、失败后重试。
- 管理员内容流：上传、提炼队列、向量化监控。
- Learning Feed：频道、发布、点赞、评论、删除、频道管理；写操作按队列串行执行。
- 已补齐并测试的 service contract：Book 分节/章节原文/注释/摘要/解析/文本上传，封面资源，reader guide，session quiz，mindmap，个性化学习路径，学习报告，教师视图，题库，用户搜索，设置页用户/模型/日志管理。
- 设置页：版本、API 地址、用户上下文、角色、管理员状态、后端连通性。

## 关键事实

- 学习域主要走 `NexoraLearning`。
- 聊天模型列表走 `GET /api/nexora/models`，优先 `default_model`。
- 学习聊天走 `ChatDBServer /api/learning/chat`。
- 课程大纲、推荐视频、知识图谱、学习进度记录走 `NexoraLearning /api/frontend/*`，由 `learningExperienceService` / `frontendService` 承接。
- Lecture / Book 封面资源走 `NexoraLearning /api/lectures/*/cover-assets` 以及实体上的 `cover_path` / `cover` 字段，由 `imageService` 统一补全 URL。
- 头像 URL 可来自 frontend context 或 Learning Feed author 的 `avatar_url`，由 `imageService` 统一解析相对路径。
- `SessionProvider` 持有 username，并通过 `setApiUsername` 给两个 client 注入 `X-Nexora-Username`。
- public API key 由 `src/config/env.ts` 读取，再由 `apiClient` 注入 `X-API-Key`。
- Expo 默认真实环境地址为 `NexoraLearning=https://chat.himpqblog.cn:5002` 和 `ChatDBServer=https://chat.himpqblog.cn`；真机调试不要把后端改成仅宿主机可访问的 `localhost`。

## 仍未解决

- 正式移动端登录/token。
- 章节级完成 UI 只覆盖 `bookinfo` / `bookdetail` 可解析出真实章节边界的场景；原文阅读仍不伪造章节边界。
- `bookinfo` / `bookdetail` 的富格式化。
- 全面 UI/UX 统一。
- 长期聊天历史、断线重连、工具调用 UI、多模态、Web Chat 对齐。

## 验证

重要改动后运行：

```bash
npm run typecheck
npm run test:unit
```

当前单测重点：

- API client URL、header、错误处理。
- Book、Image、Learning Content、Learning Feed、Learning Experience、Settings Admin、Vectorize、Model service endpoint。
- Learning Chat SSE frame 解析，包括未知帧可观测性。
