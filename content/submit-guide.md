---
title: "How to Submit Your Work"
---

## 提交你的作品

我们欢迎所有工程师分享技术见解、代码片段、架构图和最佳实践。

### 文件夹结构

每个投稿应该是一个自包含的文件夹，结构如下：

```
your-article-name/
├── index.md          # 必需：文章入口文件
├── image1.svg        # 可选：文章中使用的图片
├── screenshot.png    # 可选：截图或示意图
└── diagram.svg       # 可选：架构图等
```

### index.md 格式

```markdown
---
author_id: "your_id"
title: "文章标题"
description: "简短描述（1-2句话）"
---

这里是文章正文内容...

![示意图](./your-image.svg)

## 代码示例

\`\`\`typescript
// 你的代码
\`\`\`
```

### Frontmatter 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `author_id` | 是 | 你在 authors.md 中的 ID |
| `title` | 是 | 文章标题 |
| `description` | 是 | 简短描述（显示在卡片中） |

### 图片使用

- 图片放在文件夹内，使用**相对路径**引用
- 推荐格式：SVG（矢量图）、PNG（截图）
- 建议尺寸：宽度不超过 1000px

### 示例投稿

```
my-awesome-tip/
├── index.md
└── demo.svg
```

**index.md 内容：**

```markdown
---
author_id: "zhang_wei"
title: "一个很棒的技巧"
description: "这是一个能提升开发效率的小技巧。"
---

## 背景

在日常开发中，我发现了一个有趣的模式...

![演示图](./demo.svg)

## 代码实现

\`\`\`typescript
const awesome = () => "Hello, Tech Radar!";
\`\`\`
```

### 提交流程

1. **准备文件夹**：按照上述结构创建文件夹
2. **编写内容**：在 index.md 中编写文章
3. **添加图片**：将相关图片放入同一文件夹
4. **打包发送**：将整个文件夹打包发送给编辑
5. **等待发布**：编辑会在下一期周刊中收录

### 联系方式

如有疑问，请联系编辑团队。

---

**期待你的精彩分享！**
