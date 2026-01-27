/**
 * Tech Radar 性能测试脚本
 * 专注于并发、吞吐量、延迟等性能指标测试
 */

import http from 'k6/http';
import { check, sleep, group, fail } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// 导入配置
import config from '../config/load-test-config.js';

// 性能测试专用指标
const latencyTrend = new Trend('latency_ms');
const throughputRate = new Rate('throughput_requests_per_second');
const concurrentUsersGauge = new Gauge('concurrent_users');
const errorRate = new Rate('error_rate');
const responseTimePercentiles = {
    p50: new Trend('response_time_p50'),
    p90: new Trend('response_time_p90'),
    p95: new Trend('response_time_p95'),
    p99: new Trend('response_time_p99'),
};

// 性能测试场景
const performanceScenarios = {
    // 1. 并发连接测试
    concurrency: {
        name: '并发连接测试',
        description: '测试系统处理并发连接的能力',
        stages: [
            { duration: '10s', target: 10 },
            { duration: '10s', target: 50 },
            { duration: '10s', target: 100 },
            { duration: '10s', target: 200 },
            { duration: '10s', target: 500 },
            { duration: '30s', target: 1000 },
        ],
        thresholds: {
            http_req_duration: ['p(95)<3000'],
            http_req_failed: ['rate<0.01'],
        }
    },
    
    // 2. 吞吐量测试
    throughput: {
        name: '吞吐量测试',
        description: '测试系统最大吞吐量',
        stages: [
            { duration: '30s', target: 50 },
            { duration: '30s', target: 100 },
            { duration: '30s', target: 200 },
            { duration: '30s', target: 300 },
            { duration: '60s', target: 500 },
        ],
        executor: 'constant-arrival-rate',
        rate: 100, // 每秒100个请求
        timeUnit: '1s',
        duration: '180s',
        preAllocatedVUs: 50,
        maxVUs: 500,
        thresholds: {
            http_req_duration: ['p(95)<2000'],
            http_req_failed: ['rate<0.005'],
        }
    },
    
    // 3. 延迟测试
    latency: {
        name: '延迟测试',
        description: '测试系统响应延迟',
        stages: [
            { duration: '10s', target: 1 },
            { duration: '10s', target: 5 },
            { duration: '10s', target: 10 },
            { duration: '30s', target: 20 },
        ],
        thresholds: {
            http_req_duration: ['p(95)<1000', 'p(99)<2000'],
            http_req_failed: ['rate<0.001'],
        }
    },
    
    // 4. 稳定性测试
    stability: {
        name: '稳定性测试',
        description: '长时间运行测试系统稳定性',
        executor: 'constant-vus',
        vus: 100,
        duration: '600s', // 10分钟
        thresholds: {
            http_req_duration: ['p(95)<2500'],
            http_req_failed: ['rate<0.005'],
            'http_req_duration{name:config_api}': ['p(95)<1500'],
            'http_req_duration{name:authors_api}': ['p(95)<1500'],
        }
    },
    
    // 5. 内存泄漏测试
    memory: {
        name: '内存测试',
        description: '测试内存使用和泄漏',
        stages: [
            { duration: '30s', target: 50 },
            { duration: '30s', target: 100 },
            { duration: '120s', target: 100 }, // 保持2分钟
            { duration: '30s', target: 50 },
            { duration: '30s', target: 10 },
        ],
        thresholds: {
            http_req_duration: ['p(95)<2000'],
            http_req_failed: ['rate<0.01'],
        }
    },
    
    // 6. 数据库连接池测试
    database: {
        name: '数据库连接测试',
        description: '测试数据库连接池性能',
        stages: [
            { duration: '10s', target: 10 },
            { duration: '10s', target: 30 },
            { duration: '10s', target: 50 },
            { duration: '30s', target: 100 },
        ],
        thresholds: {
            http_req_duration: ['p(95)<3000'],
            http_req_failed: ['rate<0.02'],
        }
    },
    
    // 7. 缓存性能测试
    cache: {
        name: '缓存性能测试',
        description: '测试缓存命中率和性能',
        stages: [
            { duration: '10s', target: 10 },
            { duration: '10s', target: 50 },
            { duration: '30s', target: 100 },
            { duration: '30s', target: 200 },
        ],
        thresholds: {
            http_req_duration: ['p(95)<1000'], // 缓存应该更快
            http_req_failed: ['rate<0.005'],
        }
    },
    
    // 8. 综合性能测试
    comprehensive: {
        name: '综合性能测试',
        description: '全面性能测试',
        stages: [
            { duration: '30s', target: 50 },
            { duration: '30s', target: 100 },
            { duration: '30s', target: 200 },
            { duration: '30s', target: 300 },
            { duration: '30s', target: 500 },
            { duration: '60s', target: 500 },
            { duration: '30s', target: 300 },
            { duration: '30s', target: 100 },
        ],
        thresholds: {
            http_req_duration: ['p(95)<3000'],
            http_req_failed: ['rate<0.01'],
            'iteration_duration': ['p(95)<5000'],
        }
    }
};

