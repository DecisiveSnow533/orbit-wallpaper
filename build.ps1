# Compila Spotify Orbit (Rust + Tauri): .\build.ps1   ->  dist\SpotifyOrbit.exe
# Serve Rust (https://rustup.rs) con gli strumenti C++ di Visual Studio (Build Tools).
$r = $PSScriptRoot
Get-Process SpotifyOrbit -ErrorAction SilentlyContinue | Stop-Process -Force
$cargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
if (-not (Test-Path $cargo)) { $cargo = "cargo" }
Push-Location "$r\src-tauri"
try {
    $ErrorActionPreference = 'Continue'
    # 2>&1: i messaggi di cargo (anche gli errori) passano dall'output normale e finiscono nel log della compilazione
    & $cargo build --release 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { throw "cargo build non è riuscito (codice $LASTEXITCODE)" }
} finally { Pop-Location }
New-Item -ItemType Directory -Force "$r\dist" | Out-Null
Copy-Item "$r\src-tauri\target\release\SpotifyOrbit.exe" "$r\dist\SpotifyOrbit.exe" -Force
Write-Host "Fatto: $r\dist\SpotifyOrbit.exe"
