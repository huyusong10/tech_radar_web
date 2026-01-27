import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '30s', target: 500 },
        { duration: '1m', target: 1000 },
        { duration: '2m', target: 2000 },  // 静态文件可支持更高并发
        { duration: '30s', target: 0 },
    ],
};

const BASE_URL = 'http://localhost:5090';
const STATIC_FILES = [
    '/index.html',
    '/contents/published/vol-001/radar.md',
    '/contents/published/vol-001/contributions/01-typescript-types/index.md',
    '/contents/shared/authors.md',
];

export default function() {
    const file = STATIC_FILES[Math.floor(Math.random() * STATIC_FILES.length)];
    const res = http.get(BASE_URL + file);
    
    check(res, {
        'status is 200': (r) => r.status === 200,
        'content type correct': (r) => r.headers['Content-Type'] !== undefined,
        'response size > 0': (r) => r.body.length > 0,
    });
    
    sleep(0.5);
}