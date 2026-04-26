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
| `POST /api/likes/:articleId` | `articleId` | `{ articleId, likes, userLiked }` | 身份不可识别返回 `400`；标识非法返回 `400`；已发布文章不存在返回 `404`；资源忙返回 `503`；限流返回 `429` |
| `GET /api/views/:vol` | `vol` | `{ vol, views }` | 无特殊失败语义 |
| `POST /api/views/:vol` | `vol` | `{ vol, views }` | 卷期非法返回 `400`；资源忙返回 `503`；限流返回 `429` |

## 热更新与静态资源

| 接口 | 输入 | 输出 | 失败语义 |
|------|------|------|----------|
| `GET /api/hot-reload` | 长连接请求 | SSE 消息流；首次返回 `{"type":"connected"}` | 连接总数超限返回 `503`；单身份连接超限返回 `429` |
| `GET /`、`GET /draft`、`GET /index.html` | 无 | 页面入口 HTML | 无特殊失败语义 |
| `GET /submit` | 无 | 投稿者自助投稿入口 HTML | 无特殊失败语义 |
| `GET /assets/**` | 静态路径 | 前端样式、脚本、字体等公共资源 | 文件不存在返回静态资源错误 |
| `GET /contents/published/**` | 静态路径 | 已发布 Markdown 与资源文件 | 文件不存在返回静态资源错误 |
| `GET /contents/draft/**` | 静态路径 | 草稿 Markdown 与资源文件 | 文件不存在返回静态资源错误 |
| `GET /contents/shared/**` | 静态路径 | 共享配置和共享文档 | 文件不存在返回静态资源错误 |
| `GET /contents/assets/**` | 静态路径 | 共享图片与头像 | 文件不存在返回静态资源错误 |
| `GET /contents/data/**` | 无 | 不公开 | 返回 `403` |
| `GET /contents/admin/**` | 无 | 不公开 | 返回 `403` |

## 投稿者接口

投稿者接口使用提交后获得的 token 访问自己的投稿，不提供投稿者账号体系。

| 接口 | 权限 | 输出/语义 |
|------|------|-----------|
| `POST /api/submissions` | public | 创建后台投稿草稿，返回 `submissionId`、`accessToken`、`statusUrl` |
| `GET /api/submissions/:submissionId` | token | 查看自己的投稿状态、正文、文件列表和审核意见 |
| `PUT /api/submissions/:submissionId` | token | 在返修状态提交新版 `index.md` 与资源 |
| `GET /api/submissions/:submissionId/assets/*` | token | 查看自己投稿中的资源 |
| `GET /api/submission-authors` | public | 搜索已有正式作者，返回有限公开字段 |

投稿者接口失败语义：

- token 缺失或错误返回 `403`。
- 投稿不存在返回 `404`。
- 非返修状态提交修订返回 `400`。
- 内容结构、作者引用或文件路径非法返回 `400`。

## 后台管理接口

后台接口只服务内网管理界面，不改变读者侧 API 契约。

