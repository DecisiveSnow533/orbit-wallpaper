//! Finestre: sfondo del desktop (una per monitor), impostazioni, schermo intero.
use crate::desktop::{self, Monitor};
use crate::state::{cfg_bool, cfg_str, log, url, S};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::Foundation::HWND;

fn hwnd_of(w: &WebviewWindow) -> Option<HWND> {
    w.hwnd().ok().map(|h| HWND(h.0 as *mut core::ffi::c_void))
}

fn ext(u: String) -> WebviewUrl {
    WebviewUrl::External(u.parse().expect("url"))
}

fn targets() -> Vec<Monitor> {
    let mons = desktop::monitors();
    let sel = cfg_str("monitor");
    if sel == "all" {
        return mons;
    }
    let i: usize = sel.parse().unwrap_or(0);
    let i = if i < mons.len() { i } else { 0 };
    mons.get(i).cloned().into_iter().collect()
}

struct Wall {
    parent: HWND,
    mon: Monitor,
}

fn create_wall(app: &AppHandle, m: &Monitor) -> Result<WebviewWindow, String> {
    let w = WebviewWindowBuilder::new(app, format!("wall-{}", m.i), ext(format!("{}?wall&mon={}", url(), m.i)))
        .title(format!("SpotifyOrbitWallpaper[{}]", m.i))
        .decorations(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .shadow(false)
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = w.set_position(PhysicalPosition::new(m.x, m.y));
    let _ = w.set_size(PhysicalSize::new(m.w as u32, m.h as u32));
    Ok(w)
}

pub fn stop_walls(app: &AppHandle) {
    for (label, w) in app.webview_windows() {
        if label.starts_with("wall-") {
            let _ = w.destroy();
        }
    }
}

pub fn thread(app: AppHandle) {
    let mut walls: HashMap<i32, Wall> = HashMap::new();
    loop {
        let t = targets();
        let want: Vec<i32> = t.iter().map(|m| m.i).collect();
        // monitor non più richiesti
        for (label, w) in app.webview_windows() {
            if let Some(i) = label.strip_prefix("wall-").and_then(|s| s.parse::<i32>().ok()) {
                if !want.contains(&i) || !S.wall_enabled.load(Ordering::SeqCst) {
                    let _ = w.destroy();
                    walls.remove(&i);
                }
            }
        }
        let pc = cfg_bool("pauseCovered", true);
        let cm: HashMap<i32, bool> = t.iter().map(|m| (m.i, pc && desktop::covered(m))).collect();
        S.covered.store(cm.values().any(|v| *v), Ordering::SeqCst);
        *S.covered_map.lock().unwrap() = cm;
        if !S.wall_enabled.load(Ordering::SeqCst) {
            *S.wall_state.lock().unwrap() = "spento".into();
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }
        let mut ok = true;
        for m in &t {
            let label = format!("wall-{}", m.i);
            match app.get_webview_window(&label) {
                None => match create_wall(&app, m) {
                    Ok(w) => match hwnd_of(&w).ok_or_else(|| "hwnd".to_string()).and_then(|h| desktop::embed(h, m)) {
                        Ok(parent) => {
                            log(format!("sfondo agganciato {} {}x{}", m.i, m.w, m.h));
                            walls.insert(m.i, Wall { parent, mon: m.clone() });
                        }
                        Err(e) => {
                            log(format!("aggancio sfondo {}: {e}", m.i));
                            let _ = w.destroy();
                            ok = false;
                        }
                    },
                    Err(e) => {
                        log(format!("finestra sfondo {}: {e}", m.i));
                        ok = false;
                    }
                },
                Some(w) => {
                    let Some(h) = hwnd_of(&w) else { continue };
                    let (l, tp, r, b) = desktop::rect(h);
                    let wall = walls.get(&m.i);
                    let moved = wall.map(|x| desktop::parent_of(h) != Some(x.parent) || x.mon != *m).unwrap_or(true)
                        || (l - m.x).abs() > 2
                        || (tp - m.y).abs() > 2
                        || ((r - l) - m.w).abs() > 2
                        || ((b - tp) - m.h).abs() > 2
                        || !desktop::looks_embedded(h);
                    if moved {
                        match desktop::embed(h, m) {
                            Ok(parent) => {
                                walls.insert(m.i, Wall { parent, mon: m.clone() });
                                log(format!("sfondo riposizionato {}", m.i));
                            }
                            Err(e) => {
                                log(format!("riaggancio {}: {e}", m.i));
                                ok = false;
                            }
                        }
                    }
                }
            }
        }
        *S.wall_state.lock().unwrap() = if ok { "agganciato".into() } else { "avvio della finestra".into() };
        std::thread::sleep(Duration::from_millis(500));
    }
}

pub fn open_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let app2 = app.clone();
    // le finestre si creano fuori dal thread degli eventi (su Windows crearle lì può bloccare)
    std::thread::spawn(move || {
        if let Err(e) = WebviewWindowBuilder::new(&app2, "settings", ext(format!("{}?settings", url())))
            .title("Spotify Orbit — Impostazioni")
            .inner_size(1180.0, 780.0)
            .min_inner_size(720.0, 480.0)
            .center()
            .build()
        {
            log(format!("finestra impostazioni: {e}"));
        }
    });
}

pub fn open_full(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("full") {
        let _ = w.set_focus();
        return;
    }
    let app2 = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = WebviewWindowBuilder::new(&app2, "full", ext(url())).title("Spotify Orbit").fullscreen(true).build() {
            log(format!("finestra a schermo intero: {e}"));
        }
    });
}
