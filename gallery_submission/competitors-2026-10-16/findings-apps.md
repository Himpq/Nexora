# 晚安同学与校园互助平台源码核查

核查日期：2026-10-16。只读取公开仓库，未安装依赖、运行第三方代码或登录体验账号。

## 晚安同学

- [作品页](https://gallery.developer.huaweicloud.com/gallery/005eb7d279000000)
- [仓库](https://gitcode.com/gcw_0RSm1nG1/smapp)
- Gallery 关联分支：`w4gal1`。本次还核对了默认分支与 `w4gal1` 的文件差异，差异为空。
- 核查默认分支提交：`d9643c4754c75d8f48380d34095dab1cb4a50403`，2026-10-15。

前端为 uni-app、Vue 3、Pinia、Vite，包含 H5 与微信小程序构建配置。后端为 Express、Prisma、Zod。公开源码中有睡眠记录、影响因素、统计、作息计划、打卡、提醒、课程表和周报等模块。

`server/prisma/schema.prisma` 定义 SleepRecord、SleepFactor、Plan、PlanTask、PlanCheckin、Reminder、WeeklyReport 等数据模型。`server/src/routes/plans.js`、`routes/campus.js` 提供计划、打卡、课程表与建议接口。`server/src/services/report.js` 的 generateAndSave() 读取一周数据，计算统计，调用周报生成，再保存 WeeklyReport。`server/src/ai/pipeline.js` 的 generateReportNarrative() 调用模型网关，并验证输出中的数值是否来自已有统计；模型不可用时会返回标为 degraded 的模板报告。

结论：核心业务有真实前后端实现，是本轮应重点关注的移动产品。睡眠记录、统计、建议、计划和打卡形成集中的演示流程。与 Nexora 的直接功能重合有限，但产品场景与交付完整度具有竞争力。

仓库有 client/tests、server/tests 和 codearts_proof 目录；只确认文件存在，没有读取开发对话或证据截图，也未执行测试。release/video 当前只有 .gitkeep，不能据此声称已经交付演示视频。公开文案中的测试通过数量未在本次验证。

## 校园互助平台

- [作品页](https://gallery.developer.huaweicloud.com/gallery/00611c791ec00000)
- [仓库](https://gitcode.com/Doggie/campus-help)
- Gallery 关联分支：`main`。
- 核查提交：`8df373ebaaa68521ee03bacaad4121468845c7ce`，2026-10-14。

技术栈为 PHP、SQLite、原生 HTML/CSS/JavaScript。源码中可看到发帖、帖子详情、私信、解决登记、举报管理、用户管理、意见箱、榜单和热力图页面。

`pages/publish.php` 实际向 posts 表写入帖子；`pages/post.php` 查询帖子与参与者，限制归档后的访问，并处理解决登记和消息；`pages/messages.php` 查询会话及未读数；`pages/admin.php` 查询举报并将帖子状态修改为 deleted。以上流程有持久化数据操作，不是纯静态界面。

结论：校园互助场景清晰，业务代码形成发帖、联系、解决、归档的流程。与 Nexora 的 AI 能力重合较少，但需求贴合与现场演示更容易讲清。未运行服务或进行完整功能测试。
