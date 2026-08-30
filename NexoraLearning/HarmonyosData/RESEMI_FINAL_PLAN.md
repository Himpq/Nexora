# Nexora Learning 鸿蒙高校创新赛复赛计划

> 版本：2026-08-23
>
> 目标：在初赛 Nexora Learning 基础上，迭代出可在小艺开放平台测试的 Agent 学习伙伴，并形成可提交的 Agent 源码/配置、5 分钟演示视频和说明材料。HarmonyOS 原生应用包属于可选增强，不是 Agent 方向复赛的前置条件。

## 1. 先给结论

初赛交付物是 Python Flask + HTML/CSS/JavaScript 的 Web 学习应用，不是现成的 ArkTS 工程。复赛不能换作品，只能在该作品上迭代，因此最稳妥的方案是：

1. 保留 NexoraLearning 现有教材解析、章节精读、知识图谱、题库、学习画像、学习行为分析和视频资源后端。
2. 保留现有 NexoraLearning Web 学习工作区和 ChatApp 移动客户端；只有在官方文档和 DevEco 模拟器验证目标能力后，才新增独立 HarmonyOS ArkTS/ArkUI 入口。不能把 ArkUI 当成 React Native/Expo 的直接替换层。
3. 以“小艺开放平台 Agent/Skill”为系统级入口，把 Nexora Learning 从“打开应用后使用”升级为“用户说出学习意图后主动响应”。
4. 只做一条可完整演示的闭环：**小艺唤起/文本或语音指令 → 识别课程与上下文 → 生成今日学习任务 → 打开对应章节 → 阅读中提问 → 章节完成后主动提醒/生成小测 → 手机/平板接续**。
5. 不把所有鸿蒙能力都堆进作品。Agent 方向首先交付可测试的小艺 Agent、主动学习闭环和自然交互；跨设备接续、ArkUI、ArkWeb、Core Speech、ArkData 等只在官方文档明确支持且模拟器实测通过后作为增强项。

## 2. 比赛约束与评审解读

### 已核实的硬约束

- 赛题为 Agent 创新，作品描述强调“个人日常生活与陪伴、主动服务、自然交互”。
- 复赛只能在初赛原有作品上迭代，不能提交其他作品。
- 作品不限制模型 API；可使用小艺开放平台 Agent 或 Skills。
- 赛事规程列出的复赛作品材料包括：一句话创意、设计稿/交互流程、作品说明文档、可运行 Demo（应用方向提交 HAP；Agent 方向提交源代码文件或小艺开放平台测试态 Agent）、作品演示视频（5 分钟以内）；最终以赛事平台当期要求为准。
- 官网附件规程列出的关键时间：复赛作品提交截止为 **2026-09-30 24:00**；总决赛预计 2026-11 月现场答辩。时间如有变化，以赛事群和官网通知为准。
- 赛事不提供硬件，可用自有设备、模拟器、云测试和云调试。

### 评分导向转成工程验收标准

| 评审关注点 | Nexora Learning 的证据 |
|---|---|
| 创新性 | Agent 读取学习画像、课程进度和阅读上下文，主动生成下一步学习动作，不只是聊天问答 |
| 完备性 | 从唤起、规划、执行、阅读、提问、测验、报告到提醒的闭环；错误和无网降级可用 |
| 鸿蒙融合 | 首先以小艺开放平台测试态 Agent 形成可验证证据；其他鸿蒙能力只有在官方文档与模拟器实测支持后才计入 |
| 实用性 | 针对真实教材和真实学习任务；每个 Agent 工具都有明确输入、输出和失败反馈 |
| 体验 | 语音/文本自然交互，手机与平板场景不同但状态连续，启动和响应有加载状态 |
| 规范与可信 | 权限最小化、用户授权、教材和学习行为数据脱敏、模型答案带教材依据和不确定性提示 |

## 3. 现有项目盘点

### 已有可复用资产

