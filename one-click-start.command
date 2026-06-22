#!/bin/bash
# GLM Coding Helper 一键启动（macOS）
# 用途：首次安装 CPU 后端环境并启动 pipeline 后端（headless）。
#
# 双击运行：Finder 里首次可能被 Gatekeeper 拦截，右键 -> 打开 即可。
# 命令行运行：./one-click-start.command
#
# macOS 限制：仅支持 CPU（PaddlePaddle 在 mac 上没有 CUDA/GPU wheel）。
#            不支持自动截图验证码弹窗，需配合油猴脚本走 /captcha_direct 发图。

set -euo pipefail

# 切到脚本所在目录（仓库根）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

cat <<'EOF'
------------------------------------------------------------
 GLM Coding Helper 一键启动（macOS / 仅 CPU）
------------------------------------------------------------
 首次运行会自动创建 .venv_paddle 并安装 CPU 依赖。
 安装包较大（paddle / ultralytics），请保持网络畅通。
 macOS 不支持 GPU，也不支持自动截图弹窗；
 必须用油猴脚本把验证码原图发到 /captcha_direct。
------------------------------------------------------------

EOF

# ── 1. 安装或补全虚拟环境 ─────────────────────────────────────
VENV_DIR="$SCRIPT_DIR/.venv_paddle"
VENV_PY="$VENV_DIR/bin/python"
NEED_INSTALL=0
if [ ! -x "$VENV_PY" ]; then
    NEED_INSTALL=1
elif ! "$VENV_PY" -c "import fastapi, uvicorn, psutil, ultralytics, paddleocr, paddlex, paddle, cv2, PIL, numpy" >/dev/null 2>&1; then
    NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
    if ! "$SCRIPT_DIR/scripts/setup_backend_macos.sh"; then
        echo "" >&2
        echo "[错误] 环境安装失败，请根据上面的错误信息处理后重试。" >&2
        read -r -p "按回车键退出..."
        exit 1
    fi
fi

# ── 2. 检查 YOLO 权重 ─────────────────────────────────────────
WEIGHT="$SCRIPT_DIR/models/weights/yolo-captcha-detector.pt"
if [ ! -f "$WEIGHT" ]; then
    echo "[错误] 缺少检测权重：$WEIGHT" >&2
    echo "       请从 Release 包补齐 models/weights/yolo-captcha-detector.pt 后再启动。" >&2
    read -r -p "按回车键退出..."
    exit 1
fi

# ── 3. 启动后端（CPU / headless） ─────────────────────────────
PORT="${CNCAPTCHA_PORT:-8888}"
echo ""
echo "[INFO] 启动后端：http://127.0.0.1:$PORT （Ctrl+C 停止）"
echo ""
export CNCAPTCHA_PORT="$PORT"
exec "$VENV_PY" -m backend.server
