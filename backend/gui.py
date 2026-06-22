"""
Pipeline Backend GUI - Tk 监控面板

启动 backend.server 子进程，捕获 stdout 写入日志框；
定期拉取 /health 和 /recent，实时显示在状态栏和识别列表里。
"""
import os
import sys
import json
import queue
import threading
import subprocess
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
from collections import deque
import tkinter as tk
from tkinter import ttk

if getattr(sys, "frozen", False):
    ROOT = Path(sys._MEIPASS)
else:
    ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# ── 配置 ───────────────────────────────────────────────
BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = int(os.environ.get("CNCAPTCHA_PORT", "8888"))
BACKEND_URL = f"http://{BACKEND_HOST}:{BACKEND_PORT}"
POLL_HEALTH_MS = 1000
POLL_RECENT_MS = 500
MAX_LOG_LINES = 500
MAX_RECENT_SHOWN = 20
BACKEND_SHUTDOWN_TIMEOUT = 30

# 颜色
BG = "#f0f2f5"
FG_NORMAL = "#262626"
FG_SUCCESS = "#52c41a"
FG_WARN = "#faad14"
FG_ERROR = "#ff4d4f"
FG_INFO = "#1890ff"
FG_GREY = "#8c8c8c"


def _platform_fonts() -> tuple[str, str]:
    """返回 (UI 字体, 等宽字体)，按系统选择以保证中文可读。"""
    if sys.platform == "darwin":
        return "PingFang SC", "Menlo"
    return "Microsoft YaHei UI", "Consolas"


UI_FONT, MONO_FONT = _platform_fonts()

state = {
    "backend_proc": None,
    "log_queue": queue.Queue(),
    "log_lines": deque(maxlen=MAX_LOG_LINES),
    "recent_results": deque(maxlen=MAX_RECENT_SHOWN),
    "last_seen_req_id": 0,
    "health": {"status": "starting", "ready_workers": 0, "alive_workers": 0,
               "workers": 0, "n_yolo": 0, "n_ocr": 0, "port": BACKEND_PORT},
    "port": BACKEND_PORT,
}


def _read_proc_stdout(proc: subprocess.Popen):
    """后台线程：读子进程 stdout/stderr，写入 log_queue"""
    for stream in (proc.stdout, proc.stderr):
        if stream is None:
            continue
        try:
            for line in iter(stream.readline, b""):
                try:
                    text = line.decode("utf-8", errors="replace").rstrip("\r\n")
                except Exception:
                    text = str(line)
                if text:
                    state["log_queue"].put(text)
        except Exception:
            pass


def _http_get_json(path: str, timeout: float = 1.0):
    try:
        with urllib.request.urlopen(BACKEND_URL + path, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, ConnectionError, OSError, json.JSONDecodeError):
        return None


