# HarmonyosApp 学习接口迁移

本次落点是 NexoraApp。教材阅读、学习助手、复习与系统入口共用登录后配置的 Learning 服务地址与用户名。

## 已接通的链路

| 范围 | 实现 | 关键行为 |
| --- | --- | --- |
| A0 坐标 | `common/LearningApi.ets`、`common/ReaderPaginator.ets` | 解析段落 `start/end`、章节 `chapterRange/coordinateSpace`；分页保留码点坐标、空白和完整代理对。 |
| A1 会话与队列 | `common/LearningReading.ets`、`common/LearningReadingApi.ets` | 每章每次访问独立会话；只统计可记录时间，同页连续停留两秒后计覆盖；Preferences 持久化，按服务和账号隔离。 |
| A2 生命周期 | `components/learning/LearningReader.ets`、`entryability/EntryAbility.ets`、`pages/MainChat.ets` | 翻页切章、目录跳章、前后台、浮层、十秒心跳和退出均接入；登录及打开学习时补发。 |
| A3 遥测 | `common/LearningReadingApi.ets` | 发送 `focus_in/focus_out/snapshot/session_complete/ask`，附会话、有效时长和课程；失败丢弃。 |
| A4 教材完成 | `components/learning/LearningReader.ets` | 每章末尾显式确认；空间不够则补末页；先保存快照再调用教材完成接口。翻到下一章不会自动完成上一章。 |
| A5 阅读问答 | `components/learning/LearningReader.ets` | 顶栏“问 AI”、半屏面板、当前页正文上下文、现有 Markdown 渲染；换章和离开后丢弃旧答案。 |
| A6 读后复习 | `components/learning/LearningReader.ets`、`components/agent/LearningAgentReview.ets` | 只在目标章明确完成后，退出时发送 `reading_done`；完成响应晚于退出也可衔接，题目就绪后进入小测。 |
| B1 组件复用 | `LearningApi.resolveReaderTarget`、`components/agent/LearningAgent.ets` | 学习助手自己的导航栈直接挂载阅读器，返回保留下面的时间线或作答页。 |
| B2 入口互跳 | `components/agent/` | 时间线、计划和先修卡进阅读器；小测、今日复习、认知报告各自保留；“去学习”打开现有学习工作区。 |
| B3 系统入口 | `EntryAbility`、`MainChat`、`Index`、`intents/`、`entryformability/` | `nx_route/decision_id` 统一排队；登录校验及服务配置成功后消费；意图打开 day/review，服务卡片直接回写决策。 |
| B4 事件桥 | `common/LearningBridge.ets` | 阅读同步、章完成、流程阅读完成三个事件带身份作用域，时间线刷新 `/today`，对应流程刷新题目。 |

以上源码路径相对于 `entry/src/main/ets/`。

## 后端契约

- `chapter_range` 使用 `起点:长度`，段落和 `read_ranges` 使用全书 plain Unicode 码点的半开区间 `[start, end)`。章节接口可能返回跨章边界的完整段落，阅读器上报时会取与本章范围的交集。
- 阅读事实发送到 `POST /api/frontend/learning/reading-progress`；显式完成发送到 `POST /api/frontend/learning/chapter-complete`。
- 队列中 400/404 的失效记录会移出并记日志。409 的 `ProgressConflict` 表示会话 ID 被用于不同章节或不同开始时间，重发不能修复，也会移出。网络、5xx、限流及鉴权失败保留待重试。
- 同一作用域只有一个补发任务，多个心跳共用在途请求。ACK 只删除原作用域、原会话、原日中不新于已发送序号的记录。
- 队列保存结果与发送结果分开，历史坏记录被丢弃不会被误判成本次快照未保存。
- 问答使用 `POST /api/agent/v1/ask-in-context`，阅读遥测使用 `POST /api/telemetry/ingest`。
- 以当前后端为准：每日复习是 `/review-plan → /tasks/{id} → /review/submit`，保留 `quiz_id/attempt_id` 与生成时的章节来源；读后流程是 `/flow/state → /flow/submit`。两者都独立于普通题库。
- 服务卡片“好 / 晚点”的实际接口是 `POST /api/agent/v1/decision/respond`，请求包含 `decision_id/response`。

## 学习偏好与推荐依据