- `NexoraLearning/main.py`：Flask 入口、配置自举、数据目录和服务健康检查。
- `NexoraLearning/api/routes.py`：课程/教材、粗读精读队列、向量化、模型代理、知识图谱、学习资源、问答等主 API。
- `NexoraLearning/api/learning_progress.py`：章节/小节完成、记忆分析和画像更新链。
- `NexoraLearning/api/telemetry.py`：阅读、批注、答题三类事件流，以及学习行为分析接口。
- `NexoraLearning/core/booksproc/`：粗读、分章、精读、总结、批注、出题、思维导图等处理管线。
- `NexoraLearning/core/memory/` 与 `core/user/`：学习记忆、画像提取、个性化题目和学习记录。
- `NexoraLearning/frontend/assets/`：教材工作区、阅读器、章节导读、题库、视频/文章资源、知识图谱、学习报告等页面逻辑。
- `ChatApp/`：Expo + React Native 0.83.6 移动端，已有课程/教材/阅读器/学习问答/浮窗助手/学习 Feed 等服务和页面，但当前仍存在正式 token 登录、富格式阅读和全面 UI/UX 等缺口；它不是 HarmonyOS ArkUI 工程。

### 现有缺口

- 仓库中没有可直接用的 `.ets`、`module.json5`、`build-profile.json5` 或 DevEco 工程。
- 现有后端以本机/云端 Flask 服务为中心，尚未定义面向鸿蒙 Agent 的稳定、幂等、短响应工具 API。
- 现有用户解析大量依赖 query/header/Cookie，原生端需要明确的华为账号或设备会话映射，不能把账号密码写进端侧。
- 阅读行为已经记录，但还没有“当前设备/当前章节/最近一次学习上下文”的同步模型。
- 主链路有大量长耗时模型任务，不能让小艺 Agent 同步等待教材解析；需要任务创建、状态查询、结果拉取三段式接口。

## 4. 推荐总体架构

```text
小艺开放平台测试态 Agent / Skill
          |
          v
Agent 编排（具体模式以平台当前官方文档和账号实际可选项为准）
  - Intent Router：识别开始学习、继续学习、解释、测验、复习
  - Context Planner：读取 user/course/chapter/progress/device context
  - Action Executor：调用 Nexora Learning Agent API
          |
          v
NexoraLearning Flask
  - Agent facade API（新增）
  - 原有课程/教材/向量/模型/队列/画像/telemetry
  - Nexora / NexoraDB / 视频服务
          |
          +--> 现有 NexoraLearning Web 学习工作区
          +--> 现有 ChatApp（Expo + React Native）
          +--> 可选 HarmonyOS ArkUI 入口（仅在官方资料与模拟器验证后加入）
```

### 为什么不把 ChatApp 直接重写成 ArkUI

`ChatApp` 是 React Native/Expo 项目，ArkUI/ArkTS 是 HarmonyOS 原生 UI 技术，两者没有官方意义上的“一键互转”。当前 Agent 方向的复赛规程也没有要求把移动端迁移为 ArkUI。若后续需要鸿蒙原生体验，应另建独立 ArkUI 工程，范围先限制为 Agent 入口、今日任务和接续；现有学习内容继续由 Web 或 ChatApp 承载。是否加入 ArkWeb 以及具体 API，必须在对应官方指南和当前 SDK 可用性验证后再决定。

### Agent 编排模式选择

- **首选：小艺开放平台多 Agents 模式**。现有系统天然有“规划/粗读/精读/出题/画像/资源”多个角色，适合拆成课程规划 Agent、阅读辅导 Agent、测验复习 Agent。平台文档说明多 Agents 支持知识库、插件、工作流、触发器、长期记忆和子 Agent。
- **备选：LLM 模式 + 云工作流**。若平台账号或多 Agents 审核来不及，先用单 Agent 负责意图理解，固定工作流负责查询进度、生成任务、打开章节和触发测验，稳定性更高。
- **不建议首期：端 A2A/云 A2A**。它们适合已经具备完整鸿蒙端/云 Agent 协议接入的团队，会引入 AgentCard、协议、设备发现和联调成本。可作为后续展示项，不作为复赛 MVP 的前置条件。

## 5. 复赛 MVP：一条可现场复现的闭环

### 场景 A：主动开始学习

用户对小艺说：“我今天有 30 分钟，继续学习机器学习。”

1. Agent 获取用户画像、已选课程、最近章节、未完成小节和可用时间。
2. Planner 选择一个可完成的小节，返回标题、预计时长、原因和操作按钮。
3. Agent 返回下一学习动作和可访问的章节入口；小艺能否直接拉起指定页面、以何种卡片或链接承载，必须以开放平台当前官方文档和实际调试结果为准。
4. 用户进入现有 Web 或 ChatApp 学习页；若后续验证通过，也可进入可选 HarmonyOS 原生入口。

