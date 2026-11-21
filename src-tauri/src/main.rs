//! Spotify Orbit — sfondo animato per Windows che reagisce alla musica (Rust + Tauri).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod desktop;
mod http;
mod media;
mod settings;
mod spotify;
mod state;
mod tray;
mod update;
mod windows_mgr;

use state::{cfg_bool, data_dir, log, url, VERSION};
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_notification::NotificationExt;

pub fn notify(app: &AppHandle, msg: &str) {
    let _ = app.notification().builder().title("Spotify Orbit").body(msg).show();
}

/// Chiude tutto (sfondi, finestre) ed esce.
pub fn shutdown(app: &AppHandle) {
    log("chiusura");
    for (_, w) in app.webview_windows() {
        let _ = w.destroy();
    }
    app.exit(0);
}

/// Cartelle dei profili Edge della versione precedente (Python): con Tauri non servono più.
fn remove_old_edge_profiles() {
    if let Ok(rd) = std::fs::read_dir(data_dir()) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("browser") && e.path().is_dir() {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
}

fn main() {
    // impostazione di compatibilità che l'installer passa ai programmi che avvia: non serve e non va propagata
    std::env::remove_var("__COMPAT_LAYER");
    std::panic::set_hook(Box::new(|info| log(format!("errore grave: {info}"))));
    let nowindow = std::env::args().any(|a| a == "--nowindow"); // solo motore (per le prove)

    let Some(listener) = http::bind() else {
        // c'è già una copia in esecuzione: le chiedo di aprire le impostazioni ed esco
        if !nowindow {
            let _ = ureq::post(&format!("{}api/open-settings", url())).timeout(Duration::from_secs(5)).send_bytes(&[]);
        }
        return;
    };
    settings::load();
    log(format!("avvio {VERSION} (rust)"));
    update::cleanup_old_installers();
    remove_old_edge_profiles();
    if cfg_bool("autostart", false) {
        let _ = settings::set_autostart(true); // la voce di avvio deve puntare a questo exe (cambia dopo un aggiornamento)
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| windows_mgr::open_settings(app)))
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            let h = app.handle().clone();
            {
                let h = h.clone();
                std::thread::spawn(move || http::serve(listener, h));
            }
            std::thread::spawn(media::thread);
            std::thread::spawn(audio::thread);
            std::thread::spawn(spotify::thread);
            if !nowindow {
                {
                    let h = h.clone();
                    std::thread::spawn(move || windows_mgr::thread(h));
                }
                {
                    let h = h.clone();
                    std::thread::spawn(move || update::thread(h));
                }
                tray::create(&h)?;
                if !cfg_bool("seenTip", false) {
                    notify(&h, "Lo sfondo è attivo. Clic sull'icona vicino all'orologio per le impostazioni.");
                    settings::set("seenTip", serde_json::json!(true));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("avvio di Tauri");
    app.run(|_app, ev| {
        // senza finestre aperte il programma resta attivo nell'icona; esce solo con «Esci»
        if let RunEvent::ExitRequested { api, code, .. } = ev {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
