//! Now-playing comes from Windows' media transport controls. Other platforms
//! report nothing playing.

use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

#[derive(Serialize, Clone, PartialEq, Default)]
pub struct NowPlaying {
    pub app: String,
    pub app_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    pub art: Option<String>,
}

pub type Shared = Arc<Mutex<Option<NowPlaying>>>;

pub fn spawn_watcher(_app: AppHandle, _shared: Shared) {}
