# 架构边界

ChatApp 是一个 Expo + React Native 移动端学习客户端。目标只有一个：让后端数据流、状态和用户路径容易追踪。

## 目录职责

```txt
src/
├── app/          启动入口和全局 providers
├── config/       运行时配置和应用信息
├── design/       tokens 与基础组件
├── navigation/   Stack、Tab 和路由类型
├── services/     API client 与后端 service 模块
├── features/     面向用户的纵向功能
├── hooks/        共享 hooks
└── utils/        纯工具函数
```

## 依赖方向

```txt
features -> services -> apiClient
features -> design
navigation -> features
app -> providers/navigation
```

硬规则：

- Screen / Component 不直接调用 `fetch`。
- 后端路径、header、JSON 解析、stream 解析和错误处理属于 `src/services/*`。
- `src/services/apiClient.ts` 负责 base URL 拼接和共享 header。
- `SessionProvider` 负责 username 持久化，并把身份同步给两个 API client。
- 后端字段不稳定时，类型保留 `[key: string]: unknown`，不要脑补确定字段。
- 各 service 的具体职责见 `backend-data-flow.md`。

## 命名规则

新开发使用 `Lecture` / `Book`。旧的 `course` / `material` 只允许出现在历史文档或既有用户文案里。

用户可见区域统一称为：Session、Dashboard、Courses、Books、Chat、Admin、Feed、Settings。

## UI/UX 顺序

UI/UX 放最后。先稳定后端契约、service、状态和测试，再统一视觉层；做 UI/UX 时不得绕过 service 边界。
