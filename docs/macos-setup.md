# macOS 安装与使用说明

本文档面向 **macOS 用户**，说明如何在本机安装并启动 GLM Coding Helper 的本地 OCR 后端。
Windows 用户请直接看 [README.md](../README.md) 和 [backend_config.md](backend_config.md)。

## 适用范围

| 项 | 说明 |
| --- | --- |
| 系统 | macOS 12–15（PaddlePaddle 官方支持范围） |
| 架构 | Apple Silicon（arm64，M1 及后续型号） |
| 后端 | **仅支持 CPU**（见下方「已知限制」） |
| 验证码识别 | 与 Windows 版完全一致（YOLO + PaddleOCR CPU 流水线） |

## 重要前提：macOS 版怎么识别验证码

和 Windows 一样，本项目主用的是 **pipeline 后端**（`backend/server.py`）：

1. 油猴脚本直接从腾讯验证码组件抓取原图；
2. 原图 base64 发送到本地后端 `/captcha_direct`；
3. 后端用本地 YOLO + PaddleOCR 识别；
4. 脚本按识别坐标点击文字。

也就是说，**识别过程不依赖屏幕截图**。Windows 版里那个自动截图验证码弹窗的功能（`scripts/monitor/window_helper.py`）是纯 Win32 实现，**macOS 不支持**，但这不影响主流程——油猴脚本会把图直接发过来。

## 前置条件

### 1. Apple Silicon 和 Python 3.12

当前固定依赖 `paddlepaddle==3.3.1` 在 macOS 上只发布了 arm64 wheel，Intel Mac（x86_64）无法通过本项目脚本安装。先确认架构：

```bash
uname -m
```

输出必须是 `arm64`。

