//! Music capture needs WASAPI process loopback, which only exists on Windows.
//! Other platforms get this stand-in so the app builds and the visualizer stays off.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize, Clone)]
pub struct Source {
    pub exe: String,
    pub name: String,
    pub peak: f32,
}

pub struct Capture;

impl Capture {
    pub fn new() -> Self {
        Self
    }

    pub fn stop(&self) {}

    pub fn start(&self, _app: AppHandle, _exe: Option<String>) -> Result<String, String> {
        Err("Music capture is only available on Windows".into())
    }
}

pub fn sources() -> Result<Vec<Source>, String> {
    Ok(Vec::new())
}
