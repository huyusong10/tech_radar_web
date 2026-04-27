# 内容契约

## 目录结构

| 路径 | 作用 | 契约 |
|------|------|------|
| `contents/published/vol-<vol>/` | 已发布卷期 | `<vol>` 为卷期标识；页面默认从这里读取内容 |
| `contents/draft/vol-<vol>/` | 草稿卷期 | 结构与 `published` 保持一致；仅草稿模式读取 |
| `contents/shared/config.md` | 站点级配置 | 提供站点标题、标语、页脚、徽章样式等共享配置 |
| `contents/shared/authors.md` | 作者主数据 | 以作者 ID 为稳定键，供专题编辑和投稿文章引用 |
| `contents/shared/submit-guide.md` | 投稿指南正文 | 以 Markdown 正文形式展示 |
| `contents/assets/` | 共享静态资源 | 以静态路径暴露，供作者头像和共享图片使用 |
| `contents/admin/` | 后台与投稿私有数据 | 仅供服务端读写；不通过静态资源公开 |
| `contents/admin/submissions/<submissionId>/` | 投稿原始文件包 | 仅用于编辑初审和投稿者返修 |
| `contents/admin/manuscripts/<manuscriptId>/` | 稿件池单篇稿件 | 已完成作者归一化，等待单篇审核或组刊 |
| `contents/admin/manuscript-reviews/<manuscriptId>.json` | 单篇稿件审核记录 | 服务端私有事件流 |
| `contents/admin/issue-drafts/<issueDraftId>/` | 期刊草稿 | 引用已审核稿件，负责整期编排和发布前审核 |
| `contents/admin/unpublished/<articleId>/` | 下线文章归档 | 从正式内容移出但保留恢复依据 |
| `contents/admin/published-history/<articleId>/` | 已发布文章快照 | 保存编辑或下线前的最近版本，用于回滚 |
| `contents/data/likes/vol-<vol>.json` | 分片点赞快照 | 仅供服务端读写；键为 `articleId`，值为非负整数 |
| `contents/data/views.json` | 阅读量快照 | 键为 `vol`，值为非负整数 |
| `contents/data/like-ips/vol-<vol>.json` | 分片点赞身份映射 | 仅供服务端读写；键为 `articleId`，值为身份数组 |

## 卷期目录契约

### `radar.md`

`frontmatter -> 专题元数据`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `vol` | string | 是 | 当前卷期标识，如 `"001"` |
| `date` | string | 是 | 展示日期，由内容决定格式 |
| `title` | string | 否 | 卷期主题标题；为空时页面可隐藏标题区 |
| `editors` | array | 否 | 本期编辑信息数组 |

`editors[]` 结构：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `author_id` | string | 是 | 引用 `authors.md` 中的作者 ID |
| `role` | string | 是 | 本期身份标签 |

`body -> Trending 条目列表`

稳定语义：

- 使用 `### [徽章名] 标题` 定义一条 Trending 条目。
- 同一条目标题后的非空正文视为详情。
- 条目顺序即展示顺序。

### `contributions/<folder>/index.md`

`frontmatter -> 投稿卡片元数据`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `author_id` | string | 二选一 | 单作者模式作者 ID |
| `author_ids` | string[] | 二选一 | 多作者模式作者 ID 列表，最多 2 位 |
| `title` | string | 是 | 卡片标题 |
| `description` | string | 是 | 卡片摘要 |

稳定语义：

- `author_id` 与 `author_ids` 互斥。
- 已发布投稿必须引用 `authors.md` 中存在的正式作者。
- 正文中的相对资源路径必须相对于当前投稿文件夹解析。
- 文章稳定标识 `articleId = <vol>-<folder>`，用于点赞与统计。

### `best-practices/<folder>/index.md`

`frontmatter -> 最佳实践卡片元数据`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `author_id` | string | 二选一 | 单作者模式作者 ID |
| `author_ids` | string[] | 二选一 | 多作者模式作者 ID 列表，最多 2 位 |
| `title` | string | 是 | 卡片标题 |
| `description` | string | 是 | 卡片摘要 |

