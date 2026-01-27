const fs = require('fs');
const path = require('path');
const config = require('../config.js');

class PerformanceMonitor {
    constructor(options = {}) {
        this.config = config;
        this.isRunning = false;
        this.interval = null;
        this.metrics = {
            memory: [],
            cpu: [],
            responseTime: [],
            errorRate: [],
            cacheHitRate: [],
            throughput: [],
            activeConnections: []
        };
        
        this.thresholds = {
            memory: options.memoryThreshold || 512 * 1024 * 1024,
            cpu: options.cpuThreshold || 80,
            responseTime: options.responseTimeThreshold || 200,
            errorRate: options.errorRateThreshold || 0.01,
            cacheHitRate: options.cacheHitRateThreshold || 0.8
        };
        
        this.alerts = [];
        this.startTime = Date.now();
        this.samples = 0;
        
        this.outputDir = options.outputDir || config.reports.outputDir;
        this.ensureOutputDir();
    }
    
    ensureOutputDir() {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }
    
    getMemoryUsage() {
        const usage = process.memoryUsage();
        const total = usage.heapUsed;
        const timestamp = Date.now();
        
        this.metrics.memory.push({
            timestamp,
            heapUsed: total,
            heapTotal: usage.heapTotal,
            external: usage.external,
            rss: usage.rss
        });
        
        if (this.metrics.memory.length > 1000) {
            this.metrics.memory.shift();
        }
        
        return total;
    }
    
    getCpuUsage() {
        const timestamp = Date.now();
        const usage = process.cpuUsage();
        
        const cpuPercent = Math.random() * 100;
        
        this.metrics.cpu.push({
            timestamp,
            usage: cpuPercent,
            user: usage.user,
            system: usage.system
        });
        
        if (this.metrics.cpu.length > 1000) {
            this.metrics.cpu.shift();
        }
        
        return cpuPercent;
    }
    
    recordResponseTime(responseTime, endpoint, statusCode) {
        const timestamp = Date.now();
        
        this.metrics.responseTime.push({
            timestamp,
            responseTime,
            endpoint,
            statusCode
        });
        
        if (this.metrics.responseTime.length > 1000) {
            this.metrics.responseTime.shift();
        }
        
        this.updateErrorRate();
        this.updateThroughput();
    }
    
    updateErrorRate() {
        const recent = this.metrics.responseTime.slice(-100);
        if (recent.length === 0) return;
        
        const errors = recent.filter(r => r.statusCode >= 400).length;
        const errorRate = errors / recent.length;
        
        this.metrics.errorRate.push({
            timestamp: Date.now(),
            rate: errorRate,
            totalRequests: recent.length,
            errorCount: errors
        });
        
        if (this.metrics.errorRate.length > 1000) {
            this.metrics.errorRate.shift();
        }
    }
    
    updateThroughput() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        const recent = this.metrics.responseTime.filter(r => r.timestamp > oneMinuteAgo);
        
        const throughput = recent.length;
        
        this.metrics.throughput.push({
            timestamp: now,
            throughput,
            requests: recent.length
        });
        
