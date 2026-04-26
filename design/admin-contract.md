# 后台管理契约

## 系统职责

后台管理界面为内网编辑团队提供内容写入、草稿整理、技术审核、作者维护与发布转正能力。投稿者入口为非后台用户提供自助投稿、状态查询和返修能力。系统存在三类身份：

- `Submitter`：投稿者，通过提交后获得的 token 链接查看状态和返修自己的投稿。
- `Operator`：能登录后台并执行管理动作的人。
- `Author`：文章 frontmatter 引用的内容作者，仍以 `contents/shared/authors.md` 为正式主数据。

后台只通过 `/api/admin/**` 写入内容；投稿者只通过 `/api/submissions/**` 写入自己的投稿；读者侧 API 不承担内容管理职责。

## 角色与权限

| 角色 | 稳定权限 |
|------|----------|
| `chief_editor` | 全部后台权限；发布转正；下线/恢复文章；删除草稿；管理作者、卷期和后台用户；查看全局审计 |
| `editor` | 接收投稿；导入/编辑草稿；上传资源；预览；提交审核；拒稿；直接管理作者；编辑已发布文章 |
| `tech_reviewer` | 查看草稿；运行内容检查；添加审核意见；通过或退回技术审核 |
| `submitter-token` | 查看和返修自己的投稿，不能访问后台 |

权限判断必须发生在服务端。前端只负责隐藏或禁用当前角色不可用的操作。

## 后台私有数据

| 路径 | 作用 | 契约 |
|------|------|------|
| `contents/admin/users.json` | 后台操作者账号 | 服务端私有；存储用户名、展示名、角色和密码摘要 |
| `contents/admin/drafts/<draftId>/index.md` | 后台草稿正文 | 可包含正式作者引用或草稿临时作者 |
| `contents/admin/drafts/<draftId>/meta.json` | 后台草稿元数据 | 存储状态、目标卷期、目标文件夹、操作者和时间戳 |
| `contents/admin/drafts/<draftId>/assets/` | 草稿资源 | 可由草稿 Markdown 相对引用 |
| `contents/admin/reviews/<draftId>.json` | 审核记录 | 存储技术审核意见与状态变更历史 |
| `contents/admin/unpublished/<articleId>/` | 下线文章归档 | 主编下线文章后保留在后台私有区，支持恢复 |
| `contents/admin/audit-log.json` | 后台审计日志 | 记录导入、编辑、审核、作者维护和发布动作 |

`/contents/admin/**` 不公开，必须返回 `403`。

## 草稿状态机

```text
editing -> review_requested -> changes_requested -> approved -> published
editing -> rejected
```

稳定语义：

- 投稿创建的后台草稿 `source=submission`，投稿者视角状态由 `submissionStatus` 表示。
- 编辑和主编可以从 `editing` 或 `changes_requested` 提交技术审核。
- 技术审核和主编可以将 `review_requested` 改为 `approved` 或 `changes_requested`。
- 只有主编可以将 `approved` 草稿发布为正式内容。
- 发布后不自动删除后台草稿，便于追溯和回滚。
- 主编可以删除未发布草稿；已发布草稿保留为审计依据。
- 编辑和主编可以拒绝未发布草稿；拒绝投稿会让投稿者看到 `rejected`。

投稿者视角状态：

```text
submitted -> in_editing -> in_technical_review -> changes_requested -> approved -> published
submitted -> rejected
```

投稿者只能在 `changes_requested` 状态提交返修；返修后 `revision + 1`，后台稿件回到 `editing`，投稿状态回到 `submitted`。

## 作者规则

已发布内容必须使用正式作者引用：

```yaml
author_id: "known_author"
```

或：

```yaml
author_ids:
  - "known_author"
  - "another_author"
```

后台草稿额外允许临时作者对象：

```yaml
author:
  name: "王小明"
  team: "Platform Team"
  role: "Backend Engineer"
  avatar: ""
```

发布前，主编必须把临时作者绑定到已有作者，或创建新作者并写入 `contents/shared/authors.md`。

## 发布语义

`approved` 草稿发布时：

1. 校验目标卷期、目标文件夹、frontmatter 和资源引用。
2. 若存在临时作者，先归一化为正式作者 ID。
3. 写入 `contents/published/vol-<vol>/contributions/<folder>/`。
4. 目标路径已存在时必须拒绝发布。
5. 刷新归档、失效内容/搜索/统计/作者缓存，并广播热更新。
6. 写入审核记录和审计日志。

## 投稿者入口

- `/submit` 是投稿者唯一入口，支持导入 `index.md` 和资源文件、预览、绑定已有作者或填写临时作者。
- 创建投稿后返回 `submissionId`、一次性随机 `accessToken` 和状态链接；服务端只保存 token hash。
- 投稿者状态链接可查看当前稿件、文件列表、审核意见和发布结果。
- 投稿者不能访问后台接口，也不能查看其他投稿。

## 已发布内容治理

- 编辑和主编可以修改已发布投稿正文与资源；保存前必须通过内容检查。
- 主编可以下线文章，文章移动到 `contents/admin/unpublished/<articleId>/`。
- 主编可以恢复下线文章；目标正式路径已存在时必须拒绝恢复。
- 下线和恢复都必须刷新归档、失效缓存、广播热更新并记录审计日志。

## 卷期与后台用户管理

- 卷期管理只写 `contents/published/vol-<vol>/radar.md` 和投稿目录骨架，不改变普通读者 API 的读取契约。
- `radar.md` 必须保留 `vol` 与目录一致，并提供 `date`；编辑名单仍通过正式作者 ID 引用。
- 后台用户管理只由主编执行；接口不返回密码摘要，只返回用户名、展示名、角色和停用状态。
- 初始后台用户可由环境变量创建，后续账号维护写入 `contents/admin/users.json`。

## 多语言约束

- 后台 UI 文案不作为测试契约。
- 内容字段值允许包含任意语言。
- 作者、标题、描述、审核意见只以结构和可达性作为契约。
