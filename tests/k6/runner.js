#!/usr/bin/env node

// ========== K6 性能测试运行器
// Tech Radar Web 性能测试工具

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// 配置
const CONFIG = {
    api_url: process.env.K6_API_URL || 'http://localhost:5090',
    volume_id: process.env.K6_VOLUME_ID || '1',
    output_dir: 'tests/results',
    test_files: {
        pressure: 'tests/k6/pressure-test.js',
        performance: 'tests/k6/performance-test.js',
    },
};

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

log('⚡ Tech Radar Web 性能测试工具', 'blue');
log('='.repeat(50), 'blue');

// 检查服务器
async function checkServer() {
    log('🔍 检查服务器状态...', 'yellow');
    try {
        const response = await fetch(`${CONFIG.api_url}`, { method: 'GET', mode: 'cors' });
        if (response.ok) {
            log('✅ 服务器运行正常', 'green');
            return true;
        } else {
            log('❌ 服务器响应异常', 'red');
            return false;
        }
    } catch (error) {
        log('❌ 无法连接到服务器 - 请确保服务器运行中', 'red');
        log(`   起始命令: node server.js`, 'blue');
        return false;
    }
}

// 检查 k6 是否安装
async function checkK6() {
    try {
        const { stdout } = await execAsync('k6 version');
        log(`✅ k6 已安装: ${stdout.trim()}`, 'green');
        return true;
    } catch {
        log('❌ k6 未安装', 'red');
        log('   安装: npm install -g k6', 'yellow');
        return false;
    }
}

// 运行测试
async function runTest(testFile, options = {}) {
    const args = ['run', testFile];
    if (options.vus) args.push('--vus', options.vus);
    if (options.duration) args.push('--duration', options.duration);
    if (options.scenario) args.push('--scenario', options.scenario);

    // 输出配置
    const timestamp = Date.now();
    const outputFile = path.join(CONFIG.output_dir, `${options.scenario || 'test'}-${timestamp}.json`);
    const htmlFile = path.join(CONFIG.output_dir, `${options.scenario || 'test'}-${timestamp}.html`);

    args.push('--out', `json=${outputFile}`);
    args.push('--out', `html=${htmlFile}`);

    log(`\n🚀 执行测试: ${testFile}`, 'blue');
    log(`📤 输出文件: ${outputFile}`, 'yellow');

    try {
        const { stdout, stderr } = await execAsync(`k6 ${args.join(' ')}`);
        log('\n📊 测试结果:', 'green');
        console.log(stdout);

        if (stderr && stderr.includes('ERROR')) {
            log('⚠️ 测试执行中存在警告', 'yellow');
        }

        log(`✅ 测试完成: ${outputFile}`, 'green');
        log(`   HTML 报告: ${htmlFile}`, 'green');
        return outputFile;
    } catch (error) {
        log('❌ 测试执行失败', 'red');
        if (error.stderr) {
            log(error.stderr, 'red');
        }
        throw error;
    }
}

// 快速测试
async function quickTest() {
    log('\n⚡ 执行快速测试 (50 VUs, 30秒)', 'blue');
    return runTest(CONFIG.test_files.pressure, {
        vus: '50',
        duration: '30s',
        scenario: 'quick',
    });
}

// 性能测试
async function performanceTest() {
    log('\n🚀 执行性能测试 (10 VUs, 100 迭代)', 'blue');
    return runTest(CONFIG.test_files.performance, {
        vus: '10',
        duration: '30s',
        scenario: 'micro_benchmark',
    });
}

// 长时间测试
async function longTest() {
    log('\n⏳ 执行长时间测试 (20 VUs, 5 分钟)', 'blue');
    return runTest(CONFIG.test_files.pressure, {
        vus: '20',
        duration: '5m',
        scenario: 'long_running',
    });
}

// 完整压力测试
async function fullPressureTest() {
    log('\n🚀 执行完整压力测试', 'blue');

    // 阶段1: 0-50 VUs
    log('\n📊 阶段 1: 0 → 50 VUs (30秒)', 'yellow');
    await runTest(CONFIG.test_files.pressure, {
        vus: '50',
        duration: '30s',
        scenario: 'load_balance',
    });

    // 阶段2: 50-100 VUs
    log('\n📊 阶段 2: 50 → 100 VUs (30秒)', 'yellow');
    await runTest(CONFIG.test_files.pressure, {
        vus: '100',
        duration: '30s',
        scenario: 'load_balance',
    });

    // 阶段3: 100-200 VUs
    log('\n📊 阶段 3: 100 → 200 VUs (30秒)', 'yellow');
    await runTest(CONFIG.test_files.pressure, {
        vus: '200',
        duration: '30s',
        scenario: 'load_balance',
    });

    // 阶段4: 200-500 VUs
    log('\n📊 阶段 4: 200 → 500 VUs (60秒)', 'yellow');
    await runTest(CONFIG.test_files.pressure, {
        vus: '500',
        duration: '1m',
        scenario: 'load_balance',
    });

    // 阶段5: 500-1000 VUs
    log('\n📊 阶段 5: 500 → 1000 VUs (60秒)', 'yellow');
    await runTest(CONFIG.test_files.pressure, {
        vus: '1000',
        duration: '1m',
        scenario: 'load_balance',
    });

    log('\n✅ 完整压力测试完成', 'green');
}

// 单场景测试
async function scenarioTest(scenarioName, vus, duration) {
    log(`\n🎯 执行场景测试: ${scenarioName} (${vus} VUs, ${duration})`, 'blue');
    return runTest(CONFIG.test_files.pressure, {
        vus,
        duration,
        scenario: scenarioName,
    });
}

// 主函数
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    // 创建输出目录
    if (!fs.existsSync(CONFIG.output_dir)) {
        fs.mkdirSync(CONFIG.output_dir, { recursive: true });
    }

    try {
        // 检查环境
        const serverReady = await checkServer();
        if (!serverReady) {
            process.exit(1);
        }

        await checkK6();

        // 执行命令
        switch (command) {
            case 'quick':
                await quickTest();
                break;
            case 'performance':
                await performanceTest();
                break;
            case 'long':
                await longTest();
                break;
            case 'full':
                await fullPressureTest();
                break;
            case 'scenario':
                if (args[1]) {
                    await scenarioTest(args[1], args[2] || '100', args[3] || '2m');
                } else {
                    log('❌ 请指定场景名称', 'red');
                    log('用法: node runner.js scenario <name> [vus] [duration]', 'yellow');
                    log('示例: node runner.js scenario volume 100 2m', 'yellow');
                }
                break;
            default:
                log('\n可用命令:', 'blue');
                log('  quick          - 快速测试 (50 VUs, 30秒)', 'yellow');
                log('  performance    - 性能测试 (10 VUs, 100 迭代)', 'yellow');
                log('  long           - 长时间测试 (20 VUs, 5 分钟)', 'yellow');
                log('  full           - 完整压力测试 (多阶段)', 'yellow');
                log('  scenario name  - 单场景测试', 'yellow');
                log('', 'yellow');
                log('示例:', 'yellow');
                log('  node runner.js quick', 'green');
                log('  node runner.js full', 'green');
                log('  node runner.js scenario volume 100 2m', 'green');
                log('  K6_API_URL=http://prod.k6 node runner.js full', 'green');
                process.exit(1);
        }

        log('\n✅ 所有测试完成', 'green');
    } catch (error) {
        log('\n❌ 执行失败', 'red');
        log(error.message, 'red');
        process.exit(1);
    }
}

main();