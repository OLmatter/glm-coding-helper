# 修复历史

## 2026-07-28

- 发布用户脚本 v23.13：405 风控识别 + 冷却减速机制（采纳 #48 / #51 作者 wang-zhuo996 的诊断）。preview 接口返回 405 = 阿里云 WAF 速率风控（响应是 HTML 拦截页不是 JSON）。原代码 fetch 拦截只判 body 里的 `d.code`，从不看 `r.status`，405 落入 else 分支被当 busy 处理——立即重试会越撞越多风控。现新增 `r.status === 405` 分支标记 `risk_control`，关弹窗后进入冷却期（默认 20 秒，可配置 `RISK_CONTROL_COOLDOWN_MS`），冷却期内状态栏显示剩余秒数、不点订阅，让 WAF 阈值下降再恢复抢。配置面板「自动关闭无效支付/限流弹窗」下方新增「405 风控冷却」输入框（0 = 不冷却）。
- 发布用户脚本 v23.12：更新 MiniMax Token Plan 邀请码，从 `IKhXTPYbQC` 改为 `KkI58QB9Ip`（`MINIMAX_CODE` 数组拆分 `['KkI','58QB','9Ip']`）。油猴菜单「打开 MiniMax Token Plan 优惠入口」和 minimax 订阅页 URL 自动注入同步换码。邀请码字符串只在 `initMiniMaxTokenPlanEntry` 函数内引用，未污染其他模块。

## 2026-07-16

- 启动脚本体验改进（不涉及油猴脚本，用户脚本版本仍为 v23.11）：
  - `one-click-start.ps1` 路径长度警告阈值从 70 降到 60（基于实测：`.venv_paddle` 最深路径 177 字符 + Root 60 = 238，留 22 字符给 pip 临时文件，避免撞 Windows MAX_PATH 260）；警告改中文。
  - `one-click-start.ps1` pip 失败分支主动检测当前路径长度，超过 60 时用中文加粗提示"路径偏长，建议移到短路径"，不再只显示通用英文。
  - `start_backend.ps1` 启动前检测 8888 是否被占，被占时提示占用进程的 PID/名称/路径（解决 `WinError 10013` 无头绪排查的问题）。
  - README 常见问题新增「pip 安装失败/路径太深」和「WinError 10013/端口被占」两条。

## 2026-07-09

- 发布用户脚本 v23.11：注释邀请码注入逻辑。原内置折扣入口对应的邀请码活动已下线，脚本每次打开页面仍会注入 `?ic=...&closedialog=true` 参数，导致页面尝试加载已不存在的邀请码活动页。现注释掉 `ensureDiscountEntry`、邀请码版 `GLM_CODING_URL`、`GLM_DISCOUNT_CODE` 常量、未登录注册的邀请码引导，`GLM_CODING_URL` 改为纯 `https://www.bigmodel.cn/glm-coding`。所有代码原样保留为注释，活动恢复时取消 4 处注释即可。同步更新 README、Greasy Fork 描述、userscripts README。
- 文档更新：README 和 Greasy Fork 描述移除「11:00 之前还有机会」的过时说法，改为说明官方近期几乎不放量、连「拼好模」活动也取消，整体很难抢到（非脚本问题，是官方供给侧收紧）。


## 2026-07-05

- 发布用户脚本 v23.10：新增「批量暂停/恢复」快捷键（默认 `Shift+F8`），解决 #45「多窗口一个个按 F8 太麻烦」。原 `F8` 单键行为完全不变，只切当前窗口；`Shift+F8` 切换当前窗口的同时，通过 Tampermonkey 的 `GM_addValueChangeListener` 广播到同浏览器其他 glm-coding 普通窗口，实现一键全暂停/全恢复。用独立的广播 key（`glm_runtime_pause_broadcast_v1`）与原持久化 key 分离，不干扰原 F8 的「新窗口继承暂停态」语义。覆盖范围：同浏览器普通窗口；无痕模式、跨浏览器受扩展隔离限制不支持。快捷键可在配置面板自定义。

## 2026-06-26

