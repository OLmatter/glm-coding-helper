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

function Warn-LongInstallPath {
    # Some backend deps contain very deep package paths. A long extract path can hit
    # Windows MAX_PATH during pip install even when all release files are present.
    if ($Root.Length -gt 70) {
        Write-Host "[WARN] The current folder path is quite long:" -ForegroundColor Yellow
        Write-Host "       $Root" -ForegroundColor Yellow
        Write-Host "       If pip reports 'No such file or directory', move this folder to a short path like C:\glm-coding-helper and retry." -ForegroundColor Yellow
        Write-Host ""
    }
}

function Assert-RequiredFiles {
    $required = @(
        "scripts\bootstrap_windows.ps1",
        "scripts\start_backend.ps1",
        "scripts\setup_backend.py",
        "requirements-backend-cpu.txt",
        "requirements-backend-gpu.txt"
    )
    $missing = @()
    foreach ($rel in $required) {
        if (-not (Test-Path (Join-Path $Root $rel))) {
            $missing += $rel
        }
    }
    if ($missing.Count -gt 0) {
        Write-Host "[FAIL] Release package is incomplete. Missing files:" -ForegroundColor Red
        foreach ($item in $missing) {
            Write-Host "       - $item" -ForegroundColor Red
        }
        Write-Host "Please re-extract the full latest release zip and retry." -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
}

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

function Test-ForeignVenv {
    param(
        [string]$VenvDir
    )
    if (-not $VenvDir -or -not (Test-Path $VenvDir)) { return $false }
    $cfg = Join-Path $VenvDir "pyvenv.cfg"
    if (-not (Test-Path $cfg)) { return $true }
    try {
        $text = Get-Content -LiteralPath $cfg -Raw -Encoding UTF8
    } catch {
        return $true
    }
    foreach ($line in ($text -split "`r?`n")) {
        if ($line -match '^(executable|command)\s*=\s*(.+)$') {
            $value = $Matches[2].Trim()
            if ($value -match 'C:\\Users\\17336\\') { return $true }
            if ($line -match '^executable\s*=' -and -not (Test-Path $value)) { return $true }
        }
        if ($line -match '^command\s*=.*\s-m\s+venv\s+(.+)$') {
            $createdAt = $Matches[1].Trim().Trim('"')
            try {
                $expected = (Resolve-Path -LiteralPath $VenvDir -ErrorAction Stop).Path
                if ([IO.Path]::GetFullPath($createdAt).TrimEnd('\') -ne $expected.TrimEnd('\')) { return $true }
            } catch {
                return $true
            }
        }
    }
    return $false
}

function Has-NvidiaGpu {
    $nvidia = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if (-not $nvidia) { return $false }
    & nvidia-smi -L *> $null
    return $LASTEXITCODE -eq 0
}

function Invoke-Bootstrap {
    param(
        [string]$BootstrapTarget,
        [string]$PythonPath,
        [switch]$ForceRecreate
    )
    $argsList = @("-Target", $BootstrapTarget)
    if ($ForceRecreate -or ($PythonPath -and (Test-Path $PythonPath))) {
        Write-Host "Existing backend environment failed portability/import checks. Recreating it..."
        $argsList += "-Recreate"
    }
    foreach ($arg in $PipArg) {
        $argsList += "-PipArg"
        $argsList += $arg
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\bootstrap_windows.ps1" @argsList
    return $LASTEXITCODE
}

Assert-RequiredFiles
Warn-LongInstallPath

$InstallTarget = $Target
if ($InstallTarget -eq "auto") {
    $InstallTarget = if (Has-NvidiaGpu) { "gpu" } else { "cpu" }
}

$CpuPython = Join-Path $Root ".venv_paddle\Scripts\python.exe"
$GpuPython = Join-Path $Root ".venv_paddle_gpu\Scripts\python.exe"
$CpuVenv = Join-Path $Root ".venv_paddle"
$GpuVenv = Join-Path $Root ".venv_paddle_gpu"
$ImportCode = "import ultralytics, paddleocr, paddlex, cv2, PIL, numpy"

$SelectedPython = if ($InstallTarget -eq "gpu") { $GpuPython } else { $CpuPython }
$SelectedVenv = if ($InstallTarget -eq "gpu") { $GpuVenv } else { $CpuVenv }
$NeedsRecreate = Test-ForeignVenv $SelectedVenv
if ($NeedsRecreate) {
    Write-Host "[WARN] Existing backend environment was created on another machine or in another folder. It will be rebuilt locally." -ForegroundColor Yellow
}
$Ready = (-not $NeedsRecreate) -and (Test-PythonImports $SelectedPython $ImportCode)

if (-not $Ready) {
    Write-Host "Backend environment is missing or incomplete (PIL/cv2/numpy etc). Installing $InstallTarget environment..."
    $bootstrapExit = Invoke-Bootstrap -BootstrapTarget $InstallTarget -PythonPath $SelectedPython -ForceRecreate:$NeedsRecreate
    $SelectedPython = if ($InstallTarget -eq "gpu") { $GpuPython } else { $CpuPython }
    $Ready = Test-PythonImports $SelectedPython $ImportCode

    if (($bootstrapExit -ne 0 -or -not $Ready) -and $Target -eq "auto" -and $InstallTarget -eq "gpu") {
        Write-Host "[WARN] GPU bootstrap failed or remained incomplete. Falling back to CPU environment..." -ForegroundColor Yellow
        $InstallTarget = "cpu"
        $SelectedPython = $CpuPython
        $bootstrapExit = Invoke-Bootstrap -BootstrapTarget "cpu" -PythonPath $SelectedPython
        $Ready = Test-PythonImports $SelectedPython $ImportCode
    }

    if (-not $Ready) {
        Write-Host "[FAIL] Backend environment repair failed. Required deps still missing." -ForegroundColor Red
        if ($Target -eq "auto") {
            Write-Host "       Auto mode already attempted GPU/CPU fallback." -ForegroundColor Red
        }
        Write-Host "       Try re-extracting the latest release and rerun one-click-start.cmd." -ForegroundColor Red
        Write-Host "       If the folder path is deep, move it to C:\glm-coding-helper and retry." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

if ($Target -eq "auto" -and $InstallTarget -eq "gpu" -and -not (Test-PythonImports $CpuPython $ImportCode)) {
    Write-Host "CPU fallback environment is missing. Installing CPU environment for auto fallback..."
    $fallbackExit = Invoke-Bootstrap -BootstrapTarget "cpu" -PythonPath $CpuPython
    if ($fallbackExit -ne 0) {
        Write-Host "[WARN] CPU fallback environment installation failed. Auto mode will still try GPU first." -ForegroundColor Yellow
    }
}

$PipelineDepsOk = Test-PythonImports $SelectedPython "import fastapi, uvicorn, psutil"
if (-not $PipelineDepsOk) {
    Write-Host "[INFO] Pipeline backend deps (fastapi/uvicorn/psutil) not installed. Run start-backend-pipeline-gui.cmd to add them." -ForegroundColor Yellow
}

$StartMode = if ($Target -eq "auto") { "auto" } else { $InstallTarget }
Write-Host "Starting backend in $StartMode mode on port $Port..."
& powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start_backend.ps1" -Mode $StartMode -Port $Port
