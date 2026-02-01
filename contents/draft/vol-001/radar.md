---
vol: "001"
date: "2026.02.08"
title: "云原生安全专刊（草稿）"
editors:
  - author_id: "huyusong"
    role: "Chief Editor"
  - author_id: "alex_wang"
    role: "Security Reviewer"
---

## Trending

### [安全更新] Kubernetes 1.29 安全特性全面解析
Kubernetes 1.29 带来了多项安全增强，包括 Pod Security Admission 的改进、Secret 加密的优化等。本文深入分析这些新特性对企业安全架构的影响。

### [架构决策] 零信任架构在微服务中的落地实践
分享我们团队在生产环境中实施零信任架构的经验，包括服务网格集成、mTLS 配置和身份认证策略。

### [工具推荐] Trivy：容器镜像漏洞扫描利器
Trivy 是一款轻量级的容器安全扫描工具，支持漏洞检测、配置审计和 SBOM 生成。已集成到我们的 CI/CD 流程中。

### [债务预警] 老旧认证服务升级计划启动
基于 OAuth 1.0 的遗留认证服务存在安全隐患，计划在 Q2 前完成向 OAuth 2.0 + OIDC 的迁移。
