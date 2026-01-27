const autocannon = require('autocannon');
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * 基准性能测试脚本
 * 单个端点性能验证，生成基准测试报告
 */

class BaselineTest {
    constructor() {
        this.server = config.server;
        this.endpoints = config.endpoints;
        this.thresholds = config.thresholds;
        this.results = {
            timestamp: new Date().toISOString(),
            server: this.server,
            summary: {
                total: 0,
                passed: 0,
                failed: 0
            },
            endpoints: {}
        };
    }

    /**
     * 运行单个端点的基准测试
     * @param {string} endpoint - API端点
     * @param {string} type - 端点类型 (read/write)
     * @param {Object} options - 测试选项
     */
    async runEndpointTest(endpoint, type, options = {}) {
        const defaultOptions = {
            url: `${this.server.baseUrl}${endpoint}`,
            connections: 10,
            duration: 10,
            pipelining: 1,
            timeout: 10000,
            method: type === 'write' ? 'POST' : 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            ...options
        };

        console.log(`🧪 Testing ${type.toUpperCase()}: ${endpoint}`);
        
        try {
            const result = await autocannon(defaultOptions);
            
            const testResult = {
                endpoint,
                type,
                success: true,
                duration: result.duration,
                requests: {
                    total: result.requests.total,
                    average: result.requests.average,
                    sent: result.requests.sent,
                    completed: result.requests.completed,
                    errors: result.requests.errors
                },
                latency: {
                    average: result.latency.average,
                    p50: result.latency.p50,
                    p95: result.latency.p95 || result.latency.p90 || result.latency.p75 || 0,
                    p99: result.latency.p99,
                    min: result.latency.min,
                    max: result.latency.max,
                    stddev: result.latency.stddev
                },
                throughput: {
                    average: result.throughput.average,
                    min: result.throughput.min,
                    max: result.throughput.max
                },
                errors: {
                    total: result.errors,
                    codes: result.non2xx,
                    timeouts: result.timeouts
                }
            };

            // 验证性能阈值
            const threshold = this.thresholds.responseTime[type];
            const errorRate = result.requests.total > 0 ? result.errors / result.requests.total : 0;
            
            testResult.thresholds = {
                p95: {
                    limit: threshold.p95,
                    actual: testResult.latency.p95,
                    passed: testResult.latency.p95 <= threshold.p95
                },
                p99: {
                    limit: threshold.p99,
                    actual: testResult.latency.p99,
                    passed: testResult.latency.p99 <= threshold.p99
                },
                errorRate: {
                    limit: this.thresholds.errorRate.max,
                    actual: errorRate,
                    passed: errorRate <= this.thresholds.errorRate.max
                }
            };

            // 判断整体是否通过
            testResult.passed = testResult.thresholds.p95.passed && 
                               testResult.thresholds.p99.passed && 
                               testResult.thresholds.errorRate.passed;

            return testResult;

        } catch (error) {
            console.error(`❌ Error testing ${endpoint}:`, error.message);
            
            return {
                endpoint,
                type,
                success: false,
                error: error.message,
                passed: false,
                thresholds: null
            };
        }
    }

    /**
     * 运行所有基准测试
     */
    async runAllTests() {
        console.log('🚀 Starting Baseline Performance Tests\n');
        
        // 测试所有read端点
        for (const endpoint of this.endpoints.read) {
            const result = await this.runEndpointTest(endpoint, 'read');
            this.results.endpoints[endpoint] = result;
            this.results.summary.total++;
            if (result.passed) {
                this.results.summary.passed++;
                console.log(`✅ ${endpoint} - P95: ${result.latency?.p95.toFixed(2)}ms`);
            } else {
                this.results.summary.failed++;
                console.log(`❌ ${endpoint} - Failed`);
            }
        }

        // 测试所有write端点
        for (const endpoint of this.endpoints.write) {
            const result = await this.runEndpointTest(endpoint, 'write');
            this.results.endpoints[endpoint] = result;
            this.results.summary.total++;
            if (result.passed) {
                this.results.summary.passed++;
                console.log(`✅ ${endpoint} - P95: ${result.latency?.p95.toFixed(2)}ms`);
            } else {
                this.results.summary.failed++;
                console.log(`❌ ${endpoint} - Failed`);
            }
        }

        console.log('\n📊 Baseline Test Summary:');
        console.log(`Total: ${this.results.summary.total}`);
        console.log(`Passed: ${this.results.summary.passed}`);
        console.log(`Failed: ${this.results.summary.failed}`);
        console.log(`Success Rate: ${((this.results.summary.passed / this.results.summary.total) * 100).toFixed(1)}%`);

        return this.results;
    }

