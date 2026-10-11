import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from '../brand';
import { Widget } from '../components/Widget';
import { useStore } from '../store';
import type { WidgetStyle } from '../types';
import { finishSegment } from './actions';
import { isDesktop } from './desktop';

export type WidgetCommand = 'toggle' | 'next' | 'open' | 'close';
export type WidgetLayout = Exclude<WidgetStyle, 'off'>;

export const WIDGET_SIZE: Record<WidgetLayout, { width: number; height: number }> = {
  card: { width: 248, height: 180 },
  pill: { width: 400, height: 52 },
};

/** What the main window sends the desktop widget window. */
export interface WidgetSync {
  shown: boolean;
  timer: ReturnType<typeof useStore.getState>['timer'];
  settings: ReturnType<typeof useStore.getState>['settings'];
  activities: ReturnType<typeof useStore.getState>['activities'];
  tasks: ReturnType<typeof useStore.getState>['tasks'];
}

/** Commands always run in the main window, which owns the timer and the session log. */
function runCommand(cmd: WidgetCommand, host: { open(): void; close(): void }) {
  const st = useStore.getState();
  const t = st.timer;
  switch (cmd) {
    case 'toggle':
      st.toggle();
      break;
    case 'next':
      if (t.status === 'idle' && t.mode === 'pomodoro') st.skip();
      else if (t.status !== 'idle') finishSegment();
      break;
    case 'open':
      host.open();
      break;
    case 'close':
      host.close();
      break;
  }
}

/* ── Desktop: a frameless always-on-top window ─────────────────────── */

const POS_KEY = 'flowstate-widget-pos';
type SavedPos = Partial<Record<WidgetLayout, { x: number; y: number }>>;

function loadPos(): SavedPos {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? '{}') as SavedPos;
  } catch {
    return {};
  }
}

/** Called by the widget window as it is dragged; physical pixels. */
export function saveWidgetPos(layout: WidgetLayout, x: number, y: number) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ ...loadPos(), [layout]: { x, y } }));
  } catch {
    /* position just won't be remembered */
  }
}

/**
 * Shows the widget while a session is active and the main window isn't in front,
 * and relays state to it / commands from it. Runs in the main window only.
 */
