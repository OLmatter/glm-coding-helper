#!/bin/bash
# GLM Coding Helper Pipeline 后端 GUI 启动器（macOS）
# 用途：日常启动，弹出 Tk 可视化窗口并拉起 backend.server 子进程。
#
# 双击运行：Finder 里首次可能被 Gatekeeper 拦截，右键 -> 打开 即可。
# 命令行运行：./start-backend-pipeline-gui.command
#
# 首次使用前请先运行 one-click-start.command 装好 .venv_paddle 环境。

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
 GLM Coding Helper Pipeline 后端（GUI / macOS）
------------------------------------------------------------
 弹出 Tk 窗口实时显示 worker 状态、识别结果和后端日志。
 关闭窗口会自动停止后端子进程。
 macOS 仅支持 CPU。
------------------------------------------------------------

EOF

# ── 1. 定位 venv python ────────────────────────────────────────
VENV_CANDIDATES=("$SCRIPT_DIR/.venv_paddle/bin/python")

VENV_PY=""
for candidate in "${VENV_CANDIDATES[@]}"; do
    if [ -x "$candidate" ]; then
        VENV_PY="$candidate"
        break
    fi
done

if [ -z "$VENV_PY" ]; then
    echo "[错误] 没有找到 Python 虚拟环境。" >&2
    echo "       请先双击 one-click-start.command 安装环境。" >&2
    read -r -p "按回车键退出..."
    exit 1
fi

echo "[INFO] 使用 Python：$VENV_PY"

# ── 2. 检查 Tk 和后端依赖 ──────────────────────────────────────
if ! "$VENV_PY" -c "import tkinter" >/dev/null 2>&1; then
    echo ""
    echo "[错误] 当前 Python 缺少 tkinter；它不能通过 pip 安装。" >&2
    echo "       Homebrew 用户请运行：brew install python-tk@3.12" >&2
    echo "       也可安装 python.org 提供的 Python 3.12。" >&2
    read -r -p "按回车键退出..."
    exit 1
fi

if ! "$VENV_PY" -c "import fastapi, uvicorn, psutil, ultralytics, paddleocr, paddlex, paddle, cv2, PIL, numpy" >/dev/null 2>&1; then
    echo ""
    echo "[错误] 后端环境不完整，请重新运行 one-click-start.command。" >&2
    read -r -p "按回车键退出..."
    exit 1
fi

# ── 3. 端口占用检测（8888） ────────────────────────────────────
PORT="${CNCAPTCHA_PORT:-8888}"
OCCUPYING_PID="$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n1 || true)"

if [ -n "$OCCUPYING_PID" ]; then
    echo ""
    echo "[WARN] 端口 $PORT 已被占用。" >&2
    ps -p "$OCCUPYING_PID" -o pid=,comm=,command= 2>/dev/null || true
    read -r -p "输入 1 停止占用进程并重启，或按回车退出：" choice
    if [ "$choice" = "1" ]; then
        echo "[INFO] 停止进程 $OCCUPYING_PID ..."
        kill "$OCCUPYING_PID" 2>/dev/null || true
        sleep 2
    else
        exit 1
    fi
fi

# ── 4. 启动 GUI ────────────────────────────────────────────────
echo ""
echo "[INFO] 启动 GUI 窗口，关闭窗口会同时停止后端子进程。"
echo ""
exec "$VENV_PY" "$SCRIPT_DIR/backend/gui.py"
