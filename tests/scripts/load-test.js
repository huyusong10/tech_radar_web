/**
 * Tech Radar 负载测试主脚本
 * 使用k6进行压力测试和性能测试
 */

import http from 'k6/http';
import { check, sleep, group, fail } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// 导入配置
import config from '../config/load-test-config.js';

// 自定义指标
const errorRate = new Rate('errors');
const responseTimeTrend = new Trend('response_time_trend');
const throughputCounter = new Counter('throughput');
const concurrentUsersGauge = new Counter('concurrent_users');

// 获取测试场景
const scenarioName = __ENV.SCENARIO || 'quick';
const scenario = config.scenarios[scenarioName];

if (!scenario) {
    console.error(`场景 ${scenarioName} 不存在，可用场景: ${Object.keys(config.scenarios).join(', ')}`);
    throw new Error(`无效的测试场景: ${scenarioName}`);
}

console.log(`开始测试: ${scenario.name}`);
console.log(`描述: ${scenario.description}`);

// 导出选项
export const options = {
    stages: scenario.stages,
    thresholds: scenario.thresholds,
    
    // 系统配置
    systemTags: ['url', 'name', 'method', 'status', 'error', 'check'],
    
    // 用户代理
    userAgent: 'TechRadar-LoadTest/1.0',
    
    // 批量请求
    batch: 20,
    batchPerHost: 20,
    
    // 丢弃指标
    discardResponseBodies: false,
    
    // 场景配置
    scenarios: {
        main_scenario: {
            executor: 'ramping-vus',
            startVUs: 0,
            gracefulRampDown: '30s',
            gracefulStop: '30s',
        }
    }
};

// 测试数据
const testData = {
    // 测试文章ID
    articleId: '001-01-test-article',
    
    // 测试卷号
    volumeId: '001',
    
    // 随机数据生成器
    getRandomData: function() {
        return {
            timestamp: Date.now(),
            randomValue: Math.random(),
            userId: `user_${Math.floor(Math.random() * 1000)}`,
        };
    }
};

// 辅助函数：随机选择API端点
function getRandomEndpoint(type = 'read') {
    const endpoints = config.endpoints[type] || config.endpoints.read;
    return endpoints[Math.floor(Math.random() * endpoints.length)];
}

// 辅助函数：执行API请求
function executeRequest(endpoint) {
    const url = `${config.baseUrl}${endpoint.path}`;
    const params = {
        headers: config.environment.headers,
        timeout: `${config.environment.timeout.request}ms`,
        tags: { name: endpoint.name }
    };
    
    let response;
    
    switch (endpoint.method) {
        case 'GET':
            response = http.get(url, params);
            break;
        case 'POST':
            params.body = JSON.stringify(endpoint.body || {});
            response = http.post(url, params.body, params);
            break;
        default:
            console.error(`不支持的HTTP方法: ${endpoint.method}`);
            return null;
    }
    
    return response;
}

// 辅助函数：验证响应
function validateResponse(response, endpoint) {
    const checks = {
        '状态码为200': (r) => r.status === 200,
        '响应时间合理': (r) => r.timings.duration < 5000,
        '有响应体': (r) => r.body && r.body.length > 0,
    };
    
    if (endpoint.name.includes('api')) {
        checks['JSON响应'] = (r) => {
            try {
                JSON.parse(r.body);
                return true;
            } catch {
                return false;
            }
        };
    }
    
    const result = check(response, checks);
    
    if (!result) {
        errorRate.add(1);
        console.warn(`请求失败: ${endpoint.name}, 状态码: ${response.status}`);
    } else {
        errorRate.add(0);
        responseTimeTrend.add(response.timings.duration);
        throughputCounter.add(1);
    }
    
    return result;
}

