//! Music-reactive input: captures what's playing via WASAPI process loopback,
//! either everything except this app itself or one app's process tree, and
//! streams a compact spectrum to the webview ~60 times a second.

use rustfft::{FftPlanner, num_complex::Complex};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use wasapi::{AudioClient, DeviceEnumerator, Direction, SampleType, SessionState, StreamMode, WaveFormat};
use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::core::PWSTR;

pub const BANDS: usize = 48;
const FFT_N: usize = 2048;
const RATE: usize = 48_000;

#[derive(Serialize, Clone)]
pub struct Source {
    /// Executable name, used as the stable id (pids change between launches).
    pub exe: String,
    pub name: String,
    pub peak: f32,
}

#[derive(Serialize, Clone)]
struct Frame {
    /// 48 log-spaced bands, 32 Hz – 16 kHz, 0–255.
    b: Vec<u8>,
    level: f32,
    bass: f32,
    mid: f32,
    treble: f32,
    beat: bool,
}

/// Running capture; bumping `generation` tells the old thread to exit.
pub struct Capture {
    generation: Arc<AtomicU64>,
    running: Arc<AtomicBool>,
}

impl Capture {
    pub fn new() -> Self {
        Self { generation: Arc::new(AtomicU64::new(0)), running: Arc::new(AtomicBool::new(false)) }
    }

