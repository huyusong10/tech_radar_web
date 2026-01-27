import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '30s', target: 200 },    // 30秒增加到200并发
        { duration: '1m', target: 800 },     // 1分钟增加到800并发
        { duration: '2m', target: 1500 },    // 2分钟增加到1500并发
        { duration: '1m', target: 2000 },    // 1分钟增加到2000并发
        { duration: '2m', target: 2000 },    // 保持2000并发2分钟
        { duration: '1m', target: 500 },     // 1分钟降到500并发
        { duration: '30s', target: 0 },      // 30秒降到0
    ],
    thresholds: {
        'http_req_duration': ['p(95)<1000'],  // 95%请求<1秒
        'http_req_failed': ['rate<0.02'],     // 错误率<2%
    },
    // 启用连接池以减少TCP压力
    // noConnectionReuse: false, // 默认启用连接复用
    batch: 15, // 请求批处理
    discardResponseBodies: true, // 丢弃响应体以节省内存
};

const BASE_URL = 'http://localhost:5090';

export default function() {
    // 随机选择测试场景
    const scenario = Math.random();
    
    if (scenario < 0.3) {
        // 30%：简单健康检查
        const res = http.get(`${BASE_URL}/api/health`);
        check(res, {
            'health status 200': (r) => r.status === 200,
            'health response < 200ms': (r) => r.timings.duration < 200,
        });
    } else if (scenario < 0.6) {
        // 30%：期刊列表和内容
        const res1 = http.get(`${BASE_URL}/api/volumes`);
        check(res1, { 'volumes status 200': (r) => r.status === 200 });
        
        // 如果成功获取期刊列表，随机选择一个查看详情
        if (res1.status === 200) {
            const volumes = JSON.parse(res1.body);
            if (volumes.length > 0) {
                const randomVol = volumes[Math.floor(Math.random() * volumes.length)].vol;
                const res2 = http.get(`${BASE_URL}/api/contributions/${randomVol}`);
                check(res2, { 'contributions status 200': (r) => r.status === 200 });
            }
        }
    } else if (scenario < 0.9) {
        // 30%：静态文件访问
        const files = [
            '/index.html',
            '/contents/published/vol-001/radar.md',
            '/contents/published/vol-002/radar.md',
            '/contents/shared/authors.md',
        ];
        const file = files[Math.floor(Math.random() * files.length)];
        const res = http.get(BASE_URL + file);
        check(res, {
            'static file status 200': (r) => r.status === 200,
            'static file response < 500ms': (r) => r.timings.duration < 500,
        });
    } else {
        // 10%：写操作（阅读量记录）
        const volumes = ['001', '002'];
        const vol = volumes[Math.floor(Math.random() * volumes.length)];
        const res = http.post(`${BASE_URL}/api/views/${vol}`, null, {
            headers: { 'Content-Type': 'application/json' },
        });
        check(res, {
            'view POST status 200': (r) => r.status === 200,
            'view response < 1000ms': (r) => r.timings.duration < 1000,
        });
    }
    
    // 模拟用户思考时间：0.2-1.2秒
    sleep(Math.random() + 0.2);
}