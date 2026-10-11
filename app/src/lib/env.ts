type TauriInternals = { metadata?: { currentWindow?: { label?: string } } };
const internals = (globalThis as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;

/** This page is the desktop shell's floating widget window, not the main app. */
export const isWidgetWindow = internals?.metadata?.currentWindow?.label === 'widget';
