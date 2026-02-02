# CLAUDE.md - Tech Radar Weekly Project Guide

## 项目概述

Tech Radar Weekly 是一个赛博朋克风格的技术周刊单页应用模板。采用内容与展示分离的架构，所有内容使用 Markdown 编写，通过动态加载渲染到页面。

**核心特性：**
- 赛博朋克暗黑风格设计，霓虹发光效果
- Markdown 内容管理，支持 YAML Frontmatter
- 代码语法高亮（Highlight.js）
- 完全响应式，适配移动端和桌面端
- 热重载：文件变更自动刷新浏览器
- 草稿预览：通过 `/draft` URL 路径预览未发布内容
- 交互功能：点赞、阅读量统计、侧边栏导航
- 统计面板：作者投稿排名、点赞排名（支持并列排名，过滤零值）
- 灵活内容：Trending 和 Developer's Space 部分可独立存在或隐藏

## 技术栈

### 后端（server.js）
- **Express.js**：Web 服务器框架
- **chokidar**：文件监控（实现热重载）
- **js-yaml**：YAML Frontmatter 解析

### 前端（index.html）
- **Vanilla JavaScript**：无框架，纯 JS 实现
- **Marked.js v11.1.1**：Markdown 解析
- **js-yaml v4.1.0**：YAML Frontmatter 解析
- **Highlight.js v11.9.0**：代码语法高亮（Tokyo Night Dark 主题）

### 字体
- **Google Fonts**：
  - Inter：主要文本字体
  - JetBrains Mono：等宽字体（代码、技术元素）

## 架构说明

### 文件结构

```
tech_radar_web/
├── index.html              # 前端页面（动态加载 Markdown）
├── server.js               # Node.js 服务器入口
├── server/                 # 服务器模块目录
│   ├── server.js           # 服务器完整副本（参考）
│   └── utils/              # 工具模块
│       ├── concurrency.js  # 并发控制类（Cache, AsyncMutex, RateLimiter, WriteQueue）
│       └── ip.js           # IP 处理工具（getClientIP, isValidIP, normalizeIP）
├── site.config.js          # 站点配置（端口、内容目录路径）
├── package.json            # 依赖配置
├── README.md               # 用户文档
├── CLAUDE.md               # AI 助手指南（本文件）
└── contents/               # 内容目录（路径可在 site.config.js 中配置）
    ├── published/          # 已发布的周刊
    │   └── vol-001/
    │       ├── radar.md            # 可选：Trending 内容
    │       └── contributions/      # 可选：投稿文件夹
    │           └── 01-article-name/
    │               ├── index.md
    │               └── *.svg/png
    ├── draft/              # 草稿（通过 /draft 路径预览）
    │   └── vol-001/
    ├── shared/             # 共享配置文件
    │   ├── config.md       # 站点标题、slogan、徽章配置
    │   ├── authors.md      # 统一作者档案
    │   └── submit-guide.md # 投稿指南（弹窗内容）
    ├── assets/             # 静态资源
    │   └── images/
    │       └── avatars/    # 作者头像
    └── data/               # 运行时数据（服务器自动生成）
        ├── likes.json      # 点赞数据
        └── views.json      # 阅读量数据
```

### 内容管理架构

1. **内容与代码分离**：
   - 所有内容存储在 `contents/` 目录
   - `contents/` 路径可在 `site.config.js` 中配置为外部路径
   - 升级代码时内容数据不受影响

2. **发布与草稿分离**：
   - `published/`：已发布的正式内容
   - `draft/`：草稿预览，通过 `/draft` URL 路径访问

3. **灵活的内容结构**：
   - `radar.md` 和 `contributions/` 都是可选的
   - 如果 `radar.md` 不存在或没有 Trending 内容，Trending 部分自动隐藏
   - 如果 `contributions/` 不存在或为空，Developer's Space 部分自动隐藏

4. **共享资源**：
   - `shared/config.md`：全局配置（title, slogan, 徽章颜色）
   - `shared/authors.md`：统一作者档案
   - `assets/`：静态资源（头像等）

