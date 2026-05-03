# 切片：课程列表

## 目标

用户可以查看可用课程，并加入或退出学习。

## 用户流程

1. 用户打开课程 Tab。
2. App 调用 `GET /api/frontend/materials`。
3. App 渲染课程列表和教材数量。
4. 用户点击加入/退出学习。
5. App 调用 `POST /api/frontend/learning/select`。
6. App 刷新或更新本地选择状态。

## API

- `GET /api/frontend/materials`
- `GET /api/frontend/dashboard`
- `POST /api/frontend/learning/select`

## 页面

- `CourseListScreen`

## 组件

- `CourseCard`
- `LearningSelectButton`
- `StateView`

## 状态

- loading
- empty
- error
- normal
- updating

## 不做范围

- 创建课程
- 上传教材
- 完整课程详情
- AI 问答
- 提炼和向量化

## 验收标准

- 课程列表通过 `frontendService` 加载。
- 网络失败时显示可重试错误状态。
- 没有课程时显示空状态。
- 加入/退出学习后状态更新。
- Screen 层没有直接 `fetch`。
