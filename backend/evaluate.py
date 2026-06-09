from __future__ import annotations

from itertools import permutations

import numpy as np


def box_area(box: tuple[float, float, float, float]) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    return inter / (box_area(a) + box_area(b) - inter + 1e-6)


def center_error(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    acx, acy = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
    bcx, bcy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    return float(((acx - bcx) ** 2 + (acy - bcy) ** 2) ** 0.5)


def best_match(gt: list[tuple[float, float, float, float]], pred: list[tuple[float, float, float, float]]) -> tuple[tuple[int, ...], list[float]]:
    best_perm = ()
    best_scores: list[float] = []
    best_total = -1.0
    for perm in permutations(range(len(pred)), len(gt)):
        scores = [iou(gt[i], pred[perm[i]]) for i in range(len(gt))]
        total = float(sum(scores))
        if total > best_total:
            best_total = total
            best_perm = perm
            best_scores = scores
    return best_perm, best_scores


def select_fixed3(
    boxes: list[tuple[float, float, float, float]],
    confs: list[float],
    image_size: tuple[int, int],
) -> tuple[list[tuple[float, float, float, float]], list[float], str]:
    width, height = image_size
    candidates = []
    for box, conf in zip(boxes, confs):
        x1, y1, x2, y2 = box
        bw, bh = x2 - x1, y2 - y1
        area = bw * bh
        if bw < 22 or bh < 22:
            continue
        if area < 550:
            continue
        if bw > width * 0.38 or bh > height * 0.38:
            continue
        ratio = bw / max(1.0, bh)
        if ratio < 0.35 or ratio > 2.6:
            continue
        candidates.append((box, conf, area))

    if len(candidates) >= 4:
        areas = np.array([item[2] for item in candidates], dtype=np.float32)
        median_area = float(np.median(areas))
        candidates = [
            item
            for item in candidates
            if item[2] >= median_area * 0.35 and item[2] <= median_area * 2.8
        ]

    if len(candidates) < 3:
        return [item[0] for item in candidates], [item[1] for item in candidates], "FAIL_LT3"

    ranked = sorted(candidates, key=lambda item: item[1] * (item[2] ** 0.5), reverse=True)
    selected = ranked[:3]
    return [item[0] for item in selected], [item[1] for item in selected], "FIXED3"