- 修复启动预热没预热到 OCR 的问题：预热本意是把 yolo+ocr 整条链路打热，避免首个验证码撞 JIT（5-8s）导致客户端超时丢点。但预热用白图兜底时 YOLO 检测到 0 个字框就提前 return，**OCR 子进程根本没被调用** → 第一个真验证码仍撞上 OCR JIT（实测 5795ms），期间客户端等不及、点字没点上。修复：`captcha_worker.py` 在 YOLO 非3 boxes 时若请求带 `force_ocr_warmup`，强制把图横切3块喂给 OCR 跑一次，确保 OCR 子进程完成 JIT 预热；`captcha_server.py` 预热调用传 `force_ocr_warmup=True`。实测预热日志现出现 `[ppocr-cpu-pool] workers=3 loaded` + `[worker] OCR warmup done`，证明 OCR 已在预热阶段加载。
- 发布用户脚本 v23.9：修复 #40「识别验证码后无法自动关闭无效支付界面」。根因是 `checkPayDialog` 决策函数只看接口返回（`busy`/`sold_out` 才关），接口返回 success/其它时一律 keep，导致**金额为空的无效支付页不会被关**——即使开了 `AUTO_CLOSE_INVALID` 也没用（该开关只在 verdict='close' 时生效）。修复：在接口非 busy/sold_out 的分支里读弹窗实际金额，有金额（真支付页）就 keep 并清计时；**无金额不立刻关**——GLM 有时会先显示无金额/没抢到、过约 1 秒才弹出真金额订单（#16/#40 反馈的时序），所以持续无金额超过 **1.7 秒宽限期**才判无效页 close。10 个单元测试覆盖：真支付页不误关 / 无金额 1s 后金额出现不误关 / 无金额 1.7s 关闭 / busy 直接关 / 弹窗消失重置计时。
- 发布用户脚本 v23.8：修复后端日志反复出现 `[captcha] FAIL: detected 0 boxes, need 3` 的问题。根因是 `isPointClickPrompt` 的兜底分支「3-8 个汉字即视为合法点选目标」太宽，把验证码容器的说明性文字（如 aria-label="验证码"、标题「安全验证」「图形验证码」「请点击图中文字」「点击进行验证」等）也判成了目标字，传给后端后 YOLO 在点选图里找不到「验」「证」「码」这些字 → detected 0 boxes，且因每分钟轮询会反复刷屏。修复：① `isPointClickPrompt`/`findPromptText` 加说明性文字黑名单（验证码/安全验证/图形验证/请点击/完成验证/进行验证/点击图中/点击进行）；② 收紧 in-page 的 `[aria-label]` 兜底选择器，限定在腾讯验证码容器内，避免抓到页面其它元素。真目标字（山水木/请依次点击）不受影响。
- 修复后端调试图片无限增长占满磁盘的问题：`/captcha_direct` 每次识别都把原图存到 `dataset/debug_captcha_direct/`，加上 `dataset/auto_captured/`（截屏）和 `logs/ppocr_live_crops/`（字裁剪图），三个目录都**没有任何清理**，长时间挂着抢会累积几百上千张。现改为两层清理：① **启动时清空**上次的调试图（重启即放弃旧图）；② **运行时滚动**保留最近 N 个（debug 60 / auto_captured 120 / crops 200），连挂几天不重启时兜底。这些目录纯属调试用途，对识别功能无影响。
- 发布用户脚本 v23.7：修复 rush 模式 10:00 到点不自动点验证码确定的问题。根因是 PR #36 的验证码熔断（防自激振荡）有两个缺陷：① `captchaSession.stopped` 一旦置 true 后全文件无任何重置路径（`resetCaptchaSession`/`noteCaptchaSuccess` 都漏清），用户 10:00 前提前开页面、后端没起好或网络抖动累积 3 次失败后，验证码流程被永久焊死，到点也不再识别 → 自然不点确定；② 失败计数跨所有图累计，但自激振荡只在「同一张图反复开火」时才发生。修复：失败计数绑定到 `bgUrl`（换图即重置 failCount/stopped）；rush 黄金窗口（到点后 `holdWindowMs` 内）失败只冷却不 hard-stop；`resetCaptchaSession` 和 `noteCaptchaSuccess` 补齐清 `stopped`/`failCount`/`failBgUrl`。保留了 PR #36 对「同一张图自激振荡」的熔断保护，只消除误伤 rush 窗口和永久不可逆两个副作用。15 个单元测试覆盖同图熔断/换图重置/rush 窗口不焊死/窗口外熔断可恢复等场景。
- 合并 PR #37（macOS 启动前校验后端 OCR 环境）：`one-click-start.command` 和 `start-backend-pipeline-gui.command` 启动时改为调用新增的 `scripts/check_backend_env.py`，除了 import 依赖，还会校验 `paddleocr/paddlex>=3.7.0` 版本下限，并验证默认 OCR 模型（`PP-OCRv6_tiny_rec`）在 `default_registry` 已注册，避免「能 import 但模型加载失败」被漏判而启动报错。`setup_backend_macos.sh` 安装末尾追加一次真实 `TextRecognition` 加载验证。
- 合并 PR #36（首请求冷启动优化 + Chrome LNA 绕过 + 验证码熔断）：
  - 后端启动时跑一次真推理预热 OCR 模型，避免首个验证码请求因 JIT 冷启动超时。
  - 用户脚本绕开 Chrome 130+ 的 Local Network Access（LNA）拦截：改用 `GM_xmlhttpRequest` 优先于 `fetch` 访问本地后端，不再依赖每次都要用户手动放行的 LNA 提示。
  - 验证码识别增加熔断：单张失败冷却 1.5s，连续 3 次失败停止，防止点字与识别之间的死循环自激振荡导致干等到超时。

## 2026-06-24

