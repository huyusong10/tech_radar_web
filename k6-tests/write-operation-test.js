import http from 'k6/http';
import { check } from 'k6';

export const options = {
    stages: [
        { duration: '30s', target: 50 },   // 写操作并发较低
        { duration: '1m', target: 100 },
        { duration: '2m', target: 200 },
        { duration: '30s', target: 0 },
    ],
    thresholds: {
        'http_req_duration': ['p(95)<1000'], // 写操作允许更长时间
    },
};

const BASE_URL = 'http://localhost:5090';

export default function() {
    // 随机选择操作类型
    if (Math.random() < 0.7) {
        // 70%：记录阅读量
        const vol = `00${Math.floor(Math.random() * 2) + 1}`;
        let res = http.post(`${BASE_URL}/api/views/${vol}`, null, {
            headers: { 'Content-Type': 'application/json' },
        });
        check(res, {
            'view POST status 200': (r) => r.status === 200,
            'not rate limited': (r) => r.status !== 429,
        });
    } else {
        // 30%：点赞
        const articles = ['typescript-types', 'react-virtual-list', 'k8s-optimization', 'go-error-handling'];
        const articleId = articles[Math.floor(Math.random() * articles.length)];
        let res = http.post(`${BASE_URL}/api/likes/${articleId}`, null, {
            headers: { 'Content-Type': 'application/json' },
        });
        check(res, {
            'like POST status 200': (r) => r.status === 200,
            'not rate limited': (r) => r.status !== 429,
        });
    }
}