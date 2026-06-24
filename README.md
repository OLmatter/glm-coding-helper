# 智谱 GLM Coding Plan 抢购助手 + 本地 OCR 自动验证码

这是一个面向智谱 GLM Coding Plan 的抢购辅助项目，包含 Tampermonkey 油猴脚本和本地 CPU/GPU OCR 后端，用于限时抢购流程辅助、一键启动后端、中文点选验证码自动识别、验证码自动点击、套餐按钮提前可点、限流重试和多窗口监控。目前仅适配 Google Chrome 和 Microsoft Edge，推荐使用 Chrome。

关键词：GLM Coding Rush、GLM Coding Plan 抢购助手、GLM Coding Plan 抢购脚本、GLM Coding Plan 一键抢购、GLM Coding 一键启动、智谱 GLM Coding 抢购、智谱编程套餐抢购、GLM Coding 油猴脚本、Tampermonkey userscript、Auto-Purchase Userscript、自动解锁售罄、限流重试、多窗口并发、本地 OCR、CPU OCR、GPU OCR、中文点选验证码、验证码自动点击、订阅助手。

English keywords: GLM Coding Rush, GLM Coding Plan auto purchase, GLM Coding Plan rush helper, GLM Coding one-click startup, GLM Coding userscript, Tampermonkey script, local OCR captcha solver, CPU OCR backend, GPU OCR backend, Chinese captcha auto click.

## 演示

https://github.com/user-attachments/assets/e1a56d07-5c4d-4aa1-a567-909dd25bd037

## 能做什么

- GLM Coding Plan 抢购流程辅助，减少手动刷新和返回操作
- 提前解除页面按钮不可点击状态，让订阅按钮可以操作
- 自动切换套餐和订阅周期，按配置顺序尝试
- 遇到中文点选验证码时，调用本地 OCR 后端自动识别并点击目标文字
- 支持 CPU/GPU 本地识别，不上传验证码图片到第三方服务
- 支持一键多开窗口，方便补货前预热和同时监控
- 默认不自动点击验证码“确定”按钮，需要在配置面板里手动开启
- 默认不自动关闭无效支付链接/限流弹窗，需要在配置面板里手动开启
- 默认使用作者内置折扣入口进入 GLM Coding Plan

注意：目前仅适配 Chrome 和 Edge。我测试了 1080p-1920p、桌面 100%-150% 放大倍率、浏览器 50%-125% 缩放。如果遇到显示或点击问题，建议先调整为 1920p、桌面 100%-125% 放大、浏览器 100%。

后端配置、GPU/CPU 自动选择、worker 数、OCR 配置等说明见：

```text
docs/backend_config.md
```

修复历史见：

```text
CHANGELOG.md
```

## 快速开始

Windows 普通用户可使用便携包，无需手动安装 Python；macOS 当前使用在线安装方式，需要 Apple Silicon 和 Python 3.12；Linux 使用在线安装包，需要 Python 3.12（或 uv），NVIDIA GPU 可选。最简单的方式是：

1. 下载 Release 压缩包
2. 解压
3. 安装油猴脚本
4. 启动后端（Windows 双击 `one-click-start.cmd`；macOS 运行 `one-click-start.command`；Linux 终端执行 `./one-click-start.sh`）
5. 打开 GLM Coding Plan 页面

### 1. 下载压缩包

到 Releases 页面下载：

https://github.com/OLmatter/glm-coding-helper/releases

推荐二选一：

| 文件 | 适合谁 | 说明 |
| --- | --- | --- |
| `glm-coding-helper-portable-cpu-*.zip` | Windows 用户、想少下载模型缓存的人 | 自带本地模型/缓存文件，但首次仍会在用户电脑上创建 CPU 后端环境 |
| `glm-coding-helper-online-installer-*.zip` | 网络正常、想下载小包的人；**macOS / Linux 推荐** | 小包，首次启动会自动下载并安装 CPU/GPU 环境（**Windows / macOS / Linux**） |