export async function initWidgetHost(): Promise<void> {
  if (!isDesktop) return;
  const { getCurrentWindow, availableMonitors, primaryMonitor, LogicalSize, PhysicalPosition } = await import('@tauri-apps/api/window');
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const { emitTo, listen } = await import('@tauri-apps/api/event');

  const main = getCurrentWindow();
  let mainFocused = await main.isFocused();
  /** Hidden by the user; stays hidden until they come back to the main window. */
  let dismissed = false;
  let shown = false;
  let layout: WidgetLayout | null = null;
  let widget: InstanceType<typeof WebviewWindow> | null = null;

  const push = () => {
    if (!widget) return;
    const { timer, settings, activities, tasks } = useStore.getState();
    const payload: WidgetSync = { shown, timer, settings, activities, tasks };
    emitTo('widget', 'widget-sync', payload).catch(() => {});
  };

  const create = async () => {
    const w = new WebviewWindow('widget', {
      url: '/',
      title: APP_NAME,
      ...WIDGET_SIZE.card,
      visible: false,
      // Never steal focus from whatever the user is working in.
      focus: false,
      focusable: false,
      decorations: false,
      transparent: true,
      shadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
    });
    await new Promise<void>((ok, fail) => {
      void w.once('tauri://created', () => ok());
      void w.once('tauri://error', (e) => fail(e.payload));
    });
    return w;
  };

  /** Saved spot if it is still on a connected monitor, else a sensible corner. */
  const placement = async (l: WidgetLayout) => {
    const saved = loadPos()[l];
    const monitors = await availableMonitors();
    if (saved) {
      const onScreen = monitors.some(({ workArea: a }) => saved.x >= a.position.x && saved.y >= a.position.y && saved.x < a.position.x + a.size.width - 40 && saved.y < a.position.y + a.size.height - 20);
      if (onScreen) return new PhysicalPosition(saved.x, saved.y);
    }
    const m = (await primaryMonitor()) ?? monitors[0];
    if (!m) return new PhysicalPosition(40, 40);
    const { position: p, size: sz } = m.workArea;
    const k = m.scaleFactor;
    const { width, height } = WIDGET_SIZE[l];
    if (l === 'pill') return new PhysicalPosition(Math.round(p.x + (sz.width - width * k) / 2), Math.round(p.y + 12 * k));
    return new PhysicalPosition(Math.round(p.x + sz.width - (width + 24) * k), Math.round(p.y + sz.height - (height + 24) * k));
  };

  const wanted = () => {
    const { settings, timer } = useStore.getState();
    if (settings.widget === 'off' || mainFocused || dismissed) return false;
    // Once up, it stays through the idle gap between segments so the next one is a click away.
    return timer.status !== 'idle' || shown;
  };

  const reconcile = async () => {
    const style = useStore.getState().settings.widget;
    if (style === 'off') {
      if (widget) {
        const w = widget;
        widget = null;
        shown = false;
        layout = null;
        await w.destroy();
      }
      return;
    }
    const on = wanted();
    if (on === shown && (!on || layout === style)) return;
    if (!on) {
      shown = false;
      push();
      await widget?.hide();
      return;
    }
    widget ??= await create();
    if (layout !== style) {
      layout = style;
      await widget.setSize(new LogicalSize(WIDGET_SIZE[style].width, WIDGET_SIZE[style].height));
      await widget.setPosition(await placement(style));
    }
    shown = true;
    push();
    await widget.show();
  };

  // Serialize window operations so rapid focus flips can't interleave.
  let queue = Promise.resolve();
  const apply = () => {
    queue = queue.then(reconcile).catch((e) => console.warn('Widget update failed', e));
  };

  const host = {
    open: () => {
      void main.unminimize().then(() => main.show()).then(() => main.setFocus());
    },
    close: () => {
      dismissed = true;
      apply();
    },
  };

  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  await main.onFocusChanged(({ payload: focused }) => {
    mainFocused = focused;
    clearTimeout(blurTimer);
    if (focused) {
      dismissed = false;
      apply();
    } else {
      // Brief focus hops (menus, dialogs, alt-tab passing through) shouldn't flash the widget.
      blurTimer = setTimeout(apply, 350);
    }
  });

  await listen('widget-ready', push);
  await listen<WidgetCommand>('widget-cmd', ({ payload }) => runCommand(payload, host));

  useStore.subscribe((st, prev) => {
    if (st.timer !== prev.timer || st.settings !== prev.settings || st.tasks !== prev.tasks || st.activities !== prev.activities) push();
    if (st.timer.status !== prev.timer.status || st.settings.widget !== prev.settings.widget) apply();
  });
  apply();
}

/* ── Browser: Document Picture-in-Picture ──────────────────────────── */

interface DocumentPiP {
  requestWindow(opts: { width: number; height: number }): Promise<Window>;
  readonly window: Window | null;
}
const docPip = (globalThis as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;

/** Chromium browsers can float a mini window over other apps (needs a click to open). */
export const canPopOut = !isDesktop && !!docPip;

export async function popOutWidget(): Promise<void> {
  if (!docPip) return;
  if (docPip.window) {
    docPip.window.focus();
    return;
  }
  const layout: WidgetLayout = useStore.getState().settings.widget === 'pill' ? 'pill' : 'card';
  const pip = await docPip.requestWindow(WIDGET_SIZE[layout]);
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => pip.document.head.append(n.cloneNode(true)));
  pip.document.documentElement.classList.add('is-widget', 'is-pip');
  pip.document.title = APP_NAME;
  const root = createRoot(pip.document.body.appendChild(pip.document.createElement('div')));
  root.render(
    createElement(Widget, {
      layout,
      windowControls: false,
      onCommand: (cmd) => runCommand(cmd, { open: () => pip.close(), close: () => pip.close() }),
    }),
  );
  pip.addEventListener('pagehide', () => root.unmount());
}
