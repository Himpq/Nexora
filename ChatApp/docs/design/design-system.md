# 设计系统说明

第一阶段目标：

- 层级清楚
- 间距稳定
- 移动端文字可读
- loading / empty / error 状态可用
- 数据闭环跑通前不做装饰性复杂设计

## Tokens

设计 tokens 放在 `src/design/tokens.ts`。

颜色保持克制：

- Primary：主要操作
- Surface：页面和卡片背景
- Text：主文字、次级文字、弱提示
- Feedback：成功、警告、危险

## 组件规则

- 页面布局和安全边距使用 `Screen`。
- loading、empty、error 状态使用 `StateView`。
- 明确命令使用 `AppButton`。
- 卡片保持简单，不要在卡片里再套卡片。
- 设计组件里不要放 API 逻辑。