    pub fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.running.store(false, Ordering::SeqCst);
    }

    /// `exe = None` captures all system audio except this app's own sounds.
    pub fn start(&self, app: AppHandle, exe: Option<String>) -> Result<String, String> {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (pid, include, label) = match &exe {
            None => (std::process::id(), false, "All audio".to_string()),
            Some(name) => {
                let pid = resolve_root_pid(name).ok_or_else(|| format!("{} isn't running", friendly(name)))?;
                (pid, true, friendly(name))
            }
        };
        let gen_ref = self.generation.clone();
        let running = self.running.clone();
        running.store(true, Ordering::SeqCst);
        std::thread::Builder::new()
            .name("flowstate-audio".into())
            .spawn(move || {
                let emit = |f: Frame| {
                    let _ = app.emit("audio", f);
                };
                if let Err(e) = capture_loop(emit, pid, include, generation, &gen_ref) {
                    let _ = app.emit("audio-error", e);
                }
                if gen_ref.load(Ordering::SeqCst) == generation {
                    running.store(false, Ordering::SeqCst);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(label)
    }
}

fn capture_loop(
    mut emit: impl FnMut(Frame),
    pid: u32,
    include: bool,
    generation: u64,
    current: &AtomicU64,
) -> Result<(), String> {
    let e = |x: wasapi::WasapiError| x.to_string();
    let _ = wasapi::initialize_mta();
    let format = WaveFormat::new(32, 32, &SampleType::Float, RATE, 2, None);
    let mut client = AudioClient::new_application_loopback_client(pid, include).map_err(e)?;
    client
        .initialize_client(&format, &Direction::Capture, &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 })
        .map_err(e)?;
    let event = client.set_get_eventhandle().map_err(e)?;
    let capture = client.get_audiocaptureclient().map_err(e)?;
    client.start_stream().map_err(e)?;
    // 1 ms timer resolution while capturing; the default ~15.6 ms tick halves the
    // frame rate whenever the source goes quiet and packets stop driving the loop.
    unsafe { windows::Win32::Media::timeBeginPeriod(1) };

    let mut analyzer = Analyzer::new();
    let mut raw = vec![0u8; 0];
    const FRAME: Duration = Duration::from_micros(16_667);
    let mut next_emit = Instant::now() + FRAME;
    while current.load(Ordering::SeqCst) == generation {
        // Wake on new audio or when the next frame is due (timeouts are normal in silence).
        let due = next_emit.saturating_duration_since(Instant::now());
        let _ = event.wait_for_event(due.as_millis().clamp(1, 20) as u32);
        loop {
            let frames = capture.get_next_packet_size().map_err(e)?.unwrap_or(0) as usize;
            if frames == 0 {
                break;
            }
            raw.resize(frames * 8, 0);
            let (got, info) = capture.read_from_device(&mut raw).map_err(e)?;
            let n = got as usize;
            if info.flags.silent {
                analyzer.push_silence(n);
            } else {
                for f in raw[..n * 8].chunks_exact(8) {
                    let l = f32::from_le_bytes([f[0], f[1], f[2], f[3]]);
                    let r = f32::from_le_bytes([f[4], f[5], f[6], f[7]]);
                    analyzer.push(0.5 * (l + r));
                }
            }
        }
        let now = Instant::now();
        if now >= next_emit {
            // Skip ahead rather than burst if we fell behind.
            next_emit = (next_emit + FRAME).max(now + Duration::from_millis(1));
            emit(analyzer.frame());
        }
    }
    let _ = client.stop_stream();
    unsafe { windows::Win32::Media::timeEndPeriod(1) };
    Ok(())
}

struct Analyzer {
    ring: Vec<f32>,
    pos: usize,
    window: Vec<f32>,
    fft: Arc<dyn rustfft::Fft<f32>>,
    buf: Vec<Complex<f32>>,
    edges: Vec<(usize, usize)>,
    smooth: [f32; BANDS],
    ceiling_db: f32,
    bass_avg: f32,
    last_beat: Instant,
}

impl Analyzer {
    fn new() -> Self {
        let window = (0..FFT_N)
            .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_N - 1) as f32).cos())
            .collect();
        let df = RATE as f32 / FFT_N as f32;
        let (lo, hi) = (32.0f32, 16_000.0f32);
        let edges = (0..BANDS)
            .map(|i| {
                let f0 = lo * (hi / lo).powf(i as f32 / BANDS as f32);
                let f1 = lo * (hi / lo).powf((i + 1) as f32 / BANDS as f32);
                let k0 = (f0 / df).floor() as usize;
                let k1 = ((f1 / df).ceil() as usize).max(k0 + 1);
                (k0.max(1), k1.min(FFT_N / 2))
            })
            .collect();
        Self {
            ring: vec![0.0; FFT_N],
            pos: 0,
            window,
            fft: FftPlanner::new().plan_fft_forward(FFT_N),
            buf: vec![Complex::default(); FFT_N],
            edges,
            smooth: [0.0; BANDS],
            ceiling_db: -30.0,
            bass_avg: 0.0,
            last_beat: Instant::now(),
        }
    }

    fn push(&mut self, s: f32) {
        self.ring[self.pos] = s;
        self.pos = (self.pos + 1) % FFT_N;
    }

    fn push_silence(&mut self, n: usize) {
        for _ in 0..n.min(FFT_N) {
            self.push(0.0);
        }
    }

    fn frame(&mut self) -> Frame {
        for i in 0..FFT_N {
            let s = self.ring[(self.pos + i) % FFT_N];
            self.buf[i] = Complex::new(s * self.window[i], 0.0);
        }
        self.fft.process(&mut self.buf);
        let scale = 2.0 / FFT_N as f32;
        let mut raw = [0.0f32; BANDS];
        let mut frame_max = -120.0f32;
        for (i, &(k0, k1)) in self.edges.iter().enumerate() {
            let m = self.buf[k0..k1].iter().map(|c| c.norm()).fold(0.0, f32::max) * scale;
            let db = 20.0 * (m + 1e-9).log10();
            frame_max = frame_max.max(db);
            raw[i] = db;
        }
        // Auto-gain: a slowly falling ceiling keeps quiet playback lively and loud playback unclipped.
        self.ceiling_db = (self.ceiling_db - 0.08).max(frame_max).max(-60.0);
        let floor = self.ceiling_db - 55.0;
        for i in 0..BANDS {
            let v = ((raw[i] - floor) / (self.ceiling_db - floor)).clamp(0.0, 1.0);
            let v = v * v; // perceptual contrast
            let k = if v > self.smooth[i] { 0.6 } else { 0.18 };
            self.smooth[i] += (v - self.smooth[i]) * k;
        }
        let avg = |r: std::ops::Range<usize>| r.clone().map(|i| self.smooth[i]).sum::<f32>() / r.len() as f32;
        let bass = avg(0..9);
        let mid = avg(9..29);
        let treble = avg(29..BANDS);
        let level = self.smooth.iter().fold(0.0, |a, b| a + b) / BANDS as f32;
        let silent = frame_max < -75.0;
        let raw_bass = (0..9).map(|i| ((raw[i] - floor) / (self.ceiling_db - floor)).clamp(0.0, 1.0)).sum::<f32>() / 9.0;
        let beat = !silent
            && raw_bass > self.bass_avg * 1.3 + 0.04
            && raw_bass > 0.3
            && self.last_beat.elapsed() > Duration::from_millis(250);
        if beat {
            self.last_beat = Instant::now();
        }
        self.bass_avg += (raw_bass - self.bass_avg) * 0.05;
        Frame {
            b: self.smooth.iter().map(|v| (v * 255.0) as u8).collect(),
            level,
            bass,
            mid,
            treble,
            beat,
        }
    }
}

/* ── Process discovery ─────────────────────────────────────────── */

fn exe_name(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; MAX_PATH as usize];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit('\\').next().map(str::to_string)
    }
}

/// pid -> (parent pid, exe name) for every process.
fn process_table() -> HashMap<u32, (u32, String)> {
    let mut map = HashMap::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return map };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                map.insert(e.th32ProcessID, (e.th32ParentProcessID, String::from_utf16_lossy(&e.szExeFile[..len])));
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    map
}

