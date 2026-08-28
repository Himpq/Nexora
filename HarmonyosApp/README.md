# HarmonyosApp — Nexora Learning 鸿蒙原生入口

NexoraLearning 鸿蒙高校创新赛的可选 HarmonyOS 原生入口（对应 `HarmonyosData/RESEMI_FINAL_PLAN.md` 阶段 2）。
范围限定为 Agent 入口、今日任务与复习、章节内提问；完整学习内容仍由 NexoraLearning Web 工作区承载。

## 环境

- DevEco Studio 6.x + 官方 DevEco CLI（npm `@deveco/deveco-cli` >= 1.3.0）
- HarmonyOS SDK 6.1.1（API 24）
- 工程：Stage 模型 + ArkTS，bundle `com.nexora.learning`

## 构建

```text
# 首次构建会自动执行 ohpm install 与 hvigor sync（冷构建约 10 s）
devecocli build --build-mode debug
```

产物：`entry/build/default/outputs/default/entry-default-unsigned.hap`

签名与安装：

- 模拟器：无需签名，直接 `devecocli emulator start <name>` 后 `devecocli run`。
- 真机：需先在 AppGallery Connect 添加设备，再 `devecocli signature generate` 生成签名材料。

## 工程结构

```text
entry/src/main/ets/
  entryability/EntryAbility.ets   # 入口 Ability
  pages/Index.ets                 # 首页：今日下一步规划 / 课程进度 / 章节内提问 / 打开学习工作区
  pages/TodayTask.ets             # 今日任务与复习：异步生成复习题并轮询，结构化渲染
  services/AgentApi.ets           # /api/agent/v1 客户端封装（统一信封、演示用户、超时）
```

## 云端契约（App 依赖）

- 基线：`https://chat.himpqblog.cn:5002/api/agent/v1`，演示用户 `cjbpq`（`X-Nexora-Username` 传递）
- 详见 `HarmonyosData/AGENT_FACADE_API.md`
- 已实测边界：
  - `GET /today` 云端尚未部署（404），首页不依赖它，使用 `/context` + `/plan`
  - `POST /review-plan` 对无知识图谱概念的章节（如"参考文献"）返回 `TASK_FAILED`；
    TodayTask 页自动选择"精读完成"教材的最近学习章节并原样展示失败原因
- App 只传最小学习任务参数；不保存华为账号凭证、不上传教材全文

## 开发约定

- 新增页面需注册到 `entry/src/main/resources/base/profile/main_pages.json`
- 网络请求统一走 `AgentApi`，不要直接使用 `@ohos.net.http`；请求后必须 `destroy()`
- ArkTS 严格模式：显式类型、不用 `any`；解析网络 JSON 用 `JSON.parse(x) as T` 并在 try/catch 中处理
- 获取 Context 使用 `this.getUIContext().getHostContext()`（API 18+ 推荐，替代已废弃的 `getContext`）
