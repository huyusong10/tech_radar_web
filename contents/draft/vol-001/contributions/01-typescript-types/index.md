---
author_id: "zhang_wei"
title: "TypeScript 5.0 装饰器实战"
description: "探索 TypeScript 5.0 正式支持的 ECMAScript 装饰器在实际项目中的应用场景。"
---

## 方法装饰器

TypeScript 5.0 正式支持 ECMAScript 装饰器：

```typescript
function logged<T extends (...args: any[]) => any>(
  target: T,
  context: ClassMethodDecoratorContext
) {
  const methodName = String(context.name);

  return function (...args: Parameters<T>): ReturnType<T> {
    console.log(`Calling ${methodName}`);
    return target.apply(this, args);
  };
}

class Calculator {
  @logged
  add(a: number, b: number) {
    return a + b;
  }
}
```

## const 类型参数

更精确的类型推断：

```typescript
function createConfig<const T>(config: T): T {
  return config;
}

// 类型保留字面量
const config = createConfig({ apiUrl: "https://api.example.com" });
```
