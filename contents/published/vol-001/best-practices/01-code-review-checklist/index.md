---
author_id: "huyusong"
title: "Code Review 清单：让每一次 Review 都有价值"
description: "一份经过团队实践验证的 Code Review 清单，覆盖可读性、安全性、性能等核心维度，帮助团队建立高质量的代码审查文化。"
---

好的 Code Review 不只是找 bug，更是知识传递和团队对齐的过程。以下是我们团队沉淀的检查维度：

## 可读性

- 变量/函数命名是否清晰表达意图？
- 复杂逻辑是否有必要的注释？
- 函数是否保持单一职责，长度适中？

## 安全性

- 用户输入是否经过校验和转义？
- 是否存在敏感信息（密钥、密码）硬编码？
- SQL/命令拼接是否使用了参数化处理？

## 性能

- 是否存在 N+1 查询问题？
- 循环内是否有不必要的重复计算或 DOM 操作？
- 大数据量场景是否考虑了分页或懒加载？

## 可测试性

```typescript
// 推荐：依赖注入，易于 mock
class OrderService {
  constructor(private readonly repo: OrderRepository) {}

  async create(data: CreateOrderDto) {
    return this.repo.save(data);
  }
}

// 不推荐：直接依赖具体实现，难以测试
class OrderService {
  async create(data: CreateOrderDto) {
    return new OrderRepository().save(data); // 无法 mock
  }
}
```

## 向后兼容

- API 变更是否向后兼容，或已通过版本控制隔离？
- 数据库迁移是否可回滚？

坚持使用清单，不是为了机械检查，而是帮助 reviewer 把注意力放在真正重要的地方。
