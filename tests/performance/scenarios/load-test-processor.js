const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');

class LoadTestProcessor {
    constructor() {
        this.config = config;
        this.results = [];
    }

    async runScenario(scenarioName, scenarioConfig) {
        console.log(`  🚀 Running load test scenario: ${scenarioName}`);
        
        try {
            const tempConfig = this.generateArtilleryConfig(scenarioName, scenarioConfig);
            const tempConfigPath = path.join(__dirname, `temp-${scenarioName}-config.yml`);
            
            fs.writeFileSync(tempConfigPath, tempConfig);

            const result = await this.runArtillery(tempConfigPath, scenarioName);

            fs.unlinkSync(tempConfigPath);

            const analysis = this.analyzeResults(result, scenarioName);
            
            return {
                scenario: scenarioName,
                config: scenarioConfig,
                raw: result,
                analysis: analysis,
                passed: analysis.thresholdViolations.length === 0,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                scenario: scenarioName,
                config: scenarioConfig,
                error: error.message,
                passed: false,
                timestamp: new Date().toISOString()
            };
        }
    }

    generateArtilleryConfig(scenarioName, scenarioConfig) {
        const endpoints = [...this.config.endpoints.read, ...this.config.endpoints.write];
        
        const config = {
            config: {
                target: this.config.server.baseUrl,
                phases: this.generatePhases(scenarioConfig),
                payload: {
                    path: "./users.csv",
                    fields: ["username", "email", "ip"]
                },
                processor: "./load-test-processor.js"
            },
            scenarios: []
        };

        const scenario = {
            name: `${scenarioName} Load Test`,
            weight: 100,
            flow: []
        };

        for (const endpoint of this.config.endpoints.read) {
            scenario.flow.push({
                get: {
                    url: endpoint
                }
            });
        }

        scenario.flow.push({
            think: 1
        });

        scenario.flow.push({
            function: "setRandomIP"
        });

        scenario.flow.push({
            post: {
                url: "/api/views/vol-001",
                headers: {
                    "X-Forwarded-For": "{{ currentIP }}"
                }
            }
        });

        scenario.flow.push({
            function: "maybeLikeArticle"
        });

        scenario.flow.push({
            post: {
                url: "/api/likes/{{ selectedArticleId }}",
                headers: {
                    "X-Forwarded-For": "{{ randomIP }}",
                    "Content-Type": "application/json"
                },
                headers: "{{ $randomHeader() }}"
            },
            if: "selectedArticleId"
        });

        config.scenarios.push(scenario);

        return this.toYaml(config);
    }

    generatePhases(scenarioConfig) {
        if (scenarioConfig.phases) {
            return scenarioConfig.phases.map(phase => ({
                duration: phase.duration,
                arrivalRate: phase.arrivalRate
            }));
        }

        return [{
            duration: scenarioConfig.duration,
            arrivalRate: scenarioConfig.arrivalRate,
            maxVusers: scenarioConfig.maxVusers
        }];
    }

