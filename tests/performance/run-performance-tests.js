#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const config = require('./config.js');
const baselineRunner = require('./scenarios/baseline.js');
const loadTestProcessor = require('./scenarios/load-test-processor.js');
const performanceMonitor = require('./monitoring/performance-monitor.js');
const reportGenerator = require('./reports/report-generator.js');
class PerformanceTestRunner {
    constructor() {
        this.results = {
            baseline: null,
            loadTest: null,
            monitoring: null,
            summary: {
                totalTests: 0,
                passedTests: 0,
                failedTests: 0,
                startTime: null,
                endTime: null,
                duration: 0
            }
        };
        this.errors = [];
        this.warnings = [];
    }

    async runFullSuite(options = {}) {
        const {
            scenarios = ['light', 'moderate'],
            skipBaseline = false,
            skipMonitoring = false,
            outputDir = config.reports.outputDir
        } = options;

        console.log('🚀 Starting Performance Test Suite');
        console.log('='.repeat(50));

        this.results.summary.startTime = new Date();

        try {
            await this.validateConfiguration();
            this.ensureDirectoryExists(outputDir);

            if (!skipBaseline) {
                console.log('\n📊 Running Baseline Tests...');
                this.results.baseline = await this.runBaselineTests();
            }

            let monitorInstance = null;
            if (!skipMonitoring) {
                console.log('\n📈 Starting Performance Monitor...');
                monitorInstance = await this.startMonitoring();
            }

            console.log('\n⚡ Running Load Tests...');
            this.results.loadTest = await this.runLoadTests(scenarios);

            if (monitorInstance) {
                console.log('\n📊 Stopping Performance Monitor...');
                this.results.monitoring = await this.stopMonitoring(monitorInstance);
            }

            console.log('\n📋 Generating Reports...');
            await this.generateReports(outputDir);

            this.calculateSummary();
            this.printResults();

            this.results.summary.endTime = new Date();
            this.results.summary.duration = 
                this.results.summary.endTime - this.results.summary.startTime;

            return this.results;

        } catch (error) {
            this.errors.push(`Suite execution failed: ${error.message}`);
            console.error(`❌ Suite execution failed: ${error.message}`);
            throw error;
        }
    }

    async validateConfiguration() {
        const validationErrors = [];

        if (!config.server || !config.server.port) {
            validationErrors.push('Invalid server configuration');
        }

        const requiredFiles = [
            './scenarios/baseline.js',
            './scenarios/load-test.yml',
            './monitoring/performance-monitor.js',
            './reports/report-generator.js'
        ];

        for (const file of requiredFiles) {
            const filePath = path.resolve(__dirname, file);
            if (!fs.existsSync(filePath)) {
                validationErrors.push(`Required file missing: ${file}`);
            }
        }

        if (validationErrors.length > 0) {
            throw new Error(`Configuration validation failed: ${validationErrors.join(', ')}`);
        }

        console.log('✅ Configuration validation passed');
    }

    async runBaselineTests() {
        try {
            const baselineResults = await baselineRunner.run();
            
            const thresholdViolations = this.checkThresholdViolations(baselineResults);
            
            if (thresholdViolations.length > 0) {
                this.warnings.push(...thresholdViolations);
            }

            this.results.summary.passedTests += baselineResults.passed || 0;
            this.results.summary.failedTests += baselineResults.failed || 0;
            this.results.summary.totalTests += baselineResults.total || 0;

            return baselineResults;

        } catch (error) {
            this.errors.push(`Baseline test failed: ${error.message}`);
            throw error;
        }
    }

    async startMonitoring() {
        try {
            const monitor = new performanceMonitor();
            await monitor.start();
            return monitor;

        } catch (error) {
            this.errors.push(`Failed to start performance monitor: ${error.message}`);
            throw error;
        }
    }

    async stopMonitoring(monitorInstance) {
        try {
            const results = await monitorInstance.stop();
            return results;

        } catch (error) {
            this.errors.push(`Failed to stop performance monitor: ${error.message}`);
            throw error;
        }
    }

    async runLoadTests(scenarios) {
        const results = {
            scenarios: {},
            summary: {
                total: 0,
                passed: 0,
                failed: 0
            }
        };

        for (const scenarioName of scenarios) {
            console.log(`  🔄 Running scenario: ${scenarioName}`);
            
            try {
                const scenarioConfig = config.scenarios[scenarioName];
                if (!scenarioConfig) {
                    throw new Error(`Unknown scenario: ${scenarioName}`);
                }

                const scenarioResult = await loadTestProcessor.runScenario(scenarioName, scenarioConfig);
                results.scenarios[scenarioName] = scenarioResult;

                results.summary.total++;
                if (scenarioResult.passed) {
                    results.summary.passed++;
                } else {
                    results.summary.failed++;
                    this.errors.push(`Scenario ${scenarioName} failed thresholds`);
                }

                console.log(`    ${scenarioResult.passed ? '✅' : '❌'} ${scenarioName}`);

            } catch (error) {
                this.errors.push(`Load test scenario ${scenarioName} failed: ${error.message}`);
                results.summary.total++;
                results.summary.failed++;
                console.log(`    ❌ ${scenarioName} - ${error.message}`);
            }
        }

        this.results.summary.totalTests += results.summary.total;
        this.results.summary.passedTests += results.summary.passed;
        this.results.summary.failedTests += results.summary.failed;

        return results;
    }