// 测试场景：只读API测试
function testReadAPIs() {
    group('只读API测试', function() {
        // 测试配置API
        const configEndpoint = config.endpoints.read.find(e => e.name === 'config_api');
        if (configEndpoint) {
            const response = executeRequest(configEndpoint);
            if (response) {
                validateResponse(response, configEndpoint);
                sleep(0.1);
            }
        }
        
        // 测试作者API
        const authorsEndpoint = config.endpoints.read.find(e => e.name === 'authors_api');
        if (authorsEndpoint) {
            const response = executeRequest(authorsEndpoint);
            if (response) {
                validateResponse(response, authorsEndpoint);
                sleep(0.1);
            }
        }
        
        // 测试卷API
        const volumesEndpoint = config.endpoints.read.find(e => e.name === 'volumes_api');
        if (volumesEndpoint) {
            const response = executeRequest(volumesEndpoint);
            if (response) {
                validateResponse(response, volumesEndpoint);
                sleep(0.1);
            }
        }
        
        // 测试投稿API
        const contributionsEndpoint = config.endpoints.read.find(e => e.name === 'contributions_api');
        if (contributionsEndpoint) {
            const response = executeRequest(contributionsEndpoint);
            if (response) {
                validateResponse(response, contributionsEndpoint);
                sleep(0.1);
            }
        }
        
        // 测试健康检查API
        const healthEndpoint = config.endpoints.read.find(e => e.name === 'health_api');
        if (healthEndpoint) {
            const response = executeRequest(healthEndpoint);
            if (response) {
                validateResponse(response, healthEndpoint);
                sleep(0.1);
            }
        }
    });
}

// 测试场景：写操作API测试
function testWriteAPIs() {
    group('写操作API测试', function() {
        // 测试点赞API
        const likeEndpoint = config.endpoints.write.find(e => e.name === 'like_api');
        if (likeEndpoint) {
            // 随机选择点赞或取消点赞
            const action = Math.random() > 0.5 ? 'like' : 'unlike';
            likeEndpoint.body = { action };
            
            const response = executeRequest(likeEndpoint);
            if (response) {
                validateResponse(response, likeEndpoint);
                sleep(0.2); // 写操作后等待更长时间
            }
        }
        
        // 测试阅读量API
        const viewEndpoint = config.endpoints.write.find(e => e.name === 'view_api');
        if (viewEndpoint) {
            const response = executeRequest(viewEndpoint);
            if (response) {
                validateResponse(response, viewEndpoint);
                sleep(0.2);
            }
        }
    });
}

// 测试场景：混合操作测试
function testMixedOperations() {
    group('混合操作测试', function() {
        // 随机执行读操作
        const readEndpoints = config.endpoints.read;
        const randomReadEndpoint = readEndpoints[Math.floor(Math.random() * readEndpoints.length)];
        
        if (randomReadEndpoint) {
            const response = executeRequest(randomReadEndpoint);
            if (response) {
                validateResponse(response, randomReadEndpoint);
                sleep(0.1);
            }
        }
        
        // 随机执行写操作（有一定概率）
        if (Math.random() > 0.7) { // 30%的概率执行写操作
            const writeEndpoints = config.endpoints.write;
            if (writeEndpoints.length > 0) {
                const randomWriteEndpoint = writeEndpoints[Math.floor(Math.random() * writeEndpoints.length)];
                if (randomWriteEndpoint) {
                    const response = executeRequest(randomWriteEndpoint);
                    if (response) {
                        validateResponse(response, randomWriteEndpoint);
                        sleep(0.2);
                    }
                }
            }
        }
    });
}

// 测试场景：首页测试
function testHomePage() {
    group('首页测试', function() {
        const homeEndpoint = config.endpoints.read.find(e => e.name === 'home_page');
        if (homeEndpoint) {
            const response = executeRequest(homeEndpoint);
            if (response) {
                validateResponse(response, homeEndpoint);
                sleep(0.1);
            }
        }
    });
}