| 接口 | 权限 | 输出/语义 |
|------|------|-----------|
| `POST /api/admin/login` | public | 登录成功设置 httpOnly 会话 cookie，返回当前操作者 |
| `POST /api/admin/logout` | logged-in | 清除后台会话 |
| `GET /api/admin/me` | logged-in | 当前操作者与权限 |
| `GET /api/admin/drafts` | all roles | 后台草稿列表 |
| `GET /api/admin/drafts/:draftId` | all roles | 草稿元数据、正文、文件列表、审核记录 |
| `GET /api/admin/drafts/:draftId/assets/*` | all roles | 草稿资源文件 |
| `POST /api/admin/drafts/import` | `editor`、`chief_editor` | 导入 `index.md` 与资源文件为后台草稿 |
| `PUT /api/admin/drafts/:draftId` | `editor`、`chief_editor` | 更新草稿正文、目标卷期、目标文件夹或资源 |
| `DELETE /api/admin/drafts/:draftId` | `chief_editor` | 删除未发布后台草稿及其审核记录 |
| `POST /api/admin/drafts/:draftId/accept` | `editor`、`chief_editor` | 接收投稿来源草稿进入编辑处理 |
| `POST /api/admin/drafts/:draftId/reject` | `editor`、`chief_editor` | 拒绝未发布草稿或投稿 |
| `POST /api/admin/drafts/:draftId/review-request` | `editor`、`chief_editor` | 提交技术审核 |
| `POST /api/admin/drafts/:draftId/review` | `tech_reviewer`、`chief_editor` | 审核通过或退回 |
| `POST /api/admin/drafts/:draftId/publish` | `chief_editor` | 发布 approved 草稿到 `contents/published` |
| `GET /api/admin/authors` | `editor`、`chief_editor` | 作者主数据列表 |
| `POST /api/admin/authors` | `editor`、`chief_editor` | 创建正式作者 |
| `PUT /api/admin/authors/:authorId` | `editor`、`chief_editor` | 更新正式作者资料 |
| `GET /api/admin/audit-log` | `chief_editor` | 查看全局审计日志 |
| `GET /api/admin/published` | `editor`、`chief_editor` | 已发布投稿列表 |
| `GET /api/admin/published/:articleId` | `editor`、`chief_editor` | 已发布投稿详情 |
| `PUT /api/admin/published/:articleId` | `editor`、`chief_editor` | 修改已发布投稿，必须通过内容检查 |
| `POST /api/admin/published/:articleId/unpublish` | `chief_editor` | 下线文章到后台私有归档 |
| `POST /api/admin/unpublished/:articleId/restore` | `chief_editor` | 恢复已下线文章 |
| `GET /api/admin/users` | `chief_editor` | 后台操作者列表，不返回密码摘要 |
| `POST /api/admin/users` | `chief_editor` | 创建后台操作者 |
| `PUT /api/admin/users/:username` | `chief_editor` | 更新后台操作者资料、角色或密码 |
| `POST /api/admin/users/:username/disable` | `chief_editor` | 停用后台操作者 |
| `GET /api/admin/volumes` | `chief_editor` | 已发布卷期列表与 `radar.md` 内容 |
| `POST /api/admin/volumes` | `chief_editor` | 新建已发布卷期目录和 `radar.md` |
| `PUT /api/admin/volumes/:vol/radar` | `chief_editor` | 更新指定卷期的 `radar.md` |
| `POST /api/admin/lint` | `editor`、`tech_reviewer`、`chief_editor` | 运行内容契约巡检并返回结果 |

后台接口失败语义：

- 未登录返回 `401`。
- 权限不足返回 `403`。
- 草稿、作者或资源不存在返回 `404`。
- 内容结构、状态流或目标路径非法返回 `400`。
- 目标发布路径已存在返回 `409`。

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
| `totalContributions` | 已发布投稿文章总数；多作者文章只计为 1 篇 |
| `totalLikes` | 已发布投稿文章真实点赞总数；多作者文章点赞只计为文章自身点赞数 |
| `totalViews` | 阅读总数 |
| `totalAuthors` | 出现在已发布投稿中的作者数 |
| `totalVolumes` | 已发布卷期数 |
| `avgLikesPerArticle` | 篇均点赞 |
| `avgViewsPerVolume` | 期均阅读 |
| `avgArticlesPerVolume` | 期均文章 |

## 身份与幂等语义

- 用户点赞状态以客户端身份为边界，同一身份对同一 `articleId` 进行切换操作时必须返回最新状态。
- `/api/user-likes` 是前端恢复点赞按钮状态的唯一可信来源。
- 点赞写入仅面向已发布投稿文章；草稿模式请求不记录持久化点赞。
- 前端不应基于文案或 DOM 结构推导接口状态，只能基于接口字段。
- 仅当显式启用受信任代理配置时，服务端才会采纳转发头中的客户端身份信息。

## 多语言约束

- 接口字段名保持稳定英文标识。
- 字段值允许包含任意语言，不作为测试断言主体。
