# 修复历史

## 2026-06-21

- 发布用户脚本 v23.2：修复腾讯验证码“换图不换题”场景下 OCR 只触发一次的问题。`captchaSession` 现在同时记录 `payloadText` 和 `bgUrl`，背景图变化时也会复位发送锁。
- 发布用户脚本 v23.1：修复 v23.0 准备态误用支付报警的问题。发现可购但自动点击订阅关闭时，只显示底部“请手动点击或按 F9 开启”，不再弹红框和“请立即扫码支付”；支付报警仅保留给真实支付弹窗。
- 发布用户脚本 v23.0：新增独立启动状态条，主页面一加载就显示准备态、`F9`/`F8` 操作提示，并异步检查 `127.0.0.1:8888/health`，显示本地 OCR 后端已连接或未连接；状态条提前到扫描主流程之前创建，避免页面看不到任何提示。
- 发布用户脚本 v22.9：新增明确的准备态状态栏。脚本加载后会提示“准备中：默认不主动点击订阅，按 F9 开启，或等待 Rush 目标时间”；发现可购时也不再显示“即将点击”，避免误导用户以为会提前进入购买链路。
- 发布用户脚本 v22.8：自动点击订阅改为默认关闭，并迁移旧配置为关闭；脚本加载后只观察和提醒，不会主动进入购买链路。只有用户显式开启自动点击（配置面板或 `F9`）或 Rush mode 目标时间已到，才会自动点击订阅。
- 发布用户脚本 v22.7：快捷键默认从 `Alt+Shift+P/A` 改为外挂工具更常见且更少冲突的 `F8/F9`，并在配置面板新增快捷键自定义和说明。
- 发布用户脚本 v22.6：新增快捷键 `Alt+Shift+P` 暂停/恢复脚本，暂停时主页面扫描/订阅点击和验证码 iframe 自动点字/确认都会停止；新增 `Alt+Shift+A` 快速切换自动点击订阅。
- 发布用户脚本 v22.5：修正 v22.4 的释放提前量方向，改为保守发射公式 `max(0, RTT/2 - 20ms)`，确保本地发射不早于预测安全点，也不晚于 10:00 目标时间；校准失败时不提前，10:00 整释放。
- 发布用户脚本 v22.4：冲刺模式默认目标从 `09:59:58` 改为 `10:00:00`，并把旧默认配置自动迁移到 10 点整。
- 冲刺模式释放验证码“确定”时不再使用固定 40ms 提前量；页面会用 3 次 BigModel same-origin 请求估算 RTT。用户手动设置 `RUSH_RELEASE_ADVANCE_MS > 0` 时仍优先使用手动值。

## 2026-06-15

- 发布用户脚本 v22.3：修复 issue #24 反馈的冲刺模式提前发请求问题。开启冲刺模式后，目标时间窗口外不再自动点击订阅；如果验证码被提前打开，也不会在窗口外自动点击“确定”。
- 修复 portable CPU 包误带打包机 Windows venv 的问题：发布包不再复制 `.venv_paddle`，首次运行会在用户电脑上创建/修复本地环境。
- 启动器会识别旧包里指向打包机路径（例如 `C:\Users\17336\...`）或搬家后的 venv，并强制重建，避免继续使用不可迁移环境。
- 发布用户脚本 v8.19：黄金时间从 9:30-10:10 延长到 9:30-11:00，覆盖中午还在补货的窗口（用户反馈 10:30 之后仍有成功下单）。
- 黄金时间内的 `MAX_RL` 无上限重试逻辑同步覆盖 9:30-11:00 全段。
- 发布用户脚本 v8.20：合并 PR #17（danny0119 提交）
  - 新增**抢购模式**（`RUSH_ENABLED` + HH:MM:SS 定点卡点确认），默认关闭，不影响现有用户
  - 修复 `tabEl` 1-index → 0-index BUG（原来 `tabEl(1)` 拿到第二个 tab）
  - 修复 `findAndClickConfirm` 误点支付按钮（移除 `.pay-dialog button.el-button--primary` 等选择器）
  - 削弱"绝对安全锁"：`everSucceeded && PS.bizId` 替代纯 `everSucceeded`，允许 stale 成功后清理
