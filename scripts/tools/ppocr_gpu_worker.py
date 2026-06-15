from __future__ import annotations

import importlib.util
import json
import math
import os
import site
import sys
from pathlib import Path

# Patch find_spec to hide torch from modelscope (paddleocr dependency).
# torch and paddle cannot coexist in the same process due to CUDA pybind11
# type registration conflicts (_gpuDeviceProperties already registered).
_original_find_spec = importlib.util.find_spec
def _patched_find_spec(name, package=None):
    if name == "torch" or name.startswith("torch."):
        return None
    return _original_find_spec(name, package)
importlib.util.find_spec = _patched_find_spec

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
MODEL_NAME = os.environ.get("CNCAPTCHA_GPU_OCR_MODEL", "PP-OCRv5_server_rec")
DEVICE = os.environ.get("CNCAPTCHA_GPU_OCR_DEVICE", "gpu:0")
ENGINE = os.environ.get("CNCAPTCHA_GPU_OCR_ENGINE", "paddle_dynamic")
CONSTRAINED_DECODE = os.environ.get("CNCAPTCHA_GPU_OCR_CONSTRAINED", "1").lower() not in {
    "0",
    "false",
    "no",
}


def configure_env() -> None:
    paddle_home = ROOT / ".paddle_home_gpu"
    paddlex_cache = ROOT / ".paddlex_cache_gpu"
    os.environ["HOME"] = str(paddle_home)
    os.environ["USERPROFILE"] = str(paddle_home)
    os.environ["PADDLE_HOME"] = str(paddle_home / ".cache" / "paddle")
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(paddlex_cache)
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

    for site_dir in site.getsitepackages():
        nvidia_dir = Path(site_dir) / "nvidia"
        dll_dirs = [
            nvidia_dir / "cudnn" / "bin",
            nvidia_dir / "cublas" / "bin",
            nvidia_dir / "cuda_nvrtc" / "bin",
            nvidia_dir / "cuda_runtime" / "bin",
        ]
        existing = [str(path) for path in dll_dirs if path.exists()]
        if existing:
            os.environ["PATH"] = ";".join(existing + [os.environ.get("PATH", "")])


def first_cjk(text: str) -> str:
    return next((ch for ch in text if "\u4e00" <= ch <= "\u9fff"), "")


def predict_with_candidate_scores(recognizer, paths: list[str], prompt: list[str]) -> list[dict]:
    predictor = recognizer.paddlex_predictor
    raw_imgs = predictor.pre_tfs["Read"](imgs=paths)
    batch_imgs = predictor.pre_tfs["ReisizeNorm"](imgs=raw_imgs)
    x = predictor.pre_tfs["ToBatch"](imgs=batch_imgs)
    batch_preds = predictor.runner(x=x)
    probs = np.array(batch_preds[0] if isinstance(batch_preds, (list, tuple)) else batch_preds)
    texts, scores = predictor.post_op(batch_preds)

    rows: list[dict] = []
    for row_idx, text in enumerate(texts):
        candidate_scores: dict[str, float] = {}
        for char in prompt:
            char_idx = predictor.post_op.dict.get(char)
            if char_idx is None:
                candidate_scores[char] = 0.0
            else:
                candidate_scores[char] = float(probs[row_idx, :, char_idx].max())

        best_char = max(candidate_scores, key=candidate_scores.get) if candidate_scores else first_cjk(str(text))
        rows.append(
            {
                "text": str(text),
                "char": best_char,
                "score": float(candidate_scores.get(best_char, scores[row_idx] if scores else 0.0) or 0.0),
                "ocr_text": str(text),
                "ocr_score": float(scores[row_idx] if scores else 0.0),
                "candidate_scores": candidate_scores,
            }
        )
    return rows


def assign_prompt_globally(rows: list[dict], prompt: list[str]) -> list[dict]:
    if len(rows) != len(prompt):
        return rows

    best_perm: tuple[str, ...] | None = None
    best_score = -float("inf")

    def permutations(items: list[str]):
        if len(items) <= 1:
            yield tuple(items)
            return
        for idx, item in enumerate(items):
            rest = items[:idx] + items[idx + 1 :]
            for suffix in permutations(rest):
                yield (item,) + suffix

    for perm in permutations(list(prompt)):
        score = 0.0
        for row, char in zip(rows, perm):
            candidate_scores = row.get("candidate_scores") or {}
            prob = float(candidate_scores.get(char, 0.0) or 0.0)
            score += math.log(max(prob, 1e-12))
        if score > best_score:
            best_score = score
            best_perm = perm

    if best_perm is None:
        return rows

    assigned = []
    for row, char in zip(rows, best_perm):
        updated = dict(row)
        updated["raw_char"] = updated.get("char", "")
        updated["char"] = char
        updated["score"] = float((updated.get("candidate_scores") or {}).get(char, updated.get("score", 0.0)) or 0.0)
        assigned.append(updated)
    return assigned


def main() -> int:
    configure_env()

    from paddleocr import TextRecognition

    recognizer = TextRecognition(
        model_name=MODEL_NAME,
        device=DEVICE,
        engine=ENGINE,
    )
    sys.stderr.write(f"[ppocr] {MODEL_NAME} {DEVICE} {ENGINE} constrained={CONSTRAINED_DECODE} loaded\n")
    sys.stderr.flush()

    for raw_line in sys.stdin.buffer:
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            paths = [str(path) for path in (req.get("paths") or [])]
            prompt = list(req.get("prompt") or req.get("chars") or [])
            if CONSTRAINED_DECODE and prompt:
                rows = predict_with_candidate_scores(recognizer, paths, prompt)
                if len(rows) == len(prompt):
                    rows = assign_prompt_globally(rows, prompt)
            else:
                result = recognizer.predict(paths)
                rows = []
                for item in result:
                    text = str(item.get("rec_text", ""))
                    score = float(item.get("rec_score", 0.0) or 0.0)
                    rows.append({"text": text, "char": first_cjk(text), "score": score})
            sys.stdout.write(
                json.dumps(
                    {
                        "success": True,
                        "results": rows,
                        "model": MODEL_NAME,
                        "constrained": CONSTRAINED_DECODE,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            sys.stdout.flush()
        except Exception as exc:
            import traceback

            traceback.print_exc(file=sys.stderr)
            sys.stdout.write(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False) + "\n")
            sys.stdout.flush()

    recognizer.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
