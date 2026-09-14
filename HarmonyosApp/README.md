# HarmonyosApp · Nexora（鸿蒙端）

一个住在系统里的学习智能体的鸿蒙端：它在你不在时读明天的章节、出题、备讲解，只在对的时刻出现；
任何一条动作都能长按追问「为什么」，并纠正它对你的判断。App 本身只剩一个界面「它的一天」，
出现的入口交给系统：小艺对话意图、端侧 A2A、实况窗、服务卡片、通知。

## 计划文档（读代码前先读）

- 方向、优先级与执行序的**唯一权威**：`HarmonyosData/NEXORA_HARMONYOS_重构方案_2026-09-02.html`（三步反转 + 四周节奏）
- 数据契约与验收清单参考：`HarmonyosData/NEXORA_HARMONYOS_复赛方案.md`（v6；与 HTML 冲突时以 HTML 为准）
- 进度与交接：`HarmonyosData/NEXORA_HARMONYOS_复赛方案_执行日志.md`（先读最新一节）
- 后端契约：`HarmonyosData/AGENT_FACADE_API.md`（字段以 `NexoraLearning/api/agent_facade.py` 为准）

## 环境

- DevEco Studio 6.x + DevEco CLI（`devecocli`）
- HarmonyOS SDK 6.1.1（API 24），Stage 模型 + ArkTS；bundle `com.nexora.learning`；`deviceTypes` phone / tablet / 2in1
- 模拟器 `NexoraPhone`（127.0.0.1:5555）

## 构建与验证

```text
devecocli build --product default --build-mode debug   # 产物 entry/build/default/outputs/default/entry-default-unsigned.hap
devecocli check lint
devecocli run --module entry                            # 部署到模拟器；重装加 --uninstall
devecocli ui screenshot                                 # 截图核对渲染
```

「构建通过」不等于「已验证」。以下能力**只能在真机验证**（HarmonyOS 6.x 真机，开发者选项 → 意图框架调试）：
意图框架、Agent Framework Kit（端侧 A2A）、实况窗、华为账号静默登录、日历与免打扰的真实行为、服务卡片桌面添加、平板布局。
清单见执行日志「真机日清单」。

## 后端与环境开关

- 环境集中在 `entry/src/main/ets/config/Env.ets`：`USE_LOCAL = true` 走本地后端（`NexoraLearning/dev_local.ps1` 起在 5001；
  模拟器必须经宿主机局域网 IP 访问，不能用 127.0.0.1）并直接使用演示账号；**演示 / 云端回归前改回 `false`**，走 `https://chat.himpqblog.cn:5002`。
- 身份在 `services/Identity.ets`：本地联调账号 → Preferences 持久化身份 → 华为账号静默登录 → 匿名回退。
  意图执行器与 A2A 进程没有 AppStorage，走 `services/HeadlessApi.ets`。
- 演示数据用 `NexoraLearning/tools/seed_demo.py --reset` 重灌（账号 `demo_student`）。

## 工程结构

```text
entry/src/main/ets/
  entryability/EntryAbility.ets          入口：深色模式、软键盘避让、卡片 / 通知拉起后定位到对应条目
  entryformability/EntryFormAbility.ets  服务卡片（今日卡：widget/pages/WidgetCard.ets）
  agentextability/NexoraAgentExtAbility  端侧 A2A（AgentCard：resources/base/profile/agent_config.json）
  intents/                               小艺意图：明天学什么 / 讲一下 X（可带拍照文字）/ 考考我（@InsightIntentEntry）
  pages/Index.ets                        壳，只放 DayView
  pages/Day.ets                          它的一天：状态字 + 天选择条 + 夜 / 晨 / 日三幕 + 输入框
  pages/Study.ets                        书房（右上角半屏抽屉）→ Reader / TodayTask（复习）
  pages/Reader.ets  Quiz.ets  Report.ets 阅读器（划线提问、实况窗）/ 答题 / 学习报告
  components/InspectSheet.ets            长按抽屉：这一条（它当时看到的）/ 它眼里的你（判断 + 反驳）/ 报告入口
  components/entry/                      时间线条目（便签样式、「为什么」折叠、各类卡片渲染器）
  services/                              AgentApi ReaderApi ReportApi StreamClient(SSE) HeadlessApi Identity cache/
  capability/                            asr tts context(设备上下文上报) calendar dnd notify form liveview account
  models/                                数据契约（TimelineEntry / Decision / UserModelFacet …）
  theme/DesignTokens.ets                 「夜与晨」令牌；pages / components 下不允许硬编码色值
```

## 开发约定

- 新页面注册到 `resources/base/profile/main_pages.json`；Reader / Quiz / Report 仍走 `router`，Navigation 迁移（意图 `@InsightIntentPage` 的前置条件）待做
- 网络统一走 `AgentApi` / `ReaderApi`，等身份解析完成后再发请求；不直接用 `@ohos.net.http`
- ArkTS 严格模式：显式类型、不用 `any`；`JSON.parse(x) as T` 放在 try/catch 里；Context 用 `this.getUIContext().getHostContext()`
- 面向用户的文案是第一人称的「它」在说话；不出现「暂无 / 请稍候 / 操作成功 / 系统繁忙 / 加载中」
- 意图装饰器文件必须被依赖图引用（`intents/index.ets` 由 EntryAbility 引入）才会编译进 `insight_intent.json`
- 往后端发中文 JSON 用 Python（UTF-8），不要用 PowerShell 的 `Invoke-RestMethod`（会乱码）
