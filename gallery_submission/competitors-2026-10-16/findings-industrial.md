# 工业微纳产线智能监控系统系列：公开源码核查

核查日期：2026-10-16。仅静态读取公开仓库，未运行代码、安装依赖、执行构建或测试。

## 归并与快照

以下 6 件 Gallery 作品均关联同一个仓库、同一个 main 分支，因此归并为一个项目核查：

- 工业微纳产线智能监控系统：https://gallery.developer.huaweicloud.com/gallery/005ff0640a800000
- V2：https://gallery.developer.huaweicloud.com/gallery/005ffc92d1c00000
- V3：https://gallery.developer.huaweicloud.com/gallery/0060044528c00000
- V3.1：https://gallery.developer.huaweicloud.com/gallery/00600da42e000000
- V4：https://gallery.developer.huaweicloud.com/gallery/006104dfae000000
- V6：https://gallery.developer.huaweicloud.com/gallery/0061538f14000000

归属依据：本次清单 repositories.json 中均为“码道高校教学合作计划（上海理工大学）”。

仓库：https://gitcode.com/gcw_12bv1DxS/industrial-monitor-system

快照 SHA：`5792c357e018c9eb16687467ed6ea93f0921ee8f`。

提交时间：2026-10-15 21:48:22 +08:00。

提交信息：`refactor(V6+): 多维度优化 — UI/Bug/移动端/性能/功能/构建`。

技术栈：Vue 3、TypeScript、Vite、Pinia、Vue Router、ECharts、Axios、dayjs。公开目录未见后端服务。

## 核心结论

这是具备实际前端计算和交互能力的工业监控演示系统。数据来自随机模拟；公开快照未实现真实传感器、产线设备或盘古模型接入。不能将其等同于只有静态截图的空页面，也不能将其作为真实产线监控闭环。

## 数据从哪里来

- `src/stores/index.ts:15-22`：设备、故障、KPI、产量、能耗、良率、工艺参数全部由 `src/utils/mockData.ts` 的生成函数初始化。
- `src/stores/index.ts:84-109`：`startRealTimeSimulation()` 每 3 秒用 `Math.random()` 修改温度、电压、气体流量和 OEE，并在 store 创建时启动。
- `src/views/EnergyAnalysis.vue:35-48`：`simulateLive()` 用理论功率乘以随机扰动，模拟“实时实际功率”，每 2 秒更新。
- `src/components/ParamPanel.vue:30`：界面本身注明“模拟传感器输入”。
- `src/api/request.ts` 仅有 Axios 实例与拦截器；源码未见业务页面导入或调用它。`src/utils/config.ts` 定义 API 和 WebSocket 环境变量，但未见 WebSocket、MQTT、Modbus、OPC UA 或串口接入实现。

## 已有实际计算逻辑

1. `src/utils/physics.ts`：`calcTheoreticalPower()` 实际计算 `800 + 2.5×(T-25) + 1.8×(V-220)`；`isEnergyAnomaly()` 以实际与理论功率偏差超过 5% 判异常。这里是真实的规则计算，但输入为模拟值；系数在代码中固定。
2. `src/utils/spc.ts`：`linearRegression()` 实际计算斜率、截距、相关系数和 R²；`analyzeYieldData()` 比较温度、气流和射频功率与良率的相关性；`checkWindow()` 做工艺窗口阈值检查，`generateOptimizationAdvice()` 按回归斜率提出参数调整。`src/views/YieldAnalysis.vue` 实际调用这些函数；分析对象仍为生成数据。
3. `src/utils/reportGenerator.ts`：`generateReport()` 对传入状态计算设备数量、故障数、平均修复时间及平均良率，生成 Markdown 日报；有 Blob 下载与浏览器打印逻辑。
4. 设备拓扑、图表、故障详情、数字孪生/移动端及演示流程有对应组件。`triggerFault()` / `clearFault()` 修改前端内存状态，未连接设备控制接口。

## AI 与预测实际实现

- `src/utils/aiAnalysis.ts:16`：`generateAIAnalysis(context)` 按页面上下文选择函数；各函数返回固定的分析摘要、风险级别与建议，只有时间戳实时变化。没有模型请求，也没有把当前 store 数据传入分析。
- `src/components/PanguAIPanel.vue:48`：调用上述本地函数展示结果。`CHANGELOG.md`、`DEV_LOG.md` 也明确写为“盘古 AI 分析引擎（模拟）”。
- `src/utils/predictiveMaintenance.ts`：`generateTrendData()` 使用内置设备画像和随机噪声生成趋势；`predictFaultProbability()` 用趋势增量和随机基础分数计算所谓故障概率，随后按固定阈值产生风险等级、维护建议与预测故障时间。未发现训练、模型推理或真实设备历史记录输入。

## 完成度与竞争点

比纯静态展示更完整：有动态状态、图表、基础统计、阈值检测、回归分析、报表与连贯演示流程。其主要优势是工业主题、展示模块数量及可视化表现。

真实接入层尚缺：传感器数据采集、后端存储、设备控制闭环、盘古模型接入、基于真实历史数据的维护预测。版本名称不能作为 6 个独立对手计数，也不能把模拟数据上的计算结果当成真实产线验证。

对 NexoraApp 的启示：展示时应突出真实模型调用、真实用户操作与可复现的应用流程；同时重视演示组织与界面呈现。

## 验证边界

本次结论来自上述公开 SHA 的静态源码追踪。仓库含前端检查脚本和结果文件，本次未运行，也未验证任何硬件或公网环境。没有读取凭证或私人数据。