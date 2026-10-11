import { useStore, type ExportData } from '../store';
import { dayKey, targetMs } from './time';

/** Running inside the Tauri desktop shell (vs. a plain browser tab). */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface ApiInfo {
  port: number | null;
  db_path: string;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invoke: Invoke | null = null;

export async function apiInfo(): Promise<ApiInfo | null> {
  return invoke ? invoke<ApiInfo>('api_info') : null;
}

/** Start or stop the local API; idempotent. */
export async function setApiEnabled(on: boolean): Promise<ApiInfo | null> {
  return invoke ? invoke<ApiInfo>('api_set_enabled', { on }) : null;
}

function snapshot() {
  const st = useStore.getState();
  const actName = new Map(st.activities.map((a) => [a.id, a.name]));
  const taskTitle = new Map(st.tasks.map((t) => [t.id, t.title]));
  const raw: ExportData = {
    version: 1,
    settings: st.settings,
    activities: st.activities,
    tasks: st.tasks,
    sessions: st.sessions,
    unlocked: st.unlocked,
  };
  return {
    raw: JSON.stringify(raw),
    settings: st.settings,
    sessions: st.sessions.map((s) => ({
      id: s.id,
      kind: s.kind,
      mode: s.mode,
      activity_id: s.activityId ?? null,
      activity_name: s.activityId ? (actName.get(s.activityId) ?? null) : null,
      task_id: s.taskId ?? null,
      task_title: s.taskId ? (taskTitle.get(s.taskId) ?? null) : null,
      intent: s.intent ?? null,
      started_at: s.startedAt,
      ended_at: s.endedAt,
      day: dayKey(s.startedAt),
      duration_min: s.durationMs / 60000,
      planned_min: s.plannedMs / 60000,
      completed: s.completed,
      art_style: s.artStyle ?? null,
    })),
    tasks: st.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      activity_id: t.activityId ?? null,
      activity_name: t.activityId ? (actName.get(t.activityId) ?? null) : null,
      estimate: t.estimate,
      done: t.done,
      created_at: t.createdAt,
      done_at: t.doneAt ?? null,
      spent_min: t.spentMs / 60000,
    })),
    activities: st.activities.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji, color: a.color, archived: !!a.archived })),
  };
}

function timerPayload() {
  const { timer: t, settings, activities, tasks } = useStore.getState();
  return {
    status: t.status,
    phase: t.phase,
    mode: t.mode,
    activity: activities.find((a) => a.id === t.activityId)?.name ?? null,
    intent: t.intent || null,
    task: tasks.find((k) => k.id === t.taskId)?.title ?? null,
    run_started_at: t.runStartedAt,
    segment_started_at: t.segmentStartedAt,
    accumulated_ms: t.accumulatedMs,
    target_ms: targetMs(t, settings),
    updated_at: Date.now(),
  };
}

/**
 * Desktop wiring: restore from the SQLite mirror if webview storage was wiped,
 * mirror changes back to SQLite (served to the tailnet by the Rust API), and
 * drive the timer from the native 1s heartbeat.
 */
export async function initDesktop(onTick: () => void): Promise<void> {
  if (!isDesktop) return;
  const core = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  invoke = core.invoke as Invoke;

  if (useStore.getState().sessions.length === 0) {
    try {
      const raw = await invoke<string | null>('load_snapshot');
      const d = raw ? (JSON.parse(raw) as ExportData) : null;
      if (d?.sessions?.length) useStore.getState().importData(d);
    } catch (e) {
      console.warn('Restore from database failed', e);
    }
  }

  let pending: ReturnType<typeof setTimeout> | undefined;
  const pushSnapshot = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      invoke!('sync_snapshot', { snapshot: snapshot() }).catch((e) => console.warn('DB sync failed', e));
    }, 800);
  };
  const pushTimer = () => {
    invoke!('sync_timer', { timer: timerPayload() }).catch((e) => console.warn('Timer sync failed', e));
  };

  useStore.subscribe((st, prev) => {
    if (st.sessions !== prev.sessions || st.tasks !== prev.tasks || st.activities !== prev.activities || st.settings !== prev.settings || st.unlocked !== prev.unlocked) {
      pushSnapshot();
    }
    if (st.timer !== prev.timer) pushTimer();
  });
  pushSnapshot();
  pushTimer();

  const syncApi = (on: boolean) => setApiEnabled(on).catch((e) => console.warn('API toggle failed', e));
  void syncApi(useStore.getState().settings.localApi);
  useStore.subscribe((st, prev) => {
    if (st.settings.localApi !== prev.settings.localApi) void syncApi(st.settings.localApi);
  });

  await listen('tick', onTick);
}
