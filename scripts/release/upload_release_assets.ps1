param(
    [string]$Repo = "OLmatter/glm-coding-helper",
    [string]$Tag = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

$Assets = @(
    (Get-ChildItem "dist\glm-coding-helper-online-installer-*.zip" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1),
    (Get-ChildItem "dist\glm-coding-helper-portable-cpu-*.zip" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
) | Where-Object { $_ }

if ($Assets.Count -ne 2) {
    throw "Expected two release zip files under dist."
}

if (-not $env:GH_TOKEN) {
    $secure = Read-Host "Paste GitHub token (repo Contents read/write, input hidden)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $env:GH_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if (-not $Tag) {
    $Tag = gh release list --repo $Repo --limit 1 --json tagName --jq ".[0].tagName"
    if (-not $Tag) {
        $Tag = "v" + (Get-Date -Format "yyyy.MM.dd-HHmm")
        Write-Host "No release found. Creating release $Tag..."
        $notes = @"
Release assets:

- Online installer package: small package, installs CPU/GPU environment on first run.
- Portable CPU package: includes local model/cache files; first run creates the CPU backend environment on the user's computer.
"@
        gh release create $Tag --repo $Repo --title "GLM Coding Helper $Tag" --notes $notes
        if ($LASTEXITCODE -ne 0) {
            throw "gh release create failed with exit code $LASTEXITCODE"
        }
    }
}

Write-Host "Repo: $Repo"
Write-Host "Release tag: $Tag"
Write-Host "Assets:"
$Assets | ForEach-Object { Write-Host ("  - {0} ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }

$AssetPaths = $Assets | ForEach-Object { $_.FullName }
gh release upload $Tag @AssetPaths --repo $Repo --clobber
if ($LASTEXITCODE -ne 0) {
    throw "gh release upload failed with exit code $LASTEXITCODE"
}

Write-Host "Upload complete."
