#!/usr/bin/env bash
# 把 site/ 镜像到备用服务器(占位:SSH 信息确认后填下面三行再运行)
# 用法: bash scripts/mirror-deploy.sh
set -euo pipefail

REMOTE_USER="TODO"      # 例: root
REMOTE_HOST="TODO"      # 例: 1.2.3.4
REMOTE_PATH="TODO"      # 例: /var/www/guigui

cd "$(dirname "$0")/.."
rsync -avz --delete site/ "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/"
echo "镜像完成 → $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"
