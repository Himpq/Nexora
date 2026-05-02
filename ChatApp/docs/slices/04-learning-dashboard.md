# 切片：学习看板

## 目标

用户可以在学习 Tab 查看已加入课程、学习概览，并从看板继续回到学习入口。

## 用户流程

1. 用户打开学习 Tab。
2. App 调用 `GET /api/frontend/dashboard`。
3. App 渲染已加入课程、教材数量和累计学习时长。
4. 用户点击“继续学习”。
5. App 跳转到课程 Tab。

## API

- `GET /api/frontend/dashboard`

## 页面

- `DashboardScreen`

## 组件

- `AppCard`
- `AppButton`
- `StateView`

## 状态

- loading
- empty
- error
- normal

## 不做范围

- 课程详情
- 教材列表和阅读
- 真实阅读进度
- AI 问答
- 教材上传、提炼和向量化

## 验收标准

- 学习看板通过 `frontendService` 加载。
- 网络失败时显示可重试错误状态。
- 没有已加入课程时显示空状态，并可跳转到课程 Tab。
- 有已加入课程时显示课程数、教材数、学习时长和课程卡片。
- “继续学习”跳转到课程 Tab。
- Screen 层没有直接 `fetch`。
