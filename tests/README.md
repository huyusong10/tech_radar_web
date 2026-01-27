# Tech Radar Web 压力测试文档

## 📋 概述

本文档详细描述 Tech Radar Web 项目的压力测试和性能测试方案，包括测试环境、测试场景、执行方法等。

## 🎯 目标

1. **验证系统稳定性**：测试系统在千级并发下的稳定性和响应能力
2. **性能基准测试**：确定系统性能指标（响应时间、吞吐量等）
3. **识别瓶颈**：通过压力测试发现系统潜在瓶颈
4. **自动化测试**：集成自动化测试到 CI/CD 流程

## 📦 测试工具

### k6
K6 是现代的负载测试工具，使用 JavaScript 编写测试场景。

**安装方法：**

```bash
# macOS
brew install k6

# Linux
wget https://github.com/grafana/k6/releases/download/v0.52.2/k6-0.52.2-linux-amd64.tar.gz
tar -xzf k6-0.52.2-linux-amd64.tar.gz
sudo mv k6-0.52.2-linux-amd64/k6 /usr/local/bin/

# 使用 npm 安装
npm install -g k6
```

## 🧪 测试场景

### 1. 快速测试 (Quick Test)

**目的：** 验证服务器基本功能

**配置：**
- 并发用户数: 50 VUs
- 持续时间: 30秒
- 测试类型: 微基准测试

**使用方法：**

```bash
# 使用 npm 运行
node tests/k6/runner.js quick

# 使用 sh 脚本
bash tests/k6/run-test.sh quick

# 自定义 URL
K6_API_URL=http://localhost:5090 node tests/k6/runner.js quick
```

**预期结果：**
- 所有 API 端点响应时间 < 300ms
- 错误率 < 5%

---

### 2. 性能测试 (Performance Test)

**目的：** 测试系统性能指标

**配置：**
- 场景: 微基准测试
- 并发用户数: 10 VUs
- 迭代次数: 100 次
- 持续时间: 30秒

**使用方法：**

```bash
# 从 npm 包运行
K6_API_URL=http://localhost:5090 node tests/k6/runner.js performance

# 详细输出
k6 run --out console tests/k6/performance-test.js
```

**预期结果：**
- API 性能: P95 < 100ms, P99 < 200ms
- 缓存效率: P95 < 50ms
- 错误率 < 1%

---

### 3. 长时间测试 (Long Test)

**目的：** 测试系统长时间运行的稳定性

**配置：**
- 并发用户数: 20 VUs
- 持续时间: 5分钟

**使用方法：**

```bash
node tests/k6/runner.js long
```

**预期结果：**
- 需求指标同性能测试
- 长时间运行无内存泄漏

---

### 4. 快速压力测试 (Quick Stress Test)

**目的：** 轻量级压力测试

**配置：**
- 并发用户数: 100 VUs
- 持续时间: 1分钟

**使用方法：**

```bash
bash tests/k6/run-test.sh quick
```

---

### 5. 完整压力测试 (Full Stress Test)

**目的：** 千级并发极限压力测试

**配置：**

| 阶段 | 时长 | 并发数 |
|------|------|--------|
| 阶段1 | 30秒 | 0 → 50 |
| 阶段2 | 30秒 | 50 → 100 |
| 阶段3 | 30秒 | 100 → 200 |
| 阶段4 | 1分钟 | 200 → 500 |
| 阶段5 | 1分钟 | 500 → 1000 |
| 阶段6 | 30秒 | 1000 → 0 |

**使用方法：**

```bash
# 使用脚本
bash tests/k6/run-test.sh full

# 使用 JS 运行器
node tests/k6/runner.js full

# 自定义环境
K6_API_URL=http://your-server.com node tests/k6/runner.js full
```

**预期结果：**
- 95% 请求在 500ms 内完成
- 99% 请求在 1000ms 内完成
- 错误率 < 5%
- 吞吐量 > 100 req/s

---

### 6. 单场景测试 (Scenario Test)

**目的：** 测试特定的业务场景

**场景类型：**

| 场景 | 测试内容 |
|------|----------|
| `home` | 首页加载、配置获取 |
| `volume` | 期次列表访问 |
| `contributions` | 文章列表访问 |
| `likes` | 点赞功能测试 |
| `views` | 阅读量统计测试 |
| `load_balance` | 负载均衡测试 |

**使用方法：**

```bash
# 基础使用
node tests/k6/runner.js scenario volume

# 指定参数
node tests/k6/runner.js scenario volume 100 2m

# 参数说明
# node runner.js scenario <name> [vus] [duration]
```

---

### 7. GitHub Actions 自动化测试

**触发方式：**

1. **快速测试**：每次推送到 main 分支自动执行
2. **性能测试**：每次 PR 自动执行
3. **深度压力测试**：手动触发 workflow_dispatch

**查看测试报告：**

1. 进入 GitHub 仓库的 "Actions" 标签页
2. 点击具体的 workflow 运行
3. 查看 "Artifacts" 部分下载测试报告
4. 报告包括：
   - JSON 格式数据
   - HTML 格式可视报告

---

## 📊 测试指标

