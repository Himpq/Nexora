# 切片：项目底座

## 目标

创建稳定的 Expo + React Native + TypeScript 结构，让后续功能开发有清晰边界。

## 用户流程

本切片没有业务用户流程。App 应能在没有 username、本地 session 或后端服务的情况下启动到基础 Tab 壳。

## API

本切片不触发任何业务 API 调用。`apiClient` 只作为后续切片的统一后端边界存在。

## 页面

- `DashboardScreen`
- `CourseListScreen`
- `ConversationScreen`
- `SettingsScreen`

## 组件

- `Screen`
- `AppText`
- `AppButton`
- `AppCard`
- `StateView`

## 状态

- 仅基础壳 normal 状态

## 不做范围

- 登录/注册
- username/session 持久化
- `/api/frontend/context`
- admin 入口与角色判断
- 课程列表数据加载
- AI 对话调用
- 文件上传
- 管理员队列操作

## 验收标准

- 项目目录结构稳定。
- API Client 和 service 模块作为后端边界存在，但运行时不触发请求。
- Screen 不直接调用后端。
- App 无 username 时直接进入 `Dashboard`、`Courses`、`Chat`、`Settings` 四个基础 Tab。
- 文档说明后续切片开发顺序。
