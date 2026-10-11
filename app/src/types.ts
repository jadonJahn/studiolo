export type Mode = 'pomodoro' | 'countdown' | 'stopwatch';
export type Phase = 'focus' | 'short' | 'long';
export type Status = 'idle' | 'running' | 'paused';
export type ArtStyleId = 'flow' | 'harmonograph' | 'nebula' | 'topography' | 'aurora' | 'glass' | 'visualizer';
export type ClockVisibility = 'always' | 'auto' | 'never';
export type WidgetStyle = 'card' | 'pill' | 'off';
export type AmbientKind = 'off' | 'rain' | 'ocean' | 'brown' | 'pink' | 'white' | 'drone';

export interface Activity {
  id: string;
  name: string;
  emoji: string;
  color: string;
  palette: string;
  archived?: boolean;
}

export interface Task {
  id: string;
  title: string;
  activityId?: string;
  estimate: number; // in focus blocks
  done: boolean;
  createdAt: number;
  doneAt?: number;
  spentMs: number;
}

export interface Session {
  id: string;
  kind: 'focus' | 'break';
  mode: Mode;
  activityId?: string;
  taskId?: string;
  intent?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  plannedMs: number;
  completed: boolean;
  artStyle?: ArtStyleId;
  palette?: string;
  hasArt?: boolean;
}

export interface Settings {
  focusMin: number;
  shortMin: number;
  longMin: number;
  longEvery: number;
  countdownMin: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  autoFocusView: boolean;
  dailyGoalMin: number;
  minLogMin: number;
  weekStartsMonday: boolean;
  artStyle: ArtStyleId | 'random';
  palette: string; // 'activity' or a palette id
  artMotion: number; // 0.2 – 2
  saveArt: boolean;
  /** Focus view clock: always, only while the mouse/keyboard is active, or never. */
  focusClock: ClockVisibility;
  /** Focus view UI pinned on screen; unpinned parts appear only while you're active. */
  focusPinDashboard: boolean;
  focusPinTools: boolean;
  focusPinControls: boolean;
  focusProgress: boolean;
  chime: boolean;
  volume: number;
  ambient: AmbientKind;
  ambientVolume: number;
  notifications: boolean;
  /** Desktop only: art reacts to captured system/app audio. */
  musicReactive: boolean;
  /** 'all' = everything except this app, otherwise an exe name like 'brave.exe'. */
  musicSource: string;
  musicIntensity: number; // 0 – 2
  albumPalette: boolean;
  showNowPlaying: boolean;
  /** Floating always-on-top timer shown while you work in other windows. */
  widget: WidgetStyle;
  widgetClock: boolean;
  /** Desktop: serve a read-only HTTP API of your data on 127.0.0.1. */
  localApi: boolean;
  /** Desktop: closing the window keeps the app running in the tray instead of quitting. */
  closeToTray: boolean;
  /** First-run welcome has been seen. */
  welcomed: boolean;
}

export interface TimerState {
  mode: Mode;
  phase: Phase;
  status: Status;
  runStartedAt: number | null;
  accumulatedMs: number;
  segmentStartedAt: number | null;
  cycle: number;
  activityId: string;
  taskId: string | null;
  intent: string;
  seed: number;
  seedUsed: boolean;
  artStyle: ArtStyleId;
}
