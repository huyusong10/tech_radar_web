# 后台管理契约

## 系统职责

后台把投稿与发布拆成四类对象：

| 对象 | 职责 |
|------|------|
| `Submission` | 投稿者上传的原始文件包，只用于编辑初审、退回和返修沟通 |
| `Manuscript` | 编辑接收后的单篇候选文章，进入稿件池并接受单篇审核 |
| `IssueDraft` | 某一期期刊草稿，引用若干已审核稿件，负责编排、排序和整期预览 |
| `PublishedIssue` | 从已审核期刊草稿物化到 `contents/published` 的正式内容 |

后台操作者、投稿者和正式作者是三类独立身份：

- `Submitter`：投稿者，通过 token 链接查看和返修自己的投稿。
- `Operator`：后台登录用户，角色为 `chief_editor`、`editor` 或 `tech_reviewer`。
- `Author`：正式作者库条目，写入 `contents/shared/authors.md`，供可发布内容引用。

读者 API 保持只读；投稿 API 只写 `Submission`；后台 API 负责把对象推进到下一层。

## 角色与权限

| 角色 | 稳定权限 |
|------|----------|
| `chief_editor` | 全部后台权限；发布期刊草稿；管理后台用户、卷期、作者、已发布内容和审计 |
| `editor` | 初审投稿；创建和编辑稿件；管理作者；创建期刊草稿；编排稿件；提交整期审核；编辑、下线和恢复已发布文章 |
| `tech_reviewer` | 查看投稿、稿件和期刊草稿；运行内容检查；审核单篇稿件；审核整期期刊草稿 |
| `submitter-token` | 查看和返修自己的投稿，不能访问后台 |

权限判断必须发生在服务端。前端只负责隐藏或禁用当前角色不可用的操作。

## 后台私有数据

| 路径 | 作用 | 契约 |
|------|------|------|
| `contents/admin/submissions/<submissionId>/` | 投稿原始文件包 | 包含 `index.md`、`meta.json`、资源和 `revisions/` |
| `contents/admin/manuscripts/<manuscriptId>/` | 稿件池单篇稿件 | 包含已归一化作者的 `index.md`、`meta.json` 和资源 |
| `contents/admin/manuscript-reviews/<manuscriptId>.json` | 单篇稿件审核记录 | 记录审核动作、意见、审稿人和可见性 |
| `contents/admin/issue-drafts/<issueDraftId>/` | 期刊草稿 | 包含 `meta.json` 与 `issue-review.json`，通过引用组织稿件 |
| `contents/admin/unpublished/<articleId>/` | 下线文章归档 | 不硬删除，支持恢复 |
| `contents/admin/published-history/<articleId>/` | 已发布文章快照 | 编辑、下线或回滚前保存最近版本 |
| `contents/admin/users.json` | 后台账号 | 服务端私有，不返回密码摘要 |
| `contents/admin/audit-log.json` | 审计日志 | 记录关键治理事件 |

`contents/admin/drafts/` 是旧模型迁移来源；新后台不再把它作为主数据写入。`/contents/admin/**` 必须返回 `403`。

## 状态机

`Submission`：

```text
submitted -> in_editor_review -> changes_requested -> accepted
submitted -> rejected
accepted -> published
```

`Manuscript`：

```text
drafting -> manuscript_review_requested -> changes_requested -> available -> scheduled -> published
drafting -> archived
```

`IssueDraft`：

```text
editing -> issue_review_requested -> changes_requested -> approved -> published
editing -> archived
```

稳定语义：

