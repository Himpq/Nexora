# 切片：AI 问答底座

状态：已落地。原计划提到命名为 `ChatTransport` 的抽象；实际代码把这条传输边界收敛在 `learningChatService`，由它负责运行时上下文、payload 构造、streaming 和 fallback。

## 已实现

- 通过 `nexoraModelService` 加载模型。
- 通过 `POST /api/runtime/context` 加载学习运行时上下文。
- 根据 lecture / book 目标构造聊天请求。
- 通过 `POST /api/learning/chat` 实现流式问答。
- 同 endpoint 保留非流式兜底。
- `<THINKING_TITLE>` / `<THINKING>` / `<FINAL>` 解析容错。
- 覆盖 loading、empty conversation、sending、cancelled、error 等状态。

## 仍不做

- 移动端持久聊天历史 UI。
- 断线重连。
- 工具调用 UI。
- Web Chat 完整对齐。
- 高级模型选择体验。

## 验收记录

- Chat UI 不硬编码后端 URL。
- Streaming 和 fallback 属于 service 层。
- assistant response 缺少标签时按普通文本处理。
- 错误能展示，不导致页面崩溃。
