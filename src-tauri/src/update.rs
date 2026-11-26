//! Aggiornamenti: confronta la versione con l'ultima release su GitHub, scarica e installa l'installer verificato.
use crate::state::{cfg_bool, cfg_str, data_dir, log, now_secs, Asset, S, VERSION};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::time::Duration;
use tauri::AppHandle;

const API: &str = "https://api.github.com/repos/DecisiveSnow533/orbit-wallpaper/releases/latest";
const PREFIX: &str = "https://github.com/DecisiveSnow533/orbit-wallpaper/";

fn ver(s: &str) -> Option<(u32, u32, u32)> {
    let s = s.trim().trim_start_matches(['v', 'V']);
    let mut it = s.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty()).map(|p| p.parse::<u32>().ok());
    Some((it.next()??, it.next()??, it.next()??))
}

pub fn available() -> bool {
    let latest = S.upd.lock().unwrap().latest.clone();
    matches!((ver(&latest), ver(VERSION)), (Some(n), Some(c)) if n > c)
}

/// Installato con l'installer? (c'è il disinstallatore accanto all'exe)
pub fn installed_mode() -> bool {
    !cfg!(debug_assertions) && std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("unins000.exe").is_file())).unwrap_or(false)
}

pub fn payload() -> Value {
    let u = S.upd.lock().unwrap();
    let skipped = !u.latest.is_empty() && cfg_str("skipVersion") == u.latest;
    let mode = if installed_mode() && u.asset.is_some() { "installer" } else { "portable" };
    let (latest, notes, state, progress, msg) = (u.latest.clone(), u.notes.clone(), u.state.clone(), u.progress, u.msg.clone());
    drop(u);
    json!({"available": available(), "current": VERSION, "latest": latest, "notes": notes, "mode": mode,
           "state": state, "progress": progress, "msg": msg, "skipped": skipped})
}

pub fn info() -> Value {
    let mut p = payload();
    let u = S.upd.lock().unwrap();
    p["url"] = json!(u.url);
    p["checked"] = json!(u.checked);
    p["error"] = json!(u.error);
    p
}

fn set(f: impl FnOnce(&mut crate::state::UpdState)) {
    let mut u = S.upd.lock().unwrap();
    f(&mut u);
    u.ver += 1;
}

