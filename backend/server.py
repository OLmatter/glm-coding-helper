"""
验证码极速网关 - 双端流水线架构
- YOLO -> OCR 两段流水线，默认 4 YOLO + 8 OCR worker
- 可通过 config.json 配置 worker 数和端口
- 共享内存零拷贝传递切片，消灭序列化开销
"""
import os
import sys
import io
import json
import base64
import time
import asyncio
import urllib.request
import multiprocessing as mp
import threading
from pathlib import Path
from contextlib import asynccontextmanager

import psutil
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

if getattr(sys, 'frozen', False):
    ROOT = Path(sys._MEIPASS)
else:
    ROOT = Path(__file__).resolve().parent.parent
# 确保 backend 包在 sys.path 中
if str(ROOT) not in os.sys.path:
    os.sys.path.insert(0, str(ROOT))

# ── 加载 config.json（支持可配置 worker 数）─────────────────
CONFIG_PATH = ROOT / "config.json"

def _smart_defaults():
    """按 CPU 核数智能分配 YOLO / OCR worker 数"""
    try:
        cores = psutil.cpu_count(logical=False) or psutil.cpu_count(logical=True) or 4
    except Exception:
        cores = 4
    yolo = max(1, min(4, cores // 4))
    ocr  = max(2, min(8, cores // 2))
    # 留 1-2 核给系统
    if yolo + ocr >= cores:
        ocr = max(2, cores - yolo - 1)
    return yolo, ocr

_smart_yolo, _smart_ocr = _smart_defaults()
_DEFAULT = {"workers": _smart_yolo, "ocr_workers": _smart_ocr, "port": 8888}

if CONFIG_PATH.exists():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            _cfg = json.load(f)
    except Exception:
        _cfg = {}
else:
    _cfg = {}
N_YOLO = max(1, int(_cfg.get("workers", _DEFAULT["workers"])))
N_OCR  = max(1, int(_cfg.get("ocr_workers", _DEFAULT["ocr_workers"])))
PORT   = max(1, int(_cfg.get("port", _DEFAULT["port"])))

if not CONFIG_PATH.exists():
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump({"workers": N_YOLO, "ocr_workers": N_OCR, "port": PORT,
                        "_auto": True, "_cores": psutil.cpu_count(logical=False) or 0}, f, indent=2)
        print(f"[config] created default {CONFIG_PATH} "
              f"(cores={psutil.cpu_count(logical=False) or '?'} → YOLO={N_YOLO} OCR={N_OCR})")
    except Exception:
        pass

# 队列：网关 -> YOLO (传原图 bytes，几十KB，Queue 足矣)
yolo_req_queues = [mp.Queue(maxsize=10) for _ in range(N_YOLO)]
# 队列：YOLO -> OCR (无界队列，YOLO永不阻塞)
ocr_req_queue = mp.Queue()
# 队列：OCR -> 网关
res_queue = mp.Queue()
# 队列：worker 就绪信号 (YOLO/OCR 各自推送 ready 消息)
ready_queue = mp.Queue()

pending_requests = {}
request_lock = threading.Lock()
request_counter = 0
round_robin_idx = 0
ready_count = 0
ready_count_lock = threading.Lock()
_shutdown = threading.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global workers_list
    workers_list = []

    from backend.worker import run_yolo_worker
    from backend.ppocr_worker import run_ocr_worker_direct

    # ── 预热磁盘缓存：主进程先读模型文件，worker 启动时走内存 ──
    def _warm_disk_cache():
        model_files = list((ROOT / "models" / "weights").glob("*.pt"))
        ocr_dir = ROOT / "official_models" / "PP-OCRv5_server_rec_safetensors"
        if ocr_dir.exists():
            model_files += list(ocr_dir.glob("*.safetensors"))
        for f in model_files:
            try:
                with open(f, "rb") as fh:
                    fh.read(1 << 20)  # read 1MB to warm page cache
            except Exception:
                pass

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _warm_disk_cache)
    print("[architect] disk cache warmed")

    # ── 后台启动 workers，不阻塞服务上线 ──
    def _start_one(target_fn, target_args):
        p = mp.Process(target=target_fn, args=target_args, daemon=True)
        p.start()
        workers_list.append(p)
        return p

    def _start_workers():
        print(f"[architect] 启动 {N_YOLO} YOLO 流水线 (Core 0-{N_YOLO - 1})...")
        for i in range(N_YOLO):
            _start_one(run_yolo_worker, (i, yolo_req_queues[i], ocr_req_queue, ready_queue))
            time.sleep(0.1)

        print(f"[architect] 启动 {N_OCR} OCR 流水线 (Core {N_YOLO}-{N_YOLO + N_OCR - 1}, 错峰加载)...")
        for i in range(N_OCR):
            core_id = N_YOLO + i
            p = _start_one(run_ocr_worker_direct, (core_id, ocr_req_queue, res_queue, ready_queue))
            time.sleep(1.0)  # OCR 模型大，间隔 1s 避免内存尖峰

    def _worker_watchdog():
        """监控 worker 进程，崩溃后自动重启"""
        time.sleep(30)
        while not _shutdown.is_set():
            _shutdown.wait(15)
            if _shutdown.is_set():
                break
            for idx, p in enumerate(workers_list):
                if not p.is_alive():
                    core_id = N_YOLO + (idx - N_YOLO) if idx >= N_YOLO else idx
                    worker_type = "ocr" if idx >= N_YOLO else "yolo"
                    print(f"[architect] {worker_type} worker Core {core_id} 崩溃，10s 后重启...")
                    time.sleep(10)
                    if worker_type == "ocr":
                        new_p = mp.Process(target=run_ocr_worker_direct, args=(
                            core_id, ocr_req_queue, res_queue, ready_queue), daemon=True)
                    else:
                        new_p = mp.Process(target=run_yolo_worker, args=(
                            core_id, yolo_req_queues[idx], ocr_req_queue, ready_queue), daemon=True)
                    new_p.start()
                    workers_list[idx] = new_p
                    break

    threading.Thread(target=_start_workers, daemon=True).start()
    threading.Thread(target=result_listener_thread, daemon=True).start()
    threading.Thread(target=ready_count_tracker, daemon=True).start()
    threading.Thread(target=_worker_watchdog, daemon=True).start()
    try:
        yield
    finally:
        _shutdown.set()
        for p in workers_list:
            if p.is_alive():
                p.terminate()
                p.join(timeout=3)
        print("[architect] all workers stopped")


def result_listener_thread():
    while True:
        res = res_queue.get()
        if not res:
            continue
        req_id = res.get("req_id")
        with request_lock:
            future = pending_requests.pop(req_id, None)
        if future and not future.done():
            future.get_loop().call_soon_threadsafe(future.set_result, res)


def ready_count_tracker():
    global ready_count
    while True:
        msg = ready_queue.get()
        with ready_count_lock:
            ready_count += 1
        print(f"[architect] worker ready ({ready_count}/{N_YOLO + N_OCR})")


class CaptchaRequest(BaseModel):
    text: str
    image: str


class CaptchaUrlRequest(BaseModel):
    text: str
    url: str


app = FastAPI(lifespan=lifespan)

# CORS：允许油猴脚本跨域 fetch（GM_xmlhttpRequest 有连接数瓶颈，fetch 无此限制）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    with ready_count_lock:
        r = ready_count
    alive = sum(1 for p in workers_list if p.is_alive()) if workers_list else 0
    total = N_YOLO + N_OCR
    status = "ok" if r >= total else "starting"
    return {"status": status, "workers": total, "ready_workers": r, "alive_workers": alive}


@app.post("/direct")
@app.post("/captcha_direct")
async def handle_direct(data: CaptchaRequest):
    global request_counter, round_robin_idx
    chars = "".join(ch for ch in data.text if "\u4e00" <= ch <= "\u9fff")[-3:]
    if not chars or not data.image:
        raise HTTPException(status_code=400, detail="missing text or image")

    img_bytes = base64.b64decode(data.image.split(",")[-1])
    if not img_bytes:
        raise HTTPException(status_code=400, detail="empty image")

    with request_lock:
        request_counter += 1
        req_id = request_counter
    future = asyncio.get_event_loop().create_future()
    with request_lock:
        pending_requests[req_id] = future

    payload = {"req_id": req_id, "img_bytes": img_bytes, "chars": list(chars)}

    try:
        target_q = yolo_req_queues[round_robin_idx % N_YOLO]
        round_robin_idx += 1
        target_q.put_nowait(payload)
    except Exception:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, target_q.put, payload)

    try:
        result = await asyncio.wait_for(future, timeout=15.0)
        return {"success": True, "result": result}
    except asyncio.TimeoutError:
        with request_lock:
            pending_requests.pop(req_id, None)
        raise HTTPException(status_code=504, detail="Processing timeout")


@app.post("/captcha_direct_url")
async def handle_direct_url(data: CaptchaUrlRequest):
    """接收图片 URL，下载后识别"""
    global request_counter, round_robin_idx
    chars = "".join(ch for ch in data.text if "\u4e00" <= ch <= "\u9fff")[-3:]
    if not chars or not data.text:
        print(f"[400] text='{data.text[:80]}' → no Chinese chars", flush=True)
        raise HTTPException(status_code=400, detail="missing text or url")
    if not data.url:
        print(f"[400] url='{data.url[:120]}' → empty url", flush=True)
        raise HTTPException(status_code=400, detail="missing text or url")

    loop = asyncio.get_event_loop()
    try:
        resp = await loop.run_in_executor(None, lambda: urllib.request.urlopen(data.url, timeout=15))
        img_bytes = resp.read()
    except Exception as e:
        print(f"[400] download failed: url='{data.url[:120]}' error={e}", flush=True)
        raise HTTPException(status_code=400, detail=f"failed to download image: {e}")

    if not img_bytes:
        raise HTTPException(status_code=400, detail="empty image from url")

    with request_lock:
        request_counter += 1
        req_id = request_counter
    future = asyncio.get_event_loop().create_future()
    with request_lock:
        pending_requests[req_id] = future

    try:
        await loop.run_in_executor(None, _dispatch_one, req_id, img_bytes, chars)
    except Exception:
        # _dispatch_one 内部已经处理异常并回调 future，
        # 这里无需额外操作
        pass

    try:
        result = await asyncio.wait_for(future, timeout=15.0)
        return {"success": True, "result": result}
    except asyncio.TimeoutError:
        with request_lock:
            pending_requests.pop(req_id, None)
        raise HTTPException(status_code=504, detail="Processing timeout")


class BatchCaptchaRequest(BaseModel):
    requests: list[CaptchaRequest]


def _dispatch_one(req_id: int, img_bytes: bytes, chars: list[str]) -> int:
    """同步dispatch单个请求到YOLO队列（在run_in_executor中执行）"""
    target_q = yolo_req_queues[req_id % N_YOLO]
    payload = {"req_id": req_id, "img_bytes": img_bytes, "chars": chars}
    target_q.put(payload)
    return req_id


@app.post("/batch_direct")
async def handle_batch_direct(data: BatchCaptchaRequest):
    """批量处理多窗口验证码：一次接收所有窗口的截图，并行识别后一起返回"""
    global request_counter

    n = len(data.requests)
    if n == 0:
        raise HTTPException(status_code=400, detail="empty batch")
    if n > 30:
        raise HTTPException(status_code=400, detail="batch too large, max 30")

    futures = {}
    loop = asyncio.get_event_loop()

    for item in data.requests:
        chars = "".join(ch for ch in item.text if "\u4e00" <= ch <= "\u9fff")[-3:]
        if not chars or not item.image:
            continue
        img_bytes = base64.b64decode(item.image.split(",")[-1])
        if not img_bytes:
            continue

        with request_lock:
            request_counter += 1
            req_id = request_counter
        future = loop.create_future()
        with request_lock:
            pending_requests[req_id] = future
        futures[req_id] = future

        # 异步dispatch（避免阻塞event loop）
        loop.run_in_executor(None, _dispatch_one, req_id, img_bytes, list(chars))

    if not futures:
        raise HTTPException(status_code=400, detail="no valid requests")

    try:
        results = await asyncio.wait_for(
            asyncio.gather(*futures.values(), return_exceptions=True),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        # 清理超时的future
        with request_lock:
            for req_id in futures:
                pending_requests.pop(req_id, None)
        raise HTTPException(status_code=504, detail="Batch processing timeout")

    # 收集结果，保持原始顺序
    final_results = []
    for req_id, fut in futures.items():
        result = results[list(futures.keys()).index(req_id)]
        if isinstance(result, Exception):
            final_results.append({"req_id": req_id, "success": False, "error": str(result)})
        else:
            final_results.append({"req_id": req_id, "success": True, "result": result})

    return {"success": True, "count": len(final_results), "results": final_results}


def main():
    mp.freeze_support()
    uvicorn.run("backend.server:app", host="0.0.0.0", port=PORT, log_level="info")


if __name__ == "__main__":
    main()