- 发布用户脚本 v23.6：识别「抢购人数过多，请刷新再试」按钮状态为不可点击。之前 `canBuy` 只拦截「售罄/补货/暂时」，按钮显示「抢购人数过多」「刷新再试」「请稍后」时仍会误判可点击并尝试点击，浪费请求。现在这些文字都加入拦截正则，看到就跳过继续等，不浪费点击。（#32）
- 修复 macOS/Linux 发布包 shell 脚本 CRLF 导致 `/bin/bash^M` 错误（#33）：加 `.gitattributes` 强制 `*.sh`/`*.command` 为 LF，打包脚本双保险（打包时强制 CRLF→LF）。
- 补充 macOS 安装文档 tkinter 说明：Homebrew Python 默认不带 tkinter，需 `brew install python-tk@3.12`；或用 python.org 官方安装包（自带 tkinter）。
- 新增 Linux 一键启动支持（PR #34）：`one-click-start.sh` + `scripts/setup_backend_linux.sh` + `scripts/pypi_mirror.sh`，复用 5 源镜像探测。

## 2026-06-23

- 发布用户脚本 v23.5：新增「首击前延时」配置。PP-OCRv6 识别太快（几十 ms），识别完瞬间点第一个字时验证码 DOM 可能还没完全渲染/动画到位，导致第一击落空。之前点击间延时只加在字与字之间，第一击前零等待。现在加可配置的首击前随机延时（默认 150-300ms），在配置面板「验证码点字延时策略」下方新增「首击前延时」最小/最大输入框，设为 0 则不等。
- 发布用户脚本 v23.4：彻底简化 WAITING 超时逻辑，删除所有验证码状态判断（captchaSeen/计数器/PS.inProgress 分支），兜底超时从 30 秒压到 10 秒。之前的多层判断有遗漏，少数场景会误判"验证码识别中"然后耐心等到 20-30 秒。现在回到最原始逻辑：点击后只看有没有结果（preview 响应/弹窗），10 秒没结果立即重试点订阅。10 秒兜底：正常识别（含老 CPU）5-8 秒够，超 10 秒就是卡住了。
- 发布用户脚本 v23.3：修复自动点击订阅后干等到 15 秒超时的问题。之前点击订阅后，若合成 click 事件没触发智谱前端弹验证码（按钮 DOM 已就绪但前端状态机还没准备好），主流程会一直停在 WAITING 干等到 `MODAL_WAIT=15000` 超时，浪费抢购黄金窗口。现在用"验证码 iframe 是否已拿到新 prompt+背景图"作为信号：iframe 脚本每次拿到新验证码（prompt 或背景图变化）时让 GM 计数器 `glm_captcha_seen_seq` 自增，主流程点击时记下基线，WAITING 阶段比对——计数器增长了说明验证码已弹出，耐心等识别；1.5 秒还没增长说明点击没触发验证码，立即回 IDLE 重试点订阅。计数器只增不减、无残留、无时序错乱。
- 修复 PS 5.1 中文系统下 `.ps1` 脚本 ParserError（"Missing expression after ','"）：所有 `.ps1` 加 UTF-8 BOM，避免 PS 5.1 按 GBK 解析 UTF-8 中文字节导致语法解析崩溃。
- 修复国内用户首次安装 backend 依赖时直连 PyPI 超时：`one-click-start.cmd` 默认走清华镜像（`https://pypi.tuna.tsinghua.edu.cn/simple`），可用 `-PipArg` 覆盖。
- 修复 portable CPU 包缺少 `requirements-backend-gpu.txt`：`Assert-RequiredFiles` 对所有包都要求两份 requirements 齐全，portable 之前缺 gpu 那份，首次运行报 `[FAIL] Release package is incomplete`。
- 修复打包生成的 zip 损坏：Windows bsdtar 的 `-a` 对 `.zip` 扩展名识别有 bug，改用 python zipfile 打包。

## 2026-06-22

- 后端 OCR 模型升级到 PP-OCRv6_tiny_rec（默认）。379 张真实验证码端到端测试：准确率仍 100%（379/379），单张耗时从 `PP-OCRv5_server_rec` 的约 1189ms 降到约 83ms（本机 AMD Ryzen 5 3600），快约 14 倍。i5-1340P 等大小核 CPU 上 8 秒/张的问题随之消除。模型可通过 `config.json` 的 `ocr_model` 或环境变量 `CNCAPTCHA_CPU_OCR_MODEL`/`GLM_OCR_MODEL` 覆盖。要求 `paddleocr>=3.7.0`。
- 修复 pipeline CPU 后端验证码识别变慢的问题：之前同一张验证码的 3 个裁剪字图会被同一个 OCR worker 串行识别，使用 `PP-OCRv5_server_rec` 时容易达到 2s+；现在 YOLO worker 将每个 crop 拆成独立 OCR 任务，server 收齐 partial 后再聚合坐标，多个 OCR worker 可并行处理同一张验证码。实测本机 5 张样本从约 2.0-2.3s 降到约 1.19-1.22s，仍使用原 server_rec 模型，不降低识别稳定性。

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