// 测试场景：并发控制测试
function testConcurrency() {
    group('并发控制测试', function() {
        // 同时发起多个请求测试并发控制
        const endpoints = [
            config.endpoints.read.find(e => e.name === 'config_api'),
            config.endpoints.read.find(e => e.name === 'volumes_api'),
            config.endpoints.read.find(e => e.name === 'authors_api'),
        ].filter(Boolean);
        
        const requests = endpoints.map(endpoint => ({
            method: endpoint.method,
            url: `${config.baseUrl}${endpoint.path}`,
            params: {
                headers: config.environment.headers,
                tags: { name: `${endpoint.name}_concurrent` }
            }
        }));
        
        const responses = http.batch(requests);
        
        responses.forEach((response, index) => {
            if (response && endpoints[index]) {
                validateResponse(response, endpoints[index]);
            }
        });
        
        sleep(0.3);
    });
}

// 测试场景：速率限制测试
function testRateLimiting() {
    group('速率限制测试', function() {
        // 快速连续请求测试速率限制
        const endpoint = config.endpoints.read.find(e => e.name === 'config_api');
        if (!endpoint) return;
        
        const url = `${config.baseUrl}${endpoint.path}`;
        const params = {
            headers: config.environment.headers,
            tags: { name: `${endpoint.name}_ratelimit` }
        };
        
        let rateLimitedCount = 0;
        let successCount = 0;
        
        // 快速发送10个请求
        for (let i = 0; i < 10; i++) {
            const response = http.get(url, params);
            
            if (response.status === 429) {
                rateLimitedCount++;
                console.log(`请求 ${i+1}: 被速率限制 (429)`);
            } else if (response.status === 200) {
                successCount++;
                validateResponse(response, endpoint);
            }
            
            // 非常短的间隔，测试速率限制
            sleep(0.05);
        }
        
        console.log(`速率限制测试结果: 成功 ${successCount}, 被限制 ${rateLimitedCount}`);
    });
}

// 主测试函数
export default function() {
    // 更新并发用户数
    concurrentUsersGauge.add(1);
    
    // 根据场景选择测试组合
    const testCombinations = {
        quick: ['read', 'home'],                    // 快速测试：只读+首页
        medium: ['read', 'write', 'home'],          // 中等测试：读写混合
        high: ['read', 'write', 'mixed', 'home'],   // 高负载：全面测试
        extreme: ['read', 'write', 'mixed', 'concurrency', 'home'], // 极限测试：包含并发
        spike: ['read', 'mixed', 'concurrency'],    // 峰值测试：侧重并发
        endurance: ['read', 'write', 'mixed'],      // 耐力测试：稳定负载
        concurrent: ['read', 'write', 'concurrency', 'ratelimit'], // 并发测试
        api_endpoints: ['read', 'write', 'mixed'],  // API端点测试
    };
    
    const tests = testCombinations[scenarioName] || testCombinations.quick;
    
    // 执行选定的测试
    tests.forEach(testType => {
        switch(testType) {
            case 'read':
                testReadAPIs();
                break;
            case 'write':
                testWriteAPIs();
                break;
            case 'mixed':
                testMixedOperations();
                break;
            case 'home':
                testHomePage();
                break;
            case 'concurrency':
                testConcurrency();
                break;
            case 'ratelimit':
                testRateLimiting();
                break;
        }
        
        // 测试间随机等待
        sleep(Math.random() * 0.5);
    });
    
    // 模拟用户思考时间
    sleep(Math.random() * 1 + 0.5);
}

// 测试后处理函数
export function handleSummary(data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportName = `load-test-${scenarioName}-${timestamp}`;
    
    // 生成HTML报告
    const htmlReportPath = `${config.reporting.outputDir}/${reportName}.html`;
    
    // 生成JSON报告
    const jsonReportPath = `${config.reporting.outputDir}/${reportName}.json`;
    
    // 生成CSV报告
    const csvReportPath = `${config.reporting.outputDir}/${reportName}.csv`;
    
    // 计算性能评分
    const metrics = data.metrics;
    const performanceScore = calculatePerformanceScore(metrics);
    
    // 添加性能评分到数据
    data.performance_score = performanceScore;
    
    // 生成报告
    const reports = {};
    
    if (config.reporting.formats.includes('html')) {
        reports[htmlReportPath] = htmlReport(data);
    }
    
    if (config.reporting.formats.includes('json')) {
        reports[jsonReportPath] = JSON.stringify(data, null, 2);
    }
    
    if (config.reporting.formats.includes('csv')) {
        reports[csvReportPath] = generateCSVReport(data);
    }
    
    // 控制台输出摘要
    console.log(textSummary(data, { indent: ' ', enableColors: true }));
    
    // 输出性能评分
    console.log(`\n性能评分: ${performanceScore.score}/100 (${performanceScore.grade})`);
    console.log(`建议: ${performanceScore.recommendation}`);
    
    return reports;
}

