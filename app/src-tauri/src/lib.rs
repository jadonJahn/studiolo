mod api;
// Music capture and now-playing use Windows-only APIs; elsewhere they're inert stand-ins.
#[cfg_attr(not(windows), path = "unsupported/audio.rs")]
mod audio;
mod db;
#[cfg_attr(not(windows), path = "unsupported/media.rs")]
mod media;

use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent};

const API_PORT: u16 = 47800;

struct AppState {
    capture: audio::Capture,
    now_playing: media::Shared,
    db: Arc<Mutex<Connection>>,
    data_dir: PathBuf,
    db_path: PathBuf,
    app_name: String,
    /// The local API runs only while the user has it turned on in Settings.
    api: Mutex<Option<api::Handle>>,
}

#[tauri::command]
fn sync_snapshot(state: State<AppState>, snapshot: db::Snapshot) -> Result<(), String> {
    let mut c = state.db.lock().map_err(|e| e.to_string())?;
    db::write_snapshot(&mut c, &snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
fn sync_timer(state: State<AppState>, timer: serde_json::Value) -> Result<(), String> {
    let c = state.db.lock().map_err(|e| e.to_string())?;
    db::kv_set(&c, "timer", &timer.to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_snapshot(state: State<AppState>) -> Result<Option<String>, String> {
    let c = state.db.lock().map_err(|e| e.to_string())?;
    db::kv_get(&c, "snapshot").map_err(|e| e.to_string())
}

#[tauri::command]
async fn audio_sources() -> Result<Vec<audio::Source>, String> {
    // COM work off the main thread.
    tauri::async_runtime::spawn_blocking(audio::sources).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn audio_start(app: tauri::AppHandle, state: State<AppState>, source: Option<String>) -> Result<String, String> {
    state.capture.start(app, source)
}

#[tauri::command]
fn audio_stop(state: State<AppState>) {
    state.capture.stop();
}

#[tauri::command]
fn now_playing(state: State<AppState>) -> Option<media::NowPlaying> {
    state.now_playing.lock().ok().and_then(|g| g.clone())
}

#[derive(Serialize)]
struct ApiInfo {
    port: Option<u16>,
    db_path: String,
}

fn info(state: &AppState, api: &Option<api::Handle>) -> ApiInfo {
    ApiInfo { port: api.as_ref().map(|h| h.port), db_path: state.db_path.to_string_lossy().into() }
}

#[tauri::command]
fn api_info(state: State<AppState>) -> Result<ApiInfo, String> {
    let api = state.api.lock().map_err(|e| e.to_string())?;
    Ok(info(&state, &api))
}

#[tauri::command]
fn api_set_enabled(state: State<AppState>, on: bool) -> Result<ApiInfo, String> {
    let mut api = state.api.lock().map_err(|e| e.to_string())?;
    if on && api.is_none() {
        *api = api::start(state.db.clone(), state.data_dir.clone(), state.app_name.clone(), API_PORT);
    } else if !on {
        if let Some(h) = api.take() {
            h.stop();
        }
    }
    Ok(info(&state, &api))
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("flowstate.db");
            let conn = Arc::new(Mutex::new(db::open(&db_path)?));
            let now_playing: media::Shared = Arc::new(Mutex::new(None));
            media::spawn_watcher(app.handle().clone(), now_playing.clone());
            app.manage(AppState { capture: audio::Capture::new(), now_playing, db: conn, data_dir: dir, db_path, app_name: app.package_info().name.clone(), api: Mutex::new(None) });

            // WebView2 throttles hidden pages' timers; a native heartbeat keeps the
            // timer's completion check (and chime) on time while minimized or in the tray.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let _ = handle.emit("tick", ());
            });

            let name = app.package_info().name.clone();
            let show = MenuItem::with_id(app, "show", format!("Show {name}"), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("bundle icon"))
                .tooltip(&name)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id().as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        // Closing the window hides to the tray so timers and the API keep running.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            sync_snapshot, sync_timer, load_snapshot, api_info, api_set_enabled, audio_sources, audio_start, audio_stop, now_playing
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
