# 切片：流式聊天体验

状态：基础能力已落地。

## 已实现

- 用户消息立即显示。
- assistant 消息按 delta 增量展示。
- `<THINKING_TITLE>` / `<THINKING>` / `<FINAL>` 解析保持容错。
- `AbortController` 取消当前设备端 stream reader。
- streaming 失败或没有返回内容时回退到 `sendLearningChat`。

## 当前路线

- `POST ChatDBServer /api/learning/chat`，`stream: true`
- 兜底：同 endpoint，`stream: false`

## 仍不做

- 后端 server-side cancel endpoint。
- 断线重连。
- 工具调用 UI。
- 多模态消息。
- 长期聊天历史管理。
- Web Chat 完整对齐。

## 验收记录

- 内容可以增量渲染。
- 取消不会导致页面崩溃。
- 移动端缺少 `ReadableStream` 时，非流式问答仍可用。
- `learningChatService` 有 SSE frame 解析单测。
