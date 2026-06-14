param(
    [ValidateSet("auto", "gpu", "cpu", "cpu_parallel")]
    [string]$Mode = "auto",
    [switch]$Headless,
    [int]$Port = 8888,
    [int]$CpuWorkers = 0,
    [string]$YoloDevice = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Find-AncestorVenvPython {
    param(
        [string]$StartDir,
        [string]$VenvName
    )
    $Dir = (Resolve-Path $StartDir).Path
    for ($i = 0; $i -lt 5 -and $Dir; $i++) {
        $Candidate = Join-Path $Dir "$VenvName\Scripts\python.exe"
        if (Test-Path $Candidate) {
            return $Candidate
        }
        $Parent = Split-Path -Parent $Dir
        if ($Parent -eq $Dir) { break }
        $Dir = $Parent
    }
    return ""
}

function Test-BackendMainPython {
    param([string]$PythonPath)
    if (-not $PythonPath) { return $false }
    if ($PythonPath -ne "python" -and -not (Test-Path $PythonPath)) { return $false }
    try {
        & $PythonPath -c "import ultralytics, PIL, cv2, numpy; from paddleocr import TextRecognition" *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Select-BackendMainPython {
    param(
        [string]$RequestedMode,
        [string]$CpuPython,
        [string]$GpuPython
    )

    if ($RequestedMode -eq "gpu") {
        if ((Test-BackendMainPython $GpuPython)) { return $GpuPython }
        throw "GPU backend environment is missing or incomplete: $GpuPython. Run one-click-start.cmd, or rebuild it with: powershell -ExecutionPolicy Bypass -File scripts\bootstrap_windows.ps1 -Target gpu -Recreate"
    }

    if ($RequestedMode -eq "cpu" -or $RequestedMode -eq "cpu_parallel") {
        if ((Test-BackendMainPython $CpuPython)) { return $CpuPython }
        throw "CPU backend environment is missing or incomplete: $CpuPython. Run one-click-start.cmd, or rebuild it with: powershell -ExecutionPolicy Bypass -File scripts\bootstrap_windows.ps1 -Target cpu -Recreate"
    }

    if ((Test-BackendMainPython $GpuPython)) { return $GpuPython }
    if ((Test-BackendMainPython $CpuPython)) { return $CpuPython }
    throw "No usable backend environment found. Run one-click-start.cmd to install or repair the backend environment."
}

if (-not $env:CNCAPTCHA_CPU_OCR_PYTHON) {
    $CpuPython = Find-AncestorVenvPython -StartDir $Root -VenvName ".venv_paddle"
    if ($CpuPython) { $env:CNCAPTCHA_CPU_OCR_PYTHON = $CpuPython }
}
if (-not $env:CNCAPTCHA_GPU_OCR_PYTHON) {
    $GpuPython = Find-AncestorVenvPython -StartDir $Root -VenvName ".venv_paddle_gpu"
    if ($GpuPython) { $env:CNCAPTCHA_GPU_OCR_PYTHON = $GpuPython }
}

$MainPython = Select-BackendMainPython `
    -RequestedMode $Mode `
    -CpuPython $env:CNCAPTCHA_CPU_OCR_PYTHON `
    -GpuPython $env:CNCAPTCHA_GPU_OCR_PYTHON

$argsList = @("scripts\tools\start_backend.py", "--mode", $Mode, "--port", "$Port")
if ($Headless) { $argsList += "--headless" }
if ($CpuWorkers -gt 0) {
    $argsList += "--cpu-workers"
    $argsList += "$CpuWorkers"
}
if ($YoloDevice) {
    $argsList += "--yolo-device"
    $argsList += $YoloDevice
}

Write-Host "Using backend Python: $MainPython"
& $MainPython @argsList
