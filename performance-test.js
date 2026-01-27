/**
 * Tech Radar Performance Testing Tool
 *
 * This script performs detailed performance testing on the Tech Radar server.
 * It measures response times, throughput, and resource utilization.
 *
 * Usage: node performance-test.js [options]
 *
 * Options:
 *   -r, --requests <n>       Number of requests to make (default: 1000)
 *   -s, --server-port <port> Server port (default: 5090)
 *   -d, --duration <s>       Test duration in seconds (default: 30)
 *   -i, --interval <ms>      Interval between requests (default: 10)
 *   -t, --test-type <type>   Test type: 'single', 'throughput', 'stability' (default: 'single')
 *   -c, --concurrency <n>    Concurrency level (default: 1)
 *   -o, --output <file>      Output results to JSON file
 *   -v, --verbose            Enable verbose output
 */

const http = require('http');
const url = require('url');
const fs = require('fs');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
    requests: 1000,
    serverPort: 5090,
    duration: 30,
    interval: 10,
    testType: 'single',
    concurrency: 1,
    output: null,
    verbose: false
};

args.forEach(arg => {
    if (arg.startsWith('-r=')) options.requests = parseInt(arg.split('=')[1]);
    if (arg.startsWith('-s=')) options.serverPort = parseInt(arg.split('=')[1]);
    if (arg.startsWith('-d=')) options.duration = parseInt(arg.split('=')[1]);
    if (arg.startsWith('-i=')) options.interval = parseInt(arg.split('=')[1]);
    if (arg.startsWith('-t=')) options.testType = arg.split('=')[1];
    if (arg.startsWith('-c=')) options.concurrency = parseInt(arg.split('=')[1]);
    if (arg.startsWith('-o=')) options.output = arg.split('=')[1];
    if (arg === '-v' || arg === '--verbose') options.verbose = true;
});

console.log('='.repeat(70));
console.log('Tech Radar Performance Testing');
console.log('='.repeat(70));
console.log(`Requests: ${options.requests}`);
console.log(`Test duration: ${options.duration}s`);
console.log(`Concurrency: ${options.concurrency}`);
console.log(`Test type: ${options.testType}`);
console.log(`Server port: ${options.serverPort}`);
console.log('='.repeat(70));

// Test endpoints with expected response types
const ENDPOINTS = {
    config: '/api/config',
    authors: '/api/authors',
    volumes: '/api/volumes',
    health: '/api/health',
    contributions: '/api/contributions/001'
};

// Performance metrics
let metrics = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    startTime: 0,
    endTime: 0,
    latencies: [],
    statusCodeDistribution: {},
    throughputHistory: []
};

// Make HTTP request
function makeRequest(endpoint, body = null) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const parsedUrl = url.parse(`http://localhost:${options.serverPort}${endpoint}`);
        const client = http;

        const req = client.request(parsedUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': JSON.stringify(body || {}).length
            }
        }, (res) => {
            let data = '';

            res.on('data', chunk => data += chunk);

            res.on('end', () => {
                const responseTime = Date.now() - startTime;
                metrics.latencies.push(responseTime);

                const status = res.statusCode;
                metrics.statusCodeDistribution[status] = (metrics.statusCodeDistribution[status] || 0) + 1;

                if (status >= 200 && status < 300) {
                    metrics.successRequests++;
                } else {
                    metrics.failedRequests++;
                }

                resolve({ statusCode: status, responseTime });
            });
        });

        req.on('error', (error) => {
            const responseTime = Date.now() - startTime;
            metrics.latencies.push(responseTime);
            metrics.failedRequests++;
            resolve({ statusCode: 0, responseTime, error: error.message });
        });

        req.on('timeout', () => {
            req.destroy();
            const responseTime = Date.now() - startTime;
            metrics.latencies.push(responseTime);
            metrics.failedRequests++;
            resolve({ statusCode: 408, responseTime, error: 'Timeout' });
        });

        req.setTimeout(30000);
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// Test single endpoint
async function testSingleEndpoint(endpoint, testType = 'GET') {
    if (options.verbose) {
        console.log(`\nTesting endpoint: ${endpoint}`);
        console.log('='.repeat(50));
    }

    const results = [];

    for (let i = 0; i < options.requests; i++) {
        const method = testType === 'POST' ? 'POST' : 'GET';
        const body = method === 'POST' ? { vol: '001' } : null;

        const result = await makeRequest(endpoint, body);
        results.push(result);

        metrics.totalRequests++;

        if (options.verbose && (i + 1) % 100 === 0) {
            console.log(`Progress: ${(i + 1)}/${options.requests} requests`);
        }

        if (options.interval > 0) {
            await new Promise(resolve => setTimeout(resolve, options.interval));
        }
    }

    return results;
}

// Test throughput
async function testThroughput() {
    if (options.verbose) {
        console.log('\nTesting throughput...');
        console.log('='.repeat(50));
    }

    const start = Date.now();
    let requestCount = 0;

    const interval = setInterval(() => {
        requestCount++;
        metrics.throughputHistory.push({
            time: Date.now(),
            requests: requestCount
        });

        if (requestCount >= options.requests) {
            clearInterval(interval);
        }
    }, options.interval);

    // Perform requests in parallel
    const promises = [];
    for (let i = 0; i < options.concurrency; i++) {
        promises.push(testSingleEndpoint(ENDPOINTS.volumes));
    }

    await Promise.all(promises);

    metrics.endTime = Date.now();
    return metrics.throughputHistory;
}

