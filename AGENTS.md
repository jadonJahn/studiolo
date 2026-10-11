# AGENTS.md

Guide for AI coding agents (and humans) working in this repo. If someone sent you a link to Studiolo and asked "what is this?" or "help me with it", start here.

## What Studiolo is

A focus timer (Pomodoro / countdown / stopwatch) that paints a seeded generative artwork while you work. The piece builds as the session progresses; finished pieces are saved to a local gallery. Ships as:

- **A web app / PWA** — React + TypeScript, built with Vite, works offline. Hosted at https://jadonjahn.github.io/studiolo/.
- **A Windows desktop app** — the same web app inside a Tauri 2 shell (Rust). Adds a floating always-on-top mini timer, music-reactive art via WASAPI audio capture, a SQLite mirror of the data, an optional read-only local HTTP API, tray mode, and in-app updates. Installers: https://github.com/jadonJahn/studiolo/releases/latest.

There is **no backend and no account**. All data lives on the user's device. Do not add network calls, analytics, or telemetry without an explicit opt-in setting.

User-facing docs: [README.md](README.md). Code tour: [app/README.md](app/README.md). PR checklist: [CONTRIBUTING.md](CONTRIBUTING.md).

## Commands

All JavaScript commands run from `app/`. Node 22+. Rust stable for the desktop app.

```bash
cd app
npm install
npm run dev          # web app on http://localhost:5178 (strict port)
npm run typecheck    # tsc -b
npm test             # vitest (unit tests in src/**/*.test.ts)
npm run build        # production web build → app/dist
npm run tauri dev    # desktop app with hot reload
npm run tauri build  # Windows installers → app/src-tauri/target/release/bundle/
cd src-tauri && cargo test   # Rust tests; audio-device tests are #[ignore]d (run with -- --ignored)
```

Before finishing a change, run `npm run typecheck && npm test` (and `cargo test` in `app/src-tauri` if you touched Rust). CI runs these on Ubuntu (web) and Windows (Rust), plus a Linux compile check of the non-Windows stand-ins.

## Repo map

```
README.md, CHANGELOG.md, CONTRIBUTING.md, LICENSE (MIT)
docs/screenshots/         images used by README.md
.github/workflows/        ci.yml (checks), release.yml (tag vX.Y.Z → draft release), pages.yml (web app → GitHub Pages)
app/
  index.html, vite.config.ts   app name and version come from src-tauri/tauri.conf.json
  public/icon.svg
  src/
    main.tsx          entry; decides main window vs. floating widget window; starts desktop wiring
    App.tsx           shell: nav, pages, keyboard shortcuts, toasts, welcome, update button
    store.ts          zustand store (persisted to localStorage key "flowstate-v1"): settings, activities,
                      tasks, sessions, timer state machine; useUI = ephemeral UI state; migrateSettings()
    types.ts          Settings, TimerState, Session, Task, Activity
    brand.ts          APP_NAME / APP_VERSION / REPO_URL
    hooks.ts          timerTick(), timer driver, wake lock, idle detection, achievements
    extensions.ts     optional build-time overrides loaded from src/private/ (absent in this repo)
    art/              engine.ts (EngineFactory interface + ART_STYLES), ArtCanvas.tsx (render loop),
                      flowField.ts + harmonograph.ts (Canvas 2D), shaders.ts (WebGL2 styles), palettes.ts
    components/       TimerHome, FocusView, FocusOptions, Tasks, Stats, Gallery, Settings, Widget,
                      WidgetWindow, Welcome, Controls, Music, icons
    lib/              time.ts (clock math), actions.ts (segment end, art capture, notifications),
                      desktop.ts (Tauri bridge), widget.ts (widget host + browser PiP), updates.ts,
                      diagnostics.ts (local error log), gallery.ts (IndexedDB), sound.ts (WebAudio),
                      music.ts, stats.ts (+ achievements), links.ts, env.ts
  src-tauri/
    tauri.conf.json   productName, identifier, CSP, updater endpoint + public key
    tauri.release.conf.json   merged in by the release workflow (creates signed update artifacts)
    capabilities/     default.json (main window), widget.json (widget window)
    src/lib.rs        setup, tray, window events, commands, plugins (single-instance, updater, process, opener)
    src/db.rs + schema.sql    SQLite mirror the webview pushes snapshots into
    src/api.rs        read-only HTTP API on 127.0.0.1:47800 (/api, /api/status, /api/summary,
                      /api/sessions, /api/tasks, /api/activities, /api/export, /flowstate.db)
    src/audio.rs      WASAPI loopback capture + FFT → "audio" events (Windows only)
    src/media.rs      now-playing from Windows media controls → "nowplaying" events (Windows only)
    src/unsupported/  inert stand-ins for audio.rs / media.rs on macOS and Linux
```

