# Tech Radar Weekly | 技术雷达周刊

一个极具科技感的技术周刊单页模板，支持 Markdown 内容管理。

## 🎨 特性

- **赛博朋克风格设计**：暗黑模式 + 霓虹发光效果
- **Markdown 内容管理**：内容与展示完全解耦
- **响应式布局**：完美适配移动端和桌面端
- **交互功能**：点赞、阅读量统计、侧边栏导航
- **代码高亮**：支持多种编程语言的语法高亮

## 📁 项目结构

```
tech_radar_web/
├── index.html                    # 动态加载版本（推荐使用）
├── weekly-tech-radar.html        # 静态版本（用于参考）
└── content/                      # 内容目录
    ├── archive.json              # 往期周刊索引
    └── vol-001/                  # 第 001 期内容
        ├── radar.md              # This Week's Radar 内容
        └── contributions/        # 投稿文章
            ├── 01-typescript-types.md
            ├── 02-react-virtual-list.md
            ├── 03-k8s-optimization.md
            └── 04-go-error-handling.md
```

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 本地预览

**推荐方式（完整功能）**：

```bash
npm start
# 或
node server.js
```

然后访问 `http://localhost:3000`

这种方式支持：
- ✅ 动态阅读量统计
- ✅ 点赞功能
- ✅ 往期列表动态加载
- ✅ 并发控制

**简单预览（静态文件服务器）**：

```bash
npx serve
# 或
python3 -m http.server 8000
```

然后访问 `http://localhost:3000` 或 `http://localhost:8000`

⚠️ 注意：使用静态服务器时，阅读量和点赞功能将不可用，往期列表从静态 `content/archive.json` 加载。

### 添加新一期周刊

1. **创建期刊目录**
```bash
mkdir -p content/vol-002/contributions
```

2. **创建 radar.md**

```markdown
---
vol: "002"
date: "2024.05.27"
editors:
  - author_id: "hys"
    role: "Chief Editor"
  - author_id: "dev_ops"
    role: "Technical Reviewer"
---

## Trending

### [分类] 标题
详细内容...
```

3. **创建投稿文章**

在 `content/vol-002/contributions/` 下创建 `.md` 文件：

```markdown
---
author_id: "zhang_wei"
title: "文章标题"
description: "简短描述"
---

\```language
// 你的代码
\```
```

注意：作者信息从 `content/authors/` 目录加载，只需引用 `author_id`。

4. **更新 archive.json**

```json
[
  {
    "vol": "002",
    "date": "2024.05.27",
    "active": true
  },
  {
    "vol": "001",
    "date": "2024.05.20",
    "active": false
  }
]
```

5. **更新 index.html 中的投稿文件列表**

在 `loadContributions` 函数中添加新的文件名。

## 📝 Markdown 格式说明

### Radar 文章 (radar.md)

```markdown
---
vol: "期数"
date: "日期"
editors:
  - author_id: "hys"
    role: "Chief Editor"
  - author_id: "dev_ops"
    role: "Technical Reviewer"
---

## Trending

### [徽章文本] 条目标题
详细内容...
```

支持的徽章样式：
- `[架构决策]` - 青色
- `[债务预警]` - 橙色
- `[工具推荐]` - 绿色
- `[安全更新]` - 粉色

### 投稿文章 (contributions/*.md)

```markdown
---
author_id: "zhang_wei"
title: "文章标题"
description: "文章描述"
---

\```language
代码内容
\```

或者普通的 markdown 文本内容
```

**说明**：
- `author_id`：引用 `content/authors/` 中的作者 ID
- 作者的名字、团队、头像等信息从作者文件中自动加载
- 阅读量和点赞数由服务器动态管理，不需要在文件中指定

## 👥 作者管理

### 添加新作者

在 `content/authors/` 目录下创建新的 Markdown 文件：

```bash
# 创建新作者文件
touch content/authors/new_author.md
```

文件内容格式：

```markdown
---
id: "new_author"
name: "@new_author"
team: "Team Name"
avatar: "/assets/images/avatars/new_author.jpg"
bio: "Short bio"
---
```

**注意**：
- `id` 必须唯一，用于在 radar.md 和 contributions 中引用
- `name` 通常以 @ 开头
- `avatar` 建议使用本地路径，图片放在 `assets/images/avatars/` 目录
- `team` 是作者所属的团队
- `bio` 是简短的个人简介

### 使用作者

在 `radar.md` 中引用编辑：

```yaml
editors:
  - author_id: "new_author"
    role: "Contributor"
```

在投稿文章中引用作者：

```yaml
author_id: "new_author"
```

## 🎯 自定义样式

所有样式变量都在 `index.html` 的 `:root` 中定义：

```css
:root {
    --bg-primary: #0a0a0a;        /* 主背景色 */
    --accent-cyan: #00f3ff;       /* 强调色（青色）*/
    --accent-pink: #ff00ff;       /* 强调色（粉色）*/
    /* ... */
}
```

## 🔧 技术栈

- **纯前端**：无需后端服务器
- **Marked.js**：Markdown 解析
- **js-yaml**：YAML frontmatter 解析
- **Highlight.js**：代码语法高亮
- **Google Fonts**：Inter + JetBrains Mono

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
