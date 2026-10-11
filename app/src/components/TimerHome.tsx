import { useMemo } from 'react';
import { ART_STYLES } from '../art/engine';
import { useNow } from '../hooks';
import { focusByDay } from '../lib/stats';
import { dayKey, elapsedMs, fmtClock, fmtDuration, MIN, phaseLabel, targetMs } from '../lib/time';
import { useStore, useUI } from '../store';
import type { Mode, Phase } from '../types';
import { Controls } from './Controls';
import { IconExpand } from './icons';
import { NowPlayingChip } from './Music';

const MODES: { id: Mode; label: string }[] = [
  { id: 'pomodoro', label: 'Pomodoro' },
  { id: 'countdown', label: 'Timer' },
  { id: 'stopwatch', label: 'Stopwatch' },
];
const PHASES: { id: Phase; label: string }[] = [
  { id: 'focus', label: 'Focus' },
  { id: 'short', label: 'Short break' },
  { id: 'long', label: 'Long break' },
];

export function ActivityPicker({ disabled }: { disabled?: boolean }) {
  const activities = useStore((s) => s.activities);
  const current = useStore((s) => s.timer.activityId);
  const setActivity = useStore((s) => s.setActivity);
  return (
    <div className="chips" role="radiogroup" aria-label="Activity">
      {activities
        .filter((a) => !a.archived)
        .map((a) => (
          <button
            key={a.id}
            role="radio"
            aria-checked={a.id === current}
            className={`chip ${a.id === current ? 'is-active' : ''}`}
            style={{ '--chip': a.color } as React.CSSProperties}
            onClick={() => setActivity(a.id)}
            disabled={disabled && a.id !== current}
          >
            <span>{a.emoji}</span> {a.name}
          </button>
        ))}
    </div>
  );
}

export function TimerHome() {
  const now = useNow(200);
  const t = useStore((s) => s.timer);
  const settings = useStore((s) => s.settings);
  const tasks = useStore((s) => s.tasks);
  const sessions = useStore((s) => s.sessions);
  const { setMode, setPhase, setIntent, setTask, updateSettings, setArtStyle } = useStore.getState();
  const setFocus = useUI((s) => s.setFocus);

  const target = targetMs(t, settings);
  const el = elapsedMs(t, now);
  const isStopwatch = t.mode === 'stopwatch';
  const remaining = target - el;
  const progress = isStopwatch ? (el % (60 * MIN)) / (60 * MIN) : target ? Math.min(1, el / target) : 0;
  const idle = t.status === 'idle';

  const todayMs = useMemo(() => focusByDay(sessions).get(dayKey(Date.now()))?.total ?? 0, [sessions]);
  const goalMs = settings.dailyGoalMin * MIN;
  const openTasks = tasks.filter((k) => !k.done);

  const R = 132;
  const C = 2 * Math.PI * R;

  return (
    <section className="timer-home">
      <ActivityPicker disabled={!idle} />

      <div className="segmented" role="tablist" aria-label="Mode">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={t.mode === m.id} className={t.mode === m.id ? 'is-active' : ''} onClick={() => setMode(m.id)} disabled={!idle}>
            {m.label}
          </button>
        ))}
      </div>

      {t.mode === 'pomodoro' && (
        <div className="segmented segmented-sm" role="tablist" aria-label="Phase">
          {PHASES.map((p) => (
            <button key={p.id} role="tab" aria-selected={t.phase === p.id} className={t.phase === p.id ? 'is-active' : ''} onClick={() => setPhase(p.id)} disabled={!idle}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="ring">
        <svg viewBox="0 0 300 300">
          <circle className="ring-bg" cx="150" cy="150" r={R} />
          <circle
            className="ring-fg"
            cx="150"
            cy="150"
            r={R}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            transform="rotate(-90 150 150)"
          />
        </svg>
        <div className="ring-inner">
          <div className="ring-label">{phaseLabel(t)}</div>
          <div className="ring-time">{isStopwatch ? fmtClock(el, true) : fmtClock(remaining)}</div>
          {t.mode === 'countdown' && idle ? (
            <div className="stepper">
              <button onClick={() => updateSettings({ countdownMin: Math.max(1, settings.countdownMin - 5) })} aria-label="5 minutes less">−5</button>
              <button onClick={() => updateSettings({ countdownMin: Math.max(1, settings.countdownMin - 1) })} aria-label="1 minute less">−1</button>
              <button onClick={() => updateSettings({ countdownMin: Math.min(600, settings.countdownMin + 1) })} aria-label="1 minute more">+1</button>
              <button onClick={() => updateSettings({ countdownMin: Math.min(600, settings.countdownMin + 5) })} aria-label="5 minutes more">+5</button>
            </div>
          ) : (
            <div className="ring-sub">{t.status === 'paused' ? 'Paused' : t.mode === 'pomodoro' ? <CycleDots /> : ' '}</div>
          )}
        </div>
      </div>

      <Controls size="lg" />

      <div className="intent-row">
        <input
          className="input intent"
          placeholder="What are you focusing on?"
          value={t.intent}
          onChange={(e) => setIntent(e.target.value)}
          maxLength={120}
        />
        <select className="input" value={t.taskId ?? ''} onChange={(e) => setTask(e.target.value || null)} aria-label="Link a task">
          <option value="">No task</option>
          {openTasks.map((k) => (
            <option key={k.id} value={k.id}>
              {k.title}
            </option>
          ))}
        </select>
      </div>

      <div className="home-footer">
        <div className="goal">
          <div className="goal-text">
            <span>Today</span>
            <strong>{fmtDuration(todayMs)}</strong>
            <span className="muted">/ {fmtDuration(goalMs)} goal</span>
          </div>
          <div className="goal-bar">
            <div style={{ width: `${Math.min(100, (todayMs / goalMs) * 100)}%` }} />
          </div>
        </div>
        <label className="art-select">
          <span className="muted">Art</span>
          <select className="input input-sm" value={t.artStyle} onChange={(e) => setArtStyle(e.target.value as never)}>
            {ART_STYLES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <NowPlayingChip compact />
        <button className="btn-ghost" onClick={() => setFocus(true)} title="Focus view (F)">
          <IconExpand /> Focus view
        </button>
      </div>
    </section>
  );
}

export function CycleDots() {
  const cycle = useStore((s) => s.timer.cycle);
  const every = useStore((s) => s.settings.longEvery);
  const phase = useStore((s) => s.timer.phase);
  const filled = cycle % every === 0 && cycle > 0 && phase === 'long' ? every : cycle % every;
  return (
    <span className="dots" aria-label={`${filled} of ${every} focus blocks before long break`}>
      {Array.from({ length: every }, (_, i) => (
        <i key={i} className={i < filled ? 'on' : ''} />
      ))}
    </span>
  );
}
