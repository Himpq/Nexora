# NexoraApp Android 打包指南 & 踩坑记录

> 本文档记录了将鸿蒙 ArkUI 应用 NexoraApp 通过 ArkUI-X 跨平台框架打包为 Android APK 的完整流程、环境配置、踩坑经验及已知问题。

---

## 一、项目概述

- **源工程**：`F:\Code\AI\ChatDB\NexoraApp\`（HarmonyOS NEXT API 26 原生工程）
- **目标工程**：`F:\Code\AI\ChatDB\NexoraApp_Android\`（ArkUI-X 跨平台工程）
- **ArkUI-X SDK 版本**：26.0.0.28 Beta2（API 26）
- **产物**：`app-release.apk`（约 46 MB，arm64-v8a）

### 关于直接用 DevEco 新建 ArkUI-X 项目

**推荐做法**：下次直接在 DevEco Studio 中通过 `File → New → Create Project → ArkUI-X` 新建跨平台项目，而非手动从鸿蒙工程迁移。原因：

1. DevEco 会自动生成正确的 `.arkui-x/` 目录结构、`hvigorfile.ts`、`build-profile.json5` 等配置
2. `MainActivity.java` 中的 `setInstanceName` 格式会自动填好（这是本次最大的坑）
3. `MyApplication.java`、`AndroidManifest.xml`、Gradle 配置全部自动就绪
4. 省去手动替换 packageName、appName、instanceName 等模板变量的工作

如果必须从现有鸿蒙工程迁移，则按下方流程操作。

---

## 二、环境配置

### 2.1 所需 SDK / 工具

| 工具 | 路径 | 说明 |
|------|------|------|
| ArkUI-X SDK | `G:\Temp\Huawei\SDK\ArkUI_X_SDK\26.0.0\arkui-x\` | 版本 26.0.0.28 Beta2 |
| OpenHarmony SDK | `G:\Temp\Huawei\SDK\OpenHarmonySDK\26.0.0\` | 含 `ets/` + `licenses/`，ace 工具链期望 `sdk/<version>/ets/` 结构 |
| Android SDK | `F:\Code\Env\AndroidSDK\` | API 34+ |
| JDK 21 | `F:\Code\Env\JDK21\` | JAVA_HOME 指向此目录（不是 bin 子目录） |
| DevEco Studio | `F:\Code\Program\DevEco Studio\` | 提供 hvigor、ohpm 工具链 |
| Node.js | 系统已安装 | ace CLI 依赖 |

### 2.2 Gradle 代理

本机 `~/.gradle/gradle.properties` 代理端口必须与实际代理一致：

```properties
systemProp.http.proxyPort=14444
systemProp.https.proxyPort=14444
```

### 2.3 Gradle Wrapper

模板要求 `gradle-8.4-bin.zip`，但 `repo.huaweicloud.com` 可能连接被拒。可改用本地已有的 `gradle-8.14-all.zip`，在 `gradle-wrapper.properties` 中用 `file:///` 协议指向本地路径。

---

## 三、从鸿蒙工程迁移流程

### 3.1 创建工程骨架

1. 创建 `NexoraApp_Android/` 目录
2. 从 ArkUI-X SDK 模板拷贝 `.arkui-x/` 平台目录结构
3. 拷贝原鸿蒙工程的 `entry/src/`、`AppScope/`、`oh-package.json5` 等

### 3.2 配置文件修改

#### hvigorfile.ts（根目录）

```typescript
import { AppTasksForArkUIX } from '@ohos/hvigor-ohos-arkui-x-plugin';
export default {
    tasks: [AppTasksForArkUIX()],
};
```

#### hvigorfile.ts（entry 目录）

```typescript
import { HapTasks } from '@ohos/hvigor-ohos-arkui-x-plugin';
export default {
    tasks: [HapTasks()],
};
```

#### hvigor-config.json5

hvigor plugin 版本需与 DevEco 26 匹配：

```json5
{
    "dependencies": {
        "@ohos/hvigor-ohos-arkui-x-plugin": "4.26.4",
        "@ohos/hvigor-arkui-x-plugin": "6.26.4"
    }
}
```

#### build-profile.json5

```json5
{
    "app": {
        "compileSdkVersion": "26.0.0",
        "compatibleSdkVersion": "26.0.0",
        "runtimeOS": "OpenHarmony"
    }
}
```

#### .arkui-x/arkui-x-config.json5

```json5
{
    "crossplatform": true,
    "modules": ["entry"]
}
```

### 3.3 代码适配

#### 跨平台不兼容 API

