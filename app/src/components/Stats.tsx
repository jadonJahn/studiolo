import { useMemo, useState } from 'react';
import { deleteArtwork } from '../lib/gallery';
import { ACHIEVEMENTS, computeStats, focusByDay } from '../lib/stats';
import { addDays, dayKey, fmtDuration, fmtHours, MIN, startOfDay } from '../lib/time';
import { useStore } from '../store';
import type { Activity } from '../types';
import { IconTrash } from './icons';

type Range = 7 | 30 | 365 | 0;

export function Stats() {
  const sessions = useStore((s) => s.sessions);
  const tasks = useStore((s) => s.tasks);
  const activities = useStore((s) => s.activities);
  const settings = useStore((s) => s.settings);
  const unlocked = useStore((s) => s.unlocked);
  const [range, setRange] = useState<Range>(30);

  const stats = useMemo(() => computeStats(sessions, tasks, settings.dailyGoalMin), [sessions, tasks, settings.dailyGoalMin]);
  const days = useMemo(() => focusByDay(sessions), [sessions]);
  const actMap = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);

  const inRange = useMemo(() => {
    const from = range ? addDays(startOfDay(Date.now()), -(range - 1)).getTime() : 0;
    return sessions.filter((s) => s.kind === 'focus' && s.startedAt >= from);
  }, [sessions, range]);

  return (
    <section className="page">
      <div className="page-head">
        <h1>Stats</h1>
      </div>

      <div className="tiles">
        <Tile label="Today" value={fmtDuration(stats.todayMs)} sub={`${stats.todaySessions} session${stats.todaySessions === 1 ? "" : "s"}`} />
        <Tile label="This week" value={fmtDuration(stats.weekMs)} sub="last 7 days" />
        <Tile label="Streak" value={`${stats.streak}`} sub={`best ${stats.longestStreak} day${stats.longestStreak === 1 ? "" : "s"}`} />
        <Tile label="All time" value={`${fmtHours(stats.totalFocusMs)}h`} sub={`${stats.focusSessions} session${stats.focusSessions === 1 ? "" : "s"}`} />
      </div>

      <div className="card glass">
        <h3>Last 14 days</h3>
        <DayBars days={days} actMap={actMap} goalMin={settings.dailyGoalMin} />
      </div>

      <div className="card glass">
        <h3>
          Activity <span className="muted small">{stats.daysActive} active days</span>
        </h3>
        <Heatmap days={days} goalMin={settings.dailyGoalMin} mondayFirst={settings.weekStartsMonday} />
      </div>

      <div className="split">
        <div className="card glass">
          <div className="card-head">
            <h3>Breakdown</h3>
            <div className="segmented segmented-sm">
              {([7, 30, 365, 0] as Range[]).map((r) => (
                <button key={r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
                  {r === 0 ? 'All' : r === 365 ? '1y' : `${r}d`}
                </button>
              ))}
            </div>
          </div>
          <Breakdown sessions={inRange} actMap={actMap} />
        </div>
        <div className="card glass">
          <h3>Time of day</h3>
          <Hours sessions={inRange} />
        </div>
      </div>

      <div className="card glass">
        <h3>
          Achievements <span className="muted small">{unlocked.length}/{ACHIEVEMENTS.length}</span>
        </h3>
        <div className="achievements">
          {ACHIEVEMENTS.map((a) => (
            <div key={a.id} className={`achievement ${unlocked.includes(a.id) ? 'is-earned' : ''}`} title={a.desc}>
              <div className="ach-icon">{a.icon}</div>
              <div className="ach-name">{a.name}</div>
              <div className="ach-desc">{a.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <SessionLog actMap={actMap} />
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="tile glass">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-sub">{sub}</div>
    </div>
  );
}

function DayBars({ days, actMap, goalMin }: { days: ReturnType<typeof focusByDay>; actMap: Map<string, Activity>; goalMin: number }) {
  const list = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(Date.now()), i - 13));
  const max = Math.max(goalMin * MIN * 1.15, ...list.map((d) => days.get(dayKey(d))?.total ?? 0));
  const H = 160;
  const W = 700;
  const bw = W / 14;
  const goalY = H - (goalMin * MIN / max) * H;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label="Focus time per day, last 14 days">
      <line x1={0} x2={W} y1={goalY} y2={goalY} className="goal-line" />
      {list.map((d, i) => {
        const k = dayKey(d);
        const day = days.get(k);
        let y = H;
        return (
          <g key={k}>
            <title>{`${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${fmtDuration(day?.total ?? 0)}`}</title>
            <rect x={i * bw + 6} y={0} width={bw - 12} height={H} fill="transparent" />
            {day &&
              Object.entries(day.byActivity).map(([aid, ms]) => {
                const h = (ms / max) * H;
                y -= h;
                return <rect key={aid} x={i * bw + 6} y={y} width={bw - 12} height={Math.max(1, h - 1)} rx={3} fill={actMap.get(aid)?.color ?? '#888'} />;
              })}
            <text x={i * bw + bw / 2} y={H + 17} textAnchor="middle" className={`axis ${i === 13 ? 'is-today' : ''}`}>
              {d.toLocaleDateString(undefined, { weekday: 'narrow' })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Heatmap({ days, goalMin, mondayFirst }: { days: ReturnType<typeof focusByDay>; goalMin: number; mondayFirst: boolean }) {
  const today = startOfDay(Date.now());
  const weeks = 53;
  const dow = (today.getDay() + (mondayFirst ? 6 : 0)) % 7;
  const start = addDays(today, -(weeks - 1) * 7 - dow);
  const goal = goalMin * MIN;
  const level = (ms: number) => (ms <= 0 ? 0 : ms < goal * 0.33 ? 1 : ms < goal * 0.66 ? 2 : ms < goal ? 3 : 4);
  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      if (date > today) continue;
      const ms = days.get(dayKey(date))?.total ?? 0;
      cells.push(
        <rect key={`${w}-${d}`} x={w * 13} y={d * 13} width={11} height={11} rx={2.5} className={`hm l${level(ms)}`}>
          <title>{`${date.toLocaleDateString()}: ${fmtDuration(ms)}`}</title>
        </rect>,
      );
    }
  }
  return (
    <div className="heatmap-wrap">
      <svg className="heatmap" viewBox={`0 0 ${weeks * 13} ${7 * 13}`} role="img" aria-label="Focus heatmap, past year">
        {cells}
      </svg>
      <div className="hm-legend muted small">
        Less {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`hm-key l${l}`} />)} Goal met
      </div>
    </div>
  );
}

function Breakdown({ sessions, actMap }: { sessions: ReturnType<typeof useStore.getState>['sessions']; actMap: Map<string, Activity> }) {
  const totals = new Map<string, number>();
  for (const s of sessions) totals.set(s.activityId ?? 'none', (totals.get(s.activityId ?? 'none') ?? 0) + s.durationMs);
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const sum = rows.reduce((a, [, v]) => a + v, 0);
  if (!rows.length) return <p className="empty">No focus time in this range yet.</p>;
  return (
    <ul className="breakdown">
      {rows.map(([id, ms]) => {
        const a = actMap.get(id);
        return (
          <li key={id}>
            <span className="bd-name">
              {a?.emoji} {a?.name ?? 'Other'}
            </span>
            <span className="bd-bar">
              <i style={{ width: `${(ms / sum) * 100}%`, background: a?.color ?? '#888' }} />
            </span>
            <span className="bd-val">{fmtDuration(ms)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Hours({ sessions }: { sessions: ReturnType<typeof useStore.getState>['sessions'] }) {
  const bins = new Array(24).fill(0);
  for (const s of sessions) bins[new Date(s.startedAt).getHours()] += s.durationMs;
  const max = Math.max(1, ...bins);
  const W = 480;
  const H = 120;
  const bw = W / 24;
  if (!sessions.length) return <p className="empty">Your most productive hours will show up here.</p>;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H + 20}`} role="img" aria-label="Focus time by hour of day">
      {bins.map((v, h) => (
        <g key={h}>
          <title>{`${h}:00 – ${fmtDuration(v)}`}</title>
          <rect x={h * bw + 2} y={H - (v / max) * H} width={bw - 4} height={Math.max(1, (v / max) * H)} rx={2} className="hour-bar" />
          {h % 6 === 0 && (
            <text x={h * bw + bw / 2} y={H + 15} textAnchor="middle" className="axis">
              {h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function SessionLog({ actMap }: { actMap: Map<string, Activity> }) {
  const sessions = useStore((s) => s.sessions);
  const tasks = useStore((s) => s.tasks);
  const removeSession = useStore((s) => s.removeSession);
  const [limit, setLimit] = useState(15);
  const recent = sessions.slice().reverse().slice(0, limit);
  return (
    <div className="card glass">
      <h3>Session log</h3>
      {!recent.length && <p className="empty">Completed sessions will be listed here.</p>}
      <ul className="log">
        {recent.map((s) => {
          const a = s.activityId ? actMap.get(s.activityId) : undefined;
          const task = s.taskId ? tasks.find((k) => k.id === s.taskId) : undefined;
          const d = new Date(s.startedAt);
          return (
            <li key={s.id}>
              <span className="log-dot" style={{ background: s.kind === 'focus' ? a?.color : 'transparent' }} />
              <span className="log-main">
                <strong>{s.kind === 'focus' ? `${a?.emoji ?? ''} ${a?.name ?? 'Focus'}` : '☕ Break'}</strong>
                {(s.intent || task) && <span className="muted"> — {s.intent || task?.title}</span>}
                {!s.completed && s.kind === 'focus' && s.mode !== 'stopwatch' && <span className="tag">ended early</span>}
              </span>
              <span className="log-dur">{fmtDuration(s.durationMs)}</span>
              <span className="log-date muted">
                {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
              <button
                className="btn-icon btn-sm danger"
                aria-label="Delete session"
                onClick={() => {
                  if (!confirm('Delete this session (and its artwork)?')) return;
                  removeSession(s.id);
                  void deleteArtwork(s.id);
                }}
              >
                <IconTrash />
              </button>
            </li>
          );
        })}
      </ul>
      {sessions.length > limit && (
        <button className="btn-ghost" onClick={() => setLimit(limit + 30)}>
          Show more
        </button>
      )}
    </div>
  );
}