### 场景 B：阅读中自然提问

用户在现有 Web/ChatApp 学习页中说或输入：“用这一页的内容解释梯度下降，先不要联网。”

1. 当前客户端将当前章节、选中文本、滚动位置和问题交给 `ask_in_context`；如果未来使用 ArkWeb，再按官方 ArkWeb JS 交互文档接入。
2. 后端优先向量检索当前教材和章节，再调用模型。
3. 返回答案、引用片段、置信/边界提示和可操作的“举例/出一道题/回到原文”按钮。

### 场景 C：完成后主动复习

1. 章节完成事件触发既有记忆/画像链。
2. 新增 `build_review_plan` 生成 3 道短题和一个薄弱点。
3. Agent 通过小艺或 Push 告知：“你刚完成第 2 章，发现‘反向传播’还不稳，要现在做 3 题吗？”
4. 用户确认后打开题目页面，完成结果写回 telemetry 和学习记录。

### 场景 D（可选增强）：跨设备接续

手机读到第 2 章第 3 小节后，用户在平板说：“继续刚才的学习。”

1. 先由 NexoraLearning 服务端同步 `active_session`（课程、教材、章节、小节、滚动比例、时间戳、设备来源、任务状态）。
2. 只有在官方分布式数据文档、权限要求和当前模拟器/设备能力验证通过后，再增加 ArkData 端侧同步证据。
3. 冲突规则：最新 `updated_at` 胜出；章节完成是单调状态，不允许被旧设备覆盖；模型任务状态只同步任务 ID 和结果版本，不同步大段教材内容。

## 6. 新增 Agent Facade API

不要让小艺平台直接依赖几十个内部接口。新增 `/api/agent/v1`，统一鉴权、错误格式、幂等键和短响应。

| Endpoint | 作用 | 响应上限 |
|---|---|---|
| `GET /context` | 用户、课程、最近阅读位置、今日任务摘要 | < 1 s |
| `POST /plan` | 根据意图和可用时间生成下一步动作 | < 8 s；超时返回可执行候选 |
| `POST /open-session` | 创建/恢复学习会话，返回客户端可消费的学习入口和短期会话信息 | < 2 s |
| `POST /ask-in-context` | 基于当前章节/选中文本问答 | 流式或 < 15 s |
| `POST /review-plan` | 生成复习计划/短题；支持异步 | 创建任务 < 2 s |
| `GET /tasks/{task_id}` | 轮询长任务状态和结果摘要 | < 1 s |
| `POST /events` | 接收 `session_started`, `chapter_completed`, `question_answered` 等业务事件 | 幂等 |
| `GET /handoff` | 跨设备接续状态（后续阶段，当前未实现） | 后续阶段 |

统一返回：

```json
{
  "success": true,
  "request_id": "req_xxx",
  "action": "open_session",
  "data": {},
  "next_actions": [],
  "error": null
}
```

错误必须包含机器可读 `code`（`AUTH_REQUIRED`, `COURSE_NOT_FOUND`, `TASK_NOT_FOUND`, `MODEL_UNAVAILABLE`, `PERMISSION_DENIED`）和用户可读 `message`。当前 `review-plan` 支持 `Idempotency-Key`，`events` 支持 `event_id` 或 `Idempotency-Key` 幂等；其余写接口的幂等策略在接入平台前单独补齐。

### 关键数据契约

```json
{
  "user_id": "huawei_uid_or_bound_user",
  "lecture_id": "l_xxx",
  "book_id": "b_xxx",
  "chapter_index": 1,
  "session_index": 2,
  "position": 0.42,
  "available_minutes": 30,
  "device_type": "phone|tablet|pc",
  "source": "xiaoyi|app|push",
  "updated_at": 1787412345000
}
```

## 7. 可选 HarmonyOS 端拆分

如果官方资料和 DevEco 模拟器验证后决定加入原生入口，建议新建独立目录 `HarmonyosApp/`，不要把 ArkTS 文件混进 Flask 或 ChatApp 项目。该目录不是当前 Agent 主线的前置依赖。

