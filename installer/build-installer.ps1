# Crea l'installer: .\installer\build-installer.ps1 [-Version 1.2.3] [-SkipBuild]
# Richiede Inno Setup 6 (https://jrsoftware.org/isinfo.php). Il risultato è in dist-installer\.
param(
    [string]$Version = "1.0.0",
    [switch]$SkipBuild
)
$root = Split-Path -Parent $PSScriptRoot
if (-not $SkipBuild) { & "$root\build.ps1" }
if (-not (Test-Path "$root\dist\SpotifyOrbit\SpotifyOrbit.exe")) { throw "Manca dist\SpotifyOrbit\SpotifyOrbit.exe: esegui prima build.ps1" }

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
