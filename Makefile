# Tech Radar Web Makefile
# 提供常用的测试和开发命令快捷方式

.PHONY: help test quick test-perf test-long test-full test-scenario install deps start stop clean

# 默认目标：显示帮助信息
help:
	@echo "Tech Radar Web - 快捷命令"
	@echo ""
	@echo "运行测试:"
	@echo "  make test          - 快速压力测试 (50 VUs, 30秒)"
	@echo "  make test-perf     - 性能测试 (10 VUs, 100 迭代)"
	@echo "  make test-long     - 长时间测试 (20 VUs, 5分钟)"
	@echo "  make test-full     - 完整压力测试 (千级并发)"
	@echo "  make test-scenario - 单场景测试"
	@echo ""
	@echo "安装和部署:"
	@echo "  make install       - 安装所有依赖（包括测试工具）"
	@echo "  make deps          - 仅安装生产依赖"
	@echo "  make start         - 启动服务器"
	@echo "  make stop          - 停止服务器"
	@echo "  make clean         - 清理测试结果和临时文件"
	@echo ""
	@echo "使用示例:"
	@echo "  make test-full API_URL=http://server.com"
	@echo "  make test-scenario volume 100 2m"

# 快速压力测试
test:
	@echo "🚀 运行快速压力测试..."
	@bash tests/k6/run-test.sh quick

# 性能测试
test-perf:
	@echo "🚀 运行性能测试..."
	@node tests/k6/runner.js performance

# 长时间测试
test-long:
	@echo "⏳ 运行长时间测试..."
	@node tests/k6/runner.js long

# 完整压力测试
test-full:
	@echo "🚀 运行完整压力测试..."
	@K6_API_URL=${API_URL:-http://localhost:5090} bash tests/k6/run-test.sh full

# 单场景测试
test-scenario:
	@echo "🎯 运行场景测试..."
	@K6_API_URL=${API_URL:-http://localhost:5090} node tests/k6/runner.js scenario $(orign) 100 2m

# 安装依赖
install:
	@echo "📦 安装所有依赖..."
	@npm install
	@echo "✅ 依赖安装完成"
	@echo "📝 提示: 运行 'make quick-test' 开始测试"

# 仅安装生产依赖
deps:
	@echo "📦 安装生产依赖..."
	@npm install

# 启动服务器
start:
	@echo "🚀 启动服务器..."
	@node server.js

# 停止服务器（查找并杀死 Node 进程）
stop:
	@echo "🛑 停止服务器..."
	@pkill -f "node server.js" || true
	@echo "✅ 服务器已停止"

# 清理测试结果
clean:
	@echo "🧹 清理测试结果..."
	@rm -rf tests/results/*
	@echo "✅ 清理完成"

# 安装 k6
install-k6:
	@echo "📦 安装 k6 压力测试工具..."
	@if command -v brew &> /dev/null && [[ "$$(uname)" == "Darwin" ]]; then \
		brew install k6; \
	elif command -v dpkg &> /dev/null; then \
		sudo apt-get update && sudo apt-get install -y k6; \
	elif command -v yum &> /dev/null; then \
		sudo yum install -y k6; \
	else \
		echo "❌ 请手动安装 k6: npm install -g k6"; \
	fi
	@echo "✅ k6 安装完成"

# 运行所有测试
test-all:
	@echo "🧪 运行所有测试..."
	@make test
	@echo ""
	@make test-perf
	@echo ""
	@make test-long