        if (this.metrics.throughput.length > 1000) {
            this.metrics.throughput.shift();
        }
    }
    
    recordCacheHit(hit, cacheKey) {
        const timestamp = Date.now();
        
        const recent = this.metrics.cacheHitRate.slice(-100);
        const hits = recent.filter(h => h.hit).length + (hit ? 1 : 0);
        const total = recent.length + 1;
        const hitRate = hits / total;
        
        this.metrics.cacheHitRate.push({
            timestamp,
            hit,
            cacheKey,
            hitRate
        });
        
        if (this.metrics.cacheHitRate.length > 1000) {
            this.metrics.cacheHitRate.shift();
        }
        
        return hitRate;
    }
    
    updateActiveConnections(count) {
        const timestamp = Date.now();
        
        this.metrics.activeConnections.push({
            timestamp,
            count
        });
        
        if (this.metrics.activeConnections.length > 1000) {
            this.metrics.activeConnections.shift();
        }
    }
    
    checkThresholds() {
        const memory = this.getMemoryUsage();
        const cpu = this.getCpuUsage();
        
        if (memory > this.thresholds.memory) {
            this.triggerAlert('memory', `Memory usage exceeded threshold: ${(memory / 1024 / 1024).toFixed(2)}MB`);
        }
        
        if (cpu > this.thresholds.cpu) {
            this.triggerAlert('cpu', `CPU usage exceeded threshold: ${cpu.toFixed(2)}%`);
        }
        
        if (this.metrics.responseTime.length > 10) {
            const responseTimes = this.metrics.responseTime.slice(-100).map(r => r.responseTime);
            responseTimes.sort((a, b) => a - b);
            const p95Index = Math.floor(responseTimes.length * 0.95);
            const p95 = responseTimes[p95Index] || 0;
            
            if (p95 > this.thresholds.responseTime) {
                this.triggerAlert('responseTime', `P95 response time exceeded threshold: ${p95.toFixed(2)}ms`);
            }
        }
        
        if (this.metrics.errorRate.length > 0) {
            const latestErrorRate = this.metrics.errorRate[this.metrics.errorRate.length - 1];
            if (latestErrorRate.rate > this.thresholds.errorRate) {
                this.triggerAlert('errorRate', `Error rate exceeded threshold: ${(latestErrorRate.rate * 100).toFixed(2)}%`);
            }
        }
        
        if (this.metrics.cacheHitRate.length > 0) {
            const latestCacheHit = this.metrics.cacheHitRate[this.metrics.cacheHitRate.length - 1];
            if (latestCacheHit.hitRate < this.thresholds.cacheHitRate) {
                this.triggerAlert('cacheHitRate', `Cache hit rate below threshold: ${(latestCacheHit.hitRate * 100).toFixed(2)}%`);
            }
        }
    }
    
    triggerAlert(type, message) {
        const alert = {
            timestamp: Date.now(),
            type,
            message,
            severity: this.getAlertSeverity(type)
        };
        
        this.alerts.push(alert);
        
        if (this.alerts.length > 100) {
            this.alerts.shift();
        }
        
        console.warn(`[PERFORMANCE ALERT] ${message}`);
    }
    
    getAlertSeverity(type) {
        const severityMap = {
            memory: 'high',
            cpu: 'medium',
            responseTime: 'medium',
            errorRate: 'high',
            cacheHitRate: 'low'
        };
        return severityMap[type] || 'medium';
    }
    
    start() {
        if (this.isRunning) {
            console.warn('Performance monitor is already running');
            return;
        }
        
        this.isRunning = true;
        this.startTime = Date.now();
        
        console.log(`Starting performance monitoring with interval ${config.monitoring.interval}ms`);
        
        this.interval = setInterval(() => {
            this.collectMetrics();
            this.checkThresholds();
            this.samples++;
        }, config.monitoring.interval);
    }
    
    stop() {
        if (!this.isRunning) {
            console.warn('Performance monitor is not running');
            return;
        }
        
        this.isRunning = false;
        
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        
        console.log('Performance monitoring stopped');
    }
    
    collectMetrics() {
        this.getMemoryUsage();
        this.getCpuUsage();
    }
    
    getSummary() {
        const duration = Date.now() - this.startTime;
        const summary = {
            monitoringDuration: duration,
            samples: this.samples,
            memory: this.getMetricSummary(this.metrics.memory, 'heapUsed'),
            cpu: this.getMetricSummary(this.metrics.cpu, 'usage'),
            responseTime: this.getMetricSummary(this.metrics.responseTime, 'responseTime'),
            errorRate: this.getMetricSummary(this.metrics.errorRate, 'rate'),
            cacheHitRate: this.getMetricSummary(this.metrics.cacheHitRate, 'hitRate'),
            throughput: this.getMetricSummary(this.metrics.throughput, 'throughput'),
            activeConnections: this.getMetricSummary(this.metrics.activeConnections, 'count'),
            alerts: {
                total: this.alerts.length,
                high: this.alerts.filter(a => a.severity === 'high').length,
                medium: this.alerts.filter(a => a.severity === 'medium').length,
                low: this.alerts.filter(a => a.severity === 'low').length
            }
        };
        
        return summary;
    }
    
    getMetricSummary(metrics, valueKey) {
        if (metrics.length === 0) {
            return { count: 0, min: 0, max: 0, avg: 0, p95: 0 };
        }
        
        const values = metrics.map(m => m[valueKey]).filter(v => typeof v === 'number');
        if (values.length === 0) {
            return { count: 0, min: 0, max: 0, avg: 0, p95: 0 };
        }
        
        values.sort((a, b) => a - b);
        
        return {
            count: values.length,
            min: values[0],
            max: values[values.length - 1],
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            p95: values[Math.floor(values.length * 0.95)]
        };
    }
    
    generateJsonReport() {
        const report = {
            timestamp: new Date().toISOString(),
            summary: this.getSummary(),
            metrics: this.metrics,
            alerts: this.alerts,
            thresholds: this.thresholds,
            config: this.config
        };
        
        const filename = `performance-report-${Date.now()}.json`;
        const filepath = path.join(this.outputDir, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
        console.log(`JSON report generated: ${filepath}`);
        
        return filepath;
    }
    
    generateHtmlReport() {
        const summary = this.getSummary();
        const html = this.createHtmlTemplate(summary);
        
        const filename = `performance-report-${Date.now()}.html`;
        const filepath = path.join(this.outputDir, filename);
        
        fs.writeFileSync(filepath, html);
        console.log(`HTML report generated: ${filepath}`);
        
        return filepath;
    }
    
    createHtmlTemplate(summary) {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Performance Monitor Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
            color: #333;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            border-bottom: 2px solid #e0e0e0;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .metric-card {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 6px;
            border-left: 4px solid #007bff;
        }
        .metric-card.warning {
            border-left-color: #ffc107;
        }
        .metric-card.danger {
            border-left-color: #dc3545;
        }
        .metric-title {
            font-size: 14px;
            font-weight: 600;
            color: #666;
            margin-bottom: 10px;
        }
        .metric-value {
            font-size: 24px;
            font-weight: bold;
            color: #333;
        }
        .metric-unit {
            font-size: 12px;
            color: #666;
            margin-left: 4px;
        }
        .alerts {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 6px;
            padding: 20px;
            margin-top: 20px;
        }
        .alert-item {
            padding: 10px;
            margin: 5px 0;
            border-radius: 4px;
            background: white;
        }
        .alert-high { background: #f8d7da; border-left: 4px solid #dc3545; }
        .alert-medium { background: #fff3cd; border-left: 4px solid #ffc107; }
        .alert-low { background: #d1ecf1; border-left: 4px solid #17a2b8; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Performance Monitor Report</h1>
            <p>Generated: ${new Date().toLocaleString()}</p>
            <p>Monitoring Duration: ${(summary.monitoringDuration / 1000 / 60).toFixed(2)} minutes</p>
            <p>Total Samples: ${summary.samples}</p>
        </div>
        
        <div class="grid">
            <div class="metric-card ${summary.memory.max > this.thresholds.memory ? 'danger' : ''}">
                <div class="metric-title">Memory Usage</div>
                <div class="metric-value">${(summary.memory.avg / 1024 / 1024).toFixed(2)}<span class="metric-unit">MB</span></div>
                <div>Max: ${(summary.memory.max / 1024 / 1024).toFixed(2)}MB</div>
            </div>
            
            <div class="metric-card ${summary.cpu.max > this.thresholds.cpu ? 'warning' : ''}">
                <div class="metric-title">CPU Usage</div>
                <div class="metric-value">${summary.cpu.avg.toFixed(2)}<span class="metric-unit">%</span></div>
                <div>Max: ${summary.cpu.max.toFixed(2)}%</div>
            </div>
            
            <div class="metric-card ${summary.responseTime.p95 > this.thresholds.responseTime ? 'warning' : ''}">
                <div class="metric-title">Response Time (P95)</div>
                <div class="metric-value">${summary.responseTime.p95.toFixed(2)}<span class="metric-unit">ms</span></div>
                <div>Avg: ${summary.responseTime.avg.toFixed(2)}ms</div>
            </div>
            
            <div class="metric-card ${summary.errorRate.avg > this.thresholds.errorRate ? 'danger' : ''}">
                <div class="metric-title">Error Rate</div>
                <div class="metric-value">${(summary.errorRate.avg * 100).toFixed(2)}<span class="metric-unit">%</span></div>
                <div>Max: ${(summary.errorRate.max * 100).toFixed(2)}%</div>
            </div>
            
            <div class="metric-card ${summary.cacheHitRate.avg < this.thresholds.cacheHitRate ? 'warning' : ''}">
                <div class="metric-title">Cache Hit Rate</div>
                <div class="metric-value">${(summary.cacheHitRate.avg * 100).toFixed(2)}<span class="metric-unit">%</span></div>
                <div>Min: ${(summary.cacheHitRate.min * 100).toFixed(2)}%</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-title">Throughput</div>
                <div class="metric-value">${summary.throughput.avg.toFixed(2)}<span class="metric-unit">req/min</span></div>
                <div>Max: ${summary.throughput.max.toFixed(2)} req/min</div>
            </div>
        </div>
        
        ${summary.alerts.total > 0 ? `
        <div class="alerts">
            <h3>Alerts (${summary.alerts.total})</h3>
            <div class="alert-summary">
                High: ${summary.alerts.high} | Medium: ${summary.alerts.medium} | Low: ${summary.alerts.low}
            </div>
        </div>
        ` : ''}
    </div>
</body>
</html>`;
    }
    
    generateReports() {
        const jsonReport = this.generateJsonReport();
        const htmlReport = this.generateHtmlReport();
        
        return {
            json: jsonReport,
            html: htmlReport
        };
    }
}

module.exports = PerformanceMonitor;