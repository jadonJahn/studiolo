import { APP_NAME, APP_VERSION } from '../brand';
import { useStore } from '../store';
import { isDesktop } from './desktop';

/**
 * Local-only error log. Nothing is sent anywhere; the user can copy it into a
 * bug report from Settings.
 */
const KEY = 'app-error-log';
const MAX = 30;

interface Entry {
  at: string;
  message: string;
}

function read(): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Entry[];
  } catch {
    return [];
  }
}

function record(message: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...read(), { at: new Date().toISOString(), message: message.slice(0, 2000) }].slice(-MAX)));
  } catch {
    /* storage full or blocked; the log is best-effort */
  }
}

export function initErrorLog() {
  window.addEventListener('error', (e) => record(e.error?.stack || e.message || String(e)));
  window.addEventListener('unhandledrejection', (e) => record(`Unhandled rejection: ${(e.reason as Error)?.stack ?? String(e.reason)}`));
}

export function clearErrorLog() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Plain-text report for pasting into an issue. No sessions, tasks, or titles. */
export function diagnostics(): string {
  const { settings, sessions, tasks } = useStore.getState();
  const errors = read();
  return [
    `${APP_NAME} ${APP_VERSION} (${isDesktop ? 'desktop' : 'web'})`,
    `User agent: ${navigator.userAgent}`,
    `Screen: ${screen.width}x${screen.height} @${devicePixelRatio}x, WebGL2: ${!!document.createElement('canvas').getContext('webgl2')}`,
    `Data: ${sessions.length} sessions, ${tasks.length} tasks`,
    `Settings: ${JSON.stringify(settings)}`,
    '',
    errors.length ? `Recent errors (${errors.length}):` : 'No errors recorded.',
    ...errors.map((e) => `[${e.at}] ${e.message}`),
  ].join('\n');
}
