//! Spotify Web API (solo per la coda di riproduzione): accesso PKCE, nessun segreto.
use crate::state::{cfg_get, cfg_str, data_dir, log, now_secs, QueueItem, PORT, S};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const AUTH: &str = "https://accounts.spotify.com/authorize";
const TOKEN: &str = "https://accounts.spotify.com/api/token";
const QUEUE: &str = "https://api.spotify.com/v1/me/player/queue";
const SCOPE: &str = "user-read-playback-state user-read-currently-playing";

pub fn redirect() -> String {
    format!("http://127.0.0.1:{PORT}/callback")
}

struct Sp {
    cid: String,
    refresh: String,
    access: String,
    exp: f64,
    pending: HashMap<String, (String, f64)>,
    poke: bool,
}

static SP: LazyLock<Mutex<Sp>> =
    LazyLock::new(|| Mutex::new(Sp { cid: String::new(), refresh: String::new(), access: String::new(), exp: 0.0, pending: HashMap::new(), poke: false }));

fn file() -> std::path::PathBuf {
    data_dir().join("spotify.json")
}

fn save(sp: &Sp) {
    let _ = std::fs::write(file(), json!({"cid": sp.cid, "refresh": sp.refresh}).to_string());
}

fn set_state(state: &str, msg: &str) {
    let mut s = S.sp.lock().unwrap();
    if s.state != state || s.msg != msg {
        s.state = state.into();
        s.msg = msg.into();
        s.ver += 1;
    }
}

fn set_items(items: Vec<QueueItem>) {
    let mut s = S.sp.lock().unwrap();
    let same = s.items.len() == items.len() && s.items.iter().zip(&items).all(|(a, b)| a.t == b.t && a.a == b.a && a.i == b.i);
    if !same {
        s.items = items;
        s.ver += 1;
    }
}

fn baseline() {
    let (cid, refresh) = {
        let sp = SP.lock().unwrap();
        (sp.cid.clone(), sp.refresh.clone())
    };
    if cid.is_empty() {
        set_state("nocid", "");
    } else if refresh.is_empty() {
        set_state("off", "");
    } else {
        let st = S.sp.lock().unwrap().state.clone();
        if st == "nocid" || st == "off" {
            set_state("ok", "");
        }
    }
}

pub fn load() {
    if let Some(v) = std::fs::read_to_string(file()).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
        let mut sp = SP.lock().unwrap();
        sp.cid = v["cid"].as_str().unwrap_or("").to_string();
        sp.refresh = v["refresh"].as_str().unwrap_or("").to_string();
    }
    baseline();
}

pub fn status() -> Value {
    let s = S.sp.lock().unwrap();
    json!({"state": s.state, "msg": s.msg, "cid": SP.lock().unwrap().cid, "redirect": redirect(), "count": s.items.len()})
}

pub fn login(cid: &str) -> Result<(), String> {
    let cid = cid.trim();
    if cid.len() < 16 || cid.len() > 64 || !cid.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Il Client ID non sembra valido (di solito sono 32 caratteri tra lettere e numeri).".into());
    }
    let mut raw = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut raw);
    let verifier = B64.encode(raw);
    let challenge = B64.encode(Sha256::digest(verifier.as_bytes()));
    let mut st = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut st);
    let state = B64.encode(st);
    {
        let mut sp = SP.lock().unwrap();
        sp.cid = cid.to_string();
        save(&sp);
        let now = now_secs();
        sp.pending.retain(|_, v| now - v.1 < 600.0);
        sp.pending.insert(state.clone(), (verifier, now));
    }
    let q = [
        ("client_id", cid),
        ("response_type", "code"),
        ("redirect_uri", &redirect()),
        ("scope", SCOPE),
        ("code_challenge_method", "S256"),
        ("code_challenge", &challenge),
        ("state", &state),
    ];
    let qs: Vec<String> = q.iter().map(|(k, v)| format!("{k}={}", crate::http::pct(v))).collect();
    let _ = open::that_detached(format!("{AUTH}?{}", qs.join("&")));
    baseline();
    Ok(())
}