不知道选哪个：**Windows** 下载 `portable-cpu`，首次运行双击 `one-click-start.cmd`；**macOS / Linux** 下载 `online-installer`，按下方「启动后端」一节操作。

### 2. 解压

把 zip 解压到一个普通目录，例如：

```text
D:\Tools\glm-coding-helper
```

建议解压到短路径，例如：

```text
C:\glm-coding-helper
```

不要解压到层级很深的目录。部分依赖包内部路径很长，在 Windows 上可能触发路径长度限制，表现为 `pip install` 时报 `No such file or directory`。如果遇到环境安装失败，优先换到短路径、纯英文路径再试。

### 3. 安装油猴脚本

1. 在 Chrome 或 Edge 安装 Tampermonkey：https://www.tampermonkey.net/
2. 安装脚本，二选一：

方式 A：访问 Greasy Fork 页面安装：

```text
https://greasyfork.org/zh-CN/scripts/579760-glm-coding-helper
```

方式 B：打开解压目录里的本地脚本：

```text
glm-coding-helper.user.js
```

3. 如果使用方式 B，就复制全部内容，新建 Tampermonkey 脚本，粘贴并保存。
4. 确认脚本已启用。

Chrome 用户如果脚本不运行，请打开扩展详情，开启：

- 开发者模式
- 允许用户脚本
- 允许在无痕模式中启用（如果你用无痕窗口）

Greasy Fork 和仓库根目录的 `glm-coding-helper.user.js` 都是给普通用户安装的入口；`scripts/userscripts/` 只是保留给开发和旧路径兼容。

### 4. 启动后端

Windows：

```text
one-click-start.cmd
```

首次双击会自动安装 CPU/GPU 环境（自动探测可用 PyPI 镜像，安装过程有实时进度），之后每次双击直接启动后端 + Tk GUI。环境损坏时也会自动检测并修复。

macOS（Apple Silicon）：

```text
首次安装并启动：one-click-start.command
日常 GUI 启动：start-backend-pipeline-gui.command
```

macOS 的完整前置条件、Gatekeeper 处理和验证步骤见 [macOS 安装与使用说明](docs/macos-setup.md)。

Linux：

```text
chmod +x one-click-start.sh scripts/setup_backend_linux.sh
./one-click-start.sh
```

首次运行会自动探测 PyPI 镜像、安装 CPU/GPU 环境，并以 headless 模式启动 `captcha_server` 后端（与 Windows 主路径同源，无 Tk 窗口）。完整说明见 [Linux 安装与使用说明](docs/linux-setup.md)。

后端启动后默认监听：

```text
http://127.0.0.1:8888
```

然后打开 GLM Coding Plan 页面。脚本会自动使用内置优惠入口进入，不需要手动复制邀请码：

```text
https://www.bigmodel.cn/glm-coding
```

## 抢购步骤

1. 先安装好油猴插件，配置好油猴脚本。使用 Chrome 时要在扩展页面开启开发者模式，然后找到 Tampermonkey 详情，把“允许用户脚本”“在无痕模式下启用”“允许访问文件网址”按需打开。
2. 下载并解压 Release 包，按平台启动本地后端（Windows 双击 `one-click-start.cmd`；macOS `one-click-start.command`；Linux `./one-click-start.sh`）。
3. 打开 GLM Coding 页面测试脚本是否正常，脚本会自动补上内置优惠入口。
4. 每天 9 点 30 分前进入抢购页面准备，晚了可能就打不开了。提前准备好手机支付宝付款。
5. 多开几个窗口，等快到 10 点的时候点击好验证码但不要确定，等 10 点一到再按确定。**窗口不要开太多，最好 1-2 个，最多 2 个**（脚本弹窗上限仍为 10，按需选择）。窗口开得越多，请求数量按窗口数放大，撞 RPM 上限的概率越高，近期已有大量高并发脚本因此全轮失败。
6. 如果这波没抢到，就盯着一个窗口用 OCR 识别点击。默认不会自动关闭支付页面。注意：如果看到没有金额的支付页面，那就是没抢到，要关掉继续抢。这时可以使用快捷键快速操作。

