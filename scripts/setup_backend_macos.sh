#!/bin/bash
# GLM Coding Helper 后端环境搭建（macOS / 仅 CPU）
#
# 等价于 Windows 的 bootstrap_windows.ps1 + one_click_start.ps1：
#   1. 检测 Apple Silicon 和 Python 3.12
#   2. 创建 .venv_paddle
#   3. pip install -r requirements-backend-cpu.txt
#   4. smoke test 核心依赖
#   5. 检查 YOLO 权重
#
# 用法：
#   ./scripts/setup_backend_macos.sh                 # 安装/补全 CPU 环境
#   ./scripts/setup_backend_macos.sh --recreate      # 删除并重建 .venv_paddle
#   ./scripts/setup_backend_macos.sh --no-smoke-test # 跳过导入冒烟测试
#   ./scripts/setup_backend_macos.sh --pip-arg -i --pip-arg https://pypi.tuna.tsinghua.edu.cn/simple

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

# ── 解析参数 ───────────────────────────────────────────────────
RECREATE=0
NO_SMOKE_TEST=0
PIP_ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --recreate)
            RECREATE=1
            shift
            ;;
        --no-smoke-test)
            NO_SMOKE_TEST=1
            shift
            ;;
        --pip-arg)
            shift
            if [ $# -eq 0 ]; then
                echo "[错误] --pip-arg 需要跟一个参数" >&2
                exit 1
            fi
            PIP_ARGS+=("$1")
            shift
            ;;
        --help|-h)
            sed -n '2,20p' "$0"
            exit 0
            ;;
        *)
            echo "[错误] 未知参数：$1" >&2
            exit 1
            ;;
    esac
done

echo "GLM Coding Helper 后端环境搭建（macOS / 仅 CPU）"
echo "仓库根目录：$ROOT"
echo ""

# ── 1. 检查系统并选择 Python 3.12 ─────────────────────────────
if [ "$(uname -s)" != "Darwin" ]; then
    echo "[错误] 此脚本仅支持 macOS。" >&2
    exit 1
fi

if [ "$(uname -m)" != "arm64" ]; then
    echo "[错误] 当前 PaddlePaddle 3.3.1 的 macOS wheel 仅支持 Apple Silicon（arm64）。" >&2
    echo "       Intel Mac（x86_64）无法使用本项目的在线安装脚本。" >&2
    exit 1
fi

PY="${CNCAPTCHA_PYTHON:-}"
if [ -z "$PY" ] && command -v python3.12 >/dev/null 2>&1; then
    PY="$(command -v python3.12)"
fi

if [ -z "$PY" ]; then
    echo "[错误] 没有找到 Python 3.12。请先安装：" >&2
    echo "       brew install python@3.12" >&2
    echo "       或访问 https://www.python.org/downloads/macos/" >&2
    exit 1
fi

if [ ! -x "$PY" ] && ! command -v "$PY" >/dev/null 2>&1; then
    echo "[错误] CNCAPTCHA_PYTHON 指定的解释器不可用：$PY" >&2
    exit 1
fi

PY_VERSION="$("$PY" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
if [ "$PY_VERSION" != "3.12" ]; then
    echo "[错误] 需要 Python 3.12，当前解释器版本为 ${PY_VERSION:-未知}：$PY" >&2
    echo "       可设置 CNCAPTCHA_PYTHON=/path/to/python3.12 后重试。" >&2
    exit 1
fi
echo "[INFO] 使用 Python：$PY ($PY_VERSION)"

# ── 2. 创建 / 重建 venv ────────────────────────────────────────
VENV_DIR="$ROOT/.venv_paddle"
VENV_PY="$VENV_DIR/bin/python"

if [ "$RECREATE" -eq 1 ] && [ -d "$VENV_DIR" ]; then
    echo "[INFO] 删除已有环境：$VENV_DIR"
    rm -rf "$VENV_DIR"
fi

if [ ! -x "$VENV_PY" ]; then
    echo "[INFO] 创建虚拟环境：$VENV_DIR"
    "$PY" -m venv "$VENV_DIR"
fi

# ── 3. 安装 CPU 依赖 ───────────────────────────────────────────
REQ="$ROOT/requirements-backend-cpu.txt"
if [ ! -f "$REQ" ]; then
    echo "[错误] 缺少 $REQ，请确认是完整的 Release 包。" >&2
    exit 1
fi

echo "[INFO] 升级 pip / setuptools / wheel"
"$VENV_PY" -m pip install --upgrade pip setuptools wheel

echo "[INFO] 安装 CPU 依赖（可能需要几分钟，mac wheel 体积较大）..."
if [ "${#PIP_ARGS[@]}" -gt 0 ]; then
    "$VENV_PY" -m pip install -r "$REQ" "${PIP_ARGS[@]}"
else
    "$VENV_PY" -m pip install -r "$REQ"
fi

# ── 4. smoke test ──────────────────────────────────────────────
if [ "$NO_SMOKE_TEST" -eq 0 ]; then
    echo ""
    echo "[INFO] 运行导入冒烟测试..."
    "$VENV_PY" -c "import paddle; paddle.utils.run_check(); import PIL, cv2, numpy, ultralytics; from paddleocr import TextRecognition; print('core imports ok')"
    "$VENV_PY" -c "import fastapi, uvicorn, psutil; print('backend deps ok')"
fi

# ── 5. 检查 YOLO 权重 ──────────────────────────────────────────
WEIGHT="$ROOT/models/weights/yolo-captcha-detector.pt"
echo ""
if [ -f "$WEIGHT" ]; then
    echo "[OK] 检测权重就绪：$WEIGHT"
else
    echo "[WARN] 缺少检测权重：$WEIGHT" >&2
    echo "       请从 Release 包补齐该文件后再启动后端。" >&2
fi

# ── 6. 完成 ────────────────────────────────────────────────────
cat <<EOF

完成。启动后端：

  GUI 模式（弹 Tk 窗口）：
    $VENV_PY $ROOT/backend/gui.py
  或直接双击：start-backend-pipeline-gui.command

  headless 模式：
    $VENV_PY -m backend.server

  macOS 仅支持 CPU，没有 GPU 模式。
EOF
