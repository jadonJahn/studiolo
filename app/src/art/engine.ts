import type { ArtStyleId } from '../types';
import type { Palette } from './palettes';

/** Live music analysis (all zeros when music reactivity is off). Values 0..1. */
export interface AudioFrame {
  bands: Float32Array; // 48 log-spaced bands, 32 Hz – 16 kHz
  level: number;
  bass: number;
  mid: number;
  treble: number;
  /** 1 on a detected beat, decaying to 0 over ~250 ms. */
  beat: number;
  on: boolean;
}

export interface ArtParams {
  /** 0..1 — how far through the current piece we are. Pieces complete at 1. */
  progress: number;
  /** 0..1 smoothed — high while focusing, low when idle/paused. */
  energy: number;
  audio: AudioFrame;
}

export interface ArtEngine {
  resize(w: number, h: number, dpr: number): void;
  /** dt in seconds (already scaled by motion), t = accumulated art time. */
  frame(dt: number, t: number, p: ArtParams): void;
  /** Optional: 0.25..1 load factor, lowered when frames run slow. */
  setQuality?(q: number): void;
  destroy(): void;
}

export type EngineFactory = (canvas: HTMLCanvasElement, seed: number, palette: Palette) => ArtEngine;

export const ART_STYLES: { id: ArtStyleId; name: string; blurb: string }[] = [
  { id: 'flow', name: 'Flow Field', blurb: 'Thousands of particles tracing a living vector field.' },
  { id: 'harmonograph', name: 'Harmonograph', blurb: 'A damped pendulum pen draws one figure across the session.' },
  { id: 'nebula', name: 'Nebula', blurb: 'Domain-warped clouds that brighten as you go deeper.' },
  { id: 'topography', name: 'Topography', blurb: 'Contour lines of an imaginary land, mapped as you work.' },
  { id: 'aurora', name: 'Aurora', blurb: 'Curtains of light rising over a dark ridge.' },
  { id: 'glass', name: 'Stained Glass', blurb: 'A window assembles itself, pane by pane.' },
  { id: 'visualizer', name: 'Visualizer', blurb: 'A spectrum ring that dances to whatever is playing.' },
];