## 经验与风控建议

- **⚠️ 2026-06-23 点击拦截风控升级**：智谱今早升级了风控，**自动点击订阅按钮偶尔会被拦截/拒绝**（连人手动点也一样会被拦），页面显示「很抱歉，由于您访问的URL有可能对网站造成安全威胁，您的访问被阻断」。
  - **应对 1**：点击被拦截时**等约 10 秒**重试，拦截一般不会持续。
  - **应对 2**：自动点击一直无效时，**手动点击「特惠订阅」入口**——手动点入口同样能进购买流程。
  - **验证码不用管**：不管订阅入口是脚本自动点还是手动点，**验证码识别（OCR）、点字、点确定都会自动接管**。
  - 一句话：**订阅入口点不动就手动点特惠订阅，验证码自动打**。
  - 风控拦截是智谱服务端行为，脚本侧无法绕过，只能等或换入口；自动点击和 OCR 解耦，互不影响。

- **RPM 风控（2026-06）**：智谱近期升级了 RPM（每分钟请求数）风控。市面上很多“高并发多窗口 + 屯码复用”的同类脚本近期已经大面积失效，整轮容易直接返回系统繁忙、`500`、`555` 或被风控。
- **本项目路线**：当前走的是**单窗口单发 + 实时 OCR 识别**。每发请求都带新鲜验证码，不依赖 ticket 复用，请求密度相对更低。
- **窗口数量**：最好只开 **1-2 个窗口**，**推荐最多 2 个**。近期很多 `500` 反馈，最后排查下来并不是单纯页面慢，而是**并发太高、请求太密**导致的 RPM 风控。
- **不要过早放弃**：目前社区和实测里，**到上午 11:00 之前都仍然有抢到的记录**。如果 10 点整这一波没中，不代表当天彻底结束；只要后端、脚本和支付流程都还正常，建议继续坚持抢。
- **无痕模式**：如果之前抢过且账号疑似被风控盯上，建议试试 Chrome / Edge 的**无痕模式窗口**（`Ctrl+Shift+N`）。无痕窗口没有历史 Cookie / 缓存 / Service Worker / 本地存储，可能减少隐形风控标记。注意要在 Tampermonkey 扩展详情里允许脚本在无痕模式运行。
- **自动点击订阅默认关闭**：开售前正常用户通常按不到购买入口，脚本加载后自动点击可能打到关键接口并触发风控。因此默认只观察和提醒；需要按 `F9` 或在配置面板显式开启，Rush mode 则等目标时间到达后才允许自动点击。
- **Rush mode**：`Rush mode（定时确认）` 默认目标是 `10:00:00`。开启后，脚本会继续扫描页面，但目标时间前不会自动点击订阅；目标时间已到才进入购买链路。验证码“确定”会根据实测 RTT 保守释放：默认按 `max(0, RTT/2 - 20ms)` 提前，本地发射不早于预测安全点，也不晚于目标时间。
- **验证码随机延时**：如果近期限流更重、风控更频繁，可以把配置面板里的验证码点字随机延时区间整体调大一点。当前默认是 `250-400ms`；更保守可以试 `300-450ms`，再重一点可以试 `350-500ms`。
- **核心原则**：先把流程跑稳，再去追求更快。窗口不要开太多，请求不要堆太密，能稳定跑完一整条链路通常比盲目并发更重要。

### 快捷键

- `Esc`：关闭系统繁忙弹窗或支付弹窗
- `Enter` / `Space`：点击验证码确认按钮
- `F8`：暂停/恢复脚本（暂停后停止扫描、订阅点击、验证码自动点击/确认）
- `F9`：切换自动点击订阅

快捷键可在配置面板中自定义。默认使用外挂工具常见的 `F8/F9`，避开浏览器常见快捷键；输入框、文本框、下拉框和可编辑区域内不会触发。

### 重要提醒

