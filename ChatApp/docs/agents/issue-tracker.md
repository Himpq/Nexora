# Issue Tracker

主要 issue tracker：GitHub Issues，仓库为 `https://github.com/cjbpq/Nexora`。

## 什么时候创建 issue

适合创建或更新 issue：

- 用户可见 feature 或 bug fix。
- 后端契约不一致，需要后续处理。
- 跨文件 refactor。
- 已排到 backend/data-flow 稳定之后的 UI/UX 工作。

不建议为一次性文档小修或一轮内能完成的小改动创建 issue，除非用户要求。

## issue 应包含

- 问题
- 当前行为
- 期望行为
- 相关文件
- 相关 endpoint
- 验收检查
- 不做范围

## 与文档的关系

issue 不能替代文档。如果 issue 改变了当前事实，还要同步更新：

- `docs/current-state.md`
- `docs/backend-data-flow.md`
- `docs/roadmap.md`
- `docs/versioning.md`