// 获取测试场景
const scenarioName = __ENV.SCENARIO || 'comprehensive';
const scenario = performanceScenarios[scenarioName];

if (!scenario) {
    console.error(`性能测试场景 ${scenarioName} 不存在`);
    throw new Error(`无效的性能测试场景: ${scenarioName}`);
}

console.log(`开始性能测试: ${scenario.name}`);
console.log(`描述: ${scenario.description}`);

// 导出选项
export const options = {
    stages: scenario.stages,
    thresholds: scenario.thresholds,
    
    // 性能测试专用配置
    discardResponseBodies: true, // 性能测试不关心响应体
    systemTags: ['url', 'name', 'method', 'status', 'error'],
    
    // 批量处理
    batch: 30,
    batchPerHost: 30,
    
    // 场景配置
    scenarios: {
        performance_scenario: {
            executor: scenario.executor || 'ramping-vus',
            startVUs: 0,
            gracefulRampDown: '30s',
            gracefulStop: '30s',
            ...(scenario.rate && { rate: scenario.rate }),
            ...(scenario.timeUnit && { timeUnit: scenario.timeUnit }),
            ...(scenario.duration && { duration: scenario.duration }),
            ...(scenario.preAllocatedVUs && { preAllocatedVUs: scenario.preAllocatedVUs }),
            ...(scenario.maxVUs && { maxVUs: scenario.maxVUs }),
            ...(scenario.vus && { vus: scenario.vus }),
        }
    }
};