- 合并 PR #10（danny0119 提交）：新增 `backend/` FastAPI 并发流水线后端
  - YOLO detector + PP-OCRv5 recognizer 两段流水线，按 CPU 核数自动分配 worker
  - 每个 worker 独立进程，绑定物理核心消除 GIL 争抢（Linux 生效，Windows 是 no-op）
  - `python backend/server.py` 启动，3-level mp.Queue 传递裁切结果
  - `/health` 端点区分 starting/ok + ready_workers/alive_workers 计数
  - 冷启动 24s → 7.6s → 2.6s（16-core SSD，磁盘预热 + non-blocking lifespan）
  - ⚠️ 此为可选后端，原 `scripts/tools/` 启动方式仍可用
- 合并 PR #11（danny0119 提交）：pipeline 后端双击启动器
  - `start-backend-pipeline.cmd` 双击启动入口
  - `start-backend-pipeline.ps1` venv 自动检测（`venv/` 或 `.venv_paddle/`）+ 依赖检查（fastapi/uvicorn/psutil）+ 缺失时自动 pip install
  - 端口占用**中文提示**（含 PID/进程名/命令行），杀进程前需用户确认
  - 启动命令：双击 `start-backend-pipeline.cmd` 或 `pwsh start-backend-pipeline.ps1`
- 修复 `start-backend-pipeline.ps1` 在 Windows PowerShell 5.1 中文系统下的 ParserError（缺少 UTF-8 BOM），加 EF BB BF 前缀即可
- 新增 Pipeline GUI 启动器 `start-backend-pipeline-gui.cmd`
  - `backend/gui.py` Tk 窗口，弹窗实时显示系统状态、worker 就绪、最近 20 条识别结果、后端 stdout 日志
  - GUI 拉起 `backend.server` 子进程并接管 stdout，关闭窗口时自动 terminate 后端
  - 后端新增 `GET /recent?limit=20` 端口返回最近 N 条识别结果（prompt / pred_text / confidence / yolo_ms / ocr_ms / req_id）
  - `/health` 同步返回 `n_yolo` / `n_ocr` / `port` 字段，GUI 可显示流水线拓扑
  - 启动：`start-backend-pipeline-gui.cmd`（含 UTF-8 BOM，PS 5.1 兼容）
- 精简根目录启动器：删除 `start-backend.cmd` / `start-backend-pipeline.cmd` / `install-env.cmd` / `启动后端.cmd` / `首次安装环境.cmd`，只保留 2 个 .cmd
  - `one-click-start.cmd` — 首次安装环境
  - `start-backend-pipeline-gui.cmd` — 日常启动 + 弹 GUI 窗口
- 发布用户脚本 v8.21：高级模式（默认关闭）+ 经典模式自带 ±20% 抖动
  - 经典模式（v8.20 行为 + 抖动）：验证码点字间隔 220ms±20%、限流重试间隔 80ms±20%（实际 tick 80ms → 64-96ms）
  - 高级模式开启后露出 2 个数字输入框：**验证码点击间隔**（默认 220ms）和**限流重试间隔**（默认 1000ms）
  - 所有延迟都自动加 ±20% 随机抖动，经典和高级都有，避免 RPM 风控识别
  - 限流重试时新引入 `WAITING_RL` 中间态，避免等待期间空跑导致重复点
- v8.21.1：黄金时间（9:30-11:00）首次进入时弹紫色条提示用户**试试无痕窗口**（`Ctrl+Shift+N`），消除隐形风控标记。`sessionStorage` 去重，同一标签页每天只弹一次。
- v8.21.2：**紧急修复死循环发验证码**。
  - v8.21 的 `jitterDelay()` 顶层 `function` 在某些浏览器/Tampermonkey 缓存场景下闭包内报 `ReferenceError: jitterDelay is not defined`，导致 `handleCaptchaDirectInPage` 抛异常 → `captchaSent = false` → `setInterval(checkCaptchaPrompt, 50)` 每 50ms 重发一次验证码
  - **inline 抖动逻辑到调用点**，去掉 helper 依赖。同时给数字字段加了 `Number(...) || 默认值` 兜底，防止配置污染产生 NaN 导致 `setTimeout(NaN)` 立即触发
  - 现象：`ReferenceError: jitterDelay is not defined` + captcha 弹窗上一个 marker 被反复点到 `(-9992,-10029)` 这种坏坐标