// 计算性能评分
function calculatePerformanceScore(metrics) {
    const thresholds = config.reporting.thresholds;
    
    // 获取关键指标
    const responseTime = metrics.http_req_duration?.values?.p95 || 0;
    const errorRate = metrics.http_req_failed?.values?.rate || 0;
    const throughput = metrics.http_reqs?.values?.rate || 0;
    
    let score = 100;
    let grade = '优秀';
    let recommendation = '系统性能优秀，无需优化';
    
    // 响应时间评分
    if (responseTime > thresholds.excellent.responseTime) {
        if (responseTime <= thresholds.good.responseTime) {
            score -= 10;
            grade = '良好';
            recommendation = '响应时间可优化，考虑缓存优化';
        } else if (responseTime <= thresholds.acceptable.responseTime) {
            score -= 25;
            grade = '一般';
            recommendation = '响应时间需要优化，检查数据库查询和代码逻辑';
        } else {
            score -= 50;
            grade = '较差';
            recommendation = '响应时间严重超标，需要立即优化';
        }
    }
    
    // 错误率评分
    if (errorRate > thresholds.excellent.errorRate) {
        if (errorRate <= thresholds.good.errorRate) {
            score -= 10;
            if (grade === '优秀') grade = '良好';
            recommendation = '错误率略高，检查API稳定性';
        } else if (errorRate <= thresholds.acceptable.errorRate) {
            score -= 20;
            if (grade === '优秀' || grade === '良好') grade = '一般';
            recommendation = '错误率较高，需要修复API问题';
        } else {
            score -= 40;
            grade = '较差';
            recommendation = '错误率严重超标，系统不稳定';
        }
    }
    
    // 吞吐量评分
    if (throughput < thresholds.excellent.throughput) {
        if (throughput >= thresholds.good.throughput) {
            score -= 5;
            if (grade === '优秀') grade = '良好';
            recommendation = '吞吐量可提升，优化并发处理';
        } else if (throughput >= thresholds.acceptable.throughput) {
            score -= 15;
            if (grade === '优秀' || grade === '良好') grade = '一般';
            recommendation = '吞吐量较低，需要优化系统架构';
        } else {
            score -= 30;
            if (grade !== '较差') grade = '一般';
            recommendation = '吞吐量严重不足，需要架构优化';
        }
    }
    
    // 确保分数在0-100之间
    score = Math.max(0, Math.min(100, Math.round(score)));
    
    return {
        score,
        grade,
        recommendation,
        metrics: {
            responseTime: Math.round(responseTime),
            errorRate: (errorRate * 100).toFixed(2) + '%',
            throughput: Math.round(throughput),
        }
    };
}

// 生成CSV报告
function generateCSVReport(data) {
    const metrics = data.metrics;
    let csv = 'metric,value\n';
    
    // 添加关键指标
    const keyMetrics = [
        'http_reqs',
        'http_req_duration',
        'http_req_failed',
        'iteration_duration',
        'iterations',
        'data_received',
        'data_sent'
    ];
    
    keyMetrics.forEach(metric => {
        if (metrics[metric] && metrics[metric].values) {
            Object.entries(metrics[metric].values).forEach(([key, value]) => {
                csv += `${metric}.${key},${value}\n`;
            });
        }
    });
    
    return csv;
}