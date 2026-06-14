# 版本与构建号

## 用户可见版本

- 当前值：`1.1.0`
- 来源：`package.json`、`package-lock.json`、`app.json`
- `src/config/appInfo.ts` 读取 `package.json.version`，设置页展示它

规则：

- 只有用户可见发布线变化时才升级。
- 保持语义化：补丁=修复/文档，小版本=能力或体验新增，大版本=破坏性变化。
- 不把它当构建计数器。

建议节奏：

- `1.1.x`：当前稳定、文档收敛和小修。
- `1.2.0`：UI/UX 统一、阅读器和聊天体验打磨。
- `1.3.0`：学习闭环硬化和 Android 真机稳定性。
- `1.4.0`：Feed/Admin 等可见能力扩展。
- `2.0.0`：产品契约或导航模型的破坏性变化。

## 平台构建号

- Android：`android.versionCode`
- iOS：`ios.buildNumber`
- 当前初始值：Android `1`，iOS `1`

规则：

- 每次生成新的可安装包都递增对应平台构建号。
- 同一平台不复用旧构建号。
- Android 和 iOS 不要求同步。
- hotfix 重新出包时，即使 `version` 不变，也必须递增构建号。

## 发布前

1. 确认 `current-state.md` 反映当前事实。
2. 确认 `roadmap.md` 指向下一步。
3. 运行 `npm run typecheck` 和 `npm run test:unit`。
4. 同步 `package.json`、`package-lock.json`、`app.json` 的 version。
5. 递增对应平台构建号。

## 备注

- `app.json` 目前是构建号来源；以后接 EAS Build 时可改为远端 version source。
- `archive/slices/` 里的编号只用于追溯，不用来判断当前版本。
- 不要用版本号掩盖未完成能力；部分接入的能力写进 `current-state.md` 或 `roadmap.md`。