// Test stability
async function testStability() {
    if (options.verbose) {
        console.log('\nTesting stability under sustained load...');
        console.log('='.repeat(50));
    }

    metrics.startTime = Date.now();
    const testDuration = options.duration * 1000;
    const endAfter = Date.now() + testDuration;

    const results = [];

    const testLoop = async () => {
        while (Date.now() < endAfter && metrics.totalRequests < options.requests) {
            const endpoint = Object.values(ENDPOINTS)[Math.floor(Math.random() * 5)];
            const result = await makeRequest(endpoint);
            results.push(result);
            metrics.totalRequests++;

            if (options.verbose && metrics.totalRequests % 100 === 0) {
                console.log(`Progress: ${metrics.totalRequests}/${options.requests} requests`);
            }

            await new Promise(resolve => setTimeout(resolve, options.interval));
        }
    };

    // Run multiple parallel workers
    const workers = [];
    for (let i = 0; i < options.concurrency; i++) {
        workers.push(testLoop());
    }

    await Promise.all(workers);
    metrics.endTime = Date.now();
    return results;
}

// Run performance test
async function runPerformanceTest() {
    metrics.startTime = Date.now();

    try {
        switch (options.testType) {
            case 'single':
                // Test each endpoint individually
                for (const [name, endpoint] of Object.entries(ENDPOINTS)) {
                    await testSingleEndpoint(endpoint);
                    if (options.verbose) {
                        console.log(`\nEndpoint ${name} completed: ${metrics.successRequests} successful`);
                    }
                }
                break;

            case 'throughput':
                await testThroughput();
                break;

            case 'stability':
                await testStability();
                break;

            default:
                console.log(`Unknown test type: ${options.testType}`);
                process.exit(1);
        }
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }

    printResults();
    if (options.output) {
        saveResults();
    }
}

// Print performance results
function printResults() {
    const duration = (metrics.endTime - metrics.startTime) / 1000;
    const avgLatency = metrics.latencies.length > 0
        ? metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length
        : 0;
    const minLatency = metrics.latencies.length > 0 ? Math.min(...metrics.latencies) : 0;
    const maxLatency = metrics.latencies.length > 0 ? Math.max(...metrics.latencies) : 0;

    const p50Latency = metrics.latencies.length > 0
        ? latencyPercentile(metrics.latencies, 50)
        : 0;
    const p95Latency = metrics.latencies.length > 0
        ? latencyPercentile(metrics.latencies, 95)
        : 0;
    const p99Latency = metrics.latencies.length > 0
        ? latencyPercentile(metrics.latencies, 99)
        : 0;

    const successRate = metrics.totalRequests > 0
        ? (metrics.successRequests / metrics.totalRequests) * 100
        : 0;

    const throughput = metrics.totalRequests / duration;

    console.log('\n' + '='.repeat(70));
    console.log('Performance Test Results');
    console.log('='.repeat(70));
    console.log(`Test Duration: ${duration.toFixed(2)}s`);
    console.log(`Total Requests: ${metrics.totalRequests}`);
    console.log(`Success Rate: ${successRate.toFixed(2)}%`);
    console.log(`Throughput: ${throughput.toFixed(2)} requests/second`);
    console.log('');
    console.log('Latency (ms):');
    console.log(`  Average: ${avgLatency.toFixed(2)}`);
    console.log(`  Min: ${minLatency}`);
    console.log(`  Max: ${maxLatency}`);
    console.log(`  P50: ${p50Latency.toFixed(2)}`);
    console.log(`  P95: ${p95Latency.toFixed(2)}`);
    console.log(`  P99: ${p99Latency.toFixed(2)}`);
    console.log('');
    console.log('Status Code Distribution:');
    for (const [code, count] of Object.entries(metrics.statusCodeDistribution)) {
        const percent = ((count / metrics.totalRequests) * 100).toFixed(2);
        console.log(`  ${code}: ${count} (${percent}%)`);
    }
    console.log('='.repeat(70));

    // Performance thresholds
    const thresholds = {
        avgLatency: 200,
        p95Latency: 500,
        throughput: 100
    };

    const passed = avgLatency < thresholds.avgLatency &&
                   p95Latency < thresholds.p95Latency &&
                   throughput > thresholds.throughput;

    console.log('');
    if (passed) {
        console.log('✓ Performance within acceptable thresholds');
    } else {
        console.log('⚠ Performance below expected thresholds');
    }
}

// Calculate percentile
function latencyPercentile(latencies, percentile) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
}

// Save results to JSON file
function saveResults() {
    const duration = (metrics.endTime - metrics.startTime) / 1000;
    const data = {
        timestamp: new Date().toISOString(),
        duration: duration,
        totalRequests: metrics.totalRequests,
        successRequests: metrics.successRequests,
        failedRequests: metrics.failedRequests,
        successRate: (metrics.successRequests / metrics.totalRequests * 100).toFixed(2),
        throughput: (metrics.totalRequests / duration).toFixed(2),
        avgLatency: metrics.latencies.length > 0
            ? (metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length).toFixed(2)
            : 0,
        minLatency: metrics.latencies.length > 0 ? Math.min(...metrics.latencies) : 0,
        maxLatency: metrics.latencies.length > 0 ? Math.max(...metrics.latencies) : 0,
        p50Latency: latencyPercentile(metrics.latencies, 50),
        p95Latency: latencyPercentile(metrics.latencies, 95),
        p99Latency: latencyPercentile(metrics.latencies, 99),
        statusCodeDistribution: metrics.statusCodeDistribution,
        testType: options.testType
    };

    fs.writeFileSync(options.output, JSON.stringify(data, null, 2));
    console.log(`Results saved to: ${options.output}`);
}

// Run the test
runPerformanceTest();