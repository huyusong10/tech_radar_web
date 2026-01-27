// == k6 配置文件 - Tech Radar Web
// 设置 K6 运行环境参数

import { htmlReport } from 'https://jslib.k6.io/k6/https/';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 自定义指标
const passRate = new Rate('pass_rate');
const responseTime = new Trend('response_time_ms');

// 压力测试配置
// 这里的 options 基于 k6 的标准配置
export let options = {
    // 持续时间设置
    // stages 定义负载增长曲线:
    // { duration: '时间', target: '目标并发数' } - 指定在该阶段的目标并发数
    stages: [
        // 阶段1: 冷启动测试 (30秒, 0-200并发)
        { duration: '30s', target: 200 },

        // 阶段2: 稳定负载测试 (60秒, 200-500并发)
        { duration: '1m', target: 500 },

        // 阶段3: 高负载测试 (60秒, 500-800并发)
        { duration: '1m', target: 800 },

        // 阶段4: 极限压力测试 (60秒, 800-1000并发)
        { duration: '1m', target: 1000 },

        // 阶段5: 逐步退出 (60秒, 1000-0并发)
        { duration: '1m', target: 0 },
    ],

    // 性能阈值 (失败条件)
    thresholds: {
        // 95% 的请求应该在 500ms 内完成
        // 99% 的请求应该在 1000ms 内完成
        'http_req_duration': ['p(95)<500', 'p(99)<1000'],

        // 错误率应该低于 5%
        'http_req_failed': ['rate<0.05'],

        // 自定义错误率
        'pass_rate': ['rate>0.95'],

        // 吞吐量应该至少 100 req/s
        'http_reqs': ['rate>100'],
    },

    // 测试会话配置
    // 测试持续时间
    // 测试迭代数
    // 测试场景选择 (默认为 'default-test-scenario')

    // 测试场景分配
    scenarios: {
        'static-asset-load': { executor: 'constant-vus', exec: 'staticAssetLoad', vus: 50, duration: '1m' },
        'api-requests': { executor: 'ramping-vus', exec: 'apiRequests', startVUs: 50, stages: getStages() },
    },
};

// 获取压力测试阶段配置
function getStages() {
    return [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 200 },
        { duration: '1m', target: 400 },
        { duration: '1m', target: 600 },
        { duration: '1m', target: 800 },
        { duration: '1m', target: 1000 },
        { duration: '30s', target: 0 },
    ];
}

// 测试场景1: 访问静态资产
function staticAssetLoad() {
    const baseUrl = __ENV.API_URL || 'http://localhost:5090';

    // 测试主页加载
    const getBaseResponse = http.get(\`\${baseUrl}/\`);
    const responseTimeVal = getBaseResponse.timings.duration;
    passRate.add(getBaseResponse.status === 200);
    responseTime.add(responseTimeVal);

    // 测试 API 端点
    const configResponse = http.get(\`\${baseUrl}/api/config\`);
    passRate.add(configResponse.status === 200);
    responseTime.add(configResponse.timings.duration);

    const authorsResponse = http.get(\`\${baseUrl}/api/authors\`);
    passRate.add(authorsResponse.status === 200);
    responseTime.add(authorsResponse.timings.duration);

    sleep(0.1);
}

// 测试场景2: 并发 API 请求
function apiRequests() {
    const baseUrl = __ENV.API_URL || 'http://localhost:5090';
    const volumeId = '1';

    // 批量获取卷列表
    const volumeResponse = http.get(\`\${baseUrl}/api/volumes\`);
    passRate.add(volumeResponse.status === 200);
    responseTime.add(volumeResponse.timings.duration);

    // 获取卷详情
    const contributionsResponse = http.get(\`\${baseUrl}/api/contributions/\${volumeId}\`);
    passRate.add(contributionsResponse.status === 200);
    responseTime.add(contributionsResponse.timings.duration);

    // 获取作者列表
    const authorsResponse = http.get(\`\${baseUrl}/api/authors\`);
    passRate.add(authorsResponse.status === 200);
    responseTime.add(authorsResponse.timings.duration);

    sleep(0.5);
}

// 默认测试入口
// 注意: 在实际的 k6 运行中，这个函数会被导入的测试文件中的 default 函数覆盖
export default function (data) {
    // 这里是默认测试执行逻辑，实际会根据 scenarios 配置调用对应的函数
    sleep(0.1);
}

// 自定义测试数据生成
export function setup() {
    const data = {
        baseUrl: __ENV.API_URL || 'http://localhost:5090',
        timestamp: Date.now(),
        environment: __ENV.NODE_ENV || 'development',
    };
    return data;
}

// 钩子函数
export function teardown(data) {
    console.log('测试完成，总执行时间:', data.timestamp);
}

// 辅助函数: 错误处理
function handleError(response, name) {
    if (!check(response, { [name + '成功': (r) => r.status === 200] })) {
        console.error(\`\${name} 失败: Status \${response.status}\`, response.error);
        return false;
    }
    return true;
}

// 辅助函数: 随机等待
function randomWait(minDuration = 0.25, maxDuration = 1.0) {
    sleep(minDuration + Math.random() * (maxDuration - minDuration));
}

// 辅助函数: 批量请求
function batchGet(urls) {
    const responses = http.batch(
        urls.map(url => ['GET', url])
    );

    return responses.map((response, index) => {
        const success = response && response.status === 200;
        if (!success) {
            console.error(\`批量请求 [\${index}] 失败: Status \${response?.status}\`);
        }
        return success;
    });
}

// 环境变量配置
// K6 环境变量示例:
// K6_API_URL=http://localhost:5090
// K6_NODE_ENV=production
// K6_DURATION=10m
// K6_VUS=1000