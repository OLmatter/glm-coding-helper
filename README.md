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

现在普通用户不需要手动装 Python、不需要自己跑 PowerShell 安装命令。最简单的方式是：

1. 下载 Release 压缩包
2. 解压
3. 安装油猴脚本
4. 双击启动后端
5. 打开 GLM Coding Plan 页面

### 1. 下载压缩包

到 Releases 页面下载：

https://github.com/OLmatter/glm-coding-helper/releases

推荐二选一：

| 文件 | 适合谁 | 说明 |
| --- | --- | --- |
| `glm-coding-helper-portable-cpu-*.zip` | 想解压即用的人 | 自带 CPU 后端环境，体积较大，解压后直接双击启动 |
| `glm-coding-helper-online-installer-*.zip` | 网络正常、想下载小包的人 | 小包，首次启动会自动下载并安装 CPU/GPU 环境 |

不知道选哪个，就下载 `portable-cpu`。

### 2. 解压

把 zip 解压到一个普通目录，例如：

```text
D:\Tools\glm-coding-helper
```

路径里有中文通常也可以。如果遇到环境安装失败，优先换到纯英文路径再试。

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

如果下载的是自带环境包：

```text
start-backend.cmd
```

如果下载的是在线安装包：

```text
one-click-start.cmd
```

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
2. 下载并解压 Release 包，双击 `start-backend.cmd` 或 `one-click-start.cmd` 启动本地后端。
3. 打开 GLM Coding 页面测试脚本是否正常，脚本会自动补上内置优惠入口。
4. 每天 9 点 30 分前进入抢购页面准备，晚了可能就打不开了。提前准备好手机支付宝付款。
5. 多开几个窗口，等快到 10 点的时候点击好验证码但不要确定，等 10 点一到再按确定。并发窗口不要开得过多，建议先从 2-4 个窗口开始；过高并发可能触发平台限流或风控。
6. 如果这波没抢到，就盯着一个窗口用 OCR 识别点击。默认不会自动关闭支付页面。注意：如果看到没有金额的支付页面，那就是没抢到，要关掉继续抢。这时可以使用快捷键快速操作。

### 快捷键

- `Esc`：关闭系统繁忙弹窗或支付弹窗
- `Enter` / `Space`：点击验证码确认按钮

### 重要提醒

- 默认会自动识别验证码并点击目标文字。
- 默认不会自动点击验证码“确定”按钮，需要在配置面板里手动开启。
- 默认不会自动关闭无效支付链接或限流弹窗，需要在配置面板里手动开启。
- 遇到真正有金额的支付二维码，请自行确认后再扫码支付。
- 多窗口并发不是越多越好。窗口过多、请求过密可能触发平台限流、验证码升级或账号风控，请根据自己的网络和账号情况保守设置。
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

默认配置比较保守：脚本会帮你识别并点选验证码文字，但不会替你按验证码“确定”。

## 验证码识别说明

当前验证码流程是：

1. 油猴脚本直接从腾讯验证码组件中抓取原图。
2. 原图发送到本地后端 `/captcha_direct`。
3. 后端使用本地 YOLO + PaddleOCR 识别。
4. 脚本按识别坐标点击文字。

验证码图片不会上传到第三方识别服务。

### 并发流水线架构（Lite 版）

`backend/` 目录提供了一种可选的并发流水线后端，通过多进程流水线提升 CPU 多核利用率：

- **YOLO → OCR 两段流水线**：YOLO worker 检测字符位置、裁切 → OCR worker 识别单个文字
- **按 CPU 核数自动分配 YOLO/OCR worker**（可通过 `config.json` 手动调整）
- 每个 worker 绑定独立物理核心，消除 GIL 争抢
- 队列传递裁剪结果，零序列化开销

启动：
```powershell
python backend/server.py
```

## 常用文件

| 文件 | 用途 |
| --- | --- |
| `glm-coding-helper.user.js` | 给 Tampermonkey 安装的主脚本 |
| `start-backend.cmd` | 启动已有本地后端环境 |
| `one-click-start.cmd` | 自动安装环境并启动 |
| `install-env.cmd` | 手动安装 CPU 后端环境 |
| `scripts/` | 后端和打包脚本 |
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

验证码识别模型从传统 CV、YOLO、GLM-OCR/VLM 标注、手搓排序模型到 PP-OCRv5 的开发历程见：

```text
docs/captcha_model_journey.md
```

## 常见问题

### 识别结果或点击位置像是错位、滞后一张图？

先刷新一下浏览器页面，再重新打开验证码测试。验证码弹窗刷新、页面状态缓存、多窗口切换或浏览器缩放状态异常时，前端显示和后端识别可能短暂不同步。

### 后端窗口红字报错怎么办？

优先确认你下载的是最新版 Release 包。如果是在线安装包，第一次启动需要联网下载环境；如果网络不稳定，建议换 `portable-cpu` 自带环境包。

### 优惠活动从哪里进入？

推荐打开 GLM Coding 页面后由脚本自动补上内置优惠入口：

👉 https://www.bigmodel.cn/glm-coding

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

### 压力测试集

压力测试使用本地 `glm_ocr_labels_all.json` 中 `has_error=false` 的 379 张可用标注图，统一按 35px 点击半径判定。

| 方案 | 准确率 | 平均速度 | 特点 |
| --- | ---: | ---: | --- |
| `glm-coding-grabber` 完整管道 + Windows 字体 | `363/379 = 95.8%` | `257ms/张` | 更轻、更快，但大样本下仍有失败 |
| 本项目当前 CPU 管道 | `379/379 = 100%` | `851ms/张` | 更慢、更大，但稳定性更好 |

更严格点击半径下的压力测试结果：

| 点击半径 | `glm-coding-grabber` 完整管道 | 本项目当前 CPU 管道 |
| ---: | ---: | ---: |
| 10px | `339/379 = 89.4%` | `379/379 = 100%` |
| 15px | `359/379 = 94.7%` | `379/379 = 100%` |
| 20px | `362/379 = 95.5%` | `379/379 = 100%` |
| 25px | `363/379 = 95.8%` | `379/379 = 100%` |
| 35px | `363/379 = 95.8%` | `379/379 = 100%` |

结论：轻量 `ddddocr` 管道的优势是体积小、速度快，适合作为快速模式或备用模式；本项目当前 PP-OCRv5 + YOLO + 提示字约束方案的缺点是慢、环境大，但在本地隐藏集和压力测试中稳定性更好。
