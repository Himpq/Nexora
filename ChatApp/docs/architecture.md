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
6. AI 问答底座：流式优先设计，非流式兜底
7. 管理员内容流：创建教材、上传文件、触发教材提炼（粗读/精读生成）
8. 向量化监控

## 运行时身份

0.1.0 不启用运行时身份。App 可在没有 username、本地 session 或后端服务的情况下启动。

0.2.0 开始，在后端提供正式移动端登录/token 契约前，移动端使用显式 username。届时 `SessionProvider` 保存当前 username，并传给 `apiClient`，由 `apiClient` 统一注入：

```txt
X-Nexora-Username: <username>
```

## AI 问答传输层

ChatApp 最终应接近 Nexora 原版的流式体验，但移动端不能直接假设浏览器流式代码可复用。

0.6.0 先建立传输层边界：

```txt
Chat UI -> ChatTransport -> services/apiClient
```

推荐保留两条实现：

```txt
NonStreamingChatTransport  当前可运行兜底
StreamingChatTransport     0.6.1 验证后接入
```

这样流式通道验证失败时，AI 问答仍可用；流式接入成功后，也不需要重写 Chat UI。
