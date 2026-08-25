# NexoraWeb — Nexora 前端重写(设计语言保留 + 逻辑层重构)

Nexora(ChatDBServer)与 NexoraCode 共用的**单一前端源**工程。

采用 Vue 3 + TypeScript + Vite 重构 Nexora 前端,核心原则:

> **设计语言不可替换,实现方式可以重写。**

原版 CSS 与必要的 class 作为兼容资产保留；新设置页、模型选择器和管理面板的公共视觉由 GDDP 组件与样式统一管理。legacy CSS 仍由 `/new` 运行时加载，只承担旧聊天和迁移兼容规则，不再作为新组件的唯一设计来源。

## 架构:应用层 + GDDP + 业务层

```
GDDP(统一设计开发包)                    应用与业务层
─────────────────────────────          ─────────────────────────
src/ui/index.ts                         api/      统一 HTTP + 端点
  primitives: Button, Modal,            stores/   Pinia 状态与通知
    ModelSelectBase, ProviderIcon       stream/   StreamService(聊天基础设施)
  patterns: AdminPanel,                 components/ 页面业务组件
    SettingCard, SettingActionRow,      views/    页面与路由
    SettingDetailSection,
    SettingsPageHeader
  services: overlay, theme
src/styles/gddp.css
  tokens + colors + primitives
  + settings
```

GDDP 只负责可复用的视觉组件、布局模式、设计令牌和浮层协调，不包含业务 API、Pinia 业务状态或聊天流服务。业务组件通过 `@/ui` 或 `@/ui/index.ts` 使用 GDDP，禁止为同一类按钮、详情布局、模型下拉重新实现视觉规则。

生产环境的 `/new` 由 Flask 直接读取 `ChatDBServer/static/new/index.html`，源码变更必须执行 `npm run build` 才会进入实际页面。旧 `/chat` 模板与 NexoraWeb `/new` 是两条并行入口，旧入口不会自动获得 Vue GDDP 组件。

## GDDP 基础模块

| 模块 | 职责 |
|---|---|
| `ui/index.ts` | GDDP 统一内部导出入口 |
| `ui/Button.vue` | 统一普通、危险、紧凑和图标按钮几何 |
| `ui/model/ModelSelectBase.vue` | 主页与偏好设置共用的模型分组、Provider 图标、浮层定位 |
| `ui/model/ProviderIcon.vue` | Provider 图标与首字符 fallback |
| `ui/AdminPanel.vue` | 左列表 + 右详情管理布局 |
| `ui/settings/SettingActionRow.vue` | 详情操作按钮行,内容宽度与稳定最小宽度 |
| `ui/settings/SettingDetailSection.vue` | 无嵌套卡片的详情分区 |
| `ui/settings/SettingsPageHeader.vue` | 页标题、筛选、页级命令和子标签 |
| `ui/overlay.ts` | 浮层协调器,统一互斥与外部关闭 |
| `ui/theme.ts` | 外观主题服务:浅色/深色/跟随系统,落 `<html data-theme>` 并联动代码高亮双主题 |
| `styles/gddp.css` | GDDP 唯一样式入口 |
| `styles/tokens.css` | z-index、控件高度、间距与圆角令牌 |
| `styles/tokens-color.css` | 语义色彩令牌(表面/文字/边框) + `[data-theme="dark"]` 暗色覆盖 + legacy 区域变量过渡 |

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
| `ModelSelect.vue` | 主页与偏好设置共用的 GDDP 模型选择器适配器 |
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
| 样式 | Nexora 原版 CSS 收编为工程内资产(`src/styles/legacy`,视觉冻结) + GDDP 语义色彩令牌 |
| Markdown | marked + marked-highlight + highlight.js + KaTeX |

## 外观主题(黑夜模式)

- **三态切换**:偏好设置 → 外观与行为 → 主题(浅色 / 深色 / 跟随系统),下拉变更即时生效,保存后持久化到服务器偏好;`localStorage` 仅作启动期缓存(防闪屏)
- **实现通道**:`ui/theme.ts` 把解析结果写到 `<html data-theme>`,`tokens-color.css` 的 `[data-theme="dark"]` 区覆盖语义令牌,组件禁止自行判断明暗
- **颜色规则**:新代码一律引用 `--color-*` 语义令牌;legacy 收编资产内的颜色已内联替换为同亮色值的令牌引用,暗色经令牌自动生效,不存在第二套 dark 规则表
- **代码高亮**:github(亮)/ github-dark(暗)双主题由主题服务按档位启停

### legacy 资产(`src/styles/legacy/`)

原版 `/static/css` 的 14 个文件已收编进 Vue 工程(经 `legacy.css` 按 historical 顺序聚合),由 Vite 统一打包。约束:

1. **视觉冻结**:除 `style.css` 头部桥接区与内联令牌化(同值 hex → `var(--color-*)`)外不改任何视觉规则
2. 原版变量中区域专属配色(侧边栏/学习模式侧栏)的暗色值集中在 `tokens-color.css` 的过渡覆盖区,独立渲染完成后随 legacy 一起退役
3. `ChatDBServer/static/css` 保持原样供旧 `/chat` 使用,两入口互不影响

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

- [x] GDDP 组件入口、设置页管理布局、模型选择器与偏好模型统一
- [x] Skill/邮箱/按钮响应式与详情层级整理
- [ ] legacy `/chat` 旧模板迁移到 NexoraWeb
