# 切片：教材阅读

状态：已落地，章节级完成 UI 仍待后续章节边界支持。

## 目标

用户可以从课程进入教材列表，查看教材原文、已生成的 `bookinfo` 和 `bookdetail`。后端已提供章节完成上报能力；当前移动端先展示课程级进度，章节级完成按钮在后续章节 UI 中接入。

## 用户流程

1. 用户从课程或学习看板进入已加入课程。
2. App 加载课程下的教材列表。
3. 用户选择教材并查看原文、概读或精读内容。
4. 用户回到学习看板时，可以看到后端返回的课程进度和当前章节。
5. 用户从学习看板点击“继续学习”进入对应课程详情页。

## API

- `GET /api/lectures/{lecture_id}/books`
- `GET /api/lectures/{lecture_id}/books/{book_id}/text`
- `GET /api/lectures/{lecture_id}/books/{book_id}/bookinfo`
- `GET /api/lectures/{lecture_id}/books/{book_id}/bookdetail`
- `POST /api/frontend/learning/chapter-complete`，后续章节 UI 接入

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
- course progress / current chapter visible

## 不做范围

- 上传教材
- 编辑教材
- XML 复杂结构化解析
- 章节级精确定位和滚动恢复
- 触发教材提炼（粗读/精读生成）
- 向量化
- AI 问答

## 验收标准

- 教材列表、原文、`bookinfo`、`bookdetail` 通过 service 层加载。
- 网络失败时显示可重试错误状态。
- 没有教材时显示空状态。
- `bookinfo` / `bookdetail` 第一版可按可读文本展示。
- `bookinfo` / `bookdetail` 尚未生成时，显示等待管理员提炼处理的空状态。
- 学习看板展示后端记录的课程进度和当前章节。
- 学习看板“继续学习”进入对应课程详情页。
- Screen 层没有直接 `fetch`。

## 开发日志

- 2026-05-02：当前后端尚未提供“继续学习 / 最近学习位置”的持久化与查询接口，因此 0.5.0 实现时不记录最近学习位置，也不做本地存储兜底。学习看板中的“继续学习”按钮和对应跳转先禁用，并显示等待后端支持的占位文案。这是为了避免移动端产生与后端状态不一致的伪进度，属于本阶段合理的范围调整。
- 2026-05-17：后端已提供 `POST /api/frontend/learning/chapter-complete`，可写入章节完成记录、课程进度和下一章节提示。移动端本轮先补齐 service，并把学习看板从禁用占位改为课程级继续学习入口；章节级完成上报需要等阅读页具备章节列表或章节边界后再接入，避免在纯文本阅读页伪造章节。