    async runArtillery(configPath, scenarioName) {
        return new Promise((resolve, reject) => {
            const artillery = spawn('npx', ['artillery', 'run', '--output', `/tmp/artillery-${scenarioName}-${Date.now()}.json`, configPath], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            artillery.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            artillery.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            artillery.on('close', (code) => {
                if (code === 0) {
                    try {
                        const jsonMatch = stdout.match(/(\{[\s\S]*\})/);
                        if (jsonMatch) {
                            const result = JSON.parse(jsonMatch[1]);
                            resolve(result);
                        } else {
                            resolve({
                                summary: this.parseTextOutput(stdout),
                                rawOutput: stdout
                            });
                        }
                    } catch (error) {
                        resolve({
                            summary: this.parseTextOutput(stdout),
                            rawOutput: stdout,
                            error: stderr
                        });
                    }
                } else {
                    reject(new Error(`Artillery exited with code ${code}: ${stderr}`));
                }
            });

            artillery.on('error', (error) => {
                reject(new Error(`Failed to start artillery: ${error.message}`));
            });
        });
    }

    parseTextOutput(output) {
        const lines = output.split('\n');
        const summary = {};

        for (const line of lines) {
            if (line.includes('HTTP requests:')) {
                summary.httpRequests = this.extractNumber(line);
            } else if (line.includes('Request latency:')) {
                summary.latency = this.extractLatency(line);
            } else if (line.includes('Throughput:')) {
                summary.throughput = this.extractThroughput(line);
            } else if (line.includes('Errors:')) {
                summary.errors = this.extractNumber(line);
            }
        }

        return summary;
    }

    extractNumber(text) {
        const match = text.match(/(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }

    extractLatency(text) {
        const match = text.match(/([\d.]+)ms/);
        return match ? parseFloat(match[1]) : 0;
    }

    extractThroughput(text) {
        const match = text.match(/([\d.]+)\/sec/);
        return match ? parseFloat(match[1]) : 0;
    }

    analyzeResults(result, scenarioName) {
        const analysis = {
            metrics: {},
            thresholdViolations: [],
            recommendations: []
        };

        if (result.summary) {
            analysis.metrics = {
                requests: result.summary.httpRequests || 0,
                latency: {
                    avg: result.summary.latency || 0
                },
                throughput: {
                    avg: result.summary.throughput || 0
                },
                errors: result.summary.errors || 0
            };

            if (analysis.metrics.requests > 0) {
                analysis.metrics.errorRate = analysis.metrics.errors / analysis.metrics.requests;
            } else {
                analysis.metrics.errorRate = 0;
            }

            const thresholds = this.config.thresholds;
            
            if (analysis.metrics.latency.avg > thresholds.responseTime.read.p95) {
                analysis.thresholdViolations.push({
                    metric: 'latency',
                    threshold: thresholds.responseTime.read.p95,
                    actual: analysis.metrics.latency.avg,
                    severity: 'high'
                });
            }

            if (analysis.metrics.throughput.avg < thresholds.throughput.read.min) {
                analysis.thresholdViolations.push({
                    metric: 'throughput',
                    threshold: thresholds.throughput.read.min,
                    actual: analysis.metrics.throughput.avg,
                    severity: 'medium'
                });
            }

            if (analysis.metrics.errorRate > thresholds.errorRate.max) {
                analysis.thresholdViolations.push({
                    metric: 'errorRate',
                    threshold: thresholds.errorRate.max,
                    actual: analysis.metrics.errorRate,
                    severity: 'high'
                });
            }

            if (analysis.thresholdViolations.length > 0) {
                analysis.recommendations.push('Consider optimizing server performance or increasing resources');
            }
        }

        return analysis;
    }

    toYaml(obj) {
        const yaml = require('js-yaml');
        return yaml.dump(obj, {
            indent: 2,
            lineWidth: -1,
            noRefs: true
        });
    }
}

const processorFunctions = {
    maybeLikeArticle: (userContext, events, done) => {
        const shouldLike = Math.random() < 0.3;
        
        if (shouldLike) {
            const testArticleIds = [
                "vol-001-typescript-types", 
                "vol-001-react-hooks", 
                "vol-002-nodejs-performance"
            ];
            
            const articleId = testArticleIds[Math.floor(Math.random() * testArticleIds.length)];
            const ipAddresses = [
                "192.168.1.101", "192.168.1.102", "192.168.1.103", 
                "192.168.1.104", "192.168.1.105", "192.168.1.106",
                "192.168.1.107", "192.168.1.108", "192.168.1.109", 
                "192.168.1.110"
            ];
            
            const randomIP = ipAddresses[Math.floor(Math.random() * ipAddresses.length)];
            
            userContext.vars.selectedArticleId = articleId;
            userContext.vars.randomIP = randomIP;
        }
        
        return done();
    },
    
    setRandomIP: (userContext, events, done) => {
        const ipAddresses = [
            "192.168.1.101", "192.168.1.102", "192.168.1.103", 
            "192.168.1.104", "192.168.1.105", "192.168.1.106",
            "192.168.1.107", "192.168.1.108", "192.168.1.109", 
            "192.168.1.110"
        ];
        
        const randomIP = ipAddresses[Math.floor(Math.random() * ipAddresses.length)];
        userContext.vars.currentIP = randomIP;
        
        return done();
    }
};

module.exports = new LoadTestProcessor();

if (typeof window === 'undefined') {
    module.exports.maybeLikeArticle = processorFunctions.maybeLikeArticle;
    module.exports.setRandomIP = processorFunctions.setRandomIP;
}