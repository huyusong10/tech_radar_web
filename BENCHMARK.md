# Tech Radar 性能测试与压力测试指南

## 概述

本项目包含完整的性能测试和压力测试工具，用于评估 Tech Radar 服务器在不同负载下的表现。

## 测试工具

### 1. 负载测试工具 (`load-test.js`)

模拟并发用户对服务器的请求，测试服务器在高负载下的表现。

#### 使用方式

```bash
# 基本用法 - 100并发，每用户100请求
node load-test.js

# 自定义参数
node load-test.js -u=200 -r=200 -t=mixed

# 查看详细输出
node load-test.js -v
```

#### 参数说明

| 参数 | 简写 | 说明 | 默认值 |
|------|------|------|--------|
| `--concurrency` | `-u` | 并发用户数 | 100 |
| `--requests` | `-r` | 每用户请求数 | 100 |
| `--test-type` | `-t` | 测试类型 | mixed |
| `--server-port` | `-s` | 服务器端口 | 5090 |
| `--verbose` | `-v` | 详细输出 | false |

#### 测试类型 (`test-type`)

- `mixed`: 混合测试（config, authors, volumes, health）
- `read`: 只读测试（config, authors, volumes, health, contributions）
- `write`: 写操作测试（views）
- `views`: 视图统计测试（views）
- `likes`: 点赞操作测试（likes）

#### 示例

```bash
# 模拟200个并发用户，每用户200次请求，只读测试
node load-test.js -u=200 -r=200 -t=read

# 测试视图统计接口，100并发
node load-test.js -u=100 -t=views

# 详细模式查看每个请求的响应
node load-test.js -v
```

### 2. 性能测试工具 (`performance-test.js`)

详细测量服务器响应时间、吞吐量和资源利用率。

#### 使用方式

```bash
# 基本用法 - 1000次请求
node performance-test.js

# 自定义参数
node performance-test.js -r=5000 -d=60 -t=throughput

# 输出到JSON文件
node performance-test.js -r=1000 -o=results.json

# 查看详细输出
node performance-test.js -v
```

#### 参数说明

| 参数 | 简写 | 说明 | 默认值 |
|------|------|------|--------|
| `--requests` | `-r` | 请求数量 | 1000 |
| `--duration` | `-d` | 测试持续时间（秒） | 30 |
| `--interval` | `-i` | 请求间隔（毫秒） | 10 |
| `--test-type` | `-t` | 测试类型 | single |
| `--concurrency` | `-c` | 并发级别 | 1 |
| `--output` | `-o` | 输出JSON文件 | null |
| `--verbose` | `-v` | 详细输出 | false |

#### 测试类型 (`test-type`)

- `single`: 单端点测试，测试每个端点的性能
- `throughput`: 吞吐量测试，最大化请求处理速度
- `stability`: 稳定性测试，持续负载下观察性能

#### 示例

```bash
# 5000次请求，持续60秒，吞吐量测试
node performance-test.js -r=5000 -d=60 -t=throughput

# 100并发，测试视图统计
node performance-test.js -r=1000 -c=100 -t=stability

# 测试所有端点，输出结果到文件
node performance-test.js -r=1000 -o=performance-results.json

# 详细模式，每个请求都显示
node performance-test.js -v
```

## 测试场景

### 场景1: 日常负载测试

```bash
# 模拟100并发用户，每人100次请求
node load-test.js -u=100 -r=100
```

**预期结果**: 成功率 >= 95%，平均响应时间 < 200ms

### 场景2: 高并发测试

```bash
# 模拟500并发用户
node load-test.js -u=500
```

**预期结果**: 成功率 >= 90%，系统仍能稳定响应

### 场景3: 吞吐量测试

```bash
# 测试最大吞吐量（2000次请求，20秒）
node performance-test.js -r=2000 -d=20 -t=throughput
```

**预期结果**: 吞吐量 >= 100 req/s

### 场景4: 稳定性测试

```bash
# 100并发，持续60秒稳定性测试
node performance-test.js -r=2000 -d=60 -t=stability -c=100
```

**预期结果**: 99分位延迟 < 500ms

### 场景5: 只读操作测试

```bash
# 测试只读接口性能
node load-test.js -u=200 -r=200 -t=read
```

**预期结果**: 成功率 >= 98%，缓存命中率高

### 场景6: 写操作测试

```bash
# 测试写操作（点赞/浏览量）
node load-test.js -u=50 -r=100 -t=views
```

**预期结果**: 成功率 >= 95%，并发写锁正常工作

## 结果解读

### 成功率 (Success Rate)

成功率是衡量服务器健康的重要指标：
- **>= 98%**: 优秀
- **>= 95%**: 良好
- **>= 90%**: 可接受
- **< 90%**: 需要优化

### 平均响应时间 (Average Latency)

- **< 100ms**: 优秀
- **100-200ms**: 良好
- **200-500ms**: 可接受
- **> 500ms**: 需要优化

### 分位延迟 (Percentile Latency)

- **P50**: 中位数响应时间，反映典型情况
- **P95**: 95%请求的响应时间，反映大部分用户体验
- **P99**: 99%请求的响应时间，反映系统极限

**建议**: P95 < 500ms，P99 < 1000ms

### 吞吐量 (Throughput)

- **> 100 req/s**: 优秀
- **50-100 req/s**: 良好
- **< 50 req/s**: 需要优化

## 性能优化建议

### 1. 缓存优化

当前实现使用内存缓存，已配置TTL：
- `config`: 60秒
- `authors`: 60秒
- `volumes`: 30秒
- `contributions`: 30秒

**建议**: 根据实际访问模式调整TTL

### 2. 并发控制

当前并发配置：
- 速率限制: 读240/分钟，写20/分钟
- 最大并发写: 10

**建议**: 监控实际负载，调整速率限制

### 3. SSE连接管理

当前SSE配置：
- 最大总连接: 1000
- 每IP最大连接: 5

**建议**: 根据实际用户数量调整

### 4. 文件监控

当前文件监控使用 `chokidar`，防抖500ms

**建议**: 监控文件变化对性能的影响

## 集成测试

可以与 CI/CD 集成，定期执行性能测试：

```bash
#!/bin/bash
# ci-test.sh

echo "Running performance test..."
node performance-test.js -r=1000 -d=10 -t=throughput -o=ci-results.json

if [ $? -eq 0 ]; then
    echo "Test completed successfully"
    exit 0
else
    echo "Test failed"
    exit 1
fi
```

## 故障排查

### 问题: 大量请求失败

**可能原因**:
- 服务器资源不足
- 速率限制过严
- 连接超时

**解决方法**:
1. 检查服务器资源使用情况
2. 调整速率限制配置
3. 增加连接超时时间

### 问题: 响应时间过长

**可能原因**:
- 缓存未命中
- 文件I/O瓶颈
- 代码执行效率低

**解决方法**:
1. 检查缓存命中率
2. 优化文件读取路径
3. 使用性能分析工具

### 问题: SSE连接数达到上限

**可能原因**:
- 热重载客户端过多
- 客户端未正确关闭连接

**解决方法**:
1. 减少SSE最大连接数
2. 检查客户端关闭逻辑
3. 增加心跳检测

## 许可证

MIT