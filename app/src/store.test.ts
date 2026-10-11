import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, migrateSettings, useStore } from './store';
import { MIN } from './lib/time';

describe('migrateSettings', () => {
  it('fills in settings added since the save was made', () => {
    const s = migrateSettings({ focusMin: 50 });
    expect(s.focusMin).toBe(50);
    expect(s.widget).toBe(DEFAULT_SETTINGS.widget);
    expect(s.focusClock).toBe('always');
  });
  it('turns the old zen clock into "show when active"', () => {
    const s = migrateSettings({ zenClock: true } as never);
    expect(s.focusClock).toBe('auto');
    expect('zenClock' in s).toBe(false);
  });
  it('keeps an explicit clock choice over the old flag', () => {
    expect(migrateSettings({ zenClock: true, focusClock: 'never' } as never).focusClock).toBe('never');
  });
});

describe('timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useStore.getState().resetAll();
  });
  afterEach(() => vi.useRealTimers());

  const st = () => useStore.getState();

  it('logs a completed focus block and moves to a short break', () => {
    st().start();
    vi.advanceTimersByTime(25 * MIN);
    const session = st().complete();
    expect(session?.kind).toBe('focus');
    expect(session?.completed).toBe(true);
    expect(session?.durationMs).toBe(25 * MIN);
    expect(st().timer.phase).toBe('short');
    expect(st().timer.cycle).toBe(1);
    expect(st().sessions).toHaveLength(1);
  });

  it('gives a long break after the configured number of blocks', () => {
    st().updateSettings({ longEvery: 2 });
    for (let i = 0; i < 2; i++) {
      if (st().timer.phase !== 'focus') st().skip();
      st().start();
      vi.advanceTimersByTime(25 * MIN);
      st().complete();
    }
    expect(st().timer.phase).toBe('long');
  });

  it('does not count paused time', () => {
    st().start();
    vi.advanceTimersByTime(10 * MIN);
    st().pause();
    vi.advanceTimersByTime(60 * MIN);
    st().start();
    vi.advanceTimersByTime(5 * MIN);
    expect(st().finish()?.durationMs).toBe(15 * MIN);
  });

  it('drops focus sessions shorter than the minimum', () => {
    st().start();
    vi.advanceTimersByTime(30_000);
    expect(st().finish()).toBeNull();
    expect(st().sessions).toHaveLength(0);
  });

  it('credits time to the selected task', () => {
    st().addTask('Write tests');
    const id = st().tasks[0].id;
    st().setTask(id);
    st().start();
    vi.advanceTimersByTime(25 * MIN);
    st().complete();
    expect(st().tasks[0].spentMs).toBe(25 * MIN);
  });
});
