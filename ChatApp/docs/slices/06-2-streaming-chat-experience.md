# 切片：流式聊天体验

## 目标

在 0.6.1 验证通过的流式通道上，实现移动端可用的流式 AI 问答体验。

## 用户流程

1. 用户发送问题。
2. App 立即显示用户消息和 assistant pending 状态。
3. 服务端返回 chunk。
4. App 增量展示思考内容和最终回答。
5. 用户可以取消生成。
6. 失败时展示错误，并保留可重试状态。

## API

以 0.6.1 确认路线为准。

可能包含：

- `POST /api/chat/stream`
- `POST /api/chat/stream/cancel`
- `POST /api/chat/stream/reconnect`，如决定支持重连

## 状态

- sending
- streaming
- cancelling
- cancelled
- completed
- error retryable
- error terminal

## 不做范围

- 工具调用交互 UI
- 长期记忆可视化
- 多模态视频帧
- Web 版所有 debug 面板
- 与 0.6.2 无关的聊天历史高级管理

## 验收标准

- 回答可以逐步显示。
- 思考块和最终回答视觉上分开。
- 取消生成可用。
- 网络错误不导致页面崩溃。
- 非流式兜底仍可保留或在配置中切换。