- Agent 提问框旁不再提供全量“对你的了解”入口。每条建议的“为什么推荐”展示该条目的 `reason/evidence/context` 快照，不请求全局画像；没有保存依据时明确显示空态。
- 阅读时长、读过章节、已读完章节和概念理解统一放在“学习情况”。“读过”与“已确认读完”分别展示，阅读时长不作为掌握度。
- “设置 → 学习偏好与记忆”管理有效的目标、偏好、节奏、难点、基础和兴趣。支持编辑与忘记；普通对话、表情和测试内容不作为长期记忆展示。返回键先回设置，关闭面板后不再接收旧请求结果。
- `GET /api/agent/v1/memories` 返回 `items/generated_at`；每项包含 `id/kind/text/updated_at/lecture_id/book_id`。`POST /memories/update` 使用 `memory_id/text`，返回替代后的新 `item`；`POST /memories/forget` 使用 `memory_id`。编辑和忘记影响后续召回，保留历史记录。
- 更新客户端时需同步部署包含这些接口的 NexoraLearning 服务。旧 `mirror/judgment` 无决策 ID 链接进入记忆管理；带 ID 的链接仅打开对应条目，记录不存在时保留在今日并提示。

## Agent 主页模式

侧栏 Agent 切换 `MainChat` 的主页模式，共用头像、顶栏与侧栏。再次点击 Agent、选择新对话或切换历史对话时退出；原普通对话、草稿和后台生成流保留。邮件、随笔、学习、设置等作为临时覆盖页，返回后仍处于 Agent 模式。Agent 根页的系统返回交由宿主处理，内页返回按原导航栈逐层退出。

右上书本图标打开 Agent 学习情况，返回时间线保留未发送草稿。时间线从旧到新排列，最新消息在下方；输入框常驻底部，提问与学习安排分别保存草稿。浏览历史时暂停自动跟随，点击输入框上方右下角的浮动箭头或主动滑到底部后恢复；箭头样式与普通对话页一致，不占用列表布局空间。

侧栏模式切换与系统深链接分别处理：等待服务初始化时打开的邮件或随笔不会被迟到的侧栏入口关闭；系统深链接仍会将对应页面带到前台。显式退出模式会撤销尚未完成的入口，旧请求不能重新打开 Agent。

## 身份与异步状态

阅读器固定创建时的身份；账号或服务配置变化会立即停止计时并使旧内容请求失效。持久化队列按 `encodeURIComponent(serviceBase) + '|' + encodeURIComponent(username)` 隔离，重新登录同一作用域后可以补发以前的记录。

学习运行时配置带请求代次、用户名和主站地址校验，旧响应不能覆盖新账号或较新的配置。退出登录在等待网络注销前就撤销 Learning 身份。

卡片身份使用支持跨进程即时可见的 GSKV。切账号、切主站、禁用或更换学习服务时撤销旧卡片授权；卡片每次回写前再次校验主站会话，并核对当前卡片的身份与决策。

后端当前以服务器本地日聚合，尚未提供服务时区契约。离线队列同时保留设备自然日与 UTC 的边界，避免覆盖常见部署中的前一天快照；若需要任意服务器时区精确分日，需要后端明确时区。

## 验证

在 `NexoraApp` 目录执行（Node >= 22.13）：

```powershell
node --test tools/test_reader_coordinates.cjs tools/test_learning_reading.cjs tools/test_learning_reader.cjs tools/test_learning_agent.cjs tools/test_learning_agent_navigation.cjs tools/test_learning_agent_home.cjs tools/test_learning_agent_timeline.cjs tools/test_learning_agent_timeout.cjs tools/test_learning_memory.cjs tools/test_learning_system_entry.cjs tools/test_learning_runtime_races.cjs tools/test_learning_launch_retries.cjs
devecocli build
```

测试直接执行生产逻辑，使用可控时钟、HTTP 和存储替身，覆盖码点分页、前后台计时、跨章归属、持久化与 ACK 竞争、离线重试、切账号、旧请求、读后出题、重复深链与卡片回写。

设备联调需覆盖真实滑动分页、目录与问答面板、后台恢复、系统返回键、小艺意图和桌面卡片。当前工程没有签名配置，全量构建产物为未签名 HAP。

## 文档中的可选项

本次未包含选文工具栏、阅读实况窗和段落级本地续读位置。这些不影响以上数据闭环；阅读上报本身已包含 `paragraph_index/page_index`。
