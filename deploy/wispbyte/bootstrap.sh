#!/usr/bin/env bash
# 在 Wispbyte 容器的 Console 里一条命令把后端代码铺到当前目录。
#
#   curl -fsSL https://raw.githubusercontent.com/renju4433/renju4433/main/deploy/wispbyte/bootstrap.sh | bash
#
# 用途：比在面板里逐个上传文件省事。代码直接取自 GitHub 仓库，
# 之后改了仓库再跑一遍即可同步（模型和快照也会一起覆盖）。
set -euo pipefail

REPO="${WISPBYTE_REPO:-renju4433/renju4433}"
BRANCH="${WISPBYTE_BRANCH:-main}"
DEST="${1:-$PWD}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "[bootstrap] 拉取 $REPO@$BRANCH ..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar xz -C "$tmp" --strip-components=1

mkdir -p "$DEST/models" "$DEST/data"
cp -f "$tmp"/python/*.py "$DEST"/
cp -f "$tmp"/python/models/*.json "$DEST"/models/
cp -f "$tmp"/python/data/*.csv "$DEST"/data/
cp -f "$tmp"/python/requirements-prod.txt "$DEST"/
cp -f "$tmp"/deploy/wispbyte/start.sh "$DEST"/

# 保险：万一被 CRLF 污染，就地修掉，否则 bash 无法执行
sed -i 's/\r$//' "$DEST/start.sh" 2>/dev/null || true
chmod +x "$DEST/start.sh" 2>/dev/null || true

echo "[bootstrap] 完成。文件在 $DEST"
ls -1 "$DEST"
echo
echo "下一步：Startup Command 填  bash start.sh  然后 Start"
