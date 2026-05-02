# 切片：教材阅读

## 目标

用户可以从课程进入教材列表，查看教材原文、已生成的 `bookinfo` 和 `bookdetail`，并让学习看板的“继续学习”回到该课程上次学习的详情位置。

## 用户流程

1. 用户从课程或学习看板进入已加入课程。
2. App 加载课程下的教材列表。
3. 用户选择教材并查看原文、概读或精读内容。
4. App 记录该课程最近一次学习位置。
5. 用户下次在学习看板点击该课程“继续学习”。
6. App 跳转到该课程上次学习的详情位置。

## API

- `GET /api/lectures/{lecture_id}/books`
- `GET /api/lectures/{lecture_id}/books/{book_id}/text`
- `GET /api/lectures/{lecture_id}/books/{book_id}/bookinfo`
- `GET /api/lectures/{lecture_id}/books/{book_id}/bookdetail`

## 页面

- `CourseDetailScreen`
- `BookDetailScreen`
- `BookReaderScreen`

## 组件

- `BookListItem`
- `BookContentSection`
- `StateView`

## 状态

- loading
- empty
- error
- normal
- updating recent position

## 不做范围

- 上传教材
- 编辑教材
- XML 复杂结构化解析
- 触发教材提炼（粗读/精读生成）
- 向量化
- AI 问答

## 验收标准

- 教材列表、原文、`bookinfo`、`bookdetail` 通过 service 层加载。
- 网络失败时显示可重试错误状态。
- 没有教材时显示空状态。
- `bookinfo` / `bookdetail` 第一版可按可读文本展示。
- `bookinfo` / `bookdetail` 尚未生成时，显示等待管理员提炼处理的空状态。
- 用户打开某课程的教材详情或阅读内容后，课程最近学习位置被记录。
- 学习看板点击该课程“继续学习”时跳转到上次学习的详情位置。
- 没有最近学习位置时，继续学习跳转到该课程的教材列表。
- Screen 层没有直接 `fetch`。

## 开发日志

- 2026-05-02：当前后端尚未提供“继续学习 / 最近学习位置”的持久化与查询接口，因此 0.5.0 实现时不记录最近学习位置，也不做本地存储兜底。学习看板中的“继续学习”按钮和对应跳转先禁用，并显示等待后端支持的占位文案。这是为了避免移动端产生与后端状态不一致的伪进度，属于本阶段合理的范围调整。
