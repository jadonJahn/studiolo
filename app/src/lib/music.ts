import { create } from 'zustand';
import type { AudioFrame } from '../art/engine';
import { useStore } from '../store';
import { isDesktop } from './desktop';

export interface NowPlaying {
  app: string;
  app_id: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  art: string | null;
}

export interface AudioSource {
  exe: string;
  name: string;
  peak: number;
}

interface MusicState {
  nowPlaying: NowPlaying | null;
  /** What's actually being captured, e.g. "All audio" or "Brave". */
  capturing: string | null;
  error: string | null;
  /** True once a capture has delivered audible sound recently. */
  hearing: boolean;
}

export const useMusic = create<MusicState>()(() => ({ nowPlaying: null, capturing: null, error: null, hearing: false }));

/**
 * Live frame read by the art loop every frame. Mutated in place (no React
 * renders at 60 Hz); the art loop applies intensity and beat decay.
 */
export const audioFrame: AudioFrame = {
  bands: new Float32Array(48),
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  beat: 0,
  on: false,
};
let lastFrameAt = 0;
let lastAudibleAt = 0;

interface RawFrame {
  b: number[];
  level: number;
  bass: number;
  mid: number;
  treble: number;
  beat: boolean;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invoke: Invoke | null = null;

/** Called by the art loop: decays to silence if frames stop arriving. */
export function tickAudio(dt: number) {
  if (!audioFrame.on) return;
  audioFrame.beat = Math.max(0, audioFrame.beat - dt * 4);
  if (performance.now() - lastFrameAt > 250) {
    const k = Math.max(0, 1 - dt * 4);
    audioFrame.level *= k;
    audioFrame.bass *= k;
    audioFrame.mid *= k;
    audioFrame.treble *= k;
    for (let i = 0; i < audioFrame.bands.length; i++) audioFrame.bands[i] *= k;
  }
  const hearing = performance.now() - lastAudibleAt < 3000;
  if (hearing !== useMusic.getState().hearing) useMusic.setState({ hearing });
}

export async function listSources(): Promise<AudioSource[]> {
  return invoke ? invoke<AudioSource[]>('audio_sources') : [];
}

async function applyCapture() {
  if (!invoke) return;
  const { musicReactive, musicSource } = useStore.getState().settings;
  if (!musicReactive) {
    await invoke('audio_stop');
    audioFrame.on = false;
    useMusic.setState({ capturing: null, error: null, hearing: false });
    return;
  }
  try {
    const label = await invoke<string>('audio_start', { source: musicSource === 'all' ? null : musicSource });
    audioFrame.on = true;
    useMusic.setState({ capturing: label, error: null });
  } catch (e) {
    audioFrame.on = false;
    useMusic.setState({ capturing: null, error: String(e) });
  }
}

/** Desktop wiring: spectrum + now-playing events, and (re)start capture when settings change. */
export async function initMusic(): Promise<void> {
  if (!isDesktop) return;
  const core = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  invoke = core.invoke as Invoke;

  await listen<RawFrame>('audio', ({ payload: f }) => {
    lastFrameAt = performance.now();
    for (let i = 0; i < 48; i++) audioFrame.bands[i] = (f.b[i] ?? 0) / 255;
    audioFrame.level = f.level;
    audioFrame.bass = f.bass;
    audioFrame.mid = f.mid;
    audioFrame.treble = f.treble;
    if (f.beat) audioFrame.beat = 1;
    if (f.level > 0.02) lastAudibleAt = lastFrameAt;
  });
  await listen<string>('audio-error', ({ payload }) => {
    audioFrame.on = false;
    useMusic.setState({ capturing: null, error: payload });
  });
  await listen<NowPlaying | null>('nowplaying', ({ payload }) => useMusic.setState({ nowPlaying: payload }));
  useMusic.setState({ nowPlaying: await invoke<NowPlaying | null>('now_playing') });

  let prev = useStore.getState().settings;
  useStore.subscribe((st) => {
    const s = st.settings;
    if (s.musicReactive !== prev.musicReactive || s.musicSource !== prev.musicSource) void applyCapture();
    prev = s;
  });
  await applyCapture();

  // Per-app capture targets a process; if the app was restarted, retarget it.
  useMusic.subscribe((m, old) => {
    const s = useStore.getState().settings;
    if (s.musicReactive && s.musicSource !== 'all' && m.nowPlaying?.title !== old.nowPlaying?.title && !m.hearing) {
      void applyCapture();
    }
  });
}
