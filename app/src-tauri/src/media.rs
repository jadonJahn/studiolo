//! "Now playing" from Windows' media transport controls (the same info the
//! volume flyout shows), polled and pushed to the webview when it changes.

use base64::Engine;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;

#[derive(Serialize, Clone, PartialEq, Default)]
pub struct NowPlaying {
    pub app: String,
    pub app_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    /// data: URL of the artwork, if any.
    pub art: Option<String>,
}

pub type Shared = Arc<Mutex<Option<NowPlaying>>>;

fn app_label(id: &str) -> String {
    let l = id.to_ascii_lowercase();
    if l.contains("applemusic") {
        "Apple Music".into()
    } else if l.contains("brave") {
        "Brave".into()
    } else if l.contains("chrome") {
        "Chrome".into()
    } else if l.contains("msedge") || l.contains("edge") {
        "Edge".into()
    } else if l.contains("spotify") {
        "Spotify".into()
    } else if l.contains("firefox") {
        "Firefox".into()
    } else {
        id.split(['!', '.', '_']).next().unwrap_or(id).to_string()
    }
}

fn read_art(s: &Session) -> Option<String> {
    let props = s.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let thumb = props.Thumbnail().ok()?;
    let stream = thumb.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > 4_000_000 {
        return None;
    }
    let mime = stream.ContentType().map(|c| c.to_string()).unwrap_or_else(|_| "image/png".into());
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.join().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(format!("data:{};base64,{}", if mime.is_empty() { "image/png" } else { &mime }, base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Prefer a session that's actually playing, then the system's "current" one.
fn pick(mgr: &Manager) -> Option<Session> {
    let sessions = mgr.GetSessions().ok()?;
    let mut fallback = mgr.GetCurrentSession().ok();
    for s in sessions {
        let playing = s.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()).map(|st| st == Status::Playing).unwrap_or(false);
        if playing {
            return Some(s);
        }
        if fallback.is_none() {
            fallback = Some(s);
        }
    }
    fallback
}

fn snapshot(mgr: &Manager, prev: &Option<NowPlaying>) -> Option<NowPlaying> {
    let s = pick(mgr)?;
    let app_id = s.SourceAppUserModelId().ok()?.to_string();
    let props = s.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let title = props.Title().map(|t| t.to_string()).unwrap_or_default();
    if title.is_empty() {
        return None;
    }
    let artist = props.Artist().map(|t| t.to_string()).unwrap_or_default();
    let album = props.AlbumTitle().map(|t| t.to_string()).unwrap_or_default();
    let playing = s.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()).map(|st| st == Status::Playing).unwrap_or(false);
    // Artwork is only re-read when the track changes.
    let art = match prev {
        Some(p) if p.title == title && p.artist == artist && p.app_id == app_id => p.art.clone(),
        _ => read_art(&s),
    };
    Some(NowPlaying { app: app_label(&app_id), app_id, title, artist, album, playing, art })
}

pub fn spawn_watcher(app: AppHandle, shared: Shared) {
    std::thread::Builder::new()
        .name("flowstate-media".into())
        .spawn(move || {
            let _ = wasapi::initialize_mta();
            let mut mgr: Option<Manager> = None;
            loop {
                if mgr.is_none() {
                    mgr = Manager::RequestAsync().ok().and_then(|op| op.join().ok());
                }
                if let Some(m) = &mgr {
                    let prev = shared.lock().ok().and_then(|g| g.clone());
                    let next = snapshot(m, &prev);
                    if next != prev {
                        if let Ok(mut g) = shared.lock() {
                            *g = next.clone();
                        }
                        let _ = app.emit("nowplaying", next);
                    }
                }
                std::thread::sleep(Duration::from_millis(1500));
            }
        })
        .expect("spawn media watcher");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_manager_responds() {
        let _ = wasapi::initialize_mta();
        let mgr = Manager::RequestAsync().unwrap().join().expect("GSMTC manager");
        let np = snapshot(&mgr, &None);
        eprintln!(
            "now playing: {:?}",
            np.as_ref().map(|n| (&n.app, &n.title, &n.artist, n.playing, n.art.as_ref().map(|a| a.len())))
        );
    }
}
