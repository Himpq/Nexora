# 切片：AI 问答底座

## 目标

建立 ChatApp 的 AI 问答基础能力。架构上按流式优先设计，但第一版必须保留非流式兜底，避免移动端 streaming 通道未验证时阻塞整体学习闭环。

## 用户流程

1. 用户进入 AI 问答页。
2. App 加载可用模型。
3. 用户输入问题。
4. App 使用当前课程/教材上下文构建消息。
5. App 通过 `ChatTransport` 发送请求。
6. App 展示思考块和最终回答。
7. 请求失败时展示可理解错误，并允许重试。

## API

非流式兜底：

- `GET /api/nexora/models`
- `POST /api/nexora/papi/chat/completions`
- `POST /api/completions`

流式候选路线，必须在 0.6.1 验证后再正式接入：

- `POST ChatDBServer /api/chat/stream`
- `POST ChatDBServer /api/chat/stream/cancel`
- `POST ChatDBServer /api/chat/stream/reconnect`
- 或新增 `NexoraLearning` streaming proxy

## 页面

- `ConversationScreen`
- `ModelSelectScreen`，如当前导航需要

## 组件

- `ChatMessageList`
- `ChatComposer`
- `ModelPicker`
- `ThinkingBlock`
- `AssistantMessage`
- `UserMessage`

## 服务与工具

- `ChatTransport`
- `NonStreamingChatTransport`
- `StreamingChatTransport` 占位或最小实验实现
- `parseAssistantResponse`

## 状态

- loading models
- ready
- sending
- streaming，0.6.1/0.6.2 完成
- error
- empty conversation
- retrying

## 不做范围

- 完整复刻 Web 版 ChatDBServer 流式聊天
- 断线重连
- 工具调用 UI
- 多模态视频帧
- 长期记忆可视化
- 题目卡片
- 复杂打字机动画

## 验收标准

- 传输层存在清晰边界，Chat UI 不直接调用后端 URL。
- 非流式兜底能完成一次问答。
- 代码结构允许后续切换到流式实现而不重写 Chat UI。
- `<THINKING_TITLE>` / `<THINKING>` / `<FINAL>` 解析容错。
- 没有标签时按普通正文展示。
- 模型加载失败、请求失败时有 error 状态。
- 本切片不实现未经验证的完整 streaming。
