"""把后端打包成可直接上传到 Wispbyte 的 zip。

用法（在项目根目录）：
    python deploy/wispbyte/pack.py

产物：
    deploy/wispbyte/wispbyte-backend.zip

包内是「扁平」结构（没有 python/ 这一层），因为面板解压到 /home/container 后
要能直接 `bash start.sh`。

只带运行必需的文件：模型 JSON + 训练数据 + 服务和算法模块 + 依赖清单。
train_xgboost.py / fetch_csl.py 也带上，方便在容器里重训（体积很小）。
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = ROOT / "python"
HERE = Path(__file__).resolve().parent
OUT = HERE / "wispbyte-backend.zip"

# python/ 下要带走的文件
PATTERNS = ["*.py", "models/*.json", "data/*.csv", "requirements-prod.txt"]
# 面板不是用 git 拉代码的，这些没用
SKIP = {"deploy_space.py"}


def collect() -> list[Path]:
    files: list[Path] = []
    for pat in PATTERNS:
        for p in sorted(PY.glob(pat)):
            if p.is_file() and p.name not in SKIP and "__pycache__" not in p.parts:
                files.append(p)
    extra = HERE / "start.sh"
    if extra.is_file():
        files.append(extra)
    return files


def main() -> int:
    files = collect()
    if not files:
        print("没有收集到任何文件，检查路径", file=sys.stderr)
        return 1

    total = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for src in files:
            data = src.read_bytes()
            # .sh 必须是 LF，否则 Linux 上 bash 会报 $'\r': command not found
            if src.suffix in {".sh", ".txt"}:
                data = data.replace(b"\r\n", b"\n")
            # models/ data/ 保留目录层级，其余放根目录
            if src.parent.name in {"models", "data"}:
                arc = f"{src.parent.name}/{src.name}"
            else:
                arc = src.name
            zf.writestr(arc, data)
            total += len(data)

    print(f"已生成 {OUT.relative_to(ROOT)}")
    print(f"  {len(files)} 个文件，{total / 1024:.0f} KB")
    for src in files:
        print(f"  - {src.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
