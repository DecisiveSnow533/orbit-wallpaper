"""Spotify Orbit — motore.

Legge il brano in riproduzione da Windows (SMTC: Spotify o qualunque altro player),
ascolta l'uscita audio del PC (WASAPI loopback) e serve l'interfaccia web su 127.0.0.1.
L'interfaccia si apre in una finestra "app" di Edge (a schermo intero o in finestra).
"""
import asyncio
import base64
import datetime
import hashlib
import html
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

from appversion import __version__ as VERSION

APP = "SpotifyOrbit"
PORT = 8777
DATA = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), APP)
os.makedirs(DATA, exist_ok=True)
SETTINGS_FILE = os.path.join(DATA, "settings.json")
LOG_FILE = os.path.join(DATA, "log.txt")
BASE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(BASE, "ui")
NB = 64  # bande dello spettro


def log(*a):
    try:
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > 200_000:
            os.remove(LOG_FILE)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a) + "\n")
    except Exception:
        pass


class S:
    lock = threading.Lock()
    title = artist = album = app = ""
    key = ""
    ver = 0
    art = b""
    art_mime = "image/jpeg"
    art_ver = 0
    playing = False
    pos = 0.0
    dur = 0.0
    t_ref = time.time()
    media_ok = False
    bands = np.zeros(NB, dtype=np.float32)
    audio_t = 0.0
    audio_dev = ""
    audio_peak = 0.0
    audio_err = ""
    clients = 0
    had_client = False
    last_client_t = time.time()
    only_spotify = False
    cfg = {}
    set_ver = 0
    set_cid = ""
    covered = False
    covered_map = {}        # indice monitor -> desktop coperto da una finestra
    wall_enabled = True
    wall_state = "avvio"
    sp_state = "nocid"      # nocid | off | ok | error  (collegamento a Spotify per la coda)
    sp_msg = ""
    sp_items = []
    sp_ver = 0


# ----------------------------------------------------------------------------
# Impostazioni
# ----------------------------------------------------------------------------
def read_settings():
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def set_autostart(on):
    """Avvio con Windows: voce nella chiave Run dell'utente (solo quando l'utente lo chiede)."""
    if not getattr(sys, "frozen", False):
        return
    import winreg
    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
    try:
        if on:
            winreg.SetValueEx(key, APP, 0, winreg.REG_SZ, f'"{sys.executable}"')
        else:
            try:
                winreg.DeleteValue(key, APP)
            except FileNotFoundError:
                pass
    finally:
        winreg.CloseKey(key)


def write_settings(d, cid=""):
    old_auto = bool(S.cfg.get("autostart", False))
    tmp = SETTINGS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, SETTINGS_FILE)
    S.cfg = d
    S.only_spotify = bool(d.get("onlySpotify", False))
    S.set_cid = cid
    S.set_ver += 1
    if bool(d.get("autostart", False)) != old_auto:
        try:
            set_autostart(bool(d.get("autostart", False)))
        except Exception:
            log("autostart error", traceback.format_exc())


S.cfg = read_settings()
S.only_spotify = bool(S.cfg.get("onlySpotify", False))


# ----------------------------------------------------------------------------
# Media (SMTC)
# ----------------------------------------------------------------------------
LOOP = None


def pick_session(mgr):
    sessions = list(mgr.get_sessions())
    for s in sessions:
        if "spotify" in (s.source_app_user_model_id or "").lower():
            return s
    if S.only_spotify:
        return None
    cur = mgr.get_current_session()
    if cur is not None:
        return cur
    return sessions[0] if sessions else None


async def read_thumbnail(props):
    from winrt.windows.storage.streams import DataReader

    th = props.thumbnail
    if th is None:
        return b"", "image/jpeg"
    stream = await th.open_read_async()
    size = int(stream.size)
    if size <= 0 or size > 12_000_000:
        return b"", "image/jpeg"
    reader = DataReader(stream)
    await reader.load_async(size)
    buf = bytearray(size)
    reader.read_bytes(buf)
    data = bytes(buf)
    mime = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg"
    return data, mime


def set_idle():
    with S.lock:
        if S.key != "":
            S.key = ""
            S.title = S.artist = S.album = S.app = ""
            S.art = b""
            S.ver += 1
            S.art_ver += 1
        S.playing = False
        S.pos = 0.0
        S.dur = 0.0
        S.t_ref = time.time()