pub fn logout() {
    {
        let mut sp = SP.lock().unwrap();
        sp.refresh.clear();
        sp.access.clear();
        sp.exp = 0.0;
        save(&sp);
    }
    set_items(vec![]);
    let has = !SP.lock().unwrap().cid.is_empty();
    set_state(if has { "off" } else { "nocid" }, "");
}

fn post_token(form: &[(&str, &str)]) -> Result<(u16, Value), String> {
    match ureq::post(TOKEN).timeout(Duration::from_secs(10)).send_form(form) {
        Ok(r) => Ok((r.status(), r.into_json::<Value>().unwrap_or(Value::Null))),
        Err(ureq::Error::Status(c, r)) => Ok((c, r.into_json::<Value>().unwrap_or(Value::Null))),
        Err(e) => Err(e.to_string()),
    }
}

fn take_tokens(sp: &mut Sp, d: &Value) {
    sp.access = d["access_token"].as_str().unwrap_or("").to_string();
    sp.exp = now_secs() + d["expires_in"].as_f64().unwrap_or(3600.0) - 60.0;
    if let Some(r) = d["refresh_token"].as_str() {
        if r != sp.refresh {
            sp.refresh = r.to_string();
            save(sp);
        }
    }
}

/// Ritorno dal sito di Spotify: scambia il codice con i token.
pub fn callback(q: &HashMap<String, String>) -> (bool, String) {
    if q.get("error").map(|s| !s.is_empty()).unwrap_or(false) {
        return (false, "Hai annullato l'accesso o Spotify l'ha rifiutato.".into());
    }
    let state = q.get("state").cloned().unwrap_or_default();
    let code = q.get("code").cloned().unwrap_or_default();
    let (entry, cid) = {
        let mut sp = SP.lock().unwrap();
        (sp.pending.remove(&state), sp.cid.clone())
    };
    let Some((verifier, t)) = entry else {
        return (false, "Richiesta scaduta o non valida. Riprova da Impostazioni → Coda di Spotify.".into());
    };
    if code.is_empty() || now_secs() - t > 600.0 {
        return (false, "Richiesta scaduta o non valida. Riprova da Impostazioni → Coda di Spotify.".into());
    }
    let redir = redirect();
    match post_token(&[("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &redir), ("client_id", &cid), ("code_verifier", &verifier)]) {
        Err(e) => (false, format!("Non riesco a contattare Spotify: {e}")),
        Ok((200, d)) if d["access_token"].is_string() => {
            let mut sp = SP.lock().unwrap();
            sp.refresh.clear();
            take_tokens(&mut sp, &d);
            sp.poke = true;
            drop(sp);
            set_state("ok", "");
            (true, "Spotify è collegato.".into())
        }
        Ok((c, d)) => (false, format!("Spotify ha risposto: {}", d["error_description"].as_str().or(d["error"].as_str()).map(String::from).unwrap_or(c.to_string()))),
    }
}

fn img(images: &Value) -> String {
    let arr = images.as_array().cloned().unwrap_or_default();
    let mut best: Option<(u64, String)> = None;
    for im in &arr {
        let w = im["width"].as_u64().unwrap_or(0);
        if w >= 120 && best.as_ref().map(|b| w < b.0).unwrap_or(true) {
            best = Some((w, im["url"].as_str().unwrap_or("").to_string()));
        }
    }
    best.map(|b| b.1).or_else(|| arr.first().and_then(|i| i["url"].as_str()).map(String::from)).unwrap_or_default()
}

/// Scarica la coda. Ritorna i secondi da attendere prima del prossimo tentativo (se diversi dal normale).
fn fetch() -> Option<f64> {
    let (cid, refresh, exp) = {
        let sp = SP.lock().unwrap();
        (sp.cid.clone(), sp.refresh.clone(), sp.exp)
    };
    if now_secs() >= exp {
        match post_token(&[("grant_type", "refresh_token"), ("refresh_token", &refresh), ("client_id", &cid)]) {
            Ok((200, d)) if d["access_token"].is_string() => take_tokens(&mut SP.lock().unwrap(), &d),
            Ok((400 | 401, _)) => {
                logout();
                set_state("off", "L'accesso a Spotify è scaduto: ricollega l'account.");
                return None;
            }
            _ => return Some(30.0),
        }
    }
    let tok = SP.lock().unwrap().access.clone();
    let res = ureq::get(QUEUE).set("Authorization", &format!("Bearer {tok}")).timeout(Duration::from_secs(10)).call();
    let (code, body, retry) = match res {
        Ok(r) => (r.status(), r.into_string().unwrap_or_default(), None),
        Err(ureq::Error::Status(c, r)) => {
            let ra = r.header("Retry-After").and_then(|v| v.parse::<f64>().ok());
            (c, r.into_string().unwrap_or_default(), ra)
        }
        Err(e) => {
            log(format!("coda: {e}"));
            return Some(20.0);
        }
    };
    match code {
        200 => {
            let d: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            let items = d["queue"]
                .as_array()
                .map(|q| {
                    q.iter()
                        .take(8)
                        .map(|it| {
                            let mut a: Vec<String> = it["artists"].as_array().map(|x| x.iter().filter_map(|p| p["name"].as_str().map(String::from)).collect()).unwrap_or_default();
                            if a.is_empty() {
                                a.push(it["show"]["publisher"].as_str().or(it["show"]["name"].as_str()).unwrap_or("").to_string());
                            }
                            let imgs = if it["album"]["images"].is_array() { &it["album"]["images"] } else if it["images"].is_array() { &it["images"] } else { &it["show"]["images"] };
                            QueueItem { t: it["name"].as_str().unwrap_or("").to_string(), a: a.join(", "), i: img(imgs) }
                        })
                        .collect()
                })
                .unwrap_or_default();
            set_items(items);
            set_state("ok", "");
            None
        }
        204 => {
            set_items(vec![]);
            set_state("ok", "");
            None
        }
        401 => {
            SP.lock().unwrap().exp = 0.0;
            Some(2.0)
        }
        429 => Some(retry.unwrap_or(20.0).max(5.0)),
        c => {
            let msg = serde_json::from_str::<Value>(&body).ok().and_then(|d| d["error"]["message"].as_str().map(String::from)).unwrap_or_default();
            let extra = if msg.is_empty() { String::new() } else { format!(": {msg}") };
            if c == 403 {
                set_state("error", &format!("Spotify ha rifiutato la richiesta{extra}. Le app in modalità sviluppo richiedono un account Premium per il proprietario; se l'account non è il tuo, aggiungilo in User Management."));
            } else {
                set_state("error", &format!("Errore {c} da Spotify{extra}"));
            }
            Some(60.0)
        }
    }
}

fn uses_queue() -> bool {
    if cfg_str("sideWidget") == "queue" {
        return true;
    }
    cfg_str("monitor") == "all" && crate::settings::profiles().iter().any(|(_, v)| v.get("sideWidget").and_then(Value::as_str) == Some("queue"))
}

pub fn thread() {
    load();
    let mut last_key = String::new();
    let mut due = Instant::now();
    let mut extra: Option<Instant> = None;
    loop {
        std::thread::sleep(Duration::from_millis(400));
        let has = !SP.lock().unwrap().refresh.is_empty();
        if !has || S.clients.load(std::sync::atomic::Ordering::SeqCst) <= 0 || !uses_queue() {
            continue;
        }
        let now = Instant::now();
        let key = S.track.lock().unwrap().key.clone();
        if key != last_key {
            last_key = key; // brano cambiato: la coda cambia un attimo dopo
            due = now + Duration::from_millis(1200);
            extra = Some(now + Duration::from_secs(5));
        }
        if std::mem::take(&mut SP.lock().unwrap().poke) {
            due = now;
        }
        if extra.map(|e| now >= e).unwrap_or(false) {
            extra = None;
            due = due.min(now);
        }
        if now >= due {
            let every = cfg_get("queueEvery").as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(7.0).max(3.0);
            let playing = S.play.lock().unwrap().playing;
            let wait = fetch().unwrap_or(if playing { every } else { 20.0 });
            due = Instant::now() + Duration::from_secs_f64(wait);
        }
    }
}
