# Tech Radar 压力测试和性能测试套件

## 概述

这是一个完整的压力测试和性能测试套件，专为 Tech Radar Weekly 项目设计。支持千级并发压力测试、性能基准测试和多种测试场景。

## 特性

- **千级并发测试**：支持1000+并发用户测试
- **多种测试场景**：8种负载测试场景 + 8种性能测试场景
- **自动化报告**：自动生成HTML、JSON、CSV报告
- **性能评分**：自动计算性能评分和优化建议
- **易于使用**：一键运行测试套件
- **持续集成**：支持CI/CD集成

## 目录结构

```
tests/
├── README.md                    # 本文档
├── run-tests.sh                 # 测试运行脚本
├── config/
│   └── load-test-config.js      # 测试配置
├── scripts/
│   ├── load-test.js             # 负载测试主脚本
│   └── performance-test.js      # 性能测试主脚本
├── reports/                     # 测试报告（自动生成）
├── results/                     # 原始测试结果（CSV）
└── archive/                     # 历史测试报告归档
```

## 快速开始

### 1. 安装依赖

```bash
# 安装k6（macOS）
brew install k6

# 安装k6（Linux）
sudo apt-get update && sudo apt-get install k6

# 安装k6（Windows）
choco install k6
```

### 2. 启动服务器

```bash
# 在项目根目录
npm start
# 或
node server.js
```

### 3. 运行快速测试

```bash
# 给脚本执行权限
chmod +x tests/run-tests.sh

# 检查服务器状态
./tests/run-tests.sh check

# 运行快速测试套件
./tests/run-tests.sh quick
```

## 测试场景

### 负载测试场景

| 场景 | 描述 | 并发用户 | 持续时间 | 用途 |
|------|------|----------|----------|------|
| `quick` | 快速测试 | 50 | 30秒 | 开发环境快速验证 |
| `medium` | 中等负载 | 200 | 2分钟 | 模拟正常生产负载 |
| `high` | 高负载 | 500 | 3分钟 | 压力测试 |
| `extreme` | 极限压力 | 1000 | 5分钟 | 千级并发测试 |
| `spike` | 峰值测试 | 100→1000 | 1分钟 | 突发流量测试 |
| `endurance` | 耐力测试 | 300 | 10分钟 | 长时间运行测试 |
| `concurrent` | 并发读写 | 200 | 2分钟 | 并发控制测试 |
| `api_endpoints` | API端点测试 | 100 | 1.5分钟 | API专项测试 |

### 性能测试场景

| 场景 | 描述 | 测试重点 | 用途 |
|------|------|----------|------|
| `concurrency` | 并发连接测试 | 并发处理能力 | 测试系统并发上限 |
| `throughput` | 吞吐量测试 | 请求处理速率 | 测试最大吞吐量 |
| `latency` | 延迟测试 | 响应时间 | 测试系统延迟 |
| `stability` | 稳定性测试 | 长时间运行稳定性 | 测试内存泄漏和稳定性 |
| `memory` | 内存测试 | 内存使用模式 | 测试内存泄漏 |
| `database` | 数据库连接测试 | 数据库连接池 | 测试数据库性能 |
| `cache` | 缓存性能测试 | 缓存命中率 | 测试缓存效果 |
| `comprehensive` | 综合性能测试 | 全面性能指标 | 完整性能评估 |

## 使用方法

### 基本命令

```bash
# 显示帮助
./tests/run-tests.sh help

# 检查服务器状态
./tests/run-tests.sh check

# 运行快速测试套件
./tests/run-tests.sh quick

# 运行完整测试套件
./tests/run-tests.sh full

# 运行极限压力测试（1000并发）
./tests/run-tests.sh extreme

# 运行耐力测试（长时间运行）
./tests/run-tests.sh endurance

# 生成测试报告
./tests/run-tests.sh report

# 清理旧报告（7天前）
./tests/run-tests.sh cleanup
```

### 运行特定测试场景

```bash
# 运行特定负载测试
./tests/run-tests.sh load quick      # 快速负载测试
./tests/run-tests.sh load medium     # 中等负载测试
./tests/run-tests.sh load high       # 高负载测试
./tests/run-tests.sh load extreme    # 极限压力测试

# 运行特定性能测试
./tests/run-tests.sh perf concurrency    # 并发测试
./tests/run-tests.sh perf throughput     # 吞吐量测试
./tests/run-tests.sh perf latency        # 延迟测试
./tests/run-tests.sh perf cache          # 缓存测试
```

### 环境变量

```bash
# 自定义测试服务器URL
BASE_URL="http://your-server:port" ./tests/run-tests.sh quick

# 在CI/CD中使用
export BASE_URL="http://staging.example.com"
./tests/run-tests.sh full
```

## 测试报告

### 报告文件

测试完成后会自动生成以下报告：

1. **HTML报告**：可视化测试结果 (`reports/*.html`)
2. **JSON报告**：原始测试数据 (`reports/*.json`)
3. **CSV报告**：原始指标数据 (`results/*.csv`)
4. **Markdown总结**：测试总结报告 (`reports/test-report-*.md`)

### 性能指标

测试报告包含以下关键性能指标：

- **响应时间**：P50、P90、P95、P99百分位数
- **吞吐量**：每秒请求数 (RPS)
- **错误率**：请求失败比例
- **并发用户数**：同时在线用户数
- **数据量**：发送和接收的数据量

### 性能评分

系统会自动计算性能评分（0-100分）：

