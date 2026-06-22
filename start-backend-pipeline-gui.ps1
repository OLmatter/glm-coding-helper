# GLM Coding Helper - Pipeline Backend GUI Launcher
# Usage: powershell -File start-backend-pipeline-gui.ps1

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "GLM Coding Helper - Pipeline Backend (GUI)" -ForegroundColor Cyan
Write-Host ""

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
        [string]$PythonPath
    )
    if (-not $PythonPath -or -not (Test-Path $PythonPath)) { return $false }
    $venvDir = Split-Path -Parent (Split-Path -Parent $PythonPath)
    $cfg = Join-Path $venvDir "pyvenv.cfg"
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
                $expected = (Resolve-Path -LiteralPath $venvDir -ErrorAction Stop).Path
                if ([IO.Path]::GetFullPath($createdAt).TrimEnd('\') -ne $expected.TrimEnd('\')) { return $true }
            } catch {
                return $true
            }
        }
    }
    return $false
}

$GuiImportCode = "import fastapi, uvicorn, psutil, tkinter"
$VenvCandidates = @(
    "$Root\.venv_paddle_gpu\Scripts\python.exe",
    "$Root\.venv_paddle\Scripts\python.exe",
    "$Root\venv\Scripts\python.exe"
)

$Python = $null
foreach ($candidate in $VenvCandidates) {
    if ((-not (Test-ForeignVenv $candidate)) -and (Test-PythonImports $candidate $GuiImportCode)) {
        $Python = $candidate
        break
    }
}
if (-not $Python) {
    foreach ($candidate in $VenvCandidates) {
        if ((Test-Path $candidate) -and (-not (Test-ForeignVenv $candidate))) {
            $Python = $candidate
            break
        }
    }
}
if (-not $Python) {
    Write-Host "[FAIL] No usable local Python venv found. Run one-click-start.cmd first." -ForegroundColor Red
    Write-Host "       If this came from a portable zip, the bundled venv may have been created on another machine and must be rebuilt locally." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[INFO] Using Python: $Python" -ForegroundColor Gray

$depsCheck = & $Python -c $GuiImportCode 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[WARN] Missing backend dependencies (fastapi/uvicorn/psutil/tkinter)." -ForegroundColor Yellow
    Write-Host "[WARN] Environment needs repair." -ForegroundColor Yellow
    Write-Host ""

    $setupScript = "$Root\scripts\setup_backend.ps1"
    if (Test-Path $setupScript) {
        Write-Host "Install missing dependencies automatically?"
        $choice = Read-Host "Enter 1 to install, or press Enter to exit"
        if ($choice -eq "1") {
            Write-Host "[INFO] Installing pipeline dependencies..." -ForegroundColor Cyan
            $env:PYTHONUTF8 = "1"
            $env:PYTHONIOENCODING = "utf-8"
            & $Python -m pip install fastapi "uvicorn[standard]" psutil --quiet
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[FAIL] Automatic install failed. Please run install-env.cmd manually." -ForegroundColor Red
                Read-Host "Press Enter to exit"
                exit 1
            }
            Write-Host "[OK] Dependencies installed." -ForegroundColor Green
        } else {
            Write-Host "Please run install-env.cmd or pip install fastapi uvicorn psutil and retry." -ForegroundColor Yellow
            Read-Host "Press Enter to exit"
            exit 1
        }
    } else {
        Write-Host "Please run: $Python -m pip install fastapi uvicorn psutil" -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
}

$portLines = netstat -ano | Select-String ":8888 .*LISTENING"
if ($portLines) {
    $line = $portLines[0].ToString().Trim()
    $parts = $line -split '\s+'
    $portPid = $parts[-1]

    $procName = ""
    $procCmd = ""
    try {
        $proc = Get-Process -Id $portPid -ErrorAction SilentlyContinue
        if ($proc) { $procName = $proc.ProcessName }
        $procCmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$portPid" -ErrorAction SilentlyContinue).CommandLine
    } catch {}

    Write-Host ""
    Write-Host "[WARN] Port 8888 is already in use." -ForegroundColor Yellow
    Write-Host "PID      : $portPid"
    if ($procName) { Write-Host "Process  : $procName" }
    if ($procCmd) { Write-Host "Command  : $procCmd" }
    Write-Host ""
    $choice = Read-Host "Enter 1 to stop it and restart backend, or press Enter to exit"
    if ($choice -eq "1") {
        Write-Host "[INFO] Stopping PID $portPid ..." -ForegroundColor Cyan
        Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue
        Start-Sleep 3
        Write-Host "[OK] Process stopped." -ForegroundColor Green
    } else {
        exit 1
    }
}

Write-Host "[INFO] Launching GUI window. Closing the window will also stop the backend child process." -ForegroundColor Green
Write-Host ""

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

& $Python "$Root\backend\gui.py"
