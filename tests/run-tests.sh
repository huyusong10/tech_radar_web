#!/bin/bash

# Tech Radar 压力测试和性能测试运行脚本
# 支持多种测试场景和配置

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
BASE_URL="http://localhost:5090"
TEST_DIR="./tests"
SCRIPTS_DIR="$TEST_DIR/scripts"
REPORTS_DIR="$TEST_DIR/reports"
RESULTS_DIR="$TEST_DIR/results"
CONFIG_DIR="$TEST_DIR/config"

# 创建目录
mkdir -p "$REPORTS_DIR" "$RESULTS_DIR"

# 函数：打印带颜色的消息
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

# 函数：检查服务器是否运行
check_server() {
    print_info "检查服务器是否运行在 $BASE_URL..."
    
    if curl -s --head "$BASE_URL/api/health" | grep "200 OK" > /dev/null; then
        print_success "服务器运行正常"
        return 0
    else
        print_error "服务器未运行或无法访问"
        print_info "请先启动服务器: npm start"
        return 1
    fi
}

# 函数：运行单个测试
run_test() {
    local test_type=$1
    local scenario=$2
    local script_name=$3
    
    print_info "运行 $test_type 测试 - 场景: $scenario"
    
    local timestamp=$(date +"%Y%m%d-%H%M%S")
    local report_prefix="$REPORTS_DIR/${test_type}-${scenario}-${timestamp}"
    
    # 运行k6测试
    SCENARIO=$scenario k6 run "$SCRIPTS_DIR/$script_name" \
        --summary-export="${report_prefix}-summary.json" \
        --out json="${report_prefix}-metrics.json" \
        --out csv="${RESULTS_DIR}/${test_type}-${scenario}-${timestamp}.csv"
    
    # 检查是否成功
    if [ $? -eq 0 ]; then
        print_success "$test_type 测试完成: $scenario"
        echo "报告文件:"
        echo "  - ${report_prefix}-summary.json"
        echo "  - ${report_prefix}-metrics.json"
        echo "  - ${RESULTS_DIR}/${test_type}-${scenario}-${timestamp}.csv"
        return 0
    else
        print_error "$test_type 测试失败: $scenario"
        return 1
    fi
}

# 函数：运行负载测试
run_load_test() {
    local scenario=$1
    run_test "load" "$scenario" "load-test.js"
}

# 函数：运行性能测试
run_performance_test() {
    local scenario=$1
    run_test "performance" "$scenario" "performance-test.js"
}

# 函数：运行快速测试套件
run_quick_suite() {
    print_info "运行快速测试套件..."
    
    # 1. 快速负载测试
    run_load_test "quick"
    
    # 2. 并发性能测试
    run_performance_test "concurrency"
    
    # 3. 延迟性能测试
    run_performance_test "latency"
    
    print_success "快速测试套件完成"
}

# 函数：运行完整测试套件
run_full_suite() {
    print_info "运行完整测试套件..."
    
    # 负载测试场景
    local load_scenarios=("quick" "medium" "high" "concurrent" "api_endpoints")
    
    # 性能测试场景
    local perf_scenarios=("concurrency" "throughput" "latency" "stability" "cache" "comprehensive")
    
    # 运行所有负载测试
    for scenario in "${load_scenarios[@]}"; do
        run_load_test "$scenario"
    done
    
    # 运行所有性能测试
    for scenario in "${perf_scenarios[@]}"; do
        run_performance_test "$scenario"
    done
    
    print_success "完整测试套件完成"
}

# 函数：运行极限压力测试
run_extreme_test() {
    print_warning "运行极限压力测试（1000并发用户）..."
    print_warning "这可能会对服务器造成较大压力，请确保在生产环境外运行"
    
    read -p "是否继续？(y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "取消极限压力测试"
        return 0
    fi
    
    # 运行极限测试
    run_load_test "extreme"
    run_load_test "spike"
    run_performance_test "comprehensive"
    
    print_success "极限压力测试完成"
}

# 函数：运行耐力测试
run_endurance_test() {
    print_info "运行耐力测试（长时间运行）..."
    
    run_load_test "endurance"
    run_performance_test "stability"
    run_performance_test "memory"
    
    print_success "耐力测试完成"
}