- v8.21.3：**根因修复死循环**（v8.21.2 只修了表层 jitterDelay 引用错误，实际还残留 CFG undefined）。
  - 真正根因：v8.21 在 captcha IIFE 内（line 1812）直接引用了 `CFG.CAPTCHA_CLICK_DELAY`，但 captcha IIFE 是独立闭包，没有 `CFG` 变量。后端响应成功 → 走到 click loop → `Number(CFG.CAPTCHA_CLICK_DELAY)` 抛 `ReferenceError: CFG is not defined` → catch 块重置 `captchaSent=false; lastCaptchaText=''` → 下一 50ms tick 把同一张图重新发给后端，无限循环
  - **不再在 captcha IIFE 内引用 `CFG`**，改在 IIFE 顶部通过 `GM_getValue('glm_coding_config_v5')` 读 `CAPTCHA_CLICK_DELAY` / `RL_RETRY_DELAY`（主 IIFE 配置面板写入的同一个 key），预计算 `_clickDelay` / `_rlDelay` 常量
  - 错误处理从"立即重置"改为"30 秒冷却"：catch 块设 `window.__glmCaptchaCooldownUntil = Date.now() + 30000`，`checkCaptchaPrompt` 起手检查冷却中直接 return。即使后续真的出现其它异常，30 秒内同一张图不会再重发
  - 现象：用户 console 报 `ReferenceError: CFG is not defined at handleCaptchaDirectInPage (...:1812:35)`，同一张验证码被反复 POST 到 `/captcha_direct`

## 2026-06-06

- 修复 Win11 用户启动后端时报 `ModuleNotFoundError: No module named 'PIL'` 的问题。
- `start-backend.cmd` 现在会先走一键启动环境检查，不再绕过依赖修复流程直接启动后端。
- 当 `.venv_paddle` / `.venv_paddle_gpu` 已存在但核心库导入失败时，会自动重建对应环境，覆盖旧 portable 包虚拟环境不完整或不可迁移的情况。
- 后端启动前的主 Python 检查从只检查 `ultralytics` 扩展到 `ultralytics, PIL, cv2, numpy`，避免选中半损坏环境。
- 发布 `v2026.06.06-1749`，重新打包 online installer 和 portable CPU 包，并在 GitHub issue #7 回复新版本链接。

## 2026-05-29

- 发布用户脚本 v8.13，增强售罄状态判断的稳定性。
- 黄金时间保护从 9:50-10:10 前移到 9:30-10:10，覆盖提前进场用户。
- 今日售罄缓存不再直接让脚本停止；即使缓存显示全售罄，也会重新扫描确认。
- 非黄金时间连续 3 轮未发现可买或补货时间后，脚本进入低频重试，不再弹出“脚本停止”。
- 单个套餐需要连续 2 次确认售罄后才写入今日售罄缓存，降低页面文案或接口短暂变化导致的误停概率。
- 发布用户脚本 v8.14：打开普通 GLM Coding 页面时会自动归一化到作者内置折扣入口，并保留多窗口参数。
- 发布用户脚本 v8.15：折扣入口强制使用 `https://www.bigmodel.cn/glm-coding`，并在主循环前重复确认 `ic` 参数，避免页面中途清掉参数后继续抢购。

## 2026-05-27

- 修复宽屏窗口下腾讯验证码弹窗偏左时，后端找不到弹窗并提示
  `no modal after ... attempts` 的问题。
- 后端现在接受更靠左的弹窗候选，同时保留原有的宽度和频次过滤，避免误裁。
- 已用 1942x1042 的 Chrome 截图验证：偏左验证码可以被正确裁剪并识别。
