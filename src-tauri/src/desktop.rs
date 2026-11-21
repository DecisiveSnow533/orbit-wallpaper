//! Aggancio di una finestra al desktop di Windows (sfondo animato dietro alle icone) e informazioni sui monitor.
use serde::Serialize;
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, ScreenToClient, HDC, HMONITOR, MONITORINFO};
use windows::Win32::UI::WindowsAndMessaging::*;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Monitor {
    pub i: i32,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub primary: bool,
    #[serde(skip)]
    pub work: (i32, i32, i32, i32),
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Elenco dei monitor: principale per primo, poi da sinistra a destra (pixel fisici).
pub fn monitors() -> Vec<Monitor> {
    unsafe extern "system" fn cb(hm: HMONITOR, _: HDC, _: *mut RECT, lp: LPARAM) -> BOOL {
        let out = &mut *(lp.0 as *mut Vec<Monitor>);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(hm, &mut mi).as_bool() {
            let r = mi.rcMonitor;
            let w = mi.rcWork;
            out.push(Monitor {
                i: 0,
                x: r.left,
                y: r.top,
                w: r.right - r.left,
                h: r.bottom - r.top,
                primary: mi.dwFlags & 1 != 0,
                work: (w.left, w.top, w.right, w.bottom),
            });
        }
        BOOL(1)
    }
    let mut out: Vec<Monitor> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(cb), LPARAM(&mut out as *mut _ as isize));
    }
    out.sort_by_key(|m| (!m.primary, m.x));
    for (i, m) in out.iter_mut().enumerate() {
        m.i = i as i32;
    }
    out
}

fn class_of(h: HWND) -> String {
    let mut b = [0u16; 256];
    let n = unsafe { GetClassNameW(h, &mut b) };
    String::from_utf16_lossy(&b[..n.max(0) as usize])
}

/// (genitore, finestra dopo cui inserirsi) per il layout di Explorer in uso.
fn desktop_parent() -> Option<(HWND, Option<HWND>)> {
    unsafe {
        let progman = FindWindowW(PCWSTR(wide("Progman").as_ptr()), PCWSTR::null()).ok()?;
        let mut res = 0usize;
        // chiede a Explorer di creare lo strato «WorkerW» dietro alle icone
        let _ = SendMessageTimeoutW(progman, 0x052C, WPARAM(0xD), LPARAM(1), SMTO_NORMAL, 1000, Some(&mut res));
        let _ = SendMessageTimeoutW(progman, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, Some(&mut res));
        let defview = FindWindowExW(Some(progman), None, PCWSTR(wide("SHELLDLL_DefView").as_ptr()), PCWSTR::null()).ok();
        let worker = FindWindowExW(Some(progman), None, PCWSTR(wide("WorkerW").as_ptr()), PCWSTR::null()).ok();
        if let (Some(dv), Some(_)) = (defview, worker) {
            return Some((progman, Some(dv))); // Windows 11 24H2 e successivi: tutto dentro Progman
        }
        // layout classico: WorkerW di primo livello dietro alle icone
        unsafe extern "system" fn cb(h: HWND, lp: LPARAM) -> BOOL {
            let found = &mut *(lp.0 as *mut Option<HWND>);
            let dv = FindWindowExW(Some(h), None, PCWSTR(wide("SHELLDLL_DefView").as_ptr()), PCWSTR::null());
            if dv.is_ok() {
                *found = Some(h);
                return BOOL(0);
            }
            BOOL(1)
        }
        let mut holder: Option<HWND> = None;
        let _ = EnumWindows(Some(cb), LPARAM(&mut holder as *mut _ as isize));
        if let Some(h) = holder {
            if let Ok(wk) = FindWindowExW(None, Some(h), PCWSTR(wide("WorkerW").as_ptr()), PCWSTR::null()) {
                return Some((wk, None));
            }
        }
        Some((progman, None))
    }
}

/// Trasforma la finestra in uno sfondo: senza bordi, figlia del desktop, sotto le icone.
pub fn embed(hwnd: HWND, mon: &Monitor) -> Result<HWND, String> {
    let (parent, after) = desktop_parent().ok_or("desktop non trovato")?;
    unsafe {
        let _ = ShowWindow(hwnd, SW_HIDE);
        let mut st = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        st &= !(WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0 | WS_POPUP.0 | WS_BORDER.0 | WS_DLGFRAME.0);
        st |= WS_CHILD.0 | WS_VISIBLE.0;
        SetWindowLongPtrW(hwnd, GWL_STYLE, st as isize);
        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        ex &= !(WS_EX_APPWINDOW.0 | WS_EX_WINDOWEDGE.0 | WS_EX_CLIENTEDGE.0);
        ex |= WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex as isize);
        SetParent(hwnd, Some(parent)).map_err(|e| e.to_string())?;
        place(hwnd, parent, mon, after);
    }
    Ok(parent)
}

pub fn place(hwnd: HWND, parent: HWND, mon: &Monitor, after: Option<HWND>) {
    unsafe {
        let mut pt = POINT { x: mon.x, y: mon.y };
        let _ = ScreenToClient(parent, &mut pt);
        let ins = after.unwrap_or(HWND_BOTTOM);
        let _ = SetWindowPos(hwnd, Some(ins), pt.x, pt.y, mon.w, mon.h, SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    }
}

pub fn parent_of(hwnd: HWND) -> Option<HWND> {
    unsafe { GetParent(hwnd).ok() }
}

pub fn rect(hwnd: HWND) -> (i32, i32, i32, i32) {
    let mut r = RECT::default();
    unsafe {
        let _ = GetWindowRect(hwnd, &mut r);
    }
    (r.left, r.top, r.right, r.bottom)
}

/// La finestra ha ancora gli stili da sfondo?
pub fn looks_embedded(hwnd: HWND) -> bool {
    unsafe {
        let st = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        st & WS_CHILD.0 != 0 && st & WS_CAPTION.0 == 0 && ex & WS_EX_TOOLWINDOW.0 != 0 && ex & WS_EX_APPWINDOW.0 == 0
    }
}

const SHELL: &[&str] = &[
    "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "SHELLDLL_DefView", "SysListView32",
    "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland", "Windows.UI.Core.CoreWindow",
    "NotifyIconOverflowWindow", "ForegroundStaging", "MultitaskingViewFrame",
];

/// True se una finestra massimizzata/a schermo intero copre il monitor (lo sfondo si mette in pausa).
pub fn covered(mon: &Monitor) -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() || IsIconic(fg).as_bool() || !IsWindowVisible(fg).as_bool() {
            return false;
        }
        if SHELL.contains(&class_of(fg).as_str()) {
            return false;
        }
        let (l, t, r, b) = rect(fg);
        let (wl, wt, wr, wb) = mon.work;
        let ow = r.min(mon.x + mon.w) - l.max(mon.x);
        let oh = b.min(mon.y + mon.h) - t.max(mon.y);
        ow > 0 && oh > 0 && ow >= (wr - wl) - 24 && oh >= (wb - wt) - 24
    }
}
