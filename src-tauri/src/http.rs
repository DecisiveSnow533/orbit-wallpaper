//! Server locale su 127.0.0.1: interfaccia, API delle impostazioni e flusso in tempo reale (SSE).
use crate::state::{cfg_str, log, url, NB, PORT, S};
use crate::{media, settings, spotify, update, windows_mgr};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::AppHandle;

pub fn pct(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            o.push(b as char);
        } else {
            o.push_str(&format!("%{b:02X}"));
        }
    }
    o
}

fn unpct(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    out.push(v);
                    i += 2;
                } else {
                    out.push(b'%');
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

struct Req {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_req(s: &mut TcpStream) -> Option<Req> {
    s.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    let mut r = BufReader::new(s.try_clone().ok()?);
    let mut line = String::new();
    r.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let mut headers = HashMap::new();
    let mut total = 0;
    loop {
        let mut h = String::new();
        let n = r.read_line(&mut h).ok()?;
        total += n;
        if n == 0 || total > 64 * 1024 {
            return None;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut body = vec![0u8; len.min(64 * 1024)];
    if !body.is_empty() {
        r.read_exact(&mut body).ok()?;
    }
    let (path, qs) = target.split_once('?').unwrap_or((target.as_str(), ""));
    let query = qs
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (unpct(k), unpct(v))
        })
        .collect();
    Some(Req { method, path: unpct(path), query, headers, body })
}

fn reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

fn send(s: &mut TcpStream, code: u16, ctype: &str, body: &[u8], extra: &[(&str, &str)]) {
    let mut h = format!("HTTP/1.1 {code} {}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n", reason(code), body.len());
    if !extra.iter().any(|(k, _)| k.eq_ignore_ascii_case("cache-control")) {
        h.push_str("Cache-Control: no-store\r\n");
    }
    for (k, v) in extra {
        h.push_str(&format!("{k}: {v}\r\n"));
    }
    h.push_str("\r\n");
    let _ = s.write_all(h.as_bytes());
    let _ = s.write_all(body);
    let _ = s.flush();
}

fn send_json(s: &mut TcpStream, code: u16, v: &Value) {
    send(s, code, "application/json", v.to_string().as_bytes(), &[]);
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

fn callback_page(ok: Option<bool>, msg: &str) -> Vec<u8> {
    let (color, mark, head) = match ok {
        Some(true) => ("#1ed760", "✓", "Collegato"),
        None => ("#8ab4ff", "i", "Non serve aprire questa pagina"),
        Some(false) => ("#ff6b6b", "!", "Qualcosa non ha funzionato"),
    };
    let msg = msg.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    format!("<!doctype html><meta charset=utf-8><title>Spotify Orbit</title><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0e16;color:#eee;font-family:Segoe UI,system-ui,sans-serif\"><div style=\"text-align:center;max-width:28rem;padding:2rem\"><div style=\"font-size:3rem;color:{color}\">{mark}</div><h2 style=\"font-weight:600\">{head}</h2><p style=\"opacity:.75\">{msg}</p><p style=\"opacity:.5\">Puoi chiudere questa scheda.</p></div>").into_bytes()
}

fn status() -> Value {
    let t = S.track.lock().unwrap();
    let p = S.play.lock().unwrap();
    let a = S.audio.lock().unwrap();
    json!({
        "media_ok": S.media_ok.load(Ordering::SeqCst), "title": t.title, "artist": t.artist, "playing": p.playing,
        "pos": p.pos, "dur": p.dur, "audio_dev": a.dev, "audio_peak": (a.peak * 10000.0).round() / 10000.0, "audio_err": a.err,
        "bands_max": a.bands.iter().cloned().fold(0f32, f32::max), "clients": S.clients.load(Ordering::SeqCst), "app": t.app,
        "art_bytes": t.art.len(), "covered": S.covered.load(Ordering::SeqCst), "wall": *S.wall_state.lock().unwrap(),
        "wall_enabled": S.wall_enabled.load(Ordering::SeqCst), "version": crate::state::VERSION, "engine": "rust"
    })
}

fn get(s: &mut TcpStream, req: &Req, app: &AppHandle) {
    match req.path.as_str() {
        "/stream" => stream(s, req),
        "/art" => {
            let t = S.track.lock().unwrap();
            if t.art.is_empty() {
                drop(t);
                send(s, 404, "text/plain", b"", &[]);
            } else {
                let (art, m) = (t.art.clone(), t.art_mime.clone());
                drop(t);
                send(s, 200, &m, &art, &[("Cache-Control", "max-age=3600")]);
            }
        }
        "/api/settings" => send_json(s, 200, &S.cfg.read().unwrap().clone()),
        "/api/monitors" => send_json(s, 200, &json!(crate::desktop::monitors())),
        "/api/status" => send_json(s, 200, &status()),
        "/api/update" => send_json(s, 200, &update::info()),
        "/api/spotify/status" => send_json(s, 200, &spotify::status()),
        "/callback" => {
            let q = &req.query;
            if !(q.contains_key("code") || q.contains_key("error") || q.contains_key("state")) {
                let page = callback_page(None, "Questo indirizzo non va aperto a mano: serve solo a Spotify per tornare qui dopo l'accesso. Copialo tra i Redirect URI della tua app sul sito di Spotify, poi premi «Collega Spotify» nelle impostazioni.");
                return send(s, 200, "text/html; charset=utf-8", &page, &[]);
            }
            let (ok, msg) = spotify::callback(q);
            send(s, if ok { 200 } else { 400 }, "text/html; charset=utf-8", &callback_page(Some(ok), &msg), &[]);
        }
        p => {
            let rel = if p == "/" || p.is_empty() { "index.html" } else { p.trim_start_matches('/') };
            if rel.contains("..") {
                return send(s, 404, "text/plain", b"", &[]);
            }
            match app.asset_resolver().get(rel.to_string()) {
                Some(a) => send(s, 200, mime(rel), &a.bytes, &[]),
                None => send(s, 404, "text/plain", b"", &[]),
            }
        }
    }
}

fn post(s: &mut TcpStream, req: &Req, app: &AppHandle) {
    let body: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
    match req.path.as_str() {
        "/api/settings" => {
            let cid = req.query.get("cid").cloned().unwrap_or_default();
            match settings::write(body, &cid) {
                Ok(()) => send_json(s, 200, &json!({})),
                Err(_) => send_json(s, 400, &json!({})),
            }
        }
        "/api/cmd" => {
            match req.query.get("c").map(String::as_str) {
                Some("playpause") => media::send(media::Cmd::PlayPause),
                Some("next") => media::send(media::Cmd::Next),
                Some("prev") => media::send(media::Cmd::Prev),
                _ => {}
            }
            send_json(s, 200, &json!({}));
        }
        "/api/spotify/login" => match spotify::login(body["clientId"].as_str().unwrap_or("")) {
            Ok(()) => send_json(s, 200, &json!({"ok": true})),
            Err(e) => send_json(s, 400, &json!({"ok": false, "error": e})),
        },
        "/api/spotify/logout" => {
            spotify::logout();
            send_json(s, 200, &json!({}));
        }
        "/api/spotify/dashboard" => {
            let _ = open::that_detached("https://developer.spotify.com/dashboard");
            send_json(s, 200, &json!({}));
        }
        "/api/update/open" => {
            update::open_page();
            send_json(s, 200, &json!({}));
        }
        "/api/update/install" => {
            if update::available() {
                let a = app.clone();
                std::thread::spawn(move || update::install(a));
            }
            send_json(s, 200, &json!({}));
        }
        "/api/update/skip" => {
            update::skip();
            send_json(s, 200, &json!({}));
        }
        "/api/update/check" => {
            let (st, msg) = update::check_now(app);
            send_json(s, 200, &json!({"state": st, "msg": msg}));
        }
        "/api/open-settings" => {
            windows_mgr::open_settings(app);
            send_json(s, 200, &json!({}));
        }
        "/api/quit" => {
            send_json(s, 200, &json!({}));
            let a = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                crate::shutdown(&a);
            });
        }
        _ => send(s, 404, "text/plain", b"", &[]),
    }
}

fn stream(s: &mut TcpStream, req: &Req) {
    let mon: i32 = req.query.get("mon").and_then(|v| v.parse().ok()).unwrap_or(-1);
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n";
    if s.write_all(head.as_bytes()).is_err() {
        return;
    }
    let _ = s.set_nodelay(true);
    S.clients.fetch_add(1, Ordering::SeqCst);
    let mut sent_set = u64::MAX;
    let mut sent_u: (u64, String) = (u64::MAX, String::new());
    let mut sent_q = u64::MAX;
    let mut sent_ver = u64::MAX;
    let res: std::io::Result<()> = (|| loop {
        let mut out = String::new();
        let sv = S.set_ver.load(Ordering::SeqCst);
        if sv != sent_set {
            sent_set = sv;
            let cid = S.set_cid.lock().unwrap().clone();
            out.push_str(&format!("event: settings\ndata: {}\n\n", json!({"cid": cid, "cfg": S.cfg.read().unwrap().clone()})));
        }
        let uk = (S.upd.lock().unwrap().ver, cfg_str("skipVersion"));
        if uk != sent_u {
            sent_u = uk;
            out.push_str(&format!("event: update\ndata: {}\n\n", update::payload()));
        }
        {
            let sp = S.sp.lock().unwrap();
            if sp.ver != sent_q {
                sent_q = sp.ver;
                let items: Vec<Value> = sp.items.iter().map(|i| json!({"t": i.t, "a": i.a, "i": i.i})).collect();
                out.push_str(&format!("event: queue\ndata: {}\n\n", json!({"state": sp.state, "msg": sp.msg, "items": items})));
            }
        }
        {
            let t = S.track.lock().unwrap();
            if t.ver != sent_ver {
                sent_ver = t.ver;
                let m = json!({"title": t.title, "artist": t.artist, "album": t.album, "app": t.app, "artv": t.art_ver,
                               "hasArt": !t.art.is_empty(), "media": S.media_ok.load(Ordering::SeqCst)});
                out.push_str(&format!("event: track\ndata: {m}\n\n"));
            }
        }
        let (cur, playing, dur) = {
            let p = S.play.lock().unwrap();
            let mut c = p.pos + if p.playing { p.t_ref.elapsed().as_secs_f64() } else { 0.0 };
            if p.dur > 0.0 {
                c = c.min(p.dur);
            }
            (c, p.playing, p.dur)
        };
        let (bands, peak) = {
            let a = S.audio.lock().unwrap();
            (a.bands, a.peak)
        };
        let z = if mon >= 0 { *S.covered_map.lock().unwrap().get(&mon).unwrap_or(&false) } else { S.covered.load(Ordering::SeqCst) };
        let arr: Vec<u8> = bands.iter().map(|v| (v.clamp(0.0, 1.0) * 255.0) as u8).collect();
        debug_assert_eq!(arr.len(), NB);
        out.push_str(&format!(
            "data: {}\n\n",
            json!({"a": arr, "p": (cur * 1000.0).round() / 1000.0, "pl": playing as u8, "d": (dur * 100.0).round() / 100.0,
                   "ap": (peak * 1000.0).round() / 1000.0, "z": z as u8})
        ));
        s.write_all(out.as_bytes())?;
        s.flush()?;
        std::thread::sleep(Duration::from_millis(20));
    })();
    let _ = res;
    S.clients.fetch_sub(1, Ordering::SeqCst);
}

fn handle(mut s: TcpStream, app: &AppHandle) {
    let Some(req) = read_req(&mut s) else { return };
    let host = req.headers.get("host").map(|h| h.split(':').next().unwrap_or("").to_string()).unwrap_or_default();
    if host != "127.0.0.1" && host != "localhost" {
        return send(&mut s, 403, "text/plain", b"", &[]);
    }
    match req.method.as_str() {
        "GET" | "HEAD" => get(&mut s, &req, app),
        "POST" => {
            // un altro sito non deve poter comandare il programma
            if let Some(o) = req.headers.get("origin") {
                let h = o.split("://").nth(1).unwrap_or("").split(['/', ':']).next().unwrap_or("");
                if h != "127.0.0.1" && h != "localhost" {
                    return send(&mut s, 403, "text/plain", b"", &[]);
                }
            }
            post(&mut s, &req, app)
        }
        _ => send(&mut s, 404, "text/plain", b"", &[]),
    }
}

/// true se la porta è già occupata (un'altra copia del programma è in esecuzione).
pub fn bind() -> Option<TcpListener> {
    TcpListener::bind(("127.0.0.1", PORT)).ok()
}

pub fn serve(listener: TcpListener, app: AppHandle) {
    log(format!("server su {}", url()));
    let started = Instant::now();
    for c in listener.incoming() {
        match c {
            Ok(st) => {
                let a = app.clone();
                std::thread::spawn(move || handle(st, &a));
            }
            Err(e) if started.elapsed() > Duration::from_secs(1) => log(format!("server: {e}")),
            Err(_) => {}
        }
    }
}
