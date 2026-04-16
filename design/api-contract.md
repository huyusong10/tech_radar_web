# 接口契约

## 资源读取

| 接口 | 输入 | 输出 | 失败语义 |
|------|------|------|----------|
| `GET /api/site-config` | 无 | 公开静态路径集合：`contentsDir`、`publishedDir`、`draftDir`、`sharedDir`、`assetsDir` | 无特殊失败语义，返回默认公开路径 |
| `GET /api/config` | 无 | `config.md` frontmatter 对象 | 读取失败时返回空对象 |
| `GET /api/authors` | 无 | `authorId -> author` 映射 | 读取失败时返回空映射 |
| `GET /api/authors/:authorId` | `authorId` | 单个作者对象 | 未找到返回 `404` |
| `GET /api/volumes` | `draft=true|false` | `[{ vol, date, views }]`，按卷期倒序 | 目录不存在时返回空数组 |
| `GET /api/contributions/:vol` | `vol`，可选 `draft=true` | 投稿文件夹名数组，按字典序排序 | 目录不存在时返回空数组 |
| `GET /api/best-practices/:vol` | `vol`，可选 `draft=true` | 最佳实践文件夹名数组，按字典序排序 | 目录不存在时返回空数组 |
| `GET /api/search` | `q`、`limit` | `{ results, query, total }` | 查询为空或长度不足时返回空结果；异常返回 `500` |
| `GET /api/stats` | 无 | 投稿排名、点赞排名与总览统计 | 聚合失败返回 `500` |
| `GET /api/health` | 无 | `{ status, dataLoaded, uptime, memoryUsage }` | 无特殊失败语义 |

## 交互接口

| 接口 | 输入 | 输出 | 失败语义 |
|------|------|------|----------|
| `GET /api/likes` | 无 | `{ [articleId]: likes }` | 无特殊失败语义 |
| `GET /api/user-likes` | 客户端身份 | `{ likedArticles: string[] }` | 无法识别客户端时返回空数组 |
| `POST /api/likes/:articleId` | `articleId` | `{ articleId, likes, userLiked }` | 身份不可识别返回 `400`；标识非法返回 `400`；文章不存在返回 `404`；资源忙返回 `503`；限流返回 `429` |
| `GET /api/views/:vol` | `vol` | `{ vol, views }` | 无特殊失败语义 |
| `POST /api/views/:vol` | `vol` | `{ vol, views }` | 卷期非法返回 `400`；资源忙返回 `503`；限流返回 `429` |

## 热更新与静态资源

| 接口 | 输入 | 输出 | 失败语义 |
|------|------|------|----------|
| `GET /api/hot-reload` | 长连接请求 | SSE 消息流；首次返回 `{"type":"connected"}` | 连接总数超限返回 `503`；单身份连接超限返回 `429` |
| `GET /`、`GET /draft`、`GET /index.html` | 无 | 页面入口 HTML | 无特殊失败语义 |
| `GET /assets/**` | 静态路径 | 前端样式、脚本、字体等公共资源 | 文件不存在返回静态资源错误 |
| `GET /contents/published/**` | 静态路径 | 已发布 Markdown 与资源文件 | 文件不存在返回静态资源错误 |
| `GET /contents/draft/**` | 静态路径 | 草稿 Markdown 与资源文件 | 文件不存在返回静态资源错误 |
| `GET /contents/shared/**` | 静态路径 | 共享配置和共享文档 | 文件不存在返回静态资源错误 |
| `GET /contents/assets/**` | 静态路径 | 共享图片与头像 | 文件不存在返回静态资源错误 |
| `GET /contents/data/**` | 无 | 不公开 | 返回 `403` |

## 返回结构约束

### `/api/search`

`q + limit -> { results, query, total }`

`results[]` 为联合类型：

| `type` | 最小字段集 |
|--------|------------|
| `trending` | `type, vol, title, badge, date, articleId` |
| `contribution` | `type, vol, title, description, authorIds, articleId, folderName` |
| `best-practice` | `type, vol, title, description, authorIds, articleId, folderName` |

### `/api/stats`

`published volumes + likes + views -> 聚合统计`

| 字段 | 说明 |
|------|------|
| `contributionRanking[]` | `{ authorId, count, rank }` |
| `likeRanking[]` | `{ authorId, count, rank }` |
| `totalContributions` | 投稿总数 |
| `totalLikes` | 点赞总数 |
| `totalViews` | 阅读总数 |
| `totalAuthors` | 出现在已发布投稿中的作者数 |
| `totalVolumes` | 已发布卷期数 |
| `avgLikesPerArticle` | 篇均点赞 |
| `avgViewsPerVolume` | 期均阅读 |
| `avgArticlesPerVolume` | 期均文章 |

## 身份与幂等语义

- 用户点赞状态以客户端身份为边界，同一身份对同一 `articleId` 进行切换操作时必须返回最新状态。
- `/api/user-likes` 是前端恢复点赞按钮状态的唯一可信来源。
- 前端不应基于文案或 DOM 结构推导接口状态，只能基于接口字段。
- 仅当显式启用受信任代理配置时，服务端才会采纳转发头中的客户端身份信息。

## 多语言约束

- 接口字段名保持稳定英文标识。
- 字段值允许包含任意语言，不作为测试断言主体。