```text
HarmonyosApp/
  AppScope/app.json5
  entry/src/main/module.json5
  entry/src/main/ets/entryability/EntryAbility.ets
  entry/src/main/ets/pages/Index.ets
  entry/src/main/ets/pages/TodayTask.ets
  entry/src/main/ets/pages/DeviceHandoff.ets
  entry/src/main/ets/services/AgentApi.ets
  entry/src/main/ets/services/ArkWebBridge.ets       # 仅选择 ArkWeb 后加入
  entry/src/main/ets/services/SpeechService.ets      # 仅官方语音能力验证后加入
  entry/src/main/ets/services/DistributedProgressStore.ets # 仅跨设备能力验证后加入
```

### 可选 HarmonyOS 入口的边界

- 原生 → Web：仅在实际建立 ArkUI/ArkWeb 工程并依据官方 ArkWeb JS 交互文档验证后确定，当前不把 `window.postMessage` 约定当成已实现事实。
- Web → 原生：统一消息名 `nxl.open_external`, `nxl.session_state`, `nxl.request_speech`, `nxl.haptic`, `nxl.share`。
- 所有消息带 `request_id`、`version` 和 `timestamp`；未知消息必须安全忽略。
- H5 页面不保存华为账号凭证；短期 token 由原生端内存或安全存储管理。

### 权限与隐私最小集

- 网络访问：调用 NexoraLearning Agent API。
- 麦克风：只有用户点击/明确说“开始语音输入”时申请，用于 Core Speech Kit。
- 分布式数据同步：按 ArkData 文档声明 `ohos.permission.DISTRIBUTED_DATASYNC`，首次使用时解释用途并请求授权。
- 推送：仅在决定做主动提醒时加入 Push Kit；没有稳定提醒链路前不要为了“凑鸿蒙能力”申请。
- 教材、选中文本和学习画像默认不上传到小艺平台；只传最小任务参数，答案引用来自 Nexora 后端。

## 8. 分阶段执行（按 2026-09-30 截止倒排）

### 阶段 0：锁定范围（1-2 天）

- 固化“一句话创意”：**小艺里的 Nexora 学习伙伴，会理解我正在学什么，并在合适的设备和时机带我完成下一步。**
- 选一门演示课程、一本教材、一个固定用户账号，准备 5 个可复现指令。
- 注册/确认小艺开放平台、DevEco Studio、华为开发者账号和真机测试组权限。
- 验收：团队三人能在同一台电脑上从零启动后端并看到课程、章节和题目。

### 阶段 1：后端 Agent Facade（3-5 天）

- [x] 新增 `/api/agent/v1` 和契约测试。
- [x] 把上下文查询、学习会话、当前章节问答、复习计划、事件写入收敛为独立 facade。
- [x] 为复习任务增加 task ID、状态轮询、失败结果和容量上限；任务取消留到后续阶段。
- [x] `open-session` 写入用户 `learning.jsonl`，`context` 返回可恢复的 `active_session`。
- [x] Web 工作区支持 `source=agent` 深链接自动定位课程、教材和章节。
- [x] 补充 [AGENT_FACADE_API.md](AGENT_FACADE_API.md) 与 [xiaoyi-agent-tools.json](xiaoyi-agent-tools.json) 初版契约。
- [ ] 用公网/云端真实课程跑通场景 A/B/C；当前仓库本地数据目录没有课程，模型服务 `127.0.0.1:5000` 也未启动。
- 验收：用 curl/Postman/自动化测试完整跑通场景 A/B/C，不依赖鸿蒙端；云端真实数据验证作为平台接入前置项。

### 阶段 2（可选）：HarmonyOS 原生入口验证

- 先按华为官方 DevEco/ArkUI/ArkWeb 文档创建最小 Stage 模型工程，并确认当前 API Version、模拟器镜像和组件支持范围。
- 只验证首页、今日任务和一个受控学习入口；不要先迁移 ChatApp 全部页面。
- 若 ArkWeb 或目标设备能力在当前 SDK 中不可用，则保留 ChatApp/Web 演示，不以未经验证的 HAP 能力写入作品说明。

### 阶段 3：小艺 Agent/Skill 接入

- 先读取小艺开放平台当前官方编排模式文档，并以账号控制台实际提供的选项选择实现；不预设多 Agents 一定可用。
- 配置意图：开始/继续学习、解释当前内容、生成小测、查看今日报告。
- 工具只暴露 Agent Facade API；每个工具写清参数、前置条件、失败处理和示例。
- 验收：在小艺开放平台测试态 Agent 中完成场景 A、B、C；语音与主动触发只在官方测试环境确实支持时计入验收。

