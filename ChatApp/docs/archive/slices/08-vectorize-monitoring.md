# 切片：向量化监控

状态：已落地，后续主要是选择教材和状态呈现体验打磨。

## 目标

管理员可以查看单本教材的向量化状态，手动触发向量化，并观察处理结果与错误信息。

## 用户流程

1. 管理员进入内容管理入口。
2. App 加载教材向量化状态。
3. 管理员查看某本教材当前是否已向量化、分块数量和向量数量。
4. 管理员手动触发该教材的向量化。
5. App 显示触发结果，并在失败时展示错误。

## API

- `GET /api/lectures/{lecture_id}/books/{book_id}/vectorize`
- `POST /api/lectures/{lecture_id}/books/{book_id}/vectorize`

## 页面

- `VectorizeScreen`

## 组件

- `VectorizeStatusCard`
- `VectorizeActionPanel`
- `StateView`

## 状态

- loading
- empty
- error
- normal
- processing
- success

## 不做范围

- 不实现新的向量检索 UI
- 不重做教材提炼流程
- 不引入后台任务编排框架

## 验收标准

- 管理员可以查看单本教材的向量化状态。
- 管理员可以触发向量化操作。
- 触发失败和加载失败都能显示可理解错误。
- Screen 层没有直接 `fetch`。
