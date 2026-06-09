"""
YOLO Worker - 极致流水线版
- OMP=1 独占物理核，消灭 GIL 争抢
- 裁剪切片通过 queue 直接传递，无共享内存
"""
import os
import sys
import io
import time
from pathlib import Path

import psutil
from PIL import Image
from ultralytics import YOLO

if getattr(sys, 'frozen', False):
    ROOT = Path(sys._MEIPASS)
else:
    ROOT = Path(__file__).resolve().parent.parent
DETECTOR = ROOT / "models" / "weights" / "yolo-captcha-detector.pt"
YOLO_IMGSZ = 448

# YOLO 单线程！多进程并行靠进程数
for _key in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[_key] = "1"

from backend.evaluate import select_fixed3


def run_yolo_worker(core_id: int, req_queue, ocr_queue, ready_queue):
    # 绑定物理核
    try:
        p = psutil.Process()
        p.cpu_affinity([core_id])
    except Exception:
        pass

    detector = YOLO(str(DETECTOR))
    _ = detector.predict(
        Image.new("RGB", (YOLO_IMGSZ, YOLO_IMGSZ)),
        imgsz=YOLO_IMGSZ,
        conf=0.15,
        iou=0.5,
        max_det=1,
        verbose=False,
    )
    print(f"[yolo] Core {core_id} ready")
    ready_queue.put("yolo_ready")

    while True:
        payload = req_queue.get()
        if payload is None:
            break

        req_id = payload["req_id"]
        chars = payload["chars"]

        try:
            image = Image.open(io.BytesIO(payload["img_bytes"])).convert("RGB")

            t0 = time.perf_counter()
            result = detector.predict(
                source=image,
                imgsz=YOLO_IMGSZ,
                conf=0.15,
                iou=0.5,
                max_det=10,
                verbose=False,
            )[0]
            yolo_ms = (time.perf_counter() - t0) * 1000

            raw_boxes, raw_confs = [], []
            if result.boxes is not None:
                for b in result.boxes:
                    raw_boxes.append(tuple(float(x) for x in b.xyxy[0].tolist()))
                    raw_confs.append(float(b.conf[0].item()))

            boxes, confs, reason = select_fixed3(raw_boxes, raw_confs, image.size)
            selected = sorted(zip(boxes, confs), key=lambda x: x[0][0])
            boxes = [x[0] for x in selected]

            # 纯内存裁剪
            crop_bytes_list = []
            for box in boxes:
                x1, y1, x2, y2 = [int(round(v)) for v in box]
                crop = image.crop(
                    (
                        max(0, x1),
                        max(0, y1),
                        min(image.width, x2),
                        min(image.height, y2),
                    )
                )
                buf = io.BytesIO()
                crop.save(buf, format="PNG")
                crop_bytes_list.append(buf.getvalue())

            # 裁剪结果直接通过 queue 传递（无共享内存）
            ocr_queue.put({
                "req_id": req_id,
                "yolo_ms": yolo_ms,
                "boxes": boxes,
                "chars": chars,
                "image_size": list(image.size),
                "reason": reason,
                "crop_bytes_list": crop_bytes_list,
            })

        except Exception as e:
            import traceback

            traceback.print_exc()
            ocr_queue.put({"req_id": req_id, "error": str(e)})
