# Studiolo: developer guide

How to run, build and find your way around the code. For what the app does and how to install it, see the [main README](../README.md).

## Run

```bash
npm install
npm run dev        # http://localhost:5178
npm run build      # production build → dist/ (installable PWA, works offline)
npm run preview    # serve the production build
```

## Desktop app (Tauri)

```bash
npm run tauri dev      # desktop window with hot reload
npm run tauri build    # → src-tauri/target/release/bundle/{nsis,msi}/
```

The desktop shell adds these on top of the web app:

- **SQLite mirror.** All data is mirrored to `%APPDATA%\io.github.jadonjahn.studiolo\flowstate.db`. If the webview's storage is ever wiped, the app restores from this file.
- **Read-only HTTP API (opt-in).** Turn on *Settings → Data & API → Local data API* to serve your data at `127.0.0.1:47800` (`/api` lists the endpoints) for scripts and automations. It's off by default; while it's on, any program on the PC can read it. To reach it from other machines, put it behind a tunnel such as `tailscale serve`.
- **Tray.** Closing the window quits the app. Turn on *Settings → Timer → Keep running in the tray when closed* to have timers, the widget and the API keep going in the background; then use the tray menu's Quit to exit. Opening the app again while it's running brings the existing window back instead of starting a second copy.
- **Floating widget.** While a session runs and Studiolo isn't the active window, a small always-on-top timer floats over your other apps: a card with the live art, or a compact bar. It never takes keyboard focus. (In Chromium browsers, focus view has a pop-out button that does the same with Picture-in-Picture.)
- **Native 1-second heartbeat.** It keeps the timer and chime on time while the window is minimized. WebView2 throttles hidden pages and ignores Tauri's throttling switch on Windows.

## Features

- **Timer modes:** Pomodoro (focus, short break, long break, a long break every N blocks, optional auto-start), a countdown timer, and a stopwatch. Time is computed from timestamps, so it stays accurate in background tabs and after a reload.
- **Activities:** Study, Deep Work, Create, Read, Code, Exercise and Meditate, plus any you add. Each one has its own color and art palette.
- **Tasks:** estimates in focus blocks and tracked time per task. Press ▶ on a task to start focusing on it.
- **Focus view:** the art fills the screen. The controls fade out when the mouse is idle, there's a fullscreen button and a screen wake lock. The clock can show always, only while you're active, or never, and each set of buttons can be pinned or left hidden until you move the mouse.
- **Generative art:** each session gets a seed, and its piece builds as the session progresses:
  - *Flow Field* — particles trace a curl-noise vector field (Canvas 2D)
  - *Harmonograph* — a damped four-pendulum pen draws one figure over the whole session
  - *Nebula* — domain-warped fbm clouds that brighten with progress (WebGL2)
  - *Topography* — contour lines that are mapped from the lowlands up
  - *Aurora* — light curtains that rise over a ridge
  - *Stained Glass* — a Voronoi window that fills in pane by pane
- **Gallery:** every finished focus session saves its artwork to IndexedDB with a generated title. You can view, download or delete pieces.
- **Stats:** today, the last 7 days, streaks, a 14-day stacked chart, a year heatmap colored against your daily goal, a breakdown by activity, time of day, a session log, and 20 achievements.
- **Music visualizer (Windows desktop):** the art can react to whatever is playing on the PC. You can capture all audio except Studiolo's own sounds, or just one app (Brave, Apple Music…). The capture uses WASAPI process loopback (Windows sending Studiolo a copy of an app's audio output). Rust does the FFT (frequency analysis), turning the audio into 48 frequency bands plus beat detection, and sends ~60 frames/s to the art. There's an audio-reactive layer on every style, plus a dedicated *Visualizer* style. Now-playing info comes from Windows' media transport controls (the same info shown in the volume flyout), with optional palettes taken from the album art.
- **Sound:** a synthesized chime and ambient sound (rain, ocean, brown/pink/white noise, drone) that plays only while you're focusing. There are no audio files.
- **Data:** everything stays local in the browser. You can export and import JSON backups.

## Keyboard

`Space` start/pause · `R` reset · `S` skip / end early · `F` focus view · `A` next art style · `Esc` exit focus · `1–5` switch pages

## Performance

- Art is capped at about 60fps, so high-refresh screens don't double the GPU work.
- The art loop idles on the Tasks, Stats, Gallery and Settings pages. Those pages sit on blurred glass, and re-blurring a moving canvas every frame is expensive.
- Quality is adaptive. If frames stay slower than about 38fps, WebGL resolution or flow-field particle count steps down.

## Layout

```
src-tauri/src/  lib.rs (setup, tray, commands), db.rs + schema.sql (SQLite mirror), api.rs (HTTP API + tests),
                audio.rs + media.rs (Windows music capture; unsupported/ has stand-ins for other platforms)
src/
  art/          engines (flowField, harmonograph, shaders), palettes, seeded noise, ArtCanvas
  components/   TimerHome, FocusView, Tasks, Stats, Gallery, Settings, Controls, icons
  lib/          time math, stats + achievements, gallery (IndexedDB), sound (WebAudio), actions
  lib/desktop.ts  Tauri bridge: SQLite sync, restore, native tick, API toggle
  lib/widget.ts   floating widget: desktop window host + browser Picture-in-Picture
  store.ts      zustand store (persisted to localStorage): settings, activities, tasks, sessions, timer
  extensions.ts optional build-time extras, loaded from src/private/ when that folder exists
```

To add an art style, write an `EngineFactory` (`art/engine.ts`) and then register it in `ART_STYLES` and in `ENGINES` (`art/ArtCanvas.tsx`). Engines get `progress` (0→1) and `energy` (how active the art should be). A piece should be complete at progress 1.
