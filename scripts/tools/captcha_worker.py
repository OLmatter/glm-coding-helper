from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time as _time
from pathlib import Path

from PIL import Image
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts" / "tools"))

from backend_config import apply_backend_config, print_config, resolve_backend_config
from evaluate_char_detector_fixed3 import select_fixed3

BACKEND_CONFIG = resolve_backend_config(source="worker")
apply_backend_config(BACKEND_CONFIG)
print_config(BACKEND_CONFIG)


def _venv_python(venv_name: str) -> Path:
    """跨平台返回虚拟环境里的 python 可执行文件路径。"""
    base = ROOT / venv_name
    if os.name == "nt":
        return base / "Scripts" / "python.exe"
    return base / "bin" / "python"


_DEFAULT_DETECTOR_PATH = ROOT / "models" / "weights" / "yolo-captcha-detector.pt"
_LEGACY_DETECTOR_PATH = (
    ROOT
    / "runs"
    / "detect"
    / "runs"
    / "detect"
    / "dataset"
    / "char_detector_yolo"
    / "runs"
    / "char_detector_yolov8n_clean"
    / "weights"
    / "best.pt"
)
DETECTOR_PATH = Path(os.environ.get("CNCAPTCHA_DETECTOR_PATH", str(_DEFAULT_DETECTOR_PATH)))
if not DETECTOR_PATH.exists() and _LEGACY_DETECTOR_PATH.exists():
    DETECTOR_PATH = _LEGACY_DETECTOR_PATH
OCR_MODE = os.environ.get("CNCAPTCHA_OCR_MODE", "auto").lower()
if OCR_MODE in {"cpu", "cpu_parallel", "cpu-pool"}:
    OCR_PYTHON = Path(
        os.environ.get(
            "CNCAPTCHA_CPU_OCR_PYTHON",
            str(_venv_python(".venv_paddle")),
        )
    )
    OCR_WORKER = ROOT / "scripts" / "tools" / "ppocr_cpu_pool_worker.py"
    OCR_ENGINE_NAME = f"yolo+{os.environ.get('CNCAPTCHA_CPU_OCR_MODEL', 'hybrid')}_cpu_parallel"
else:
    OCR_PYTHON = Path(
        os.environ.get(
            "CNCAPTCHA_GPU_OCR_PYTHON",
            str(_venv_python(".venv_paddle_gpu")),
        )
    )
    OCR_WORKER = ROOT / "scripts" / "tools" / "ppocr_gpu_worker.py"
    OCR_ENGINE_NAME = f"yolo+{os.environ.get('CNCAPTCHA_GPU_OCR_MODEL', 'PP-OCRv5_server_rec')}_gpu"
CROP_DIR = ROOT / "logs" / "ppocr_live_crops"
YOLO_IMGSZ = int(os.environ.get("CNCAPTCHA_YOLO_IMGSZ", "448"))
YOLO_DEVICE = os.environ.get("CNCAPTCHA_YOLO_DEVICE", "").strip() or None

detector = YOLO(str(DETECTOR_PATH))
_ocr_proc: subprocess.Popen | None = None
_ocr_lock = threading.Lock()


def _drain_stderr(proc: subprocess.Popen) -> None:
    assert proc.stderr is not None
    for raw in proc.stderr:
        try:
            sys.stderr.write(raw.decode(errors="replace"))
        except Exception:
            pass


