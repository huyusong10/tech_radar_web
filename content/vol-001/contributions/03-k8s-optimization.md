---
author:
  name: "@alex_wang"
  team: "DevOps & Infrastructure"
  avatar: "https://i.pravatar.cc/150?img=12"
title: "Kubernetes 集群成本优化策略"
description: "通过合理配置资源请求和限制、使用节点自动伸缩以及 Spot 实例，我们将云基础设施成本降低了 40%。以下是关键配置策略："
---

```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "500m"
# 使用 HPA 实现自动伸缩
```
