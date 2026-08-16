# NexoraWeb — Nexora 前端重写(设计语言保留 + 逻辑层重构)

Nexora(ChatDBServer)与 NexoraCode 共用的**单一前端源**工程。

采用 Vue 3 + TypeScript + Vite 重构 Nexora 前端,核心原则:

> **设计语言不可替换,实现方式可以重写。**

原版 CSS 与 DOM 结构(class 名)作为**设计资产**完整保留,视觉与 Nexora 100% 一致;
交互逻辑层(异步竞态、状态管理、错误处理)用 Vue + Pinia 重写,健康可调试可扩展。

## 架构:设计资产层 + 逻辑层

```
设计资产层(视觉,不可替换)              逻辑层(Vue,可重写)
─────────────────────────────          ─────────────────────────
index.html 直接引用原版 CSS:            src/
  /static/css/style.css                  api/      统一 HTTP + 端点
  /static/css/sidebar_brand_navigation   stream/   StreamService(唯一发送入口+同步锁)
  /static/css/notification.css           stores/   Pinia(user/conversation/model/notify)
  /static/css/message_avatar.css         ui/       ★ 通用 UI 基础模块(General Design Package)
  /static/vendor/fontawesome/...         components/ 原版 DOM 结构复刻组件
  /static/vendor/katex/...               views/    页面
  /static/styles/tokens.css(z-index 令牌) router/   hash 路由 + 登录守卫

Vue 组件只负责数据绑定与事件,
DOM 结构与 class 名与原版 chat.html 完全一致,
原版 CSS 直接命中,无需重新设计样式。
```

## 通用 UI 基础模块(src/ui/,General Design Development Package)

| 模块 | 职责 |
|---|---|
| `ui/overlay.ts` | **浮层协调器**:统一管理所有下拉/菜单/右侧栏/弹窗的打开关闭;互斥(同组只开一个)、打开下拉自动关闭右侧栏、点击外部自动关闭。新浮层接入 = 分配 id + open/close 调用,不再各自手写 document click |
| `styles/tokens.css` | z-index 层级令牌(禁止硬编码,组件按语义引用) |
| `stores/confirm.ts` | 自建确认/输入小窗(Promise API,原版 modal 结构) |
| `stores/notify.ts` | 全局 toast(统一错误提示,杜绝静默吞错) |
| `stream/StreamService.ts` | 聊天流式唯一入口 + 同步发送锁 + 完整 SSE 协议 |

**接入新浮层的规范**:
1. 打开:调用 `openPopover('id', el)` / `openPanel('id')` / `openModal('id')`
2. 关闭:调用 `closePopover('id')` / `closePanel('id')` / `closeModal('id')`
3. 状态:读取 `overlay.popover === 'id'`(响应式)
4. 互斥与外部关闭由协调器自动保证,组件内禁止再手写 document click

## 核心组件(逐像素复刻原版 DOM 结构)

| 组件 | 复刻的原版结构 |
|---|---|
| `Sidebar.vue` | 品牌 tabs + New Chat/Workspaces/Files 工具栏 + 会话列表(`conversation-item`)+ 用户区(`user-menu.active`) |
| `ChatHeader.vue` | 折叠按钮 + 模型选择 + 会话标题 + 右侧按钮(笔记/通知/文件/知识库) |
| `ModelSelect.vue` | `custom-select-container` + provider 分组(`model-group`)+ `model-chip` + 状态标签 |
| `ChatInput.vue` | `input-wrapper` + Thinking/Search 开关 + `#messageInput` + `sendBtn`(stop-mode) |
| `MessageItem.vue` | `.message.user/.assistant > .message-content > .message-bubble/.content-body` + `.msg-actions` |

次要窗口(设置/笔记等)保留布局骨架(如"左侧菜单右侧详情"),内部允许优化重写;
消息渲染实现可替换(markdown 统一走 `MarkdownView`,class 结构保留)。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Vue 3 + TypeScript |
| 构建 | Vite 8 |
| 状态 | Pinia |
| 路由 | vue-router(hash 模式,避免与 Flask 路由冲突) |
| 样式 | **Nexora 原版 CSS(零重写)** |
| Markdown | marked + marked-highlight + highlight.js + KaTeX |

## 开发 / 构建 / 部署

```bash
npm install
npm run dev        # http://localhost:5173,/api 代理到 127.0.0.1:5000
npm run build      # 产物输出到 ChatDBServer/static/new/
```

- Flask:`GET /new` 返回产物 index.html(server.py 的 `new_frontend_page`),原版 CSS 由 Flask 从 /static 托管
- NexoraCode:`/static` 路由直接读 ChatDBServer/static,自动消费新前端
- 老系统 `/chat` 与新前端 `/new` 并行

## 架构要点(解决原版屎山问题)

1. **唯一发送入口 + 同步发送锁**(`src/stream/StreamService.ts`):
   `send()` 入口第一行同步占位,杜绝"多次回车多次发送";SSE 解析与后端协议一致
   (content/content_delta/reasoning_*/done/stream_session 终帧 error)
2. **统一错误处理**(`src/api/client.ts`):401 跳登录、非 2xx 抛 ApiError、错误显式 toast
3. **状态集中**(Pinia):会话/消息/生成状态单一来源,加新功能(如消息队列)即状态机扩展,
   不再像原版全局变量互相覆盖
4. **协议级测试**(`test/stream-protocol.test.mjs`):模拟后端 SSE 输出验证解析逻辑

## 当前状态

- [x] 设计资产层(原版 CSS 直接引用,视觉 100% 一致)
- [x] 核心组件复刻(侧边栏/顶栏/模型选择/输入区/消息结构)
- [x] 会话列表/切换/新建、流式发送(协议正确)、错误提示
- [x] naive-ui 完全移除,登录页复刻原版视觉
- [ ] 端到端真实验证(需账号)
- [ ] Workspace / Files 页面(原版结构)
- [ ] 设置窗口(保留左菜单右详情布局,内部重构)
- [ ] 消息队列(状态机扩展示例)
- [ ] 断线重连 / 消息编辑 / 重答
