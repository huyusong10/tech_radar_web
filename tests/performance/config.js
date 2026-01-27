const siteConfig = require('../../site.config.js');

module.exports = {
    server: {
        host: 'localhost',
        port: siteConfig.server?.port || 5090,
        baseUrl: `http://localhost:${siteConfig.server?.port || 5090}`
    },

    scenarios: {
        light: {
            duration: 30,
            arrivalRate: 2,
            maxVusers: 5
        },

        moderate: {
            duration: 60,
            arrivalRate: 4,
            maxVusers: 10
        },

        heavy: {
            duration: 120,
            arrivalRate: 10,
            maxVusers: 25
        },

        spike: {
            duration: 60,
            phases: [
                { duration: 10, arrivalRate: 2 },
                { duration: 20, arrivalRate: 15 },
                { duration: 30, arrivalRate: 3 }
            ],
            maxVusers: 30
        }
    },

    endpoints: {
        read: [
            '/api/config',
            '/api/authors', 
            '/api/volumes',
            '/api/contributions/vol-001',
            '/api/likes',
            '/api/views/vol-001',
            '/api/health',
            '/'
        ],

        write: [
            '/api/likes/article-001',
            '/api/views/vol-001'
        ]
    },

    thresholds: {
        responseTime: {
            read: { p95: 200, p99: 500 },
            write: { p95: 300, p99: 800 }
        },
        throughput: {
            read: { min: 50, target: 100 },
            write: { min: 5, target: 10 }
        },
        errorRate: { max: 0.01 }
    },

    monitoring: {
        interval: 1000,
        metrics: [
            'responseTime',
            'throughput',
            'errorRate',
            'memoryUsage',
            'cpuUsage',
            'activeConnections'
        ]
    },

    reports: {
        outputDir: './tests/performance/reports',
        formats: ['json', 'html'],
        includeCharts: true,
        retention: { days: 30 }
    }
};