稳定语义：

- 结构与投稿文章一致，但当前不参与点赞接口。
- 正文中的相对资源路径必须相对于当前最佳实践文件夹解析。
- 页面稳定标识 `articleId = bp-<vol>-<folder>`，用于前端检索定位。

## 后台私有内容契约

### `contents/admin/submissions/<submissionId>/index.md`

投稿使用与投稿文章相同的 `title`、`description` 与正文结构。作者字段允许以下形态之一：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `author_id` | string | 三选一 | 引用正式作者主数据 |
| `author_ids` | string[] | 三选一 | 引用正式作者主数据，最多 2 位 |
| `author` | object | 三选一 | 投稿临时作者，仅允许存在于 `Submission` |

`author` 结构：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 临时作者展示名 |
| `team` | string | 否 | 团队信息 |
| `role` | string | 否 | 角色信息 |
| `avatar` | string | 否 | 头像路径或空值 |

投稿允许临时作者；稿件和正式内容不允许临时作者。

### `contents/admin/submissions/<submissionId>/meta.json`

| 字段 | 说明 |
|------|------|
| `submissionId` | 投稿稳定标识，使用时间戳 + slug |
| `status` | `submitted`、`in_editor_review`、`changes_requested`、`accepted`、`published`、`rejected` |
| `submitter` | 投稿者资料，可包含姓名、团队、角色、联系方式和候选作者 ID |
| `submitterTokenHash` | 投稿状态访问 token 摘要 |
| `revision` | 投稿修订版本，从 `1` 开始 |
| `manuscriptId` | 接收入稿件池后的稿件 ID，可为空 |
| `publishedArticleId` | 发布后的正式文章标识，可为空 |
| `history[]` | 投稿初审和公开反馈事件 |
| `createdAt` / `updatedAt` | ISO 时间戳 |

`revisions/revision-<n>.md` 保存每次提交或返修后的 `index.md` 快照。

### `contents/admin/manuscripts/<manuscriptId>/index.md`

稿件使用与正式投稿文章相同的 frontmatter，并且必须引用正式作者：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `author_id` | string | 二选一 | 引用正式作者主数据 |
| `author_ids` | string[] | 二选一 | 引用正式作者主数据，最多 2 位 |
| `title` | string | 是 | 卡片标题 |
| `description` | string | 是 | 卡片摘要 |

正文中的相对资源路径必须相对于当前稿件目录解析。

### `contents/admin/manuscripts/<manuscriptId>/meta.json`

| 字段 | 说明 |
|------|------|
| `manuscriptId` | 稿件稳定标识 |
| `sourceSubmissionId` | 来源投稿 ID，可为空 |
| `status` | `drafting`、`manuscript_review_requested`、`changes_requested`、`available`、`scheduled`、`published`、`archived` |
| `assignee` | 当前责任人用户名，可为空 |
| `reviewers[]` | 已完成单篇审核的后台用户名 |
| `scheduledIssueDraftId` | `scheduled` 状态下引用的期刊草稿 ID |
| `publishedArticleId` | 发布后的正式文章标识，可为空 |
| `createdBy` / `updatedBy` | 后台操作者用户名 |
| `createdAt` / `updatedAt` | ISO 时间戳 |

### `contents/admin/manuscript-reviews/<manuscriptId>.json`

| 字段 | 说明 |
|------|------|
| `manuscriptId` | 稿件稳定标识 |
| `history[]` | 单篇审核事件流 |

### `contents/admin/issue-drafts/<issueDraftId>/meta.json`

