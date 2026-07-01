#!/bin/bash
# 微信桥接一键启动/更新
cd "$(dirname "$0")"

# 拉取最新代码
git pull origin master 2>/dev/null
npm install --silent 2>/dev/null

# 杀掉旧进程，用环境变量启动
pm2 delete wechat-bridge 2>/dev/null

# ── 环境变量（从 .env 读取，fallback 到当前 export）──
[ -f .env ] && set -a && source .env && set +a

pm2 start wechat_bridge.js --name wechat-bridge
pm2 save

echo "✅ wechat-bridge 已启动"
pm2 logs wechat-bridge --nostream --lines=3
