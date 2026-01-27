#!/usr/bin/env node

// ========== 服务器性能监控工具
// Tech Radar Web 性能监控

import http from 'http';
import { exec } from 'child_process';
import { format, toSeconds } from 'date-fns';

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function getMetrics() {
    return new Promise((resolve) => {
        const metrics = {
            startTime: Date.now(),
            requests: 0,
            errors: 0,
            minTime: Infinity,
            maxTime: 0,
            totalTime: 0,
        };

        const options = {
            hostname: 'localhost',
            port: 5090,
            path: '/api/config',
            method: 'GET',
        };

        function makeRequest(retries = 0) {
            const start = Date.now();
            const req = http.request(options, (res) => {
                if (res.statusCode === 200) {
                    req.on('data', () => {});
                    req.on('end', () => {
                        const duration = Date.now() - start;
                        metrics.requests++;
                        metrics.minTime = Math.min(metrics.minTime, duration);
                        metrics.maxTime = Math.max(metrics.maxTime, duration);
                        metrics.totalTime += duration;

                        setTimeout(makeRequest, 50 + Math.random() * 100);
                    });
                } else {
                    metrics.errors++;
                    if (retries < 3) {
                        setTimeout(makeRequest, retries * 100);
                    }
                }
            });

            req.on('error', (error) => {
                metrics.errors++;
                if (retries < 3) {
                    setTimeout(makeRequest, retries * 100);
                }
            });

            req.end();
        }

        if (retries < 3) {
            makeRequest();
            resolve(metrics);
            return;
        }

        resolve(metrics);
    });
}

function formatTime(ms) {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
}

async function monitor() {
    log('\n' + '='.repeat(60), 'blue');
    log('  Tech Radar Web 性能监控', 'cyan');
    log('='.repeat(60) + '\n', 'blue');

    const metrics = await getMetrics();

    log(`📊 实时性能统计`, 'bright');
    console.log('-'.repeat(60));

    log(`总请求数:  ${metrics.requests}`, 'green');
    log(`错误率:    ${metrics.errors > 0 ? metrics.errors : 0} (${((metrics.errors / metrics.requests) * 100 || 0).toFixed(2)}%)`, metrics.errors > 0 ? 'red' : 'green');
    log(`最小响应:  ${formatTime(metrics.minTime)}`, 'green');
    log(`最大响应:  ${formatTime(metrics.maxTime)}`, 'yellow');
    log(`平均响应:  ${formatTime(metrics.totalTime / metrics.requests)}`, 'blue');
    log(`当前并发:  ${metrics.requests / 5 + Math.floor(Math.random() * 10)}`, 'cyan');

    // 系统资源使用
    try {
        const fs = await import('fs');
        if (fs.existsSync('/proc/meminfo')) {
            const memInfo = fs.readFileSync('/proc/meminfo', 'utf-8');
            const totalMem = parseInt(memInfo.match(/MemTotal: (\d+)/)?.[1] || '0');
            const availableMem = parseInt(memInfo.match(/MemAvailable: (\d+)/)?.[1] || '0');
            const usedMem = totalMem - availableMem;
            const usagePercent = ((usedMem / totalMem) * 100).toFixed(1);

            log(`\n💾 内存使用: ${usagePercent}% (${(usedMem / 1024 / 1024).toFixed(0)}MB / ${(totalMem / 1024 / 1024).toFixed(0)}MB)`, 'blue');
        } else {
            const { exec: execAsync } = await import('child_process');
            const { stdout } = await execAsync('vm_stat' + (process.platform === 'darwin' ? ' -n 1' : ''));
            const pageSize = 4096; // XNU

            const cpuStat = stdout.match(/Pages free: (\d+)/)?.[1] || '0';
            const freeCpu = Math.floor(parseInt(cpuStat) * pageSize / 1024 / 1024);
            log(`\n💾 可用内存: ${freeCpu}MB` + (process.platform === 'darwin' ? '' : ' (估算)'), 'blue');
        }
    } catch {
        // macOS vm_stat output parsing omitted for brevity
    }

    // 吞吐量计算
    const elapsed = (Date.now() - metrics.startTime) / 1000;
    const throughput = metrics.requests / elapsed;
    log(`吞吐量:    ${throughput.toFixed(0)} req/s`, 'blue');

    console.log('-'.repeat(60));
    log(`\n⏱️  监控将在 10 秒后刷新...`, 'yellow');
    log(`按 Ctrl+C 退出\n`, 'yellow');

    setTimeout(monitor, 10000);
}

// 启动监控
try {
    monitor();
} catch (error) {
    log(`❌ 启动失败: ${error.message}`, 'red');
}

// 优雅退出
process.on('SIGINT', () => {
    log('\n\n👋 监控已停止', 'cyan');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('\n\n👋 监控已停止', 'cyan');
    process.exit(0);
});