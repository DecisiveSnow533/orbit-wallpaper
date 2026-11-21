//! Impostazioni (settings.json in %APPDATA%\SpotifyOrbit), avvio con Windows e profili.
use crate::state::{bump, cfg_bool, data_dir, log, S, APP};
use serde_json::{Map, Value};

fn path() -> std::path::PathBuf {
    data_dir().join("settings.json")
}

pub fn load() {
    let v = std::fs::read_to_string(path())
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(|v| v.is_object())
        .unwrap_or(Value::Object(Map::new()));
    *S.cfg.write().unwrap() = v;
}

/// Salva tutte le impostazioni e avvisa le pagine (cid = pagina che ha fatto la modifica).
pub fn write(v: Value, cid: &str) -> std::io::Result<()> {
    if !v.is_object() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "non è un oggetto"));
    }
    let old_auto = cfg_bool("autostart", false);
    let p = path();
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&v).unwrap_or_default())?;
    std::fs::rename(&tmp, &p)?;
    let new_auto = v.get("autostart").and_then(Value::as_bool).unwrap_or(false);
    *S.cfg.write().unwrap() = v;
    *S.set_cid.lock().unwrap() = cid.to_string();
    bump(&S.set_ver);
    if new_auto != old_auto {
        if let Err(e) = set_autostart(new_auto) {
            log(format!("autostart: {e}"));
        }
    }
    Ok(())
}

/// Cambia un solo valore.
pub fn set(k: &str, val: Value) {
    let mut v = S.cfg.read().unwrap().clone();
    if let Some(o) = v.as_object_mut() {
        o.insert(k.to_string(), val);
    }
    let _ = write(v, "");
}

/// Voce «Run» dell'utente: solo per l'exe compilato, solo quando l'utente lo chiede.
pub fn set_autostart(on: bool) -> std::io::Result<()> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    let key = winreg::RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Run", KEY_SET_VALUE)?;
    if on {
        let exe = std::env::current_exe()?;
        key.set_value(APP, &format!("\"{}\"", exe.display()))?;
    } else {
        let _ = key.delete_value(APP);
    }
    Ok(())
}

pub fn profiles() -> Vec<(String, Map<String, Value>)> {
    let cfg = S.cfg.read().unwrap();
    cfg.get("profiles")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    let name = p.get("name")?.as_str()?.to_string();
                    let v = p.get("v")?.as_object()?.clone();
                    Some((name, v))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Applica un profilo salvato (dal menu dell'icona): tutte le pagine si aggiornano da sole.
pub fn apply_profile(name: &str) {
    if let Some((_, v)) = profiles().into_iter().find(|(n, _)| n == name) {
        let mut cfg = S.cfg.read().unwrap().clone();
        if let Some(o) = cfg.as_object_mut() {
            for (k, val) in v {
                o.insert(k, val);
            }
            o.insert("profile".into(), Value::String(name.to_string()));
        }
        let _ = write(cfg, "");
    }
}
