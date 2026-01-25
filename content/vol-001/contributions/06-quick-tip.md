---
author_id: "zhang_wei"
title: "Git 分支管理最佳实践"
description: "一个简单但强大的 Git 分支命名规范，让团队协作更高效。"
---

**命名规范：**

```bash
feature/TICKET-123-short-description
bugfix/TICKET-456-issue-description
hotfix/critical-security-patch
release/v1.2.0
```

**删除已合并的本地分支：**

```bash
git branch --merged | grep -v "\*" | grep -v "main" | xargs -n 1 git branch -d
```

💡 **Pro Tip**: 使用 Git hooks 自动检查分支命名是否符合规范！
