# 上海理工大学展览馆公开仓库调查

核查日期：2026-10-16。

## 范围与结果

学校筛选页共 8 页、96 条作品，其中 1 条为 NexoraApp。其他 95 条作品全部取得公开仓库地址，归并后为 69 个独立仓库。完整标题、Gallery 链接、仓库和关联分支见 [repositories.md](repositories.md)，结构化数据见 [repositories.json](repositories.json)。

这些是学校展览馆的作品记录，含历史作品和重复版本，不能直接按 95 支本届参赛队伍计算。例如工业监控有 6 条、tank-battle 有 5 条、同一个贪吃蛇仓库关联 13 条作品。

清单来自公开页面及公开详情接口；重点仓库核查使用公开源码快照。未安装依赖或执行第三方代码，没有验证对方宣称的测试通过数量。

## 优先关注

| 作品与仓库 | 源码观察 | 对 Nexora 的竞争点 |
| --- | --- | --- |
| [大学生知识管理与反思平台](https://gitcode.com/jbvhuhv/knowledge-reflection-platform) | Vue 3 + FastAPI + Neo4j；有文档抽取建图、复习评分、向量与关键词检索、知识分身、分享与成长反馈的实现。仓库有截图、视频与测试源码。 | 最接近我们的知识和学习方向。学习场景集中，上传到复习反馈的演示流程完整。 |
| [晚安同学](https://gitcode.com/gcw_0RSm1nG1/smapp) | uni-app / Vue 3 + Express / Prisma；有睡眠记录、统计、AI 周报、计划、打卡及数据持久化。Gallery 的 w4gal1 与本次默认分支快照文件一致。 | 移动产品形态完整，围绕睡眠改善讲清一条使用流程。 |
| [实验迹](https://gitcode.com/Impossible/data-optimizer) | React / TypeScript / Plotly + FastAPI；有 CSV/XLSX 质检、编辑、拟合、导出和 ZIP 操作回放、重算一致性核对。 | 实验数据处理场景具体，工程和可复现性容易通过演示证明。 |
| [ADDW-T2 驾驶员分心检测](https://gitcode.com/gcw_qUwR89DO/ADDW-T2) | 有 VideoMAE 训练、OpenCV 视频分窗、模型推理和时序阈值检测代码。模型权重采用 LFS，本次未下载。作者的实验成绩未独立复现。 | 专业题目和算法深度有竞争力，不能归入界面原型。 |
| [校园互助平台](https://gitcode.com/Doggie/campus-help) | PHP + SQLite；发帖、私信、解决登记、归档、举报及管理均有真实数据读写。 | 校园需求容易说明，演示操作直接，技术方案较简单。 |

## 主要是展示原型的项目

| 作品与仓库 | 判断依据 |
| --- | --- |
| [科研研发智能服务平台](https://gitcode.com/gcw_r0dd0oOO/sci-rd-platform) | 公开快照只有前端和静态数据。生成代码按钮只切换显示状态；文献拖入未读取或上传文件；Agent 编排使用预置任务与日志。尚未看到真实 Agent、RAG 或代码生成服务。 |
| [工业微纳产线智能监控系统](https://gitcode.com/gcw_12bv1DxS/industrial-monitor-system) | 有功耗公式、偏差阈值、回归和报表计算；设备数据来自 mockData 与定时随机扰动。AI 返回固定文案，预测使用虚拟设备画像和手写规则，未见传感器或模型服务接入。六个作品记录归并为一个仓库。 |
| [方言令](https://gitcode.com/wxwbgl/fangyan-ling) | Gallery 详情明确说明为纯前端，无后端，录音与 AI 识别为模拟体验；本项只核对公开说明，没有深入源码。 |

## 对 Nexora 的建议

最值得研究的是知识管理平台、晚安同学、实验迹和 ADDW-T2：它们分别在学习闭环、移动产品完整度、具体专业场景和模型算法上有明确实现。仅比较功能数量，难以体现 Nexora 的优势。

建议把现有能力组织成一段连贯演示：选择学习问题，结合知识内容提问，使用学习工作区，再展示手机与电脑协同。重点说明 HarmonyOS 与 Android 两端的实际体验和平台适配，准备可运行安装包、演示视频与对应的码道开发记录。

下一轮若继续深入，应先体验与 Nexora 最接近的知识管理平台和晚安同学，并使用同一组场景比较。当前报告完成的是仓库清单和源码调查。

## 核查记录

- [完整仓库清单](repositories.md)
- [知识管理平台源码证据](findings-knowledge.md)
- [实验迹与科研平台源码证据](findings-data.md)
- [晚安同学与校园互助源码证据](findings-apps.md)
- [工业监控源码证据](findings-industrial.md)
- [驾驶员检测源码证据](findings-driver.md)
