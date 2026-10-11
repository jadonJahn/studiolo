# Contributing

Thanks for helping out. Bug reports, ideas and pull requests are all welcome.

## Getting set up

You need Node 22+ and, for the desktop app, Rust (stable) plus the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
cd app
npm install
npm run dev          # web app at http://localhost:5178
npm run tauri dev    # desktop app
```

## Before opening a pull request

```bash
cd app
npm run typecheck
npm test
cd src-tauri && cargo test
```

CI runs the same checks on Windows, plus a Linux compile check.

## Guidelines

- Keep changes focused: one feature or fix per pull request.
- Match the style of the surrounding code.
- New art styles: see "Layout" in [app/README.md](app/README.md).
- Nothing should leave the user's device. No analytics, trackers or network calls without an explicit opt-in.
