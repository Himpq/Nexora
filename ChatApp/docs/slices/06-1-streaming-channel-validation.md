# 切片：流式通道验证

## 目标

验证 Expo / React Native 环境下是否能稳定消费 Nexora 的流式输出，并确定移动端最终流式路线。

## 候选路线

1. 直接调用 `ChatDBServer /api/chat/stream`
2. 通过 `NexoraLearning` 新增 streaming proxy
3. 使用 PAPI `stream: true` 的 OpenAI 兼容流式响应

## 需要验证的问题

- 移动端 `fetch` 是否提供可用 `ReadableStream`
- Android 模拟器和真机表现是否一致
- 是否需要 polyfill 或第三方 SSE 客户端
- 认证方式如何处理：cookie session、public api key、username header
- cancel 是否能可靠触发
- 后端错误 chunk 如何映射到 UI
- `[DONE]`、`stream_session`、`conversation_id`、`error` 等事件是否稳定

## 不做范围

- 不做完整聊天 UI 重构
- 不接入复杂 markdown 增量渲染
- 不实现断线重连
- 不实现工具调用 UI

## 验收标准

- 写明最终选择的 streaming 路线。
- 有最小实验代码或测试记录证明移动端可消费流式响应。
- 记录失败路线和原因。
- 明确 0.6.2 需要实现的事件映射表。