兼容范围以 [PaddlePaddle 官方 macOS PIP 安装说明](https://www.paddlepaddle.org.cn/documentation/docs/en/install/pip/macos-pip_en.html) 为准。

系统里的 `python3` 可能不是本项目要求的版本。推荐用 Homebrew 安装 3.12：

```bash
brew install python@3.12
```

如果要使用 Tk 可视化窗口，还需安装 Tk 支持：

```bash
brew install python-tk@3.12
```

只使用 `one-click-start.command` 的 headless 模式时不需要 Tk。

安装后确认：

```bash
python3.12 --version
```

或访问官方下载页：<https://www.python.org/downloads/macos/>

### 2. 油猴脚本

在 Chrome / Edge 安装 Tampermonkey 并安装本项目的 `glm-coding-helper.user.js`，步骤和 Windows 完全相同，详见 [README.md](../README.md) 的「安装油猴脚本」一节。

### 3. 网络

首次安装会从 PyPI 拉取 PaddlePaddle、Ultralytics 等包，**mac 的 wheel 体积较大**，请保持网络畅通。必要时可走国内镜像（见下文「命令行手动安装」）。

## 一键安装（推荐）

下载 Release 压缩包并解压后，双击：

```text
one-click-start.command
```

首次双击如果被 macOS 的 Gatekeeper 拦截（提示「无法打开」），用以下任一方式解决：

- 在 Finder 里**右键点击** `one-click-start.command` → 选择「打开」→ 在弹窗里点「打开」；
- 或在终端里赋予可执行权限后运行：

```bash
chmod +x one-click-start.command
./one-click-start.command
```

这个脚本会自动完成：

1. 检查 macOS、Apple Silicon 架构和 Python 3.12；
2. 创建虚拟环境 `.venv_paddle`；
3. 安装 CPU 依赖（`requirements-backend-cpu.txt`）；
4. 检查 YOLO 权重；
5. 以 headless 模式启动后端。

启动成功后监听：

```text
http://127.0.0.1:8888
```

## 日常启动（带可视化窗口）

环境装好后，日常使用双击：

```text
start-backend-pipeline-gui.command
```

它会弹出 Tk 窗口，实时显示：

- **顶部状态栏**：系统状态（启动中 / 运行中）、YOLO / OCR worker 数、监听地址；
- **中间识别列表**：最近识别结果（提示字、预测字、置信度、yolo/ocr 耗时）；
- **底部日志框**：后端 stdout 实时滚动。

关闭窗口会自动停止后端子进程。

如果端口 8888 被占用，脚本会用 `lsof` 检测并提示是否停止占用进程。

## 命令行手动安装

如果你想手动控制安装过程（例如用国内镜像加速），运行环境搭建脚本：

```bash
./scripts/setup_backend_macos.sh
```

可选参数：

```bash
# 删除并重建 .venv_paddle
./scripts/setup_backend_macos.sh --recreate

# 跳过安装后的导入冒烟测试
./scripts/setup_backend_macos.sh --no-smoke-test

# 用清华镜像加速安装
./scripts/setup_backend_macos.sh --pip-arg -i --pip-arg https://pypi.tuna.tsinghua.edu.cn/simple
```

脚本完成后，手动启动：

```bash
# GUI 模式（弹 Tk 窗口）
./.venv_paddle/bin/python backend/gui.py

# headless 模式
./.venv_paddle/bin/python -m backend.server

# 指定端口
CNCAPTCHA_PORT=8888 ./.venv_paddle/bin/python -m backend.server
```

> macOS 启动脚本固定使用 CPU pipeline 后端。如 Python 3.12 不在 PATH，可先设置 `CNCAPTCHA_PYTHON=/完整路径/python3.12`。

## 已知限制

| 限制 | 说明 |
| --- | --- |
| **仅 CPU** | PaddlePaddle 在 macOS 上只提供 CPU wheel，没有 CUDA / GPU 版本，也不支持 Apple Silicon 的 MPS 加速。识别速度会比有 NVIDIA GPU 的机器慢一些，但准确率一致。 |
| **不支持自动截图弹窗** | 自动截图验证码弹窗（`window_helper.py`）是 Win32 专用功能，macOS 不支持。但**主流程不依赖它**——油猴脚本会直接把验证码原图发到 `/captcha_direct`。 |
| **macOS 26 及更高版本** | 超出当前 PaddlePaddle 官方文档列出的 macOS 12–15 范围，本项目不承诺可用；可按下方验证步骤实测。 |
| **首次模型下载** | 第一次启动时 PaddleOCR 会联网下载 PP-OCRv5 模型，体积较大，请耐心等待。 |
| **识别速度** | Apple Silicon 上 CPU 推理已相当快，但 YOLO + 多个 OCR worker 的并发受物理核数限制。可在仓库根 `config.json`（首次启动自动生成）里手动调整 `workers` / `ocr_workers`。 |

## 端口占用排查

如果后端启动报端口被占用，但启动器没正确处理，手动排查：

```bash
# 查看 8888 端口的占用进程
lsof -i :8888

# 终止占用进程（替换 <PID>）
kill <PID>
```

或换一个端口启动：

```bash
CNCAPTCHA_PORT=8889 ./.venv_paddle/bin/python -m backend.server
```

注意油猴脚本默认连 `http://127.0.0.1:8888`，换端口后需要在油猴脚本配置里同步修改后端地址。

## macOS 与 Windows 版差异

| 项 | Windows | macOS |
| --- | --- | --- |
| 启动脚本 | `.cmd` + PowerShell（`.ps1`） | `.command` + bash（`.sh`） |
| GPU 模式 | 支持（需 NVIDIA GPU + CUDA） | 不支持（仅 CPU） |
| 自动截图弹窗 | 支持（Win32） | 不支持（走油猴脚本发图） |
| 环境搭建 | `bootstrap_windows.ps1` | `scripts/setup_backend_macos.sh` |
| 支持架构 | x86_64 | arm64（Apple Silicon） |
| 识别模型 | YOLO + PaddleOCR | YOLO + PaddleOCR |

## 安装后验证

环境安装完成后，先运行：

```bash
./.venv_paddle/bin/python -c "import paddle; paddle.utils.run_check()"
./.venv_paddle/bin/python -c "import fastapi, uvicorn, psutil, ultralytics, paddleocr, paddlex, cv2, PIL, numpy; print('依赖导入正常')"
```

再启动 headless 后端，并在另一个终端检查健康接口：

```bash
./one-click-start.command
curl http://127.0.0.1:8888/health
```

只有依赖导入、Paddle 自检和 `/health` 都通过，才说明本机环境确实可用。

## 常见问题

### 双击 `.command` 提示「无法打开，因为无法验证开发者」

macOS Gatekeeper 拦截。右键点击文件 → 「打开」→ 弹窗里点「打开」即可。或在终端里 `chmod +x 文件名.command` 后用命令行运行。

### 启动后 OCR worker 一直不 ready

首次启动需要下载模型并做 JIT 预热，可能需要 30 秒到几分钟。观察 Tk 窗口底部日志，看到类似 `[ocr] Core N ready` 表示就绪。如果长时间卡住，检查网络（模型下载失败）或查看日志里的错误信息。

### `pip install` 很慢或失败

mac 的 PaddlePaddle / Ultralytics wheel 体积大，建议用国内镜像：

```bash
./scripts/setup_backend_macos.sh --pip-arg -i --pip-arg https://pypi.tuna.tsinghua.edu.cn/simple
```

### ImportError: paddle / paddleocr

通常是没有激活虚拟环境或安装不完整。确认用 `.venv_paddle/bin/python` 启动，而不是系统的 `python3`。重新运行 `./scripts/setup_backend_macos.sh --recreate` 可彻底重建环境。

### 提示需要 Python 3.12，但系统已有 Python 3

`python3` 可能是 3.14 等不兼容版本，脚本不会再误用它。安装 `python@3.12` 后重试，或明确指定：

```bash
CNCAPTCHA_PYTHON=/opt/homebrew/bin/python3.12 ./scripts/setup_backend_macos.sh
```
