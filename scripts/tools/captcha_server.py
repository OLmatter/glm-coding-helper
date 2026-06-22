from __future__ import annotations

import json
import os
import re
import base64
import time
import sys
import threading
import argparse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
try:
    import tkinter as tk
    from tkinter import ttk
except ImportError:
    tk = None
    ttk = None

sys.setswitchinterval(0.001)

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "scripts"
sys.path.append(str(SCRIPTS_DIR / "monitor"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts/tools"))

from backend_config import (
    add_backend_args,
    apply_backend_config,
    apply_cli_overrides,
    print_config,
    resolve_backend_config,
)

capture_browser_window = None
find_windows = None
if sys.platform == "win32":
    try:
        from window_helper import capture_browser_window, find_windows
    except (ImportError, AttributeError, OSError) as exc:
        print(f"Warning: Windows monitor module unavailable: {exc}")

try:
    from captcha_crop import crop_challenge_image
except ImportError:
    print("Warning: captcha crop module not found.")
    crop_challenge_image = None

DATASET_DIR = ROOT / "dataset" / "auto_captured"
BACKEND_CONFIG = resolve_backend_config(source="server")
apply_backend_config(BACKEND_CONFIG)
HOST = BACKEND_CONFIG.host
PORT = BACKEND_CONFIG.port

class AppState:
    def __init__(self):
        self.status = "准备就绪"
        self.last_prompt = "无"
        self.last_save = "无"
        self.log_messages = []
        self.gui_update_needed = False
        self.latest_request_ts = 0
        self.recognition_results = {}
        self.selected_browser_title = ""
        self.cached_modal = None  # {"img": PIL.Image, "crop_rect": tuple, "ts": float, "density": float}

state = AppState()

BROWSER_WINDOW_KEYWORDS = [
    "Chrome",
    "Google Chrome",
    "Edge",
    "Microsoft Edge",
    "Firefox",
    "Brave",
    "Opera",
    "bigmodel",
    "Z.ai",
    "GLM",
    "智谱",
    "智谱AI",
    "智谱AI开放平台",
]

MIN_CAPTCHA_WIDTH = 180
MIN_CAPTCHA_HEIGHT = 150
MIN_CAPTCHA_DENSITY = 0.01

def log_to_gui(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    formatted_msg = f"[{timestamp}] {msg}"
    state.log_messages.append(formatted_msg)
    if len(state.log_messages) > 20:
        state.log_messages.pop(0)
    state.gui_update_needed = True

def _is_colored_content(pixel):
    r, g, b = pixel[:3]
    if r > 250 and g > 250 and b > 250: return False
    if max(r, g, b) - min(r, g, b) < 8: return False
    return True

def get_color_density(img):
    w, h = img.size
    pixels = img.load()
    hits = 0
    step = 4
    for y in range(0, h, step):
        for x in range(0, w, step):
            if _is_colored_content(pixels[x, y]):
                hits += 1
    return hits / ((w/step) * (h/step))

def is_white(rgb):
    return rgb[0] > 242 and rgb[1] > 242 and rgb[2] > 242

def is_dark(rgb):
    return rgb[0] < 35 and rgb[1] < 35 and rgb[2] < 35

def locate_modal(img):
    w, h = img.size
    cx, cy = w // 2, h // 2
    pixels = img.load()
    candidates = []

    def add_row_runs(y, check_fn):
        x = 0
        while x < w:
            while x < w and not check_fn(pixels[x, y]):
                x += 1
            start = x
            while x < w and check_fn(pixels[x, y]):
                x += 1
            end = x - 1
            width = end - start
            center_x = (start + end) / 2
            # Wide browser windows can place the Tencent captcha modal far to
            # the left of the viewport. Keep the size/frequency filters, but
            # do not require the modal candidate to be near the window center.
            if 260 < width < min(760, w * 0.92) and center_x > w * 0.05:
                candidates.append((start, end, y))

    for y in range(int(h * 0.10), int(h * 0.92), 6):
        add_row_runs(y, is_white)
        add_row_runs(y, is_dark)

    if candidates:
        from collections import Counter
        grouped = []
        for l, r, y in candidates:
            grouped.append((round(l / 12) * 12, round(r / 12) * 12, y, l, r))
        counts = Counter((g[0], g[1]) for g in grouped)
        (gl, gr), freq = counts.most_common(1)[0]
        if freq >= 3:
            matches = [g for g in grouped if (g[0], g[1]) == (gl, gr)]
            l = min(g[3] for g in matches)
            r = max(g[4] for g in matches)
            ys = [g[2] for g in matches]
            pad = int((r - l) * 0.08)
            return (max(0, l), max(0, min(ys) - pad), min(w, r), min(h, max(ys) + pad))

    row_idx = 0
    for y in range(int(h * 0.15), int(h * 0.85), 8):
        if is_white(pixels[cx, y]) or is_dark(pixels[cx, y]):
            l, r = cx, cx
            check_fn = is_white if is_white(pixels[cx, y]) else is_dark
            while l > 0 and check_fn(pixels[l, y]): l -= 1
            while r < w - 1 and check_fn(pixels[r, y]): r += 1
            if 280 < (r - l) < 700: candidates.append((l, r, y))
        row_idx += 1
        if row_idx % 10 == 0:
            time.sleep(0.001)
    if not candidates:
        for y in range(int(h * 0.15), int(h * 0.85), 8):
            if not is_white(pixels[cx, y]) and pixels[cx, y][0] < 100:
                l, r = cx, cx
                while l > 0 and pixels[l, y][0] < 100: l -= 1
                while r < w - 1 and pixels[r, y][0] < 100: r += 1
                if 280 < (r - l) < 700: candidates.append((l, r, y))
            row_idx += 1
            if row_idx % 10 == 0:
                time.sleep(0.001)
    if not candidates: return None
    from collections import Counter
    counts = Counter([(c[0], c[1]) for c in candidates])
    if not counts: return None
    (l, r), freq = counts.most_common(1)[0]
    if freq < 3: return None
    ys = [c[2] for c in candidates if (c[0], c[1]) == (l, r)]
    return (l, min(ys) - int((r - l) * 0.08), r, max(ys) + int((r - l) * 0.08))

def is_acceptable_captcha_image(img):
    if not img:
        return False, "empty image"
    width, height = img.size
    density = get_color_density(img)
    ok = (
        width >= MIN_CAPTCHA_WIDTH
        and height >= MIN_CAPTCHA_HEIGHT
        and density >= MIN_CAPTCHA_DENSITY
    )
    reason = f"size={width}x{height} density={density:.3f}"
    return ok, reason

import subprocess
import queue

_worker_proc = None
_worker_lock = threading.Lock()
_recognition_lock = threading.Lock()
_request_lock = threading.Lock()
_result_queue = queue.Queue()

def _reader_thread(proc):
    while True:
        try:
            line = proc.stdout.readline()
            if not line:
                break
            if line.lstrip().startswith(b"{"):
                _result_queue.put(line)
            else:
                try:
                    sys.stderr.write(line.decode("utf-8", errors="replace"))
                except Exception:
                    pass
        except:
            break

def _get_worker():
    global _worker_proc
    with _worker_lock:
        if _worker_proc is None or _worker_proc.poll() is not None:
            worker_script = str(Path(__file__).parent / "captcha_worker.py")
            log_to_gui("启动识别子进程...")
            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            env["PYTHONUTF8"] = "1"
            _worker_proc = subprocess.Popen(
                [sys.executable, "-u", worker_script],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(ROOT),
                env=env,
            )
            while not _result_queue.empty():
                _result_queue.get_nowait()
            threading.Thread(target=_reader_thread, args=(_worker_proc,), daemon=True).start()
            def _drain_stderr():
                for line in _worker_proc.stderr:
                    try:
                        sys.stderr.write(line.decode(errors='replace'))
                    except:
                        pass
            threading.Thread(target=_drain_stderr, daemon=True).start()
            log_to_gui("识别子进程已启动")
        return _worker_proc

def _stop_worker_proc():
    global _worker_proc
    if _worker_proc is not None and _worker_proc.poll() is None:
        try:
            _worker_proc.kill()
        except Exception:
            pass
    _worker_proc = None

def recognize_captcha(image_path, prompt_chars, crop_rect=None):
    try:
        proc = _get_worker()
        req = json.dumps({
            "image_path": str(image_path),
            "chars": list(prompt_chars),
            "crop_rect": list(crop_rect) if crop_rect else None,
        }, ensure_ascii=False) + "\n"
        print(f"[CAPTURE] sending to worker: {image_path} chars={''.join(prompt_chars)}", flush=True)
        proc.stdin.write(req.encode("utf-8"))
        proc.stdin.flush()
        print(f"[CAPTURE] waiting for worker result...", flush=True)
        try:
            result_line = _result_queue.get(timeout=90)
        except queue.Empty:
            print(f"[CAPTURE] worker timeout!", flush=True)
            _stop_worker_proc()
            return {"error": "worker timeout", "success": False}
        print(f"[CAPTURE] got result: {result_line.decode()[:200]}", flush=True)
        return json.loads(result_line)
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e), "success": False}

def trigger_auto_capture(chars_text: str, request_ts: int, browser_hint=None):
    with _request_lock:
        if request_ts < state.latest_request_ts:
            print(f"[CAPTURE] stale request ignored: ts={request_ts}", flush=True)
            return
        state.latest_request_ts = request_ts
    my_id = request_ts
    t0 = time.time()
    print(f"[CAPTURE] === start: {chars_text} ts={request_ts} ===", flush=True)

    try:
        state.status = "截图中..."
        state.last_prompt = chars_text
        log_to_gui(f"收到请求: {chars_text}")

        DATASET_DIR.mkdir(parents=True, exist_ok=True)

        best_img = None
        best_crop_rect = None

        for attempt in range(5):
            if state.latest_request_ts != my_id:
                return
            if not capture_browser_window:
                time.sleep(0.08)
                continue
            browser_hint = browser_hint or {}
            selected_title = (
                browser_hint.get("title")
                or state.selected_browser_title.strip()
                or None
            )
            selected_rect = browser_hint.get("rect")
            screen, rect = capture_browser_window(
                BROWSER_WINDOW_KEYWORDS,
                preferred_title=selected_title,
                preferred_rect=selected_rect,
            )
            time.sleep(0.001)
            if not screen:
                continue
            modal_rect = locate_modal(screen)
            time.sleep(0.001)
            if not modal_rect:
                if attempt < 2:
                    time.sleep(0.05)
                    continue
                else:
                    print(f"[CAPTURE] no modal after {attempt+1} attempts, giving up", flush=True)
                    state.status = "无弹窗"
                    log_to_gui("ERR: 弹窗未出现或已关闭")
                    state.recognition_results[str(request_ts)] = {
                        "result": {"success": False, "error": "弹窗未出现或已关闭"},
                        "timestamp": datetime.now().isoformat(),
                    }
                    return

            modal_img = screen.crop(modal_rect)
            image_only, crop_rect = crop_challenge_image(modal_img)
            time.sleep(0.001)
            ok, reason = is_acceptable_captcha_image(image_only)
            print(f"[CAPTURE] candidate attempt #{attempt+1}: {reason}", flush=True)
            if ok:
                best_img = image_only
                best_crop_rect = crop_rect
                print(f"[CAPTURE] captured on attempt #{attempt+1} in {(time.time()-t0)*1000:.0f}ms", flush=True)
                break

        if not best_img:
            state.status = "超时退出"
            log_to_gui("ERR: 未截得合格图片")
            state.recognition_results[str(request_ts)] = {
                "result": {"success": False, "error": "未截得合格图片"},
                "timestamp": datetime.now().isoformat(),
            }
            return

        t1 = time.time()

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{chars_text}_{timestamp_str}.png"
        save_path = DATASET_DIR / filename
        best_img.save(save_path)

        log_to_gui(f"截图保存: {filename}")
        print(f"[CAPTURE] saved in {(time.time()-t1)*1000:.0f}ms, calling recognize...", flush=True)

        log_to_gui("开始识别...")
        with _recognition_lock:
            if state.latest_request_ts != my_id:
                print(f"[CAPTURE] stale before recognize: ts={request_ts}", flush=True)
                log_to_gui("SKIP: 已有更新验证码请求")
                return
            result = recognize_captcha(str(save_path), list(chars_text), crop_rect=best_crop_rect)
            if state.latest_request_ts != my_id:
                print(f"[CAPTURE] stale after recognize: ts={request_ts}", flush=True)
                log_to_gui("SKIP: 旧识别结果已丢弃")
                return
        t2 = time.time()
        print(f"[CAPTURE] total={(t2-t0)*1000:.0f}ms recog={result.get('success')}", flush=True)

        if result.get("success"):
            coords = result["click_coords"]

            state.status = f"识别完成: {result['pred_text']} ({result['confidence']})"
            state.last_save = filename
            state.recognition_results[str(request_ts)] = {
                "result": result,
                "image_path": str(save_path),
                "timestamp": datetime.now().isoformat(),
            }

            log_to_gui(f"识别成功: {result['pred_text']} 置信度:{result['confidence']} 耗时:{(t2-t0)*1000:.0f}ms")

        else:
            state.status = f"识别失败: {result.get('error', '未知')}"
            log_to_gui(f"识别结果: {json.dumps(result, ensure_ascii=False)}")

    except Exception as e:
        state.status = "系统出错"
        log_to_gui(f"FATAL: {e}")
    finally:
        state.gui_update_needed = True

class CaptchaHandler(BaseHTTPRequestHandler):
    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_POST(self):
        path = self.path.rstrip("/")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")

            if path == "/captcha":
                text = str(data.get("text", "")).strip()
                request_ts = int(data.get("ts", time.time() * 1000))
                chars = re.findall(r"[\u4e00-\u9fff]", text or "")
                chars_text = "".join(chars[-3:])
                log_to_gui(f"[legacy] ignored /captcha request: {chars_text}; use /captcha_direct")
                self.send_json(200, {"status": "ignored", "chars": chars_text, "ts": request_ts})

            elif path == "/captcha_direct":
                text = str(data.get("text", "")).strip()
                img_b64 = data.get("image", "")
                chars = re.findall(r"[\u4e00-\u9fff]", text or "")
                chars_text = "".join(chars[-3:])

                if not chars_text or not img_b64:
                    self.send_json(400, {"error": "missing text or image", "success": False})
                    return

                try:
                    import io
                    from PIL import Image
                    img_bytes = base64.b64decode(img_b64.split(",")[-1])
                    image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                    log_to_gui(f"[direct] 收到图片: {image.size}, 识别: {chars_text}")

                    DEBUG_DIR = ROOT / "dataset" / "debug_captcha_direct"
                    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
                    ts_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                    debug_path = DEBUG_DIR / f"{chars_text}_{ts_str}.png"
                    image.save(debug_path)
                    log_to_gui(f"[direct] 调试保存: {debug_path.name} ({len(img_bytes)//1024}KB)")

                    result = recognize_captcha(str(debug_path), list(chars_text), crop_rect=None)

                    if result.get("success"):
                        log_to_gui(f"[direct] 识别成功: {result['pred_text']} conf={result['confidence']}")
                        state.status = f"识别完成: {result['pred_text']} ({result['confidence']})"
                    else:
                        log_to_gui(f"[direct] 识别失败: {result.get('error', '?')}")
                        state.status = f"识别失败: {result.get('error', '?')}"

                    self.send_json(200, {"success": True, "result": result})
                except Exception as e:
                    log_to_gui(f"[direct] 异常: {e}")
                    self.send_json(500, {"error": str(e), "success": False})

            elif path == "/result":
                ts = data.get("ts", "")
                result = state.recognition_results.get(str(ts), {})
                self.send_json(200, {"has_result": bool(result), "result": result})

            elif path == "/config":
                action = data.get("action")
                if action == "get":
                    self.send_json(200, {
                        "auto_click": False,
                        "rush_mode": False,
                        "rush_target": "",
                        "results_count": len(state.recognition_results),
                    })
                elif action == "set_auto_click":
                    self.send_json(200, {"auto_click": False, "ignored": True})
                elif action == "set_rush_mode":
                    self.send_json(200, {"rush_mode": False, "target": "", "ignored": True})
                else:
                    self.send_json(400, {"error": "unknown action"})
            else:
                self.send_json(404, {"status": "not_found"})

        except Exception as e:
            self.send_json(400, {"error": str(e)})

    def do_GET(self):
        path = self.path.rstrip("/")
        if path == "/results":
            results = {}
            for k, v in state.recognition_results.items():
                results[k] = {
                    "pred_text": v.get("result", {}).get("pred_text", "?"),
                    "confidence": v.get("result", {}).get("confidence", 0),
                    "timestamp": v.get("timestamp", ""),
                    "coords": v.get("abs_coords", []),
                }
            self.send_json(200, {"count": len(results), "results": results})
        elif path == "/health":
            self.send_json(
                200,
                {
                    "status": "ok",
                    "queue": len(state.recognition_results),
                    "backend": BACKEND_CONFIG.to_dict(),
                },
            )
        else:
            self.send_json(404, {})

    def log_message(self, *args): pass

def run_gui():
    if tk is None or ttk is None:
        raise RuntimeError("Tk is unavailable; install Tk support or use --headless")
    root = tk.Tk()
    root.title("Captcha Server v2 - Auto Rush Mode")
    root.geometry("620x380")
    root.attributes("-topmost", False)
    root.configure(bg="#f0f2f5")

    style = ttk.Style()

    def _ui_font():
        return "PingFang SC" if sys.platform == "darwin" else "Microsoft YaHei UI"

    def _mono_font():
        return "Menlo" if sys.platform == "darwin" else "Consolas"

    ui_font = _ui_font()
    mono_font = _mono_font()
    style.configure("TLabel", background="#f0f2f5", font=(ui_font, 10))
    style.configure("Status.TLabel", font=(ui_font, 12, "bold"), foreground="#1890ff")
    style.configure("Success.TLabel", font=(ui_font, 11, "bold"), foreground="#52c41a")

    main_frame = ttk.Frame(root, padding="15")
    main_frame.pack(fill=tk.BOTH, expand=True)

    row = 0
    ttk.Label(main_frame, text="系统状态:").grid(row=row, column=0, sticky=tk.W, pady=2)
    lbl_status = ttk.Label(main_frame, text="准备就绪", style="Status.TLabel")
    lbl_status.grid(row=row, column=1, sticky=tk.W, pady=2); row += 1

    ttk.Label(main_frame, text="当前提示:").grid(row=row, column=0, sticky=tk.W, pady=2)
    lbl_prompt = ttk.Label(main_frame, text="无")
    lbl_prompt.grid(row=row, column=1, sticky=tk.W, pady=2); row += 1

    ttk.Label(main_frame, text="识别结果:").grid(row=row, column=0, sticky=tk.W, pady=2)
    lbl_result = ttk.Label(main_frame, text="--", style="Success.TLabel")
    lbl_result.grid(row=row, column=1, sticky=tk.W, pady=2); row += 1

    ttk.Label(main_frame, text="最后截图:").grid(row=row, column=0, sticky=tk.W, pady=2)
    lbl_save = ttk.Label(main_frame, text="无", wraplength=320)
    lbl_save.grid(row=row, column=1, sticky=tk.W, pady=2); row += 1

    log_box = tk.Text(main_frame, height=13, width=70, font=(mono_font, 9), bg="#ffffff", relief=tk.FLAT)
    log_box.grid(row=row, column=0, columnspan=3, pady=8); row += 1

    def update_gui():
        try:
            if state.gui_update_needed:
                lbl_status.config(text=state.status)
                lbl_prompt.config(text=state.last_prompt)
                lbl_save.config(text=state.last_save)
                res = state.recognition_results
                latest = max(res.keys(), key=lambda k: res[k]["timestamp"], default=None) if res else None
                if latest:
                    r = res[latest]["result"]
                    lbl_result.config(text=f"{r.get('pred_text','?')} (conf={r.get('confidence',0):.0%})")
                else:
                    lbl_result.config(text="--")
                log_box.delete('1.0', tk.END)
                log_box.insert(tk.END, "\n".join(state.log_messages))
                log_box.see(tk.END)
                state.gui_update_needed = False
        except Exception:
            pass
        root.after(200, update_gui)

    def start_server():
        try:
            server = HTTPServer((HOST, PORT), CaptchaHandler)
            server.serve_forever()
        except Exception as e:
            log_to_gui(f"Server Error: {e}")

    threading.Thread(target=start_server, daemon=True).start()

    def preload_worker():
        try:
            log_to_gui("预热识别子进程...")
            _get_worker()
            log_to_gui("识别子进程就绪！")
        except Exception as e:
            log_to_gui(f"子进程启动失败: {e}")

    threading.Thread(target=preload_worker, daemon=True).start()

    root.after(100, update_gui)
    root.mainloop()

def main(argv: list[str] | None = None) -> int:
    global BACKEND_CONFIG, HOST, PORT
    parser = argparse.ArgumentParser(description="Start the CNCAPTCHA GUI backend.")
    add_backend_args(parser)
    args = parser.parse_args(argv)
    apply_cli_overrides(args)
    BACKEND_CONFIG = resolve_backend_config(source="server-cli")
    apply_backend_config(BACKEND_CONFIG)
    HOST = BACKEND_CONFIG.host
    PORT = BACKEND_CONFIG.port
    print_config(BACKEND_CONFIG)
    run_gui()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
