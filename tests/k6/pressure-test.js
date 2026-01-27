/**
 * K6 压力测试脚本 - Tech Radar Web
 * 功能：
 * 1. API 接口压力测试
 * 2. 长时间运行稳定性测试
 * 3. 并发请求处理能力测试
 * 4. 数据持久化测试
 */

import http from 'k6/http';
import { check, sleep, duration } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

// 测试指标
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');
const volumeCounter = new Counter('volumes_checked');
const contributionsCounter = new Counter('contributions_checked');

// 配置：千级并发测试场景
export let options = {
    stages: [
        { duration: '30s', target: 100 },  // 0-30秒: 从0到100并发
        { duration: '1m', target: 100 },   // 30s-90s: 维持100并发
        { duration: '30s', target: 500 },  // 90s-120s: 突发增加到500并发
        { duration: '1m', target: 500 },   // 120s-180s: 维持500并发（长时间稳定）
        { duration: '30s', target: 1000 }, // 180s-210s: 突发增加到1000并发
        { duration: '2m', target: 1000 },  // 210s-420s: 维持1000并发（极限压力测试）
        { duration: '30s', target: 0 },    // 420s-450s: 逐步退出到0（优雅清理）
    ],
    thresholds: {
        http_req_duration: ['p(95)<500', 'p(99)<1000'],  // 95% 请求 <500ms, 99% < 1000ms
        http_req_failed: ['rate<0.05'],                  // 错误率 <5%
        errors: ['rate<0.05'],                           // 自定义错误率 <5%
    },
};

// API 基础 URL
const BASE_URL = __ENV.API_URL || 'http://localhost:5090';

// 生成随机等待时间（0-1秒）
function randomWait() {
    sleep(0.3 + Math.random() * 0.7);
}

// 测试场景 1: 访问首页和静态资源
export function scenario_homeAccess() {
    const responses = http.batch([
        ['GET', `${BASE_URL}/`, null, { tags: { scenario: 'home' } }],
        ['GET', `${BASE_URL}/api/config`, null, { tags: { scenario: 'api_config' } }],
        ['GET', `${BASE_URL}/api/authors`, null, { tags: { scenario: 'api_authors' } }],
    ]);

    // 验证首页
    check(responses[0], {
        '首页状态码为 200': (r) => r.status === 200,
        '首页内容包含 Tech': (r) => r.body.includes('Tech'),
    }) || errorRate.add(1);

    // 验证 API 响应
    check(responses[1], {
        'Config API 状态码为 200': (r) => r.status === 200,
        'Config API 为 JSON': (r) => r.contentType.indexOf('application/json') >= 0,
    }) || errorRate.add(1);

    check(responses[2], {
        'Authors API 状态码为 200': (r) => r.status === 200,
    }) || errorRate.add(1);

    responseTime.add(responses[0].timings.duration);
    responseTime.add(responses[1].timings.duration);
    responseTime.add(responses[2].timings.duration);
}

// 测试场景 2: 批量访问期次列表
export function scenario_volumeAccess() {
    const response = http.get(`${BASE_URL}/api/volumes`, {
        tags: { scenario: 'api_volumes' },
    });

    // 检查响应
    check(response, {
        'Volumes API 状态码为 200': (r) => r.status === 200,
        'Volumes API 为 JSON': (r) => r.contentType.indexOf('application/json') >= 0,
        '返回卷数 > 0': (r) => JSON.parse(r.body).length > 0,
    }) || errorRate.add(1);

    volumeCounter.add(1);
    responseTime.add(response.timings.duration);

    // 如果有卷数据，访问详情
    if (response.status === 200) {
        try {
            const volumes = JSON.parse(response.body);
            if (volumes.length > 0) {
                const randomVolume = volumes[Math.floor(Math.random() * volumes.length)].path;
                const volResponse = http.get(`${BASE_URL}${randomVolume}`, {
                    tags: { scenario: 'volume_detail' },
                });
                responseTime.add(volResponse.timings.duration);
            }
        } catch (e) {
            errorRate.add(1);
        }
    }

    randomWait();
}

// 测试场景 3: 文章列表访问
export function scenario_contributionsAccess() {
    // 假设有一个卷编号，如果没有则使用第一个
    const volId = __ENV.VOLUME_ID || '1';

    const response = http.get(`${BASE_URL}/api/contributions/${volId}`, {
        tags: { scenario: 'api_contributions' },
    });

    check(response, {
        'Contributions API 状态码为 200': (r) => r.status === 200,
        'Contributions API 为 JSON': (r) => r.contentType.indexOf('application/json') >= 0,
    }) || errorRate.add(1);

    contributionsCounter.add(1);
    responseTime.add(response.timings.duration);

    randomWait();
}

// 测试场景 4: 长时间并发读取
export function scenario_concurrentReads() {
    const requests = [];

    // 创建多个并发请求
    for (let i = 0; i < 10; i++) {
        requests.push(
            http.get(`${BASE_URL}/api/volumes`, {
                tags: { scenario: 'concurrent_read_api' },
            })
        );
        requests.push(
            http.get(`${BASE_URL}/api/authors`, {
                tags: { scenario: 'concurrent_read_api' },
            })
        );
    }

    // 批量检查
    requests.forEach((response) => {
        check(response, {
            '读取 API 状态码为 200': (r) => r.status === 200,
        }) || errorRate.add(1);
        responseTime.add(response.timings.duration);
    });

    randomWait();
}