| 原鸿蒙 API | 修改为 | 原因 |
|------------|--------|------|
| `AppStorage.SetOrCreate(...)` | `AppStorage.setOrCreate(...)` | 大写 D 不支持跨平台 |
| `@kit.LiveViewKit` | 移除，LiveViewController 改空实现 | HarmonyOS NEXT 独有，ArkUI-X 无对应能力 |
| `window.getMainWindow()` 等 window 配置 | EntryAbility 中移除 | 跨平台由 StageActivity 管理 window |

#### module.json5

- 移除 backup extension（ArkUI-X 不支持）
- `deviceTypes` 从 `["phone"]` 改为 `["default"]`

### 3.4 Android 平台配置

#### MainActivity.java（关键！）

```java
public class MainActivity extends StageActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setInstanceName("cn.himpqblog.nexoraapp:entry:EntryAbility:");
        super.onCreate(savedInstanceState);
    }
}
```

> **setInstanceName 格式必须为 `packageName:moduleName:abilityName:`（注意末尾冒号）**
>
> 这是本次最大的坑。格式错误会导致白屏，日志显示 `can not find module` 和 `stage is nullptr`。

#### AndroidManifest.xml

- `package="cn.himpqblog.nexoraapp"`
- `android:name=".MyApplication"`（指向 StageApplication 子类）
- Activity 声明 `.MainActivity`

#### build.gradle / Gradle Wrapper

- 替换所有 `packageName` → `cn.himpqblog.nexoraapp`
- 替换 `appName` → `NexoraApp`
- `gradle-wrapper.properties` 指向可用的 Gradle 发行版

---

## 四、打包流程

### 4.1 安装依赖

```bash
cd NexoraApp_Android
ohpm install
```

### 4.2 构建 APK

```bash
# 设置 JAVA_HOME（指向 JDK 根目录，非 bin）
set JAVA_HOME=F:\Code\Env\JDK21

# 使用 ace CLI 构建
node "G:\Temp\Huawei\SDK\ArkUI_X_SDK\26.0.0\arkui-x\toolchains\ace_tools\lib\ace_tools.js" build apk --release
```

构建分两步：
1. `ace build bundle`：hvigor 编译 ArkTS → `.abc` 字节码，拷贝到 `assets/arkui-x/entry/`
2. `ace build apk`：Gradle 编译 Java + 打包 APK

产物路径：
```
.arkui-x/android/app/build/outputs/apk/release/app-release.apk
```

### 4.3 安装到设备

```bash
adb install -r app-release.apk
adb shell am start -n cn.himpqblog.nexoraapp/.MainActivity
```

### 4.4 清理重建

修改 Java 代码后，如果 Gradle 缓存导致未重编译：

```bash
# 清理 Gradle build 缓存
cd .arkui-x/android
gradlew :app:clean
# 然后重新 ace build apk
```

---

## 五、踩坑记录

### 坑 1：setInstanceName 格式错误 → 白屏

**现象**：APK 安装后打开白屏，logcat 显示：

```
E Ace: [inner_bundle_info.cpp(777)] can not find module
E Ace: [application.cpp(102)] hapModuleInfo is nullptr, moduleName:
E Ace: [application.cpp(143)] stage is nullptr
```

**根因**：`setInstanceName("EntryAbility")` 格式不正确。StageActivity 会自动追加 instanceId，变成 `"EntryAbility1"`，然后按 `:` 分割解析 bundleName 和 moduleName。只有 `"EntryAbility"` 时无法提取 moduleName。

**正确格式**：`setInstanceName("cn.himpqblog.nexoraapp:entry:EntryAbility:")`

ace 模板中 `ArkUIInstanceName` 占位符会被替换为 `packageName:entry:EntryAbility:` 格式。手动迁移时容易遗漏。

**排查方法**：反编译 `arkui_android_adapter.jar` 中的 `StageActivity.class`，查看 `setInstanceName` 方法的字节码逻辑。

### 坑 2：hvigor plugin 版本不兼容

**现象**：模板中 hvigor plugin 版本为 4.1.2/3.1.1，与 DevEco 26 不兼容。

**解决**：改为 `6.26.4`（arkui-x-plugin）/ `4.26.4`（ohos-arkui-x-plugin）。

### 坑 3：OpenHarmony SDK 目录结构

**现象**：ace 工具链期望 `sdk/<version>/ets/` 结构，但 DevEco Studio 26 的新 SDK 管理模式没有版本号子目录。

**解决**：通过 DevEco SDK Manager 正式安装到 `G:\Temp\Huawei\SDK\OpenHarmonySDK\`，确保含 `26.0.0/ets/` + `licenses/`。

### 坑 4：Gradle 下载失败

**现象**：`repo.huaweicloud.com` 连接被拒，`gradle-8.4-bin.zip` 下载失败。

**解决**：改用本地已有的 `gradle-8.14-all.zip`，`gradle-wrapper.properties` 中用 `file:///` 协议指向本地路径。

