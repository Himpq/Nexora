# 切片：Learning Feed

状态：已落地，后续主要是频道/动态操作体验打磨。

## 目标

在移动端提供学习动态流，用户可以查看公共动态、按频道筛选、发布动态、点赞、评论和删除自己发布的内容。管理员额外可以创建和删除频道。

## 用户流程

1. 用户进入 Learning Feed。
2. App 加载可见频道和当前频道动态。
3. 用户切换频道、发布动态、点赞、评论或删除可删除内容。
4. 管理员可以创建公开或私有频道，并删除频道。

## API

- `GET /api/frontend/learning-feeds/channels`
- `POST /api/frontend/settings/feed-channels`
- `DELETE /api/frontend/settings/feed-channels/{channel_id}`
- `GET /api/frontend/learning-feeds`
- `POST /api/frontend/learning-feeds`
- `POST /api/frontend/learning-feeds/{feed_id}/like`
- `POST /api/frontend/learning-feeds/{feed_id}/comments`
- `DELETE /api/frontend/learning-feeds/{feed_id}`
- `DELETE /api/frontend/learning-feeds/{feed_id}/comments/{comment_id}`

## 页面

- `LearningFeedScreen`

## 组件

- `AppCard`
- `AppButton`
- `StateView`
- `TextInput`

## 状态

- loading
- empty
- error
- normal
- posting
- commenting
- deleting
- admin channel management

## 不做范围

- 不实现 Web 端专用信息流布局。
- 不实现复杂富文本编辑或图片上传。
- 不实现通知、订阅、私信或推荐算法。

## 验收标准

- 用户可以在移动端查看 Learning Feed。
- 用户可以切换频道并发布动态。
- 用户可以点赞、评论和删除自己有权限处理的内容。
- 管理员可以创建和删除频道。
- Screen 层不直接调用 `fetch`。
