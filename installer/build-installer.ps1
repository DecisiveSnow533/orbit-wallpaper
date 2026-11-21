# Crea l'installer: .\installer\build-installer.ps1 [-Version 1.2.3] [-SkipBuild]
# Richiede Inno Setup 6 (https://jrsoftware.org/isinfo.php). Il risultato è in dist-installer\.
param(
    [string]$Version = "",
    [switch]$SkipBuild
)
$root = Split-Path -Parent $PSScriptRoot
if (-not $Version) {     # di base la versione scritta in src-tauri\Cargo.toml
    $Version = (Select-String -Path "$root\src-tauri\Cargo.toml" -Pattern '^version = "([^"]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
}
if (-not $SkipBuild) { & "$root\build.ps1" }
if (-not (Test-Path "$root\dist\SpotifyOrbit.exe")) { throw "Manca dist\SpotifyOrbit.exe: esegui prima build.ps1" }

$candidates = @(
    "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)
$iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { $iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source }
if (-not $iscc) { throw "Inno Setup 6 non trovato. Installalo (es. 'winget install JRSoftware.InnoSetup') e riprova." }

& $iscc "/DMyAppVersion=$Version" "$PSScriptRoot\SpotifyOrbit.iss"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup non è riuscito (codice $LASTEXITCODE)" }
Write-Host "Fatto: $root\dist-installer\SpotifyOrbit-Setup-$Version.exe"
