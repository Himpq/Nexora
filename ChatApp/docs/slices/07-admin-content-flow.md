# 切片：管理员内容流

## 目标

管理员可以创建课程教材、上传教材文件，并手动触发教材提炼（粗读/精读生成），让学习者在 0.5.0 阅读页看到已生成的 `bookinfo` / `bookdetail`。

## 用户流程

1. 管理员进入管理入口。
2. App 通过 `/api/frontend/context` 确认管理员身份。
3. 管理员创建教材元数据并上传教材文件。
4. App 明确显示教材“已上传，等待提炼处理”。
5. 管理员打开待提炼列表。
6. App 调用 `GET /api/frontend/settings/refinement` 展示候选教材和队列状态。
7. 管理员触发或停止单本教材提炼。
8. App 轮询队列状态，并展示粗读/精读生成状态和错误。

## API

- `POST /api/lectures/{lecture_id}/books`
- `POST /api/lectures/{lecture_id}/books/{book_id}/file`
- `GET /api/frontend/settings/refinement`
- `POST /api/frontend/settings/refinement/start`
- `POST /api/frontend/settings/refinement/stop`
- `GET /api/refinement/queue`，如需要更细队列快照

## 页面

- `AdminHomeScreen`
- `BookUploadScreen`
- `RefinementQueueScreen`

## 组件

- `AdminGate`
- `BookUploadForm`
- `RefinementCandidateList`
- `RefinementQueueSummary`
- `StateView`

## 状态

- loading
- empty
- error
- normal
- uploading
- queued
- running
- stopping

## 不做范围

- 学生侧教材阅读
- 向量化触发和监控
- AI 问答
- 模型配置编辑
- 自动上传后立即提炼

## 验收标准

- 管理入口只对 admin 用户显示或可进入。
- 上传教材后 UI 不暗示已经完成粗读/精读。
- 管理员可以查看待提炼教材和队列状态。
- 管理员可以触发单本教材提炼，提炼语义明确为“粗读/精读生成”。
- 管理员可以停止单本教材提炼并看到状态变化。
- 队列和教材状态加载失败时有可重试错误状态。
- Screen 层没有直接 `fetch`。
