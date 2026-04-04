# NexoraCode 自绘窗口实践备忘（Windows）

## 一、这类窗口最容易踩的坑

1. 标题栏双轨冲突
- 一边走 Win32 `WM_NCHITTEST`，一边走页面 JS 边缘热区，容易互相抢事件。
- 结论：要么以 Win32 为主（NCCALCSIZE + NCHITTEST），要么以 JS 热区为主并明确禁用另一条路径。

2. 只挂顶层 hwnd 不够
- WebView2 实际吃鼠标的常常是子窗口（甚至是后续动态创建的子窗口）。
- 结论：顶层挂钩负责窗口框架与状态，鼠标命中/边缘缩放要考虑子层输入路径。

3. 初始化时序问题
- `pywebviewready`、页面 DOM ready、WinForms 句柄可用不是同一时刻。
- 结论：关键逻辑都要“事件 + 轮询兜底”，且要可重入（幂等）。

4. 最大化状态与 resize 冲突
- 最大化时若边缘热区还在，会出现“看似可拖边缘”的违和行为。
- 结论：最大化时关闭 JS resize 热区（`pointer-events: none` + 事件 guard）。

5. 首帧无标题栏/首帧偏移
- 页面注入慢于窗口显示，会出现短暂空窗或偏移。
- 结论：先 bootstrap 壳页，再导航业务页；并提前注入启动脚本。

6. 误把调试日志当功能
- 日志能证明“装了钩子”，但不代表命中路径正确。
- 结论：日志必须覆盖“seen/hit/passthrough”三种状态，才能定位输入路径。

7. 外网资源超时污染日志
- 背景线程（如 Google Fonts）超时会淹没关键窗口日志。
- 结论：后台网络探测要单项容错，避免线程崩溃刷栈。

## 二、这类窗口的稳定规律

1. 统一状态源
- “是否最大化”必须有单一真值来源，并同步到前端 class（例如 `nc-win-maximized`）。

2. 事件链要短
- 鼠标边缘 -> JS 识别 edge -> `start_window_resize(edge)` -> Win32 `SC_SIZE`。
- 链路越短，越少竞态。

3. 视觉层与输入层解耦
- 标题栏负责视觉和按钮。
- 边缘热区负责 resize/cursor。
- 避免标题栏区域吞掉 top band。

4. 热区参数可调
- 边/角热区应可配置（如边 8px、角 12px），便于适配不同 DPI 与显示器。

5. 功能与降级并存
- 有 pywebview API 时走原生命令。
- API 未就绪时保持静默，不抛异常、不阻塞主流程。

## 三、当前实现建议（运营层面）

1. 开发期保留轻量日志开关
- `NEXORA_WIN_DEBUG`
- `NEXORA_UI_CMD_LOG`
- `NEXORA_HITTEST_TRACE`

2. 发布前关闭高频 trace
- 保留必要告警与错误日志即可，避免性能抖动。

3. 对外网依赖做降级
- 不能依赖可达 `fonts.googleapis.com` 才能运行。

## 四、怎么打包（推荐流程）

### 方案 A：先出可运行目录（推荐）

1. 准备环境
- 使用干净虚拟环境安装依赖：
- `pip install -r requirements.txt`

2. 先本地验证
- `python main.py`

3. 使用 PyInstaller 打包（onedir）
- 建议命令（在 `NexoraCode` 目录执行）：

```powershell
pyinstaller main.py \
  --name NexoraCode \
  --noconfirm \
  --clean \
  --windowed \
  --onedir \
  --collect-all webview \
  --hidden-import webview.platforms.winforms \
  --hidden-import webview.platforms.edgechromium \
  --add-data "config.json;." \
  --add-data "asset_manifest.json;."
```

4. 运行产物
- 目录：`dist/NexoraCode/`
- 入口：`dist/NexoraCode/NexoraCode.exe`

5. 必测清单
- 启动页标题栏按钮
- 主窗与笔记窗拖拽/双击/resize
- 最大化时禁用 resize
- 设置弹窗不与标题栏重叠

### 方案 B：做安装包（给最终用户）

1. 先完成方案 A。
2. 用 Inno Setup / NSIS 将 `dist/NexoraCode` 整目录打包。
3. 安装包内建议附带检查项：
- WebView2 Runtime（若系统无则提示安装）。
- VC++ 运行库（视目标机环境决定）。

## 五、发布注意事项

1. `--onefile` 不推荐优先
- 启动更慢，临时解包路径与权限问题更多。
- 本项目更适合 `--onedir`。

2. WebView2 Runtime 不是 PyInstaller 自动兜底
- 目标机器缺失时，窗口可能无法正常加载。

3. Python.NET/`System` 相关告警
- IDE 静态分析可能提示无法解析 `System`，但在 WinForms 运行环境中可工作。
- 以“真实运行验证”作为最终标准。

4. 签名与杀软
- 未签名 exe 更容易被拦截，正式发布建议做代码签名。

## 六、一句话经验

这类窗口的核心不是“画出标题栏”，而是“谁在真正接收鼠标消息”；把输入路径稳定下来，UI 才会稳定。