async def media_main():
    global LOOP
    from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as SM

    LOOP = asyncio.get_running_loop()
    mgr = await SM.request_async()
    S.media_ok = True
    log("media: manager ok")
    while True:
        try:
            sess = pick_session(mgr)
            if sess is None:
                set_idle()
                await asyncio.sleep(0.8)
                continue
            props = await sess.try_get_media_properties_async()
            title = props.title or ""
            artist = props.artist or ""
            album = props.album_title or ""
            app = sess.source_app_user_model_id or ""
            key = f"{app}|{title}|{artist}|{album}" if (title or artist) else ""
            if key != S.key:
                art, mime = b"", "image/jpeg"
                try:
                    art, mime = await read_thumbnail(props)
                except Exception:
                    log("thumb error", traceback.format_exc())
                with S.lock:
                    S.key, S.title, S.artist, S.album, S.app = key, title, artist, album, app
                    S.art, S.art_mime = art, mime
                    S.ver += 1
                    S.art_ver += 1
                    S.pos = 0.0
                    S.t_ref = time.time()
            tl = sess.get_timeline_properties()
            pb = sess.get_playback_info()
            playing = int(pb.playback_status) == 4
            pos = tl.position.total_seconds()
            dur = (tl.end_time - tl.start_time).total_seconds()
            if playing:
                lu = tl.last_updated_time
                try:
                    pos += max(0.0, (datetime.datetime.now(datetime.timezone.utc) - lu).total_seconds())
                except Exception:
                    pass
            if dur > 0:
                pos = min(pos, dur)
            with S.lock:
                S.playing = playing
                S.pos = max(0.0, pos)
                S.dur = max(0.0, dur)
                S.t_ref = time.time()
        except Exception:
            log("media loop error", traceback.format_exc())
            await asyncio.sleep(1.5)
        await asyncio.sleep(0.3)


async def do_cmd(cmd):
    from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as SM

    mgr = await SM.request_async()
    sess = pick_session(mgr)
    if sess is None:
        return
    if cmd == "playpause":
        await sess.try_toggle_play_pause_async()
    elif cmd == "next":
        await sess.try_skip_next_async()
    elif cmd == "prev":
        await sess.try_skip_previous_async()


def media_thread():
    while True:
        try:
            asyncio.run(media_main())
        except Exception:
            log("media thread crashed", traceback.format_exc())
        time.sleep(2)


# ----------------------------------------------------------------------------
# Audio (WASAPI loopback) -> 64 bande
# ----------------------------------------------------------------------------
NFFT = 4096


def default_output_name(pa, pyaudio):
    wasapi = pa.get_host_api_info_by_type(pyaudio.paWASAPI)
    return pa.get_device_info_by_index(wasapi["defaultOutputDevice"])["name"]


def find_loopback(pa, pyaudio):
    wasapi = pa.get_host_api_info_by_type(pyaudio.paWASAPI)
    spk = pa.get_device_info_by_index(wasapi["defaultOutputDevice"])
    if spk.get("isLoopbackDevice"):
        return spk
    for lb in pa.get_loopback_device_info_generator():
        if spk["name"] in lb["name"]:
            return lb
    raise RuntimeError("nessun dispositivo loopback per " + spk["name"])


def audio_session():
    import pyaudiowpatch as pyaudio

    pa = pyaudio.PyAudio()
    try:
        dev = find_loopback(pa, pyaudio)
        name = default_output_name(pa, pyaudio)
        ch = max(1, int(dev["maxInputChannels"]))
        sr = int(dev["defaultSampleRate"])
        ring = np.zeros(NFFT, dtype=np.float32)
        state = {"new": False, "last": 0.0, "peak": 0.0}
        lk = threading.Lock()

        def cb(data, frames, ti, status):
            a = np.frombuffer(data, dtype=np.float32)
            if a.size:
                if ch > 1:
                    a = a[: (a.size // ch) * ch].reshape(-1, ch).mean(axis=1)
                n = min(a.size, NFFT)
                with lk:
                    ring[:-n] = ring[n:]
                    ring[-n:] = a[-n:]
                    state["new"] = True
                    state["last"] = time.time()
                    state["peak"] = float(np.abs(a).max())
            return (None, pyaudio.paContinue)

        stream = pa.open(format=pyaudio.paFloat32, channels=ch, rate=sr, input=True,
                         input_device_index=dev["index"], frames_per_buffer=1024, stream_callback=cb)
        S.audio_dev = dev["name"]
        S.audio_err = ""
        log("audio: aperto", dev["name"], ch, sr)

        win = np.hanning(NFFT).astype(np.float32)
        binhz = sr / NFFT
        edges = 35.0 * (min(16000.0, sr / 2 - 100) / 35.0) ** (np.arange(NB + 1) / NB)
        lo = np.maximum(1, np.floor(edges[:-1] / binhz).astype(int))
        hi = np.maximum(lo + 1, np.ceil(edges[1:] / binhz).astype(int))
        out = np.zeros(NB, dtype=np.float32)
        last_check = time.time()
        opened = last_check
        while True:
            time.sleep(1 / 60)
            now = time.time()
            with lk:
                fresh = state["new"]
                age = now - state["last"]
                state["new"] = False
                buf = ring.copy() if fresh else None
                S.audio_peak = state["peak"] if age < 0.5 else 0.0
            if buf is not None:
                spec = np.abs(np.fft.rfft(buf * win)) * (4.0 / NFFT)
                for i in range(NB):
                    out[i] = spec[lo[i]:hi[i]].max()
                db = 20.0 * np.log10(out + 1e-6)
                v = np.clip((db + 78.0) / 66.0, 0.0, 1.0)
                S.bands = v.astype(np.float32)
                S.audio_t = now
            elif age > 0.25:
                S.bands = S.bands * 0.8
            if age > 2.5 and now - opened > 5:
                # nessun dato da un po': col silenzio è normale, ma può anche essere un flusso morto
                # (cambio risoluzione/HDMI, sospensione…). Riaprire costa poco, quindi ci riproviamo.
                if S.playing:
                    log("audio: flusso fermo, riapro")
                break
            if now - last_check > 3:  # cambio dispositivo di uscita predefinito?
                last_check = now
                pa2 = pyaudio.PyAudio()
                try:
                    if default_output_name(pa2, pyaudio) != name:
                        log("audio: cambio dispositivo")
                        break
                finally:
                    pa2.terminate()
        stream.stop_stream()
        stream.close()
    finally:
        pa.terminate()


def audio_thread():
    while True:
        try:
            audio_session()
        except Exception:
            S.audio_err = traceback.format_exc().strip().splitlines()[-1]
            log("audio error", traceback.format_exc())
            S.bands = S.bands * 0
            time.sleep(3)


# ----------------------------------------------------------------------------
# Spotify Web API (solo per la coda di riproduzione): accesso PKCE, nessun segreto
# ----------------------------------------------------------------------------
SP_FILE = os.path.join(DATA, "spotify.json")
SP_REDIRECT = f"http://127.0.0.1:{PORT}/callback"
SP_AUTH = "https://accounts.spotify.com/authorize"
SP_TOKEN = "https://accounts.spotify.com/api/token"
SP_QUEUE = "https://api.spotify.com/v1/me/player/queue"
SP_SCOPE = "user-read-playback-state user-read-currently-playing"
SP = {"cid": "", "refresh": "", "access": "", "exp": 0.0, "pending": {}, "poke": False}


def sp_load():
    try:
        with open(SP_FILE, "r", encoding="utf-8") as f:
            d = json.load(f)
        SP["cid"] = str(d.get("cid", ""))
        SP["refresh"] = str(d.get("refresh", ""))
    except Exception:
        pass
    sp_baseline()


def sp_save():
    tmp = SP_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"cid": SP["cid"], "refresh": SP["refresh"]}, f)
    os.replace(tmp, SP_FILE)


