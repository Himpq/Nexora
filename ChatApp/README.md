# Nexora ChatApp

Nexora 的移动端 App 工作区。项目计划使用 Expo + React Native + TypeScript，优先服务 Nexora 的学习流程。

初始产品路径：

```txt
用户设置 -> 课程库 -> 加入学习 -> 学习看板 -> 教材阅读 -> 基于课程上下文的 AI 问答
```

## 当前状态

当前目录包含项目骨架、service 边界、基础导航、设计组件和占位页面。业务功能按 `docs/slices/` 中的切片逐步实现。

## 后端目标

- `NexoraLearning`：移动端第一优先接入目标，本地默认端口 `5001`
- `ChatDBServer`：Nexora 核心聊天、模型和用户服务，本地默认端口 `5000`

移动端 API 基地址通过环境变量设置：

```txt
EXPO_PUBLIC_NEXORA_LEARNING_BASE_URL=http://127.0.0.1:5001
```

Android 模拟器访问宿主机时使用：

```txt
EXPO_PUBLIC_NEXORA_LEARNING_BASE_URL=http://10.0.2.2:5001
```

## 常用命令

```bash
npm install
npm run start
npm run android
npm run typecheck
```

## 重要文件

- `docs/architecture.md`：源码结构和依赖方向
- `docs/roadmap.md`：版本路线
- `docs/slices/_template.md`：功能切片模板
- `../NEXORALEARNING_API.md`：根目录维护的完整学习 API 说明
- `AGENT.md`：本地项目指令文件，已加入 `.gitignore`
