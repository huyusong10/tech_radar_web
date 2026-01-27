const fs = require('fs');
const path = require('path');
const config = require('../config.js');

class PerformanceReportGenerator {
    constructor() {
        this.outputDir = config.reports.outputDir;
        this.templatePath = path.join(__dirname, 'template.html');
        this.ensureOutputDir();
    }

    ensureOutputDir() {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    generateReport(testResults, testConfig) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const baseFilename = `performance-report-${timestamp}`;
        
        const reportData = {
            timestamp: new Date().toISOString(),
            version: this.getVersion(),
            config: testConfig,
            results: this.processResults(testResults),
            summary: this.generateSummary(testResults, testConfig)
        };

        const reports = [];
        
        if (config.reports.formats.includes('json')) {
            const jsonReport = this.generateJSONReport(reportData, baseFilename);
            reports.push(jsonReport);
        }
        
        if (config.reports.formats.includes('html')) {
            const htmlReport = this.generateHTMLReport(reportData, baseFilename);
            reports.push(htmlReport);
        }

        this.cleanupOldReports();
        
        return reports;
    }

    processResults(rawResults) {
        const processed = {
            performance: {},
            resources: {},
            timeline: [],
            errors: []
        };

        if (rawResults.performance) {
            processed.performance = {
                responseTime: this.calculateStats(rawResults.performance.responseTimes || []),
                throughput: this.calculateStats(rawResults.performance.throughput || []),
                errorRate: this.calculateStats(rawResults.performance.errorRates || []),
                requests: rawResults.performance.totalRequests || 0,
                successRequests: rawResults.performance.successRequests || 0,
                failedRequests: rawResults.performance.failedRequests || 0
            };
        }

        if (rawResults.resources) {
            processed.resources = {
                memory: this.calculateStats(rawResults.resources.memory || []),
                cpu: this.calculateStats(rawResults.resources.cpu || []),
                activeConnections: this.calculateStats(rawResults.resources.activeConnections || [])
            };
        }

        if (rawResults.timeline) {
            processed.timeline = rawResults.timeline.map(point => ({
                timestamp: point.timestamp,
                responseTime: point.responseTime,
                throughput: point.throughput,
                errorRate: point.errorRate,
                memory: point.memory,
                cpu: point.cpu
            }));
        }

        if (rawResults.errors) {
            processed.errors = rawResults.errors.map(error => ({
                timestamp: error.timestamp,
                type: error.type,
                message: error.message,
                endpoint: error.endpoint
            }));
        }

        return processed;
    }

