//! Ascolta l'uscita audio del PC (WASAPI loopback) e la riduce a 64 bande per l'anello e lo spettro.
use crate::state::{log, NB, S};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const NFFT: usize = 4096;

struct Ring {
    buf: Vec<f32>,
    fresh: bool,
    last: Instant,
    peak: f32,
}

fn default_output_name() -> Option<String> {
    cpal::default_host().default_output_device().and_then(|d| d.name().ok())
}

fn session() -> Result<(), String> {
    let host = cpal::default_host();
    let dev = host.default_output_device().ok_or("nessun dispositivo di uscita")?;
    let name = dev.name().map_err(|e| e.to_string())?;
    let sc = dev.default_output_config().map_err(|e| e.to_string())?;
    if sc.sample_format() != cpal::SampleFormat::F32 {
        return Err(format!("formato audio non supportato: {:?}", sc.sample_format()));
    }
    let ch = sc.channels().max(1) as usize;
    let sr = sc.sample_rate().0 as f32;
    let ring = Arc::new(Mutex::new(Ring { buf: vec![0.0; NFFT], fresh: false, last: Instant::now() - Duration::from_secs(10), peak: 0.0 }));
    let r2 = ring.clone();
    // su WASAPI, aprire in ingresso un dispositivo di USCITA = registrazione loopback
    let stream = dev
        .build_input_stream(
            &sc.config(),
            move |data: &[f32], _| {
                let frames = data.len() / ch;
                if frames == 0 {
                    return;
                }
                let mut r = r2.lock().unwrap();
                let n = frames.min(NFFT);
                r.buf.copy_within(n.., 0);
                let mut pk = 0f32;
                let start = NFFT - n;
                let off = frames - n;
                for i in 0..n {
                    let base = (off + i) * ch;
                    let mut s = 0f32;
                    for c in 0..ch {
                        s += data[base + c];
                    }
                    let v = s / ch as f32;
                    pk = pk.max(v.abs());
                    r.buf[start + i] = v;
                }
                r.fresh = true;
                r.last = Instant::now();
                r.peak = pk;
            },
            |e| log(format!("audio: {e}")),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    {
        let mut a = S.audio.lock().unwrap();
        if a.dev != name || !a.err.is_empty() {
            log(format!("audio: aperto {name} {ch} {sr}")); // nel silenzio il flusso si riapre spesso: lo scrivo solo se cambia qualcosa
        }
        a.dev = name.clone();
        a.err.clear();
    }

    let win: Vec<f32> = (0..NFFT).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (NFFT - 1) as f32).cos()).collect();
    let binhz = sr / NFFT as f32;
    let top = 16000f32.min(sr / 2.0 - 100.0);
    let edges: Vec<f32> = (0..=NB).map(|k| 35.0 * (top / 35.0).powf(k as f32 / NB as f32)).collect();
    let lo: Vec<usize> = (0..NB).map(|i| ((edges[i] / binhz).floor() as usize).max(1)).collect();
    let hi: Vec<usize> = (0..NB).map(|i| ((edges[i + 1] / binhz).ceil() as usize).max(lo[i] + 1)).collect();
    let fft = FftPlanner::<f32>::new().plan_fft_forward(NFFT);
    let mut spec = vec![Complex::new(0f32, 0f32); NFFT];
    let opened = Instant::now();
    let mut last_check = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(16));
        let (buf, age, peak) = {
            let mut r = ring.lock().unwrap();
            let age = r.last.elapsed().as_secs_f32();
            let b = if r.fresh { Some(r.buf.clone()) } else { None };
            r.fresh = false;
            (b, age, r.peak)
        };
        {
            let mut a = S.audio.lock().unwrap();
            a.peak = if age < 0.5 { peak } else { 0.0 };
            if let Some(b) = buf {
                for i in 0..NFFT {
                    spec[i] = Complex::new(b[i] * win[i], 0.0);
                }
                fft.process(&mut spec);
                for i in 0..NB {
                    let mut m = 0f32;
                    for j in lo[i]..hi[i].min(NFFT / 2) {
                        m = m.max(spec[j].norm() * (4.0 / NFFT as f32));
                    }
                    let db = 20.0 * (m + 1e-6).log10();
                    a.bands[i] = ((db + 78.0) / 66.0).clamp(0.0, 1.0);
                }
            } else if age > 0.25 {
                for v in a.bands.iter_mut() {
                    *v *= 0.8;
                }
            }
        }
        // nessun dato da un po': col silenzio è normale, ma può essere un flusso morto (cambio risoluzione/HDMI…)
        if age > 2.5 && opened.elapsed() > Duration::from_secs(5) {
            if S.play.lock().unwrap().playing {
                log("audio: flusso fermo, riapro");
            }
            return Ok(());
        }
        if last_check.elapsed() > Duration::from_secs(3) {
            last_check = Instant::now();
            if default_output_name().as_deref() != Some(name.as_str()) {
                log("audio: cambio dispositivo");
                return Ok(());
            }
        }
    }
}

pub fn thread() {
    loop {
        if let Err(e) = session() {
            log(format!("audio: {e}"));
            let mut a = S.audio.lock().unwrap();
            a.err = e;
            a.bands = [0.0; NB];
            drop(a);
            std::thread::sleep(Duration::from_secs(3));
        }
    }
}
