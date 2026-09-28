# NexoraApp 学习与 Agent 接入

本次落点是 NexoraApp。教材内容与阅读事实继续使用登录后配置的 Learning 服务地址；Agent 问答、计划、复习、记忆和系统入口统一经主站登录会话代理。App 不持有 Learning 的服务密钥。

截至 2026-09-28，以下能力已完成源码接入，自动化回归与本地服务的实际验证范围见后文。模拟器交互与真实云模型验证仍待补充，不能将构建成功或测试替身的结果视为设备、外部服务已验收。

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
| B3 系统入口 | `EntryAbility`、`MainChat`、`Index`、`intents/`、`entryformability/` | `nx_route/decision_id` 统一排队；登录及服务配置就绪后消费；意图打开 day/review，卡片经主站会话代理刷新并回写决策。 |
| B4 事件桥 | `common/LearningBridge.ets` | 阅读同步、章完成、流程阅读完成三个事件带身份作用域，时间线刷新 `/today`，对应流程刷新题目。 |
| C1 会话工具 | `common/LearningAgentApi.ets`、`components/agent/LearningAgent.ets` | 问答可执行搜索、知识库检索/写入、邮件读取、课程缓存视频、计划及出题；真实执行结果生成卡片，未配置或失败会返回明确错误。 |
| C2 输入材料 | `LearningAgentInput`、`LearningAgentVoiceButton`、`common/LearningAgentAssets.ets` | 语音转写到草稿；系统图片选择器读取图片并 OCR，识别文字可移除；选择“附带随笔”后发送近期随笔上下文。 |
| C3 结果使用 | `common/LearningAgentNotes.ets`、`common/LearningAgentAssets.ets` | 保存学习记录到现有随笔合并接口，稳定记录 ID 防重复；用系统文件选择器导出 Markdown；打开搜索来源、引用链接和配套视频。 |
| C4 恢复与纠错 | `LearningAgentApi`、`LearningAgent`、`LearningAgentReview` | 消息带 `client_message_id` 对齐服务端记录；恢复 `/today.active_flow` 的目标、题目和阶段；不确定判分反馈同步更新成绩、证据和总结卡。 |
| C5 系统递送 | `common/LearningAgentSystem.ets`、`LearningAgentNotification.ets`、`LearningDeviceContext.ets` | 显式申请通知/日历权限；递送待处理的 `notify` 决策；刷新卡片；上报前后台及可读取的日历上下文，未知状态保留未知。 |

以上源码路径相对于 `entry/src/main/ets/`。

## 后端契约

- `chapter_range` 使用 `起点:长度`，段落和 `read_ranges` 使用全书 plain Unicode 码点的半开区间 `[start, end)`。章节接口可能返回跨章边界的完整段落，阅读器上报时会取与本章范围的交集。
- 阅读事实发送到 `POST /api/frontend/learning/reading-progress`；显式完成发送到 `POST /api/frontend/learning/chapter-complete`。
- 队列中 400/404 的失效记录会移出并记日志。409 的 `ProgressConflict` 表示会话 ID 被用于不同章节或不同开始时间，重发不能修复，也会移出。网络、5xx、限流及鉴权失败保留待重试。
- 同一作用域只有一个补发任务，多个心跳共用在途请求。ACK 只删除原作用域、原会话、原日中不新于已发送序号的记录。
- 队列保存结果与发送结果分开，历史坏记录被丢弃不会被误判成本次快照未保存。
- `LearningAgentApi` 保留 `/api/agent/v1/` 逻辑路径，`LearningHttp` 将其改写为主站 `/api/learning/agent/`，由 `HttpUtil` 携带主站 Cookie。ChatDBServer 校验登录用户、删除客户端传入的用户标识，再携带服务密钥请求 Learning 的 `/api/agent/v1/`。配置见 [Agent 代理与部署说明](../../ChatDBServer/docs/learning-agent-proxy.md)。
- 例如问答实际从 App 请求主站 `POST /api/learning/agent/ask-in-context`。教材内容、阅读事实与 `POST /api/telemetry/ingest` 沿用各自的 Learning 直连接口，此次没有将这些接口迁入 Agent 代理。
- 以当前后端为准：每日复习是 `/review-plan → /tasks/{id} → /review/submit`，保留 `quiz_id/attempt_id` 与生成时的章节来源；读后流程是 `/flow/state → /flow/submit`。两者都独立于普通题库。
- 服务卡片“好 / 晚点”调用主站 `POST /api/learning/agent/decision/respond`，请求包含 `decision_id/response`；每次回写先校验当前登录和卡片身份。

