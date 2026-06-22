param(
    [string]$OutputDir = "dist",
    [switch]$SkipPortableCpu
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

$OutRoot = Join-Path $Root $OutputDir
New-Item -ItemType Directory -Path $OutRoot -Force | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"

function Copy-PackageItems {
    param(
        [string]$PackageDir,
        [string[]]$Items
    )
    New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
    foreach ($item in $Items) {
        $src = Join-Path $Root $item
        if (-not (Test-Path $src)) { continue }
        $dst = Join-Path $PackageDir $item
        Write-Host "Copying $item"
        if ((Get-Item $src).PSIsContainer) {
            robocopy $src $dst /E /XD __pycache__ /XF *.pyc *.pyo /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $item with exit code $LASTEXITCODE" }
        } else {
            $dstParent = Split-Path -Parent $dst
            if ($dstParent) { New-Item -ItemType Directory -Path $dstParent -Force | Out-Null }
            Copy-Item -LiteralPath $src -Destination $dst -Force
        }
    }
    New-Item -ItemType Directory -Path (Join-Path $PackageDir "dataset") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $PackageDir "logs") -Force | Out-Null
}

function New-Zip {
    param(
        [string]$PackageDir,
        [string]$ZipPath
    )
    if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    $sevenZip = Get-Command 7z -ErrorAction SilentlyContinue
    $sevenZipA = Get-Command 7za -ErrorAction SilentlyContinue
    if ($sevenZip) {
        & $sevenZip.Source a -tzip $ZipPath $PackageDir | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "7z failed with exit code $LASTEXITCODE" }
    } elseif ($sevenZipA) {
        & $sevenZipA.Source a -tzip $ZipPath $PackageDir | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "7za failed with exit code $LASTEXITCODE" }
    } else {
        $parent = Split-Path -Parent $PackageDir
        $leaf = Split-Path -Leaf $PackageDir
        Push-Location $parent
        try {
            tar -a -cf (Split-Path -Leaf $ZipPath) $leaf
            if ($LASTEXITCODE -ne 0) { throw "tar zip failed with exit code $LASTEXITCODE" }
        } finally {
            Pop-Location
        }
    }
    $zipSize = (Get-Item $ZipPath).Length
    Write-Host ("Created {0} ({1:N1} MB)" -f $ZipPath, ($zipSize / 1MB))
}

$OnlineName = "glm-coding-helper-online-installer-$Stamp"
$OnlineDir = Join-Path $OutRoot $OnlineName
if (Test-Path $OnlineDir) { Remove-Item -LiteralPath $OnlineDir -Recurse -Force }

$CommonItems = @(
    "glm-coding-helper.user.js",
    "scripts\userscripts\glm-coding-captcha-direct.user.js",
    "one-click-start.cmd",
    "one-click-start.command",
    "start-backend-pipeline-gui.cmd",
    "start-backend-pipeline-gui.command",
    "start-backend-pipeline-gui.ps1",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "requirements-backend-cpu.txt",
    "requirements-backend-gpu.txt",
    "scripts",
    "docs",
    "models",
    "backend"
)

$KnownRootCmdItems = @("one-click-start.cmd", "start-backend-pipeline-gui.cmd")
$ExtraRootCmdItems = Get-ChildItem -LiteralPath $Root -Filter "*.cmd" -File |
    Where-Object { $KnownRootCmdItems -notcontains $_.Name } |
    ForEach-Object { $_.Name }
foreach ($item in $ExtraRootCmdItems) {
    $CommonItems += $item
}

Write-Host "Building online installer package..."
Copy-PackageItems -PackageDir $OnlineDir -Items $CommonItems
Remove-Item -LiteralPath (Join-Path $OnlineDir "scripts\__pycache__") -Recurse -Force -ErrorAction SilentlyContinue
$OnlineGuide = @"
GLM Coding Helper online installer package

Recommended:
1. Extract this package to a short path, for example C:\glm-coding-helper.
2. Install or update Tampermonkey script from glm-coding-helper.user.js.
3. Double-click one-click-start.cmd.
4. It will install CPU/GPU backend dependencies automatically when missing, then start the backend.

Important:
- Avoid very deep extract paths. Some backend dependencies contain long internal paths.
- If pip reports "No such file or directory" during install, move the folder to a short path like C:\glm-coding-helper and retry.

Manual:
- one-click-start.cmd installs the CPU backend environment on first run.
- start-backend-pipeline-gui.cmd launches the pipeline backend with a Tk GUI window.
- scripts\start_backend.ps1 starts the backend after environment exists.
- macOS: run chmod +x one-click-start.command start-backend-pipeline-gui.command scripts/setup_backend_macos.sh if Finder blocks the scripts, then double-click one-click-start.command for first setup.
"@
Set-Content -LiteralPath (Join-Path $OnlineDir "ONLINE_INSTALLER_README.txt") -Value $OnlineGuide -Encoding UTF8
New-Zip -PackageDir $OnlineDir -ZipPath (Join-Path $OutRoot "$OnlineName.zip")

if (-not $SkipPortableCpu) {
    Write-Host "Building portable CPU package..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\release\build_portable.ps1" -OutputDir $OutputDir
}
