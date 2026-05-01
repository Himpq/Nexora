# ChatApp 架构

应用按“稳定底座 + 纵向功能切片”组织。

```txt
src/
├── app/          启动入口和全局 providers
├── config/       环境变量和运行时配置
├── design/       设计 tokens 与基础组件
├── navigation/   根导航、Tab、路由类型
├── services/     API Client 和后端 service 模块
├── features/     session、dashboard、courses、books、chat、admin、settings
├── hooks/        共享 React hooks
└── utils/        纯工具函数
```

## 依赖方向

```txt
features -> services -> apiClient
features -> design
navigation -> features
app -> navigation/providers
```

Screen 不直接调用 `fetch`。后端路径、Header、错误处理等细节留在 `src/services`。

## 初始功能切片

1. 项目底座
2. 用户设置与 frontend context
3. 课程库与加入学习
4. 学习看板
5. 教材列表与阅读
6. 非流式 AI 问答 MVP

## 运行时身份

0.1.0 不启用运行时身份。App 可在没有 username、本地 session 或后端服务的情况下启动。

0.2.0 开始，在后端提供正式移动端登录/token 契约前，移动端使用显式 username。届时 `SessionProvider` 保存当前 username，并传给 `apiClient`，由 `apiClient` 统一注入：

```txt
X-Nexora-Username: <username>
```
