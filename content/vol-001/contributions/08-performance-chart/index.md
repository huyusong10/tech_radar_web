---
author_id: "alex_wang"
title: "数据库查询性能优化实战"
description: "通过添加索引和查询重写，将慢查询从 5 秒优化到 50 毫秒的完整过程。"
---

## 优化前后对比

![Performance Chart](./performance-chart.svg)

## 问题定位

使用 `EXPLAIN ANALYZE` 发现全表扫描：

```sql
EXPLAIN ANALYZE
SELECT u.name, o.total, o.created_at
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.status = 'completed'
  AND o.created_at > '2024-01-01'
ORDER BY o.created_at DESC
LIMIT 20;
```

**发现的问题**：
- `orders.status` 列没有索引
- `orders.created_at` 列没有索引
- JOIN 条件使用了低选择性字段

## 优化方案

### 1. 添加复合索引

```sql
CREATE INDEX idx_orders_status_created
ON orders(status, created_at DESC);

CREATE INDEX idx_orders_user_id
ON orders(user_id);
```

### 2. 查询重写

```sql
-- 优化后的查询
SELECT u.name, o.total, o.created_at
FROM orders o
INNER JOIN users u ON o.user_id = u.id
WHERE o.status = 'completed'
  AND o.created_at > '2024-01-01'
ORDER BY o.created_at DESC
LIMIT 20;
```

## 性能指标

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 查询时间 | 5000ms | 50ms | 99% |
| 扫描行数 | 1,000,000 | 200 | 99.98% |
| CPU 使用率 | 85% | 5% | 94% |

## 经验总结

✅ **DO**:
- 为高频查询的 WHERE 条件添加索引
- 使用复合索引覆盖多个查询条件
- 定期运行 EXPLAIN 分析慢查询

❌ **DON'T**:
- 过度使用索引（影响写入性能）
- 在低选择性列上单独建索引
- 忽视索引维护成本