# 函数：生成测试报告
generate_report() {
    print_info "生成测试报告..."
    
    local timestamp=$(date +"%Y%m%d-%H%M%S")
    local report_file="$REPORTS_DIR/test-report-${timestamp}.md"
    
    # 收集所有JSON报告
    local json_files=($(find "$REPORTS_DIR" -name "*.json" -type f))
    
    if [ ${#json_files[@]} -eq 0 ]; then
        print_warning "没有找到测试报告"
        return 1
    fi
    
    # 创建Markdown报告
    cat > "$report_file" << EOF
# Tech Radar 压力测试和性能测试报告

**生成时间:** $(date)
**测试环境:** $BASE_URL

## 测试概览

EOF
    
    # 添加每个测试的结果
    for json_file in "${json_files[@]}"; do
        local test_name=$(basename "$json_file" | sed 's/-summary\.json//' | sed 's/-metrics\.json//')
        
        # 从JSON中提取关键指标
        if [[ "$json_file" == *"-summary.json" ]]; then
            local metrics=$(jq -r '.metrics | to_entries[] | "\(.key): \(.value)"' "$json_file" 2>/dev/null || echo "无法解析JSON")
            
            cat >> "$report_file" << EOF

### $test_name

\`\`\`json
$metrics
\`\`\`

EOF
        fi
    done
    
    # 添加总结
    cat >> "$report_file" << EOF

## 测试总结

### 性能指标
- **总测试数:** ${#json_files[@]}
- **测试时间范围:** 从最早到最晚测试

### 建议
1. 检查响应时间超过阈值的API端点
2. 优化错误率较高的接口
3. 根据吞吐量测试结果调整服务器配置

### 后续步骤
1. 分析详细的CSV报告数据
2. 针对性能瓶颈进行优化
3. 定期运行自动化测试监控性能变化

---

*报告自动生成于 $(date)*
EOF
    
    print_success "测试报告已生成: $report_file"
    
    # 打开报告
    if command -v open &> /dev/null; then
        open "$report_file"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$report_file"
    fi
}

# 函数：清理旧报告
cleanup_old_reports() {
    print_info "清理7天前的测试报告..."
    
    find "$REPORTS_DIR" -name "*.json" -mtime +7 -delete
    find "$REPORTS_DIR" -name "*.html" -mtime +7 -delete
    find "$RESULTS_DIR" -name "*.csv" -mtime +7 -delete
    
    print_success "旧报告清理完成"
}

# 函数：显示帮助
show_help() {
    cat << EOF
Tech Radar 压力测试和性能测试工具

用法: $0 [命令] [参数]

命令:
  check             检查服务器状态
  quick             运行快速测试套件
  full              运行完整测试套件
  extreme           运行极限压力测试（1000并发）
  endurance         运行耐力测试（长时间运行）
  load <场景>       运行特定负载测试场景
  perf <场景>       运行特定性能测试场景
  report            生成测试报告
  cleanup           清理旧报告
  help              显示此帮助信息

负载测试场景:
  quick             快速测试（50用户）
  medium            中等负载（200用户）
  high              高负载（500用户）
  extreme           极限压力（1000用户）
  spike             峰值测试（突发流量）
  endurance         耐力测试（长时间）
  concurrent        并发读写测试
  api_endpoints     API端点测试

性能测试场景:
  concurrency       并发连接测试
  throughput        吞吐量测试
  latency           延迟测试
  stability         稳定性测试
  memory            内存测试
  database          数据库连接测试
  cache             缓存性能测试
  comprehensive     综合性能测试

示例:
  $0 check          检查服务器
  $0 quick          运行快速测试
  $0 load medium    运行中等负载测试
  $0 perf latency   运行延迟性能测试
  $0 extreme        运行极限压力测试
  $0 report         生成测试报告

环境变量:
  BASE_URL          测试服务器URL（默认: http://localhost:5090）

EOF
}

# 主函数
main() {
    local command=$1
    local scenario=$2
    
    case $command in
        "check")
            check_server
            ;;
        "quick")
            check_server && run_quick_suite
            ;;
        "full")
            check_server && run_full_suite
            ;;
        "extreme")
            check_server && run_extreme_test
            ;;
        "endurance")
            check_server && run_endurance_test
            ;;
        "load")
            if [ -z "$scenario" ]; then
                print_error "请指定负载测试场景"
                show_help
                exit 1
            fi
            check_server && run_load_test "$scenario"
            ;;
        "perf"|"performance")
            if [ -z "$scenario" ]; then
                print_error "请指定性能测试场景"
                show_help
                exit 1
            fi
            check_server && run_performance_test "$scenario"
            ;;
        "report")
            generate_report
            ;;
        "cleanup")
            cleanup_old_reports
            ;;
        "help"|"")
            show_help
            ;;
        *)
            print_error "未知命令: $command"
            show_help
            exit 1
            ;;
    esac
}

# 运行主函数
main "$@"