def _format_ts(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%H:%M:%S")


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("GLM Coding Captcha - Pipeline Backend")
        self.root.geometry("720x600")
        self.root.configure(bg=BG)
        self.root.minsize(640, 480)

        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TLabel", background=BG, font=(UI_FONT, 10))
        style.configure("Status.TLabel", font=(UI_FONT, 12, "bold"))
        style.configure("Big.TLabel", font=(UI_FONT, 14, "bold"))
        style.configure("Ok.TLabel", foreground=FG_SUCCESS, font=(UI_FONT, 11, "bold"))
        style.configure("Warn.TLabel", foreground=FG_WARN, font=(UI_FONT, 11, "bold"))
        style.configure("Err.TLabel", foreground=FG_ERROR, font=(UI_FONT, 11, "bold"))
        style.configure("Info.TLabel", foreground=FG_INFO, font=(UI_FONT, 11, "bold"))

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self._start_backend()
        self.root.after(100, self._poll_logs)
        self.root.after(POLL_HEALTH_MS, self._poll_health)
        self.root.after(POLL_RECENT_MS, self._poll_recent)

    def _build_ui(self):
        # 顶部状态栏
        top = ttk.Frame(self.root, padding="12 10")
        top.pack(fill=tk.X)

        ttk.Label(top, text="智谱 GLM 验证码后端 (Pipeline)", style="Big.TLabel").grid(
            row=0, column=0, columnspan=4, sticky=tk.W, pady=(0, 8))

        # 第一行：系统状态
        ttk.Label(top, text="系统状态:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.lbl_status = ttk.Label(top, text="启动中…", style="Warn.TLabel")
        self.lbl_status.grid(row=1, column=1, sticky=tk.W, pady=2)

        # 第二行：worker 就绪
        ttk.Label(top, text="Workers:").grid(row=2, column=0, sticky=tk.W, pady=2)
        self.lbl_workers = ttk.Label(top, text="0/0")
        self.lbl_workers.grid(row=2, column=1, sticky=tk.W, pady=2)
        ttk.Label(top, text="YOLO / OCR:").grid(row=2, column=2, sticky=tk.W, padx=(20, 4), pady=2)
        self.lbl_pipeline = ttk.Label(top, text="-/-")
        self.lbl_pipeline.grid(row=2, column=3, sticky=tk.W, pady=2)

        # 第三行：端口 / 地址
        ttk.Label(top, text="监听:").grid(row=3, column=0, sticky=tk.W, pady=2)
        self.lbl_url = ttk.Label(top, text=f"{BACKEND_URL}", style="Info.TLabel")
        self.lbl_url.grid(row=3, column=1, columnspan=3, sticky=tk.W, pady=2)

        # 中间：最近识别结果
        mid = ttk.LabelFrame(self.root, text="最近识别结果（最新在上）", padding="8")
        mid.pack(fill=tk.BOTH, expand=True, padx=12, pady=(4, 4))

        cols = ("time", "prompt", "pred", "conf", "ms", "yolo", "ocr", "req")
        self.tree = ttk.Treeview(mid, columns=cols, show="headings", height=8)
        for col, w, anchor in [
            ("time", 70, tk.W), ("prompt", 90, tk.W), ("pred", 110, tk.W),
            ("conf", 60, tk.E), ("ms", 60, tk.E), ("yolo", 60, tk.E),
            ("ocr", 60, tk.E), ("req", 60, tk.E),
        ]:
            self.tree.heading(col, text=col.upper())
            self.tree.column(col, width=w, anchor=anchor)
        self.tree.tag_configure("ok", foreground=FG_SUCCESS)
        self.tree.tag_configure("err", foreground=FG_ERROR)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        sb = ttk.Scrollbar(mid, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        sb.pack(side=tk.RIGHT, fill=tk.Y)

        # 底部：实时日志
        bot = ttk.LabelFrame(self.root, text="后端日志（stdout）", padding="6")
        bot.pack(fill=tk.BOTH, expand=False, padx=12, pady=(0, 8))
        self.log_box = tk.Text(bot, height=10, font=(MONO_FONT, 9),
                               bg="#1e1e1e", fg="#d4d4d4", insertbackground="#d4d4d4",
                               relief=tk.FLAT, wrap=tk.NONE)
        self.log_box.tag_configure("info", foreground="#d4d4d4")
        self.log_box.tag_configure("ready", foreground=FG_SUCCESS)
        self.log_box.tag_configure("warn", foreground=FG_WARN)
        self.log_box.tag_configure("err", foreground=FG_ERROR)
        self.log_box.tag_configure("ts", foreground=FG_GREY)
        self.log_box.configure(state=tk.DISABLED)
        self.log_box.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        log_sb = ttk.Scrollbar(bot, orient=tk.VERTICAL, command=self.log_box.yview)
        self.log_box.configure(yscrollcommand=log_sb.set)
        log_sb.pack(side=tk.RIGHT, fill=tk.Y)

    def _append_log(self, line: str):
        state["log_lines"].append(line)
        ts = datetime.now().strftime("%H:%M:%S")
        # 着色：[architect] 蓝；worker ready 绿；含 ERROR/Exception/失败 红；含 WARN/⚠ 黄
        tag = "info"
        low = line.lower()
        if "worker ready" in low or "✓" in line or "就绪" in line or "warmed" in low:
            tag = "ready"
        elif "error" in low or "exception" in low or "traceback" in low or "fail" in low or "err:" in low:
            tag = "err"
        elif "warn" in low or "⚠" in line or "warning" in low:
            tag = "warn"
        elif line.startswith("[architect]"):
            tag = "info"

        self.log_box.configure(state=tk.NORMAL)
        self.log_box.insert(tk.END, f"[{ts}] ", "ts")
        self.log_box.insert(tk.END, line + "\n", tag)
        # 裁剪到 MAX_LOG_LINES
        line_count = int(self.log_box.index("end-1c").split(".")[0])
        if line_count > MAX_LOG_LINES:
            self.log_box.delete("1.0", f"{line_count - MAX_LOG_LINES}.0")
        self.log_box.see(tk.END)
        self.log_box.configure(state=tk.DISABLED)

    def _start_backend(self):
        """拉起 backend.server 子进程"""
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        cmd = [sys.executable, "-m", "backend.server"]
        self._append_log(f"$ {sys.executable} -m backend.server")
        try:
            proc = subprocess.Popen(
                cmd, cwd=str(ROOT), env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                bufsize=1,
            )
            state["backend_proc"] = proc
            threading.Thread(target=_read_proc_stdout, args=(proc,),
                             daemon=True).start()
        except Exception as e:
            self._append_log(f"FATAL: 启动后端失败: {e}")

    def _poll_logs(self):
        try:
            while True:
                line = state["log_queue"].get_nowait()
                self._append_log(line)
        except queue.Empty:
            pass
        self.root.after(100, self._poll_logs)

    def _poll_health(self):
        data = _http_get_json("/health")
        if data:
            state["health"] = data
            self._update_health_display(data)
        else:
            # 后端还没起来
            self.lbl_status.config(text="等待后端…", style="Warn.TLabel")
        self.root.after(POLL_HEALTH_MS, self._poll_health)

    def _update_health_display(self, h: dict):
        status = h.get("status", "starting")
        ready = h.get("ready_workers", 0)
        total = h.get("workers", 0)
        alive = h.get("alive_workers", 0)
        n_yolo = h.get("n_yolo", 0)
        n_ocr = h.get("n_ocr", 0)

        if status == "ok" and alive == total:
            self.lbl_status.config(text="● 运行中", style="Ok.TLabel")
        elif status == "starting":
            self.lbl_status.config(text="● 启动中", style="Warn.TLabel")
        else:
            self.lbl_status.config(text=f"● {status}", style="Warn.TLabel")

        self.lbl_workers.config(text=f"{ready}/{total} (alive={alive})")
        self.lbl_pipeline.config(text=f"{n_yolo} YOLO / {n_ocr} OCR")

    def _poll_recent(self):
        data = _http_get_json(f"/recent?limit={MAX_RECENT_SHOWN}")
        if data and "results" in data:
            self._update_recent_display(data["results"])
        self.root.after(POLL_RECENT_MS, self._poll_recent)

    def _update_recent_display(self, results: list):
        # 清空并重绘（识别结果最多 20 条，开销可接受）
        for iid in self.tree.get_children():
            self.tree.delete(iid)
        for item in results:
            ts = _format_ts(item.get("ts", 0))
            if item.get("success") is False:
                self.tree.insert("", tk.END, values=(
                    ts, "-", f"ERR: {item.get('error','?')}", "-", "-", "-", "-",
                    item.get("req_id", "-")
                ), tags=("err",))
                continue
            prompt = "".join(item.get("prompt", []))
            pred = item.get("pred_text", "")
            conf = f"{item.get('confidence', 0):.2f}"
            ms = f"{item.get('elapsed_ms', 0):.0f}"
            yolo = f"{item.get('yolo_ms', 0):.0f}"
            ocr = f"{item.get('ocr_ms', 0):.0f}"
            req = item.get("req_id", "-")
            tag = "ok" if prompt and pred and prompt == pred else ("err" if pred.startswith("ERR") else "ok")
            self.tree.insert("", tk.END, values=(
                ts, prompt, pred, conf, ms, yolo, ocr, req
            ), tags=(tag,))

    def on_close(self):
        proc = state.get("backend_proc")
        if proc and proc.poll() is None:
            try:
                proc.terminate()
                try:
                    # 后端会依次正常停止 YOLO 和 OCR worker；给它足够时间
                    # 避免父进程过早退出，再次强制终止 Paddle 子进程。
                    proc.wait(timeout=BACKEND_SHUTDOWN_TIMEOUT)
                except subprocess.TimeoutExpired:
                    proc.kill()
            except Exception:
                pass
        self.root.destroy()


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