- 默认会自动识别验证码并点击目标文字。
- 默认不会自动点击订阅按钮，避免开售前打到正常用户按不到的关键接口；需要在配置面板或用 `F9` 显式开启。
- 默认不会自动点击验证码“确定”按钮，需要在配置面板里手动开启。
- 默认不会自动关闭无效支付链接或限流弹窗，需要在配置面板里手动开启。
- 遇到真正有金额的支付二维码，请自行确认后再扫码支付。
- 抢购是否成功受库存、限流、账号状态、支付速度等因素影响，脚本不能保证一定抢到。

油猴菜单里可以打开配置面板、一键多开窗口、清除今日套餐状态缓存。

交流群https://t.me/+s1flX6cpUZ1kM2M1

## 配置面板

在 Tampermonkey 菜单中选择：

```text
打开配置面板
```

可以配置：

- 套餐优先级
- 订阅周期优先级
- 是否自动点击订阅
- 是否自动点击验证码文字
- 是否自动点击验证码确定
- 是否自动关闭无效支付/限流弹窗
- 是否启用智能刷新

默认配置比较保守：会识别并点选验证码文字，但不会自动点击订阅或验证码“确定”。自动订阅需手动开启或等 Rush 目标时间到达。

## 验证码识别说明

当前验证码流程是：

1. 油猴脚本直接从腾讯验证码组件中抓取原图。
2. 原图发送到本地后端 `/captcha_direct`。
3. 后端使用本地 YOLO + PP-OCRv6（tiny 主路径，medium 兜底）识别。
4. 脚本按识别坐标点击文字。

验证码图片不会上传到第三方识别服务。OCR 默认走 **PP-OCRv6_tiny_rec**（约 110ms/张，379 张真实验证码准确率 100%），识别结果不一致时自动 fallback 到 PP-OCRv6_medium_rec；模型可通过 `config.json` 的 `ocr_model` 或环境变量 `CNCAPTCHA_CPU_OCR_MODEL` / `GLM_OCR_MODEL` 覆盖。

### 启动后端

Windows 主路径（推荐）：

```text
one-click-start.cmd   ← 首次自动安装 CPU/GPU 环境（自动探测 PyPI 镜像），之后启动后端 + Tk GUI
```

启动后会弹出 Tk 窗口（`scripts/tools/captcha_server.py`），实时显示：

- **系统状态 / 识别模型**：当前 OCR 模式与模型（hybrid | 主 v6_tiny → 兜底 v6_medium）
- **当前提示 / 识别结果**：本次验证码的 prompt 与识别输出、置信度
- **日志框**：`[captcha] 城匙称 -> 称匙城 | conf=1.00 end-to-end=312ms (yolo=120ms ocr=165ms)` 实时滚动

`one-click-start.cmd` 会自动检测/创建 `.venv_paddle`、检查依赖、缺失时自动 pip install；端口被占用时会显示中文提示（含 PID/进程名/命令行），杀进程前需用户确认。

另有 `start-backend-pipeline-gui.cmd`（`backend/` 目录的 FastAPI 多进程流水线 + 另一个 Tk GUI），是早期可选方案，功能等价但架构不同，普通用户用 `one-click-start.cmd` 即可。

macOS 日常启动请双击 `start-backend-pipeline-gui.command`，首次安装请双击 `one-click-start.command`。

Linux 首次安装与日常启动均使用 `./one-click-start.sh`（`start_backend.py --headless` → `captcha_server_headless`，与 Windows 主路径同源，无 Tk）。详见 [docs/linux-setup.md](docs/linux-setup.md)。

## 常用文件

