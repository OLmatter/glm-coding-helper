from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CPU_VENV = ROOT / ".venv_paddle"
GPU_VENV = ROOT / ".venv_paddle_gpu"
CPU_REQ = ROOT / "requirements-backend-cpu.txt"
GPU_REQ = ROOT / "requirements-backend-gpu.txt"
YOLO_WEIGHT = ROOT / "models" / "weights" / "yolo-captcha-detector.pt"


def venv_python(venv: Path) -> Path:
    if os.name == "nt":
        return venv / "Scripts" / "python.exe"
    return venv / "bin" / "python"


def run(cmd: list[str], *, cwd: Path = ROOT) -> None:
    print("+ " + " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=str(cwd), check=True)


def has_nvidia_gpu() -> bool:
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        return False
    try:
        proc = subprocess.run(
            [nvidia_smi, "-L"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
            check=False,
        )
    except Exception:
        return False
    return proc.returncode == 0 and "GPU" in proc.stdout


def create_venv(venv: Path, recreate: bool) -> Path:
    if recreate and venv.exists():
        print(f"Removing existing environment: {venv}", flush=True)
        shutil.rmtree(venv)
    if not venv.exists():
        run([sys.executable, "-m", "venv", str(venv)])
    return venv_python(venv)


def install_requirements(py: Path, req: Path, extra_pip_args: list[str]) -> None:
    if not req.exists():
        raise FileNotFoundError(req)
    run([str(py), "-m", "pip", "install", "-r", str(req), *extra_pip_args])


def smoke_test(py: Path, mode: str) -> None:
    code = (
        "import PIL, cv2, numpy, ultralytics; "
        "from paddleocr import TextRecognition; "
        "print('core imports ok')"
    )
    run([str(py), "-c", code])
    extra_code = (
        "import fastapi, uvicorn, psutil; print('backend deps ok')"
    )
    run([str(py), "-c", extra_code])
    if mode == "gpu":
        gpu_code = (
            "import paddle; "
            "print('cuda_compiled=', paddle.is_compiled_with_cuda()); "
            "print('cuda_count=', paddle.device.cuda.device_count() if paddle.is_compiled_with_cuda() else 0)"
        )
        run([str(py), "-c", gpu_code])
        gpu_ocr_code = (
            "import os; "
            f"os.environ['HOME'] = {str(ROOT / '.paddle_home_gpu')!r}; "
            f"os.environ['USERPROFILE'] = {str(ROOT / '.paddle_home_gpu')!r}; "
            f"os.environ['PADDLE_HOME'] = {str(ROOT / '.paddle_home_gpu' / '.cache' / 'paddle')!r}; "
            f"os.environ['PADDLE_PDX_CACHE_HOME'] = {str(ROOT / '.paddlex_cache_gpu')!r}; "
            "os.environ.setdefault('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK', 'True'); "
            "from paddleocr import TextRecognition; "
            "r = TextRecognition(model_name='PP-OCRv5_server_rec', device='gpu:0', engine='paddle_dynamic'); "
            "close = getattr(r, 'close', None); "
            "close() if callable(close) else None; "
            "print('gpu ocr ok')"
        )
        run([str(py), "-c", gpu_ocr_code])


def check_assets() -> None:
    missing: list[Path] = []
    if not YOLO_WEIGHT.exists():
        missing.append(YOLO_WEIGHT)
    if missing:
        print("\nMissing model assets:", flush=True)
        for path in missing:
            print(f"  - {path}", flush=True)
        print("Place the detector weight at the path above before starting the backend.", flush=True)
    else:
        print(f"Model assets ok: {YOLO_WEIGHT}", flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create local backend environments for CNCAPTCHA.")
    parser.add_argument("--target", choices=["auto", "cpu", "gpu", "both"], default="auto")
    parser.add_argument("--recreate", action="store_true", help="Delete and recreate selected virtualenvs")
    parser.add_argument("--skip-install", action="store_true", help="Create venvs but do not install packages")
    parser.add_argument("--no-smoke-test", action="store_true", help="Skip import tests after installation")
    parser.add_argument(
        "--pip-arg",
        action="append",
        default=[],
        help="Extra argument appended to pip install, repeatable. Example: --pip-arg -i --pip-arg https://pypi.tuna.tsinghua.edu.cn/simple",
    )
    args = parser.parse_args(argv)

    target = args.target
    if target == "auto":
        target = "gpu" if has_nvidia_gpu() else "cpu"
        print(f"Auto selected target: {target}", flush=True)

    selected = ["cpu", "gpu"] if target == "both" else [target]

    for mode in selected:
        venv = GPU_VENV if mode == "gpu" else CPU_VENV
        req = GPU_REQ if mode == "gpu" else CPU_REQ
        print(f"\n=== Setting up {mode.upper()} backend environment ===", flush=True)
        py = create_venv(venv, args.recreate)
        if not args.skip_install:
            run([str(py), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])
            install_requirements(py, req, args.pip_arg)
        if not args.no_smoke_test:
            smoke_test(py, mode)

    check_assets()

    print("\nDone.", flush=True)
    print("Start GUI backend:", flush=True)
    print("  python scripts\\tools\\start_backend.py --mode auto", flush=True)
    print("Start headless backend:", flush=True)
    print("  python scripts\\tools\\start_backend.py --headless --mode auto", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
