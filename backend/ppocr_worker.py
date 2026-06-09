"""
PP-OCR Worker - 极速流水线版（直读 Queue，无共享内存）
"""
import os
import sys
import io
import math
import time
from pathlib import Path

import psutil
import numpy as np
from PIL import Image

if getattr(sys, 'frozen', False):
    ROOT = Path(sys._MEIPASS)
else:
    ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

MODEL_NAME = "PP-OCRv5_server_rec"
ENGINE = "paddle_dynamic"
CONSTRAINED_DECODE = True

# OCR 单线程！8个进程填满 Core 8-15
for _key in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[_key] = "1"


def configure_env() -> None:
    os.environ.setdefault("HOME", str(ROOT))
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(ROOT))
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")


def first_cjk(text: str) -> str:
    return next((ch for ch in text if "\u4e00" <= ch <= "\u9fff"), "")


def predict_with_candidate_scores_from_numpy(
    recognizer, np_img_bgr: np.ndarray, prompt: list[str]
) -> dict:
    predictor = recognizer.paddlex_predictor
    batch_imgs = predictor.pre_tfs["ReisizeNorm"](imgs=[np_img_bgr])
    x = predictor.pre_tfs["ToBatch"](imgs=batch_imgs)
    batch_preds = predictor.runner(x=x)
    probs = np.array(
        batch_preds[0] if isinstance(batch_preds, (list, tuple)) else batch_preds
    )
    texts, scores = predictor.post_op(batch_preds)

    candidate_scores = {}
    for char in prompt:
        idx = predictor.post_op.dict.get(char)
        candidate_scores[char] = 0.0 if idx is None else float(probs[0, :, idx].max())

    best_char = (
        max(candidate_scores, key=candidate_scores.get)
        if candidate_scores
        else first_cjk(str(texts[0]))
    )
    return {
        "text": str(texts[0]),
        "char": best_char,
        "score": float(
            candidate_scores.get(best_char, scores[0] if scores else 0.0) or 0.0
        ),
        "ocr_text": str(texts[0]),
        "ocr_score": float(scores[0] if scores else 0.0),
        "candidate_scores": candidate_scores,
    }


def assign_prompt_globally(rows: list[dict], prompt: list[str]) -> list[dict]:
    if len(rows) != len(prompt):
        return rows
    best_perm, best_score = None, -float("inf")

    def permutations(items):
        if len(items) <= 1:
            yield tuple(items)
            return
        for idx, item in enumerate(items):
            for suffix in permutations(items[:idx] + items[idx + 1 :]):
                yield (item,) + suffix

    for perm in permutations(list(prompt)):
        score = sum(
            math.log(
                max(float((r.get("candidate_scores") or {}).get(c, 0.0) or 0.0), 1e-12)
            )
            for r, c in zip(rows, perm)
        )
        if score > best_score:
            best_score, best_perm = score, perm

    if best_perm is None:
        return rows
    assigned = []
    for row, char in zip(rows, best_perm):
        updated = dict(row)
        updated["raw_char"] = updated.get("char", "")
        updated["char"] = char
        updated["score"] = float(
            (updated.get("candidate_scores") or {}).get(char, updated.get("score", 0.0))
            or 0.0
        )
        assigned.append(updated)
    return assigned


def run_ocr_worker_direct(core_id: int, req_queue, res_queue, ready_queue):
    # 绑定物理核
    try:
        p = psutil.Process()
        p.cpu_affinity([core_id])
    except Exception:
        pass

    configure_env()
    from paddleocr import TextRecognition

    try:
        recognizer = TextRecognition(model_name=MODEL_NAME, device="cpu", engine=ENGINE)
        # ── 预缓存：预热 OCR 模型（首次推理触发 JIT 编译 + 模型缓存）────
        _warm_img = np.zeros((32, 100, 3), dtype=np.uint8)
        predictor_w = recognizer.paddlex_predictor
        _warm_batch = predictor_w.pre_tfs["ReisizeNorm"](imgs=[_warm_img])
        _warm_x = predictor_w.pre_tfs["ToBatch"](imgs=_warm_batch)
        _ = predictor_w.runner(x=_warm_x)
        print(f"[ocr] Core {core_id} ready (pre-warmed)")
        ready_queue.put("ocr_ready")
    except Exception as e:
        print(f"[ocr] Core {core_id} 模型加载失败: {e}", flush=True)
        raise

    while True:
        payload = req_queue.get()
        if payload is None:
            break

        req_id = payload["req_id"]

        if "error" in payload:
            res_queue.put(
                {"req_id": req_id, "success": False, "error": payload["error"]}
            )
            continue

        chars = payload["chars"]

        crop_bytes_list = payload["crop_bytes_list"]

        t0 = time.perf_counter()
        ocr_rows = []

        for idx, img_bytes in enumerate(crop_bytes_list):
            # Bytes -> PIL -> Numpy BGR
            pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            np_img_bgr = np.array(pil_img, dtype=np.uint8)[:, :, ::-1]

            if CONSTRAINED_DECODE and chars:
                row = predict_with_candidate_scores_from_numpy(
                    recognizer, np_img_bgr, list(chars)
                )
            else:
                predictor = recognizer.paddlex_predictor
                batch_imgs = predictor.pre_tfs["ReisizeNorm"](imgs=[np_img_bgr])
                x = predictor.pre_tfs["ToBatch"](imgs=batch_imgs)
                batch_preds = predictor.runner(x=x)
                texts, scores = predictor.post_op(batch_preds)
                text = str(texts[0])
                row = {
                    "text": text,
                    "char": first_cjk(text),
                    "score": float(scores[0] if scores else 0.0),
                }
            ocr_rows.append(row)

        if CONSTRAINED_DECODE and chars and len(ocr_rows) == len(chars):
            ocr_rows = assign_prompt_globally(ocr_rows, chars)

        ocr_ms = (time.perf_counter() - t0) * 1000

        # 构建响应
        raw_box_chars = [str(row.get("char", "")) for row in ocr_rows]
        box_chars = list(raw_box_chars)
        if len(box_chars) == len(chars):
            used, mapping = set(), []
            for ch in chars:
                for i, bc in enumerate(box_chars):
                    if i not in used and bc == ch:
                        mapping.append(i)
                        used.add(i)
                        break
                else:
                    mapping.append(-1)
            prompt_to_box = mapping if -1 not in mapping else list(range(len(box_chars)))
        else:
            prompt_to_box = list(range(len(box_chars)))

        img_w, img_h = payload["image_size"]
        click_coords = []
        for pi, bi in enumerate(prompt_to_box):
            if bi >= len(payload["boxes"]):
                continue
            b = payload["boxes"][bi]
            click_coords.append(
                {
                    "char": chars[pi] if pi < len(chars) else "",
                    "nx": round(((b[0] + b[2]) / 2) / img_w, 4),
                    "ny": round(((b[1] + b[3]) / 2) / img_h, 4),
                }
            )

        scores = [float(row.get("score", 0.0) or 0.0) for row in ocr_rows]
        res_queue.put(
            {
                "req_id": req_id,
                "success": True,
                "prompt": chars,
                "pred_text": "".join(box_chars),
                "confidence": round(sum(scores) / max(len(scores), 1), 3),
                "elapsed_ms": round(ocr_ms + payload.get("yolo_ms", 0.0), 1),
                "yolo_ms": round(payload.get("yolo_ms", 0.0), 1),
                "ocr_ms": round(ocr_ms, 1),
                "click_coords": click_coords,
                "reason": payload.get("reason", ""),
            }
        )
