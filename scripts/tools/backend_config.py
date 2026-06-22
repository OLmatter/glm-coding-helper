from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


TRUE_VALUES = {"1", "true", "yes", "on", "y"}
FALSE_VALUES = {"0", "false", "no", "off", "n"}


@dataclass(frozen=True)
class BackendConfig:
    host: str
    port: int
    ocr_mode: str
    yolo_device: str
    yolo_imgsz: int
    cpu_workers: int
    cpu_model: str
    cpu_fast_model: str
    cpu_fallback_model: str
    gpu_model: str
    gpu_device: str
    constrained_decode: bool
    gpu_available: bool
    gpu_reason: str
    cpu_count: int
    source: str

    def to_dict(self) -> dict:
        return asdict(self)


def parse_bool(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    normalized = value.strip().lower()
    if normalized in TRUE_VALUES:
        return True
    if normalized in FALSE_VALUES:
        return False
    raise ValueError(f"invalid boolean value: {value!r}")


def parse_int(value: str | None, default: int, minimum: int | None = None) -> int:
    if value is None or value == "":
        result = default
    else:
        result = int(value)
    if minimum is not None and result < minimum:
        raise ValueError(f"value must be >= {minimum}: {result}")
    return result


def default_cpu_workers(cpu_count: int | None = None) -> int:
    count = cpu_count or os.cpu_count() or 1
    if count <= 2:
        return 1
    if count <= 6:
        return 2
    return min(3, max(1, count - 2))


def _venv_python(name: str) -> Path:
    if os.name == "nt":
        return ROOT / name / "Scripts" / "python.exe"
    return ROOT / name / "bin" / "python"


def _gpu_probe_env() -> dict[str, str]:
    env = os.environ.copy()
    paddle_home = ROOT / ".paddle_home_gpu"
    paddlex_cache = ROOT / ".paddlex_cache_gpu"
    env["HOME"] = str(paddle_home)
    env["USERPROFILE"] = str(paddle_home)
    env["PADDLE_HOME"] = str(paddle_home / ".cache" / "paddle")
    env["PADDLE_PDX_CACHE_HOME"] = str(paddlex_cache)
    env.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    return env


def detect_gpu(timeout: float = 45.0) -> tuple[bool, str]:
    # macOS 没有 CUDA：PaddlePaddle 在 mac 上只提供 CPU wheel，
    # paddlepaddle-gpu 和 nvidia-* 依赖也无法安装。直接跳过 GPU 探测。
    if sys.platform == "darwin":
        return False, "GPU unavailable on macOS (PaddlePaddle ships CPU-only wheels)"

    if parse_bool(os.environ.get("CNCAPTCHA_SKIP_GPU_DETECT"), False):
        return False, "skipped by CNCAPTCHA_SKIP_GPU_DETECT"

    gpu_python = _venv_python(".venv_paddle_gpu")
    if not gpu_python.exists():
        return False, f"missing {gpu_python}"

    env = _gpu_probe_env()

    probe = (
        "import paddle; "
        "ok = paddle.is_compiled_with_cuda(); "
        "count = paddle.device.cuda.device_count() if ok else 0; "
        "print('ok' if ok and count > 0 else 'no_cuda', count)"
    )
    try:
        proc = subprocess.run(
            [str(gpu_python), "-c", probe],
            cwd=str(ROOT),
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=min(timeout, 10.0),
            check=False,
        )
    except Exception as exc:
        return False, f"probe failed: {exc}"

    output = (proc.stdout or "").strip()
    if not (proc.returncode == 0 and output.startswith("ok")):
        reason = output or (proc.stderr or "").strip().splitlines()[-1:] or [f"returncode={proc.returncode}"]
        return False, str(reason[0])

    if not parse_bool(os.environ.get("CNCAPTCHA_STRICT_GPU_DETECT"), True):
        return True, output

    model_name = os.environ.get("CNCAPTCHA_GPU_OCR_MODEL", "PP-OCRv5_server_rec")
    device = os.environ.get("CNCAPTCHA_GPU_OCR_DEVICE", "gpu:0")
    engine = os.environ.get("CNCAPTCHA_GPU_OCR_ENGINE", "paddle_dynamic")
    ocr_probe = (
        "from paddleocr import TextRecognition; "
        f"r = TextRecognition(model_name={model_name!r}, device={device!r}, engine={engine!r}); "
        "close = getattr(r, 'close', None); "
        "close() if callable(close) else None; "
        "print('ocr_ok')"
    )
    try:
        ocr_proc = subprocess.run(
            [str(gpu_python), "-c", ocr_probe],
            cwd=str(ROOT),
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"GPU OCR probe timeout after {timeout:.0f}s"
    except Exception as exc:
        return False, f"GPU OCR probe failed: {exc}"

    if ocr_proc.returncode == 0 and "ocr_ok" in (ocr_proc.stdout or ""):
        return True, output + "; ocr_ok"

    reason_lines = [
        line.strip()
        for line in ((ocr_proc.stderr or "") + "\n" + (ocr_proc.stdout or "")).splitlines()
        if line.strip()
    ]
    reason = reason_lines[-1] if reason_lines else f"returncode={ocr_proc.returncode}"
    return False, f"GPU OCR unavailable: {reason}"


def resolve_backend_config(source: str = "env") -> BackendConfig:
    cpu_count = os.cpu_count() or 1
    requested_mode = os.environ.get("CNCAPTCHA_OCR_MODE", "auto").strip().lower()
    if requested_mode in {"cpu", "cpu_parallel", "cpu-pool"}:
        gpu_available, gpu_reason = False, "not probed because CPU mode was requested"
    else:
        gpu_available, gpu_reason = detect_gpu()

    if requested_mode in {"", "auto"}:
        ocr_mode = "gpu" if gpu_available else "cpu_parallel"
    elif requested_mode in {"cpu", "cpu_parallel", "cpu-pool"}:
        ocr_mode = "cpu_parallel"
    elif requested_mode == "gpu":
        ocr_mode = "gpu"
    else:
        raise ValueError(f"invalid CNCAPTCHA_OCR_MODE={requested_mode!r}; use auto, gpu, or cpu_parallel")

    yolo_device_env = os.environ.get("CNCAPTCHA_YOLO_DEVICE", "").strip()
    if yolo_device_env:
        yolo_device = yolo_device_env
    elif ocr_mode == "gpu" and gpu_available:
        yolo_device = "0"
    else:
        yolo_device = "cpu"

    return BackendConfig(
        host=os.environ.get("CNCAPTCHA_HOST", "0.0.0.0"),
        port=parse_int(os.environ.get("CNCAPTCHA_PORT"), 8888, minimum=1),
        ocr_mode=ocr_mode,
        yolo_device=yolo_device,
        yolo_imgsz=parse_int(os.environ.get("CNCAPTCHA_YOLO_IMGSZ"), 448, minimum=64),
        cpu_workers=parse_int(
            os.environ.get("CNCAPTCHA_CPU_OCR_WORKERS"),
            default_cpu_workers(cpu_count),
            minimum=1,
        ),
        cpu_model=os.environ.get("CNCAPTCHA_CPU_OCR_MODEL", "hybrid"),
        cpu_fast_model=os.environ.get("CNCAPTCHA_CPU_OCR_FAST_MODEL", "PP-OCRv5_mobile_rec"),
        cpu_fallback_model=os.environ.get("CNCAPTCHA_CPU_OCR_FALLBACK_MODEL", "PP-OCRv5_server_rec"),
        gpu_model=os.environ.get("CNCAPTCHA_GPU_OCR_MODEL", "PP-OCRv5_server_rec"),
        gpu_device=os.environ.get("CNCAPTCHA_GPU_OCR_DEVICE", "gpu:0"),
        constrained_decode=parse_bool(os.environ.get("CNCAPTCHA_OCR_CONSTRAINED"), True),
        gpu_available=gpu_available,
        gpu_reason=gpu_reason,
        cpu_count=cpu_count,
        source=source,
    )


def apply_backend_config(config: BackendConfig) -> None:
    os.environ["CNCAPTCHA_HOST"] = config.host
    os.environ["CNCAPTCHA_PORT"] = str(config.port)
    os.environ["CNCAPTCHA_OCR_MODE"] = config.ocr_mode
    os.environ["CNCAPTCHA_YOLO_DEVICE"] = config.yolo_device
    os.environ["CNCAPTCHA_YOLO_IMGSZ"] = str(config.yolo_imgsz)
    os.environ["CNCAPTCHA_CPU_OCR_WORKERS"] = str(config.cpu_workers)
    os.environ["CNCAPTCHA_CPU_OCR_MODEL"] = config.cpu_model
    os.environ["CNCAPTCHA_CPU_OCR_FAST_MODEL"] = config.cpu_fast_model
    os.environ["CNCAPTCHA_CPU_OCR_FALLBACK_MODEL"] = config.cpu_fallback_model
    os.environ["CNCAPTCHA_GPU_OCR_MODEL"] = config.gpu_model
    os.environ["CNCAPTCHA_GPU_OCR_DEVICE"] = config.gpu_device
    constrained = "1" if config.constrained_decode else "0"
    os.environ["CNCAPTCHA_CPU_OCR_CONSTRAINED"] = constrained
    os.environ["CNCAPTCHA_GPU_OCR_CONSTRAINED"] = constrained
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")


def add_backend_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--host", help="HTTP bind host, default CNCAPTCHA_HOST or 0.0.0.0")
    parser.add_argument("--port", type=int, help="HTTP port, default CNCAPTCHA_PORT or 8888")
    parser.add_argument("--mode", choices=["auto", "gpu", "cpu", "cpu_parallel"], help="OCR backend mode")
    parser.add_argument("--cpu-workers", type=int, help="CPU OCR worker processes")
    parser.add_argument("--yolo-device", help="Ultralytics device, for example 0, cuda:0, or cpu")
    parser.add_argument("--yolo-imgsz", type=int, help="YOLO inference image size")
    parser.add_argument("--cpu-model", help="CPU OCR model or hybrid")
    parser.add_argument("--gpu-model", help="GPU OCR model")
    parser.add_argument("--no-constrained", action="store_true", help="Disable prompt-constrained OCR decoding")


def apply_cli_overrides(args: argparse.Namespace) -> None:
    mapping = {
        "host": "CNCAPTCHA_HOST",
        "port": "CNCAPTCHA_PORT",
        "mode": "CNCAPTCHA_OCR_MODE",
        "cpu_workers": "CNCAPTCHA_CPU_OCR_WORKERS",
        "yolo_device": "CNCAPTCHA_YOLO_DEVICE",
        "yolo_imgsz": "CNCAPTCHA_YOLO_IMGSZ",
        "cpu_model": "CNCAPTCHA_CPU_OCR_MODEL",
        "gpu_model": "CNCAPTCHA_GPU_OCR_MODEL",
    }
    for attr, env_name in mapping.items():
        value = getattr(args, attr, None)
        if value is not None:
            os.environ[env_name] = str(value)
    if getattr(args, "no_constrained", False):
        os.environ["CNCAPTCHA_OCR_CONSTRAINED"] = "0"


def print_config(config: BackendConfig) -> None:
    sys.stderr.write("[backend] resolved config: " + repr(config.to_dict()) + "\n")
    sys.stderr.flush()
