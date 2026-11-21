# Spotify Orbit

**Italiano** · [English below](#english)

Uno sfondo animato per il desktop di Windows che reagisce a ciò che stai ascoltando: copertina al centro con un anello che segue lo spettro audio, colori presi dalla copertina, testi sincronizzati a tempo, orologio e widget con i brani recenti o la coda di Spotify.

Funziona come vero sfondo del desktop (sta *dietro* alle icone), non come finestra. Non è un'app ufficiale di Spotify e non è affiliata a Spotify.

## Cosa fa

- **Sfondo vivo dietro alle icone**, anche su più monitor (un profilo diverso per ciascuno).
- **Anello e spettro audio in tempo reale**, ascoltando l'uscita audio del PC.
- **9 sfondi** (aurora, sfumature, onde, viaggio nello spazio, synthwave, bokeh, copertina sfocata, stelle, nero) con colori dalla copertina o personalizzati.
- **Testi sincronizzati** (da [LRCLIB](https://lrclib.net)), con carattere e dimensione a scelta.
- **Orologio e data**, ora/data on-off, formato e posizione.
- **Widget brani**: disco che gira, carte con copertine, linea del tempo, oppure **coda di Spotify** con i prossimi brani. Dimensione, posizione, quantità e trasparenza regolabili.
- **Profili salvabili** (es. «Serata», «Lavoro»), richiamabili con un clic dall'icona vicino all'orologio.
- Si mette in pausa quando una finestra copre il desktop, per non consumare risorse.

Legge brano, copertina e avanzamento da Windows (qualunque player che usi i controlli multimediali di sistema, Spotify compreso). Funziona anche senza collegare nulla: il collegamento a Spotify serve **solo** per la coda dei prossimi brani.

## Installazione

Scarica dalla pagina [Releases](../../releases):

- **`SpotifyOrbit-Setup-x.y.z.exe`**: installer (non richiede i permessi di amministratore).
- **`SpotifyOrbit-portable-x.y.z.zip`**: versione portatile, estrai e avvia `SpotifyOrbit.exe`.

Dopo l'avvio compare un'icona vicino all'orologio: **clic** per le impostazioni, **clic destro** per profili, pausa dello sfondo, riavvio e uscita.

> **Avvisi di Windows / antivirus.** Il programma non è firmato digitalmente, quindi SmartScreen può mostrare «Windows ha protetto il PC» (clicca *Ulteriori informazioni → Esegui comunque*). Gli eseguibili creati con PyInstaller a volte vengono segnalati per errore da alcuni antivirus. Il codice è qui sotto, puoi controllarlo o compilarlo da solo.

### Requisiti

- Windows 11 (provato su 24H2). Su Windows 10 il metodo di aggancio al desktop è diverso e **non è stato provato**.
- Microsoft Edge (c'è in Windows) per mostrare l'interfaccia. Se manca, il programma prova con Chrome, ma non è stato verificato.

## Coda di Spotify (facoltativo)

Windows non sa quali brani arrivano dopo, quindi la coda vera si legge dal tuo account tramite la Web API di Spotify. Si configura una volta sola da *Impostazioni → Coda di Spotify*:

1. Su [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) crea un'app (scegli «Web API»).
2. Tra i **Redirect URI** aggiungi `http://127.0.0.1:8777/callback`.
3. Incolla il **Client ID** nelle impostazioni e premi *Collega Spotify*.
4. In *Brani recenti e coda* scegli «Coda di Spotify».

L'accesso usa il flusso PKCE: non servono segreti, vengono richiesti solo i permessi di lettura (`user-read-playback-state`, `user-read-currently-playing`). Client ID e token restano sul tuo PC in `%APPDATA%\SpotifyOrbit\spotify.json`; «Scollega» li cancella. Le app Spotify in modalità sviluppo possono richiedere un account Premium per il proprietario dell'app.

## Privacy

Tutto gira in locale: il programma apre un server solo su `127.0.0.1`. Le uniche connessioni in uscita sono quelle verso LRCLIB (ricerca dei testi, con titolo e artista del brano) e, se la attivi, verso Spotify per la coda.

## Compilare da sorgente

Serve Python 3.12 su Windows.

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\build.ps1                                   # crea dist\SpotifyOrbit\SpotifyOrbit.exe
.\installer\build-installer.ps1 -SkipBuild    # facoltativo: crea l'installer (serve Inno Setup 6)
```

Per provare senza compilare: `.\.venv\Scripts\python src\server.py`.

Il codice è in `src/` (`server.py` motore e server locale, `desktop.py` aggancio al desktop, `ui/` interfaccia). Pubblicare una versione: crea un tag `vX.Y.Z` e GitHub Actions (`.github/workflows/release.yml`) compila installer e zip.

## Limiti noti

- I brani «recenti» sono ricordati per ogni finestra-sfondo: con più monitor ciascuno parte dalla propria cronologia.
- La coda mostra al massimo 8 brani e si aggiorna a intervalli (5–30 s a scelta).

---

## English

**Spotify Orbit** is an animated, audio-reactive desktop wallpaper for Windows (it sits *behind* your desktop icons): album art with a live spectrum ring, colors taken from the cover, time-synced lyrics, clock, and a widget with recent tracks or your Spotify queue. Multi-monitor, saveable profiles, 9 backgrounds, tray icon for settings. Not affiliated with Spotify.

- **Install:** grab the installer or the portable zip from [Releases](../../releases). The app is unsigned, so SmartScreen may warn you.
- **Requirements:** Windows 11 (tested on 24H2), Microsoft Edge.
- **Queue (optional):** Windows doesn't expose Spotify's upcoming tracks, so the real queue needs your own Spotify developer app (PKCE flow, read-only scopes, redirect URI `http://127.0.0.1:8777/callback`). Everything else works without it.
- **Build:** `python -m venv .venv`, `pip install -r requirements.txt`, `.\build.ps1`, optionally `.\installer\build-installer.ps1 -SkipBuild` (needs Inno Setup 6).
- **Privacy:** everything runs locally; the only outgoing requests are lyrics lookups (LRCLIB) and, if enabled, the Spotify queue.
