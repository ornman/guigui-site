#!/usr/bin/env bash
# 发版配方第 3 步:把 exe 镜像到下载主源(dl.yaoxiumax.top → 103.236.55.179)。
# 官网(/download 跳板)探活 60s TTL,exe 到位即自动切主源;没到位则整链回
# Cloudflare 同域兜底,不产生事故窗口。用法:bash scripts/mirror-deploy.sh
set -euo pipefail

REMOTE_USER="TODO"      # 待确认(SSH 免密配置后填)
REMOTE_HOST="103.236.55.179"
REMOTE_PATH="TODO"      # 待确认:dl.yaoxiumax.top 的 web 根(如 /var/www/dl)

cd "$(dirname "$0")/.."
VER=$(node -e "console.log(require('./site/version.json').latest)")
EXE="site/guigui-setup-${VER}.exe"
[ -f "$EXE" ] || { echo "缺 $EXE(文件名须=guigui-setup-<latest>.exe)"; exit 1; }

scp "$EXE" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/guigui-setup-${VER}.exe"
echo "镜像完成 → https://dl.yaoxiumax.top/guigui-setup-${VER}.exe"
echo "验证:curl -I https://dl.yaoxiumax.top/guigui-setup-${VER}.exe"
