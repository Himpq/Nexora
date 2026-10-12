# NexoraLearning 本地插件

该插件把 NexoraLearning 的课程页面嵌入 NexoraCode，并给本地 Agent 注册 `nexoralearning_list_lectures` 工具。

## 启用

1. 启动本地 NexoraLearning 服务。默认地址为 `http://127.0.0.1:5001`；项目入口在仓库根目录的 `NexoraLearning/main.py`。
2. 启动 NexoraCode，打开「设置 → 插件」，启用 NexoraLearning 并保存服务地址、用户名。
3. 重启 NexoraCode。侧栏出现 NexoraLearning 入口后即可打开课程页面；本地 Agent 可在用户确认网络操作后查询课程。

插件只把工具暴露给本地 Agent。NexoraLearning 服务及其依赖仍由 NexoraLearning 项目管理。
