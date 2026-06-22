param(
    [string]$OutputDir = "dist",
    [switch]$NoZip
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$VenvPython = Join-Path $Root ".venv_paddle\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    throw "Missing .venv_paddle. Run one-click-start.cmd first."
}

Write-Host "Checking local CPU environment before packaging..."
& $VenvPython -c "import ultralytics, paddleocr, paddlex, cv2, PIL, numpy; print('local imports ok')"
if ($LASTEXITCODE -ne 0) {
    throw "The local .venv_paddle is incomplete. Run one-click-start.cmd again, then rerun this script."
}

$Weight = Join-Path $Root "models\weights\yolo-captcha-detector.pt"
if (-not (Test-Path $Weight)) {
    throw "Missing model weight: $Weight"
}

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$OutRoot = Join-Path $Root $OutputDir
$PackageName = "glm-coding-helper-portable-cpu-$Stamp"
$PackageDir = Join-Path $OutRoot $PackageName

if (Test-Path $PackageDir) {
    Remove-Item -LiteralPath $PackageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $PackageDir | Out-Null

$Include = @(
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
    "scripts",
    "docs",
    "models",
    "backend",
    ".paddlex_cache_cpu",
    ".paddle_home"
)

$KnownRootCmdItems = @("one-click-start.cmd", "start-backend-pipeline-gui.cmd")
$ExtraRootCmdItems = Get-ChildItem -LiteralPath $Root -Filter "*.cmd" -File |
    Where-Object { $KnownRootCmdItems -notcontains $_.Name } |
    ForEach-Object { $_.Name }
foreach ($item in $ExtraRootCmdItems) {
    $Include += $item
}

foreach ($Item in $Include) {
    $Src = Join-Path $Root $Item
    if (-not (Test-Path $Src)) { continue }
    $Dst = Join-Path $PackageDir $Item
    Write-Host "Copying $Item"
    if ((Get-Item $Src).PSIsContainer) {
        robocopy $Src $Dst /E /XD __pycache__ /XF *.pyc *.pyo /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $Item with exit code $LASTEXITCODE" }
    } else {
        $DstParent = Split-Path -Parent $Dst
        if ($DstParent) { New-Item -ItemType Directory -Path $DstParent -Force | Out-Null }
        Copy-Item -LiteralPath $Src -Destination $Dst -Force
    }
}

New-Item -ItemType Directory -Path (Join-Path $PackageDir "dataset") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $PackageDir "logs") -Force | Out-Null

$Guide = @"
GLM Coding Helper portable CPU package

1. Install or update Tampermonkey script from glm-coding-helper.user.js.
2. Double-click one-click-start.cmd on first run so the backend environment is created on this computer.
3. After that, use start-backend-pipeline-gui.cmd to launch the pipeline backend with GUI.
4. Open the GLM Coding page from your normal browser session.

macOS:
1. Run chmod +x one-click-start.command start-backend-pipeline-gui.command scripts/setup_backend_macos.sh if Finder blocks the scripts.
2. Double-click one-click-start.command on first run, then use start-backend-pipeline-gui.command.

This package includes local model/cache files, but it does not ship a copied Windows venv.
Copied venvs are not portable and may point at the packager's Python path.
"@
Set-Content -LiteralPath (Join-Path $PackageDir "PORTABLE_README.txt") -Value $Guide -Encoding UTF8

$Size = (Get-ChildItem $PackageDir -Recurse -Force -File | Measure-Object Length -Sum).Sum
Write-Host ("Portable folder ready: {0}" -f $PackageDir)
Write-Host ("Uncompressed size: {0:N1} MB" -f ($Size / 1MB))

if (-not $NoZip) {
    $ZipPath = Join-Path $OutRoot "$PackageName.zip"
    if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    Write-Host "Creating zip: $ZipPath"
    $SevenZip = Get-Command 7z -ErrorAction SilentlyContinue
    $SevenZipA = Get-Command 7za -ErrorAction SilentlyContinue
    if ($SevenZip) {
        & $SevenZip.Source a -tzip $ZipPath $PackageDir | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "7z failed with exit code $LASTEXITCODE" }
    } elseif ($SevenZipA) {
        & $SevenZipA.Source a -tzip $ZipPath $PackageDir | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "7za failed with exit code $LASTEXITCODE" }
    } else {
        Push-Location $OutRoot
        try {
            tar -a -cf "$PackageName.zip" $PackageName
            if ($LASTEXITCODE -ne 0) { throw "tar zip failed with exit code $LASTEXITCODE" }
        } finally {
            Pop-Location
        }
    }
    $ZipSize = (Get-Item $ZipPath).Length
    Write-Host ("Zip size: {0:N1} MB" -f ($ZipSize / 1MB))
}
