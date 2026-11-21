# Ricostruisce SpotifyOrbit.exe (esegui da PowerShell: .\build.ps1)
$r = $PSScriptRoot
Get-Process SpotifyOrbit -ErrorAction SilentlyContinue | Stop-Process -Force
# usa l'ambiente virtuale del progetto se c'è, altrimenti il Python disponibile (es. su GitHub Actions)
$py = Join-Path $r ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
& $py -m PyInstaller --noconfirm --clean --onedir --noconsole --name SpotifyOrbit `
  --icon "$r\src\app.ico" --add-data "$r\src\ui;ui" --collect-submodules winrt --collect-binaries winrt `
  --hidden-import pyaudiowpatch --hidden-import pystray._win32 --hidden-import desktop --distpath "$r\dist" --workpath "$r\build" --specpath "$r\build" "$r\src\server.py"
if ($LASTEXITCODE -ne 0) { throw "PyInstaller non è riuscito (codice $LASTEXITCODE)" }
Write-Host "Fatto: $r\dist\SpotifyOrbit\SpotifyOrbit.exe"
