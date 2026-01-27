/**
 * Tech Radar Load Testing Tool
 *
 * This script performs load testing on the Tech Radar server.
 * It simulates concurrent users making requests to various endpoints.
 *
 * Usage: node load-test.js [options]
 *
 * Options:
 *   -u, --concurrency <n>    Number of concurrent users (default: 100)
 *   -r, --requests <n>       Total requests per user (default: 100)
 *   -t, --test-type <type>   Test type: 'mixed', 'read', 'write', 'views', 'likes' (default: 'mixed')
 *   -s, --server-port <port> Server port (default: 5090)
 *   -v, --verbose            Enable verbose output
 */

const http = require('http');
const https = require('https');
const url = require('url');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
    concurrency: 100,
    requests: 100,
    testType: 'mixed',
    serverPort: 5090,
    verbose: false
};

args.forEach(arg => {
    if (arg.startsWith('-u=')) options.concurrency = parseInt(arg.split('=')[1]);
    if (arg.startsWith('-r=')) options.requests = parseInt(arg.split('=')[1]);
    if (arg.startsWith('-t=')) options.testType = arg.split('=')[1];
    if (arg.startsWith('-s=')) options.serverPort = parseInt(arg.split('=')[1]);
    if (arg === '-v' || arg === '--verbose') options.verbose = true;
});

console.log('='.repeat(60));
console.log('Tech Radar Load Testing');
console.log('='.repeat(60));
console.log(`Concurrency: ${options.concurrency} concurrent users`);
console.log(`Requests per user: ${options.requests}`);
console.log(`Test type: ${options.testType}`);
console.log(`Server port: ${options.serverPort}`);
console.log('='.repeat(60));

// Test endpoints
const ENDPOINTS = {
    mixed: [
        '/api/config',
        '/api/authors',
        '/api/volumes',
        '/api/health'
    ],
    read: [
        '/api/config',
        '/api/authors',
        '/api/volumes',
        '/api/health',
        '/api/contributions/001'
    ],
    write: [
        '/api/views/001',
        '/api/views/002'
    ],
    views: [
        '/api/views/001',
        '/api/views/002',
        '/api/views/003'
    ],
    likes: [
        '/api/likes'
    ]
};

let completedRequests = 0;
let successRequests = 0;
let failedRequests = 0;
let latencySamples = [];
let requestQueue = [];
let workers = [];

// Make HTTP request
function makeRequest(endpoint, optionsRequest) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(`http://localhost:${options.serverPort}${endpoint}`);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const req = client.request(parsedUrl, optionsRequest, (res) => {
            let data = '';

            res.on('data', chunk => data += chunk);

            res.on('end', () => {
                const responseTime = Date.now() - startTime;
                latencySamples.push(responseTime);

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    successRequests++;
                    if (options.verbose) {
                        console.log(`✓ ${endpoint} [${res.statusCode}] - ${responseTime}ms`);
                    }
                    resolve({ statusCode: res.statusCode, responseTime });
                } else {
                    failedRequests++;
                    if (options.verbose) {
                        console.log(`✗ ${endpoint} [${res.statusCode}] - ${responseTime}ms`);
                    }
                    resolve({ statusCode: res.statusCode, responseTime, error: true });
                }
            });
        });

        req.on('error', (error) => {
            const responseTime = Date.now() - startTime;
            latencySamples.push(responseTime);
            failedRequests++;
            if (options.verbose) {
                console.log(`✗ ${endpoint} - Error: ${error.message}`);
            }
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            const responseTime = Date.now() - startTime;
            latencySamples.push(responseTime);
            failedRequests++;
            if (options.verbose) {
                console.log(`✗ ${endpoint} - Timeout`);
            }
            resolve({ statusCode: 408, responseTime, error: true });
        });

        req.setTimeout(30000);
        req.write(JSON.stringify(optionsRequest.body || {}));
        req.end();
    });
}

// Worker function - simulates a user making requests
function worker(workerId) {
    const endpoints = ENDPOINTS[options.testType] || ENDPOINTS.mixed;
    let requestCount = 0;

    while (requestCount < options.requests) {
        const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

        const startTime = Date.now();
        makeRequest(endpoint, {})
            .then(result => {
                completedRequests++;

                if (requestCount % 10 === 0 && options.verbose) {
                    console.log(`Worker ${workerId}: ${completedRequests}/${options.concurrency * options.requests} requests completed`);
                }

                requestCount++;
            })
            .catch(error => {
                completedRequests++;
                requestCount++;
            });
    }
}

// Generate random user agent
function getRandomUserAgent() {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Start load test
function startLoadTest() {
    const startTime = Date.now();
    const totalRequests = options.concurrency * options.requests;

    console.log(`Starting load test with ${totalRequests} total requests...\n`);

    // Spawn workers
    for (let i = 0; i < options.concurrency; i++) {
        setTimeout(() => {
            worker(i + 1);
        }, i * 50); // Stagger workers
    }

    // Periodic progress updates
    const progressInterval = setInterval(() => {
        const progress = Math.round((completedRequests / totalRequests) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        const rps = completedRequests / elapsed;

        console.log(`Progress: ${progress}% (${completedRequests}/${totalRequests} requests) | RPS: ${rps.toFixed(2)} | Success: ${successRequests} | Failed: ${failedRequests}`);

        if (completedRequests >= totalRequests) {
            clearInterval(progressInterval);
            const totalDuration = (Date.now() - startTime) / 1000;
            printResults(totalDuration, totalRequests);
        }
    }, 2000);
}

// Print test results
function printResults(totalDuration, totalRequests) {
    console.log('\n' + '='.repeat(60));
    console.log('Load Test Results');
    console.log('='.repeat(60));
    console.log(`Total Duration: ${totalDuration.toFixed(2)}s`);
    console.log(`Total Requests: ${totalRequests}`);
    console.log(`Completed: ${completedRequests}`);
    console.log(`Success Rate: ${((successRequests / completedRequests) * 100).toFixed(2)}%`);
    console.log(`Failed: ${failedRequests}`);
    console.log(`Average RPS: ${(completedRequests / totalDuration).toFixed(2)}`);
    console.log(`Min Latency: ${Math.min(...latencySamples)}ms`);
    console.log(`Max Latency: ${Math.max(...latencySamples)}ms`);
    console.log(`Average Latency: ${Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length)}ms`);
    console.log(`95th Percentile Latency: ${Math.round(latencySamples.sort((a, b) => b - a)[Math.floor(latencySamples.length * 0.95)] || 0)}ms`);
    console.log(`99th Percentile Latency: ${Math.round(latencySamples.sort((a, b) => b - a)[Math.floor(latencySamples.length * 0.99)] || 0)}ms`);
    console.log('='.repeat(60));

    // Success threshold check
    const successRate = (successRequests / completedRequests) * 100;
    if (successRate >= 95) {
        console.log('✓ SUCCESS: Server handled load within acceptable thresholds');
    } else if (successRate >= 80) {
        console.log('⚠ WARNING: Some requests failed, server is under heavy load');
    } else {
        console.log('✗ FAILURE: High failure rate, server may be overloaded');
    }
}

// Start the test
startLoadTest();