// 性能测试数据
const perfData = {
    requestCount: 0,
    errorCount: 0,
    totalResponseTime: 0,
    startTime: Date.now(),
    
    // 响应时间统计
    responseTimes: [],
    
    // 更新统计
    updateStats: function(responseTime, isError) {
        this.requestCount++;
        if (isError) this.errorCount++;
        this.totalResponseTime += responseTime;
        this.responseTimes.push(responseTime);
        
        // 计算百分位数
        if (this.responseTimes.length >= 100) {
            this.calculatePercentiles();
            this.responseTimes = []; // 重置，避免内存增长
        }
    },
    
    // 计算百分位数
    calculatePercentiles: function() {
        const sorted = [...this.responseTimes].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p90 = sorted[Math.floor(sorted.length * 0.9)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const p99 = sorted[Math.floor(sorted.length * 0.99)];
        
        responseTimePercentiles.p50.add(p50);
        responseTimePercentiles.p90.add(p90);
        responseTimePercentiles.p95.add(p95);
        responseTimePercentiles.p99.add(p99);
    },
    
    // 获取性能指标
    getMetrics: function() {
        const elapsedTime = (Date.now() - this.startTime) / 1000; // 秒
        const throughput = this.requestCount / elapsedTime;
        const avgResponseTime = this.requestCount > 0 ? this.totalResponseTime / this.requestCount : 0;
        const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;
        
        return {
            throughput: throughput,
            avgResponseTime: avgResponseTime,
            errorRate: errorRate,
            totalRequests: this.requestCount,
            totalErrors: this.errorCount,
            elapsedTime: elapsedTime,
        };
    }
};

// 性能测试函数：并发测试
function testConcurrency() {
    group('并发连接测试', function() {
        // 测试多个并发连接
        const endpoints = [
            { method: 'GET', path: '/api/config', name: 'config_concurrent' },
            { method: 'GET', path: '/api/authors', name: 'authors_concurrent' },
            { method: 'GET', path: '/api/volumes', name: 'volumes_concurrent' },
            { method: 'GET', path: '/api/health', name: 'health_concurrent' },
        ];
        
        // 创建并发请求
        const requests = endpoints.map(endpoint => ({
            method: endpoint.method,
            url: `${config.baseUrl}${endpoint.path}`,
            params: {
                headers: config.environment.headers,
                tags: { name: endpoint.name },
                timeout: '30s'
            }
        }));
        
        // 执行批量请求
        const startTime = Date.now();
        const responses = http.batch(requests);
        const endTime = Date.now();
        
        // 更新并发用户数
        concurrentUsersGauge.add(requests.length);
        
        // 处理响应
        responses.forEach((response, index) => {
            const responseTime = endTime - startTime;
            latencyTrend.add(responseTime);
            
            if (response && response.status === 200) {
                perfData.updateStats(responseTime, false);
                throughputRate.add(1);
            } else {
                perfData.updateStats(responseTime, true);
                errorRate.add(1);
                console.warn(`并发请求失败: ${endpoints[index].name}, 状态码: ${response?.status}`);
            }
        });
        
        // 记录延迟
        const batchLatency = endTime - startTime;
        console.log(`并发批量请求延迟: ${batchLatency}ms`);
    });
}

// 性能测试函数：吞吐量测试
function testThroughput() {
    group('吞吐量测试', function() {
        // 使用配置API进行吞吐量测试（轻量级端点）
        const endpoint = { method: 'GET', path: '/api/config', name: 'throughput_test' };
        const url = `${config.baseUrl}${endpoint.path}`;
        const params = {
            headers: config.environment.headers,
            tags: { name: endpoint.name },
            timeout: '10s'
        };
        
        // 执行多次请求测试吞吐量
        const batchSize = 20;
        const requests = Array(batchSize).fill({
            method: 'GET',
            url: url,
            params: params
        });
        
        const startTime = Date.now();
        const responses = http.batch(requests);
        const endTime = Date.now();
        
        // 计算吞吐量
        const duration = (endTime - startTime) / 1000; // 秒
        const throughput = batchSize / duration;
        
        // 更新指标
        throughputRate.add(throughput);
        
        // 处理响应
        let successCount = 0;
        responses.forEach((response, index) => {
            const responseTime = endTime - startTime;
            
            if (response && response.status === 200) {
                successCount++;
                perfData.updateStats(responseTime, false);
                latencyTrend.add(responseTime);
            } else {
                perfData.updateStats(responseTime, true);
                errorRate.add(1);
            }
        });
        
        const successRate = successCount / batchSize;
        console.log(`吞吐量测试: ${throughput.toFixed(2)} 请求/秒, 成功率: ${(successRate * 100).toFixed(1)}%`);
        
        // 验证吞吐量性能
        check(null, {
            '吞吐量 > 50 请求/秒': () => throughput > 50,
            '成功率 > 95%': () => successRate > 0.95,
        });
    });
}

// 性能测试函数：延迟测试
function testLatency() {
    group('延迟测试', function() {
        // 测试不同端点的延迟
        const endpoints = [
            { method: 'GET', path: '/api/config', name: 'latency_config' },
            { method: 'GET', path: '/api/authors', name: 'latency_authors' },
            { method: 'GET', path: '/api/volumes', name: 'latency_volumes' },
            { method: 'GET', path: '/api/health', name: 'latency_health' },
        ];
        
        endpoints.forEach(endpoint => {
            const url = `${config.baseUrl}${endpoint.path}`;
            const params = {
                headers: config.environment.headers,
                tags: { name: endpoint.name },
                timeout: '5s'
            };
            
            // 测量延迟
            const startTime = Date.now();
            const response = http.get(url, params);
            const endTime = Date.now();
            const latency = endTime - startTime;
            
            // 记录延迟
            latencyTrend.add(latency);
            perfData.updateStats(latency, !(response && response.status === 200));
            
            // 验证延迟
            check(response, {
                [`${endpoint.name} 延迟 < 1000ms`]: (r) => latency < 1000,
                [`${endpoint.name} 状态码为200`]: (r) => r.status === 200,
            });
            
            console.log(`${endpoint.name} 延迟: ${latency}ms`);
            
            // 短暂等待，避免请求过于密集
            sleep(0.05);
        });
    });
}

// 性能测试函数：稳定性测试
function testStability() {
    group('稳定性测试', function() {
        // 长时间运行稳定性测试
        const operations = [
            { type: 'read', endpoint: { method: 'GET', path: '/api/config', name: 'stability_config' } },
            { type: 'read', endpoint: { method: 'GET', path: '/api/volumes', name: 'stability_volumes' } },
            { type: 'read', endpoint: { method: 'GET', path: '/api/authors', name: 'stability_authors' } },
            { type: 'write', endpoint: { method: 'POST', path: '/api/views/001', name: 'stability_views', body: {} } },
        ];
        
        // 随机选择操作
        const operation = operations[Math.floor(Math.random() * operations.length)];
        const url = `${config.baseUrl}${operation.endpoint.path}`;
        const params = {
            headers: config.environment.headers,
            tags: { name: operation.endpoint.name },
            timeout: '10s'
        };
        
        let response;
        const startTime = Date.now();
        
        if (operation.type === 'read') {
            response = http.get(url, params);
        } else {
            params.body = JSON.stringify(operation.endpoint.body || {});
            response = http.post(url, params.body, params);
        }
        
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        // 更新指标
        perfData.updateStats(responseTime, !(response && response.status === 200));
        
        if (response && response.status === 200) {
            throughputRate.add(1);
        } else {
            errorRate.add(1);
        }
        
        // 验证稳定性
        check(response, {
            [`${operation.endpoint.name} 请求成功`]: (r) => r.status === 200 || r.status === 201,
            [`${operation.endpoint.name} 响应时间 < 3000ms`]: (r) => responseTime < 3000,
        });
    });
}

// 性能测试函数：内存测试
function testMemory() {
    group('内存测试', function() {
        // 测试内存使用模式
        const endpoints = [
            { method: 'GET', path: '/api/config', name: 'memory_config' },
            { method: 'GET', path: '/api/authors', name: 'memory_authors' },
            { method: 'GET', path: '/api/volumes?draft=true', name: 'memory_volumes_draft' },
            { method: 'GET', path: '/api/volumes', name: 'memory_volumes' },
        ];
        
        // 执行一系列请求，模拟内存使用模式
        endpoints.forEach((endpoint, index) => {
            const url = `${config.baseUrl}${endpoint.path}`;
            const params = {
                headers: config.environment.headers,
                tags: { name: endpoint.name },
                timeout: '15s'
            };
            
            // 添加延迟模拟真实用户行为
            sleep(Math.random() * 0.5);
            
            const startTime = Date.now();
            const response = http.get(url, params);
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            // 记录性能指标
            perfData.updateStats(responseTime, !(response && response.status === 200));
            latencyTrend.add(responseTime);
            
            // 验证响应
            check(response, {
                [`${endpoint.name} 状态码为200`]: (r) => r.status === 200,
                [`${endpoint.name} 有响应体`]: (r) => r.body && r.body.length > 0,
            });
            
            // 记录内存测试进度
            if (index % 10 === 0) {
                const metrics = perfData.getMetrics();
                console.log(`内存测试进度: ${index + 1}/${endpoints.length}, 平均响应时间: ${metrics.avgResponseTime.toFixed(2)}ms`);
            }
        });
    });
}

// 性能测试函数：缓存测试
function testCache() {
    group('缓存性能测试', function() {
        // 测试缓存性能
        const cacheableEndpoints = [
            { method: 'GET', path: '/api/config', name: 'cache_config' },
            { method: 'GET', path: '/api/authors', name: 'cache_authors' },
        ];
        
        // 第一次请求（可能未命中缓存）
        const firstRequestTimes = [];
        cacheableEndpoints.forEach(endpoint => {
            const url = `${config.baseUrl}${endpoint.path}`;
            const params = {
                headers: config.environment.headers,
                tags: { name: `${endpoint.name}_first` },
                timeout: '5s'
            };
            
            const startTime = Date.now();
            const response = http.get(url, params);
            const endTime = Date.now();
            firstRequestTimes.push(endTime - startTime);
            
            check(response, {
                [`${endpoint.name} 第一次请求成功`]: (r) => r.status === 200,
            });
            
            sleep(0.1);
        });
        
        // 第二次请求（应该命中缓存）
        const secondRequestTimes = [];
        cacheableEndpoints.forEach(endpoint => {
            const url = `${config.baseUrl}${endpoint.path}`;
            const params = {
                headers: config.environment.headers,
                tags: { name: `${endpoint.name}_second` },
                timeout: '5s'
            };
            
            const startTime = Date.now();
            const response = http.get(url, params);
            const endTime = Date.now();
            secondRequestTimes.push(endTime - startTime);
            
            check(response, {
                [`${endpoint.name} 第二次请求成功`]: (r) => r.status === 200,
            });
            
            sleep(0.1);
        });
        
        // 计算缓存性能提升
        let totalImprovement = 0;
        for (let i = 0; i < firstRequestTimes.length; i++) {
            const improvement = firstRequestTimes[i] - secondRequestTimes[i];
            totalImprovement += improvement;
            
            console.log(`${cacheableEndpoints[i].name}: 第一次 ${firstRequestTimes[i]}ms, 第二次 ${secondRequestTimes[i]}ms, 提升 ${improvement}ms`);
        }
        
        const avgImprovement = totalImprovement / firstRequestTimes.length;
        console.log(`平均缓存性能提升: ${avgImprovement.toFixed(2)}ms`);
        
        // 验证缓存效果
        check(null, {
            '缓存有效（第二次请求更快）': () => avgImprovement > 0,
            '缓存提升显著（>10ms）': () => avgImprovement > 10,
        });
    });
}

// 主测试函数
export default function() {
    // 根据场景选择测试
    const testMap = {
        concurrency: ['concurrency'],
        throughput: ['throughput'],
        latency: ['latency'],
        stability: ['stability'],
        memory: ['memory', 'stability'],
        database: ['concurrency', 'stability'],
        cache: ['cache', 'latency'],
        comprehensive: ['concurrency', 'throughput', 'latency', 'stability', 'cache'],
    };
    
    const tests = testMap[scenarioName] || testMap.comprehensive;
    
    // 执行测试
    tests.forEach(test => {
        switch(test) {
            case 'concurrency':
                testConcurrency();
                break;
            case 'throughput':
                testThroughput();
                break;
            case 'latency':
                testLatency();
                break;
            case 'stability':
                testStability();
                break;
            case 'memory':
                testMemory();
                break;
            case 'cache':
                testCache();
                break;
        }
        
        // 测试间等待
        sleep(Math.random() * 0.3 + 0.2);
    });
    
    // 模拟真实用户思考时间
    sleep(Math.random() * 1 + 0.5);
}

// 测试后处理
export function handleSummary(data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportName = `performance-test-${scenarioName}-${timestamp}`;
    
    // 生成报告路径
    const htmlReportPath = `${config.reporting.outputDir}/${reportName}.html`;
    const jsonReportPath = `${config.reporting.outputDir}/${reportName}.json`;
    
    // 计算性能指标
    const performanceMetrics = calculatePerformanceMetrics(data);
    
    // 添加到数据
    data.performance_metrics = performanceMetrics;
    
    // 生成报告
    const reports = {
        [htmlReportPath]: htmlReport(data),
        [jsonReportPath]: JSON.stringify(data, null, 2),
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
    
    // 输出性能分析
    console.log('\n=== 性能测试分析 ===');
    console.log(`测试场景: ${scenario.name}`);
    console.log(`总请求数: ${performanceMetrics.totalRequests}`);
    console.log(`错误率: ${(performanceMetrics.errorRate * 100).toFixed(2)}%`);
    console.log(`平均响应时间: ${performanceMetrics.avgResponseTime.toFixed(2)}ms`);
    console.log(`P95响应时间: ${performanceMetrics.p95ResponseTime}ms`);
    console.log(`吞吐量: ${performanceMetrics.throughput.toFixed(2)} 请求/秒`);
    console.log(`性能评分: ${performanceMetrics.performanceScore}/100`);
    
    if (performanceMetrics.recommendations.length > 0) {
        console.log('\n优化建议:');
        performanceMetrics.recommendations.forEach(rec => {
            console.log(`  • ${rec}`);
        });
    }
    
    return reports;
}

// 计算性能指标
function calculatePerformanceMetrics(data) {
    const metrics = data.metrics;
    
    // 基础指标
    const totalRequests = metrics.http_reqs?.values?.count || 0;
    const errorRate = metrics.http_req_failed?.values?.rate || 0;
    const avgResponseTime = metrics.http_req_duration?.values?.avg || 0;
    const p95ResponseTime = metrics.http_req_duration?.values?.p95 || 0;
    const throughput = metrics.http_reqs?.values?.rate || 0;
    
    // 性能评分（0-100）
    let performanceScore = 100;
    const recommendations = [];
    
    // 响应时间评分
    if (p95ResponseTime > 1000) {
        performanceScore -= 20;
        recommendations.push('P95响应时间超过1秒，建议优化代码逻辑和数据库查询');
    }
    if (p95ResponseTime > 3000) {
        performanceScore -= 30;
        recommendations.push('P95响应时间超过3秒，需要立即优化系统性能');
    }
    
    // 错误率评分
    if (errorRate > 0.01) {
        performanceScore -= 15;
        recommendations.push('错误率超过1%，需要检查API稳定性');
    }
    if (errorRate > 0.05) {
        performanceScore -= 25;
        recommendations.push('错误率超过5%，系统不稳定，需要紧急修复');
    }
    
    // 吞吐量评分（根据场景调整）
    let expectedThroughput = 50; // 默认期望值
    if (scenarioName === 'throughput') expectedThroughput = 100;
    if (scenarioName === 'comprehensive') expectedThroughput = 80;
    
    if (throughput < expectedThroughput * 0.5) {
        performanceScore -= 20;
        recommendations.push(`吞吐量低于期望值（${expectedThroughput}请求/秒）的50%，需要优化系统架构`);
    } else if (throughput < expectedThroughput * 0.8) {
        performanceScore -= 10;
        recommendations.push(`吞吐量低于期望值（${expectedThroughput}请求/秒）的80%，建议优化并发处理`);
    }
    
    // 确保分数在合理范围
    performanceScore = Math.max(0, Math.min(100, Math.round(performanceScore)));
    
    // 性能等级
    let performanceGrade = '优秀';
    if (performanceScore < 60) performanceGrade = '较差';
    else if (performanceScore < 75) performanceGrade = '一般';
    else if (performanceScore < 90) performanceGrade = '良好';
    
    return {
        totalRequests,
        errorRate,
        avgResponseTime: Math.round(avgResponseTime),
        p95ResponseTime: Math.round(p95ResponseTime),
        throughput: Math.round(throughput * 100) / 100,
        performanceScore,
        performanceGrade,
        recommendations,
    };
}