# 设计系统说明

Nexora 采用统一的**黑白单色（monochrome）设计语言**，与登录页的品牌质感保持一致。整套 UI 由一处 token 驱动，改 token 即可全局联动。

## 设计原则

- 单色为主：纯黑（ink）作为主操作色，白色表面，灰阶分层。克制使用饱和色，仅在反馈状态（成功/警告/危险）出现。
- 层级清楚，间距稳定，移动端文字可读。
- loading / empty / error 状态统一使用 `StateView`。
- 不用装饰性复杂设计掩盖数据问题。
- 设计组件里不放任何 API 逻辑；UI 打磨不得改变 service 边界。

## Tokens

设计 tokens 放在 `src/design/tokens.ts`：

- `colors`：surface（背景/卡片）、border（描边）、text（主/次/弱/反白）、primary（ink 黑主操作）、feedback（success/warning/danger，各带 muted 底色）。
- `spacing`：xs–xxxl 间距阶梯。
- `radius`：sm–xl 与 pill。卡片用 `lg`，胶囊用 `pill`。
- `shadow`：none/sm/md/lg 低对比柔和阴影，作为 style 展开。
- `typography`：display/title/heading/body/bodyStrong/caption/label/overline，含字重、行高、字距。

## 组件

`src/design` 导出统一组件，页面只组合这些：

- `Screen`：页面布局与安全边距，`scroll` 控制滚动。
- `ScreenHeader`：页面标题区（overline + title + subtitle + 右侧操作）。
- `SectionHeader`：区块标题。
- `AppText`：所有文字，按 `variant` / `tone` 取样式。
- `AppButton`：primary（ink 黑）/ secondary / ghost / outline / danger，支持 `size` 与 `fullWidth`。
- `AppCard`：elevated / outlined / muted / flat，圆角 + 柔和阴影。
- `AppBadge`：状态徽标（neutral / solid / muted / success / warning / danger）。
- `AppInput`：统一输入框，聚焦时黑色描边。
- `StateView`：loading / empty / error 状态，带图标槽。

## 规则

- 页面使用 `Screen` + `ScreenHeader`，区块用 `SectionHeader`。
- 卡片保持简单，避免卡片套卡片。
- 命令明确处使用 `AppButton`；状态标签使用 `AppBadge`。
- 导航主题在 `app/AppBootstrap.tsx`（NavigationContainer theme）与 `navigation/MainTabs.tsx`、`navigation/RootNavigator.tsx` 中统一为黑白。
