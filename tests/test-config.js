# Tech Radar Web 测试环境配置
# 用于开发和测试环境的配置文件

# 服务器配置
SERVER_CONFIG={
    host: "localhost",
    port: 5090,
    environment: "development"
}

# 测试环境配置
TEST_ENV={
    api_url: "http://localhost:5090",
    volume_id: "1",
    test_duration: "5m",
    max_concurrent: "1000"
}

# K6 配置
K6_CONFIG={
    version: "0.52.2",
    threshold: {
        http_req_duration: "p(95)<500, p(99)<1000",
        http_req_failed: "rate<0.05",
        errors: "rate<0.05"
    }
}

# 压力测试配置
STRESS_TEST={
    stages: [
        { duration: "30s", target: 50 },
        { duration: "60s", target: 100 },
        { duration: "60s", target: 200 },
        { duration: "60s", target: 500 },
        { duration: "30s", target: 1000 },
        { duration: "60s", target: 0 }
    ]
}

# 性能测试配置
PERFORMANCE_TEST={
    stages: [
        { executor: "per-vu-iterations", vus: 10, iterations: 100, duration: "30s" },
        { executor: "ramping-arrival-rate", startRate: 1, preAllocatedVUs: 10, stages: [...] },
        { executor: "constant-vus", vus: 20, duration: "5m" },
        { executor: "constant-upload-rate", stages: [...] },
        { executor: "ramping-vus", startVUs: 5, stages: [...] }
    ]
}

# 环境变量
ENV_VARS={
    K6_API_URL: "http://localhost:5090",
    K6_VOLUME_ID: "1",
    K6_TEST_MODE: "full",
    TEST_OUTPUT_DIR: "./tests/results"
}

# 测试场景
SCENARIOS={
    micro_benchmark: {
        description: "高频 API 微基准测试",
        endpoints: [
            { url: "/api/config", expected_time: "<100ms" },
            { url: "/api/authors", expected_time: "<100ms" },
            { url: "/api/volumes", expected_time: "<100ms" }
        ]
    },
    basic_performance: {
        description: "基础功能性能测试",
        endpoints: [
            { url: "/", expected_time: "<300ms" },
            { url: "/api/config", expected_time: "<100ms" },
            { url: "/api/authors", expected_time: "<100ms" },
            { url: "/api/volumes", expected_time: "<200ms" }
        ]
    },
    long_running: {
        description: "长时间运行性能监控",
        duration: "5m",
        vus: 20
    },
    concurrent_stress: {
        description: "并发负载测试",
        stages: [
            { duration: "30s", target: 50 },
            { duration: "60s", target: 200 },
            { duration: "30s", target: 500 },
            { duration: "60s", target: 1000 }
        ]
    },
    cache_effectiveness: {
        description: "缓存效率测试",
        test_flows: [
            {
                name: "缓存命中测试",
                steps: [
                    { action: "get", url: "/api/volumes", label: "first_request" },
                    { action: "get", url: "/api/volumes", label: "cached_request" }
                ]
            }
        ]
    }
}

# 健康检查配置
HEALTH_CHECK={
    endpoints: [
        { path: "/api/config", timeout: "5000ms" },
        { path: "/api/volumes", timeout: "5000ms" },
        { path: "/api/authors", timeout: "5000ms" },
        { path: "/api/health", timeout: "5000ms" }
    ],
    expected_status: [200, 304],
    max_response_time: "3000ms",
    retry_count: 3
}

# 输出配置
OUTPUT={
    json: {
        enabled: true,
        format: "k6-output-format",
        directory: "./tests/results"
    },
    html: {
        enabled: true,
        directory: "./tests/results"
    },
    csv: {
        enabled: false,
        directory: "./tests/results"
    }
}