/// Chiede a GitHub l'ultima release (richiesta anonima). true se è più nuova.
pub fn check() -> Result<bool, String> {
    let d: Value = crate::state::http().get(API)
        .set("User-Agent", "orbit-wallpaper-update-check")
        .set("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(10))
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;
    let tag = d["tag_name"].as_str().unwrap_or("").to_string();
    let url = d["html_url"].as_str().unwrap_or("").to_string();
    if ver(&tag).is_none() || !url.starts_with(PREFIX) {
        return Ok(false);
    }
    let asset = d["assets"].as_array().and_then(|a| {
        a.iter().find_map(|x| {
            let name = x["name"].as_str()?;
            let link = x["browser_download_url"].as_str()?;
            let ok = name.starts_with("SpotifyOrbit-Setup-") && name.ends_with(".exe") && link.starts_with(&format!("{PREFIX}releases/download/"));
            ok.then(|| Asset {
                name: name.to_string(),
                url: link.to_string(),
                size: x["size"].as_u64().unwrap_or(0),
                sha256: x["digest"].as_str().and_then(|s| s.strip_prefix("sha256:")).unwrap_or("").to_lowercase(),
            })
        })
    });
    set(|u| {
        u.checked = now_secs();
        u.error.clear();
        u.latest = tag.trim_start_matches(['v', 'V']).to_string();
        u.url = url;
        u.notes = d["body"].as_str().unwrap_or("").chars().take(1500).collect();
        u.asset = asset;
    });
    Ok(available())
}

fn announce(app: &AppHandle) {
    let latest = S.upd.lock().unwrap().latest.clone();
    crate::notify(app, &format!("È disponibile la versione {latest}. Apri le impostazioni per aggiornare."));
    crate::windows_mgr::open_settings(app);
}

pub fn thread(app: AppHandle) {
    std::thread::sleep(Duration::from_secs(25));
    loop {
        if cfg_bool("checkUpdates", true) {
            match check() {
                Ok(true) => {
                    let latest = S.upd.lock().unwrap().latest.clone();
                    let shown = S.upd.lock().unwrap().shown.clone();
                    if latest != cfg_str("skipVersion") && latest != shown {
                        S.upd.lock().unwrap().shown = latest;
                        announce(&app);
                    }
                }
                Ok(false) => {}
                Err(e) => {
                    S.upd.lock().unwrap().error = e.clone();
                    log(format!("controllo aggiornamenti: {e}"));
                }
            }
        }
        std::thread::sleep(Duration::from_secs(12 * 3600));
    }
}

/// Controllo a richiesta (menu dell'icona / pannello). Ritorna (stato, messaggio).
pub fn check_now(app: &AppHandle) -> (&'static str, String) {
    match check() {
        Ok(true) => {
            let latest = S.upd.lock().unwrap().latest.clone();
            if cfg_str("skipVersion") == latest {
                crate::settings::set("skipVersion", json!("")); // chiesto a mano: non è più «saltata»
            }
            S.upd.lock().unwrap().shown = latest.clone();
            announce(app);
            ("new", format!("Disponibile la versione {latest}"))
        }
        Ok(false) => ("ok", format!("Hai già l'ultima versione ({VERSION})")),
        Err(e) => {
            S.upd.lock().unwrap().error = e;
            ("error", "Non riesco a controllare gli aggiornamenti (sei online?)".into())
        }
    }
}

pub fn open_page() {
    let url = S.upd.lock().unwrap().url.clone();
    if url.starts_with(PREFIX) {
        let _ = open::that_detached(url);
    }
}

pub fn skip() {
    let latest = S.upd.lock().unwrap().latest.clone();
    if !latest.is_empty() {
        crate::settings::set("skipVersion", json!(latest));
    }
}

fn download_and_run(asset: &Asset) -> Result<(), String> {
    let dir = std::env::temp_dir().join("SpotifyOrbit-Update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&asset.name);
    set(|u| {
        u.state = "downloading".into();
        u.progress = 0;
        u.msg.clear();
    });
    let r = crate::state::http().get(&asset.url).set("User-Agent", "orbit-wallpaper-update").timeout(Duration::from_secs(120)).call().map_err(|e| e.to_string())?;
    let total: u64 = r.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(asset.size);
    let mut rd = r.into_reader();
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut got = 0u64;
    let mut buf = vec![0u8; 256 * 1024];
    let mut last_pct = 0;
    loop {
        let n = rd.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        f.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        h.update(&buf[..n]);
        got += n as u64;
        if total > 0 {
            let pct = ((got * 100 / total) as u32).min(99);
            if pct != last_pct {
                last_pct = pct;
                set(|u| u.progress = pct);
            }
        }
    }
    drop(f);
    if asset.size > 0 && got != asset.size {
        return Err("Il file scaricato è incompleto.".into());
    }
    let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if !asset.sha256.is_empty() && hex != asset.sha256 {
        let _ = std::fs::remove_file(&path);
        return Err("Il file scaricato non corrisponde a quello pubblicato: aggiornamento annullato.".into());
    }
    set(|u| {
        u.state = "installing".into();
        u.progress = 100;
    });
    // passando da PowerShell l'installer non è «figlio» di questo programma: chiudendolo non viene chiuso anche lui
    let q = path.display().to_string().replace('\'', "''");
    let ps = format!("Start-Process -FilePath '{q}' -ArgumentList '/SILENT','/SUPPRESSMSGBOXES','/NORESTART'");
    let ok = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .creation_flags(0x0800_0000)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        return Err("Non riesco ad avviare l'installer.".into());
    }
    log(format!("aggiornamento: installer avviato {}", asset.name));
    Ok(())
}

pub fn install(app: AppHandle) {
    {
        let u = S.upd.lock().unwrap();
        if u.state == "downloading" || u.state == "installing" {
            return;
        }
    }
    let asset = S.upd.lock().unwrap().asset.clone();
    let res = match asset {
        Some(a) if installed_mode() => download_and_run(&a),
        _ => Err("L'aggiornamento automatico funziona solo con la versione installata.".into()),
    };
    match res {
        Ok(()) => {
            std::thread::sleep(Duration::from_millis(1500));
            crate::shutdown(&app);
        }
        Err(e) => {
            log(format!("aggiornamento fallito: {e}"));
            set(|u| {
                u.state = "error".into();
                u.msg = e;
            });
        }
    }
}

pub fn cleanup_old_installers() {
    let dir = std::env::temp_dir().join("SpotifyOrbit-Update");
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    let _ = data_dir();
}
