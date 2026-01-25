---
vol: "001"
date: "2024.05.20"
title: "Weekly Tech Radar"
slogan: "Navigating the bleeding edge of technology, one week at a time."
---

## Trending

### [架构决策] 微服务架构迁移至 Event-Driven 模式完成
本次架构迁移覆盖了核心交易系统的 12 个微服务，采用 Apache Kafka 作为消息中间件。迁移后系统吞吐量提升 3 倍，延迟降低 40%。详细的迁移指南和最佳实践已更新至内部 Wiki。

### [债务预警] 遗留 API v1.x 版本将于下月弃用，请尽快迁移
API v1.x 将于 2024年6月30日正式下线。目前仍有 23 个内部服务在使用旧版本 API。请各团队尽快完成迁移，迁移文档和兼容性说明请参考 API Portal。

### [工具推荐] 团队内部开发的 DevOps CLI 工具已开源
dx-cli 工具集成了代码检查、依赖扫描、一键部署等功能，大幅提升开发效率。现已在 GitHub 开源，欢迎试用和贡献。安装命令：`npm install -g @our-org/dx-cli`

### [安全更新] 关键依赖包安全漏洞修复，请更新至最新版本
发现 lodash < 4.17.21 存在原型污染漏洞（CVE-2024-XXXX），建议立即更新。受影响项目清单已通过邮件发送至各团队负责人。
