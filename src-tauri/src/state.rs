//! Stato condiviso tra i thread (brano, audio, impostazioni, Spotify, aggiornamenti).
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex, RwLock};
use std::time::Instant;

pub const APP: &str = "SpotifyOrbit";
pub const PORT: u16 = 8777;
pub const NB: usize = 64;
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn url() -> String {
    format!("http://127.0.0.1:{PORT}/")
}

pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    let d = base.join(APP);
    let _ = std::fs::create_dir_all(&d);
    d
}

/// Riga nel file di log (%APPDATA%\SpotifyOrbit\log.txt), con rotazione semplice.
pub fn log(msg: impl AsRef<str>) {
    let path = data_dir().join("log.txt");
    if let Ok(m) = std::fs::metadata(&path) {
        if m.len() > 200_000 {
            let _ = std::fs::remove_file(&path);
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let t = chrono_hms();
        let _ = writeln!(f, "{t} {}", msg.as_ref());
    }
}

fn chrono_hms() -> String {
    // ora locale senza dipendenze esterne
    use windows::Win32::Foundation::SYSTEMTIME;
    let st: SYSTEMTIME = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:02}:{:02}:{:02}", st.wHour, st.wMinute, st.wSecond)
}

#[derive(Default, Clone)]
pub struct Track {
    pub key: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub app: String,
    pub ver: u64,
    pub art: Vec<u8>,
    pub art_mime: String,
    pub art_ver: u64,
}

pub struct Play {
    pub playing: bool,
    pub pos: f64,
    pub dur: f64,
    pub t_ref: Instant,
}

pub struct Audio {
    pub bands: [f32; NB],
    pub peak: f32,
    pub dev: String,
    pub err: String,
}

#[derive(Clone)]
pub struct QueueItem {
    pub t: String,
    pub a: String,
    pub i: String,
    /// durata in secondi (0 se Spotify non la dà)
    pub d: f64,
}

pub struct SpState {
    pub state: String, // nocid | off | ok | error
    pub msg: String,
    pub items: Vec<QueueItem>,
    pub ver: u64,
}

#[derive(Clone, Default)]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

pub struct UpdState {
    pub latest: String,
    pub url: String,
    pub notes: String,
    pub checked: f64,
    pub error: String,
    pub shown: String,
    pub asset: Option<Asset>,
    pub state: String, // idle | downloading | installing | error
    pub progress: u32,
    pub msg: String,
    pub ver: u64,
}

pub struct Shared {
    pub track: Mutex<Track>,
    pub play: Mutex<Play>,
    pub audio: Mutex<Audio>,
    pub media_ok: AtomicBool,
    pub cfg: RwLock<Value>,
    pub set_ver: AtomicU64,
    pub set_cid: Mutex<String>,
    pub covered: AtomicBool,
    pub covered_map: Mutex<HashMap<i32, bool>>,
    /// il monitor principale è coperto da finestre (indipendente da «pauseCovered»): serve agli schermi secondari
    pub primary_covered: AtomicBool,
    pub wall_enabled: AtomicBool,
    pub wall_state: Mutex<String>,
    pub clients: AtomicI64,
    pub sp: Mutex<SpState>,
    pub upd: Mutex<UpdState>,
}

pub static S: LazyLock<Shared> = LazyLock::new(|| Shared {
    track: Mutex::new(Track { art_mime: "image/jpeg".into(), ..Default::default() }),
    play: Mutex::new(Play { playing: false, pos: 0.0, dur: 0.0, t_ref: Instant::now() }),
    audio: Mutex::new(Audio { bands: [0.0; NB], peak: 0.0, dev: String::new(), err: String::new() }),
    media_ok: AtomicBool::new(false),
    cfg: RwLock::new(Value::Object(Map::new())),
    set_ver: AtomicU64::new(0),
    set_cid: Mutex::new(String::new()),
    covered: AtomicBool::new(false),
    covered_map: Mutex::new(HashMap::new()),
    primary_covered: AtomicBool::new(false),
    wall_enabled: AtomicBool::new(true),
    wall_state: Mutex::new("avvio".into()),
    clients: AtomicI64::new(0),
    sp: Mutex::new(SpState { state: "nocid".into(), msg: String::new(), items: vec![], ver: 0 }),
    upd: Mutex::new(UpdState {
        latest: String::new(),
        url: String::new(),
        notes: String::new(),
        checked: 0.0,
        error: String::new(),
        shown: String::new(),
        asset: None,
        state: "idle".into(),
        progress: 0,
        msg: String::new(),
        ver: 0,
    }),
});

/// Valore di un'impostazione (con default).
pub fn cfg_get(k: &str) -> Value {
    S.cfg.read().unwrap().get(k).cloned().unwrap_or(Value::Null)
}
pub fn cfg_bool(k: &str, default: bool) -> bool {
    cfg_get(k).as_bool().unwrap_or(default)
}
pub fn cfg_str(k: &str) -> String {
    match cfg_get(k) {
        Value::String(s) => s,
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

pub fn now_secs() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

pub fn bump(v: &AtomicU64) {
    v.fetch_add(1, Ordering::SeqCst);
}
