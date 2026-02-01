---
author_ids:
  - "lisa_chen"
  - "li_ming"
title: "React 19 Server Components 深度实践"
description: "两位前端工程师分享在大型项目中落地 React Server Components 的经验与挑战。"
---

## 核心概念

React Server Components 允许在服务端渲染组件，减少客户端 JavaScript 体积：

```tsx
// app/page.tsx - Server Component
async function ProductList() {
  // 直接在服务端访问数据库
  const products = await db.products.findMany();

  return (
    <ul>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </ul>
  );
}
```

## 客户端交互

需要交互的组件使用 `"use client"` 指令：

```tsx
"use client";

import { useState } from "react";

export function AddToCart({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);

  return (
    <button onClick={() => addToCart(productId)} disabled={loading}>
      {loading ? "Adding..." : "Add to Cart"}
    </button>
  );
}
```

## 性能提升

在我们的电商项目中，首屏加载时间减少了 40%，JavaScript 包体积减少了 60%。