    checkThresholdViolations(results) {
        const violations = [];

        if (results.metrics) {
            const { responseTime, throughput, errorRate } = config.thresholds;

            if (results.metrics.responseTime) {
                if (results.metrics.responseTime.p95 > responseTime.read.p95) {
                    violations.push(`Response time P95 exceeded: ${results.metrics.responseTime.p95}ms > ${responseTime.read.p95}ms`);
                }
            }

            if (results.metrics.throughput) {
                if (results.metrics.throughput.avg < throughput.read.min) {
                    violations.push(`Throughput below minimum: ${results.metrics.throughput.avg} < ${throughput.read.min}`);
                }
            }

            if (results.metrics.errorRate && results.metrics.errorRate.avg > errorRate.max) {
                violations.push(`Error rate above threshold: ${results.metrics.errorRate.avg} > ${errorRate.max}`);
            }
        }

        return violations;
    }

    async generateReports(outputDir) {
        try {
            const reportData = {
                timestamp: new Date().toISOString(),
                config: config,
                results: this.results,
                errors: this.errors,
                warnings: this.warnings
            };

            if (config.reports.formats.includes('json')) {
                const jsonPath = path.join(outputDir, `performance-report-${Date.now()}.json`);
                await reportGenerator.generateJson(reportData, jsonPath);
                console.log(`  📄 JSON report: ${jsonPath}`);
            }

            if (config.reports.formats.includes('html')) {
                const htmlPath = path.join(outputDir, `performance-report-${Date.now()}.html`);
                await reportGenerator.generateHtml(reportData, htmlPath);
                console.log(`  🌐 HTML report: ${htmlPath}`);
            }

        } catch (error) {
            this.errors.push(`Report generation failed: ${error.message}`);
            throw error;
        }
    }

    calculateSummary() {
        const summary = this.results.summary;
        
        summary.successRate = summary.totalTests > 0 
            ? (summary.passedTests / summary.totalTests * 100).toFixed(2) 
            : 0;

        summary.overallStatus = summary.failedTests === 0 ? 'PASSED' : 'FAILED';
        summary.criticalErrors = this.errors.length;
        summary.warnings = this.warnings.length;
    }

    printResults() {
        console.log('\n' + '='.repeat(50));
        console.log('📊 PERFORMANCE TEST RESULTS');
        console.log('='.repeat(50));

        const summary = this.results.summary;

        console.log(`\n📈 Test Summary:`);
        console.log(`  Total Tests: ${summary.totalTests}`);
        console.log(`  Passed: ${summary.passedTests}`);
        console.log(`  Failed: ${summary.failedTests}`);
        console.log(`  Success Rate: ${summary.successRate}%`);
        console.log(`  Status: ${summary.overallStatus}`);

        if (this.errors.length > 0) {
            console.log(`\n❌ Errors (${this.errors.length}):`);
            this.errors.forEach((error, index) => {
                console.log(`  ${index + 1}. ${error}`);
            });
        }

        if (this.warnings.length > 0) {
            console.log(`\n⚠️  Warnings (${this.warnings.length}):`);
            this.warnings.forEach((warning, index) => {
                console.log(`  ${index + 1}. ${warning}`);
            });
        }

        console.log('\n' + '='.repeat(50));
    }

    ensureDirectoryExists(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    getExitCode() {
        return this.results.summary.failedTests > 0 ? 1 : 0;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--scenarios':
                options.scenarios = args[++i].split(',');
                break;
            case '--skip-baseline':
                options.skipBaseline = true;
                break;
            case '--skip-monitoring':
                options.skipMonitoring = true;
                break;
            case '--output':
                options.outputDir = args[++i];
                break;
            case '--help':
            case '-h':
                console.log(`
Usage: node run-performance-tests.js [options]

Options:
  --scenarios <list>     Comma-separated list of scenarios (default: light,moderate)
  --skip-baseline       Skip baseline performance tests
  --skip-monitoring      Skip performance monitoring
  --output <dir>         Output directory for reports
  --help, -h            Show this help message

Available scenarios: ${Object.keys(config.scenarios).join(', ')}
                `);
                process.exit(0);
                break;
        }
    }

    try {
        const runner = new PerformanceTestRunner();
        await runner.runFullSuite(options);
        process.exit(runner.getExitCode());

    } catch (error) {
        console.error('❌ Performance test suite failed:', error.message);
        process.exit(1);
    }
}

module.exports = PerformanceTestRunner;

if (require.main === module) {
    main();
}