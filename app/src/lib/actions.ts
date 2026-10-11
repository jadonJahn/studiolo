import { artTitle } from '../art/random';
import { activePaletteId, useStore, useUI } from '../store';
import type { Session } from '../types';
import { captureArt, saveArtwork } from './gallery';
import { chime } from './sound';
import { fmtDuration } from './time';

function notify(title: string, body: string) {
  const s = useStore.getState().settings;
  if (!s.notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    new Notification(title, { body, icon: '/icon.svg', silent: true });
  } catch {
    /* some platforms only allow notifications from a service worker */
  }
}

/** Capture must happen before anything re-seeds the canvas, so call synchronously. */
function keepArtwork(session: Session) {
  const st = useStore.getState();
  if (!st.settings.saveArt || session.kind !== 'focus') return;
  const seed = st.timer.seed;
  const palette = activePaletteId(st);
  const style = session.artStyle ?? st.timer.artStyle;
  captureArt().then(async (blob) => {
    if (!blob) return;
    await saveArtwork({
      id: session.id,
      title: artTitle(seed),
      createdAt: session.endedAt,
      style,
      palette,
      seed,
      activityId: session.activityId,
      durationMs: session.durationMs,
      intent: session.intent,
      blob,
    });
    useStore.getState().markArt(session.id);
  });
}

function onSegmentEnded(session: Session | null, wasFocus: boolean, naturally: boolean) {
  const { settings } = useStore.getState();
  const ui = useUI.getState();
  if (session) keepArtwork(session);
  if (naturally && settings.chime) chime(settings.volume, wasFocus ? 'focus' : 'break');
  if (wasFocus && session) {
    const title = naturally ? 'Session complete' : 'Session logged';
    const body = `${fmtDuration(session.durationMs)} of focus${settings.saveArt ? ' · artwork saved to gallery' : ''}`;
    ui.toast({ icon: '🎨', title, body });
    notify(title, body);
  } else if (!wasFocus && naturally) {
    ui.toast({ icon: '⏰', title: 'Break over', body: 'Ready when you are.' });
    notify('Break over', 'Ready when you are.');
  }
}

export function completeSegment() {
  const wasFocus = useStore.getState().timer.phase === 'focus';
  const session = useStore.getState().complete();
  onSegmentEnded(session, wasFocus, true);
}

export function finishSegment() {
  const wasFocus = useStore.getState().timer.phase === 'focus';
  const session = useStore.getState().finish();
  if (!session && wasFocus) {
    useUI.getState().toast({ icon: '⏱️', title: 'Too short to log', body: `Sessions under ${useStore.getState().settings.minLogMin} min aren't recorded.` });
  }
  onSegmentEnded(session, wasFocus, false);
}

export function startTimer() {
  const st = useStore.getState();
  st.start();
  if (st.settings.autoFocusView && st.timer.status === 'idle') useUI.getState().setFocus(true);
}
