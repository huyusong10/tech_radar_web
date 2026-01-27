import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '1m', target: 500 },     // 1分钟增加到500并发
        { duration: '2m', target: 1500 },    // 2分钟增加到1500并发
        { duration: '3m', target: 3000 },    // 3分钟增加到3000并发
        { duration: '2m', target: 5000 },    // 2分钟增加到5000并发
        { duration: '2m', target: 5000 },    // 保持5000并发2分钟
        { duration: '1m', target: 1000 },    // 1分钟降到1000并发
        { duration: '30s', target: 0 },      // 30秒降到0
    ],
    // Connection reuse enabled to reduce TCP connection pressure
    // noConnectionReuse: false, // Default is false (reuse enabled)
    
    // Timeout settings
    httpDebug: false, // Disable debug logging to reduce noise
    batch: 20, // Group requests in batches
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
    
    // Add timeout to individual requests
    const params = {
        timeout: '30s', // 30 second timeout per request
    };
    
    const res = http.get(BASE_URL + endpoint, params);
    
    // More detailed checks
    check(res, {
        'got response': (r) => r.status !== undefined,
        'response within 10s': (r) => r.timings.duration < 10000,
        'no connection error': (r) => !r.error || !r.error.includes('dial'),
    });
    
    // Variable sleep time to simulate more realistic load
    sleep(Math.random() * 0.5 + 0.1); // 0.1 to 0.6 seconds
}