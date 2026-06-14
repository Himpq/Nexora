# Nexora ChatApp

Nexora 的移动端学习客户端工作区。当前代码已经覆盖会话、学习上下文、课程/教材、AI 问答、管理员内容流、向量化监控和 Learning Feed；UI/UX 统一排在最后一轮。

## 从这里开始

- [docs/README.md](docs/README.md)：文档入口和阅读顺序
- [docs/current-state.md](docs/current-state.md)：当前真实可用的产品状态
- [docs/architecture.md](docs/architecture.md)：代码边界、服务归属和依赖方向
- [docs/backend-data-flow.md](docs/backend-data-flow.md)：真实后端数据流
- [docs/versioning.md](docs/versioning.md)：版本号和构建号规则
- [docs/roadmap.md](docs/roadmap.md)：下一步工作顺序，UI/UX 放最后
- [docs/agents/domain.md](docs/agents/domain.md)：agent 读写的领域语言

## 当前后端

- `NexoraLearning`：学习域的主要聚合入口
- `ChatDBServer`：聊天、模型、用户和 PAPI 能力

默认真实环境：

```txt
EXPO_PUBLIC_NEXORA_LEARNING_BASE_URL=https://chat.himpqblog.cn:5002
EXPO_PUBLIC_CHAT_DB_SERVER_BASE_URL=https://chat.himpqblog.cn
```

本地运行时可以复制 `.env.example` 为 `.env` 并补充 API key；`.env` 和 `.env.*` 不进入 Git。Expo 真机调试不要使用 `localhost` 作为后端地址，除非手机能访问同一个主机地址。

聊天和学习服务都通过 `src/services/*` 访问，屏幕层不直接发请求。

## 常用命令

```bash
npm install
npm run start
npm run android
npm run typecheck
npm run test:unit
```