## 会话工具与执行边界

Learning 的 `core/agent_tools.py` 向模型提供固定工具集合；清楚的操作指令也可直接路由到工具。用户名、服务地址和凭据由后端选择，模型不能指定其他用户。教材、随笔、邮件和工具输出作为参考资料传入。

| 能力 | 实际执行 | 当前边界 |
| --- | --- | --- |
| 搜索资料 | NexoraSearch `/api/search/ddg`，结果包含真实标题、链接与摘要 | 需要配置搜索服务；空结果与服务失败分别表示。 |
| 知识库 | NexoraDB `/query_text`、`/upsert_texts`，绑定当前用户的 `default` 库 | 写入需要用户明确的保存请求；否定保存、只读提及知识库不会触发写入；相同正文使用稳定文档 ID。 |
| 邮件 | NexoraMail 当前账号邮箱的列表与正文 | 不发送邮件；未实现邮件附件导入。 |
| 邮件学习安排 | 按请求读取正文、可选入库、创建学习计划和复习任务 | 仅保存邮件正文时不会额外创建计划；部分失败保留已完成阶段的执行回执。 |
| 配套视频 | 当前已选课程的视频缓存 | 不会主动搜索或生成新视频；没有缓存时显示空态。 |
| 计划与出题 | 复用课程目标解析、计划和异步章节出题服务 | 计划支持中文时长和显式分钟数；创建任务不代表题目已经生成。 |

`ask-in-context` 返回 `cards`、`next_actions` 和 `tool_execution`。请求成功但工具执行失败时，`tool_execution.ok=false`；不能仅凭 HTTP 200 宣称操作完成。纯模型失败会返回结构化错误。已有的 `general_knowledge_fallback` 是固定补充答案，不是云模型验证结果。

携带同一 `client_message_id` 的问答和计划请求会校验正文指纹，冲突返回 409。用户消息和成功回复持久化；同一问答中成功的计划、复习、知识库写入及邮件编排阶段保存工具回执，之后失败的读取操作仍可重试。未提供 ID 的调用不具备这层请求去重保证。

复习任务与读后流程会检测没有本进程工作线程的遗留 `queued/running` 记录，将其标为 `failed/retryable`；读后流程可重新触发 `reading_done`。当前机制对应单进程、后台线程部署；多进程任务恢复需要共享执行队列或租约。

图片输入目前是选图后 OCR，发送识别文字；未接入原始图片的多模态模型理解或直接拍摄。语音仅填入草稿，不自动发送。附带随笔需用户打开开关，读取最近最多 12 条、总计最多 6000 字；保存结果采用原云端快照作为合并基线，账号切换后拒绝迟到的读取或保存结果。

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

通知仅选择决策器给出的 `notify`、仍待处理且未被抑制的最新条目，按账号及决策 ID 去重；`card/hold` 不会升级为通知。点击通知携带决策及身份回到 Agent；切换身份会撤销旧授权并取消对应通知。没有常驻后台推送保证，当前递送依赖 App 生命周期或系统允许的卡片刷新。

服务卡片配置为按小时刷新，跨日先使旧可操作快照失效；实际刷新受系统可见性、调度和配额限制。日历只读取 SDK 允许的本应用日程，上报 `partial/app_calendar_only`，不能据此认定其他日历没有安排。公开接口不能读取系统免打扰，故保留 `unavailable/null`；位置为 `unknown`。设备样本带毫秒时间与请求代次，旧采样不能覆盖新状态。

后端当前以服务器本地日聚合，尚未提供服务时区契约。离线队列同时保留设备自然日与 UTC 的边界，避免覆盖常见部署中的前一天快照；若需要任意服务器时区精确分日，需要后端明确时区。

## 验证

在 `NexoraApp` 目录执行（Node >= 22.13）：

```powershell
$testFiles = Get-ChildItem -Path tools/test_*.cjs | ForEach-Object FullName
node --test $testFiles
devecocli build
```

