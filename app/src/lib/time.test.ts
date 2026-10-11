import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../store';
import type { TimerState } from '../types';
import { elapsedMs, fmtClock, fmtDuration, MIN, targetMs } from './time';

const timer = (p: Partial<TimerState> = {}): TimerState => ({
  mode: 'pomodoro',
  phase: 'focus',
  status: 'idle',
  runStartedAt: null,
  accumulatedMs: 0,
  segmentStartedAt: null,
  cycle: 0,
  activityId: 'study',
  taskId: null,
  intent: '',
  seed: 1,
  seedUsed: false,
  artStyle: 'flow',
  ...p,
});

describe('fmtClock', () => {
  it('rounds countdowns up so 00:00 only shows at the end', () => {
    expect(fmtClock(59_001)).toBe('01:00');
    expect(fmtClock(1)).toBe('00:01');
    expect(fmtClock(0)).toBe('00:00');
  });
  it('rounds count-up time down', () => {
    expect(fmtClock(59_999, true)).toBe('00:59');
  });
  it('shows hours past 60 minutes and never goes negative', () => {
    expect(fmtClock(3_600_000 + 65_000)).toBe('1:01:05');
    expect(fmtClock(-5_000)).toBe('00:00');
  });
});

describe('fmtDuration', () => {
  it('uses minutes, then hours', () => {
    expect(fmtDuration(25 * MIN)).toBe('25m');
    expect(fmtDuration(60 * MIN)).toBe('1h');
    expect(fmtDuration(95 * MIN)).toBe('1h 35m');
  });
});

describe('targetMs', () => {
  const s = DEFAULT_SETTINGS;
  it('follows the phase in pomodoro mode', () => {
    expect(targetMs(timer({ phase: 'focus' }), s)).toBe(s.focusMin * MIN);
    expect(targetMs(timer({ phase: 'short' }), s)).toBe(s.shortMin * MIN);
    expect(targetMs(timer({ phase: 'long' }), s)).toBe(s.longMin * MIN);
  });
  it('has no target for the stopwatch', () => {
    expect(targetMs(timer({ mode: 'stopwatch' }), s)).toBe(0);
  });
});

describe('elapsedMs', () => {
  it('adds the current run to time banked from earlier runs', () => {
    expect(elapsedMs(timer({ status: 'running', runStartedAt: 1_000, accumulatedMs: 5_000 }), 4_000)).toBe(8_000);
  });
  it('ignores the clock while paused', () => {
    expect(elapsedMs(timer({ status: 'paused', runStartedAt: null, accumulatedMs: 5_000 }), 99_000)).toBe(5_000);
  });
});
