# 切片：流式通道验证

状态：已完成。当前活文档见 `../../streaming-channel-validation.md`。

## 决策

学习问答流式通道使用 `ChatDBServer POST /api/learning/chat`。

学习上下文继续使用 `NexoraLearning POST /api/runtime/context`。

## 已拒绝路线

- `NexoraLearning /api/completions`：服务端消费上游 streaming 后返回 JSON，不是真正的移动端 stream。
- `ChatDBServer /api/chat/stream`：绑定 Web chat contract 和 cookie login。
- 新增 `NexoraLearning` streaming proxy：当前 `/api/learning/chat` 已可用，暂不需要。

## 验收记录

- `learningChatService` 能解析 SSE `data:` frame 和 `[DONE]`。
- `ReadableStream` 不可用时可以回退。
- 移动端取消使用 `AbortController`；不声明后端 cancel。