### 核心指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| **P50** | < 200ms | 50% 的请求响应时间 |
| **P95** | < 500ms | 95% 的请求响应时间 |
| **P99** | < 1000ms | 99% 的请求响应时间 |
| **最小值** | < 50ms | 最好的响应时间 |
| **最大值** | < 2000ms | 最慢的请求响应时间 |
| **错误率** | < 1% (性能测试) / < 5% (压力测试) | 失败请求比例 |
| **吞吐量** | > 100 req/s | 每秒处理请求数 |

### 辅助指标

- **缓存效率**: 缓存请求响应时间
- **并发响应时间**: 并发请求的平均响应时间
- **数据库速度**: 数据库读写操作响应时间
- **请求数**: 总请求数量
- **虚拟用户数**: 当前并发用户数

---

## 🔧 环境配置

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `K6_API_URL` | http://localhost:5090 | API 服务器地址 |
| `K6_VOLUME_ID` | 1 | 测试使用的卷编号 |
| `K6_TEST_MODE` | full | 测试模式 (quick/full/performance) |
| `K6_DURATION` | 5m | 测试持续时间 |
| `K6_VUS` | 1000 | 最大并发用户数 |

### 环境设置

```bash
# 1. 安装测试依赖
npm install

# 2. 启动服务器（在另一个终端）
node server.js

# 3. 运行测试（第三个终端）
node tests/k6/runner.js full
```

### 测试环境要求

- Node.js >= 18
- k6 >= 0.52.2
- 至少 4GB 可用内存
- 稳定的网络连接

---

## 📁 文件结构

```
tech_radar_web/
├── tests/
│   ├── k6/
│   │   ├── pressure-test.js      # 压力测试脚本
│   │   ├── performance-test.js   # 性能测试脚本
│   │   ├── k6-config.js         # K6 配置文件
│   │   ├── run-test.sh          # Bash 运行脚本
│   │   └── runner.js            # Node.js 运行器
│   ├── results/                 # 测试结果输出目录
│   └── test-config.js           # 测试配置文件
└── .github/
    ├── workflows/
    │   └── test.yml             # GitHub Actions 配置
```

---

## 📈 测试报告

### JSON 报告

测试结果以 JSON 格式输出，包含完整的测试指标：

```json
{
  "metrics": {
    "http_req_duration": {
      "avg": 145.3,
      "p(50)": 120.5,
      "p(95)": 450.2,
      "p(99)": 890.1,
      "min": 45.3,
      "max": 1920.3
    },
    "http_req_failed": {
      "rate": 0.012
    },
    "http_reqs": {
      "value": 150000,
      "rate": 500
    }
  }
}
```

### HTML 报告

测试结果以 HTML 格式提供可视化图表：

- 折线图显示性能趋势
- 表格展示详细指标
- 状态徽章显示测试结果

---

## ⚠️ 注意事项

1. **服务器状态**
   - 测试前确保服务器已启动
   - 文件系统有足够的可用空间

2. **测试时机**
   - 避免在业务高峰期进行压力测试
   - 建议在测试环境进行

3. **资源限制**
   - 千级并发测试需要充足的服务器资源
   - 建议使用 2核以上 CPU

4. **观察指标**
   - 监控服务器 CPU/内存使用率
   - 关注数据库连接数
   - 观察错误日志

5. **测试安全**
   - 不要在生产环境直接测试
   - 限制网络访问范围
   - 确保有回滚方案

---

## 🛠️ 故障排查

### 问题 1: k6 未找到

**解决方案:**

```bash
# macOS
brew install k6

# Linux
wget https://github.com/grafana/k6/releases/download/v0.52.2/k6-0.52.2-linux-amd64.tar.gz
tar -xzf k6-0.52.2-linux-amd64.tar.gz
sudo mv k6-0.52.2-linux-amd64/k6 /usr/local/bin/
```

### 问题 2: 服务器连接失败

**解决方案:**

```bash
# 检查服务器是否运行
curl http://localhost:5090

# 使用正确的 API URL
K6_API_URL=http://your-server:port node tests/k6/runner.js quick
```

### 问题 3: 内存不足

**解决方案:**

```bash
# 减少并发用户数
# 在 runner.js 中修改配置
const CONFIG = {
    max_concurrent: 500
};
```

### 问题 4: 性能测试未通过

**建议:**

1. 检查服务器配置是否满足要求
2. 查看详细日志输出
3. 优化服务器响应速度
4. 调整测试阈值

---

## 📚 相关文档

- [k6 官方文档](https://k6.io/docs/)
- [k6 示例](https://k6.io/docs/examples/)
- [Tech Radar Web README](./README.md)
- [Tech Radar Web API 文档](./CLAUDE.md)

---

## 🤝 贡献

如果发现测试问题或有改进建议，请：

1. 创建 Issue 描述问题
2. 或直接提交 Pull Request

---

## 📝 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2026-01-28 | 初始版本 |
|        |            | - 千级并发压力测试 |
|        |            | - 性能测试套件 |
|        |            | - 自动化测试集成 |
|        |            | - 多种运行方式 |

---

**最后更新:** 2026-01-28
**维护者:** Tech Radar Web Team