| 文件 | 用途 |
| --- | --- |
| `glm-coding-helper.user.js` | 给 Tampermonkey 安装的主脚本 |
| `one-click-start.cmd` | 首次安装 CPU/GPU 环境 + 启动后端 + Tk GUI（Windows 主入口） |
| `one-click-start.command` | macOS 首次安装 CPU 环境并启动后端 |
| `start-backend-pipeline-gui.command` | macOS 日常启动后端 + Tk 窗口 |
| `one-click-start.sh` | Linux 首次安装 CPU/GPU 环境并启动 headless 后端 |
| `docs/macos-setup.md` | macOS 中文安装、限制与验证说明 |
| `docs/linux-setup.md` | Linux 中文安装、GPU/CPU 与验证说明 |
| `scripts/tools/captcha_server.py` | Windows `one-click-start.cmd` 启动的后端（HTTP + Tk GUI） |
| `scripts/tools/captcha_server_headless.py` | Linux `one-click-start.sh` 启动的后端（HTTP，无 GUI） |
| `backend/server.py` | macOS `one-click-start.command` 及可选 pipeline 后端 |
| `backend/` | 可选的 FastAPI 多进程流水线后端（macOS 主路径） |
| `models/` | 本地识别模型 |

## 常用启动方式

普通用户优先双击 `.cmd` 文件。如果你需要手动调试，可以用下面的命令。

自动选择 CPU/GPU：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start_backend.ps1 -Mode auto
```

强制 CPU：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start_backend.ps1 -Mode cpu
```

指定 CPU worker：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start_backend.ps1 -Mode cpu -CpuWorkers 3
```

强制 GPU：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start_backend.ps1 -Mode gpu
```

GPU 模式需要确认 `.venv_paddle_gpu` 里安装的是 GPU 版 PyTorch。`paddlepaddle-gpu` 只负责 OCR，YOLO/Ultralytics 依赖 `torch`；如果 `torch` 是 CPU 版，后端仍会跑起来，但 YOLO 会走 CPU。

检查方式：

```powershell
.\.venv_paddle_gpu\Scripts\python.exe -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no cuda')"
```

如果输出 `False` 或 `no cuda`，请在 `.venv_paddle_gpu` 中按 PyTorch 官网选择 CUDA 版本重新安装 GPU 版 `torch` 后再启动 GPU 模式。

## 模型文件

默认检测权重路径：

```text
models/weights/yolo-captcha-detector.pt
```

也可以用环境变量覆盖：

```powershell
$env:CNCAPTCHA_DETECTOR_PATH="D:\path\to\best.pt"
```

验证码识别模型从传统 CV、YOLO、GLM-OCR/VLM 标注、手搓排序模型到 PP-OCRv5 再到当前 PP-OCRv6（tiny 主 + medium 兜底）的开发历程见：

```text
docs/captcha_model_journey.md
```

## 常见问题

### 浏览器控制台报 "Permission was denied for ... loopback address space"（验证码偶尔不识别）

Chrome 130+ 启用了 **Local Network Access**（LNA）策略，会拦截公网 HTTPS 页面（`bigmodel.cn`）对本机 loopback（`localhost:8888`）的 `fetch` 请求。脚本里已经做了双通道兜底（`fetch` 失败时切到 Tampermonkey 的 `GM_xmlhttpRequest`），但在某些 Chrome 配置下扩展通道也会受影响，导致验证码偶发不识别。

**根治办法（任选其一）**：

1. **关 LNA 强制策略**（推荐，本机自用绝对安全）：地址栏访问
   ```
   chrome://flags/#block-insecure-private-network-requests
   ```
   设为 **Disabled**，重启 Chrome。这是把 Chrome 早期的 PNA/LNA 强约束关掉，让 `fetch` 直通 `localhost`。
2. **改用 Edge 或 Firefox**：Edge 跟进 LNA 较慢，Firefox 没有同等策略，开箱即用。
3. **配 HTTPS + 信任自签证书**：高阶用法，本仓库暂不内置脚本。

注意区分这条红字和「后端没启动」：先在 PowerShell 跑 `curl http://localhost:8888/health`，能拿到 JSON 就说明后端没问题，红字是浏览器策略，按上面三选一。

### 识别结果或点击位置像是错位、滞后一张图？

先刷新一下浏览器页面，再重新打开验证码测试。验证码弹窗刷新、页面状态缓存、多窗口切换或浏览器缩放状态异常时，前端显示和后端识别可能短暂不同步。