## How it fits together

- **State lives in the webview.** `store.ts` is the source of truth. The desktop shell mirrors it to SQLite (`sync_snapshot`, `sync_timer`) so data survives a cleared webview and can be served by the API. On startup, if local storage is empty, the app restores from SQLite (`load_snapshot`).
- **The timer is timestamp-based.** `TimerState` stores `runStartedAt` + `accumulatedMs`; `elapsedMs()` derives the time. Never count ticks. `timerTick()` (hooks.ts) runs every 250 ms in the page and on a native 1 s `tick` event (WebView2 throttles hidden pages).
- **Ending a segment** goes through `lib/actions.ts` (`completeSegment` / `finishSegment`), which logs the session, captures the artwork to the gallery, plays the chime, and toasts. Use these instead of calling store `complete()` / `finish()` directly from UI.
- **Art engines** implement `EngineFactory(canvas, seed, palette) → { resize, frame(dt, t, {progress, energy, audio}), setQuality?, destroy }`. `progress` goes 0→1 over the focus block and the piece must be complete at 1. To add a style: write the engine, add it to `ART_STYLES` (art/engine.ts) and `ENGINES` (art/ArtCanvas.tsx), and add the id to `ArtStyleId` (types.ts).
- **Floating widget (desktop).** A second Tauri window labeled `widget` (transparent, always on top, `focusable: false`). The main window owns all state and logic; it pushes `widget-sync` events, and the widget sends back `widget-cmd` (`toggle` / `next` / `open` / `close`). The widget window loads the same bundle; `lib/env.ts` detects it, and its store is read-only so it never overwrites the save. In browsers the same `Widget` component renders into a Document Picture-in-Picture window.
- **Settings migrations.** New settings get defaults in `DEFAULT_SETTINGS`; `migrateSettings()` fills them in for old saves and handles renames. Add a test in `store.test.ts` when you rename or reinterpret a setting.

## Conventions

- TypeScript strict; no `any`. React function components with zustand selectors (`useStore((s) => s.x)`).
- Match the surrounding style: small focused modules, short comments that explain *why*, plain CSS in `src/styles.css` with CSS variables (`--accent`, `--glass`, `--line`, `--text-2`).
- Storage keys keep the historical `flowstate-` prefix (`flowstate-v1`, `flowstate-gallery`, …). **Do not rename them**: it would orphan existing users' data.
- The display name is not hard-coded: use `APP_NAME` from `brand.ts` (TS) or `app.package_info().name` (Rust).
- Desktop-only code checks `isDesktop` (lib/desktop.ts) and imports `@tauri-apps/*` lazily so the web build stays lean.
- Windows-only Rust goes in `audio.rs` / `media.rs` behind the `#[cfg_attr(not(windows), path = "unsupported/…")]` switch in lib.rs; keep the stand-ins' public API in sync.
- New Tauri commands need registering in `generate_handler!` and, for plugin APIs, a permission in `capabilities/*.json`.
- Keep the CSP in `tauri.conf.json` strict; the app loads nothing from the network.

## Releasing

1. Bump `version` in `app/src-tauri/tauri.conf.json` (and `app/package.json`), and update CHANGELOG.md.
2. Tag `vX.Y.Z` matching that version and push the tag. `release.yml` builds the installers and a **draft** release with `latest.json` + `.sig` files, signed with the `TAURI_SIGNING_PRIVATE_KEY` repo secret.
3. Review and publish the draft. Installed apps pick it up through the updater.

Windows builds are not code-signed yet (SmartScreen warns on first install).

## Gotchas

- `npm run dev` uses a strict port (5178); stop other dev servers or pass `-- --port <n>`.
- Changing art engine code needs a full page reload; hot reload keeps the old canvas running.
- Forks building their own releases must change the updater `endpoints` and `pubkey` in `tauri.conf.json`, or their installs will update from this repo's releases.
- `extensions.ts` loads `src/private/index.ts` if it exists. It doesn't in this repo; leave the hook in place (downstream builds use it).
