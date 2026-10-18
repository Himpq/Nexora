# 上海理工大学 Gallery 公开仓库核查：实验迹、科研研发智能服务平台

核查日期：2026-10-16。只读核查公开 Gallery 详情与公开源码；未执行仓库代码、未安装依赖、未运行测试。

## 栏目归属

公开详情接口 `https://gallery.developer.huaweicloud.com/open-web-guest/v1/gallery/works/{ID}` 返回的两件作品均归属“码道高校教学合作计划（上海理工大学）”，school 为“上海理工大学”。

## 实验迹

- Gallery：https://gallery.developer.huaweicloud.com/gallery/005920039b800000
- 仓库：https://gitcode.com/Impossible/data-optimizer
- 分支：main
- 核查快照：`dc36aa8f6e95ef19014623ba45c9290e2d08bc00`
- 最新提交时间：2026-10-14 18:17:34 +08:00
- 提交信息：`!12 merge feature/ui-workbench-polish into main`
- 技术栈：React、TypeScript、Vite、Plotly；FastAPI、NumPy、pandas、SciPy、openpyxl。

### 已实现证据

1. `backend/app/parsing.py`：`parse_csv_workbook()`、`parse_xlsx_workbook()` 实际解析 CSV / XLSX；`quality.py` 的 `check()` 进行质检。
2. `backend/app/routes_datasets.py`：实际提供上传、切换工作表、选择列、质检、分页、排除、单位转换、单元格编辑、撤销、拟合、CSV/ZIP 导出和 ZIP 导入接口。
3. `backend/app/operations.py`：`save_operations()` 写入操作日志，`replay_worksheet()` 回放操作；包含排除、转换、编辑与撤销实现。
4. `backend/app/fitting.py`：`fit_linear()` 实际调用 `np.polyfit()`，计算斜率、截距、R²、RMSE；`diagnose_residuals()` 按残差阈值定位疑似异常。
5. `backend/app/repro.py`：`validate_hashes()`、`recompute_worksheet()`、`compare_worksheet()` 验证复现包，回放后重算并对照数值和状态。
6. `frontend/src/components/ExportPanel.tsx`：`generatePng()` 调用 Plotly 导图，`handleDownloadHtmlReport()` 构造 HTML 报告；CSV / ZIP 下载实际连接后端。
7. `backend/tests/test_stage5_export_repro.py`、`backend/tests/test_cell_edit.py`：包含导出导入一致性、文件篡改、路径穿越、编辑、撤销和复现等具体测试。

### 完成度判断

实质功能较完整，形成“导入—质检—修正—拟合—导出—复现”的单场景闭环。主要场景是温度传感器标定与线性拟合。公开代码未见 LLM / Agent 服务链路。Gallery 说明当前本地运行、尚未部署公网。仓库自报历史测试和浏览器验收有对应资料，但本次未复跑。

与 NexoraApp 的竞争点：明确的实验场景和可直接演示的操作闭环，容易说明实际价值；产品范围集中在线性实验分析。

## 科研研发智能服务平台

- Gallery：https://gallery.developer.huaweicloud.com/gallery/004f49c457400000
- 仓库：https://gitcode.com/gcw_r0dd0oOO/sci-rd-platform
- 分支：master
- 核查快照：`9ac24df17e9a0a8a65738d432a9391f2b9459569`
- 最新提交时间：2026-10-01 21:34:24 +08:00
- 提交信息：`Initial commit: SciR&D Platform`
- 技术栈：React、TypeScript、Vite、Tailwind、Recharts、lucide-react。

### 已实现证据

提供总览、Agent 调度、文献 RAG、数据分析、代码辅助、团队知识管理等前端页面；支持页面切换、选项切换、静态数据筛选及图表展示。

### 核心功能未实现证据

1. `src/pages/CodeAssistant.tsx:22`：`handleGenerate()` 仅执行 `setGenerated(true)`；第 6 行导入静态 `sampleCode`，结果区域使用该静态代码；运行测试、复制、下载按钮没有对应处理器。
2. `src/pages/LiteratureRAG.tsx:33`：拖入文件只执行 `preventDefault()` 和拖拽状态修改，未读取或上传文件；文献、检索结果及知识图谱来自 `src/data/literatureData.ts`。
3. `src/pages/AgentOrchestration.tsx:6`：Agent、队列、日志及流程图来自 `src/data/agentData.ts`；运行指标为内置数据。
4. `src/pages/DataAnalysis.tsx:46`：上传按钮未绑定文件处理器；图表与统计来自 `src/data/analysisData.ts`，其中散点坐标使用 `Math.random()`。
5. 仓库结构仅含前端及静态数据，未发现后端服务或模型、检索、调度接口请求。Gallery 描述本身也明确数据层提供 Mock 数据。

### 完成度判断

公开快照属于前端界面原型；Agent 调度、RAG 检索、智能代码生成和真实数据分析服务尚未在公开源码实现。界面模块覆盖面较广，主要竞争点是展示观感及科研平台定位。

## 核查范围

本次基于公开源码静态核查，不执行第三方代码，不安装依赖，不运行构建或测试。未验证其演示环境的运行状态。结论对应上述 SHA；后续仓库更新需重新核对。