- 投稿不会直接写入正式作者库。
- 编辑接收投稿时必须完成作者归一化：绑定已有作者或新建正式作者。
- 后台作者归一化入口必须把“绑定已有作者”和“新建作者”作为互斥操作呈现，不能同时暴露两组输入造成误提交。
- `available` 稿件才能加入期刊草稿；加入后变为 `scheduled`，不能同时加入其他期刊草稿。
- `scheduled` 稿件默认锁定；若要修改，应先从期刊草稿移除，或把相关期刊草稿退回编辑态。
- 期刊草稿必须由技术审核或主编审核通过后才能发布。
- 正式内容必须从 `IssueDraft` 发布，不能绕过期刊草稿直接发布单篇稿件。
- 期刊草稿预览从草稿详情进入，打开读者页完整界面；预览数据由后台 API 按该期刊草稿即时生成，不依赖全局 `/draft` 目录作为工作入口。
- 后台审核意见默认作为内部意见记录；若未来重新开放投稿者可见意见，应作为明确动作而非通用下拉项。

## 投稿闭环

- `/submit` 是投稿者入口，支持上传完整文件包、预览、填写临时作者或选择已有作者。
- 投稿者不填写卷期或发布目录。
- 创建投稿返回 `submissionId`、随机 `accessToken` 和状态链接；服务端只保存 token hash。
- 投稿者状态页只展示自己的状态、公开意见、文件列表、预览和发布结果。
- 返修只能在 `changes_requested` 状态进行，并以完整文件包替换当前投稿；`revision + 1`。
- 投稿者的临时作者信息只保留在 `Submission`，不会自动进入正式作者库。

## 后台信息架构

后台左侧入口应使用直接业务名，按用户每天完成的工作组织：

| 入口 | 主要用户 | 职责 |
|------|----------|------|
| `投稿初审` | 编辑 | 处理新投稿、退回返修、拒稿或接收入稿件池 |
| `稿件池` | 编辑、技术审核 | 查看和编辑单篇稿件，完成单篇审核 |
| `审核任务` | 技术审核、主编 | 集中查看待审核稿件与待审核期刊 |
| `期刊管理` | 编辑、主编 | 按卷期管理期刊草稿、整期预览、发布和发布后维护 |
| `作者管理` | 编辑、主编 | 作者入库、修改、头像和合并 |
| `人员权限` | 主编 | 维护后台用户、角色和停用状态 |
| `操作日志` | 主编 | 查看关键后台操作记录 |

`期刊管理` 是发布后治理的主轴。已发布文章、已下线文章和历史快照都从某一期进入，不再作为全站平铺列表优先呈现。

后台预览从期刊草稿详情进入，不依赖统一 `/draft` 作为工作入口。
期刊草稿编排必须在选中具体期刊草稿后提供当前可加入稿件池，编辑不应依赖复制稿件 ID 完成组刊；手填 ID 只作为高级回退路径保留。

## 作者治理

- 作者只由编辑或主编新建、修改或合并。
- 编辑接收投稿时必须把稿件 frontmatter 改写为 `author_id` 或 `author_ids`。
- 已发布内容、稿件和已下线内容都不能包含临时作者对象。
- 作者搜索可使用中文名、别名、拼音和首字母辅助归一化；自动归一化只在唯一高置信匹配时发生。
- 作者创建、修改、头像更新和合并都必须写审计日志。

## 已发布内容治理

- 编辑和主编可以修改已发布文章正文与资源；保存前必须通过内容检查。
- 删除正式文章统一实现为下线归档，不做硬删除。
- 下线文章不参与读者 API、搜索、统计或归档；恢复后重新可见。
- 编辑、下线、恢复和回滚都必须记录审计日志并刷新归档、缓存和热更新。

## 审核与审计

- 审核历史中的记录可声明 `visibility: public | internal`。
- 投稿者状态页只能返回公开记录；后台详情返回完整记录。
- 审计日志至少记录投稿创建、返修、拒稿、接收入池、稿件修改、稿件审核、期刊草稿创建/修改/审核/发布、作者治理、已发布内容治理、卷期治理和用户治理。

## 多语言约束

- UI 文案不作为测试契约。
- 内容字段值允许包含任意语言。
- 代码、设计文档和测试只依赖稳定字段、状态和可达路径。