### 坑 5：Gradle 代理端口不匹配

**现象**：Gradle 下载依赖超时。

**根因**：`~/.gradle/gradle.properties` 中代理端口为 7890，但实际代理端口为 14444。

**解决**：修正 `gradle.properties` 中的 `proxyPort`。

### 坑 6：AppStorage.SetOrCreate 跨平台不兼容

**现象**：ArkTS 编译报错。

**根因**：`SetOrCreate`（大写 D）是 HarmonyOS 专属 API，跨平台需用小写 `setOrCreate`。

### 坑 7：LiveViewKit 不可用

**现象**：`@kit.LiveViewKit` 导入失败。

**根因**：实况窗/灵动岛是 HarmonyOS NEXT 独有能力，ArkUI-X 无对应实现。

**解决**：`LiveViewController` 改为空实现，移除 `@kit.LiveViewKit` 和 `wantAgent` 导入。

### 坑 8："No need to start creating abilityDelegate" 误导

**现象**：logcat 出现 `StageActivity: No need to start creating abilityDelegate`。

**说明**：这是**正常日志**，不是错误。该方法（`getIntentToCreateDelegator`）仅用于 test/unittest 场景，普通启动不走此路径。真正的 Ability 创建通过 `dispatchOnCreate` 完成。

### 坑 9："File does not exist: arkui-x.json" 误导

**现象**：logcat 出现 `StageApplicationDelegate: File does not exist: .../files/arkui-x/arkui-x.json`。

**说明**：这是 `isDynamicUpdateLibs` 方法检查动态库更新时的正常日志。首次启动 files 目录无此文件，返回 false（不动态更新），不影响功能。

### 坑 10："read or write data err: arkui-x/arkui-x.json/resources" 误导

**现象**：logcat 出现 `StageApplicationDelegate: read or write data err: arkui-x/arkui-x.json/resources`。

**说明**：`copyAllModuleResources` 将 `arkui-x` 目录下每个条目当作模块目录，尝试拷贝 `<item>/resources`。但 `arkui-x.json` 是文件不是目录，所以 `arkui-x.json/resources` 路径不存在。这是 SDK 的已知行为，不影响功能——`arkui-x.json` 通过 `SetAssetsFileRelativePaths` 直接从 assets 读取。

---

## 六、APK 结构

```
app-release.apk
├── assets/arkui-x/
│   ├── arkui-x.json              # SDK 信息
│   ├── entry/
│   │   ├── module.json           # 模块配置
│   │   ├── pkgContextInfo.json   # 包上下文
│   │   ├── resources.index       # 资源索引
│   │   └── ets/
│   │       └── modules.abc       # 编译后的 ArkTS 字节码
│   └── systemres/                # 系统资源
├── lib/arm64-v8a/
│   ├── libarkui_android.so       # ArkUI 引擎
│   ├── libhilog.so               # 日志
│   └── ...                       # 其他 native 库
└── AndroidManifest.xml
```

---

## 七、日志排查技巧

### 7.1 关键日志标签

| 标签 | 说明 |
|------|------|
| `StageApplication` | Application 生命周期 |
| `StageApplicationDelegate` | 资源拷贝、初始化 |
| `StageActivity` | Activity 生命周期 |
| `StageActivityDelegate` | Ability dispatch |
| `Ace` | ArkUI 引擎（C++ 层） |
| `JSApp` | JS 运行时 |
| `HiHelloWorld` | 自定义日志（MainActivity/MyApplication） |

### 7.2 常用排查命令

```bash
# 清空日志并启动应用
adb shell am force-stop cn.himpqblog.nexoraapp
adb logcat -c
adb shell am start -n cn.himpqblog.nexoraapp/.MainActivity

# 查看应用进程日志
adb logcat -d --pid=$(adb shell pidof cn.himpqblog.nexoraapp)

# 过滤关键标签
adb logcat -d -s "StageActivity:*" "StageActivityDelegate:*" "Ace:*" "HiHelloWorld:*"
```

### 7.3 白屏排查思路

1. 确认 `MyApplication onCreate` 和 `MainActivity` 日志出现
2. 确认 `StageApplicationDelegate: init application.` 后无 fatal error
3. 确认 `Ace: Launch application` 后模块加载成功
4. 确认 `Ace: HandleDispatchOnCreate called, instanceName: xxx` 中 instanceName 格式正确
5. 确认无 `can not find module` / `stage is nullptr` / `hapModuleInfo is nullptr`
6. 确认 `UIContentImpl::ProcessPointerEvent` 等渲染日志出现

---

## 八、已修复问题与解决方案

### Bug 1：turnIndicator 高亮横线在可视区域外（已修复）

