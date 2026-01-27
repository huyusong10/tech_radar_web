# 系统优化指南 - 高并发压力测试

## 问题分析

在执行高并发压力测试时，出现 `dial: i/o timeout` 错误，这是因为：

1. **TCP连接队列溢出**：`kern.ipc.somaxconn` 默认值128太小
2. **服务器最大连接数限制**：Node.js服务器默认连接数限制
3. **临时端口耗尽**：k6可能耗尽本地临时端口

## macOS 系统优化

### 1. 临时调整（重启后失效）
```bash
# 提高TCP连接队列大小 (默认128 -> 4096)
sudo sysctl -w kern.ipc.somaxconn=4096

# 提高TCP SYN backlog大小
sudo sysctl -w net.inet.tcp.syncache.hashsize=4096
sudo sysctl -w net.inet.tcp.syncache.cachelimit=8192

# 增加临时端口范围
sudo sysctl -w net.inet.ip.portrange.first=10000
sudo sysctl -w net.inet.ip.portrange.last=65535

# 提高文件描述符限制（如果有限制）
sudo ulimit -n 65536
```

### 2. 永久调整
```bash
# 编辑 /etc/sysctl.conf（如果不存在则创建）
sudo tee -a /etc/sysctl.conf << EOF
# TCP optimization for high concurrency
kern.ipc.somaxconn=4096
net.inet.tcp.syncache.hashsize=4096
net.inet.tcp.syncache.cachelimit=8192
net.inet.ip.portrange.first=10000
net.inet.ip.portrange.last=65535
net.inet.tcp.msl=1000
EOF

# 应用配置
sudo sysctl -e
```

### 3. 检查当前设置
```bash
# 查看关键参数
sysctl kern.ipc.somaxconn
sysctl net.inet.ip.portrange.first net.inet.ip.portrange.last
ulimit -n
```

## Linux 系统优化

```bash
# 临时调整
sudo sysctl -w net.core.somaxconn=4096
sudo sysctl -w net.ipv4.tcp_max_syn_backlog=4096
sudo sysctl -w net.ipv4.ip_local_port_range="10000 65535"
sudo ulimit -n 65536

# 永久调整（/etc/sysctl.conf）
echo "net.core.somaxconn=4096" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_max_syn_backlog=4096" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.ip_local_port_range=10000 65535" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

## Node.js 服务器优化

已完成的优化（在 `server.js` 中）：

1. **增加最大连接数**：`server.maxConnections = 10000`
2. **TCP优化**：
   - `server.keepAliveTimeout = 65000`
   - `server.headersTimeout = 66000`
   - TCP keep-alive enabled
   - Nagle's algorithm disabled
3. **限流调整**：读5000/分钟，写500/分钟
4. **缓存优化**：延长TTL至60秒

## k6 测试优化

### 测试策略调整

1. **渐进式负载增加**：避免瞬间高并发
2. **连接复用**：减少TCP连接压力
3. **合理超时设置**：避免过早超时

### 推荐的测试顺序

```bash
# 1. 先测试中等并发（验证系统配置）
k6 run k6-tests/medium-load-test.js

# 2. 如果中等并发通过，再测试高并发
k6 run k6-tests/stress-test.js

# 3. 针对特定场景测试
k6 run k6-tests/api-load-test.js
k6 run k6-tests/user-journey-test.js
```

## 故障排除

### 1. 仍然出现 `dial: i/o timeout`
```bash
# 检查服务器是否在运行
curl http://localhost:5090/api/health

# 检查端口占用
netstat -an | grep :5090 | wc -l

# 查看服务器日志中的错误
# 服务器控制台会显示错误信息
```

### 2. 连接数不足
```bash
# 查看当前TCP连接状态
netstat -an | grep ESTABLISHED | wc -l

# 查看端口使用情况
netstat -an | grep :5090
```

### 3. 内存不足
```bash
# 监控Node.js内存使用
curl http://localhost:5090/api/stats | jq .systemStats.memoryUsage

# 系统内存使用
top -o mem
```

### 4. 文件描述符耗尽
```bash
# 查看进程的文件描述符使用
lsof -p $(pgrep -f "node server.js") | wc -l

# 系统总文件描述符使用
lsof | wc -l
```

## 监控指标

### 关键监控端点
1. **健康检查**：`http://localhost:5090/api/health`
2. **详细统计**：`http://localhost:5090/api/stats`

### 重要指标
- **请求成功率**：应 > 99%
- **响应时间**：p95 < 500ms，p99 < 1000ms
- **内存使用**：稳定增长，无泄漏
- **缓存命中率**：通过日志观察

## 性能预期

经过系统优化后，预期性能：

| 场景 | 目标并发 | 预期成功率 | 备注 |
|------|---------|-----------|------|
| 中等负载 | 2000 | > 99.5% | 系统应轻松处理 |
| 高负载 | 5000 | > 98% | 可能有少量超时 |
| 极限负载 | 10000 | > 95% | 用于找出瓶颈 |

## 注意事项

1. **测试环境**：确保测试机有足够资源（CPU、内存、网络）
2. **网络延迟**：本地测试网络延迟最低，生产环境会有差异
3. **数据一致性**：压力测试期间点赞/阅读量数据可能不精确
4. **恢复测试**：测试完成后，降级配置以恢复原始设置

## 恢复原始配置

测试完成后，可以恢复原始系统配置：

```bash
# macOS
sudo sysctl -w kern.ipc.somaxconn=128

# Linux
sudo sysctl -w net.core.somaxconn=128

# 重启服务器使用原始配置
git checkout master
npm start
```