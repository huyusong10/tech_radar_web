# Tech Radar Weekly | 技术雷达周刊

一个极具科技感的技术周刊单页模板，支持 Markdown 内容管理。

## 特性

- **赛博朋克风格设计**：暗黑模式 + 霓虹发光效果
- **Markdown 内容管理**：内容与展示完全解耦
- **响应式布局**：完美适配移动端和桌面端
- **交互功能**：点赞、阅读量统计、侧边栏导航
- **代码高亮**：支持多种编程语言的语法高亮
- **热重载**：文件变更自动刷新浏览器
- **草稿预览**：支持草稿模式预览未发布内容

## 项目结构

```
tech_radar_web/
├── index.html              # 前端页面
├── server.js               # Node.js 服务器（API + 热重载 + 并发控制）
├── site.config.js          # 站点配置文件
├── package.json            # 依赖配置
├── README.md               # 用户文档
├── CLAUDE.md               # AI 助手指南
└── contents/               # 内容目录（可配置外部路径）
    ├── published/          # 已发布的周刊
    │   ├── vol-001/
    │   │   ├── radar.md
    │   │   └── contributions/
    │   │       ├── 01-article-name/
    │   │       │   ├── index.md
    │   │       │   └── *.svg/png
    │   │       └── ...
    │   └── vol-002/
    ├── draft/              # 草稿（预览用）
    │   └── vol-001/
    ├── shared/             # 共享配置
    │   ├── config.md       # 站点标题、slogan
    │   ├── authors.md      # 作者档案
    │   └── submit-guide.md # 投稿指南
    ├── assets/             # 静态资源
    │   └── images/
    │       └── avatars/    # 作者头像
    └── data/               # 运行时数据（自动生成）
        ├── likes.json      # 点赞数据
        └── views.json      # 阅读量数据
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务器

```bash
npm start
# 或
node server.js
```

然后访问 `http://localhost:5090`

### 服务器功能

- 动态阅读量统计
- 点赞功能
- 往期列表动态加载
- 热重载（文件修改后自动刷新）
- 并发控制与速率限制
- 内存缓存
- 优雅关闭（数据持久化）

### 草稿预览

访问 `http://localhost:5090?draft=true` 可预览 `contents/draft/` 目录下的草稿内容。

## 配置说明

### site.config.js

```javascript
const config = {
    // 内容目录路径（支持相对或绝对路径）
    contentsDir: './contents',

    // 服务器配置
    server: {
        port: 5090
    }
};
```

**外部内容目录**：可将 `contentsDir` 配置为外部路径，实现代码与内容分离，便于独立升级。

## 添加新一期周刊

1. **创建期刊目录**
```bash
mkdir -p contents/published/vol-002/contributions
```

2. **创建 radar.md**

```markdown
---
vol: "002"
date: "2024.05.27"
editors:
  - author_id: "huyusong"
    role: "Chief Editor"
  - author_id: "dev_ops"
    role: "Technical Reviewer"
---

## Trending

### [架构决策] 标题
详细内容...
```

3. **创建投稿文章**

在 `contributions/` 下创建文章文件夹：

```bash
mkdir contents/published/vol-002/contributions/01-article-name
```

创建 `index.md`：

```markdown
---
author_id: "zhang_wei"
title: "文章标题"
description: "简短描述"
---

正文内容...

\```typescript
// 代码示例
\```
```

4. **重启服务器**（或等待热重载）

服务器会自动检测 `vol-*` 目录并生成 `archive.json`。

## Markdown 格式说明

### Radar 文章 (radar.md)

支持的徽章样式：
- `[架构决策]` - 青色
- `[债务预警]` - 橙色
- `[工具推荐]` - 绿色
- `[安全更新]` - 粉色

### 投稿文章 (contributions/*/index.md)

- `author_id`：引用 `contents/shared/authors.md` 中的作者 ID
- 图片使用相对路径（如 `./diagram.svg`）
- 阅读量和点赞数由服务器动态管理

## 作者管理

所有作者信息集中在 `contents/shared/authors.md`：

```markdown
---
authors:
  - id: "zhang_wei"
    name: "@zhang_wei"
    team: "Core Platform Team"
    avatar: "/contents/assets/images/avatars/zhang_wei.jpg"
    role: "Senior Developer"
---
```

## 自定义样式

所有样式变量都在 `index.html` 的 `:root` 中定义：

```css
:root {
    --bg-primary: #0a0a0a;
    --accent-cyan: #00f3ff;
    --accent-pink: #ff00ff;
    /* ... */
}
```

## 技术栈

**后端**：
- Express.js - Web 服务器
- chokidar - 文件监控（热重载）
- js-yaml - YAML 解析

**前端**：
- Vanilla JavaScript
- Marked.js - Markdown 解析
- Highlight.js - 代码高亮
- Google Fonts (Inter + JetBrains Mono)

## API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config` | GET | 获取站点配置 |
| `/api/authors` | GET | 获取所有作者 |
| `/api/volumes` | GET | 获取期刊列表 |
| `/api/contributions/:vol` | GET | 获取某期投稿列表 |
| `/api/likes` | GET | 获取点赞数据 |
| `/api/likes/:articleId` | POST | 点赞/取消点赞 |
| `/api/views/:vol` | GET/POST | 获取/增加阅读量 |
| `/api/hot-reload` | GET | SSE 热重载连接 |
| `/api/health` | GET | 健康检查 |

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
