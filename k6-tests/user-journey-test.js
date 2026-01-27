import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '1m', target: 200 },
        { duration: '3m', target: 800 },
        { duration: '2m', target: 1200 },  // 达到1200并发用户
        { duration: '1m', target: 0 },
    ],
};

const BASE_URL = 'http://localhost:5090';

export default function() {
    // 1. 用户访问首页
    let res1 = http.get(`${BASE_URL}/index.html`);
    check(res1, { 'homepage loaded': (r) => r.status === 200 });
    
    // 2. 加载期刊列表（侧边栏）
    let res2 = http.get(`${BASE_URL}/api/volumes`);
    check(res2, { 'volumes loaded': (r) => r.status === 200 });
    
    // 3. 随机选择一个期刊查看
    const volumes = JSON.parse(res2.body);
    if (volumes.length > 0) {
        const randomVol = volumes[Math.floor(Math.random() * volumes.length)].vol;
        
        // 4. 加载该期刊的雷达内容
        let res3 = http.get(`${BASE_URL}/contents/published/vol-${randomVol}/radar.md`);
        check(res3, { 'radar content loaded': (r) => r.status === 200 });
        
        // 5. 加载该期刊的投稿列表
        let res4 = http.get(`${BASE_URL}/api/contributions/${randomVol}`);
        check(res4, { 'contributions loaded': (r) => r.status === 200 });
        
        // 6. 记录阅读量（POST请求）
        let res5 = http.post(`${BASE_URL}/api/views/${randomVol}`, null, {
            headers: { 'Content-Type': 'application/json' },
        });
        check(res5, { 'view recorded': (r) => r.status === 200 });
        
        // 7. 10%的用户进行点赞
        if (Math.random() < 0.1) {
            const contributions = JSON.parse(res4.body);
            if (contributions.length > 0) {
                const randomArticle = contributions[0].id;
                let res6 = http.post(`${BASE_URL}/api/likes/${randomArticle}`, null, {
                    headers: { 'Content-Type': 'application/json' },
                });
                check(res6, { 'like recorded': (r) => r.status === 200 });
            }
        }
    }
    
    sleep(Math.random() * 2 + 1); // 模拟用户阅读时间1-3秒
}