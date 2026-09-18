#!/usr/bin/env bash
# 发版配方第 3 步:把 exe 镜像到下载主源(https://download.coro0.top → 103.236.55.179)。
# 官网(/download 跳板)探活 60s TTL,exe 到位即自动切主源;没到位则整链回
# Cloudflare 同域兜底,不产生事故窗口。用法:bash scripts/mirror-deploy.sh
set -euo pipefail

REMOTE_USER="root"      # 本机 id_ed25519 已授权(2026-09-18)
REMOTE_HOST="103.236.55.179"
REMOTE_PATH="/var/www/dl"   # download.coro0.top 的 web 根(宿主 nginx)

cd "$(dirname "$0")/.."
VER=$(node -e "console.log(require('./site/version.json').latest)")
EXE="site/guigui-setup-${VER}.exe"
[ -f "$EXE" ] || { echo "缺 $EXE(文件名须=guigui-setup-<latest>.exe)"; exit 1; }

scp -i ~/.ssh/id_ed25519 "$EXE" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/guigui-setup-${VER}.exe"
sha_remote=$(ssh -i ~/.ssh/id_ed25519 "$REMOTE_USER@$REMOTE_HOST" "sha256sum $REMOTE_PATH/guigui-setup-${VER}.exe | cut -d\" \" -f1")
sha_local=$(sha256sum "$EXE" | cut -d" " -f1)
[ "$sha_local" = "$sha_remote" ] || { echo "SHA 不一致! 远端未更新"; exit 1; }
echo "镜像完成 → https://download.coro0.top/guigui-setup-${VER}.exe (SHA 已核对)"
echo "验证:curl -I https://download.coro0.top/guigui-setup-${VER}.exe"
