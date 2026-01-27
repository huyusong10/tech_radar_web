#!/usr/bin/env node
/**
 * Load Test Script for Tech Radar Weekly
 *
 * Simulates high concurrency scenarios including:
 * - HTTP API requests (GET/POST)
 * - SSE connections
 * - Volume switching simulation
 *
 * Usage:
 *   node tests/load-test.js [options]
 *
 * Options:
 *   --target <url>       Target server URL (default: http://localhost:5090)
 *   --concurrency <n>    Number of concurrent clients (default: 100)
 *   --duration <s>       Test duration in seconds (default: 30)
 *   --test <type>        Test type: api, sse, mixed (default: mixed)
 *   --ramp-up <s>        Ramp-up time in seconds (default: 5)
 *   --help               Show help
 *
 * Examples:
 *   node tests/load-test.js --concurrency 500 --duration 60
 *   node tests/load-test.js --test sse --concurrency 100
 *   node tests/load-test.js --test api --concurrency 1000 --duration 30
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { EventEmitter } = require('events');

// ==================== Configuration ====================

const DEFAULT_CONFIG = {
    target: 'http://localhost:5090',
    concurrency: 100,
    duration: 30,
    testType: 'mixed',
    rampUp: 5
};

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const config = { ...DEFAULT_CONFIG };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--target':
                config.target = args[++i];
                break;
            case '--concurrency':
                config.concurrency = parseInt(args[++i], 10);
                break;
            case '--duration':
                config.duration = parseInt(args[++i], 10);
                break;
            case '--test':
                config.testType = args[++i];
                break;
            case '--ramp-up':
                config.rampUp = parseInt(args[++i], 10);
                break;
            case '--help':
                console.log(`
Load Test Script for Tech Radar Weekly

Usage:
  node tests/load-test.js [options]

Options:
  --target <url>       Target server URL (default: http://localhost:5090)
  --concurrency <n>    Number of concurrent clients (default: 100)
  --duration <s>       Test duration in seconds (default: 30)
  --test <type>        Test type: api, sse, mixed (default: mixed)
  --ramp-up <s>        Ramp-up time in seconds (default: 5)
  --help               Show help

Examples:
  node tests/load-test.js --concurrency 500 --duration 60
  node tests/load-test.js --test sse --concurrency 100
  node tests/load-test.js --test api --concurrency 1000 --duration 30
`);
                process.exit(0);
        }
    }

    return config;
}

// ==================== Statistics ====================

class Statistics {
    constructor() {
        this.requests = {
            total: 0,
            success: 0,
            failed: 0,
            timeout: 0
        };
        this.responseTimes = [];
        this.statusCodes = {};
        this.sse = {
            connected: 0,
            disconnected: 0,
            messages: 0,
            errors: 0
        };
        this.startTime = Date.now();
        this.errors = [];
    }

    recordRequest(success, statusCode, responseTime, error = null) {
        this.requests.total++;
        if (success) {
            this.requests.success++;
        } else {
            this.requests.failed++;
            if (error) {
                this.errors.push(error.message || error);
            }
        }

        if (statusCode) {
            this.statusCodes[statusCode] = (this.statusCodes[statusCode] || 0) + 1;
        }

        if (responseTime !== null) {
            this.responseTimes.push(responseTime);
        }
    }

    recordTimeout() {
        this.requests.total++;
        this.requests.timeout++;
        this.requests.failed++;
    }

    recordSSE(event, data = null) {
        switch (event) {
            case 'connect':
                this.sse.connected++;
                break;
            case 'disconnect':
                this.sse.disconnected++;
                break;
            case 'message':
                this.sse.messages++;
                break;
            case 'error':
                this.sse.errors++;
                if (data) this.errors.push(data);
                break;
        }
    }

    getPercentile(p) {
        if (this.responseTimes.length === 0) return 0;
        const sorted = [...this.responseTimes].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    getReport() {
        const duration = (Date.now() - this.startTime) / 1000;
        const avgResponseTime = this.responseTimes.length > 0
            ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
            : 0;

        return {
            duration: duration.toFixed(2) + 's',
            requests: {
                ...this.requests,
                rps: (this.requests.total / duration).toFixed(2)
            },
            responseTimes: {
                avg: avgResponseTime.toFixed(2) + 'ms',
                min: (Math.min(...this.responseTimes) || 0).toFixed(2) + 'ms',
                max: (Math.max(...this.responseTimes) || 0).toFixed(2) + 'ms',
                p50: this.getPercentile(50).toFixed(2) + 'ms',
                p95: this.getPercentile(95).toFixed(2) + 'ms',
                p99: this.getPercentile(99).toFixed(2) + 'ms'
            },
            statusCodes: this.statusCodes,
            sse: this.sse,
            errorSample: this.errors.slice(0, 5)
        };
    }

    printReport() {
        const report = this.getReport();
        console.log('\n' + '='.repeat(60));
        console.log('LOAD TEST RESULTS');
        console.log('='.repeat(60));

        console.log('\n[Requests]');
        console.log(`  Total:     ${report.requests.total}`);
        console.log(`  Success:   ${report.requests.success}`);
        console.log(`  Failed:    ${report.requests.failed}`);
        console.log(`  Timeout:   ${report.requests.timeout}`);
        console.log(`  RPS:       ${report.requests.rps}`);

        console.log('\n[Response Times]');
        console.log(`  Average:   ${report.responseTimes.avg}`);
        console.log(`  Min:       ${report.responseTimes.min}`);
        console.log(`  Max:       ${report.responseTimes.max}`);
        console.log(`  P50:       ${report.responseTimes.p50}`);
        console.log(`  P95:       ${report.responseTimes.p95}`);
        console.log(`  P99:       ${report.responseTimes.p99}`);

        console.log('\n[Status Codes]');
        for (const [code, count] of Object.entries(report.statusCodes)) {
            console.log(`  ${code}: ${count}`);
        }

        if (report.sse.connected > 0 || report.sse.errors > 0) {
            console.log('\n[SSE Connections]');
            console.log(`  Connected:    ${report.sse.connected}`);
            console.log(`  Disconnected: ${report.sse.disconnected}`);
            console.log(`  Messages:     ${report.sse.messages}`);
            console.log(`  Errors:       ${report.sse.errors}`);
        }

        if (report.errorSample.length > 0) {
            console.log('\n[Error Samples]');
            report.errorSample.forEach((err, i) => {
                console.log(`  ${i + 1}. ${err}`);
            });
        }

        console.log('\n' + '='.repeat(60));
    }
}

// ==================== HTTP Client ====================

function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const startTime = Date.now();

        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 10000
        };

        const req = client.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    data,
                    responseTime: Date.now() - startTime
                });
            });
        });

        req.on('error', (err) => {
            reject({
                error: err,
                responseTime: Date.now() - startTime
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject({
                error: new Error('Request timeout'),
                timeout: true,
                responseTime: Date.now() - startTime
            });
        });

        if (options.body) {
            req.write(options.body);
        }

        req.end();
    });
}

// ==================== SSE Client ====================

class SSEClient extends EventEmitter {
    constructor(url) {
        super();
        this.url = url;
        this.connected = false;
        this.req = null;
    }

    connect() {
        const parsedUrl = new URL(this.url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            headers: {
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache'
            }
        };

        this.req = client.get(options, (res) => {
            if (res.statusCode !== 200) {
                this.emit('error', new Error(`SSE connection failed: ${res.statusCode}`));
                return;
            }

            this.connected = true;
            this.emit('connect');

            let buffer = '';
            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const data = line.slice(5).trim();
                        if (data) {
                            this.emit('message', data);
                        }
                    }
                }
            });

            res.on('end', () => {
                this.connected = false;
                this.emit('disconnect');
            });
        });

        this.req.on('error', (err) => {
            this.connected = false;
            this.emit('error', err);
        });
    }

    disconnect() {
        if (this.req) {
            this.req.destroy();
            this.connected = false;
        }
    }
}

// ==================== Test Runners ====================

async function runAPITest(config, stats) {
    const endpoints = [
        { path: '/api/config', method: 'GET' },
        { path: '/api/authors', method: 'GET' },
        { path: '/api/volumes', method: 'GET' },
        { path: '/api/volumes?draft=true', method: 'GET' },
        { path: '/api/contributions/001', method: 'GET' },
        { path: '/api/likes', method: 'GET' },
        { path: '/api/views/001', method: 'GET' },
        { path: '/api/health', method: 'GET' }
    ];

    const endTime = Date.now() + (config.duration * 1000);
    const clientDelay = (config.rampUp * 1000) / config.concurrency;

    console.log(`\nStarting API load test...`);
    console.log(`  Target: ${config.target}`);
    console.log(`  Concurrency: ${config.concurrency}`);
    console.log(`  Duration: ${config.duration}s`);
    console.log(`  Ramp-up: ${config.rampUp}s`);

    const workers = [];

    for (let i = 0; i < config.concurrency; i++) {
        const workerPromise = (async () => {
            // Stagger start times for ramp-up
            await new Promise(r => setTimeout(r, i * clientDelay));

            while (Date.now() < endTime) {
                const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
                const url = config.target + endpoint.path;

                try {
                    const result = await makeRequest(url, {
                        method: endpoint.method,
                        timeout: 5000
                    });
                    stats.recordRequest(
                        result.statusCode >= 200 && result.statusCode < 400,
                        result.statusCode,
                        result.responseTime
                    );
                } catch (err) {
                    if (err.timeout) {
                        stats.recordTimeout();
                    } else {
                        stats.recordRequest(false, null, err.responseTime, err.error);
                    }
                }

                // Small delay between requests per client
                await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
            }
        })();

        workers.push(workerPromise);
    }

    // Progress reporting
    const progressInterval = setInterval(() => {
        const elapsed = (Date.now() - stats.startTime) / 1000;
        const remaining = config.duration - elapsed;
        if (remaining > 0) {
            process.stdout.write(`\r  Progress: ${elapsed.toFixed(0)}s / ${config.duration}s | Requests: ${stats.requests.total} | RPS: ${(stats.requests.total / elapsed).toFixed(0)}    `);
        }
    }, 1000);

    await Promise.all(workers);
    clearInterval(progressInterval);
    console.log('\n  API test completed.');
}

async function runSSETest(config, stats) {
    const endTime = Date.now() + (config.duration * 1000);
    const clientDelay = (config.rampUp * 1000) / config.concurrency;

    console.log(`\nStarting SSE load test...`);
    console.log(`  Target: ${config.target}/api/hot-reload`);
    console.log(`  Connections: ${config.concurrency}`);
    console.log(`  Duration: ${config.duration}s`);
    console.log(`  Ramp-up: ${config.rampUp}s`);

    const clients = [];
    let activeConnections = 0;

    // Create and connect clients with ramp-up
    for (let i = 0; i < config.concurrency; i++) {
        await new Promise(r => setTimeout(r, clientDelay));

        const client = new SSEClient(config.target + '/api/hot-reload');

        client.on('connect', () => {
            activeConnections++;
            stats.recordSSE('connect');
        });

        client.on('disconnect', () => {
            activeConnections--;
            stats.recordSSE('disconnect');
        });

        client.on('message', (data) => {
            stats.recordSSE('message');
        });

        client.on('error', (err) => {
            stats.recordSSE('error', err.message);
        });

        client.connect();
        clients.push(client);

        // Progress
        process.stdout.write(`\r  Connecting: ${i + 1} / ${config.concurrency} | Active: ${activeConnections}    `);
    }

    console.log(`\n  All clients connected. Maintaining connections...`);

    // Maintain connections for the remaining duration
    const remainingTime = endTime - Date.now();
    if (remainingTime > 0) {
        await new Promise(r => setTimeout(r, remainingTime));
    }

    // Disconnect all clients
    console.log('  Disconnecting clients...');
    for (const client of clients) {
        client.disconnect();
    }

    // Wait for disconnections
    await new Promise(r => setTimeout(r, 1000));
    console.log('  SSE test completed.');
}

async function runMixedTest(config, stats) {
    console.log(`\nStarting mixed load test...`);
    console.log(`  Target: ${config.target}`);
    console.log(`  API Clients: ${Math.floor(config.concurrency * 0.8)}`);
    console.log(`  SSE Clients: ${Math.floor(config.concurrency * 0.2)}`);
    console.log(`  Duration: ${config.duration}s`);

    const apiConfig = { ...config, concurrency: Math.floor(config.concurrency * 0.8) };
    const sseConfig = { ...config, concurrency: Math.floor(config.concurrency * 0.2) };

    // Run both tests in parallel
    await Promise.all([
        runAPITest(apiConfig, stats),
        runSSETest(sseConfig, stats)
    ]);
}

// ==================== Volume Switch Simulation ====================

async function runVolumeSwitchTest(config, stats) {
    const volumes = ['001', '002', '003'];
    const endTime = Date.now() + (config.duration * 1000);
    const clientDelay = (config.rampUp * 1000) / config.concurrency;

    console.log(`\nStarting volume switch simulation...`);
    console.log(`  Target: ${config.target}`);
    console.log(`  Virtual Users: ${config.concurrency}`);
    console.log(`  Duration: ${config.duration}s`);

    const workers = [];

    for (let i = 0; i < config.concurrency; i++) {
        const workerPromise = (async () => {
            await new Promise(r => setTimeout(r, i * clientDelay));

            // Each virtual user connects to SSE and makes API requests
            const sseClient = new SSEClient(config.target + '/api/hot-reload');
            let sseConnected = false;

            sseClient.on('connect', () => {
                sseConnected = true;
                stats.recordSSE('connect');
            });
            sseClient.on('disconnect', () => {
                sseConnected = false;
                stats.recordSSE('disconnect');
            });
            sseClient.on('message', () => stats.recordSSE('message'));
            sseClient.on('error', (err) => stats.recordSSE('error', err.message));

            sseClient.connect();

            while (Date.now() < endTime) {
                // Simulate switching volumes
                const vol = volumes[Math.floor(Math.random() * volumes.length)];

                // Load volume data
                const requests = [
                    makeRequest(`${config.target}/api/contributions/${vol}`),
                    makeRequest(`${config.target}/api/views/${vol}`)
                ];

                try {
                    const results = await Promise.all(requests);
                    for (const result of results) {
                        stats.recordRequest(
                            result.statusCode >= 200 && result.statusCode < 400,
                            result.statusCode,
                            result.responseTime
                        );
                    }
                } catch (err) {
                    stats.recordRequest(false, null, null, err.error || err);
                }

                // Simulate user reading time (2-5 seconds)
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
            }

            sseClient.disconnect();
        })();

        workers.push(workerPromise);
    }

    // Progress reporting
    const progressInterval = setInterval(() => {
        const elapsed = (Date.now() - stats.startTime) / 1000;
        process.stdout.write(`\r  Progress: ${elapsed.toFixed(0)}s / ${config.duration}s | Requests: ${stats.requests.total} | SSE: ${stats.sse.connected}    `);
    }, 1000);

    await Promise.all(workers);
    clearInterval(progressInterval);
    console.log('\n  Volume switch test completed.');
}

// ==================== Main ====================

async function main() {
    const config = parseArgs();
    const stats = new Statistics();

    console.log('\n' + '='.repeat(60));
    console.log('Tech Radar Weekly - Load Test');
    console.log('='.repeat(60));
    console.log(`\nTest Type: ${config.testType}`);
    console.log(`Target: ${config.target}`);
    console.log(`Concurrency: ${config.concurrency}`);
    console.log(`Duration: ${config.duration}s`);

    try {
        // Check if server is accessible
        console.log('\nChecking server connectivity...');
        const healthCheck = await makeRequest(config.target + '/api/health', { timeout: 5000 });
        if (healthCheck.statusCode !== 200) {
            console.error(`Server returned status ${healthCheck.statusCode}`);
            process.exit(1);
        }
        console.log('Server is accessible.');

        // Run the selected test
        switch (config.testType) {
            case 'api':
                await runAPITest(config, stats);
                break;
            case 'sse':
                await runSSETest(config, stats);
                break;
            case 'mixed':
                await runMixedTest(config, stats);
                break;
            case 'volume':
                await runVolumeSwitchTest(config, stats);
                break;
            default:
                console.error(`Unknown test type: ${config.testType}`);
                process.exit(1);
        }

        // Print results
        stats.printReport();

        // Exit with error if too many failures
        const failureRate = stats.requests.failed / stats.requests.total;
        if (failureRate > 0.1) {
            console.log(`\nWARNING: High failure rate (${(failureRate * 100).toFixed(1)}%)`);
            process.exit(1);
        }

    } catch (err) {
        console.error('\nTest failed:', err.message || err);
        process.exit(1);
    }
}

main();
