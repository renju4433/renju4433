#!/usr/bin/env bash
# Wispbyte（以及任何 Pterodactyl 系面板）的容器启动脚本。
# 面板里 Startup Command 填：bash start.sh
#
# 做的事只有两件：
#   1. 按 requirements-prod.txt 装依赖（装过就跳过，靠 md5 标记判断）
#   2. 启动 FastAPI 预测服务，端口读面板注入的 PORT / SERVER_PORT
set -euo pipefail

cd "$(dirname "$0")"
export PYTHONUNBUFFERED=1

# 面板镜像的 python 命令可能是 python 也可能是 python3
PY=""
for cand in python python3 python3.12 python3.11 python3.13; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  echo "[start] 找不到 python，请确认镜像选的是 Python 而不是 Node.js" >&2
  exit 1
fi
echo "[start] 使用解释器 $($PY -V 2>&1)"

# 有些镜像不带 pip，先补上
if ! "$PY" -m pip --version >/dev/null 2>&1; then
  echo "[start] 未检测到 pip，尝试 ensurepip"
  "$PY" -m ensurepip --upgrade >/dev/null 2>&1 || true
fi

REQ="requirements-prod.txt"
if command -v md5sum >/dev/null 2>&1; then
  STAMP=".deps-$(md5sum "$REQ" | cut -c1-8)"
else
  STAMP=".deps-$(cksum "$REQ" | awk '{print $1}')"
fi

if [ ! -f "$STAMP" ]; then
  echo "[start] 安装依赖（首次约 1-2 分钟，之后启动会跳过）..."
  "$PY" -m pip install --user --no-cache-dir --disable-pip-version-check -q -r "$REQ"
  rm -f .deps-* 2>/dev/null || true
  : > "$STAMP"
  echo "[start] 依赖安装完成"
else
  echo "[start] 依赖已就绪，跳过安装"
fi

echo "[start] 启动预测服务，PORT=${PORT:-${SERVER_PORT:-未设置(默认 8001)}}"
exec "$PY" soccer_predictor_api.py
