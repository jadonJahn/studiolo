import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ART_STYLES } from './art/engine';
import { ext } from './extensions';
import { isWidgetWindow } from './lib/env';
import type { Update } from './lib/updates';
import { elapsedMs, MIN, targetMs } from './lib/time';
import type { Activity, ArtStyleId, Mode, Phase, Session, Settings, Task, TimerState } from './types';

/** Fill in settings added since a save was made, carrying over renamed ones. */
export function migrateSettings(saved: Partial<Settings> & { zenClock?: boolean } = {}): Settings {
  const { zenClock, ...rest } = saved;
  return { ...DEFAULT_SETTINGS, ...(zenClock && !saved.focusClock ? { focusClock: 'auto' as const } : {}), ...rest };
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

const prefersReducedMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const DEFAULT_SETTINGS: Settings = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  countdownMin: 45,
  autoStartBreaks: false,
  autoStartFocus: false,
  autoFocusView: true,
  dailyGoalMin: 120,
  minLogMin: 2,
  weekStartsMonday: true,
  artStyle: 'random',
  palette: 'activity',
  artMotion: prefersReducedMotion ? 0.35 : 1,
  saveArt: true,
  focusClock: 'always',
  focusPinDashboard: false,
  focusPinTools: false,
  focusPinControls: false,
  focusProgress: true,
  chime: true,
  volume: 0.6,
  ambient: 'off',
  ambientVolume: 0.35,
  notifications: false,
  musicReactive: false,
  musicSource: 'all',
  musicIntensity: 1,
  albumPalette: false,
  showNowPlaying: true,
  widget: 'card',
  widgetClock: true,
  localApi: ext.localApiDefault ?? false,
  welcomed: false,
  closeToTray: false,
};

export const DEFAULT_ACTIVITIES: Activity[] = [
  { id: 'study', name: 'Study', emoji: '📚', color: '#8b83ff', palette: 'midnight' },
  { id: 'work', name: 'Deep Work', emoji: '💼', color: '#3ec5ff', palette: 'glacier' },
  { id: 'create', name: 'Create', emoji: '🎨', color: '#ff7eb6', palette: 'bloom' },
  { id: 'read', name: 'Read', emoji: '📖', color: '#f7c548', palette: 'ember' },
  { id: 'code', name: 'Code', emoji: '⌨️', color: '#57e2c8', palette: 'lagoon' },
  { id: 'move', name: 'Exercise', emoji: '🏃', color: '#90a955', palette: 'moss' },
  { id: 'mind', name: 'Meditate', emoji: '🧘', color: '#ffb86b', palette: 'dusk' },
];

function pickStyle(s: Settings, current?: ArtStyleId): ArtStyleId {
  if (s.artStyle !== 'random') return s.artStyle;
  // The visualizer only makes sense when it has music to listen to.
  const pool = ART_STYLES.map((a) => a.id).filter((id) => id !== current && (id !== 'visualizer' || s.musicReactive));
  return pool[Math.floor(Math.random() * pool.length)];
}

function initialTimer(): TimerState {
  return {
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
    seed: newSeed(),
    seedUsed: false,
    artStyle: pickStyle(DEFAULT_SETTINGS),
  };
}

export interface ExportData {
  version: 1;
  settings: Settings;
  activities: Activity[];
  tasks: Task[];
  sessions: Session[];
  unlocked: string[];
}

interface State {
  settings: Settings;
  activities: Activity[];
  tasks: Task[];
  sessions: Session[];
  unlocked: string[];
  timer: TimerState;

  updateSettings(p: Partial<Settings>): void;
  addActivity(a: Omit<Activity, 'id'>): string;
  updateActivity(id: string, p: Partial<Activity>): void;
  removeActivity(id: string): void;
  addTask(title: string, activityId?: string, estimate?: number): void;
  updateTask(id: string, p: Partial<Task>): void;
  toggleTask(id: string): void;
  removeTask(id: string): void;
  clearDoneTasks(): void;
  removeSession(id: string): void;
  markArt(sessionId: string): void;
  unlock(ids: string[]): void;
  importData(d: ExportData): void;
  resetAll(): void;