    /**
     * 生成基准测试报告
     */
    async generateReport() {
        const reportDir = path.join(__dirname, '../reports');
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportFile = path.join(reportDir, `baseline-${timestamp}.json`);
        
        // 生成详细的JSON报告
        const detailedReport = {
            ...this.results,
            performanceAnalysis: this.analyzePerformance(),
            recommendations: this.generateRecommendations()
        };

        fs.writeFileSync(reportFile, JSON.stringify(detailedReport, null, 2));
        console.log(`\n📄 Baseline report saved to: ${reportFile}`);

        // 生成简化的报告副本
        const latestFile = path.join(reportDir, 'baseline-latest.json');
        fs.writeFileSync(latestFile, JSON.stringify(detailedReport, null, 2));

        return reportFile;
    }

    /**
     * 分析性能数据
     */
    analyzePerformance() {
        const analysis = {
            readEndpoints: {
                count: this.endpoints.read.length,
                averageLatency: 0,
                maxLatency: 0,
                minLatency: Infinity,
                throughputAvg: 0
            },
            writeEndpoints: {
                count: this.endpoints.write.length,
                averageLatency: 0,
                maxLatency: 0,
                minLatency: Infinity,
                throughputAvg: 0
            },
            bottlenecks: [],
            topPerformers: []
        };

        let readLatencies = [];
        let writeLatencies = [];
        let readThroughputs = [];
        let writeThroughputs = [];

        // 分析read端点
        for (const endpoint of this.endpoints.read) {
            const result = this.results.endpoints[endpoint];
            if (result && result.success && result.latency) {
                readLatencies.push(result.latency.p95);
                readThroughputs.push(result.throughput.average);
                
                if (result.latency.p95 > analysis.readEndpoints.maxLatency) {
                    analysis.readEndpoints.maxLatency = result.latency.p95;
                }
                if (result.latency.p95 < analysis.readEndpoints.minLatency) {
                    analysis.readEndpoints.minLatency = result.latency.p95;
                }

                if (!result.passed) {
                    analysis.bottlenecks.push({
                        endpoint,
                        type: 'read',
                        issue: 'Performance threshold exceeded',
                        latency: result.latency.p95,
                        threshold: this.thresholds.responseTime.read.p95
                    });
                }
            }
        }

        // 分析write端点
        for (const endpoint of this.endpoints.write) {
            const result = this.results.endpoints[endpoint];
            if (result && result.success && result.latency) {
                writeLatencies.push(result.latency.p95);
                writeThroughputs.push(result.throughput.average);
                
                if (result.latency.p95 > analysis.writeEndpoints.maxLatency) {
                    analysis.writeEndpoints.maxLatency = result.latency.p95;
                }
                if (result.latency.p95 < analysis.writeEndpoints.minLatency) {
                    analysis.writeEndpoints.minLatency = result.latency.p95;
                }

                if (!result.passed) {
                    analysis.bottlenecks.push({
                        endpoint,
                        type: 'write',
                        issue: 'Performance threshold exceeded',
                        latency: result.latency.p95,
                        threshold: this.thresholds.responseTime.write.p95
                    });
                }
            }
        }

        // 计算平均值
        if (readLatencies.length > 0) {
            analysis.readEndpoints.averageLatency = readLatencies.reduce((a, b) => a + b, 0) / readLatencies.length;
            analysis.readEndpoints.throughputAvg = readThroughputs.reduce((a, b) => a + b, 0) / readThroughputs.length;
        }

        if (writeLatencies.length > 0) {
            analysis.writeEndpoints.averageLatency = writeLatencies.reduce((a, b) => a + b, 0) / writeLatencies.length;
            analysis.writeEndpoints.throughputAvg = writeThroughputs.reduce((a, b) => a + b, 0) / writeThroughputs.length;
        }

        return analysis;
    }