### 阶段 4（可选）：跨设备接续验证

- 先用现有服务端保存小型 session 状态；大段教材和答案仍由服务端拉取。
- 读取官方跨设备/ArkData 文档并验证模拟器是否能覆盖目标场景；模拟器不能证明的设备能力不写成“已完成”。
- 有可验证环境时再实现手机 → 平板恢复位置、完成状态和最近任务，否则不阻塞 Agent 主闭环。

### 阶段 5：主动服务与可靠性（3-5 天）

- 章节完成后生成复习任务；Push 作为可选增强，不影响主闭环。
- 增加模型超时、重复点击、网络断开、无课程、无权限、空画像的降级话术。
- 记录 Agent 调用成功率、耗时、工具错误、用户确认和任务完成率。
- 验收：连续 20 次演示脚本执行，成功率 ≥ 90%，失败都能回到可解释状态。

### 阶段 6：提交材料与答辩（5-7 天）

- 录制 ≤5 分钟视频：问题 → 小艺唤起 → 今日任务 → 阅读提问 → 主动小测 → 跨设备接续 → 技术架构。
- 更新作品说明文档：把“可适配鸿蒙”改成已完成事实，附权限、接口、时延和测试数据。
- 准备 Agent 源码或小艺开放平台测试态 Agent、体验账号/入口、部署说明、第三方依赖与原创声明；只有实际完成 HarmonyOS 应用时才附 HAP。
- 在 2026-09-30 24:00 前至少预留 48 小时提交和回归时间。

## 9. 质量门槛与测试矩阵

### 功能

- [ ] 新用户无画像时仍能获得默认学习计划。
- [ ] 课程/教材不存在、正在解析、解析失败时有明确下一步。
- [ ] 章节问答只引用当前教材范围，联网开关语义明确。
- [ ] 任务重试不会重复创建章节完成记录或复习题。
- [ ] 手机、平板窗口尺寸下阅读器和 Agent 面板不遮挡。

### 鸿蒙

- [ ] （若选择 HarmonyOS 入口）HAP 可安装、启动、返回、窗口变化正常；所有能力均有官方文档链接和模拟器实测记录。
- [ ] （若选择 ArkWeb）URL allowlist 和 JS bridge 不允许任意远程脚本调用原生能力，并按官方文档验证。
- [ ] （若选择语音/分布式同步）权限按官方文档声明、申请和拒绝降级。
- [ ] 断网、后台恢复、进程重启后的状态恢复范围以实际测试记录为准。
- [ ] 跨设备能力只在官方模拟器、云调试或真实设备确实复现后宣称完成。

### Agent

- [ ] 每个工具 schema 与服务端校验一致。
- [ ] Agent 不直接暴露 API key、Cookie、教材原文或内部路径。
- [ ] 高风险动作（发送消息、开启麦克风、同步数据）需要用户确认。
- [ ] 多 Agents 有明确角色边界，不能互相循环调用。
- [ ] 调试日志可关联 `request_id`，但不记录完整个人数据。

## 10. 风险与取舍

| 风险 | 处理 |
|---|---|
| 小艺平台账号/审核时间不足 | 先完成云端 Agent Facade 和现有 Web/ChatApp 可复现闭环；平台接入作为适配层，不能把未经官方平台验证的本地入口写成小艺能力 |
| 没有 HarmonyOS 真机 | 立即申请云调试/云测试或借用队员设备；跨设备功能至少做录屏和模拟状态，不能口头宣称已验证 |
| 长文本模型耗时或额度不足 | 演示课程预生成 bookinfo/bookdetail；现场只调用短上下文问答和计划接口 |
| ArkWeb 与 H5 bridge 不稳定 | 只有选择 ArkWeb 后才按官方文档做最小 bridge；关键 session 状态服务端兜底 |
| 分布式权限/组网失败 | 进度状态先由服务端保存；ArkData 失败不阻断继续学习 |
| 主线重构过大 | 不迁移所有页面、不更换后端模型、不把视频/邮箱作为复赛主线 |
| 隐私审核 | 最小权限、数据脱敏、用户授权、删除/清理入口和隐私说明提前完成 |

## 11. 暂不做的事情

- 不把整个 NexoraLearning 前端重写为 ArkUI。
- 不把教材全文或向量库复制到端侧。
- 不首期实现复杂 A2A、多端实时协同编辑、完整 Push 营销体系或 IAP。
- 不为了展示技术名词加入位置、相机、通讯录等与学习闭环无关的权限。
- 不把“调用大模型”当成 Agent 创新；必须展示上下文理解、工具调用、主动触发和结果闭环。