  setActivity(id: string): void;
  setTask(id: string | null): void;
  setIntent(s: string): void;
  setMode(m: Mode): void;
  setPhase(p: Phase): void;
  setArtStyle(id: ArtStyleId): void;
  start(): void;
  pause(): void;
  toggle(): void;
  reset(): void;
  skip(): void;
  /** End the current segment now and log it. */
  finish(): Session | null;
  /** Segment ran to its target. */
  complete(): Session | null;
}

export const useStore = create<State>()(
  persist(
    (set, get) => {
      /** Fresh idle segment, with a new artwork if it will be a focus block. */
      const freshTimer = (t: TimerState, phase: Phase, extra: Partial<TimerState> = {}): TimerState => {
        const s = get().settings;
        const art = phase === 'focus' ? { seed: newSeed(), seedUsed: false, artStyle: pickStyle(s, t.artStyle) } : {};
        return { ...t, phase, status: 'idle', runStartedAt: null, accumulatedMs: 0, segmentStartedAt: null, ...art, ...extra };
      };

      const runTimer = (t: TimerState, now: number): TimerState => ({
        ...t,
        status: 'running',
        runStartedAt: now,
        accumulatedMs: 0,
        segmentStartedAt: now,
      });

      const logSegment = (completed: boolean): Session | null => {
        const { timer: t, settings: s } = get();
        if (t.status === 'idle' || !t.segmentStartedAt) return null;
        const now = Date.now();
        const target = targetMs(t, s);
        let dur = elapsedMs(t, now);
        if (completed && target) dur = Math.min(dur, target);
        const kind = t.phase === 'focus' ? 'focus' : 'break';
        const minMs = kind === 'focus' ? s.minLogMin * MIN : 30_000;
        if (!completed && dur < minMs) return null;
        if (dur < 1000) return null;
        const act = get().activities.find((a) => a.id === t.activityId);
        const session: Session = {
          id: uid(),
          kind,
          mode: t.mode,
          activityId: kind === 'focus' ? t.activityId : undefined,
          taskId: kind === 'focus' && t.taskId ? t.taskId : undefined,
          intent: kind === 'focus' && t.intent ? t.intent : undefined,
          startedAt: t.segmentStartedAt,
          endedAt: now,
          durationMs: dur,
          plannedMs: target,
          completed,
          artStyle: kind === 'focus' ? t.artStyle : undefined,
          palette: kind === 'focus' ? (s.palette === 'activity' ? act?.palette : s.palette) : undefined,
        };
        set((st) => ({
          sessions: [...st.sessions, session],
          tasks:
            session.taskId != null
              ? st.tasks.map((k) => (k.id === session.taskId ? { ...k, spentMs: k.spentMs + dur } : k))
              : st.tasks,
        }));
        return session;
      };

      /** Move to the next phase after a segment ends (completed or finished early). */
      const advance = (countCycle: boolean) => {
        const { timer: t, settings: s } = get();
        const now = Date.now();
        // Keep the finished artwork on screen; a new seed is drawn when the next focus starts.
        const keepArt = (phase: Phase, autostart: boolean, cycle: number): TimerState => {
          const base: TimerState = { ...t, phase, cycle, status: 'idle', runStartedAt: null, accumulatedMs: 0, segmentStartedAt: null };
          if (!autostart) return base;
          if (phase === 'focus') return runTimer({ ...base, seed: newSeed(), seedUsed: true, artStyle: pickStyle(s, t.artStyle) }, now);
          return runTimer(base, now);
        };
        if (t.mode === 'pomodoro') {
          if (t.phase === 'focus') {
            const cycle = countCycle ? t.cycle + 1 : t.cycle;
            const next: Phase = countCycle && cycle % s.longEvery === 0 ? 'long' : 'short';
            set({ timer: keepArt(next, s.autoStartBreaks, cycle) });
          } else {
            set({ timer: keepArt('focus', s.autoStartFocus, t.phase === 'long' ? 0 : t.cycle) });
          }
        } else {
          set({ timer: keepArt('focus', false, t.cycle) });
        }
      };

      return {
        settings: DEFAULT_SETTINGS,
        activities: DEFAULT_ACTIVITIES,
        tasks: [],
        sessions: [],
        unlocked: [],
        timer: initialTimer(),

        updateSettings: (p) =>
          set((st) => {
            const settings = { ...st.settings, ...p };
            let timer = st.timer;
            if (p.artStyle && p.artStyle !== 'random' && timer.status === 'idle') timer = { ...timer, artStyle: p.artStyle };
            return { settings, timer };
          }),
        addActivity: (a) => {
          const id = uid();
          set((st) => ({ activities: [...st.activities, { ...a, id }] }));
          return id;
        },
        updateActivity: (id, p) => set((st) => ({ activities: st.activities.map((a) => (a.id === id ? { ...a, ...p } : a)) })),
        removeActivity: (id) =>
          set((st) => {
            // Archive if history references it, so stats keep their labels.
            const used = st.sessions.some((s) => s.activityId === id);
            const activities = used
              ? st.activities.map((a) => (a.id === id ? { ...a, archived: true } : a))
              : st.activities.filter((a) => a.id !== id);
            const fallback = activities.find((a) => !a.archived)?.id ?? id;
            const timer = st.timer.activityId === id ? { ...st.timer, activityId: fallback } : st.timer;
            return { activities, timer };
          }),
        addTask: (title, activityId, estimate = 1) =>
          set((st) => ({
            tasks: [...st.tasks, { id: uid(), title, activityId, estimate, done: false, createdAt: Date.now(), spentMs: 0 }],
          })),
        updateTask: (id, p) => set((st) => ({ tasks: st.tasks.map((k) => (k.id === id ? { ...k, ...p } : k)) })),
        toggleTask: (id) =>
          set((st) => ({
            tasks: st.tasks.map((k) => (k.id === id ? { ...k, done: !k.done, doneAt: !k.done ? Date.now() : undefined } : k)),
            timer: st.timer.taskId === id ? { ...st.timer, taskId: null } : st.timer,
          })),
        removeTask: (id) =>
          set((st) => ({
            tasks: st.tasks.filter((k) => k.id !== id),
            timer: st.timer.taskId === id ? { ...st.timer, taskId: null } : st.timer,
          })),
        clearDoneTasks: () => set((st) => ({ tasks: st.tasks.filter((k) => !k.done) })),
        removeSession: (id) => set((st) => ({ sessions: st.sessions.filter((s) => s.id !== id) })),
        markArt: (sessionId) => set((st) => ({ sessions: st.sessions.map((s) => (s.id === sessionId ? { ...s, hasArt: true } : s)) })),
        unlock: (ids) => set((st) => ({ unlocked: [...new Set([...st.unlocked, ...ids])] })),
        importData: (d) =>
          set(() => ({
            settings: { ...migrateSettings(d.settings), welcomed: true },
            activities: d.activities?.length ? d.activities : DEFAULT_ACTIVITIES,
            tasks: d.tasks ?? [],
            sessions: d.sessions ?? [],
            unlocked: d.unlocked ?? [],
            timer: initialTimer(),
          })),
        resetAll: () =>
          set(() => ({
            settings: DEFAULT_SETTINGS,
            activities: DEFAULT_ACTIVITIES,
            tasks: [],
            sessions: [],
            unlocked: [],
            timer: initialTimer(),
          })),

        setActivity: (id) => set((st) => ({ timer: { ...st.timer, activityId: id } })),
        setTask: (id) =>
          set((st) => {
            const task = st.tasks.find((k) => k.id === id);
            return {
              timer: {
                ...st.timer,
                taskId: id,
                activityId: task?.activityId ?? st.timer.activityId,
              },
            };
          }),
        setIntent: (s) => set((st) => ({ timer: { ...st.timer, intent: s } })),
        setMode: (m) => set((st) => ({ timer: freshTimer({ ...st.timer, mode: m, cycle: 0 }, 'focus') })),
        setPhase: (p) => set((st) => ({ timer: freshTimer(st.timer, p) })),
        setArtStyle: (id) => set((st) => ({ timer: { ...st.timer, artStyle: id } })),

        start: () => {
          const { timer: t, settings: s } = get();
          const now = Date.now();
          if (t.status === 'running') return;
          if (t.status === 'paused') {
            set({ timer: { ...t, status: 'running', runStartedAt: now } });
            return;
          }
          let next = runTimer(t, now);
          if (t.phase === 'focus') {
            next = t.seedUsed
              ? { ...next, seed: newSeed(), seedUsed: true, artStyle: pickStyle(s, t.artStyle) }
              : { ...next, seedUsed: true };
          }
          set({ timer: next });
        },
        pause: () => {
          const t = get().timer;
          if (t.status !== 'running') return;
          set({ timer: { ...t, status: 'paused', accumulatedMs: elapsedMs(t, Date.now()), runStartedAt: null } });
        },
        toggle: () => (get().timer.status === 'running' ? get().pause() : get().start()),
        reset: () => set((st) => ({ timer: freshTimer(st.timer, st.timer.phase) })),
        skip: () => {
          const t = get().timer;
          if (t.mode !== 'pomodoro') {
            get().reset();
            return;
          }
          if (t.phase === 'focus') {
            // Abandoning a focus block: discard its artwork, rest on a finished random piece.
            const s = get().settings;
            set({ timer: { ...freshTimer(t, 'short'), seed: newSeed(), seedUsed: true, artStyle: pickStyle(s, t.artStyle) } });
          } else {
            set({ timer: freshTimer(t, 'focus', { cycle: t.phase === 'long' ? 0 : t.cycle }) });
          }
        },
        finish: () => {
          const t = get().timer;
          const session = logSegment(t.mode === 'stopwatch');
          advance(session != null && session.kind === 'focus');
          return session;
        },
        complete: () => {
          const session = logSegment(true);
          advance(true);
          return session;
        },
      };
    },
    {
      name: 'flowstate-v1',
      version: 1,
      // The widget window mirrors the main window's state; only main may write the save.
      storage: createJSONStorage(() =>
        isWidgetWindow ? { getItem: (k) => localStorage.getItem(k), setItem: () => {}, removeItem: () => {} } : localStorage,
      ),
      // Settings added in later versions need their defaults when loading older saves.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        const settings = migrateSettings(p.settings);
        // People with history predate the welcome screen; don't greet them as new.
        if (p.sessions?.length) settings.welcomed = true;
        return { ...current, ...p, settings };
      },
    },
  ),
);

/* ── Ephemeral UI state ─────────────────────────────────────────── */

export interface Toast {
  id: string;
  title: string;
  body?: string;
  icon?: string;
}

interface UIState {
  focus: boolean;
  /** True while an opaque page covers the art, so the render loop can idle. */
  artPaused: boolean;
  setArtPaused(v: boolean): void;
  toasts: Toast[];
  setFocus(v: boolean): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismiss(id: string): void;
  /** A newer release is ready to install (desktop). */
  update: Update | null;
  setUpdate(u: Update | null): void;
}

export const useUI = create<UIState>()((set, get) => ({
  focus: false,
  update: null,
  setUpdate: (u) => set({ update: u }),
  artPaused: false,
  setArtPaused: (v) => set({ artPaused: v }),
  toasts: [],
  setFocus: (v) => set({ focus: v }),
  toast: (t) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
    setTimeout(() => get().dismiss(id), 4500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function activePaletteId(st: { settings: Settings; activities: Activity[]; timer: TimerState }): string {
  if (st.settings.palette !== 'activity') return st.settings.palette;
  return st.activities.find((a) => a.id === st.timer.activityId)?.palette ?? 'midnight';
}
