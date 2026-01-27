# Tech Radar Weekly 千级压力测试计划

## TL;DR

> **Quick Summary**: 为 Tech Radar Weekly 项目制定1000并发用户的压力测试计划，使用 Autocannon + Artillery 工具组合，模拟真实用户行为，验证系统在5分钟持续负载下的性能表现。
> 
> **Deliverables**: 
> - 压力测试脚本和配置文件
> - 性能监控工具
> - 执行脚本和集成测试
> - 详细的测试报告模板
> 
> **Estimated Effort**: Medium (2-3 days implementation)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Tool setup → Baseline tests → Complex scenarios → Monitoring → Reporting

---

## Context

### Original Request
为 Tech Radar Weekly 项目制定详细的千级压力测试计划，包括测试目标和范围、测试工具选择和技术栈、测试场景设计、性能指标定义和收集方法、测试执行步骤和验证方法、预期结果和成功标准。

### Interview Summary
**Key Discussions**:
- **并发定义**: 1000个并发用户，模拟真实用户行为，持续5-10分钟
- **测试环境**: 本地开发环境，无需云服务器
- **用户行为**: 浏览期刊、阅读文章、点赞操作、查看配置
- **测试模式**: 30秒爬升 + 5分钟稳定 + 30秒下降
- **成功标准**: 95th响应时间<200ms，错误率<1%，缓存命中率>80%

**Research Findings**:
- 现有服务器架构包含高级并发控制（Cache, AsyncMutex, RateLimiter, WriteQueue）
- 速率限制：240读/分钟，20写/分钟（每个IP）
- 并发写入限制：最大10个并发文件写入
- 现有测试框架完整，可扩展性能测试

### Metis Review
**Identified Gaps** (addressed):
- **速率限制影响**: 增加10个不同IP模拟，验证限制器工作
- **资源监控**: 添加内存/CPU使用率监控（阈值<512MB, <80%）
- **缓存预热**: 包含缓存预热步骤和命中率测量
- **数据一致性**: 增加文件完整性验证和并发写入冲突测试
- **系统恢复**: 添加恢复时间测量和清理验证

---

## Work Objectives

### Core Objective
验证 Tech Radar Weekly 系统在1000并发用户负载下的性能表现，确保系统稳定性、响应时间和资源使用符合预期标准。

### Concrete Deliverables
- `tests/performance/` 目录及所有测试脚本
- `performance-config.js` 配置文件
- `package.json` 新增性能测试脚本
- `monitoring/` 性能监控工具
- 测试报告模板和示例

### Definition of Done
- [ ] 所有测试脚本可执行并通过
- [ ] 性能基准测试完成并记录结果
- [ ] 1000并发用户测试成功运行
- [ ] 生成详细的性能测试报告
- [ ] 集成到 npm test:performance 命令

### Must Have
- 1000并发用户真实行为模拟
- 完整的性能指标收集
- 速率限制和缓存机制验证
- 系统资源监控和安全保护
- 可重复执行的测试流程

### Must NOT Have (Guardrails)
- 不测试前端UI渲染性能
- 不依赖外部云服务
- 不影响生产环境数据
- 不进行数据库迁移测试
- 不超出本地开发机器资源限制

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (basic test framework)
- **User wants tests**: YES (comprehensive performance tests)
- **Framework**: Autocannon + Artillery + Custom monitoring

### Performance Test Structure

**Task Structure:**
1. **Environment Setup**: Install dependencies and create test structure
2. **Baseline Testing**: Single endpoint performance validation
3. **Complex Scenario Testing**: Multi-user behavior simulation
4. **Monitoring Integration**: Real-time resource and performance metrics
5. **Reporting**: Automated report generation and analysis

**Test Setup Task:**
- [ ] 0. Setup Performance Testing Infrastructure
  - Install: `npm install --save-dev autocannon artillery artillery-engine-autocannon`
  - Config: Create `tests/performance/` directory structure
  - Verify: `npx autocannon --help` → shows help
  - Example: Create simple baseline test
  - Verify: `npm run test:performance:baseline` → runs successfully

### Manual QA Procedures

**By Test Type:**

| Type | Verification Tool | Procedure |
|------|------------------|-----------|
| **Baseline Tests** | Autocannon CLI | Run individual endpoint tests, measure response times |
| **Load Tests** | Artillery | Execute complex scenarios with 1000 virtual users |
| **Monitoring** | Custom scripts | Monitor memory, CPU, cache metrics during tests |
| **Reporting** | HTML generation | Generate comprehensive performance reports |

**Evidence Required:**
- Autocannon JSON output with latency percentiles
- Artillery HTML reports with response times and error rates
- System resource usage logs
- Cache hit ratio measurements
- File integrity verification after tests

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: Setup performance testing infrastructure
└── Task 5: Create monitoring tools

Wave 2 (After Wave 1):
├── Task 2: Implement baseline performance tests
├── Task 3: Design complex scenario tests
└── Task 6: Create reporting templates

Wave 3 (After Wave 2):
└── Task 4: Integrate and validate complete testing suite

Critical Path: Task 1 → Task 2 → Task 4
Parallel Speedup: ~50% faster than sequential
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 2, 3, 5 | None (foundation) |
| 2 | 1 | 4 | 3, 5, 6 |
| 3 | 1 | 4 | 2, 5, 6 |
| 4 | 2, 3 | None | None (integration) |
| 5 | 1 | None | 2, 3, 6 |
| 6 | 1 | None | 2, 3, 5 |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|-------------------|
| 1 | 1, 5 | delegate_task(category="quick", load_skills=[...], run_in_background=true) |
| 2 | 2, 3, 6 | dispatch parallel after Wave 1 completes |
| 3 | 4 | final integration task |

