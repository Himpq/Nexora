# NexoraLearning 前端架构蓝本（2026 决策版）

> 本文档固化 2026 年对 Learning 前端的架构决策，供大改样式与长线维护使用。
> 关联文档：`NEXORALEARNING_API.md`（后端接口）、`NEXORALEARNING_DIALOG_API.md`（学习对话编排边界）。

## 0. 决策记录（结论优先）

| 主题 | 决策 | 理由 |
|---|---|---|
| 集成形态 | **双应用独立部署**：Learning 保持独立前端应用，不进 NexoraWeb 主包 | Learning 体量（echarts/G6/mermaid/Reader 全套）会拖垮 Nexora 主体；Mail 级轻量 UI 可忍受收编，Learning 不行 |
| Learning 前端栈 | **现代栈重写（Vue 3）**，复用 chatStream 同款分层架构 | 原版为无框架原生 JS 模块栈（`00_core_state→09_events_init` + 200KB 手写 CSS），无法承载 store/网络层/类型化意图三层结构；重写后大改样式与维护顺 |
| 主机挂载 | **iframe 覆盖层薄挂载**：NexoraWeb 新增 `view='learning'` 内容级视图，内含一个 iframe 薄组件 | 主机零 Learning 代码；对齐 `gddp-content-view` + `?view=` URL 同步模式；Mail 已有沙箱 iframe 先例 |
| 学习对话网络层 | **独立 `learningChat` 网络层**（对齐 `src/network/chatStream`：发送锁/SSE/取消/断点续播/快照） | 学习流与主聊天流互不侵入；问题定位单一 |
| 跨 app 沟通 | **类型化消息协定**（`learning-bridge` 共享类型），传输层可插拔（iframe=postMessage / 标签页=BroadcastChannel） | 取代原版 `course_workspace_bridge.js` 的裸 postMessage 人肉对齐契约 |
| 深度链接 | `?view=learning`（可选 `&course=…&book=…`） | 对齐 Workspaces 的 URL 直达/刷新恢复模式 |

## 1. 总体架构

```mermaid
flowchart LR
    subgraph Nexora["Nexora 主应用(NexoraWeb,保持轻量)"]
        SB[Sidebar 工具栏按钮] -->|emit intent| CV[ChatView]
        CV -->|openView 'learning'| OV[overlay 状态机]
        OV --> LV[LearningFrameView 薄组件]
        LV -->|iframe| FB[Learning 前端]
        LV -->|HostLearningCommand| BR[learningHostBridge]
        BR -->|postMessage| FB
    end

    subgraph Learning["Learning 前端(Vue3 独立应用,可重样式)"]
        DIR[学习 store: 课程/教材/阅读位置/对话流]
        LS[learningChat 网络层: 发送/续播/取消/快照]
        INT[类型化意图 LearningIntent]
        UI[课程列表 / 课程详情 / Reader / 学习对话组件]
        BR2[learningHostBridge(接收端)]
    end

    FB -->|LearningHostMessage 快照/事件| BR --> OV
    UI -->|读写| DIR
    LS -->|驱动| DIR
    DIR -->|订阅| UI
    BR2 -->|写入| DIR
```

## 2. 跨 app 消息协定（learning-bridge）

两端只依赖这份协定，互不知道对方内部结构；信封带协议名、版本、来源，双向校验。

```ts
/** 信封(双向通用) */
export interface LearningBridgeEnvelope {
    protocol: 'nexora-learning'
    version: 1
    /** 'host' | 'learning' */
    source: string
    type: string
    [key: string]: unknown
}

/** Learning → Host:状态快照与事件 */
export type LearningHostMessage =
    | { type: 'state-snapshot'; active: boolean; lecture_id: string; title: string; hero_html?: string; tabs: Array<{ key: string; label: string; active: boolean }>; activation: 'user' | 'sync' }
    | { type: 'learning-demand'; lecture_id: string }        // 学习对话/内容请求链路
    | { type: 'open-chat-conversation'; conversation_id: string }  // 学习流落在主聊天会话时,请宿主切过去
    | { type: 'pointer-down' }                                // 宿主侧栏自动折叠判定

/** Host → Learning:命令 */
export type HostLearningCommand =
    | { type: 'open-course'; lecture_id: string }
    | { type: 'start-learning-path'; lecture_id: string }
    | { type: 'switch-tab'; tab: string }
    | { type: 'layout'; sidebar_auto_collapse: boolean }
```

