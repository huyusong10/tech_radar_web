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
| `contents/data/likes.json` | 点赞数快照 | 键为 `articleId`，值为非负整数 |
| `contents/data/views.json` | 阅读量快照 | 键为 `vol`，值为非负整数 |
| `contents/data/like-ips.json` | 点赞身份映射 | 键为 `articleId`，值为身份数组 |

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
- 正文中的相对资源路径必须相对于当前投稿文件夹解析。
- 文章稳定标识 `articleId = <vol>-<folder>`，用于点赞与统计。

## 共享配置契约

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

## 运行时数据一致性

| 数据 | 一致性规则 |
|------|------------|
| `likes.json` | `likes[articleId]` 必须等于 `like-ips.json[articleId].length` |
| `like-ips.json` | 非数组值必须在加载时归一化为空数组 |
| `views.json` | 仅记录卷期阅读量，不记录页面局部状态 |

## 衍生文件契约

| 文件 | 生成来源 | 作用 |
|------|----------|------|
| `contents/published/archive.json` | 已发布卷期目录 | 为归档列表提供静态降级数据 |
| `contents/draft/archive.json` | 草稿卷期目录 | 为草稿模式归档列表提供静态降级数据 |

## 多语言约束

- 字段名保持稳定，字段值允许为任意语言。
- 测试不应依赖 `title`、`description`、`badgeName` 的具体文案，只应依赖字段存在与结构正确。