**现象**：50 轮对话时，滚动到最新第 1 条用户消息，`TurnIndicatorPanel` 未显示任何高亮。滚动到最新第 3 条时高亮正常。

**根因**：`TurnIndicatorPanel` 的横线面板 `Scroll` 最多显示 8 条横线（`PANEL_MAX_LINES = 8`），但未绑定 `Scroller`，不会自动滚动到 `activeIndex` 位置。当 `activeIndex > 7` 时，高亮横线在面板可视区域外。

**解决**：
- `TurnIndicatorPanel.ets`：给横线面板 `Scroll` 绑定 `lineScroller: Scroller`
- `activeIndex` 添加 `@Watch('onActiveIndexChange')`，变化时调用 `scrollToIndex(activeIndex, false, ScrollAlign.CENTER)` 自动滚动到高亮位置

### Bug 2：状态栏颜色不适配 + 状态栏文字不可见（已修复）

**现象**：状态栏纯黑或纯白，文字与背景同色不可见。

**根因**：迁移时误删 `EntryAbility.applyWindowChrome` 中的 `setWindowSystemBarProperties` 调用。该 API 在 ArkTS 层面设置状态栏/导航栏背景色对齐页面底色。但 `statusBarContentColor` 参数不映射到 Android 的深色文字图标 flag。

**解决**：
- `EntryAbility.ets`：恢复 `applyWindowChrome`，调用 `setWindowSystemBarProperties` 设置状态栏/导航栏背景色（`#F4F5F9` 浅色 / `#0E1015` 深色）
- `MainActivity.java`：补充 `SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR`，让状态栏文字图标为深色（在浅色背景上可见）

### Bug 3：键盘弹出时输入框向上偏移挤压内容（已修复）

**现象**：键盘弹出后，输入框向上偏移到标题栏下方，挤压聊天内容区域（`Top-Header-Input-空-输入法`），而非整体 resize（`Top-Header-Ctx-Input-输入法`）。

**根因**：ArkUI-X 的 `WindowView`（SurfaceView）不响应 Android `adjustResize`——键盘弹出前后 `surfaceChanged` 尺寸不变（`w=1080 h=2235`）。因此 `setKeyboardAvoidMode(RESIZE)` 无法生效，ArkUI 引擎退化为 OFFSET 模式（输入框单独上移）。

**前置条件**：ArkUI-X WindowView 需要 AndroidX 库才能正确处理 WindowInsets。若缺少 AndroidX 依赖，logcat 显示 `WindowViewCommon: AndroidX is not available.`，WindowView 无法接收 insets 回调。

**解决**（三层配合）：
1. **build.gradle**：添加 `implementation 'androidx.core:core:1.10.0'`
2. **gradle.properties**：`android.useAndroidX=true` + `android.enableJetifier=true`
3. **EntryAbility.ets**：`setKeyboardAvoidMode(KeyboardAvoid.NONE)` — 让 ArkUI 引擎不干预键盘避让，避免双重偏移
4. **MainActivity.java**：`setOnApplyWindowInsetsListener` 监听系统栏+键盘 insets，手动设置 `contentView` 的 padding（top=状态栏高度，bottom=导航栏+键盘高度），让 SurfaceView 随 padding 缩小，实现等价 adjustResize 效果。`contentView` 背景设为白色，padding 区域不露黑边。

---

## 九、快速重建清单

如果需要从头重建，按以下顺序操作：

- [ ] DevEco Studio 新建 ArkUI-X 项目（推荐）或手动创建骨架
- [ ] 拷贝 ArkTS 代码、resources、AppScope
- [ ] 适配跨平台不兼容 API（AppStorage、LiveViewKit、window 配置等）
- [ ] 配置 hvigorfile.ts（AppTasksForArkUIX / HapTasks）
- [ ] 配置 build-profile.json5（compileSdkVersion、runtimeOS）
- [ ] 配置 hvigor-config.json5（plugin 版本 6.26.4 / 4.26.4）
- [ ] 配置 .arkui-x/arkui-x-config.json5（crossplatform: true）
- [ ] 配置 MainActivity.java（setInstanceName 格式 `pkg:module:ability:` + 深色状态栏图标 + 手动键盘 resize）
- [ ] 配置 MyApplication.java（extends StageApplication）
- [ ] 配置 AndroidManifest.xml
- [ ] 配置 build.gradle（添加 androidx.core 依赖）
- [ ] 配置 gradle.properties（useAndroidX=true）
- [ ] 配置 local.properties（sdk.dir）
- [ ] 配置 gradle-wrapper.properties（可用 Gradle 版本）
- [ ] 恢复 EntryAbility.applyWindowChrome（setKeyboardAvoidMode(NONE) + setWindowSystemBarProperties）
- [ ] ohpm install
- [ ] ace build apk --release
- [ ] adb install -r app-release.apk