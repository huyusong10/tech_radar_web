---
author_id: "hys"
title: "[草稿] 示例投稿内容 - 待审核"
description: "这是一个草稿模式的示例投稿。编辑和审核人员可以在此预览内容格式和排版效果。"
---

这是草稿模式的示例内容。

## 主要功能

草稿模式允许编辑团队在正式发布前：

1. 预览内容排版效果
2. 检查代码高亮显示
3. 验证图片加载
4. 审核文章质量

```typescript
// 示例代码块
interface DraftConfig {
  isDraft: boolean;
  contentDir: string;
  previewUrl: string;
}

const config: DraftConfig = {
  isDraft: true,
  contentDir: 'content-draft',
  previewUrl: '/draft'
};
```

审核完成后，将内容从 `content-draft/` 移动到 `content/` 即可正式发布。