/// Topmost ancestor with the same exe name, so the whole app (e.g. Brave's
/// separate audio process) is captured as one tree.
fn resolve_root_pid(exe: &str) -> Option<u32> {
    let table = process_table();
    let same = |pid: &u32| table.get(pid).is_some_and(|(_, n)| n.eq_ignore_ascii_case(exe));
    let any = table.keys().copied().find(|p| same(p))?;
    let mut pid = any;
    while let Some((parent, _)) = table.get(&pid) {
        if *parent == pid || !same(parent) {
            break;
        }
        pid = *parent;
    }
    Some(pid)
}

pub fn friendly(exe: &str) -> String {
    let stem = exe.trim_end_matches(".exe").trim_end_matches(".EXE");
    match stem.to_ascii_lowercase().as_str() {
        "brave" => "Brave".into(),
        "chrome" => "Chrome".into(),
        "msedge" => "Edge".into(),
        "firefox" => "Firefox".into(),
        "applemusic" | "amplibraryagent" => "Apple Music".into(),
        "spotify" => "Spotify".into(),
        "vlc" => "VLC".into(),
        "discord" => "Discord".into(),
        _ => {
            let mut c = stem.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        }
    }
}

/// Apps currently holding an audio session on the default output, loudest first.
pub fn sources() -> Result<Vec<Source>, String> {
    let e = |x: wasapi::WasapiError| x.to_string();
    let _ = wasapi::initialize_mta();
    let dev = DeviceEnumerator::new().map_err(e)?.get_default_device(&Direction::Render).map_err(e)?;
    let sessions = dev.get_iaudiosessionmanager().map_err(e)?.get_audiosessionenumerator().map_err(e)?;
    let me = std::process::id();
    let own_exe = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
    let table = process_table();
    let mut out: HashMap<String, Source> = HashMap::new();
    for i in 0..sessions.get_count().map_err(e)? {
        let Ok(s) = sessions.get_session(i) else { continue };
        let Ok(pid) = s.get_process_id() else { continue };
        if pid == 0 || pid == me || s.get_state().map(|st| st == SessionState::Expired).unwrap_or(true) {
            continue;
        }
        let Some(exe) = table.get(&pid).map(|(_, n)| n.clone()).or_else(|| exe_name(pid)) else { continue };
        if own_exe.as_deref().is_some_and(|me| exe.eq_ignore_ascii_case(me)) {
            continue;
        }
        let peak = s.get_audiometerinformation().and_then(|m| m.get_peak_value()).unwrap_or(0.0);
        let entry = out.entry(exe.to_ascii_lowercase()).or_insert(Source { name: friendly(&exe), exe, peak: 0.0 });
        entry.peak = entry.peak.max(peak);
    }
    let mut list: Vec<_> = out.into_values().collect();
    list.sort_by(|a, b| b.peak.total_cmp(&a.peak).then(a.name.cmp(&b.name)));
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_lands_in_expected_band() {
        let mut a = Analyzer::new();
        for i in 0..FFT_N * 2 {
            a.push(0.5 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / RATE as f32).sin());
        }
        let mut f = a.frame();
        for _ in 0..10 {
            f = a.frame();
        }
        let peak = f.b.iter().enumerate().max_by_key(|(_, v)| **v).unwrap().0;
        // 440 Hz on a 32 Hz–16 kHz log scale of 48 bands ≈ band 20.
        assert!((19..=21).contains(&peak), "peak band {peak}, frame {:?}", f.b);
        assert!(f.mid > f.bass && f.mid > f.treble);
    }

    #[test]
    fn lists_sources() {
        let list = sources().expect("enumerate sessions");
        eprintln!("sources: {:?}", list.iter().map(|s| (&s.name, &s.exe, s.peak)).collect::<Vec<_>>());
    }

    #[test]
    fn live_system_capture_produces_frames() {
        let current = AtomicU64::new(1);
        let mut frames = 0;
        let mut first: Option<Instant> = None;
        let mut max_level = 0.0f32;
        let start = Instant::now();
        let res = std::thread::scope(|sc| {
            let cur = &current;
            sc.spawn(move || {
                std::thread::sleep(Duration::from_millis(2500));
                cur.store(2, Ordering::SeqCst);
            });
            capture_loop(
                |f| {
                    first.get_or_insert_with(Instant::now);
                    frames += 1;
                    max_level = max_level.max(f.level);
                },
                std::process::id(),
                false,
                1,
                &current,
            )
        });
        res.expect("capture");
        let steady = first.map(|t| t.elapsed()).unwrap_or_default();
        let fps = frames as f32 / steady.as_secs_f32().max(0.001);
        eprintln!("frames {frames} in {:?} ({fps:.1}/s after warm-up), max level {max_level:.3}", start.elapsed());
        assert!(fps > 50.0, "only {fps:.1} frames/s");
    }
}
