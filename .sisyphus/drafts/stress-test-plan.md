# Draft: Tech Radar Weekly 千级压力测试计划

## User Request Summary
为 Tech Radar Weekly 项目制定详细的千级压力测试计划，包括完整的测试目标、工具选择、场景设计、性能指标、执行步骤和成功标准。

## Key Project Context
- **项目类型**: Tech Radar Weekly (赛博朋克风格技术周刊单页应用)
- **技术栈**: Express.js + Vanilla JS前端
- **核心架构组件**:
  - Cache类 (内存缓存, TTL过期)
  - AsyncMutex (异步互斥锁, 5秒超时)
  - RateLimiter (速率限制: 读240/分钟, 写20/分钟)
  - WriteQueue (防抖写入队列, 最大并发写入10个)
- **现有测试结构**: tests/目录包含unit, integration, e2e测试框架
- **性能关键点**: 并发控制、缓存TTL、文件I/O、速率限制

## Clarified Requirements

### 1. Concurrency Definition
- **目标**: 1000个并发用户同时访问系统
- **模式**: 模拟真实用户行为（浏览期刊、阅读文章、点赞等）
- **持续时间**: 5-10分钟持续负载

### 2. Test Environment
- **环境**: 本地开发和测试环境
- **硬件**: 使用现有开发者机器
- **要求**: 无需特殊云环境，可在本地运行

### 3. User Behavior Simulation
真实用户模式包括：
- 浏览期刊列表（GET /api/volumes）
- 查看期刊详情（GET /api/contributions/:vol）
- 阅读配置信息（GET /api/config）
- 点赞操作（POST /api/likes/:articleId）
- 增加阅读量（POST /api/views/:vol）

### 4. Test Duration Pattern
- **爬升阶段**: 30秒内从0到1000并发用户
- **稳定负载**: 5分钟保持1000并发用户
- **下降阶段**: 30秒内从1000降到0

### 5. Success Criteria
- **响应时间**: 95th百分位 < 200ms
- **错误率**: < 1%
- **系统状态**: 保持完全功能，不崩溃
- **速率限制**: 正常工作，防止滥用
- **缓存命中率**: > 80%

### 6. Tool Preferences
- **主要工具**: Autocannon（快速基准测试）+ Artillery（复杂场景测试）
- **集成**: 集成到现有测试框架
- **执行**: 通过`npm run test:performance`执行

## Research Findings
- 现有测试框架结构完整，但主要是占位符代码
- 服务器已内置并发控制和速率限制机制
- 配置参数可调节（MAX_CONCURRENT_WRITES=10, RATE_LIMIT等）
- 使用Node.js生态系统，可利用丰富的性能测试工具
- 已有API端点完整，支持所有需要的用户行为

## Technical Decisions
- **性能测试工具**: Autocannon + Artillery组合
- **测试环境**: 本地Docker容器隔离（可选）
- **监控**: 内置性能指标收集
- **报告**: HTML格式详细报告

## Plan Structure
1. 环境准备和依赖安装
2. 基础性能基准测试（Autocannon）
3. 复杂场景压力测试（Artillery）
4. 监控和分析工具
5. 执行脚本和CI/CD集成