5. **运行时数据**：
   - `data/likes.json`：点赞数据
   - `data/views.json`：阅读量数据
   - 服务器自动管理，定期持久化

### 动态加载流程

```
页面加载 → 解析 URL 路径和参数（/draft, vol）→ 加载对应期刊
↓
加载 /api/config → 渲染站点标题
↓
加载 /api/volumes → 渲染侧边栏导航
↓
加载 radar.md → 渲染 Trending 部分（如果有内容）
↓
加载 contributions/* → 渲染投稿卡片（如果有投稿）
↓
建立 SSE 连接 → 监听热重载事件
```

## Server.js 架构

### 核心功能模块

服务器代码采用模块化架构，工具类位于 `server/utils/` 目录：

**server/utils/concurrency.js：**
```javascript
// 缓存系统
class Cache                 // 内存缓存，支持 TTL 过期

// 并发控制
class AsyncMutex            // 异步互斥锁，防止数据竞争
class RateLimiter           // 速率限制（读 240/分钟，写 20/分钟）
class WriteQueue            // 写入队列，防抖处理

// 导出默认配置
DEFAULTS = { CACHE_TTL, LOCK_TIMEOUT, WRITE_DEBOUNCE, MAX_CONCURRENT_WRITES, RATE_LIMIT }
```

**server/utils/ip.js：**
```javascript
getClientIP(req)            // 获取客户端 IP（支持代理头）
isValidIP(ip)               // 验证 IP 格式
normalizeIP(ip)             // 标准化 IP（处理 IPv6 映射）
```

**server.js 主入口：**
```javascript
// 数据持久化
loadDataFiles()             // 启动时加载数据到内存
persistData()               // 定期持久化（每 5 秒）
gracefulShutdown()          // 优雅关闭，确保数据保存

// 热重载
setupFileWatcher()          // 使用 chokidar 监控文件变化
notifyHotReload()           // 通过 SSE 通知客户端刷新
```

### API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/site-config` | GET | 获取路径配置 |
| `/api/config` | GET | 获取站点配置（title, slogan, badges） |
| `/api/authors` | GET | 获取所有作者 |
| `/api/authors/:id` | GET | 获取单个作者 |
| `/api/volumes` | GET | 获取期刊列表（支持 `?draft=true` 参数） |
| `/api/contributions/:vol` | GET | 获取某期投稿列表 |
| `/api/stats` | GET | 获取作者统计（投稿排名、点赞排名） |
| `/api/likes` | GET | 获取所有点赞数据 |
| `/api/likes/:articleId` | POST | 点赞/取消点赞 |
| `/api/views/:vol` | GET | 获取阅读量 |
| `/api/views/:vol` | POST | 增加阅读量 |
| `/api/hot-reload` | GET | SSE 热重载连接 |
| `/api/health` | GET | 健康检查 |

### Stats API 说明

`/api/stats` 返回作者统计数据：
- `contributionRanking`：投稿数排名（过滤 count=0，支持并列排名）
- `likeRanking`：点赞数排名（过滤 count=0，支持并列排名）
- `totalContributions`：文章总数
- `totalLikes`：点赞总数
- `totalViews`：阅读总数
- `totalAuthors`：作者总数
- `totalVolumes`：期刊总数
- 各类平均值统计

### 配置参数（DEFAULTS 对象，位于 server/utils/concurrency.js）

```javascript
DEFAULTS = {
    CACHE_TTL: {
        config: 60000,       // 1 分钟
        authors: 60000,      // 1 分钟
        volumes: 30000,      // 30 秒
        contributions: 30000 // 30 秒
    },
    RATE_LIMIT: {
        windowMs: 60000,     // 1 分钟窗口
        maxRequests: {
            read: 240,       // 读请求限制
            write: 20        // 写请求限制
        }
    },
    LOCK_TIMEOUT: 5000,      // 锁超时 5 秒
    WRITE_DEBOUNCE: 100,     // 写入防抖 100ms
    MAX_CONCURRENT_WRITES: 10 // 最大并发写入数
};
```