- **90-100分**：优秀 - 系统性能卓越
- **75-89分**：良好 - 系统性能良好，有小幅优化空间
- **60-74分**：一般 - 系统性能一般，需要优化
- **0-59分**：较差 - 系统性能较差，需要立即优化

报告会包含具体的优化建议。

## 配置说明

### 测试配置

配置文件：`tests/config/load-test-config.js`

主要配置项：

```javascript
{
    baseUrl: 'http://localhost:5090',  // 测试服务器URL
    
    scenarios: {
        // 测试场景配置
        quick: {
            name: '快速测试',
            stages: [
                { duration: '10s', target: 10 },
                { duration: '10s', target: 50 },
                { duration: '10s', target: 50 },
            ],
            thresholds: {
                http_req_duration: ['p(95)<1000'],
                http_req_failed: ['rate<0.01'],
            }
        },
        // ... 其他场景
    },
    
    endpoints: {
        // API端点配置
        read: [
            { method: 'GET', path: '/api/config', name: 'config_api' },
            // ... 其他端点
        ],
        write: [
            { method: 'POST', path: '/api/likes/article-id', name: 'like_api' },
            // ... 其他端点
        ]
    }
}
```

### 性能阈值

配置文件中的性能阈值：

```javascript
thresholds: {
    excellent: {
        responseTime: 1000,  // 1秒以内
        errorRate: 0.001,    // 0.1%错误率
        throughput: 100,     // 100请求/秒
    },
    good: {
        responseTime: 2000,  // 2秒以内
        errorRate: 0.005,    // 0.5%错误率
        throughput: 50,      // 50请求/秒
    },
    // ... 其他等级
}
```

## 集成到CI/CD

### GitHub Actions 示例

```yaml
name: Performance Tests

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  performance-test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Install k6
      run: |
        sudo apt-get update
        sudo apt-get install -y k6
    
    - name: Start server
      run: npm start &
      env:
        NODE_ENV: test
    
    - name: Wait for server
      run: sleep 10
    
    - name: Run quick tests
      run: ./tests/run-tests.sh quick
    
    - name: Upload test reports
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: performance-reports
        path: tests/reports/
    
    - name: Check performance thresholds
      run: |
        # 检查性能是否达标
        # 这里可以添加自定义的性能检查逻辑
        echo "Performance check completed"
```

### Jenkins Pipeline 示例

```groovy
pipeline {
    agent any
    
    stages {
        stage('Build') {
            steps {
                sh 'npm ci'
            }
        }
        
        stage('Start Server') {
            steps {
                sh 'npm start &'
                sh 'sleep 10'
            }
        }
        
        stage('Performance Test') {
            steps {
                sh './tests/run-tests.sh quick'
                sh './tests/run-tests.sh load medium'
            }
        }
        
        stage('Generate Report') {
            steps {
                sh './tests/run-tests.sh report'
                archiveArtifacts artifacts: 'tests/reports/**', fingerprint: true
            }
        }
    }
    
    post {
        always {
            sh 'pkill -f "node server.js" || true'
        }
    }
}
```

## 最佳实践

### 1. 测试环境

- **开发环境**：使用 `quick` 场景进行快速验证
- **测试环境**：使用 `medium` 和 `high` 场景进行完整测试
- **预生产环境**：使用 `extreme` 和 `endurance` 场景进行压力测试

### 2. 测试频率

- **每次提交**：运行 `quick` 测试
- **每日构建**：运行 `full` 测试套件
- **版本发布**：运行 `extreme` 和 `endurance` 测试

### 3. 性能监控

- 建立性能基准线
- 监控性能趋势变化
- 设置性能告警阈值

### 4. 优化建议

根据测试结果：

1. **响应时间慢**：优化数据库查询、添加缓存、优化代码逻辑
2. **吞吐量低**：增加服务器资源、优化并发处理、使用负载均衡
3. **错误率高**：修复bug、增加错误处理、优化API设计
4. **内存泄漏**：检查内存使用、优化资源释放、使用内存分析工具

## 故障排除

### 常见问题

1. **服务器无法访问**
   ```
   ./tests/run-tests.sh check
   ```
   确保服务器正在运行且端口正确。

2. **k6未安装**
   ```
   k6 version
   ```
   按照安装指南安装k6。

3. **测试失败**
   - 检查服务器日志
   - 检查网络连接
   - 查看测试报告中的错误信息

4. **性能不达标**
   - 分析测试报告中的瓶颈
   - 检查服务器资源使用情况
   - 优化代码和配置

### 调试模式

```bash
# 详细输出
SCENARIO=quick k6 run --verbose tests/scripts/load-test.js

# 调试特定VU
SCENARIO=quick k6 run --vus 1 --iterations 1 tests/scripts/load-test.js
```

## 扩展和自定义

### 添加新的测试场景

1. 在 `load-test-config.js` 中添加新的场景配置
2. 在 `load-test.js` 或 `performance-test.js` 中添加对应的测试函数
3. 在 `run-tests.sh` 中更新测试映射

### 自定义性能指标

1. 在测试脚本中添加自定义指标
2. 更新性能评分算法
3. 自定义报告格式

### 集成其他测试工具

可以扩展支持：
- JMeter
- Gatling
- Locust
- Apache Bench (ab)

## 贡献指南

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 许可证

MIT License

## 支持

如有问题或建议，请提交 Issue 或 Pull Request。

---

*最后更新: 2026年1月*