## 12. 需要你尽快确认的 6 件事

1. 你们现在是否有 HarmonyOS 6/7 真机？型号、系统版本、是否能加入小艺开放平台真机测试组。
2. DevEco Studio 是否已安装，能否创建并运行一个官方 ArkTS Hello World。
3. 你们能否登录小艺开放平台并创建 Agent/Skill；若不能，是否已有平台入口或审核中的 Agent。
4. 复赛演示是否可以使用公网部署的 NexoraLearning，还是必须完全离线/局域网运行。
5. 计划演示的教材、课程和用户账号是什么；是否允许用一套脱敏的固定演示数据。
6. 队伍三人接下来每周可投入的小时数，以及 9 月 30 日前是否还有课程/考试冲突。

## 13. 官方资料索引

- 比赛赛题：<https://developer.huawei.com/consumer/cn/forum/topic/0204215524083454315?fid=0101215456814572136>
- 赛事总页与规程附件：<https://developer.huawei.com/consumer/cn/activity/incentive/C4>
- 小艺开放平台：<https://developer.huawei.com/consumer/cn/celia/>
- 平台概览与核心概念：<https://developer.huawei.com/consumer/cn/doc/service/platform-concepts-0000002625401382>
- 平台特性与能力体系：<https://developer.huawei.com/consumer/cn/doc/service/platform-strength-0000001193466742>
- Agent 编排模式：<https://developer.huawei.com/consumer/cn/doc/service/differences-in-arrangement-modes-0000002471344117>
- 开发 Agent：<https://developer.huawei.com/consumer/cn/doc/service/developing-intelligent-agents-0000002435989592>
- Agent 调试与预览：<https://developer.huawei.com/consumer/cn/doc/service/real-machine-testing-0000002471344145>
- Skill 开发规范：<https://developer.huawei.com/consumer/cn/doc/service/skill-development-standards-0000002592931546>
- 端侧 A2A / 应用内 Agent：<https://developer.huawei.com/consumer/cn/doc/service/agent2agent-inapp-0000002630346158>
- ArkUI：<https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkui>
- ArkWeb：<https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkweb>
- Core Speech Kit：<https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/core-speech-kit-guide>
- Agent Framework Kit：<https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/harmony-agent-framework-kit-guide>
- 分布式数据同步概述：<https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/sync-app-data-across-devices-overview>
- 分布式数据对象：<https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/data-sync-of-distributed-data-object>
- 分布式 KV：<https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/data-sync-of-kv-store>

## 14. 2026-08-23 实际环境验证记录

- 云端 `NexoraLearning`：`https://chat.himpqblog.cn:5002`，`GET /health` 返回 `200`。
- 云端用户：`cjbpq`，`GET /api/frontend/context?username=cjbpq` 返回管理员上下文和模型连接状态。
- 云端教材已存在：课程“数据库导论”（`l_d5a6224b163f`）下的“数据库管理系统中级（备份还原）”（`b_619ddb8070c9`）。
- 云端教材状态：正文约 244,990 字符、557 张图片，教材提炼/精读/批注/总结/视频状态均为已完成；`bookinfo` 可读取真实章节摘要。
- 云端尚未部署本阶段新增的 `/api/agent/v1` facade，访问该路径当前返回 `404`。因此 Agent 工具契约和测试已在本地完成，但接入小艺前仍需将本阶段代码部署到云端并重新验证公网接口。
- 本地同一 EPUB 也已导入到被 Git 忽略的 `NexoraLearning/data/`，用于离线调试；不把教材、密钥或生成文件纳入提交。
- 已验证本地 facade 可以通过临时内存配置调用云端 PAPI 模型：`ask-in-context` 返回 `200`，回答来源标记为 `textbook_context`；云端密钥未写入配置文件。
- `NexoraLearning/main.py` 现在支持 `NEXORALEARNING_NEXORA_BASE_URL`、`NEXORALEARNING_NEXORA_API_KEY`、`NEXORALEARNING_RUNTIME_API_KEY`、`NEXORALEARNING_NEXORADB_*` 和 `NEXORALEARNING_PORT` 环境变量覆盖，覆盖仅在当前进程内生效。
