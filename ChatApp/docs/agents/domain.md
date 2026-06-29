# Agent 领域词汇

ChatApp 是单一上下文的移动端学习客户端。AI 开发时用本文统一词汇。

## 主路径

```txt
username session
-> frontend context
-> dashboard / courses
-> lecture detail
-> book reading
-> learning chat
-> learning feed
```

管理员路径：

```txt
book upload
-> refinement
-> vectorization
-> feed channels
```

## 核心词

`Lecture`
: 当前课程容器。新开发使用 `Lecture`，不要新增 `Course` 领域类型。

`Book`
: Lecture 下的教材实体。新开发使用 `Book`，不要新增 `Material` 领域类型。

`FrontendContext`
: `/api/frontend/context` 返回的移动端上下文，包含 username、user、admin 状态和集成状态。

`LearningRuntimeContext`
: `/api/runtime/context` 返回的聊天上下文，包含 system prompt、context blocks、cards、active tool skills 和 meta。

`bookinfo`
: 后端生成的概读内容。移动端当前按可读文本展示。

`bookdetail`
: 后端生成的精读内容。移动端当前按可读文本展示。

`Refinement`
: 生成概读、精读、分节等内容的后端处理。

`Vectorization`
: 为教材生成 chunks / vectors 的后端处理。

`Learning Feed`
: 学习动态流，包含频道、动态、点赞、评论、删除和管理员频道管理。

## 服务归属

`NexoraLearning` 负责：

- frontend context
- materials / dashboard / learning select
- lectures / books
- runtime learning context
- refinement
- vectorization
- Learning Feed

`ChatDBServer` 负责：

- `/api/learning/chat` 流式和非流式学习聊天
- service 显式路由过去的 PAPI / model 能力

## Agent 阅读规则

默认只读：

- `docs/current-state.md`
- `docs/backend-data-flow.md`
- `docs/architecture.md`
- `docs/roadmap.md`
- `docs/versioning.md`

不要默认读取 `docs/archive/*`。历史资料只用于追溯，不用于决定当前开发顺序。
