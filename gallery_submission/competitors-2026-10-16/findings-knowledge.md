# 上海理工大学 Gallery 对手仓库核查

核查日期：2026-10-16。仅查看公开页面与公开仓库源码，未执行仓库代码、安装依赖或读取凭证。

## 探源（TerraWander）

额外线索：该项目不在本次学校筛选后的 96 项 Gallery 清单中，不计入排除 NexoraApp 后的 95 项对手统计。以下仅保留公开仓库的补充核查结果。

- 仓库：https://gitcode.com/gcw_atHHQlTN/TerraWander
- 分支：main
- 提交：7f9297f2bd101453a0eb3caebc5362953130c891
- README 明确标注“2026华为开发者大赛 上海理工大学参赛作品”。此次未从 Gallery 详情独立核实学校归属。
- 文档介绍：点击中国地图省份，进入场景与 NPC 对话，了解家乡景点、民俗与历史。宣称技术为 HTML、CSS、原生 JavaScript，使用华为云码道开发。
- 实际公开文件只有 README.md。文档列出的 index.html、assets/ 未出现在当前 main 分支，在线演示仍是待部署占位文字。
- 判断：当前公开仓库只有项目说明，无法核验地图、对话和文化探索功能。题材与演示方式有比赛展示潜力，现阶段公开完成度证据较弱。

源码说明：https://gitcode.com/gcw_atHHQlTN/TerraWander/blob/main/README.md

## 大学生知识管理与反思平台

- Gallery：https://gallery.developer.huaweicloud.com/gallery/005d803743400000
- 公开详情接口：https://gallery.developer.huaweicloud.com/open-web-guest/v1/gallery/works/005d803743400000
- 仓库：https://gitcode.com/jbvhuhv/knowledge-reflection-platform
- 分支：main
- 提交：c689763672a74bfa132d57c3ade7c004ba0db13c
- Gallery 公开接口返回学校为上海理工大学，栏目为“码道高校教学合作计划（上海理工大学）”。

### 实现证据

- 笔记抽取与建图：backend/app/services/extraction_service.py 的 extract_and_build_graph 实现笔记状态更新、AI 抽取建图、结果统计与失败记录；file_parser.py 实现 Markdown、TXT、PDF、Word 解析；ocr_service.py 接入视觉模型图片文字识别。
- 主动复习与评分：backend/app/services/reflection_service.py 的 generate_questions 按掌握度低于 60%、超过 7 天未复习筛选知识点；compute_mastery_weights 实现时间衰减与难度加权的掌握度融合；evaluate_answer 有答案评估与重复提交处理。
- 可对话分身：backend/app/services/avatar_service.py 的 stream_answer 同时查询向量检索与关键词检索，根据阈值选择知识命中；无合格命中时拒答，有命中则构建来源与上下文并流式输出。backend/app/services/graph/vector.py 实现 Neo4j 向量检索和用户隔离过滤。
- 社区与克隆：backend/app/api/v1/endpoints/community.py 包含社区图谱、互动及克隆相关实现。frontend/src/views/community、graph、notes、reflection、avatar、dashboard 均有对应页面。
- 成长反馈：backend/app/services/pet_service.py 和 frontend/src/views/dashboard 有宠物、认知花园等实现。

关键源码链接：

- https://gitcode.com/jbvhuhv/knowledge-reflection-platform/blob/main/backend/app/services/extraction_service.py
- https://gitcode.com/jbvhuhv/knowledge-reflection-platform/blob/main/backend/app/services/reflection_service.py
- https://gitcode.com/jbvhuhv/knowledge-reflection-platform/blob/main/backend/app/services/avatar_service.py
- https://gitcode.com/jbvhuhv/knowledge-reflection-platform/blob/main/backend/app/services/graph/vector.py
- https://gitcode.com/jbvhuhv/knowledge-reflection-platform/blob/main/backend/app/api/v1/endpoints/community.py

### 技术栈与完成度

- 前端：Vue 3、Vite、Pinia、Element Plus、ECharts。
- 后端：FastAPI、SQLAlchemy；Neo4j 知识图谱与向量检索；支持华为云 MaaS 和 OpenAI 兼容模型端点。
- 仓库包含完整前后端、部署文件、10 张界面截图、演示视频和测试源码。backend/tests 中静态统计有 239 个测试函数；未执行测试。Gallery 所写“238 项通过”属于作者的测试结果声明。
- 仓库公开在线地址 http://154.94.239.47 本次只读请求返回 HTTP 200，未登录、未操作业务功能。
- 与 NexoraApp 的重合点：知识整理、知识图谱、基于知识的问答。该项目的学习场景、复习评分、知识分享形成较集中展示链路，属于更直接的对手。
- NexoraApp 的展示建议：围绕已实现的鸿蒙与 Android 体验、实际使用场景和跨端能力说明差异，并准备稳定、连续的演示流程。

### 核查边界

上述功能已找到对应源码与页面，不能将其运行稳定性、AI 效果或作者声明的测试通过数量视为本次实测结果。公开源码和展示材料足以说明该项目已超出概念说明阶段。
