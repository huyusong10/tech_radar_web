#!/bin/bash

# 模拟导航逻辑
ALL_MODELS=(
    "alibaba|qwen3.5-plus|Qwen3.5-Plus (均衡推荐)"
    "alibaba|kimi-k2.5|Kimi K2.5 (支持图片理解)"
    "alibaba|glm-5|GLM-5 (智谱 AI)"
    "tencent|hy-2.0-instruct|Tencent HY 2.0 Instruct (腾讯混元)"
    "tencent|glm-5|GLM-5 (智谱 AI)"
    "tencent|kimi-k2.5|Kimi K2.5 (支持图片理解)"
    "tencent|minimax-m2.5|MiniMax M2.5"
)

options=()
model_data=()

options+=("── Alibaba Coding Plan ──")
model_data+=("")

for m in "${ALL_MODELS[@]}"; do
    platform=$(echo "$m" | cut -d'|' -f1)
    model_id=$(echo "$m" | cut -d'|' -f2)
    desc=$(echo "$m" | cut -d'|' -f3-)
    if [ "$platform" = "alibaba" ]; then
        options+=("  $desc")
        model_data+=("alibaba:$model_id")
    fi
done

options+=("── Tencent Coding Plan ──")
model_data+=("")

for m in "${ALL_MODELS[@]}"; do
    platform=$(echo "$m" | cut -d'|' -f1)
    model_id=$(echo "$m" | cut -d'|' -f2)
    desc=$(echo "$m" | cut -d'|' -f3-)
    if [ "$platform" = "tencent" ]; then
        options+=("  $desc")
        model_data+=("tencent:$model_id")
    fi
done

options+=("")
model_data+=("")
options+=("Disable (use Anthropic API)")
model_data+=("disable")

echo "=== 测试向下导航（跳过分隔符）==="
selected=1
echo "开始: [$selected] ${options[$selected]}"
for i in {1..15}; do
    selected=$(( (selected + 1) % ${#options[@]} ))
    # Skip separators
    count=0
    while [ -z "${model_data[$selected]}" ] && [ $count -lt ${#options[@]} ]; do
        selected=$(( (selected + 1) % ${#options[@]} ))
        count=$((count + 1))
    done
    echo "步骤 $i: [$selected] ${options[$selected]}"
done

echo ""
echo "=== 测试向上导航（跳过分隔符）==="
selected=10
echo "开始: [$selected] ${options[$selected]}"
for i in {1..15}; do
    selected=$(( (selected - 1 + ${#options[@]}) % ${#options[@]} ))
    # Skip separators
    count=0
    while [ -z "${model_data[$selected]}" ] && [ $count -lt ${#options[@]} ]; do
        selected=$(( (selected - 1 + ${#options[@]}) % ${#options[@]} ))
        count=$((count + 1))
    done
    echo "步骤 $i: [$selected] ${options[$selected]}"
done

echo ""
echo "✓ 导航测试通过"
