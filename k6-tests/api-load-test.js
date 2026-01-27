import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '30s', target: 100 },    // 30秒内增加到100用户
        { duration: '1m', target: 500 },     // 1分钟内增加到500用户
        { duration: '2m', target: 1000 },    // 2分钟内增加到1000用户
        { duration: '1m', target: 0 },       // 1分钟内降为0
    ],
    thresholds: {
        'http_req_duration': ['p(95)<500'],  // 95%请求<500ms
        'http_req_failed': ['rate<0.01'],    // 错误率<1%
    },
};

const BASE_URL = 'http://localhost:5090';

export default function() {
    // 测试健康检查端点
    let res1 = http.get(`${BASE_URL}/api/health`);
    check(res1, {
        'health status is 200': (r) => r.status === 200,
        'health response time < 200ms': (r) => r.timings.duration < 200,
    });

    // 测试期刊列表端点
    let res2 = http.get(`${BASE_URL}/api/volumes`);
    check(res2, {
        'volumes status is 200': (r) => r.status === 200,
        'volumes has data': (r) => JSON.parse(r.body).length > 0,
    });

    // 测试特定期刊的投稿列表
    let res3 = http.get(`${BASE_URL}/api/contributions/001`);
    check(res3, {
        'contributions status is 200': (r) => r.status === 200,
        'contributions has data': (r) => JSON.parse(r.body).length > 0,
    });

    // 测试作者列表
    let res4 = http.get(`${BASE_URL}/api/authors`);
    check(res4, {
        'authors status is 200': (r) => r.status === 200,
        'authors has data': (r) => JSON.parse(r.body).length > 0,
    });

    sleep(1); // 模拟用户思考时间
}