    calculateStats(values) {
        if (!values || values.length === 0) {
            return { min: 0, max: 0, avg: 0, median: 0, p95: 0, p99: 0, count: 0 };
        }

        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        
        return {
            min: sorted[0],
            max: sorted[sorted.length - 1],
            avg: sum / values.length,
            median: sorted[Math.floor(sorted.length / 2)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)],
            count: values.length
        };
    }

    generateSummary(results, testConfig) {
        const perf = results.performance;
        const res = results.resources;
        
        const summary = {
            overall: 'unknown',
            performanceGrade: 'C',
            resourceGrade: 'C',
            recommendations: []
        };

        if (perf && perf.errorRate) {
            const errorRate = perf.errorRate.avg || 0;
            if (errorRate === 0) {
                summary.performanceGrade = 'A';
            } else if (errorRate < 0.01) {
                summary.performanceGrade = 'B';
            } else {
                summary.performanceGrade = 'D';
                summary.recommendations.push('High error rate detected');
            }
        }

        if (perf && perf.responseTime) {
            const p95ResponseTime = perf.responseTime.p95 || 0;
            if (p95ResponseTime < config.thresholds.responseTime.read.p95) {
                summary.performanceGrade = summary.performanceGrade === 'A' ? 'A' : 'B';
            } else {
                summary.recommendations.push('Response time exceeds threshold');
            }
        }

        if (res && res.memory) {
            const maxMemory = res.memory.max || 0;
            if (maxMemory < 500) {
                summary.resourceGrade = 'A';
            } else if (maxMemory < 1000) {
                summary.resourceGrade = 'B';
            } else {
                summary.resourceGrade = 'C';
                summary.recommendations.push('High memory usage detected');
            }
        }

        summary.overall = this.getOverallGrade(summary.performanceGrade, summary.resourceGrade);

        return summary;
    }

    getOverallGrade(perfGrade, resourceGrade) {
        const grades = { A: 4, B: 3, C: 2, D: 1, F: 0 };
        const avgGrade = (grades[perfGrade] + grades[resourceGrade]) / 2;
        
        if (avgGrade >= 3.5) return 'A';
        if (avgGrade >= 2.5) return 'B';
        if (avgGrade >= 1.5) return 'C';
        if (avgGrade >= 0.5) return 'D';
        return 'F';
    }

    generateJSONReport(reportData, baseFilename) {
        const filename = `${baseFilename}.json`;
        const filepath = path.join(this.outputDir, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(reportData, null, 2));
        
        return {
            type: 'json',
            filename,
            filepath,
            size: fs.statSync(filepath).size
        };
    }

    generateHTMLReport(reportData, baseFilename) {
        const template = this.loadTemplate();
        const html = this.renderTemplate(template, reportData);
        
        const filename = `${baseFilename}.html`;
        const filepath = path.join(this.outputDir, filename);
        
        fs.writeFileSync(filepath, html);
        
        return {
            type: 'html',
            filename,
            filepath,
            size: fs.statSync(filepath).size
        };
    }

    loadTemplate() {
        if (fs.existsSync(this.templatePath)) {
            return fs.readFileSync(this.templatePath, 'utf8');
        }
        
        return this.getDefaultTemplate();
    }

    renderTemplate(template, data) {
        let html = template;
        
        html = html.replace(/\{\{timestamp\}\}/g, new Date(data.timestamp).toLocaleString());
        html = html.replace(/\{\{version\}\}/g, data.version);
        html = html.replace(/\{\{overallGrade\}\}/g, data.summary.overall);
        html = html.replace(/\{\{performanceGrade\}\}/g, data.summary.performanceGrade);
        html = html.replace(/\{\{resourceGrade\}\}/g, data.summary.resourceGrade);
        
        html = html.replace(/\{\{testDuration\}\}/g, data.config.duration || 'N/A');
        html = html.replace(/\{\{arrivalRate\}\}/g, data.config.arrivalRate || 'N/A');
        html = html.replace(/\{\{maxVusers\}\}/g, data.config.maxVusers || 'N/A');
        
        html = html.replace(/\{\{totalRequests\}\}/g, data.results.performance.requests || 0);
        html = html.replace(/\{\{successRequests\}\}/g, data.results.performance.successRequests || 0);
        html = html.replace(/\{\{failedRequests\}\}/g, data.results.performance.failedRequests || 0);
        
        html = html.replace(/\{\{avgResponseTime\}\}/g, (data.results.performance.responseTime?.avg || 0).toFixed(2));
        html = html.replace(/\{\{p95ResponseTime\}\}/g, (data.results.performance.responseTime?.p95 || 0).toFixed(2));
        html = html.replace(/\{\{avgThroughput\}\}/g, (data.results.performance.throughput?.avg || 0).toFixed(2));
        html = html.replace(/\{\{avgErrorRate\}\}/g, ((data.results.performance.errorRate?.avg || 0) * 100).toFixed(2));
        
        html = html.replace(/\{\{maxMemory\}\}/g, (data.results.resources.memory?.max || 0).toFixed(2));
        html = html.replace(/\{\{avgMemory\}\}/g, (data.results.resources.memory?.avg || 0).toFixed(2));
        html = html.replace(/\{\{maxCPU\}\}/g, (data.results.resources.cpu?.max || 0).toFixed(2));
        html = html.replace(/\{\{avgCPU\}\}/g, (data.results.resources.cpu?.avg || 0).toFixed(2));
        
        const chartsData = this.generateChartData(data.results);
        html = html.replace(/\{\{responseTimeChart\}\}/g, chartsData.responseTime);
        html = html.replace(/\{\{throughputChart\}\}/g, chartsData.throughput);
        html = html.replace(/\{\{errorRateChart\}\}/g, chartsData.errorRate);
        html = html.replace(/\{\{memoryChart\}\}/g, chartsData.memory);
        html = html.replace(/\{\{cpuChart\}\}/g, chartsData.cpu);
        
        const recommendationsList = data.summary.recommendations.length > 0 
            ? data.summary.recommendations.map(rec => `<li>${rec}</li>`).join('')
            : '<li>None - Performance looks good!</li>';
        html = html.replace(/\{\{recommendations\}\}/g, recommendationsList);
        
        return html;
    }

    generateChartData(results) {
        const charts = {
            responseTime: this.generateBarChart(results.responseTime, 'Response Time (ms)'),
            throughput: this.generateBarChart(results.throughput, 'Throughput (req/s)'),
            errorRate: this.generateBarChart(results.errorRate, 'Error Rate (%)'),
            memory: this.generateBarChart(results.memory, 'Memory Usage (MB)'),
            cpu: this.generateBarChart(results.cpu, 'CPU Usage (%)')
        };
        
        return charts;
    }

    generateBarChart(stats, title) {
        if (!stats || stats.count === 0) {
            return `<div class="chart-container"><h4>${title}</h4><p>No data available</p></div>`;
        }

        const maxValue = Math.max(stats.max, 1);
        const minValue = stats.min;
        
        return `
            <div class="chart-container">
                <h4>${title}</h4>
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-label">Min:</span>
                        <span class="stat-value">${minValue.toFixed(2)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Avg:</span>
                        <span class="stat-value">${stats.avg.toFixed(2)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Max:</span>
                        <span class="stat-value">${stats.max.toFixed(2)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">P95:</span>
                        <span class="stat-value">${stats.p95.toFixed(2)}</span>
                    </div>
                </div>
                <div class="bar-chart">
                    <div class="bar" style="width: ${(stats.avg / maxValue) * 100}%; background: #00f3ff;"></div>
                    <span class="bar-label">Average</span>
                </div>
            </div>
        `;
    }

    getDefaultTemplate() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Performance Report - {{timestamp}}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: #0a0a0a;
            color: #ededed;
            line-height: 1.6;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .title { font-size: 2.5rem; font-weight: 700; margin-bottom: 10px; }
        .subtitle { color: #9ca3af; font-size: 1.1rem; }
        .grade { display: inline-block; padding: 10px 20px; border-radius: 8px; font-weight: 600; margin: 20px 5px; }
        .grade.A { background: rgba(0, 255, 136, 0.2); color: #00ff88; }
        .grade.B { background: rgba(0, 243, 255, 0.2); color: #00f3ff; }
        .grade.C { background: rgba(255, 255, 0, 0.2); color: #ffff00; }
        .grade.D { background: rgba(255, 107, 53, 0.2); color: #ff6b35; }
        .grade.F { background: rgba(255, 0, 0, 0.2); color: #ff0000; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 40px; }
        .summary-card { background: #1a1a1a; padding: 20px; border-radius: 12px; border: 1px solid #333; }
        .summary-card h3 { color: #00f3ff; margin-bottom: 10px; }
        .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 30px; margin-bottom: 40px; }
        .chart-container { background: #1a1a1a; padding: 20px; border-radius: 12px; border: 1px solid #333; }
        .chart-container h4 { color: #00f3ff; margin-bottom: 15px; }
        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 15px; }
        .stat-item { display: flex; justify-content: space-between; }
        .stat-label { color: #9ca3af; }
        .stat-value { font-weight: 600; color: #00ff88; }
        .bar-chart { position: relative; height: 30px; background: #333; border-radius: 15px; overflow: hidden; }
        .bar { height: 100%; transition: width 0.3s ease; border-radius: 15px; }
        .bar-label { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 0.8rem; }
        .recommendations { background: #1a1a1a; padding: 20px; border-radius: 12px; border: 1px solid #333; }
        .recommendations h3 { color: #ff00ff; margin-bottom: 15px; }
        .recommendations ul { list-style: none; }
        .recommendations li { padding: 8px 0; border-bottom: 1px solid #333; }
        .recommendations li:last-child { border-bottom: none; }
        .recommendations li:before { content: "▶ "; color: #ff00ff; }
        @media (max-width: 768px) {
            .container { padding: 10px; }
            .title { font-size: 2rem; }
            .summary-grid { grid-template-columns: 1fr; }
            .charts-grid { grid-template-columns: 1fr; }
            .stats-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="title">Performance Test Report</h1>
            <p class="subtitle">Generated: {{timestamp}} | Version: {{version}}</p>
            <div>
                <span class="grade {{overallGrade}}">Overall: {{overallGrade}}</span>
                <span class="grade {{performanceGrade}}">Performance: {{performanceGrade}}</span>
                <span class="grade {{resourceGrade}}">Resources: {{resourceGrade}}</span>
            </div>
        </div>

        <div class="summary-grid">
            <div class="summary-card">
                <h3>Test Configuration</h3>
                <p><strong>Duration:</strong> {{testDuration}}s</p>
                <p><strong>Arrival Rate:</strong> {{arrivalRate}} req/s</p>
                <p><strong>Max Users:</strong> {{maxVusers}}</p>
            </div>
            <div class="summary-card">
                <h3>Request Statistics</h3>
                <p><strong>Total Requests:</strong> {{totalRequests}}</p>
                <p><strong>Successful:</strong> {{successRequests}}</p>
                <p><strong>Failed:</strong> {{failedRequests}}</p>
            </div>
            <div class="summary-card">
                <h3>Performance Metrics</h3>
                <p><strong>Avg Response Time:</strong> {{avgResponseTime}}ms</p>
                <p><strong>P95 Response Time:</strong> {{p95ResponseTime}}ms</p>
                <p><strong>Avg Throughput:</strong> {{avgThroughput}} req/s</p>
                <p><strong>Error Rate:</strong> {{avgErrorRate}}%</p>
            </div>
            <div class="summary-card">
                <h3>Resource Usage</h3>
                <p><strong>Max Memory:</strong> {{maxMemory}}MB</p>
                <p><strong>Avg Memory:</strong> {{avgMemory}}MB</p>
                <p><strong>Max CPU:</strong> {{maxCPU}}%</p>
                <p><strong>Avg CPU:</strong> {{avgCPU}}%</p>
            </div>
        </div>

        <div class="charts-grid">
            {{responseTimeChart}}
            {{throughputChart}}
            {{errorRateChart}}
            {{memoryChart}}
            {{cpuChart}}
        </div>

        <div class="recommendations">
            <h3>Recommendations</h3>
            <ul>
                {{recommendations}}
            </ul>
        </div>
    </div>
</body>
</html>`;
    }

    getVersion() {
        try {
            const packagePath = path.join(__dirname, '../../../package.json');
            const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            return packageJson.version || 'unknown';
        } catch (error) {
            return 'unknown';
        }
    }

    async generateJson(reportData, outputPath) {
        const jsonData = JSON.stringify(reportData, null, 2);
        fs.writeFileSync(outputPath, jsonData);
        return outputPath;
    }

    async generateHtml(reportData, outputPath) {
        const html = this.renderTemplate(this.getDefaultTemplate(), {
            timestamp: reportData.timestamp,
            version: this.getVersion(),
            summary: reportData.results.summary || {},
            config: reportData.config || {},
            results: reportData.results || {}
        });
        fs.writeFileSync(outputPath, html);
        return outputPath;
    }

    cleanupOldReports() {
        try {
            const retentionDays = config.reports.retention.days;
            const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
            
            const files = fs.readdirSync(this.outputDir);
            
            files.forEach(file => {
                const filepath = path.join(this.outputDir, file);
                const stat = fs.statSync(filepath);
                
                if (stat.mtime.getTime() < cutoffTime) {
                    fs.unlinkSync(filepath);
                    console.log(`Deleted old report: ${file}`);
                }
            });
        } catch (error) {
            console.warn('Failed to cleanup old reports:', error.message);
        }
    }
}

module.exports = new PerformanceReportGenerator();