def sp_set(state, msg=""):
    if (S.sp_state, S.sp_msg) != (state, msg):
        S.sp_state, S.sp_msg = state, msg
        S.sp_ver += 1


def sp_baseline():
    """Stato di partenza in base a ciò che è salvato."""
    if not SP["cid"]:
        sp_set("nocid")
    elif not SP["refresh"]:
        sp_set("off")
    elif S.sp_state in ("nocid", "off"):
        sp_set("ok")


def sp_items_set(items):
    if items != S.sp_items:
        S.sp_items = items
        S.sp_ver += 1


def sp_http(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def sp_token(params):
    st, body, _ = sp_http(SP_TOKEN, urllib.parse.urlencode(params).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
    try:
        d = json.loads(body or b"{}")
    except Exception:
        d = {}
    return st, d


def sp_take_tokens(d):
    SP["access"] = d["access_token"]
    SP["exp"] = time.time() + int(d.get("expires_in", 3600)) - 60
    if d.get("refresh_token") and d["refresh_token"] != SP["refresh"]:
        SP["refresh"] = d["refresh_token"]
        sp_save()


def sp_login(cid):
    cid = (cid or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{16,64}", cid):
        raise ValueError("Il Client ID non sembra valido (di solito sono 32 caratteri tra lettere e numeri).")
    SP["cid"] = cid
    sp_save()
    now = time.time()
    SP["pending"] = {k: v for k, v in SP["pending"].items() if now - v[1] < 600}
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    SP["pending"][state] = (verifier, now)
    url = SP_AUTH + "?" + urllib.parse.urlencode({
        "client_id": cid, "response_type": "code", "redirect_uri": SP_REDIRECT, "scope": SP_SCOPE,
        "code_challenge_method": "S256", "code_challenge": challenge, "state": state})
    import webbrowser
    webbrowser.open(url)
    sp_baseline()
    return url


def sp_logout():
    SP["refresh"] = SP["access"] = ""
    SP["exp"] = 0.0
    sp_save()
    sp_items_set([])
    sp_set("off" if SP["cid"] else "nocid")


def sp_callback(q):
    """Ritorno dal sito di Spotify: scambia il codice con i token. Ritorna (ok, messaggio)."""
    if (q.get("error") or [""])[0]:
        return False, "Hai annullato l'accesso o Spotify l'ha rifiutato."
    entry = SP["pending"].pop((q.get("state") or [""])[0], None)
    code = (q.get("code") or [""])[0]
    if not entry or not code or time.time() - entry[1] > 600:
        return False, "Richiesta scaduta o non valida. Riprova da Impostazioni → Coda di Spotify."
    try:
        st, d = sp_token({"grant_type": "authorization_code", "code": code, "redirect_uri": SP_REDIRECT,
                          "client_id": SP["cid"], "code_verifier": entry[0]})
    except Exception as e:
        return False, "Non riesco a contattare Spotify: " + str(e)
    if st != 200 or not d.get("access_token"):
        return False, "Spotify ha risposto: " + str(d.get("error_description") or d.get("error") or st)
    SP["refresh"] = ""            # forza il salvataggio del nuovo refresh token
    sp_take_tokens(d)
    sp_set("ok")
    SP["poke"] = True
    return True, "Spotify è collegato."


def sp_img(images):
    best = None
    for im in images or []:
        w = im.get("width") or 0
        if w >= 120 and (best is None or w < best[0]):
            best = (w, im.get("url") or "")
    if best:
        return best[1]
    return (images[0].get("url") or "") if images else ""


def sp_fetch_queue():
    """Scarica la coda. Ritorna i secondi da attendere prima del prossimo tentativo (o None)."""
    if time.time() >= SP["exp"]:
        st, d = sp_token({"grant_type": "refresh_token", "refresh_token": SP["refresh"], "client_id": SP["cid"]})
        if st == 200 and d.get("access_token"):
            sp_take_tokens(d)
        elif st in (400, 401):
            sp_logout()
            sp_set("off", "L'accesso a Spotify è scaduto: ricollega l'account.")
            return None
        else:
            return 30
    st, body, hdr = sp_http(SP_QUEUE, headers={"Authorization": "Bearer " + SP["access"]})
    if st == 200:
        d = json.loads(body)
        items = []
        for it in (d.get("queue") or [])[:8]:
            arts = ", ".join(a.get("name", "") for a in (it.get("artists") or []) if a.get("name"))
            if not arts:
                arts = (it.get("show") or {}).get("publisher") or (it.get("show") or {}).get("name") or ""
            imgs = (it.get("album") or {}).get("images") or it.get("images") or (it.get("show") or {}).get("images") or []
            items.append({"t": it.get("name") or "", "a": arts, "i": sp_img(imgs)})
        sp_items_set(items)
        sp_set("ok")
        return None
    if st == 204:                      # nessun dispositivo attivo
        sp_items_set([])
        sp_set("ok")
        return None
    if st == 401:
        SP["exp"] = 0.0
        return 2
    if st == 429:
        try:
            return max(5, int(hdr.get("Retry-After", 20)))
        except Exception:
            return 20
    try:
        msg = (json.loads(body).get("error") or {}).get("message") or ""
    except Exception:
        msg = ""
    if st == 403:
        sp_set("error", "Spotify ha rifiutato la richiesta" + (f": {msg}" if msg else "") +
               ". Le app in modalità sviluppo richiedono un account Premium per il proprietario; se l'account non è il tuo, aggiungilo in User Management.")
    else:
        sp_set("error", f"Errore {st} da Spotify" + (f": {msg}" if msg else ""))
    return 60


def sp_thread():
    sp_load()
    last_key = None
    due = extra = 0.0
    while True:
        time.sleep(0.4)
        try:
            if not SP["refresh"] or S.clients == 0:
                continue
            uses_queue = S.cfg.get("sideWidget") == "queue" or (
                S.cfg.get("monitor") == "all" and any(p["v"].get("sideWidget") == "queue" for p in saved_profiles()))
            if not uses_queue:
                continue
            now = time.time()
            if S.key != last_key:                       # brano cambiato: la coda cambia un attimo dopo
                last_key = S.key
                due, extra = now + 1.2, now + 5.0
            if SP["poke"]:
                SP["poke"] = False
                due = now
            if extra and now >= extra:
                extra = 0.0
                due = min(due, now)
            if now >= due:
                wait = sp_fetch_queue()
                try:
                    every = max(3, int(S.cfg.get("queueEvery", 7)))
                except Exception:
                    every = 7
                due = time.time() + (wait if wait else (every if S.playing else 20))
        except Exception:
            log("spotify queue error", traceback.format_exc())
            due = time.time() + 20


def sp_page(ok, msg):
    color = "#1ed760" if ok else ("#8ab4ff" if ok is None else "#ff6b6b")
    mark = "✓" if ok else ("i" if ok is None else "!")
    head = "Collegato" if ok else ("Non serve aprire questa pagina" if ok is None else "Qualcosa non ha funzionato")
    body = (f"<!doctype html><meta charset=utf-8><title>Spotify Orbit</title>"
            f"<body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0e16;color:#eee;font-family:Segoe UI,system-ui,sans-serif\">"
            f"<div style=\"text-align:center;max-width:28rem;padding:2rem\"><div style=\"font-size:3rem;color:{color}\">{mark}</div>"
            f"<h2 style=\"font-weight:600\">{head}</h2><p style=\"opacity:.75\">{html.escape(msg)}</p>"
            f"<p style=\"opacity:.5\">Puoi chiudere questa scheda.</p></div>")
    return body.encode("utf-8")


# ----------------------------------------------------------------------------
# Aggiornamenti: confronta la versione con l'ultima release pubblica su GitHub
# ----------------------------------------------------------------------------
UPDATE_API = "https://api.github.com/repos/DecisiveSnow533/orbit-wallpaper/releases/latest"
UPDATE_PREFIX = "https://github.com/DecisiveSnow533/orbit-wallpaper/"
UPD = {"latest": "", "url": "", "notes": "", "checked": 0.0, "error": "", "shown": ""}


def ver_tuple(s):
    m = re.match(r"\s*v?(\d+)\.(\d+)\.(\d+)", s or "")
    return tuple(int(x) for x in m.groups()) if m else None


def update_available():
    new, cur = ver_tuple(UPD["latest"]), ver_tuple(VERSION)
    return bool(new and cur and new > cur)


def update_check():
    """Chiede a GitHub l'ultima release (richiesta anonima: nessun dato dell'utente). True se è più nuova."""
    req = urllib.request.Request(UPDATE_API, headers={"User-Agent": "orbit-wallpaper-update-check", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        d = json.loads(r.read())
    tag, url = str(d.get("tag_name", "")), str(d.get("html_url", ""))
    UPD["checked"], UPD["error"] = time.time(), ""
    if not ver_tuple(tag) or not url.startswith(UPDATE_PREFIX):
        return False
    UPD["latest"], UPD["url"], UPD["notes"] = tag.lstrip("vV"), url, str(d.get("body") or "")[:1500]
    return update_available()


def update_thread():
    time.sleep(25)                       # lascia partire tutto prima di fare richieste in rete
    while True:
        try:
            if S.cfg.get("checkUpdates", True) and update_check():
                if UPD["latest"] not in (S.cfg.get("skipVersion"), UPD["shown"]):
                    UPD["shown"] = UPD["latest"]
                    open_update_window()
        except Exception as e:
            UPD["error"] = str(e)
            log("controllo aggiornamenti:", e)
        time.sleep(12 * 3600)


def check_now():
    """Controllo a richiesta (menu dell'icona / pannello). Ritorna (stato, messaggio)."""
    try:
        if update_check():
            open_update_window()
            return "new", f"Disponibile la versione {UPD['latest']}"
        return "ok", f"Hai già l'ultima versione ({VERSION})"
    except Exception as e:
        UPD["error"] = str(e)
        return "error", "Non riesco a controllare gli aggiornamenti (sei online?)"


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------
MIME ={".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "SpotifyOrbit"

    def log_message(self, *a):
        pass

    def _host_ok(self):
        h = (self.headers.get("Host") or "").split(":")[0]
        return h in ("127.0.0.1", "localhost")

    def _send(self, code, body=b"", ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403)
        u = urlparse(self.path)
        p = u.path
        if p == "/stream":
            return self._stream()
        if p == "/art":
            with S.lock:
                data, mime = S.art, S.art_mime
            if not data:
                return self._send(404)
            return self._send(200, data, mime, {"Cache-Control": "max-age=3600"})
        if p == "/api/settings":
            return self._send(200, json.dumps(S.cfg, ensure_ascii=False).encode("utf-8"))
        if p == "/api/monitors":
            try:
                import desktop
                mons = [{k: v for k, v in m.items() if k != "work"} for m in desktop.monitors()]
            except Exception:
                mons = []
            return self._send(200, json.dumps(mons).encode("utf-8"))
        if p == "/api/update":
            d = {"current": VERSION, "latest": UPD["latest"], "available": update_available(), "notes": UPD["notes"],
                 "url": UPD["url"], "checked": UPD["checked"], "error": UPD["error"]}
            return self._send(200, json.dumps(d, ensure_ascii=False).encode("utf-8"))
        if p == "/api/spotify/status":
            d = {"state": S.sp_state, "msg": S.sp_msg, "cid": SP["cid"], "redirect": SP_REDIRECT, "count": len(S.sp_items)}
            return self._send(200, json.dumps(d, ensure_ascii=False).encode("utf-8"))
        if p == "/callback":
            q = parse_qs(u.query)
            if not (q.get("code") or q.get("error") or q.get("state")):      # aperto a mano, non da Spotify
                return self._send(200, sp_page(None, "Questo indirizzo non va aperto a mano: serve solo a Spotify per tornare qui dopo l'accesso. "
                                                     "Copialo tra i Redirect URI della tua app sul sito di Spotify, poi premi «Collega Spotify» nelle impostazioni."),
                                  "text/html; charset=utf-8")
            ok, msg = sp_callback(q)
            return self._send(200 if ok else 400, sp_page(ok, msg), "text/html; charset=utf-8")
        if p == "/api/status":
            with S.lock:
                d = dict(media_ok=S.media_ok, title=S.title, artist=S.artist, playing=S.playing, pos=S.pos, dur=S.dur,
                         audio_dev=S.audio_dev, audio_peak=round(S.audio_peak, 4), audio_err=S.audio_err,
                         bands_max=float(S.bands.max()), clients=S.clients, app=S.app, art_bytes=len(S.art),
                         covered=S.covered, wall=S.wall_state, wall_enabled=S.wall_enabled)
            return self._send(200, json.dumps(d, ensure_ascii=False).encode("utf-8"))
        # file statici
        rel = "index.html" if p in ("/", "") else p.lstrip("/")
        full = os.path.normpath(os.path.join(UI, rel))
        if not full.startswith(os.path.normpath(UI)) or not os.path.isfile(full):
            return self._send(404)
        with open(full, "rb") as f:
            body = f.read()
        return self._send(200, body, MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))

    def do_POST(self):
        if not self._host_ok():
            return self._send(403)
        org = self.headers.get("Origin")           # un altro sito non deve poter comandare il programma
        if org and urlparse(org).hostname not in ("127.0.0.1", "localhost"):
            return self._send(403)
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if 0 < n < 65536 else b""
        if u.path == "/api/settings":
            try:
                d = json.loads(raw.decode("utf-8"))
                if not isinstance(d, dict):
                    raise ValueError
                write_settings(d, (parse_qs(u.query).get("cid") or [""])[0])
                return self._send(200, b"{}")
            except Exception:
                return self._send(400, b"{}")
        if u.path == "/api/spotify/login":
            try:
                sp_login(json.loads(raw.decode("utf-8")).get("clientId", ""))
                return self._send(200, b'{"ok":true}')
            except ValueError as e:
                return self._send(400, json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False).encode("utf-8"))
            except Exception:
                log("spotify login", traceback.format_exc())
                return self._send(500, b'{"ok":false,"error":"Errore inatteso"}')
        if u.path == "/api/update/open":            # apre la pagina della release (indirizzo preso da GitHub e verificato)
            if UPD["url"].startswith(UPDATE_PREFIX):
                import webbrowser
                webbrowser.open(UPD["url"])
            return self._send(200, b"{}")
        if u.path == "/api/update/skip":
            if UPD["latest"]:
                write_settings(dict(S.cfg, skipVersion=UPD["latest"]))
            return self._send(200, b"{}")
        if u.path == "/api/update/check":
            st, msg = check_now()
            return self._send(200, json.dumps({"state": st, "msg": msg}, ensure_ascii=False).encode("utf-8"))
        if u.path == "/api/spotify/dashboard":      # indirizzo fisso, nessun parametro dall'esterno
            import webbrowser
            webbrowser.open("https://developer.spotify.com/dashboard")
            return self._send(200, b"{}")
        if u.path == "/api/spotify/logout":
            sp_logout()
            return self._send(200, b"{}")
        if u.path == "/api/cmd":
            c = (parse_qs(u.query).get("c") or [""])[0]
            if c in ("playpause", "next", "prev") and LOOP is not None:
                asyncio.run_coroutine_threadsafe(do_cmd(c), LOOP)
            return self._send(200, b"{}")
        if u.path == "/api/quit":
            self._send(200, b"{}")
            threading.Timer(0.3, shutdown).start()
            return
        return self._send(404)

    def _stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        S.clients += 1
        S.had_client = True
        sent_ver = -1
        sent_set = -1
        sent_q = -1
        try:
            mon_i = int((parse_qs(urlparse(self.path).query).get("mon") or ["-1"])[0])
        except Exception:
            mon_i = -1
        try:
            while True:
                now = time.time()
                if S.sp_ver != sent_q:
                    sent_q = S.sp_ver
                    qp = json.dumps({"state": S.sp_state, "msg": S.sp_msg, "items": S.sp_items}, ensure_ascii=False)
                    self.wfile.write(f"event: queue\ndata: {qp}\n\n".encode("utf-8"))
                if S.set_ver != sent_set:
                    sent_set = S.set_ver
                    sp = json.dumps({"cid": S.set_cid, "cfg": S.cfg}, ensure_ascii=False)
                    self.wfile.write(f"event: settings\ndata: {sp}\n\n".encode("utf-8"))
                with S.lock:
                    ver, title, artist, album, app, artv = S.ver, S.title, S.artist, S.album, S.app, S.art_ver
                    has_art = bool(S.art)
                    playing, pos, dur, t_ref = S.playing, S.pos, S.dur, S.t_ref
                if ver != sent_ver:
                    sent_ver = ver
                    payload = json.dumps({"title": title, "artist": artist, "album": album, "app": app,
                                          "artv": artv, "hasArt": has_art, "media": S.media_ok}, ensure_ascii=False)
                    self.wfile.write(f"event: track\ndata: {payload}\n\n".encode("utf-8"))
                cur = pos + (now - t_ref if playing else 0.0)
                if dur > 0:
                    cur = min(cur, dur)
                a = (np.clip(S.bands, 0, 1) * 255).astype(np.uint8).tolist()
                frame = json.dumps({"a": a, "p": round(cur, 3), "pl": 1 if playing else 0, "d": round(dur, 2),
                                    "ap": round(S.audio_peak, 3),
                                    "z": 1 if (S.covered_map.get(mon_i, False) if mon_i >= 0 else S.covered) else 0}, separators=(",", ":"))
                self.wfile.write(f"data: {frame}\n\n".encode("utf-8"))
                self.wfile.flush()
                time.sleep(0.02)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            S.clients -= 1
            S.last_client_t = time.time()


# ----------------------------------------------------------------------------
# Finestra (Edge in modalità app)
# ----------------------------------------------------------------------------
def find_browser():
    cands = []
    for env in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        b = os.environ.get(env)
        if b:
            cands.append(os.path.join(b, "Microsoft", "Edge", "Application", "msedge.exe"))
            cands.append(os.path.join(b, "Google", "Chrome", "Application", "chrome.exe"))
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


def launch_edge(url, profile, extra=()):
    exe = find_browser()
    if not exe:
        import webbrowser
        webbrowser.open(url)
        return None
    args = [exe, f"--app={url}", f"--user-data-dir={os.path.join(DATA, profile)}", "--no-first-run",
            "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
            "--disable-features=Translate,CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding", "--disable-background-timer-throttling", *extra]
    return subprocess.Popen(args)


def kill_tree(proc):
    if proc is None:
        return
    try:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True, creationflags=0x08000000)
    except Exception:
        pass


def port_in_use(port):
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


# ----------------------------------------------------------------------------
# Sfondo del desktop, finestre di servizio, icona nella barra
# ----------------------------------------------------------------------------
URL = f"http://127.0.0.1:{PORT}/"
WALLS = {}          # indice monitor -> {"proc", "hwnd", "parent", "mon", "last"}
SETWIN = {"proc": None}
UPDWIN = {"proc": None}
FULLWIN = {"proc": None}
TRAY = {"icon": None}


def wall_targets(desktop):
    """Monitor su cui mostrare lo sfondo: uno solo (scelto) oppure tutti."""
    mons = desktop.monitors()
    sel = str(S.cfg.get("monitor", "0"))
    if sel == "all":
        return mons
    try:
        i = int(sel)
    except Exception:
        i = 0
    if i < 0 or i >= len(mons):
        i = 0
    return [mons[i]]


def stop_wall(i=None):
    """Chiude lo sfondo di un monitor (o di tutti)."""
    try:
        import desktop
    except Exception:
        desktop = None
    for k in ([i] if i is not None else list(WALLS)):
        w = WALLS.pop(k, None)
        if not w:
            continue
        try:
            if desktop and w.get("hwnd"):
                desktop.release(w["hwnd"])
        except Exception:
            pass
        kill_tree(w.get("proc"))


def wall_step(desktop, mon, w):
    """Un passo di manutenzione per lo sfondo di un monitor. True se è agganciato."""
    i = mon["i"]
    proc = w["proc"]
    if proc is None or proc.poll() is not None:
        if time.time() - w["last"] > 3:
            w.update(hwnd=None, parent=None)
            w["proc"] = launch_edge(URL + f"?wall&mon={i}", f"browser-wall-{i}",
                                    [f"--window-position={mon['x']},{mon['y']}", f"--window-size={mon['w']},{mon['h']}",
                                     "--start-fullscreen"])
            w["last"] = time.time()
        return False
    title = f"SpotifyOrbitWallpaper[{i}]"
    hwnd = w["hwnd"]
    if hwnd is None or not desktop.is_alive(hwnd):
        hwnd = desktop.find_window(pid=proc.pid, title_part=title)
        if hwnd is None and time.time() - w["last"] > 10:
            hwnd = desktop.find_window(title_part=title)
        if hwnd is None:
            return False
        parent, _ = desktop.embed(hwnd, mon)
        w.update(hwnd=hwnd, parent=parent, mon=mon)
        log("sfondo agganciato", i, hex(hwnd), mon["w"], mon["h"])
        return True
    l, t, r, b = desktop.current_rect_in_parent(hwnd)
    if desktop.parent_of(hwnd) != w["parent"] or w["mon"] != mon or abs(l - mon["x"]) > 2 or abs(t - mon["y"]) > 2 \
            or abs((r - l) - mon["w"]) > 2 or abs((b - t) - mon["h"]) > 2:
        desktop.embed(hwnd, mon)               # monitor cambiato, Explorer riavviato, risoluzione cambiata…
        w["mon"] = mon
        log("sfondo riposizionato", i)
    return True


def wall_loop():
    import desktop
    while True:
        try:
            targets = wall_targets(desktop)
            want = {m["i"] for m in targets}
            for k in [k for k in WALLS if k not in want]:      # monitor non più richiesto
                stop_wall(k)
            pc = bool(S.cfg.get("pauseCovered", True))
            S.covered_map = {m["i"]: pc and desktop.desktop_covered(m) for m in targets}
            S.covered = any(S.covered_map.values())
            if not S.wall_enabled:
                stop_wall()
                S.wall_state = "spento"
                time.sleep(1)
                continue
            ok = True
            for m in targets:
                w = WALLS.setdefault(m["i"], {"proc": None, "hwnd": None, "parent": None, "mon": None, "last": 0.0})
                ok = wall_step(desktop, m, w) and ok
            S.wall_state = "agganciato" if ok else "avvio della finestra"
        except Exception:
            log("wall_loop error", traceback.format_exc())
            time.sleep(2)
        time.sleep(0.5)


def open_settings():
    import desktop
    p = SETWIN["proc"]
    if p is not None and p.poll() is None:
        h = desktop.find_window(title_part="Spotify Orbit — Impostazioni")
        if h:
            desktop.focus(h)
        return
    SETWIN["proc"] = launch_edge(URL + "?settings", "browser-set", ["--window-size=1180,780"])


def open_update_window():
    p = UPDWIN["proc"]
    if p is not None and p.poll() is None:
        try:
            import desktop
            h = desktop.find_window(title_part="Spotify Orbit — Aggiornamento")
            if h:
                desktop.focus(h)
        except Exception:
            pass
        return
    UPDWIN["proc"] = launch_edge(URL + "update.html", "browser-upd", ["--window-size=560,520"])


def open_fullwindow():
    p = FULLWIN["proc"]
    if p is not None and p.poll() is None:
        return
    FULLWIN["proc"] = launch_edge(URL, "browser-win", ["--start-fullscreen"])


def shutdown():
    log("chiusura")
    try:
        stop_wall()
    except Exception:
        pass
    kill_tree(SETWIN["proc"])
    kill_tree(UPDWIN["proc"])
    kill_tree(FULLWIN["proc"])
    try:
        if TRAY["icon"] is not None:
            TRAY["icon"].stop()
    except Exception:
        pass
    os._exit(0)


def saved_profiles():
    p = S.cfg.get("profiles")
    if not isinstance(p, list):
        return []
    return [x for x in p if isinstance(x, dict) and isinstance(x.get("name"), str) and isinstance(x.get("v"), dict)]


def apply_profile(name):
    """Applica un profilo salvato (dal menu dell'icona): tutte le pagine si aggiornano da sole."""
    for p in saved_profiles():
        if p["name"] == name:
            d = dict(S.cfg)
            d.update(p["v"])
            d["profile"] = name
            write_settings(d)
            return


def run_tray():
    import pystray
    from PIL import Image

    img = Image.open(os.path.join(UI, "icon.png"))

    def toggle_wall(icon, item):
        S.wall_enabled = not S.wall_enabled

    def restart_wall(icon, item):
        stop_wall()

    def check_updates_tray(icon, item):
        def run():
            st, msg = check_now()
            if st != "new":                     # se c'è un aggiornamento si apre già la finestra
                try:
                    icon.notify(msg, "Spotify Orbit")
                except Exception:
                    pass
        threading.Thread(target=run, daemon=True).start()

    def profile_items():
        ps = saved_profiles()
        if not ps:
            return (pystray.MenuItem("(nessun profilo salvato)", lambda i, it: None, enabled=False),)

        def make(n):
            return (lambda i, it: apply_profile(n)), (lambda it: S.cfg.get("profile") == n)
        out = []
        for p in ps:
            act, chk = make(p["name"])
            out.append(pystray.MenuItem(p["name"], act, checked=chk, radio=True))
        return tuple(out)

    menu = pystray.Menu(
        pystray.MenuItem("Impostazioni…", lambda i, it: open_settings(), default=True),
        pystray.MenuItem("Profili", pystray.Menu(profile_items)),
        pystray.MenuItem("Sfondo attivo", toggle_wall, checked=lambda it: S.wall_enabled),
        pystray.MenuItem("Apri a schermo intero (finestra)", lambda i, it: open_fullwindow()),
        pystray.MenuItem("Riavvia lo sfondo", restart_wall),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Cerca aggiornamenti…", check_updates_tray),
        pystray.MenuItem(f"Versione {VERSION}", lambda i, it: None, enabled=False),
        pystray.MenuItem("Esci", lambda i, it: shutdown()),
    )
    icon = pystray.Icon(APP, img, "Spotify Orbit", menu)
    TRAY["icon"] = icon

    def setup(i):
        i.visible = True
        if not S.cfg.get("seenTip"):
            try:
                i.notify("Lo sfondo è attivo. Clic sull'icona vicino all'orologio per le impostazioni.", "Spotify Orbit")
                d = dict(S.cfg)
                d["seenTip"] = True
                write_settings(d)
            except Exception:
                pass

    icon.run(setup=setup)


def main():
    nowindow = "--nowindow" in sys.argv          # solo motore (per i test)
    if port_in_use(PORT):                        # già in esecuzione: apri le impostazioni e basta
        if not nowindow:
            launch_edge(URL + "?settings", "browser-set", ["--window-size=1180,780"])
        return
    log("avvio", sys.version.split()[0])
    if not nowindow:
        try:  # resti di un'esecuzione precedente chiusa male: un Edge rimasto col profilo dello sfondo
            # farebbe "assorbire" la nuova finestra e lo sfondo non si riaggancerebbe più
            ps = ("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
                  "Where-Object { $_.CommandLine -like '*SpotifyOrbit\\browser-*' } | "
                  "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
            subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                           capture_output=True, creationflags=0x08000000, timeout=20)
        except Exception:
            log("pulizia avvio", traceback.format_exc())
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=media_thread, daemon=True).start()
    threading.Thread(target=audio_thread, daemon=True).start()
    threading.Thread(target=sp_thread, daemon=True).start()
    if not nowindow:
        threading.Thread(target=update_thread, daemon=True).start()
        threading.Thread(target=wall_loop, daemon=True).start()
        try:
            run_tray()
        except Exception:
            log("tray error", traceback.format_exc())
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("fatal", traceback.format_exc())
        raise