| 字段 | 说明 |
|------|------|
| `issueDraftId` | 期刊草稿稳定标识 |
| `vol` | 目标卷期标识 |
| `title` | 后台展示标题 |
| `radarContent` | 将写入正式卷期 `radar.md` 的完整 Markdown |
| `status` | `editing`、`issue_review_requested`、`changes_requested`、`approved`、`published`、`archived` |
| `manuscripts[]` | 期刊内稿件引用、目标文件夹名与排序 |
| `reviewers[]` | 完成整期审核的后台用户名 |
| `publishedArticles[]` | 发布后的正式文章标识数组 |
| `createdBy` / `updatedBy` | 后台操作者用户名 |
| `createdAt` / `updatedAt` | ISO 时间戳 |

`manuscripts[]` 稳定字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `manuscriptId` | string | 是 | 引用 `contents/admin/manuscripts/<manuscriptId>/` |
| `folderName` | string | 是 | 发布到 `contributions/<folderName>/` 的目录名 |
| `order` | number | 是 | 在期刊草稿内的排序 |

同一篇未发布稿件不能同时出现在多个非归档期刊草稿中。

### `contents/admin/issue-drafts/<issueDraftId>/issue-review.json`

| 字段 | 说明 |
|------|------|
| `issueDraftId` | 期刊草稿稳定标识 |
| `history[]` | 整期审核事件流 |

`history[]` 稳定字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | 稳定事件标识 |
| `actor` | string | 否 | 后台用户名或 `submitter` |
| `role` | string | 否 | 事件角色 |
| `comment` | string | 否 | 备注正文 |
| `visibility` | string | 否 | `public` 或 `internal`；未声明时按内部事件处理 |
| `at` | string | 是 | ISO 时间戳 |

投稿者接口只能返回 `Submission.history[]` 中 `visibility=public` 的记录。后台详情可返回完整审核历史。

### `contents/admin/unpublished/<articleId>/`

已下线文章使用与正式投稿目录相同的文件结构，但不出现在读者 API、搜索、统计或归档中。恢复时必须重新写回 `contents/published/vol-<vol>/contributions/<folder>/` 并通过内容契约巡检。

### `contents/admin/published-history/<articleId>/`

已发布文章在编辑、下线或回滚前保存目录快照。服务端可以保留最近若干个快照；快照目录名只作为服务端私有标识，不进入读者契约。

### `contents/shared/config.md`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `site.title` | string | 否 | 站点标题 |
| `site.slogan` | string | 否 | 站点标语 |
| `site.footer` | string | 否 | 页脚文案 |
| `badges.<badgeName>.color` | string | 否 | 徽章文本色 |
| `badges.<badgeName>.bg` | string | 否 | 徽章背景色 |

### `contents/shared/authors.md`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `authors[].id` | string | 是 | 稳定作者标识 |
| `authors[].name` | string | 是 | 展示名 |
| `authors[].team` | string | 否 | 团队信息 |
| `authors[].avatar` | string | 否 | 头像静态路径 |
| `authors[].role` | string | 否 | 角色信息 |
| `authors[].aliases` | string[] | 否 | 作者搜索别名，用于投稿者中文名或拼写变体归一化 |
| `authors[].pinyin` | string | 否 | 中文名拼音检索键 |
| `authors[].initials` | string | 否 | 中文名首字母检索键 |

## 运行时数据一致性

| 数据 | 一致性规则 |
|------|------------|
| `likes/vol-<vol>.json` | `likes[articleId]` 必须等于同分片 `like-ips` 中的数组长度 |
| `like-ips/vol-<vol>.json` | 非数组值必须在加载时归一化为空数组 |
| `views.json` | 仅记录卷期阅读量，不记录页面局部状态 |

## 衍生文件契约

| 文件 | 生成来源 | 作用 |
|------|----------|------|
| `contents/published/archive.json` | 已发布卷期目录 | 为归档列表提供静态降级数据 |
| `contents/draft/archive.json` | 草稿卷期目录 | 为草稿模式归档列表提供静态降级数据 |

## 多语言约束

- 字段名保持稳定，字段值允许为任意语言。
- 测试不应依赖 `title`、`description`、`badgeName` 的具体文案，只应依赖字段存在与结构正确。
