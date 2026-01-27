#!/bin/bash

# ========== K6 压力测试运行脚本 ==========
# Tech Radar Web 压力测试工具

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置变量
K6_VERSION="0.52.2"
API_URL="${K6_API_URL:-http://localhost:5090}"
VOLUME_ID="${K6_VOLUME_ID:-1}"
TEST_MODE="${K6_TEST_MODE:-full}"
OUTPUT_DIR="tests/results"

# 创建输出目录
mkdir -p "$OUTPUT_DIR"

# 打印函数
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查 k6 安装
check_k6() {
    if ! command -v k6 &> /dev/null; then
        print_error "k6 未安装，正在安装..."

        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            # Linux
            wget -q "https://github.com/grafana/k6/releases/download/v${K6_VERSION}/k6-${K6_VERSION}-linux-amd64.tar.gz" -O /tmp/k6.tar.gz
            tar -xzf /tmp/k6.tar.gz -C /tmp
            sudo mv /tmp/k6-${K6_VERSION}-linux-amd64/k6 /usr/local/bin/
            print_success "k6 安装成功"
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            brew install k6
            print_success "k6 安装成功"
        else
            print_error "不支持的操作系统: $OSTYPE"
            exit 1
        fi
    else
        print_success "k6 已安装: $(k6 version)"
    fi
}

# 安装 k6 npm 依赖
install_dependencies() {
    print_info "安装测试依赖..."

    if command -v npm &> /dev/null; then
        npm install --save-dev k6@${K6_VERSION}
        print_success "依赖安装完成"
    fi
}

# 检查 Node 服务器运行状态
check_server() {
    print_info "检查服务器状态..."

    if ! curl -s --head --fail "$API_URL" > /dev/null 2>&1; then
        print_error "服务器未运行: $API_URL"
        print_info "请在另一个终端运行：node server.js"
        exit 1
    fi

    print_success "服务器运行正常"
}

# 运行压力测试
run_pressure_test() {
    print_info "开始压力测试..."

    local test_file="tests/k6/pressure-test.js"
    local output_file="$OUTPUT_DIR/pressure-test-$(date +%Y%m%d-%H%M%S).json"

    if [ ! -f "$test_file" ]; then
        print_error "测试文件不存在: $test_file"
        exit 1
    fi

    K6_API_URL="$API_URL" k6 run \
        --out json="$output_file" \
        --out html="${OUTPUT_DIR}/pressure-test-report.html" \
        "$test_file"

    print_success "压力测试完成: $output_file"
    print_success "详细报告: ${OUTPUT_DIR}/pressure-test-report.html"
}

# 运行性能测试
run_performance_test() {
    print_info "开始性能测试..."

    local test_file="tests/k6/performance-test.js"
    local output_file="$OUTPUT_DIR/performance-test-$(date +%Y%m%d-%H%M%S).json"

    if [ ! -f "$test_file" ]; then
        print_error "测试文件不存在: $test_file"
        exit 1
    fi

    K6_API_URL="$API_URL" k6 run \
        --out json="$output_file" \
        --out html="${OUTPUT_DIR}/performance-test-report.html" \
        --out console="$test_file" \
        "$test_file"

    print_success "性能测试完成: $output_file"
    print_success "详细报告: ${OUTPUT_DIR}/performance-test-report.html"
}

# 快速测试 (小并发)
run_quick_test() {
    print_info "执行快速测试 (50并发)..."

    local test_file="tests/k6/pressure-test.js"
    local vus=50
    local duration="30s"

    K6_API_URL="$API_URL" k6 run \
        --vus="$vus" \
        --duration="$duration" \
        --out csv="${OUTPUT_DIR}/quick-test-${vus}.csv" \
        "$test_file"

    print_success "快速测试完成"
}

# 单场景测试
run_scenario_test() {
    local scenario=$1
    local vus=$2
    local duration=$3

    print_info "执行场景测试: $scenario (VUs: $vus, 耗时: $duration)"

    local test_file="tests/k6/pressure-test.js"

    K6_API_URL="$API_URL" k6 run \
        --vus="$vus" \
        --duration="$duration" \
        --scenario="$scenario" \
        --out json="${OUTPUT_DIR}/${scenario}-test.json" \
        "$test_file"

    print_success "场景测试完成"
}

# 执行所有测试
run_full_test_suite() {
    print_info "执行完整测试套件..."

    local test_file="tests/k6/pressure-test.js"

    K6_API_URL="$API_URL" k6 run \
        --vus=100 \
        --duration="1m" \
        --out json="${OUTPUT_DIR}/full-test.json" \
        --out console="$test_file" \
        "$test_file"

    print_success "完整测试套件执行完成"
}

# 生成测试报告摘要
generate_summary() {
    print_info "生成测试报告摘要..."

    if [ ! -d "$OUTPUT_DIR" ]; then
        return
    fi

    # 找到最新的 JSON 报告
    local latest_json=$(ls -t "$OUTPUT_DIR"/*.json | head -1)

    if [ -f "$latest_json" ]; then
        print_success "测试报告: $latest_json"
        cat "$latest_json" | jq '.metrics | .http_req_duration | {avg, p(95), p(99), min, max}'
    fi
}

# 显示使用帮助
usage() {
    cat << EOF
使用方法: $0 [选项]

选项:
    full              运行完整压力测试 (默认)
    performance       运行性能测试
    quick             快速测试 (50 并发, 30秒)
    scenario [name]   单场景测试 (name: home, volume, likes, views)
    install           安装测试依赖
    check             检查环境
    help              显示此帮助信息

示例:
    $0 full                          # 运行完整压力测试
    $0 quick                         # 运行快速测试
    $0 scenario volume 100 2m        # 运行情景测试
    K6_API_URL=http://prod.k6 run quick

环境变量:
    K6_API_URL          API 地址 (默认: http://localhost:5090)
    K6_VOLUME_ID        测试使用的卷编号 (默认: 1)
    K6_TEST_MODE        测试模式 (默认: full)

输出:
    所有报告保存在: $OUTPUT_DIR/

EOF
}

# 主函数
main() {
    case "$1" in
        full)
            check_server
            check_k6
            run_full_test_suite
            ;;
        performance)
            check_server
            check_k6
            run_performance_test
            ;;
        quick)
            check_server
            check_k6
            run_quick_test
            ;;
        scenario)
            check_server
            check_k6
            run_scenario_test "$2" "$3" "$4"
            ;;
        install)
            install_dependencies
            check_k6
            ;;
        check)
            check_k6
            check_server
            ;;
        help|--help|-h)
            usage
            exit 0
            ;;
        *)
            if [ -z "$1" ]; then
                run_full_test_suite
            else
                print_error "未知选项: $1"
                echo "使用 '$0 help' 查看帮助"
                exit 1
            fi
            ;;
    esac
}

# 执行主函数
main "$@"