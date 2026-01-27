/**
 * 负载测试配置
 * 用于配置不同级别的压力测试
 */

module.exports = {
    // 基础配置
    baseUrl: 'http://localhost:5090',
    
    // 测试场景配置
    scenarios: {
        // 1. 轻量级测试 - 用于开发环境快速验证
        quick: {
            name: '快速测试',
            description: '50个虚拟用户，持续30秒',
            stages: [
                { duration: '10s', target: 10 },  // 10秒内增加到10个用户
                { duration: '10s', target: 50 },  // 10秒内增加到50个用户
                { duration: '10s', target: 50 },  // 保持50个用户10秒
            ],
            thresholds: {
                http_req_duration: ['p(95)<1000'],  // 95%的请求在1秒内完成
                http_req_failed: ['rate<0.01'],     // 错误率低于1%
            }
        },
        
        // 2. 中等负载测试 - 模拟正常生产负载
        medium: {
            name: '中等负载测试',
            description: '200个虚拟用户，持续2分钟',
            stages: [
                { duration: '30s', target: 50 },    // 30秒内增加到50个用户
                { duration: '30s', target: 100 },   // 30秒内增加到100个用户
                { duration: '30s', target: 200 },   // 30秒内增加到200个用户
                { duration: '30s', target: 200 },   // 保持200个用户30秒
            ],
            thresholds: {
                http_req_duration: ['p(95)<2000'],  // 95%的请求在2秒内完成
                http_req_failed: ['rate<0.005'],    // 错误率低于0.5%
            }
        },
        
        // 3. 高负载测试 - 压力测试
        high: {
            name: '高负载测试',
            description: '500个虚拟用户，持续3分钟',
            stages: [
                { duration: '30s', target: 100 },   // 30秒内增加到100个用户
                { duration: '30s', target: 250 },   // 30秒内增加到250个用户
                { duration: '30s', target: 500 },   // 30秒内增加到500个用户
                { duration: '90s', target: 500 },   // 保持500个用户90秒
            ],
            thresholds: {
                http_req_duration: ['p(95)<3000'],  // 95%的请求在3秒内完成
                http_req_failed: ['rate<0.01'],     // 错误率低于1%
            }
        },
        
        // 4. 极限压力测试 - 千级并发测试
        extreme: {
            name: '极限压力测试',
            description: '1000个虚拟用户，持续5分钟',
            stages: [
                { duration: '30s', target: 100 },   // 30秒内增加到100个用户
                { duration: '30s', target: 300 },   // 30秒内增加到300个用户
                { duration: '30s', target: 600 },   // 30秒内增加到600个用户
                { duration: '30s', target: 1000 },  // 30秒内增加到1000个用户
                { duration: '180s', target: 1000 }, // 保持1000个用户3分钟
            ],
            thresholds: {
                http_req_duration: ['p(95)<5000'],  // 95%的请求在5秒内完成
                http_req_failed: ['rate<0.02'],     // 错误率低于2%
            }
        },
        
        // 5. 峰值测试 - 模拟突发流量
        spike: {
            name: '峰值测试',
            description: '从100到1000用户的突发流量',
            stages: [
                { duration: '10s', target: 100 },   // 10秒内增加到100个用户
                { duration: '10s', target: 1000 },  // 10秒内突增到1000个用户
                { duration: '30s', target: 1000 },  // 保持1000个用户30秒
                { duration: '10s', target: 100 },   // 10秒内降到100个用户
            ],
            thresholds: {
                http_req_duration: ['p(95)<4000'],  // 95%的请求在4秒内完成
                http_req_failed: ['rate<0.015'],    // 错误率低于1.5%
            }
        },
        
        // 6. 耐力测试 - 长时间运行测试
        endurance: {
            name: '耐力测试',
            description: '300个虚拟用户，持续10分钟',
            stages: [
                { duration: '30s', target: 50 },    // 30秒内增加到50个用户
                { duration: '30s', target: 150 },   // 30秒内增加到150个用户
                { duration: '30s', target: 300 },   // 30秒内增加到300个用户
                { duration: '480s', target: 300 },  // 保持300个用户8分钟
            ],
            thresholds: {
                http_req_duration: ['p(95)<2000'],  // 95%的请求在2秒内完成
                http_req_failed: ['rate<0.005'],    // 错误率低于0.5%
                memory_usage: ['value<500000000'],  // 内存使用低于500MB
            }
        },
        
        // 7. 并发读写测试 - 测试并发控制
        concurrent: {
            name: '并发读写测试',
            description: '混合读写操作，200个用户',
            stages: [
                { duration: '30s', target: 50 },    // 30秒内增加到50个用户
                { duration: '30s', target: 100 },   // 30秒内增加到100个用户
                { duration: '30s', target: 200 },   // 30秒内增加到200个用户
                { duration: '60s', target: 200 },   // 保持200个用户60秒
            ],
            thresholds: {
                http_req_duration: ['p(95)<2500'],  // 95%的请求在2.5秒内完成
                http_req_failed: ['rate<0.01'],     // 错误率低于1%
            }
        },
        
        // 8. API端点专项测试
        api_endpoints: {
            name: 'API端点测试',
            description: '针对所有API端点的测试',
            stages: [
                { duration: '30s', target: 100 },   // 30秒内增加到100个用户
                { duration: '60s', target: 100 },   // 保持100个用户60秒
            ],
            thresholds: {
                http_req_duration: ['p(95)<1500'],  // 95%的请求在1.5秒内完成
                http_req_failed: ['rate<0.005'],    // 错误率低于0.5%
            }
        }
    },
    
    // API端点配置
    endpoints: {
        // 只读API
        read: [
            { method: 'GET', path: '/api/config', name: 'config_api' },
            { method: 'GET', path: '/api/authors', name: 'authors_api' },
            { method: 'GET', path: '/api/volumes', name: 'volumes_api' },
            { method: 'GET', path: '/api/contributions/001', name: 'contributions_api' },
            { method: 'GET', path: '/api/likes', name: 'likes_api' },
            { method: 'GET', path: '/api/views/001', name: 'views_api' },
            { method: 'GET', path: '/api/health', name: 'health_api' },
            { method: 'GET', path: '/', name: 'home_page' },
        ],
        
        // 写操作API
        write: [
            { 
                method: 'POST', 
                path: '/api/likes/001-01-test-article', 
                name: 'like_api',
                body: { action: 'like' }
            },
            { 
                method: 'POST', 
                path: '/api/views/001', 
                name: 'view_api',
                body: {}
            },
        ],
        
        // 混合操作API
        mixed: [
            { method: 'GET', path: '/api/config', name: 'config_api' },
            { method: 'GET', path: '/api/volumes', name: 'volumes_api' },
            { 
                method: 'POST', 
                path: '/api/views/001', 
                name: 'view_api',
                body: {}
            },
        ]
    },
    
    // 测试环境配置
    environment: {
        // 请求头
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'TechRadar-LoadTest/1.0',
        },
        
        // 超时设置
        timeout: {
            request: 30000,  // 30秒请求超时
            connection: 60000, // 60秒连接超时
        },
        
        // 重试策略
        retry: {
            maxAttempts: 3,
            delay: 1000,  // 1秒延迟
        },
        
        // 采样率
        sampling: {
            rate: 1.0,  // 100%采样
        }
    },
    
    // 监控配置
    monitoring: {
        // 系统指标
        system: {
            cpu: true,
            memory: true,
            disk: false,
            network: false,
        },
        
        // 应用指标
        application: {
            responseTime: true,
            throughput: true,
            errorRate: true,
            concurrentUsers: true,
        },
        
        // 数据库指标（如果适用）
        database: {
            connections: false,
            queries: false,
        }
    },
    
    // 报告配置
    reporting: {
        formats: ['html', 'json', 'csv'],
        outputDir: './tests/reports',
        
        // 性能指标阈值
        thresholds: {
            excellent: {
                responseTime: 1000,  // 1秒以内
                errorRate: 0.001,    // 0.1%错误率
                throughput: 100,     // 100请求/秒
            },
            good: {
                responseTime: 2000,  // 2秒以内
                errorRate: 0.005,    // 0.5%错误率
                throughput: 50,      // 50请求/秒
            },
            acceptable: {
                responseTime: 5000,  // 5秒以内
                errorRate: 0.01,     // 1%错误率
                throughput: 20,      // 20请求/秒
            },
            poor: {
                responseTime: 10000, // 10秒以上
                errorRate: 0.05,     // 5%错误率
                throughput: 10,      // 10请求/秒以下
            }
        }
    }
};