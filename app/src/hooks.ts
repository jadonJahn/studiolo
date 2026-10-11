import { useEffect, useRef, useState } from 'react';
import { APP_NAME } from './brand';
import { completeSegment } from './lib/actions';
import { cancelPreview, setAmbient } from './lib/sound';
import { computeStats, ACHIEVEMENTS } from './lib/stats';
import { elapsedMs, fmtClock, phaseLabel, targetMs } from './lib/time';
import { useStore, useUI } from './store';

export function useNow(interval = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return now;
}

/**
 * One timer check. Idempotent, so it is safe to call from both the page interval
 * and the desktop shell's native heartbeat.
 */
export function timerTick() {
  const { timer: t, settings: s } = useStore.getState();
  if (t.status === 'running') {
    const target = targetMs(t, s);
    if (target > 0 && elapsedMs(t, Date.now()) >= target) completeSegment();
  }
  const st = useStore.getState().timer;
  const target = targetMs(st, s);
  const el = elapsedMs(st, Date.now());
  const clock = st.mode === 'stopwatch' ? fmtClock(el, true) : fmtClock(target - el);
  const title = st.status === 'idle' ? APP_NAME : `${clock} · ${phaseLabel(st)}${st.status === 'paused' ? ' (paused)' : ''}`;
  if (document.title !== title) document.title = title;
}

/** Timestamp-based driver: accurate in background tabs and across reloads. */
export function useTimerDriver() {
  useEffect(() => {
    const id = setInterval(timerTick, 250);
    return () => clearInterval(id);
  }, []);

  // Holding a Web Lock exempts the page from Chromium's tab freezing and
  // intensive timer throttling while a segment is running.
  const running = useStore((s) => s.timer.status === 'running');
  useEffect(() => {
    if (!running || !navigator.locks) return;
    let release: () => void = () => {};
    void navigator.locks.request('flowstate-running', () => new Promise<void>((r) => (release = r)));
    return () => release();
  }, [running]);
}

/** Ambient sound plays only while a focus segment is running. */
export function useAmbient() {
  const playing = useStore((s) => s.timer.status === 'running' && s.timer.phase === 'focus');
  const kind = useStore((s) => s.settings.ambient);
  const vol = useStore((s) => s.settings.ambientVolume);
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (playing) {
      cancelPreview();
      setAmbient(kind, vol);
    } else if (wasPlaying.current) {
      setAmbient('off', vol);
    }
    // When idle, leave any settings preview alone.
    wasPlaying.current = playing;
  }, [playing, kind, vol]);
}

export function useAchievements() {
  const sessions = useStore((s) => s.sessions);
  const tasks = useStore((s) => s.tasks);
  const goal = useStore((s) => s.settings.dailyGoalMin);
  useEffect(() => {
    const { unlocked, unlock } = useStore.getState();
    const st = computeStats(sessions, tasks, goal);
    const fresh = ACHIEVEMENTS.filter((a) => !unlocked.includes(a.id) && a.test(st));
    if (!fresh.length) return;
    unlock(fresh.map((a) => a.id));
    fresh.forEach((a) => useUI.getState().toast({ icon: a.icon, title: `Achievement: ${a.name}`, body: a.desc }));
  }, [sessions, tasks, goal]);
}

/** Keep the screen awake while focusing in focus view. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () =>
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => {});
    void acquire();
    const onVis = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [active]);
}

/** Returns true while the pointer/keyboard has been idle for `ms`. */
export function useIdle(ms: number, enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let id: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(id);
      id = setTimeout(() => setIdle(true), ms);
    };
    wake();
    const evs = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const;
    evs.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      clearTimeout(id);
      evs.forEach((e) => window.removeEventListener(e, wake));
    };
  }, [ms, enabled]);
  return idle;
}