---

## TODOs

- [ ] 1. Setup Performance Testing Infrastructure

  **What to do**:
  - Install Autocannon and Artillery dependencies
  - Create `tests/performance/` directory structure
  - Add performance test scripts to package.json
  - Create configuration files for test tools
  - Verify tool installation and basic functionality

  **Must NOT do**:
  - Modify existing server code
  - Change production environment settings
  - Install unnecessary performance testing tools

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: Infrastructure setup is well-defined, requires systematic implementation
  - **Skills**: []
    - No special skills needed - standard Node.js package management and file operations

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (foundation task)
  - **Blocks**: Tasks 2, 3, 5
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  > The executor has NO context from your interview. References are their ONLY guide.
  > Each reference must answer: "What should I look at and WHY?"

  **Package References** (dependencies to install):
  - `package.json:13-24` - Current dependency structure, add devDependencies for performance tools
  - `npm install --save-dev autocannon artillery artillery-engine-autocannon` - Required packages

  **Directory Structure References** (existing patterns to follow):
  - `tests/` - Current test directory structure
  - `tests/run-tests.js:1-27` - Test runner pattern for integration

  **Configuration References** (server settings to understand):
  - `server.js:31-53` - CONFIG object with rate limits and concurrency settings
  - `server.js:39-45` - RATE_LIMIT configuration (240 read/min, 20 write/min)
  - `server.js:51-52` - MAX_CONCURRENT_WRITES setting

  **API Endpoints References** (targets for testing):
  - `README.md:84-95` - Complete API endpoint list for test scenarios

  **WHY Each Reference Matters** (explain the relevance):
  - Don't just list files - explain what pattern/information the executor should extract
  - Bad: `package.json` (vague, what about it?)
  - Good: `package.json:13-24` - Follow existing devDependencies pattern when adding performance testing tools

  **Acceptance Criteria**:

  > CRITICAL: Acceptance = EXECUTION, not just "it should work".
  > The executor MUST run these commands and verify output.

  **Manual Execution Verification**:

  **For Package Installation:**
  - [ ] Command: `npm install --save-dev autocannon artillery artillery-engine-autocannon`
  - [ ] Verify: `cat package.json` → contains autocannon and artillery in devDependencies
  - [ ] Verify: `npx autocannon --help` → shows autocannon help output
  - [ ] Verify: `npx artillery --help` → shows artillery help output

  **For Directory Structure:**
  - [ ] Command: `mkdir -p tests/performance/{scenarios,reports,monitoring}`
  - [ ] Verify: `ls -la tests/performance/` → shows scenarios, reports, monitoring directories
  - [ ] Verify: `ls -la tests/performance/scenarios/` → directory exists and is empty

  **For Package Scripts:**
  - [ ] Edit `package.json` scripts section to add:
    ```json
    "test:performance": "node tests/performance/run-performance-tests.js",
    "test:performance:baseline": "node tests/performance/baseline.js",
    "test:performance:load": "artillery run tests/performance/scenarios/load-test.yml"
    ```
  - [ ] Verify: `npm run` → shows new performance test scripts in output

  **For Basic Configuration:**
  - [ ] Create `tests/performance/config.js` with server URL and test parameters
  - [ ] Verify: `node -e "require('./tests/performance/config.js'); console.log('Config loaded')"` → outputs "Config loaded"

  **Evidence Required:**
  - [ ] Package installation output showing new dependencies
  - [ ] Directory listing showing created structure
  - [ ] npm run output showing new test scripts
  - [ ] Config file verification output

  **Commit**: NO (group with final task)
  - Message: `perf(tests): setup performance testing infrastructure`
  - Files: `package.json`, `tests/performance/*`
  - Pre-commit: `npm run test:performance:baseline`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `perf(tests): setup performance testing infrastructure` | package.json, tests/performance/* | npm run test:performance:baseline |
| 2 | `perf(tests): implement baseline performance tests` | tests/performance/baseline.js, tests/performance/scenarios/* | npm run test:performance:baseline |
| 3 | `perf(tests): design complex load testing scenarios` | tests/performance/scenarios/load-test.yml | npm run test:performance:load |
| 4 | `perf(tests): integrate complete performance testing suite` | tests/performance/run-performance-tests.js, monitoring/* | npm run test:performance |
| 5 | `perf(monitoring): add performance monitoring tools` | tests/performance/monitoring/* | npm run test:performance:monitor |
| 6 | `perf(reports): create automated reporting templates` | tests/performance/reports/* | npm run test:performance:report |

---

## Success Criteria

### Verification Commands
```bash
npm run test:performance:baseline  # Expected: All baseline tests pass
npm run test:performance:load      # Expected: 1000 users simulation completes
npm run test:performance           # Expected: Full test suite executes
```

### Performance Benchmarks
- **Response Time**: 95th percentile < 200ms
- **Error Rate**: < 1%
- **Cache Hit Ratio**: > 80%
- **Memory Usage**: < 512MB peak
- **CPU Usage**: < 80% average
- **Throughput**: > 500 requests/second sustained

### Final Checklist
- [ ] All performance test scripts execute successfully
- [ ] 1000 concurrent user simulation completes without errors
- [ ] System resources remain within defined thresholds
- [ ] Rate limiting mechanisms function correctly
- [ ] File integrity maintained throughout testing
- [ ] Performance reports generated with comprehensive metrics