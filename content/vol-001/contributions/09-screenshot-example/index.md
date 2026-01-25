---
author_id: "chen_hao"
title: "VSCode 调试配置完全指南"
description: "一站式配置 VSCode 调试环境，支持 Node.js、Go、Python 等多种语言。"
---

## 调试配置界面

![VSCode Debug Config](./vscode-debug.svg)

## Node.js 调试配置

创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Current File",
      "skipFiles": ["<node_internals>/**"],
      "program": "${file}",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"]
    },
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to Process",
      "port": 9229,
      "restart": true
    }
  ]
}
```

## Go 调试配置

```json
{
  "type": "go",
  "request": "launch",
  "name": "Debug Go",
  "program": "${workspaceFolder}",
  "env": {
    "GO_ENV": "development"
  },
  "args": ["-config", "config.yaml"]
}
```

## 常用快捷键

| 快捷键 | 功能 |
|--------|------|
| `F5` | 开始调试 |
| `F9` | 切换断点 |
| `F10` | 单步跳过 |
| `F11` | 单步进入 |
| `Shift+F11` | 单步退出 |

**Pro Tip**: 使用 logpoints 代替 `console.log`，无需修改代码即可输出日志！
