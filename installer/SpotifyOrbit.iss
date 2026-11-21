; Installer di Spotify Orbit (Inno Setup 6). Compilalo con installer\build-installer.ps1
#define MyAppName "Spotify Orbit"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif

[Setup]
AppId={{B7C2D0E4-5F3A-4C1B-9A7E-2D8F6A1C4E90}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Spotify Orbit
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist-installer
OutputBaseFilename=SpotifyOrbit-Setup-{#MyAppVersion}
SetupIconFile=..\src\app.ico
UninstallDisplayIcon={app}\SpotifyOrbit.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "it"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
it.DeleteData=Vuoi eliminare anche le impostazioni e il collegamento a Spotify salvati su questo PC?
en.DeleteData=Do you also want to delete the settings and the Spotify link saved on this PC?
it.LaunchApp=Avvia Spotify Orbit
en.LaunchApp=Start Spotify Orbit

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; aggiornando dalla versione Python (1.x) toglie il vecchio motore: ora il programma è un solo file
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\dist\SpotifyOrbit.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\SpotifyOrbit.exe"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\SpotifyOrbit.exe"; Tasks: desktopicon

[Run]
; installazione normale: casella «Avvia Spotify Orbit» nell'ultima pagina
Filename: "{app}\SpotifyOrbit.exe"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent
; aggiornamento automatico (installazione silenziosa): il programma riparte da solo
Filename: "{app}\SpotifyOrbit.exe"; Flags: nowait runasoriginaluser; Check: WizardSilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM SpotifyOrbit.exe"; Flags: runhidden; RunOnceId: "KillApp"
Filename: "{sys}\reg.exe"; Parameters: "delete ""HKCU\Software\Microsoft\Windows\CurrentVersion\Run"" /v SpotifyOrbit /f"; Flags: runhidden; RunOnceId: "DelAutostart"

[Code]
procedure CloseRunningApp;
var
  rc: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM SpotifyOrbit.exe', '', SW_HIDE, ewWaitUntilTerminated, rc);
end;

function InitializeSetup: Boolean;
begin
  CloseRunningApp;       { aggiornamento: chiude la versione in esecuzione prima di sostituire i file }
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    if MsgBox(CustomMessage('DeleteData'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    begin
      DelTree(ExpandConstant('{userappdata}\SpotifyOrbit'), True, True, True);
      DelTree(ExpandConstant('{localappdata}\com.spotifyorbit.wallpaper'), True, True, True);   { dati di WebView2 }
    end;
end;
