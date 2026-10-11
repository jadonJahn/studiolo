import type { Session, Task } from '../types';
import { addDays, dayKey, HOUR, MIN, startOfDay } from './time';

export interface DayTotal {
  total: number;
  byActivity: Record<string, number>;
  sessions: number;
}

export function focusByDay(sessions: Session[]): Map<string, DayTotal> {
  const m = new Map<string, DayTotal>();
  for (const s of sessions) {
    if (s.kind !== 'focus') continue;
    const k = dayKey(s.startedAt);
    const d = m.get(k) ?? { total: 0, byActivity: {}, sessions: 0 };
    d.total += s.durationMs;
    d.sessions += 1;
    const a = s.activityId ?? 'none';
    d.byActivity[a] = (d.byActivity[a] ?? 0) + s.durationMs;
    m.set(k, d);
  }
  return m;
}

export function streaks(days: Map<string, DayTotal>, now = Date.now()): { current: number; longest: number } {
  let current = 0;
  let d = startOfDay(now);
  if (!days.has(dayKey(d))) d = addDays(d, -1);
  while (days.has(dayKey(d))) {
    current++;
    d = addDays(d, -1);
  }
  const keys = [...days.keys()].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of keys) {
    if (prev && dayKey(addDays(new Date(prev + 'T00:00:00'), 1)) === k) run++;
    else run = 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  return { current, longest: Math.max(longest, current) };
}

export interface Stats {
  focusSessions: number;
  totalFocusMs: number;
  todayMs: number;
  todaySessions: number;
  weekMs: number;
  streak: number;
  longestStreak: number;
  daysActive: number;
  maxDayMs: number;
  longestSessionMs: number;
  activitiesUsed: number;
  tasksDone: number;
  artworks: number;
  earlyBird: boolean;
  nightOwl: boolean;
  goalHitDays: number;
}

export function computeStats(sessions: Session[], tasks: Task[], goalMin: number, now = Date.now()): Stats {
  const focus = sessions.filter((s) => s.kind === 'focus');
  const days = focusByDay(sessions);
  const { current, longest } = streaks(days, now);
  const today = days.get(dayKey(now));
  let weekMs = 0;
  for (let i = 0; i < 7; i++) weekMs += days.get(dayKey(addDays(now, -i)))?.total ?? 0;
  let maxDayMs = 0;
  let goalHitDays = 0;
  for (const d of days.values()) {
    maxDayMs = Math.max(maxDayMs, d.total);
    if (d.total >= goalMin * MIN) goalHitDays++;
  }
  return {
    focusSessions: focus.length,
    totalFocusMs: focus.reduce((a, s) => a + s.durationMs, 0),
    todayMs: today?.total ?? 0,
    todaySessions: today?.sessions ?? 0,
    weekMs,
    streak: current,
    longestStreak: longest,
    daysActive: days.size,
    maxDayMs,
    longestSessionMs: focus.reduce((a, s) => Math.max(a, s.durationMs), 0),
    activitiesUsed: new Set(focus.map((s) => s.activityId)).size,
    tasksDone: tasks.filter((t) => t.done).length,
    artworks: focus.filter((s) => s.hasArt).length,
    earlyBird: focus.some((s) => new Date(s.startedAt).getHours() < 7),
    nightOwl: focus.some((s) => new Date(s.startedAt).getHours() >= 23),
    goalHitDays,
  };
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  test(s: Stats): boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', name: 'First Light', desc: 'Complete your first focus session', icon: '🌱', test: (s) => s.focusSessions >= 1 },
  { id: 's10', name: 'Finding Rhythm', desc: '10 focus sessions', icon: '🎵', test: (s) => s.focusSessions >= 10 },
  { id: 's50', name: 'Devoted', desc: '50 focus sessions', icon: '🔥', test: (s) => s.focusSessions >= 50 },
  { id: 's100', name: 'Centurion', desc: '100 focus sessions', icon: '🏛️', test: (s) => s.focusSessions >= 100 },
  { id: 'h10', name: 'Ten Hours', desc: '10 hours of focus', icon: '⏳', test: (s) => s.totalFocusMs >= 10 * HOUR },
  { id: 'h50', name: 'Fifty Hours', desc: '50 hours of focus', icon: '⌛', test: (s) => s.totalFocusMs >= 50 * HOUR },
  { id: 'h100', name: 'Hundred Hours', desc: '100 hours of focus', icon: '💎', test: (s) => s.totalFocusMs >= 100 * HOUR },
  { id: 'st3', name: 'Three in a Row', desc: '3-day streak', icon: '✨', test: (s) => s.longestStreak >= 3 },
  { id: 'st7', name: 'Week Unbroken', desc: '7-day streak', icon: '🌙', test: (s) => s.longestStreak >= 7 },
  { id: 'st30', name: 'Month of Flow', desc: '30-day streak', icon: '👑', test: (s) => s.longestStreak >= 30 },
  { id: 'goal', name: 'On Target', desc: 'Hit your daily goal', icon: '🎯', test: (s) => s.goalHitDays >= 1 },
  { id: 'goal10', name: 'Reliable', desc: 'Hit your daily goal on 10 days', icon: '📈', test: (s) => s.goalHitDays >= 10 },
  { id: 'deep', name: 'Deep Day', desc: '4 hours of focus in one day', icon: '🌊', test: (s) => s.maxDayMs >= 4 * HOUR },
  { id: 'marathon', name: 'Marathon', desc: 'A single 90-minute session', icon: '🏃', test: (s) => s.longestSessionMs >= 90 * MIN },
  { id: 'early', name: 'Early Bird', desc: 'Start a session before 7am', icon: '🌅', test: (s) => s.earlyBird },
  { id: 'night', name: 'Night Owl', desc: 'Start a session after 11pm', icon: '🦉', test: (s) => s.nightOwl },
  { id: 'poly', name: 'Polymath', desc: 'Focus on 4 different activities', icon: '🧭', test: (s) => s.activitiesUsed >= 4 },
  { id: 'tasks10', name: 'Closer', desc: 'Complete 10 tasks', icon: '✅', test: (s) => s.tasksDone >= 10 },
  { id: 'art10', name: 'Collector', desc: 'Earn 10 artworks', icon: '🖼️', test: (s) => s.artworks >= 10 },
  { id: 'art50', name: 'Curator', desc: 'Earn 50 artworks', icon: '🏺', test: (s) => s.artworks >= 50 },
];