## Markdown 格式规范

### Radar 文件 (radar.md)

```markdown
---
vol: "001"
date: "2026.01.20"
title: "本期主题（可选）"
editors:
  - author_id: "huyusong"
    role: "Chief Editor"
  - author_id: "dev_ops"
    role: "Technical Reviewer"
---

## Trending

### [架构决策] 条目标题
详细内容...

### [工具推荐] 另一个标题
详细内容...
```

**徽章样式映射（可在 config.md 中自定义）：**
- `[架构决策]` → 青色
- `[债务预警]` → 橙色
- `[工具推荐]` → 绿色
- `[安全更新]` → 粉色
- `[性能优化]` → 紫色
- `[重要通知]` → 黄色

**注意**：如果 `radar.md` 不存在或没有 `### [徽章] 标题` 格式的内容，Trending 部分会自动隐藏。

### 投稿文件夹 (contributions/文章名/)

每个投稿是一个独立的自包含文件夹：

```
01-typescript-types/
├── index.md              # 必需：文章入口
├── diagram.svg           # 可选：图表
└── screenshot.png        # 可选：截图
```

**index.md 格式（单作者模式）：**

```markdown
---
author_id: "zhang_wei"
title: "文章标题"
description: "简短描述（1-2 句话）"
---

正文内容...

![示意图](./diagram.svg)

\```typescript
代码内容
\```
```

**多作者模式（支持 1-2 位作者）：**

```markdown
---
author_ids:
  - "zhang_wei"
  - "lisa_chen"
title: "协作文章标题"
description: "由两位作者共同撰写的文章"
---

正文内容...
```

> **注意**：`author_id` 和 `author_ids` 二选一。多作者模式最多支持 2 位作者，超出部分将被忽略。如果 `contributions/` 文件夹不存在或为空，Developer's Space 部分会自动隐藏。

### 统一作者文件 (shared/authors.md)

```markdown
---
authors:
  - id: "zhang_wei"
    name: "@zhang_wei"
    team: "Core Platform Team"
    avatar: "/contents/assets/images/avatars/zhang_wei.jpg"
    role: "Senior Developer"

  - id: "huyusong"
    name: "胡宇松"
    team: "Engineering Team"
    avatar: "/contents/assets/images/avatars/huyusong.jpg"
    role: "Tech Lead"
---
```

**作者属性：**
| 属性 | 说明 | 示例 |
|------|------|------|
| `id` | 唯一标识符 | "zhang_wei" |
| `name` | 显示名称 | "@zhang_wei" |
| `team` | 所属团队 | "Core Platform Team" |
| `avatar` | 头像路径 | "/contents/assets/images/avatars/zhang_wei.jpg" |
| `role` | 职位/角色 | "Senior Developer" |

### 站点配置文件 (shared/config.md)

```markdown
---
site:
  title: "Tech Radar Weekly"
  slogan: "Navigating the bleeding edge of technology"
  footer: "© 2026 Tech Radar Weekly"

badges:
  架构决策:
    color: "#00f3ff"
    bg: "rgba(0, 243, 255, 0.2)"
  债务预警:
    color: "#ff6b35"
    bg: "rgba(255, 107, 53, 0.2)"
  # 可添加更多自定义徽章...
---
```

## 样式系统

### CSS 变量（在 `:root` 中定义）