    /**
     * 生成优化建议
     */
    generateRecommendations() {
        const recommendations = [];
        const analysis = this.analyzePerformance();

        // 瓶颈建议
        if (analysis.bottlenecks.length > 0) {
            recommendations.push({
                type: 'performance',
                priority: 'high',
                title: '性能瓶颈优化',
                description: `发现 ${analysis.bottlenecks.length} 个端点超过性能阈值`,
                actions: analysis.bottlenecks.map(b => 
                    `- ${b.endpoint}: P95延迟${b.latency.toFixed(2)}ms > ${b.threshold}ms`
                )
            });
        }

        // 吞吐量建议
        if (analysis.readEndpoints.throughputAvg < this.thresholds.throughput.read.target) {
            recommendations.push({
                type: 'throughput',
                priority: 'medium',
                title: '读取吞吐量优化',
                description: `当前平均吞吐量 ${analysis.readEndpoints.throughputAvg.toFixed(2)} req/s，低于目标 ${this.thresholds.throughput.read.target} req/s`,
                actions: [
                    '- 检查缓存策略',
                    '- 优化数据库查询',
                    '- 考虑添加CDN'
                ]
            });
        }

        // 整体建议
        if (this.results.summary.failed > 0) {
            recommendations.push({
                type: 'general',
                priority: 'low',
                title: '整体性能改进',
                description: '建议进行全面的性能优化',
                actions: [
                    '- 启用HTTP缓存头',
                    '- 压缩响应内容',
                    '- 监控资源使用情况',
                    '- 考虑负载均衡'
                ]
            });
        }

        return recommendations;
    }

    /**
     * 打印详细结果
     */
    printDetailedResults() {
        console.log('\n📈 Detailed Results:');
        
        for (const endpoint of [...this.endpoints.read, ...this.endpoints.write]) {
            const result = this.results.endpoints[endpoint];
            if (result) {
                const status = result.passed ? '✅' : '❌';
                const type = result.type.toUpperCase();
                const latency = result.latency ? `${result.latency.p95.toFixed(2)}ms` : 'N/A';
                const throughput = result.throughput ? `${result.throughput.average.toFixed(2)} req/s` : 'N/A';
                const errors = result.errors ? result.errors.total : 'N/A';
                
                console.log(`${status} ${type} ${endpoint}`);
                console.log(`   P95: ${latency} | Throughput: ${throughput} | Errors: ${errors}`);
                
                if (!result.passed && result.thresholds) {
                    console.log(`   ⚠️  Threshold violations:`);
                    if (!result.thresholds.p95.passed) {
                        console.log(`      - P95: ${result.thresholds.p95.actual.toFixed(2)}ms > ${result.thresholds.p95.limit}ms`);
                    }
                    if (!result.thresholds.p99.passed) {
                        console.log(`      - P99: ${result.thresholds.p99.actual.toFixed(2)}ms > ${result.thresholds.p99.limit}ms`);
                    }
                    if (!result.thresholds.errorRate.passed) {
                        console.log(`      - Error Rate: ${(result.thresholds.errorRate.actual * 100).toFixed(2)}% > ${(result.thresholds.errorRate.limit * 100).toFixed(2)}%`);
                    }
                }
            }
        }
    }
}

// 运行基准测试
async function runBaselineTests() {
    const baseline = new BaselineTest();
    
    try {
        // 等待服务器启动
        console.log('⏳ Waiting for server to be ready...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 运行所有测试
        await baseline.runAllTests();
        
        // 打印详细结果
        baseline.printDetailedResults();
        
        // 生成报告
        await baseline.generateReport();
        
        // 根据结果退出进程
        const failedCount = baseline.results.summary.failed;
        if (failedCount > 0) {
            console.log(`\n❌ ${failedCount} endpoints failed baseline tests`);
            process.exit(1);
        } else {
            console.log('\n✅ All endpoints passed baseline tests');
            process.exit(0);
        }
        
    } catch (error) {
        console.error('💥 Baseline test execution failed:', error);
        process.exit(1);
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    runBaselineTests();
}

module.exports = new BaselineTest();