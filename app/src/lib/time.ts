import type { Settings, TimerState } from '../types';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

/** Clock face. Countdowns round up so "00:00" only shows at the end. */
export function fmtClock(ms: number, countUp = false): string {
  const total = Math.max(0, countUp ? Math.floor(ms / 1000) : Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtDuration(ms: number): string {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function fmtHours(ms: number): string {
  const h = ms / HOUR;
  return h >= 10 ? `${Math.round(h)}` : h.toFixed(1);
}

/** Local-time day key (the POC used UTC ISO strings, which broke streaks at night). */
export function dayKey(d: Date | number): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function startOfDay(d: Date | number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date | number, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function targetMs(t: TimerState, s: Settings): number {
  if (t.mode === 'stopwatch') return 0;
  if (t.mode === 'countdown') return s.countdownMin * MIN;
  const min = t.phase === 'focus' ? s.focusMin : t.phase === 'short' ? s.shortMin : s.longMin;
  return min * MIN;
}

export function elapsedMs(t: TimerState, now: number): number {
  return t.accumulatedMs + (t.status === 'running' && t.runStartedAt ? now - t.runStartedAt : 0);
}

export function phaseLabel(t: TimerState): string {
  if (t.mode === 'stopwatch') return 'Stopwatch';
  if (t.mode === 'countdown') return 'Timer';
  return t.phase === 'focus' ? 'Focus' : t.phase === 'short' ? 'Short break' : 'Long break';
}
