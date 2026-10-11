import { useEffect, useReducer, useRef, useState } from 'react';
import { registerCanvas, isLiveCanvas } from '../lib/gallery';
import { audioFrame, tickAudio, useMusic } from '../lib/music';
import { elapsedMs, MIN, targetMs } from '../lib/time';
import { activePaletteId, useStore, useUI } from '../store';
import type { ArtStyleId } from '../types';
import { paletteFromArt } from './albumPalette';
import type { ArtEngine, AudioFrame, EngineFactory } from './engine';
import { flowField } from './flowField';
import { harmonograph } from './harmonograph';
import { getPalette } from './palettes';
import { aurora, glass, nebula, topography, visualizer } from './shaders';

const ENGINES: Record<ArtStyleId, EngineFactory> = {
  flow: flowField,
  harmonograph,
  nebula,
  topography,
  aurora,
  glass,
  visualizer,
};

/** How "finished" the current piece is. Breaks and completed idles show the whole piece. */
function artProgress(now: number): { progress: number; running: boolean; focus: boolean } {
  const { timer: t, settings: s } = useStore.getState();
  const running = t.status === 'running';
  if (t.phase !== 'focus') return { progress: 1, running, focus: false };
  if (t.status === 'idle') return { progress: t.seedUsed ? 1 : 0, running, focus: true };
  const el = elapsedMs(t, now);
  const target = t.mode === 'stopwatch' ? s.focusMin * MIN : targetMs(t, s);
  return { progress: Math.min(1, el / Math.max(1, target)), running, focus: true };
}

const GL_STYLES: ArtStyleId[] = ['nebula', 'topography', 'aurora', 'glass', 'visualizer'];
const failed = new Set<ArtStyleId>();
const hasGL2 = (() => {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
})();
if (!hasGL2) GL_STYLES.forEach((s) => failed.add(s));

/**
 * `widget`: a second, small copy of the piece for the floating widget. It must not
 * become the gallery's capture source, and it follows its own window's size and frames.
 */
export function ArtCanvas({ widget = false }: { widget?: boolean }) {
  const wanted = useStore((s) => s.timer.artStyle);
  const seed = useStore((s) => s.timer.seed);
  const basePalette = useStore(activePaletteId);
  const albumOn = useStore((s) => s.settings.albumPalette);
  const np = useMusic((m) => m.nowPlaying);
  const [albumId, setAlbumId] = useState<string | null>(null);
  useEffect(() => {
    if (!albumOn || !np?.art) {
      setAlbumId(null);
      return;
    }
    let live = true;
    paletteFromArt(np.art, `${np.app_id}|${np.artist}|${np.album || np.title}`)
      .then((id) => live && setAlbumId(id))
      .catch(() => live && setAlbumId(null));
    return () => {
      live = false;
    };
  }, [albumOn, np?.art, np?.app_id, np?.artist, np?.album, np?.title]);
  const paletteId = albumId ?? basePalette;
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const style = failed.has(wanted) ? 'flow' : wanted;
  // A canvas can't switch between 2d and webgl contexts, so remount per piece.
  return (
    <ArtSurface
      key={`${style}:${seed}:${paletteId}`}
      style={style}
      seed={seed}
      paletteId={paletteId}
      widget={widget}
      onFail={() => {
        failed.add(style);
        rerender();
      }}
    />
  );
}

function ArtSurface({ style, seed, paletteId, widget, onFail }: { style: ArtStyleId; seed: number; paletteId: string; widget: boolean; onFail(): void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    // A picture-in-picture widget lives in another document; size and pace it by that window.
    const view = canvas.ownerDocument.defaultView ?? window;
    const palette = getPalette(paletteId);
    let engine: ArtEngine;
    try {
      engine = ENGINES[style](canvas, seed, palette);
    } catch (err) {
      console.warn(`Art style "${style}" failed, falling back to flow field`, err);
      onFail();
      return;
    }
    if (!widget) {
      registerCanvas(canvas);
      document.documentElement.style.setProperty('--art-bg', palette.bg);
    }

    const resize = () => engine.resize(view.innerWidth, view.innerHeight, view.devicePixelRatio || 1);
    resize();
    view.addEventListener('resize', resize);
    // The widget is a glanceable thumbnail; 30fps is plenty.
    const minFrame = widget ? 30 : 12;

    let raf = 0;
    let last = performance.now();
    let t = (seed % 1000) * 0.37;
    let energy = 0.2;
    // Adaptive quality: if frames stay slow, step resolution/particles down.
    let quality = 1;
    let slowFrames = 0;
    // Intensity-scaled copy of the live audio frame handed to the engine.
    const audio: AudioFrame = { bands: new Float32Array(48), level: 0, bass: 0, mid: 0, treble: 0, beat: 0, on: false };
    const loop = (now: number) => {
      raf = view.requestAnimationFrame(loop);
      const since = now - last;
      // Cap at ~60fps (high-refresh displays would otherwise double GPU work),
      // and idle entirely while a page covers the art.
      if (since < minFrame || (!widget && useUI.getState().artPaused)) return;
      last = now;
      const dt = Math.min(0.05, since / 1000);
      if (since > minFrame * 2.2 && since < 250) {
        if (++slowFrames > 90 && quality > 0.35) {
          quality *= 0.8;
          slowFrames = 0;
          engine.setQuality?.(quality);
        }
      } else slowFrames = Math.max(0, slowFrames - 1);
      const { progress, running, focus } = artProgress(Date.now());
      const motion = useStore.getState().settings.artMotion;
      if (!widget) tickAudio(dt);
      const k = audioFrame.on ? useStore.getState().settings.musicIntensity : 0;
      audio.on = audioFrame.on;
      audio.level = Math.min(1.5, audioFrame.level * k);
      audio.bass = Math.min(1.5, audioFrame.bass * k);
      audio.mid = Math.min(1.5, audioFrame.mid * k);
      audio.treble = Math.min(1.5, audioFrame.treble * k);
      audio.beat = audioFrame.beat * Math.min(1, k);
      for (let i = 0; i < 48; i++) audio.bands[i] = Math.min(1.5, audioFrame.bands[i] * k);
      // Music livens the art even when the timer is idle.
      const target = Math.min(1, (running ? (focus ? 1 : 0.55) : 0.38) + audio.level * 0.5);
      energy += (target - energy) * Math.min(1, dt * 1.2);
      t += dt * motion * (0.3 + 0.7 * energy);
      engine.frame(dt * motion, t, { progress, energy, audio });
    };
    raf = view.requestAnimationFrame(loop);

    return () => {
      view.cancelAnimationFrame(raf);
      view.removeEventListener('resize', resize);
      engine.destroy();
      if (isLiveCanvas(canvas)) registerCanvas(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, seed, paletteId, widget]);

  return <canvas ref={ref} className="art-canvas" aria-hidden="true" />;
}
