/**
 * K6 性能测试脚本 - Tech Radar Web
 * 功能：
 * 1. 微基准测试API响应速度
 * 2. 基础功能性能测试
 * 3. 内存占用测试
 * 4. 多次调用平滑性测试
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, ThresholdsCounter } from 'k6/metrics';

// 性能指标
const apiPerformance = new Trend('api_performance');
const cacheEfficiency = new Trend('cache_efficiency');
const databaseSpeed = new Trend('database_speed');
const concurrentRequestsTrend = new Trend('concurrent_requests');

// 错误率统计
const errorRate = new Rate('performance_errors');

// 健康检查阈值
const MAX_ERROR_RATE = 0.02;
const MAX_RESPONSE_TIME = 300;  // 最大响应时间 300ms

export let options = {
    scenarios: {
        // 场景1: 微基准测试 - 针对最常用API的快速测试
        micro_benchmark: {
            executor: 'per-vu-iterations',
            vus: 10,
            iterations: 100,
            executionType: 'persistent',
            duration: '30s',
            exec: 'microBenchmarkTest',
        },

        // 场景2: 基础功能性能测试
        basic_performance: {
            executor: 'ramping-arrival-rate',
            startRate: 1,
            preAllocatedVUs: 10,
            stages: [
                { duration: '10s', target: 10 },
                { duration: '30s', target: 30 },
                { duration: '10s', target: 50 },
            ],
            exec: 'basicPerformanceTest',
        },

        // 场景3: 长时间运行性能监控
        long_running: {
            executor: 'constant-vus',
            vus: 20,
            duration: '5m',
            exec: 'longRunningTest',
        },

        // 场景4: 并发请求压力测试
        concurrent_stress: {
            executor: 'constant-upload-rate',
            stages: [
                { duration: '30s', target: 50 },
                { duration: '1m', target: 200 },
                { duration: '30s', target: 500 },
                { duration: '1m', target: 1000 },
            ],
            exec: 'concurrentStressTest',
        },

        // 场景5: 缓存效率测试
        cache_effectiveness: {
            executor: 'ramping-vus',
            startVUs: 5,
            stages: [
                { duration: '1m', target: 50 },
                { duration: '2m', target: 50 },
                { duration: '1m', target: 0 },
            ],
            exec: 'cacheEffectivenessTest',
        },
    },

    thresholds: {
        'api_performance': ['p(95)<100', 'p(99)<200'],  // API性能：95% <100ms, 99% < 200ms
        'cache_efficiency': ['p(95)<50'],               // 缓存效率：95% < 50ms
        'database_speed': ['p(95)<150'],                // 数据库速度：95% < 150ms
        'performance_errors': ['rate<0.01'],            // 错误率 < 1%
    },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:5090';

// =====================================================
// 微基准测试 - 针对高频API的快速测试
// =====================================================
function microBenchmarkTest() {
    const endpoints = [
        { url: `${BASE_URL}/api/config`, name: 'Config' },
        { url: `${BASE_URL}/api/authors`, name: 'Authors' },
        { url: `${BASE_URL}/api/volumes`, name: 'Volumes' },
    ];

    endpoints.forEach((endpoint) => {
        const requestStart = Date.now();

        const response = http.get(endpoint.url);

        const responseTime = Date.now() - requestStart;
        apiPerformance.add(responseTime);

        check(response, {
            `${endpoint.name} micro benchmark status is 200`: (r) => r.status === 200 && r.timings.duration < MAX_RESPONSE_TIME,
            `${endpoint.name} content type is JSON`: (r) => r.contentType.indexOf('application/json') >= 0,
        }) || errorRate.add(1);

        if (response.status === 200) {
            const jsonSize = JSON.stringify(JSON.parse(response.body)).length;
            cacheEfficiency.add(jsonSize);
        }
    });

    sleep(0.1);
}

// =====================================================
// 基础性能测试 - 阶梯式增加负载
// =====================================================
function basicPerformanceTest() {
    const response = http.get(`${BASE_URL}/api/volumes`);

    check(response, {
        'Volumes API 响应正常': (r) => r.status === 200,
        '响应时间 < 300ms': (r) => r.timings.duration < MAX_RESPONSE_TIME,
        '返回卷数 > 0': (r) => {
            try {
                const data = JSON.parse(r.body);
                return data.length > 0;
            } catch {
                return false;
            }
        },
    }) || errorRate.add(1);

    apiPerformance.add(response.timings.duration);
    concurrentRequestsTrend.add(Date.now());

    sleep(0.5);
}

// =====================================================
// 长时间运行性能监控 - 持续负载测试
// =====================================================
function longRunningTest() {
    const startTime = Date.now();

    // 模拟用户浏览行为
    http.get(`${BASE_URL}/`, { tags: { feature: 'page_load' } });
    apiPerformance.add(Date.now() - startTime);

    http.get(`${BASE_URL}/api/config`, { tags: { feature: 'api_config' } });
    apiPerformance.add(Date.now() - startTime);

    http.get(`${BASE_URL}/api/authors`, { tags: { feature: 'api_authors' } });
    apiPerformance.add(Date.now() - startTime);

    http.get(`${BASE_URL}/api/volumes`, { tags: { feature: 'api_volumes' } });
    apiPerformance.add(Date.now() - startTime);

    concurrentRequestsTrend.add(Date.now() - startTime);

    // 每30秒记录一次性能指标
    const interval = 30;
    const elapsed = Date.now() - startTime;
    if (elapsed % interval < 200) {
        console.log(\`\[Long Running\] 吞吐量: \${(1000 / (Date.now() - startTime)).toFixed(2)} req/s\`);
    }
}

// =====================================================
// 并发压力测试 - 多阶段负载测试
// =====================================================
function concurrentStressTest() {
    const volumeId = __ENV.VOLUME_ID || '1';

    // 并发读取测试
    const requests = [];
    for (let i = 0; i < 10; i++) {
        requests.push(
            http.get(`${BASE_URL}/api/volumes`, { tags: { type: 'read' } }),
        );
        requests.push(
            http.get(`${BASE_URL}/api/volumes/${volumeId}`, { tags: { type: 'read' } }),
        );
        requests.push(
            http.get(`${BASE_URL}/api/views`, { tags: { type: 'read' } }),
        );
    }

    // 批量请求检查
    requests.forEach((response) => {
        check(response, {
            '并发读取响应正常': (r) => r.status === 200,
            '响应时间在阈值内': (r) => r.timings.duration < MAX_RESPONSE_TIME,
        }) || errorRate.add(1);

        apiPerformance.add(response.timings.duration);
        concurrentRequestsTrend.add(Date.now());
    });

    sleep(1);
}

// =====================================================
// 缓存效率测试 - 测试缓存是否命中
// =====================================================
function cacheEffectivenessTest() {
    const volumeId = __ENV.VOLUME_ID || '1';

    // 第一次请求
    const firstRequestStart = Date.now();
    const firstResponse = http.get(`${BASE_URL}/api/volumes`);
    const firstResponseTime = Date.now() - firstRequestStart;

    // 第二次请求（可能命中缓存）
    const secondRequestStart = Date.now();
    const secondResponse = http.get(`${BASE_URL}/api/volumes`);
    const secondResponseTime = Date.now() - secondRequestStart;

    const cacheHitTime = secondResponseTime < firstResponseTime ? secondResponseTime : 0;

    cacheEfficiency.add(cacheHitTime);
    apiPerformance.add(secondResponseTime);

    check(secondResponse, {
        '缓存命中测试成功': (r) => r.status === 200,
        '缓存命中率 > 0': (r) => cacheHitTime > 0,
    }) || errorRate.add(1);

    sleep(2);
}

// =====================================================
// 数据库操作性能测试
// =====================================================
function databaseSpeedTest() {
    const volumeId = __ENV.VOLUME_ID || '1';

    // 模拟数据库读写操作
    const dbReadStart = Date.now();
    const response = http.get(`${BASE_URL}/api/views/${volumeId}`, {
        tags: { operation: 'db_read' },
    });
    const dbReadTime = Date.now() - dbReadStart;

    // 模拟写入操作
    const dbWriteStart = Date.now();
    const writeResponse = http.post(`${BASE_URL}/api/views/${volumeId}`, null, {
        tags: { operation: 'db_write' },
    });
    const dbWriteTime = Date.now() - dbWriteStart;

    databaseSpeed.add(dbReadTime);
    databaseSpeed.add(dbWriteTime);

    check(dbReadResponse, {
        '数据库读取正常': (r) => r.status === 200,
        '数据库读取时间合理': (r) => dbReadTime < 200,
    }) || errorRate.add(1);

    check(writeResponse, {
        '数据库写入正常': (r) => r.status === 200,
        '数据库写入时间合理': (r) => dbWriteTime < 200,
    }) || errorRate.add(1);

    sleep(0.5);
}

// =====================================================
// 主测试入口
// =====================================================
export default function (data) {
    // 根据场景选择测试方法
    if (data.macroIteration === 'micro_benchmark') {
        microBenchmarkTest();
    } else if (data.macroIteration === 'basic_performance') {
        basicPerformanceTest();
    } else if (data.macroIteration === 'long_running') {
        longRunningTest();
    } else if (data.macroIteration === 'concurrent_stress') {
        concurrentStressTest();
    } else if (data.macroIteration === 'cache_effectiveness') {
        cacheEffectivenessTest();
    } else {
        // 默认测试
        basicPerformanceTest();
    }
}

// =====================================================
// 性能报告生成
// =====================================================
export function handleSummary(data) {
    const metrics = data.metrics;

    console.log('\n\n=== 性能测试报告 ===');
    console.log(`测试时间: ${new Date().toLocaleString()}`);
    console.log(`平均请求时间: ${metrics.api_performance.avg.toFixed(0)}ms`);
    console.log(`P95 响应时间: ${metrics.api_performance['p(95)'].toFixed(0)}ms`);
    console.log(`P99 响应时间: ${metrics.api_performance['p(99)'].toFixed(0)}ms`);
    console.log(`缓存效率: ${metrics.cache_efficiency.avg.toFixed(0)}ms`);
    console.log(`数据库速度: ${metrics.database_speed.avg.toFixed(0)}ms`);
    console.log(`并发响应时间: ${metrics.concurrent_requests_trend.avg.toFixed(0)}ms`);
    console.log(`错误率: ${(metrics.performance_errors.rate * 100).toFixed(2)}%`);
    console.log(`总请求数: ${metrics.http_reqs.value.toFixed(0)}`);
    console.log(`吞吐量: ${(metrics.http_reqs.rate).toFixed(2)}`);

    return {
        'performance.html': generatePerformanceHTML(data, metrics),
        'performance.json': JSON.stringify(data),
    };
}

// 生成性能测试HTML报告
function generatePerformanceHTML(data, metrics) {
    return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>性能测试报告</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; background: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
            .card { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 20px; margin-bottom: 20px; }
            h1 { color: #333; border-bottom: 2px solid #00f3ff; padding-bottom: 10px; }
            h2 { color: #444; margin-top: 20px; }
            .metric { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
            .metric span:first-child { color: #666; }
            .metric span:last-child { color: #00f3ff; font-weight: bold; }
            .chart-container { position: relative; height: 300px; margin: 20px 0; }
            .status { display: inline-block; padding: 5px 10px; border-radius: 4px; font-weight: bold; }
            .success { background: #e8f5e9; color: #4caf50; }
            .warning { background: #fff3e0; color: #ff9800; }
            .danger { background: #ffebee; color: #f44336; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>💻 性能测试报告</h1>
            <p style="color: #666;">测试时间: ${new Date().toLocaleString()}</p>
            <p style="color: #666;">测试数据: ${data.metrics.http_reqs.value.toFixed(0)} 请求</p>
            <p style="color: #666;">错误率: ${(metrics.http_req_failed.rate * 100).toFixed(2)}%</p>

            <div class="card">
                <h2>📊 API 性能指标</h2>
                <div class="chart-container">
                    <canvas id="performanceChart"></canvas>
                </div>
                <div class="metric">
                    <span>平均响应时间</span>
                    <span>${metrics.api_performance.avg.toFixed(0)}ms</span>
                </div>
                <div class="metric">
                    <span>P50 响应时间</span>
                    <span>${metrics.api_performance['p(50)'].toFixed(0)}ms</span>
                </div>
                <div class="metric">
                    <span>P95 响应时间</span>
                    <span>${metrics.api_performance['p(95)'].toFixed(0)}ms</span>
                </div>
                <div class="metric">
                    <span>P99 响应时间</span>
                    <span>${metrics.api_performance['p(99)'].toFixed(0)}ms</span>
                </div>
                <div class="metric">
                    <span>最小响应时间</span>
                    <span>${metrics.api_performance.min.toFixed(0)}ms</span>
                </div>
                <div class="metric">
                    <span>最大响应时间</span>
                    <span>${metrics.api_performance.max.toFixed(0)}ms</span>
                </div>
            </div>

            <div class="card">
                <h2>🚀 数据库性能</h2>
                <div class="metric">
                    <span>数据库读取速度</span>
                    <span>${metrics.database_speed.avg.toFixed(0)}ms</span>
                </div>
                <div class="metric">
                    <span>数据库写入速度</span>
                    <span>${metrics.database_speed.p(50)?.toFixed(0) || '-'}ms (P50)</span>
                </div>
                <div class="metric">
                    <span>数据库 P95</span>
                    <span>${metrics.database_speed['p(95)']?.toFixed(0) || '-'}ms</span>
                </div>
            </div>

            <div class="card">
                <h2>🧠 缓存效率</h2>
                <div class="metric">
                    <span>缓存平均耗时</span>
                    <span>${metrics.cache_efficiency.avg.toFixed(0)}ms</span>
                </div>
                <div class="metric">
                    <span>缓存 P50</span>
                    <span>${metrics.cache_efficiency.p(50)?.toFixed(0) || '-'}ms</span>
                </div>
                <div class="metric">
                    <span>缓存 P95</span>
                    <span>${metrics.cache_efficiency['p(95)']?.toFixed(0) || '-'}ms</span>
                </div>
            </div>

            <div class="card">
                <h2>📈 并发负载</h2>
                <div class="metric">
                    <span>并发响应时间</span>
                    <span>${metrics.concurrent_requests_trend.avg.toFixed(0)}ms</span>
                </div>
                <div class="metric">
                    <span>吞吐量 (RPS)</span>
                    <span>${metrics.http_reqs.rate.toFixed(2)}</span>
                </div>
                <div class="metric">
                    <span>最大并发 (峰值)</span>
                    <span>${metrics.http_max_reqs?.value.toFixed(0) || '-'}</span>
                </div>
            </div>

            <div class="card">
                <h2>✅ 结果评估</h2>
                ${metrics.http_req_failed.rate < 0.01
                    ? '<p class="status success">✅ 性能测试通过 - 无明显性能问题</p>'
                    : metrics.http_req_failed.rate < 0.05
                        ? '<p class="status warning">⚠️ 性能测试一般 - 存在少量性能问题</p>'
                        : '<p class="status danger">❌ 性能测试失败 - 存在严重性能问题</p>'
                }
                ${metrics.api_performance['p(95)'] < 200
                    ? '<p class="status success">✅ API响应时间优秀 (< 200ms)</p>'
                    : '<p class="status warning">⚠️ API响应时间一般 (< 500ms)</p>'
                }
            </div>
        </div>

        <script>
            const ctx = document.getElementById('performanceChart').getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['平均值', 'P50', 'P95', 'P99', '最小值', '最大值'],
                    datasets: [{
                        label: 'API响应时间 (ms)',
                        data: [
                            ${metrics.api_performance.avg.toFixed(0)},
                            ${metrics.api_performance.p(50)?.toFixed(0) || '-'},
                            ${metrics.api_performance['p(95)']?.toFixed(0)},
                            ${metrics.api_performance['p(99)']?.toFixed(0)},
                            ${metrics.api_performance.min.toFixed(0)},
                            ${metrics.api_performance.max.toFixed(0)}
                        ],
                        borderColor: '#00f3ff',
                        backgroundColor: 'rgba(0, 243, 255, 0.2)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: { color: '#333' }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: '时间 (ms)', color: '#666' },
                            grid: { color: 'rgba(0,0,0,0.05)' }
                        },
                        x: {
                            grid: { display: false }
                        }
                    }
                }
            });
        </script>
    </body>
    </html>
    `;
}