def get_ocr_proc() -> subprocess.Popen:
    global _ocr_proc
    with _ocr_lock:
        if _ocr_proc is None or _ocr_proc.poll() is not None:
            if not OCR_PYTHON.exists():
                raise RuntimeError(f"missing OCR venv python: {OCR_PYTHON}")
            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            env["PYTHONUTF8"] = "1"
            _ocr_proc = subprocess.Popen(
                [str(OCR_PYTHON), "-u", str(OCR_WORKER)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(ROOT),
                env=env,
            )
            threading.Thread(target=_drain_stderr, args=(_ocr_proc,), daemon=True).start()
        return _ocr_proc


def ask_ocr(crop_paths: list[Path], prompt_chars: list[str], timeout: float = 10.0) -> tuple[list[dict], dict]:
    proc = get_ocr_proc()
    assert proc.stdin is not None and proc.stdout is not None
    payload = json.dumps(
        {"paths": [str(path) for path in crop_paths], "prompt": list(prompt_chars)},
        ensure_ascii=False,
    ) + "\n"
    proc.stdin.write(payload.encode("utf-8"))
    proc.stdin.flush()

    start = _time.perf_counter()
    while True:
        if _time.perf_counter() - start > timeout:
            raise TimeoutError("PP-OCR worker timeout")
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError("PP-OCR worker exited")
        text = line.decode("utf-8", errors="replace").strip()
        if not text.startswith("{"):
            continue
        resp = json.loads(text)
        if not resp.get("success"):
            raise RuntimeError(resp.get("error", "PP-OCR failed"))
        return list(resp.get("results", [])), resp


def repair_to_prompt(pred_chars: list[str], prompt_chars: list[str]) -> tuple[list[str], bool]:
    repaired = list(pred_chars)
    in_prompt = [ch for ch in repaired if ch in prompt_chars]
    missing = [ch for ch in prompt_chars if ch not in in_prompt]
    bad_idxs = [idx for idx, ch in enumerate(repaired) if ch not in prompt_chars]
    if len(missing) == len(bad_idxs) == 1:
        repaired[bad_idxs[0]] = missing[0]
    return repaired, repaired != pred_chars


def indices_for_prompt(box_chars: list[str], prompt_chars: list[str]) -> list[int]:
    used: set[int] = set()
    indices: list[int] = []
    for char in prompt_chars:
        found = None
        for idx, box_char in enumerate(box_chars):
            if idx not in used and box_char == char:
                found = idx
                break
        if found is None:
            raise RuntimeError(f"OCR result cannot map prompt={''.join(prompt_chars)} boxes={''.join(box_chars)}")
        used.add(found)
        indices.append(found)
    return indices


def map_prompt_to_boxes(box_chars: list[str], prompt_chars: list[str], ocr_rows: list[dict]) -> list[int]:
    try:
        return indices_for_prompt(box_chars, prompt_chars)
    except RuntimeError as exc:
        raise RuntimeError(f"{exc}; ocr_rows={json.dumps(ocr_rows, ensure_ascii=False)}") from exc


def write_response(resp: dict) -> None:
    sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
    sys.stdout.flush()


get_ocr_proc()
sys.stderr.write(f"[worker] YOLO loaded; OCR worker preloading mode={OCR_MODE} engine={OCR_ENGINE_NAME}\n")
sys.stderr.flush()

for raw_line in sys.stdin.buffer:
    line = raw_line.decode("utf-8", errors="replace").strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except Exception:
        continue

    img_path = req.get("image_path", "")
    chars = list(req.get("chars", []))
    crop_rect = req.get("crop_rect")

    sys.stderr.write(f"[worker] received: {img_path} chars={''.join(chars)}\n")
    sys.stderr.flush()

    if not img_path or not chars:
        write_response({"error": "missing params", "success": False})
        continue

    try:
        image = Image.open(img_path).convert("RGB")
        total_t0 = _time.perf_counter()

        yolo_t0 = _time.perf_counter()
        result = detector.predict(
            source=image,
            imgsz=YOLO_IMGSZ,
            conf=0.15,
            iou=0.5,
            max_det=10,
            verbose=False,
            device=YOLO_DEVICE,
        )[0]
        yolo_ms = (_time.perf_counter() - yolo_t0) * 1000

        raw_boxes, raw_confs = [], []
        if result.boxes is not None:
            for b in result.boxes:
                raw_boxes.append(tuple(float(x) for x in b.xyxy[0].tolist()))
                raw_confs.append(float(b.conf[0].item()))

        boxes, confs, reason = select_fixed3(raw_boxes, raw_confs, image.size)
        selected = sorted(zip(boxes, confs), key=lambda item: item[0][0])
        boxes = [item[0] for item in selected]
        confs = [item[1] for item in selected]

        if len(boxes) != 3:
            write_response({"error": f"detected {len(boxes)} boxes, need 3", "success": False, "reason": reason})
            continue

        CROP_DIR.mkdir(parents=True, exist_ok=True)
        stamp = f"{int(_time.time() * 1000)}"
        crop_paths: list[Path] = []
        for idx, box in enumerate(boxes, start=1):
            x1, y1, x2, y2 = [int(round(v)) for v in box]
            crop = image.crop((max(0, x1), max(0, y1), min(image.width, x2), min(image.height, y2)))
            path = CROP_DIR / f"{Path(img_path).stem}_{stamp}_box{idx}.png"
            crop.save(path)
            crop_paths.append(path)

        ocr_t0 = _time.perf_counter()
        ocr_rows, ocr_meta = ask_ocr(crop_paths, chars)
        ocr_ms = (_time.perf_counter() - ocr_t0) * 1000

        raw_box_chars = [str(row.get("char", "")) for row in ocr_rows]
        box_chars, repaired = repair_to_prompt(raw_box_chars, chars)
        prompt_to_box = map_prompt_to_boxes(box_chars, chars, ocr_rows)

        img_w, img_h = image.size
        click_coords = []
        for prompt_idx, box_idx in enumerate(prompt_to_box):
            b = boxes[box_idx]
            nx = ((b[0] + b[2]) / 2) / img_w
            ny = ((b[1] + b[3]) / 2) / img_h
            click_coords.append(
                {
                    "char": chars[prompt_idx],
                    "nx": round(nx, 4),
                    "ny": round(ny, 4),
                    "box_index": box_idx,
                }
            )

        scores = [float(row.get("score", 0.0) or 0.0) for row in ocr_rows]
        total_ms = (_time.perf_counter() - total_t0) * 1000
        resp = {
            "success": True,
            "engine": OCR_ENGINE_NAME,
            "prompt": chars,
            "sorted_order": prompt_to_box,
            "pred_text": "".join(box_chars),
            "raw_ocr_text": "".join(raw_box_chars),
            "repaired": repaired,
            "confidence": round(sum(scores) / max(len(scores), 1), 3),
            "elapsed_ms": round(total_ms, 1),
            "yolo_ms": round(yolo_ms, 1),
            "ocr_ms": round(ocr_ms, 1),
            "click_coords": click_coords,
            "boxes": [{"x1": b[0], "y1": b[1], "x2": b[2], "y2": b[3]} for b in boxes],
            "ocr": ocr_rows,
            "ocr_meta": {k: v for k, v in ocr_meta.items() if k != "results"},
            "reason": reason,
            "crop_rect": crop_rect,
        }
        write_response(resp)

    except Exception as e:
        import traceback

        traceback.print_exc(file=sys.stderr)
        write_response({"error": str(e), "success": False})
