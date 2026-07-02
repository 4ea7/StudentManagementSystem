#!/bin/bash
# 微信桥接一键启动/更新
cd "$(dirname "$0")"

# 拉取最新代码
git pull origin master 2>/dev/null
npm install --silent 2>/dev/null

# 杀掉旧进程
pm2 delete wechat-bridge 2>/dev/null
pkill -f "node xaj_life.js" 2>/dev/null

# ── 环境变量（从 .env 读取，fallback 到当前 export）──
[ -f .env ] && set -a && source .env && set +a

# 奚艾佳人生模拟引擎（后台运行，每分钟更新状态）
nohup node xaj_life.js >> xaj_life.log 2>&1 &
echo "✅ xaj-life 已启动 (PID: $!)"

pm2 start wechat_bridge.js --name wechat-bridge
pm2 save

echo "✅ wechat-bridge 已启动"
pm2 logs wechat-bridge --nostream --lines=3