// 测试场景 5: 点赞功能测试
export function scenario_likes() {
    // 先获取数据
    const volumeResponse = http.get(`${BASE_URL}/api/volumes`);
    if (volumeResponse.status !== 200) return;

    let articleId;

    try {
        const volumes = JSON.parse(volumeResponse.body);
        if (volumes.length > 0) {
            const randomVol = volumes[Math.floor(Math.random() * volumes.length)];
            const contributionsRes = http.get(`${BASE_URL}${randomVol.path}`);
            if (contributionsRes.status !== 200) return;

            const contributions = JSON.parse(contributionsRes.body);
            if (contributions.length > 0) {
                articleId = contributions[Math.floor(Math.random() * contributions.length)].id;
            }
        }
    } catch (e) {
        errorRate.add(1);
        return;
    }

    if (!articleId) {
        randomWait();
        return;
    }

    // 模拟点赞/取消点赞
    let articleChecked = false;

    // 第一次点赞
    const likeResponse1 = http.post(`${BASE_URL}/api/likes/${articleId}`, null, {
        tags: { scenario: 'like_action' },
    });

    if (check(likeResponse1, { '点赞 API 状态码为 200': (r) => r.status === 200 })) {
        articleChecked = true;
    } else {
        errorRate.add(1);
    }

    responseTime.add(likeResponse1.timings.duration);

    // 模拟取消点赞
    const unlikeResponse = http.post(`${BASE_URL}/api/likes/${articleId}`, null, {
        tags: { scenario: 'unlike_action' },
    });

    check(unlikeResponse, {
        '取消点赞 API 状态码为 200': (r) => r.status === 200,
    }) || errorRate.add(1);

    responseTime.add(unlikeResponse.timings.duration);

    randomWait();
}

// 测试场景 6: 阅读量统计测试
export function scenario_views() {
    const volId = __ENV.VOLUME_ID || '1';

    // 读取当前阅读量
    const viewsResponse = http.get(`${BASE_URL}/api/views/${volId}`, {
        tags: { scenario: 'get_views' },
    });

    check(viewsResponse, {
        '阅读量 API 状态码为 200': (r) => r.status === 200,
    }) || errorRate.add(1);

    responseTime.add(viewsResponse.timings.duration);

    // 模拟增加阅读量
    const viewsUpdateResponse = http.post(`${BASE_URL}/api/views/${volId}`, null, {
        tags: { scenario: 'update_views' },
    });

    check(viewsUpdateResponse, {
        '更新阅读量 API 状态码为 200': (r) => r.status === 200,
    }) || errorRate.add(1);

    responseTime.add(viewsUpdateResponse.timings.duration);

    randomWait();
}

// 测试场景 7: 负载均衡测试（多个 API 端点）
export function scenario_loadBalance() {
    const endpoints = [
        `${BASE_URL}/api/config`,
        `${BASE_URL}/api/authors`,
        `${BASE_URL}/api/volumes`,
        `${BASE_URL}/api/health`,
    ];

    endpoints.forEach((endpoint) => {
        const response = http.get(endpoint, {
            tags: { scenario: 'load_balanced' },
        });

        check(response, {
            '负载均衡 API 状态码为 200': (r) => r.status === 200,
        }) || errorRate.add(1);

        responseTime.add(response.timings.duration);
        randomWait();
    });
}

// 主测试路由
export default function (data) {
    const scenarios = {
        'home_access': scenario_homeAccess,
        'volume_access': scenario_volumeAccess,
        'contributions_access': scenario_contributionsAccess,
        'concurrent_reads': scenario_concurrentReads,
        'likes': scenario_likes,
        'views': scenario_views,
        'load_balance': scenario_loadBalance,
    };

    // 随机选择执行不同场景
    const scenarioKeys = Object.keys(scenarios);
    const randomScenario = scenarioKeys[Math.floor(Math.random() * scenarioKeys.length)];

    scenarios[randomScenario](data);

    // 短暂休眠模拟实际用户
    sleep(1);
}

// 自定义 VUs（虚拟用户）函数
export function handleSummary(data) {
    return {
        'summary.html': htmlReport(data),
        'summary.json': JSON.stringify(data),
    };
}

// 简单的 HTML 报告生成函数
function htmlReport(data) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>压力测试报告</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            .passed { color: green; }
            .failed { color: red; }
        </style>
    </head>
    <body>
        <h1>K6 压力测试报告</h1>
        <p>测试时间: ${new Date().toLocaleString()}</p>
        <p>VUs (虚拟用户): ${data.metrics.http_vus.mean.toFixed(0)}</p>
        <p>请求总数: ${data.metrics.http_reqs.value.toFixed(0)}</p>
        <p>失败率: ${(data.metrics.http_req_failed.rate * 100).toFixed(2)}%</p>
        <p>平均响应时间: ${data.metrics.http_req_duration.avg.toFixed(0)}ms</p>
        <p>P95 响应时间: ${data.metrics.http_req_duration["p(95)"].toFixed(0)}ms</p>
        <p>P99 响应时间: ${data.metrics.http_req_duration["p(99)"].toFixed(0)}ms</p>
    </body>
    </html>
    `;
}