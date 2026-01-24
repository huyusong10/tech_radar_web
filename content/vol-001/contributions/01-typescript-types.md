---
author:
  name: "@zhang_wei"
  team: "Core Platform Team"
  avatar: "https://i.pravatar.cc/150?img=33"
title: "优雅的 TypeScript 类型推导技巧"
description: "分享一个在实际项目中使用的高级 TypeScript 类型推导模式，能够大幅提升代码的类型安全性和开发体验。"
views: 1234
likes: 42
---

```typescript
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object
    ? DeepReadonly<T[P]>
    : T[P];
};

// 使用示例
const config: DeepReadonly<Config> = {...};
```
