param(
    [ValidateSet("auto", "cpu", "gpu")]
    [string]$Target = "auto",
    [int]$Port = 8888,
    [string[]]$PipArg = @()
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Test-PythonImports {
    param(
        [string]$PythonPath,
        [string]$Code
    )
    if (-not $PythonPath -or -not (Test-Path $PythonPath)) { return $false }
    try {
        & $PythonPath -c $Code *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Has-NvidiaGpu {
    $nvidia = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if (-not $nvidia) { return $false }
    & nvidia-smi -L *> $null
    return $LASTEXITCODE -eq 0
}

$InstallTarget = $Target
if ($InstallTarget -eq "auto") {
    $InstallTarget = if (Has-NvidiaGpu) { "gpu" } else { "cpu" }
}
$StartMode = if ($Target -eq "auto") { "auto" } else { $InstallTarget }

$CpuPython = Join-Path $Root ".venv_paddle\Scripts\python.exe"
$GpuPython = Join-Path $Root ".venv_paddle_gpu\Scripts\python.exe"
$ImportCode = "import ultralytics, paddleocr, paddlex, cv2, PIL, numpy"

$Ready = $false
$SelectedPython = ""
if ($InstallTarget -eq "gpu") {
    $SelectedPython = $GpuPython
    $Ready = Test-PythonImports $GpuPython $ImportCode
} else {
    $SelectedPython = $CpuPython
    $Ready = Test-PythonImports $CpuPython $ImportCode
}

if (-not $Ready) {
    Write-Host "Backend environment is missing or incomplete (PIL/cv2/numpy etc). Installing $InstallTarget environment..."
    $argsList = @("-Target", $InstallTarget)
    if ($SelectedPython -and (Test-Path $SelectedPython)) {
        Write-Host "Existing backend environment failed import checks. Recreating it..."
        $argsList += "-Recreate"
    }
    foreach ($arg in $PipArg) {
        $argsList += "-PipArg"
        $argsList += $arg
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\bootstrap_windows.ps1" @argsList

    # 修复后重新验证
    if ($InstallTarget -eq "gpu") {
        $Ready = Test-PythonImports $GpuPython $ImportCode
    } else {
        $Ready = Test-PythonImports $CpuPython $ImportCode
    }
    if (-not $Ready) {
        Write-Host "[FAIL] Backend environment repair failed. Required deps still missing." -ForegroundColor Red
        Write-Host "       Try running install-env.cmd manually." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

if ($Target -eq "auto" -and $InstallTarget -eq "gpu" -and -not (Test-PythonImports $CpuPython $ImportCode)) {
    Write-Host "CPU fallback environment is missing. Installing CPU environment for auto fallback..."
    $fallbackArgs = @("-Target", "cpu")
    foreach ($arg in $PipArg) {
        $fallbackArgs += "-PipArg"
        $fallbackArgs += $arg
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\bootstrap_windows.ps1" @fallbackArgs
}

# ── 检查 pipeline 后端依赖（非阻塞，仅提示）─────────────────
$PipelineDepsOk = Test-PythonImports $SelectedPython "import fastapi, uvicorn, psutil"
if (-not $PipelineDepsOk) {
    Write-Host "[INFO] Pipeline backend deps (fastapi/uvicorn/psutil) not installed. Run install-env.cmd to add them." -ForegroundColor Yellow
}

Write-Host "Starting backend in $StartMode mode on port $Port..."
& powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start_backend.ps1" -Mode $StartMode -Port $Port