```css
/* 颜色系统 */
--bg-primary: #0a0a0a;        /* 主背景 */
--bg-secondary: #151515;      /* 次级背景 */
--bg-card: #1a1a1a;           /* 卡片背景 */
--text-primary: #ededed;      /* 主文本 */
--text-secondary: #9ca3af;    /* 次级文本 */

/* 强调色（霓虹色） */
--accent-cyan: #00f3ff;       /* 青色（主强调色）*/
--accent-pink: #ff00ff;       /* 粉色（次强调色）*/
--accent-green: #00ff88;      /* 绿色 */
--accent-orange: #ff6b35;     /* 橙色 */
--accent-purple: #a855f7;     /* 紫色 */

/* 字体 */
--font-main: 'Inter', sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

### 关键 CSS 类

**布局类：**
- `.sidebar`：左侧导航栏（固定定位）
- `.main-content`：主内容区域
- `.container`：内容容器（最大宽度 1200px）

**组件类：**
- `.contribution-card`：投稿卡片
- `.code-block`：代码块容器
- `.badge`：徽章标签
- `.like-button`：点赞按钮
- `.stat-item`：统计项（阅读量）
- `.stats-container`：统计面板容器

**状态类：**
- `.active`：激活状态（用于导航链接）
- `.liked`：已点赞状态
- `.open`：打开状态（移动端侧边栏）

## 常见任务指南

### 添加新一期周刊

1. **创建目录结构**
```bash
mkdir -p contents/published/vol-002/contributions
```

2. **创建 radar.md**（可选）
```bash
# 如果需要 Trending 部分
touch contents/published/vol-002/radar.md
# 编辑并添加 frontmatter 和 Trending 内容
```

3. **创建投稿文章**（可选）
```bash
mkdir contents/published/vol-002/contributions/01-article-name
# 在文件夹中创建 index.md
```

4. **服务器自动检测**
   - 热重载会自动检测文件变化
   - 或重启服务器：`node server.js`

### 只有 Trending 的期刊

如果某期只有 Trending 而没有投稿：
1. 创建 `vol-XXX/radar.md` 文件
2. 不创建 `contributions/` 文件夹（或保持为空）
3. Developer's Space 部分会自动隐藏

### 只有投稿的期刊

如果某期只有投稿而没有 Trending：
1. 不创建 `radar.md` 文件
2. 创建 `contributions/` 文件夹并添加投稿
3. Trending 部分会自动隐藏

### 草稿预览

1. 在 `contents/draft/vol-XXX/` 下创建内容
2. 访问 `http://localhost:5090/draft` 或 `http://localhost:5090/draft?vol=XXX`

### 修改配置

**修改端口或内容目录：**

编辑 `site.config.js`：
```javascript
const config = {
    contentsDir: '/path/to/external/contents',
    server: {
        port: 8080
    }
};
```

### 添加新的徽章类型

在 `contents/shared/config.md` 中添加：
```yaml
badges:
  新徽章:
    color: "#00ff00"
    bg: "rgba(0, 255, 0, 0.2)"
```

## 编码规范

### JavaScript
- 使用现代 ES6+ 语法
- async/await 处理异步操作
- 错误处理使用 try-catch
- 避免全局变量污染

### Markdown
- YAML frontmatter 使用两个 `---` 包裹
- 代码块指定语言标识符
- 图片使用相对路径

## 注意事项

### 重要约束

1. **跨域限制**：
   - 必须通过 HTTP 服务器访问
   - 不能直接打开 `file://` 协议

2. **文件命名**：
   - 投稿文件夹建议使用数字前缀：`01-`, `02-`
   - 避免文件名包含空格和特殊字符
   - 使用小写字母和连字符

3. **性能考虑**：
   - 每期投稿建议 2-6 篇
   - 避免过大的图片（建议 < 500KB）
   - 代码块行数建议 < 30 行

### 浏览器兼容性

- **推荐浏览器**：Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **关键特性依赖**：
  - CSS Grid
  - CSS Custom Properties
  - ES6+ JavaScript
  - Fetch API
  - Server-Sent Events (SSE)

## 开发工作流

1. **启动开发服务器**：`npm start`
2. **编辑 Markdown 文件**：热重载自动刷新
3. **草稿预览**：访问 `/draft` 路径
4. **发布**：将 `draft/` 内容移动到 `published/`
5. **提交代码**：Git 提交并推送

---

**最后更新**：2026.02.03
**维护者**：Tech Radar Team