传输层适配器接口（Learn 端与 Host 端各自实现）：

```ts
export interface LearningBridgeAdapter {
    post(message: LearningBridgeEnvelope): void
    on(callback: (message: LearningBridgeEnvelope) => void): () => void
}
// 实现:PostMessageAdapter(iframe parent/child)、BroadcastChannelAdapter(独立标签页)
```

## 3. Learning 前端内部三层边界（重写后的模块骨架）

- **状态层**：`stores/learning.ts`（Pinia）——课程/教材列表、当前课程/教材、阅读位置、学习对话消息、运行状态、错误；所有组件只读写该 store。
- **网络层**：`network/learningChat.ts`——与 `chatStream` 同款：发送锁、SSE 解析、取消、断点续播、快照持久化；模型执行经 `/api/learning/chat`（编排边界见 DIALOG_API 文档）。
- **意图层**：`LearningIntent` 类型化命令（`open-course / open-book / start-coarse / start-intensive / ask-question …`），由 store action 消费，组件不直接跨组件调方法。
- 样式：复用 Nexora 设计令牌（`--color-*` / `--nc-font-*`）做视觉对齐，不再维护独立 200KB 手写 CSS；图标统一 svg/iconfont（不引入新 emoji 图标）。

## 4. 主机侧薄挂载规格（NexoraWeb）

- `overlay.view` 增加 `'learning'`；Sidebar 工具栏新增 Learning 按钮 → `emit('open-learning')` → `openView('learning')`。
- `LearningFrameView.vue`：一个 iframe + `learningHostBridge(PostMessageAdapter)` 接收 `LearningHostMessage`（用于侧栏课程卡片/顶栏标题与返回链），转发 `HostLearningCommand`。
- 顶栏返回/URL 同步对齐 Workspaces：`?view=learning` 直达；离开时 `closeView` 回聊天。
- 安全：iframe `sandbox` 最小权限（需脚本+同源策略）,与 Mail 沙箱先例一致；跨域时通过 Learning 服务反代 `/api/frontend/*` 保证同源（现 Admin 面板已有 host/port/frontend_url 配置，可扩展为同源代理路径）。

## 5. 分阶段落地清单

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 壳与协定 | `learning-bridge` 类型包；Host 侧 `view='learning'` + iframe 薄组件 + `?view=` 同步；Learning 空壳 Vue3 应用 + bridge 收发 | 从 Nexora 点开 Learning iframe 显示空态，双向往返一条消息成功 |
| P1 课程/教材 | Learning 内 Vue3 重写课程列表/课程详情/教材上传提炼（复用 `/api/lectures`、`/api/frontend/materials`） | 原功能等价 |
| P2 Reader | 阅读器/学习路线/问答卡片迁入新栈（echarts/G6 按需 chunk，不进主入口） | 阅读交互等价 |
| P3 对话网络层 | `learningChat` 落库（发送/续播/取消/快照）+ 学习对话 UI；对话入口复用 MarkdownView 等价组件 | 学习对话流式、刷新恢复 |
| P4 样式大改 | 按新设计系统全面重做 Learning CSS；视觉令牌对齐 Nexora | 设计稿/验收 |

## 6. 风险与待决

- **跨域/同源**：iframe 若跨域，postMessage 可用但会话 cookie 需同源；优先让 Learning 服务反代 `/api/frontend/*` 同源挂载。
- **双滚动条/焦点**：iframe 内滚动与主机滚动隔离，宿主侧 `?view=learning` 全屏覆盖可缓解。
- **旧嵌入页兼容期**：`learning-bridge` 适配器保留 `FrameAdapter`，旧 iframe 页面可继续用同一协定过渡。
- **学习对话是否落主聊天会话**：若 `learning-demand` 依赖主聊天 conversation 渲染，需在协定中定义 `open-chat-conversation` 语义并让 Host 处理（P3 前敲定）。