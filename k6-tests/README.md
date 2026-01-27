# Tech Radar Weekly 压力测试指南

此目录包含针对 Tech Radar Weekly 项目的压力测试脚本，使用 [k6](https://k6.io/) 工具执行。

## 前置要求

1. **安装 k6**:
   ```bash
   # macOS
   brew install k6
   
   # Linux (Debian/Ubuntu)
   sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D78C6C751D6D1FFCF
   echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt update && sudo apt install k6
   
   # Windows
   choco install k6
   ```

2. **启动优化后的服务器**:
   ```bash
   # 确保在 opencode-test 分支
   git checkout opencode-test
   npm install
   npm start
   # 服务器运行在 http://localhost:5090
   ```

## 测试脚本说明

| 测试脚本 | 目标 | 最大并发 | 持续时间 |
|---------|------|---------|---------|
| `api-load-test.js` | 测试API端点稳定性 | 1000用户 | 4.5分钟 |
| `static-file-test.js` | 测试静态文件服务能力 | 2000用户 | 4分钟 |
| `user-journey-test.js` | 模拟真实用户行为 | 1200用户 | 7分钟 |
| `write-operation-test.js` | 测试写操作并发 | 200用户 | 4分钟 |
| `stress-test.js` | 极限负载测试 | 5000用户 | 4分钟 |

## 执行测试

```bash
# 进入测试目录
cd k6-tests

# 1. 基础API负载测试
k6 run api-load-test.js

# 2. 静态文件测试
k6 run static-file-test.js

# 3. 混合用户行为测试
k6 run user-journey-test.js

# 4. 写操作测试
k6 run write-operation-test.js

# 5. 极限负载测试（最后执行）
k6 run stress-test.js
```

## 高级选项

```bash
# 输出结果到JSON文件
k6 run --out json=results.json api-load-test.js

# 实时监控（需要InfluxDB）
k6 run --out influxdb=http://localhost:8086/k6 api-load-test.js

# 分布式测试（云执行）
k6 run --vus 1000 --duration 5m --out cloud api-load-test.js
```

## 监控端点

优化后的服务器提供了以下监控端点：

1. **健康检查**: `GET /api/health`
   - 返回基本状态和内存使用情况

2. **统计信息**: `GET /api/stats`
   - 请求统计（总数、成功率、限流次数）
   - 缓存统计（缓存大小）
   - 系统统计（运行时间、内存使用）
   - 端点统计（各端点请求量和错误率）

## 预期性能指标

### 响应时间目标
- **API端点**: p95 < 500ms, p99 < 1000ms
- **静态文件**: p95 < 300ms, p99 < 500ms
- **写操作**: p95 < 1000ms (允许更长)

### 错误率目标
- HTTP错误率: < 1%
- 限流错误率: < 5% (在极限测试中可能更高)

### 吞吐量目标
- 静态文件: > 2000 RPS
- API端点: > 500 RPS

## 优化配置说明

`opencode-test` 分支包含以下优化配置：

### 1. 限流调整
- 读操作: 5000 请求/分钟/IP (原 240)
- 写操作: 500 请求/分钟/IP (原 20)

### 2. 缓存优化
- 期刊列表缓存: 60秒 (原 30秒)
- 投稿列表缓存: 60秒 (原 30秒)

### 3. 静态文件缓存
- Markdown文件: 5分钟缓存
- 静态资源: 1小时缓存
- 草稿文件: 5分钟缓存（Markdown 1分钟）

### 4. 监控增强
- 请求统计中间件
- `/api/stats` 端点提供详细监控数据

## 测试结果分析

执行测试后关注以下指标：

1. **响应时间分布** (p50, p95, p99)
2. **请求成功率** (成功率应 > 99%)
3. **限流触发情况** (429状态码计数)
4. **系统资源使用** (通过 `/api/stats` 监控)
5. **缓存效果** (缓存命中率，通过日志观察)

## 故障排除

### 服务器启动失败
- 检查端口 5090 是否被占用
- 验证 `site.config.js` 配置

### 测试连接失败
- 确保服务器正在运行 `npm start`
- 检查防火墙设置

### 高错误率
- 查看服务器日志了解具体错误
- 调整限流配置（修改 `server.js` 中的 `CONFIG.RATE_LIMIT`）
- 检查文件系统权限

### 内存泄漏
- 监控 `/api/stats` 中的内存使用增长
- 检查缓存大小是否持续增长

## 恢复原始配置

测试完成后，可以切回主分支恢复原始配置：

```bash
git checkout master
npm start
```

或手动修改 `server.js` 中的配置参数。