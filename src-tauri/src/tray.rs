//! Icona vicino all'orologio con il suo menu (si ricostruisce quando cambiano profili o stato dello sfondo).
use crate::state::{cfg_str, S, VERSION};
use crate::{settings, update, windows_mgr};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let profiles = settings::profiles();
    let active = cfg_str("profile");
    let sub = Submenu::new(app, "Profili", true)?;
    if profiles.is_empty() {
        sub.append(&MenuItem::with_id(app, "noprof", "(nessun profilo salvato)", false, None::<&str>)?)?;
    }
    for (name, _) in &profiles {
        sub.append(&CheckMenuItem::with_id(app, format!("prof:{name}"), name, true, *name == active, None::<&str>)?)?;
    }
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "settings", "Impostazioni…", true, None::<&str>)?,
            &sub,
            &CheckMenuItem::with_id(app, "wall", "Sfondo attivo", true, S.wall_enabled.load(Ordering::SeqCst), None::<&str>)?,
            &MenuItem::with_id(app, "full", "Apri a schermo intero (finestra)", true, None::<&str>)?,
            &MenuItem::with_id(app, "restart", "Riavvia lo sfondo", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "update", "Cerca aggiornamenti…", true, None::<&str>)?,
            &MenuItem::with_id(app, "ver", format!("Versione {VERSION}"), false, None::<&str>)?,
            &MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?,
        ],
    )
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "settings" => windows_mgr::open_settings(app),
        "wall" => {
            let on = !S.wall_enabled.load(Ordering::SeqCst);
            S.wall_enabled.store(on, Ordering::SeqCst);
        }
        "full" => windows_mgr::open_full(app),
        "restart" => windows_mgr::stop_walls(app),
        "update" => {
            let a = app.clone();
            std::thread::spawn(move || {
                let (st, msg) = update::check_now(&a);
                if st != "new" {
                    crate::notify(&a, &msg); // se c'è un aggiornamento si aprono già le impostazioni
                }
            });
        }
        "quit" => crate::shutdown(app),
        p if p.starts_with("prof:") => settings::apply_profile(&p[5..]),
        _ => {}
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let tray = TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/icon.png"))?)
        .tooltip("Spotify Orbit")
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| on_menu(app, ev.id().as_ref()))
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                windows_mgr::open_settings(tray.app_handle());
            }
        })
        .build(app)?;
    // il menu segue profili e stato dello sfondo
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut last = (u64::MAX, true);
        loop {
            std::thread::sleep(Duration::from_millis(800));
            let now = (S.set_ver.load(Ordering::SeqCst), S.wall_enabled.load(Ordering::SeqCst));
            if now != last {
                last = now;
                if let Ok(m) = build_menu(&app2) {
                    let _ = tray.set_menu(Some(m));
                }
            }
        }
    });
    Ok(())
}
