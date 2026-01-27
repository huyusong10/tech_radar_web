import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '30s', target: 1000 },
        { duration: '30s', target: 2000 },
        { duration: '30s', target: 3000 },
        { duration: '30s', target: 4000 },
        { duration: '30s', target: 5000 },  // 逐步增加到5000并发
        { duration: '1m', target: 5000 },   // 保持峰值
        { duration: '30s', target: 0 },
    ],
    noConnectionReuse: true,  // 禁用连接复用，增加压力
};

const BASE_URL = 'http://localhost:5090';
const ENDPOINTS = [
    '/api/health',
    '/api/volumes',
    '/api/contributions/001',
    '/contents/published/vol-001/radar.md',
];

export default function() {
    const endpoint = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
    const res = http.get(BASE_URL + endpoint);
    
    // 宽松的检查，主要观察系统行为
    check(res, {
        'got response': (r) => r.status !== undefined,
    });
    
    // 极短的思考时间，最大化压力
    sleep(0.1);
}