### 后端窗口红字报错怎么办？

优先确认你下载的是最新版 Release 包。如果是在线安装包，第一次启动需要联网下载环境；`portable-cpu` 会减少模型/缓存下载，但仍必须在用户自己的电脑上创建 Python venv。Windows venv 不能直接从打包机复制，否则可能指向打包机的 Python 路径。

### 优惠活动从哪里进入？

推荐打开 GLM Coding 页面后由脚本自动补上内置优惠入口：

👉 https://www.bigmodel.cn/glm-coding

### GPU 版不支持 RTX 50 系？

RTX 50 系（Blackwell 架构，如 5070/5080/5090）**暂时不支持 GPU 模式**。原因：

- GPU 依赖 `paddlepaddle-gpu` + `nvidia-*-cu11`（CUDA 11.8）+ `cudnn 8.9`
- RTX 50 系**最低需要 CUDA 12.8 + cuDNN 9.x**，CUDA 11.8 不含 Blackwell 的 PTX，GPU 推理会失败或回退 CPU

**解决方案**：RTX 50 系用户用 CPU 模式即可（`one-click-start.cmd` 会自动选 CPU），PP-OCRv6 在 CPU 上约 110ms/张，完全够用。等 `paddlepaddle-gpu` 发布支持 CUDA 12.8 的版本后会更新。

### GPU 模式报错 / GPU 没用上？

确认以下几点：

1. `.venv_paddle_gpu` 里装的是 **GPU 版 `paddlepaddle-gpu`**（不是 CPU 版 `paddlepaddle`）
2. `.venv_paddle_gpu` 里的 **`torch` 也是 GPU 版**（`torch.cuda.is_available()` 返回 `True`）。YOLO/Ultralytics 依赖 `torch`；如果 `torch` 是 CPU 版，YOLO 会走 CPU 即使 paddle 是 GPU 版
3. 显卡驱动版本要 **匹配 CUDA 版本**（当前项目用 CUDA 11.8）

检查命令：

```powershell
.\.venv_paddle_gpu\Scripts\python.exe -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no cuda')"
```

