//! Brano in riproduzione da Windows (SMTC: Spotify o qualunque altro player) e comandi play/pausa/avanti/indietro.
use crate::state::{cfg_bool, log, S};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as Props, GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;

pub enum Cmd {
    PlayPause,
    Next,
    Prev,
}

static TX: LazyLock<Mutex<Option<Sender<Cmd>>>> = LazyLock::new(|| Mutex::new(None));

pub fn send(c: Cmd) {
    if let Some(tx) = TX.lock().unwrap().as_ref() {
        let _ = tx.send(c);
    }
}

fn pick(mgr: &Manager) -> Option<Session> {
    let sessions = mgr.GetSessions().ok()?;
    let n = sessions.Size().ok()?;
    let mut first = None;
    for i in 0..n {
        if let Ok(s) = sessions.GetAt(i) {
            let id = s.SourceAppUserModelId().map(|h| h.to_string_lossy()).unwrap_or_default();
            if id.to_lowercase().contains("spotify") {
                return Some(s);
            }
            if first.is_none() {
                first = Some(s);
            }
        }
    }
    if cfg_bool("onlySpotify", false) {
        return None;
    }
    mgr.GetCurrentSession().ok().or(first)
}

fn read_thumb(props: &Props) -> windows::core::Result<(Vec<u8>, String)> {
    let th = props.Thumbnail()?;
    let stream = th.OpenReadAsync()?.get()?;
    let size = stream.Size()?;
    if size == 0 || size > 12_000_000 {
        return Ok((vec![], "image/jpeg".into()));
    }
    let reader = DataReader::CreateDataReader(&stream)?;
    reader.LoadAsync(size as u32)?.get()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf)?;
    let mime = if buf.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/jpeg" };
    Ok((buf, mime.into()))
}

fn set_idle() {
    let mut t = S.track.lock().unwrap();
    if !t.key.is_empty() {
        let (ver, art_ver) = (t.ver + 1, t.art_ver + 1);
        *t = crate::state::Track { ver, art_ver, art_mime: "image/jpeg".into(), ..Default::default() };
    }
    let mut p = S.play.lock().unwrap();
    p.playing = false;
    p.pos = 0.0;
    p.dur = 0.0;
    p.t_ref = Instant::now();
}

/// 100 ns dal 1601 (come i DateTime di WinRT)
fn now_ticks() -> i64 {
    let unix = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    (unix.as_secs() as i64 + 11_644_473_600) * 10_000_000 + (unix.subsec_nanos() / 100) as i64
}

fn step(mgr: &Manager, rx: &Receiver<Cmd>) -> windows::core::Result<()> {
    let Some(s) = pick(mgr) else {
        set_idle();
        return Ok(());
    };
    while let Ok(c) = rx.try_recv() {
        let _ = match c {
            Cmd::PlayPause => s.TryTogglePlayPauseAsync().and_then(|a| a.get()),
            Cmd::Next => s.TrySkipNextAsync().and_then(|a| a.get()),
            Cmd::Prev => s.TrySkipPreviousAsync().and_then(|a| a.get()),
        };
    }
    let props = s.TryGetMediaPropertiesAsync()?.get()?;
    let title = props.Title().map(|h| h.to_string_lossy()).unwrap_or_default();
    let artist = props.Artist().map(|h| h.to_string_lossy()).unwrap_or_default();
    let album = props.AlbumTitle().map(|h| h.to_string_lossy()).unwrap_or_default();
    let app = s.SourceAppUserModelId().map(|h| h.to_string_lossy()).unwrap_or_default();
    let key = if title.is_empty() && artist.is_empty() { String::new() } else { format!("{app}|{title}|{artist}|{album}") };
    let changed = S.track.lock().unwrap().key != key;
    if changed {
        let (art, mime) = read_thumb(&props).unwrap_or_else(|e| {
            log(format!("copertina: {e}"));
            (vec![], "image/jpeg".into())
        });
        let mut t = S.track.lock().unwrap();
        t.key = key;
        t.title = title;
        t.artist = artist;
        t.album = album;
        t.app = app;
        t.art = art;
        t.art_mime = mime;
        t.ver += 1;
        t.art_ver += 1;
        let mut p = S.play.lock().unwrap();
        p.pos = 0.0;
        p.t_ref = Instant::now();
    }
    let tl = s.GetTimelineProperties()?;
    let playing = s.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing;
    let mut pos = tl.Position()?.Duration as f64 / 1e7;
    let dur = (tl.EndTime()?.Duration - tl.StartTime()?.Duration) as f64 / 1e7;
    if playing {
        let lu = tl.LastUpdatedTime()?.UniversalTime;
        pos += ((now_ticks() - lu) as f64 / 1e7).max(0.0);
    }
    if dur > 0.0 {
        pos = pos.min(dur);
    }
    let mut p = S.play.lock().unwrap();
    p.playing = playing;
    p.pos = pos.max(0.0);
    p.dur = dur.max(0.0);
    p.t_ref = Instant::now();
    Ok(())
}

pub fn thread() {
    let (tx, rx) = channel();
    *TX.lock().unwrap() = Some(tx);
    unsafe {
        let _ = windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED);
    }
    loop {
        match Manager::RequestAsync().and_then(|a| a.get()) {
            Ok(mgr) => {
                S.media_ok.store(true, std::sync::atomic::Ordering::SeqCst);
                log("media: manager ok");
                loop {
                    if let Err(e) = step(&mgr, &rx) {
                        log(format!("media: {e}"));
                        std::thread::sleep(Duration::from_millis(1500));
                    }
                    std::thread::sleep(Duration::from_millis(300));
                }
            }
            Err(e) => {
                log(format!("media: manager non disponibile: {e}"));
                std::thread::sleep(Duration::from_secs(2));
            }
        }
    }
}
