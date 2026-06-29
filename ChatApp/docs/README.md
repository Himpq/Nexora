# ChatApp 文档入口

这里是 ChatApp 的中文活文档入口，目标只有三件事：看清当前事实、看清下一步、把历史关进归档。

## 默认阅读顺序

AI 开始开发前只读这 6 个活文档：

1. `current-state.md`：当前真实状态，优先级最高。
2. `architecture.md`：代码边界和模块职责。
3. `backend-data-flow.md`：移动端到后端的真实数据流。
4. `roadmap.md`：下一步顺序，UI/UX 放最后。
5. `versioning.md`：版本号和构建号规则。
6. `agents/domain.md`：领域词汇和 agent 协作口径。

## 按需阅读

- `design/design-system.md`：做 UI/UX 时再看。
- `archive/`：旧切片和历史决策，只在追溯时打开。

## 维护规则

- 当前事实只写 `current-state.md`。
- 后端路径和服务归属只写 `backend-data-flow.md`。
- 下一步顺序只写 `roadmap.md`。
- 版本号、构建号和发版规则只写 `versioning.md`。
- 旧计划、旧切片、旧验收记录只进 `archive/`。

代码和真实后端优先于文档；冲突时先修正文档。