测试执行生产逻辑，使用可控时钟、HTTP、存储和系统 SDK 替身。除原有阅读、分页、切账号、离线队列与深链覆盖外，新增随笔合并与去重、OCR 资源释放、文件截断写入、通知选择与去重、权限降级、设备状态竞争、流程恢复和消息 ID 对齐。系统替身测试不能证明真实权限弹窗、麦克风、OCR、通知或桌面卡片可用。

本轮验证记录（2026-09-28）：

| 层级 | 实际结果 | 证据边界 |
| --- | --- | --- |
| App 自动化 | 全套 **225/225 通过**，日志 `.hvigor/agent-integration-tests.log`；阅读问答 fixture 执行真实 `HttpUtil` 并验证主站 Cookie 代理 | 包含系统入口 17 项、系统递送 13 项、Agent integrations 13 项；不是设备测试。 |
| ArkTS 构建 | `devecocli build` 成功，日志 `.hvigor/agent-integration-build-final.log` | 产物仍为未签名 HAP，未代表安装或运行成功。 |
| ChatDBServer | 主站冒烟与 Agent 代理 13 项通过 | 包含真实本地 HTTP peer、匿名/失效账号、身份伪造、路由白名单、服务密钥、重定向及业务错误。 |
| NexoraLearning | Agent 相关 68 项、工具 11 项、配置 2 项通过；其中 wiring 14 项另行复核通过 | 包含 Flask 路由、真实本地存储；模型/外部服务的部分依赖使用替身，不能视为云模型或线上服务验收。 |
| 隔离真实服务 | 主站和 Learning 完整进程启动；真实登录与代理 context/today/events/memories 成功；20 分钟计划创建、同 ID 重试及服务重启后复用均通过 | 使用单独联调账号和明确标记的演示教材；没有读取真实用户邮件、知识库或随笔。 |
| 真实失败路径 | 未配置搜索返回 `tool_execution.ok=false`；普通模型问答返回 `503 MODEL_UNAVAILABLE` | 验证的是诚实失败与重试行为，没有把固定答案或模拟工具结果算作模型成功。 |
| 模拟器及设备 | **待补**：已排除宿主锁文件阻塞并完成镜像校验，Guest 启动中；尚未完成 App 安装与交互验收 | 保留真实分页、目录/问答面板、后台恢复、系统返回、小艺、卡片、通知点击、语音、OCR、日历权限验证。 |
| 云模型及外部服务 | **待补**：真实云模型与真实搜索、知识库、邮件服务端到端验证 | 本轮自动策略拒绝了包含既有模型凭据加载及服务启动的组合命令，未给出更具体子步骤原因；没有绕过该限制。 |

### Windows 模拟器宿主启动阻塞的恢复记录

本机 `NexoraPhone` 最初只有模拟器宿主进程，Guest 未启动。定位到 Qt `QLockFile` 等待 `huawei-settings.cfg.lock`：实例的 C 盘访问路径经过 Junction，在该路径用随机 GUID 文件名执行 `CreateNew` 也错误返回 `already exists`，直接访问同一实例的 D 盘物理路径则能正常创建文件。这是本机路径访问问题的诊断结果，不能将所有模拟器启动失败都归因于锁文件。

恢复时，结束该实例卡住的宿主启动后，使用已安装 SDK 的官方模拟器程序，以现有实例的物理目录作为 `instancePath`，传入以下参数：

```text
-start NexoraPhone -instancePath D:\HuaweiEmuImages\EmulatorRuntime\deployed -bootMode coldboot
```

该方式直接启动现有实例，无需重建镜像、搬迁实例数据或清空用户数据。本轮已验证它越过锁等待并完成镜像校验，进入 Guest 启动阶段。接下来仍需确认 hdc 设备就绪、安装 App 并逐项完成上表的实际交互验收。

## 文档中的可选项

后续可接入选文工具栏、阅读实况窗、段落级本地续读位置、直接拍照与多模态图片理解、邮件附件导入、主动视频检索，以及独立后台推送与共享任务队列。当前阅读上报已包含 `paragraph_index/page_index`；以上可选能力尚未实现，不能从现有卡片或入口推断已经可用。