如果输出 `False` 或 `no cuda`，请按 [PyTorch 官网](https://pytorch.org/get-started/locally/) 选择 CUDA 版本重新安装 GPU 版 `torch`。

### CPU 模式识别速度慢？

如果识别一张验证码超过 2 秒，确认下载的是**最新版 Release 包**。旧版本（2026-06-22 之前）使用 PP-OCRv5 server（约 1189ms/张），新版本升级到 PP-OCRv6 tiny（约 110ms/张，快约 11 倍）。379 张真实验证码测试准确率仍为 100%。

## 致谢

本项目的油猴前端脚本是在 Greasy Fork 用户 `mumumi` 的《GLM Coding Plan抢购助手》基础上二次开发而来：

https://greasyfork.org/zh-CN/scripts/572157-glm-coding-plan%E6%8A%A2%E8%B4%AD%E5%8A%A9%E6%89%8B

感谢原作者长期维护和分享。原脚本采用 GNU GPLv3 许可证；本仓库继续保留相同许可证声明，并在其基础上增加本地 CPU/GPU OCR 后端、自动验证码识别和开源部署脚本。

## 许可证

本项目基于 GNU GPLv3 发布。油猴脚本基于 Greasy Fork 用户 `mumumi` 的 GPLv3 脚本二次开发，继续保留相同许可证。

## 说明

本项目用于本地 OCR、自动化辅助和技术研究。请遵守目标网站服务条款和当地法律法规，自行承担使用风险。

## 附录：OCR 方案对比

下面是本项目在本地数据上的阶段性对比结果。判定口径为：点选验证码中 3 个提示字都点到正确位置，才算 1 张图片识别成功。

### 小样本隐藏集

隐藏集包含 33 张未参与训练的真实验证码图。

| 阶段 | 方案 | 准确率 | 速度 | 说明 |
| --- | --- | ---: | ---: | --- |
| 1 | 裸 `ddddocr default/old` | `4/33 = 12.1%` | `7.3ms/裁剪字符` | 速度很快，但直接用于本验证码不够 |
| 2 | 裸 `ddddocr beta` | `6/33 = 18.2%` | `7.9ms/裁剪字符` | 比 default 略好，但仍不能直接用 |
| 3 | `glm-coding-grabber` 原样管道 | `24/33 = 72.7%` | `156ms/张` | 原项目默认只扫 macOS 字体，Windows 下会退化 |
| 4 | `glm-coding-grabber` 完整管道 + Windows 字体 | `33/33 = 100%` | `250ms/张` | 轻量、快速，补齐字体后效果明显提升 |
| 5 | 本项目 PP-OCRv5 mobile 裸识别 | `26/33 = 78.8%` | `624ms/裁剪字符` | 单独识别仍不够稳定 |
| 6 | 本项目 PP-OCRv5 mobile + 提示字约束 | `32/33 = 97.0%` | 同上 | 接近可用 |
| 7 | 本项目 PP-OCRv5 server 裸识别 | `28/33 = 84.8%` | `706ms/裁剪字符` | 比 mobile 更准，但更重 |
| 8 | 本项目 PP-OCRv5 server + 提示字约束 | `33/33 = 100%` | 同上 | 隐藏集满分 |
| 9 | 本项目 CPU hybrid logits constrained | `33/33 = 100%` | warm `761ms/张` | 当前默认稳定方案 |
| 10 | **本项目 PP-OCRv6 tiny + 提示字约束** | **`33/33 = 100%`** | **`~30ms/张`** | **当前默认，比 v5 快 20 倍+** |

### 压力测试集

压力测试使用本地 `glm_ocr_labels_all.json` 中 `has_error=false` 的 379 张可用标注图，统一按 35px 点击半径判定。

| 方案 | 准确率 | 平均速度 | 特点 |
| --- | ---: | ---: | --- |
| `glm-coding-grabber` 完整管道 + Windows 字体 | `363/379 = 95.8%` | `257ms/张` | 更轻、更快，但大样本下仍有失败 |
| 本项目 PP-OCRv5 server + YOLO + 提示字约束（旧） | `379/379 = 100%` | `1189ms/张` | 稳定，但慢 |
| **本项目 PP-OCRv6 tiny + YOLO + 提示字约束（当前）** | **`379/379 = 100%`** | **`110ms/张`** | **稳定，且比 v5 server 快约 11 倍**；tiny 主路径 + v6 medium 兜底，379 张实测 0% 兜底触发 |

> 上述 v6/v5 数据为同条件单进程端到端实测（AMD Ryzen 5 3600，含 YOLO 检测 + OCR + 提示字约束排序，35px 点击半径判定）。实际部署用多 worker 并行，速度更快。

更严格点击半径下的压力测试结果（v5 旧管道数据，v6 在各半径下同为 100%）：

| 点击半径 | `glm-coding-grabber` 完整管道 | 本项目 PP-OCRv5 server | 本项目 PP-OCRv6 tiny |
| ---: | ---: | ---: | ---: |
| 10px | `339/379 = 89.4%` | `379/379 = 100%` | `379/379 = 100%` |
| 15px | `359/379 = 94.7%` | `379/379 = 100%` | `379/379 = 100%` |
| 20px | `362/379 = 95.5%` | `379/379 = 100%` | `379/379 = 100%` |
| 25px | `363/379 = 95.8%` | `379/379 = 100%` | `379/379 = 100%` |
| 35px | `363/379 = 95.8%` | `379/379 = 100%` | `379/379 = 100%` |

结论：轻量 `ddddocr` 管道的优势是体积小，适合作为备用模式；本项目当前 PP-OCRv6 tiny + YOLO + 提示字约束方案在准确率（100%）、速度（~110ms/张）和稳定性上均优于 v5，tiny 主路径快、v6 medium 兜底准确。


