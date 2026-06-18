# 路线图

当前版本 `1.1.0`。下一阶段先稳契约、状态和缺口，UI/UX 最后。

## 顺序

1. 稳定 service contract：对照真实后端确认每个 `src/services/*Service.ts`，保留 URL、payload、header、错误、stream parsing 测试；不一致先改 `backend-data-flow.md`。
2. 统一运行状态：各屏统一 loading、empty、error、retry、updating、cancelled；username session 继续保持简单。
3. 补产品缺口：真实章节边界后再接章节完成 UI，`bookinfo` / `bookdetail` 先做轻量可读格式化，聊天历史和 retry 稳定后再扩。
4. 维护文档与版本：事实写 `current-state.md`，路径写 `backend-data-flow.md`，顺序写本文件，版本和构建号写 `versioning.md`；`package.json`、`package-lock.json`、`app.json` 保持一致。
5. UI/UX 最后：再统一 Dashboard、Courses、Books、Chat、Admin、Feed、Settings，并做阅读器、聊天、Admin / Feed 和 Android 真机验证。

## 历史

旧切片已移到 `archive/slices/`，只用于追溯，不指导当前开发。
