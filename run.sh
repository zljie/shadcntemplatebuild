#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [[ "$node_major" != "22" ]]; then
  echo "需要 Node.js 22，当前为 ${node_major:-未安装}。" >&2
  exit 1
fi

if [[ ! -x "node_modules/.bin/next" ]]; then
  echo "正在安装依赖…"
  npm ci
fi

case "${1:-dev}" in
  dev)   exec npm run dev ;;
  start) exec npm run start ;;
  build) exec npm run build ;;
  *)
    echo "用法: ./run.sh [dev|start|build]" >&2
    exit 2
    ;;
esac
