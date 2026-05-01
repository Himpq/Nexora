# 切片：用户上下文

## 目标

用户可以用显式 username 建立移动端本地会话，App 统一携带用户身份调用 NexoraLearning，并在设置页查看当前用户、管理员身份和后端连通状态。

## 用户流程

1. 用户首次打开 App。
2. App 尝试从本地恢复 username。
3. 没有 username 时，App 显示用户设置页。
4. 用户输入 username 并继续。
5. App 保存 username，刷新 `/api/frontend/context`，并进入主 Tab。
6. 用户在设置页查看 context、角色和模型连通状态。
7. 用户可以刷新上下文，也可以切换用户并回到设置入口。

## API

- `GET /api/frontend/context?username={username}`

后续业务 API 不在页面层传 username，由 `apiClient` 统一注入：

```txt
X-Nexora-Username: <username>
```

## 页面

- `UserSetupScreen`
- `SettingsScreen`

## 组件

- `SessionProvider`
- `StateView`
- `AppButton`
- `AppCard`

## 状态

- bootstrapping
- no username
- context loading
- context error
- context ready

## 不做范围

- 正式登录/注册
- token 或安全存储
- 权限拦截
- admin 页面入口
- 课程列表数据加载

## 验收标准

- 首次启动无 username 时进入用户设置页。
- 输入 username 后进入主 Tab。
- username 持久化到本地，重启后自动恢复。
- `apiClient` 使用 `X-Nexora-Username` 统一注入身份。
- `/api/frontend/context` 失败时不阻止进入主界面。
- 设置页能显示当前 username、context username、角色、管理员状态和后端连通状态。
- 设置页可以刷新上下文和切换用户。
- Screen 层没有直接 `fetch`。
