import type { AmbientKind } from '../types';

let ctx: AudioContext | null = null;

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Soft bell arpeggio, synthesized — no audio assets. */
export function chime(volume: number, kind: 'focus' | 'break' = 'focus') {
  const c = ac();
  const t = c.currentTime + 0.02;
  const notes = kind === 'focus' ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 659.25, 523.25];
  notes.forEach((f, i) => {
    const st = t + i * 0.14;
    for (const [mult, g0] of [[1, 1], [2.76, 0.18], [5.4, 0.06]] as const) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = f * mult;
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.18 * volume * g0, st + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 2.4 / mult ** 0.3);
      o.connect(g).connect(c.destination);
      o.start(st);
      o.stop(st + 2.6);
    }
  });
}

function noiseBuffer(c: AudioContext, color: 'white' | 'pink' | 'brown'): AudioBuffer {
  const len = c.sampleRate * 6;
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'white') d[i] = w * 0.5;
      else if (color === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // Crossfade the loop seam.
    const fade = Math.floor(c.sampleRate * 0.25);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
  }
  return buf;
}

interface Ambient {
  kind: AmbientKind;
  setVolume(v: number): void;
  stop(): void;
}

function lfo(c: AudioContext, freq: number, depth: number, target: AudioParam) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = freq;
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start();
  return o;
}

function createAmbient(kind: Exclude<AmbientKind, 'off'>, volume: number): Ambient {
  const c = ac();
  const out = c.createGain();
  out.gain.value = 0;
  out.connect(c.destination);
  const level = (v: number) => v * v * 0.9;
  out.gain.linearRampToValueAtTime(level(volume), c.currentTime + 1.5);
  const nodes: AudioScheduledSourceNode[] = [];

  const src = (color: 'white' | 'pink' | 'brown') => {
    const s = c.createBufferSource();
    s.buffer = noiseBuffer(c, color);
    s.loop = true;
    s.start();
    nodes.push(s);
    return s;
  };

  if (kind === 'white' || kind === 'pink' || kind === 'brown') {
    src(kind).connect(out);
  } else if (kind === 'rain') {
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const g = c.createGain();
    g.gain.value = 0.8;
    src('pink').connect(hp).connect(lp).connect(g).connect(out);
    nodes.push(lfo(c, 0.07, 0.15, g.gain));
    const rumble = c.createGain();
    rumble.gain.value = 0.35;
    src('brown').connect(rumble).connect(out);
  } else if (kind === 'ocean') {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = c.createGain();
    g.gain.value = 0.55;
    src('brown').connect(lp).connect(g).connect(out);
    nodes.push(lfo(c, 0.085, 0.45, g.gain));
    nodes.push(lfo(c, 0.085, 350, lp.frequency));
  } else if (kind === 'drone') {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.Q.value = 2;
    const g = c.createGain();
    g.gain.value = 0.12;
    lp.connect(g).connect(out);
    for (const [f, type] of [[110, 'sawtooth'], [110.6, 'sawtooth'], [164.8, 'triangle'], [220.4, 'sine'], [55, 'sine']] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      nodes.push(o);
    }
    nodes.push(lfo(c, 0.03, 350, lp.frequency));
  }

  return {
    kind,
    setVolume(v) {
      out.gain.cancelScheduledValues(c.currentTime);
      out.gain.linearRampToValueAtTime(level(v), c.currentTime + 0.3);
    },
    stop() {
      out.gain.cancelScheduledValues(c.currentTime);
      out.gain.setValueAtTime(out.gain.value, c.currentTime);
      out.gain.linearRampToValueAtTime(0, c.currentTime + 1.2);
      setTimeout(() => {
        nodes.forEach((n) => n.stop());
        out.disconnect();
      }, 1400);
    },
  };
}

let current: Ambient | null = null;

export function setAmbient(kind: AmbientKind, volume: number) {
  if (current && current.kind === kind) {
    current.setVolume(volume);
    return;
  }
  current?.stop();
  current = null;
  if (kind !== 'off') current = createAmbient(kind, volume);
}

/** Short audition when the user picks a sound in settings. */
let previewTimer: ReturnType<typeof setTimeout> | undefined;
export function previewAmbient(kind: AmbientKind, volume: number) {
  clearTimeout(previewTimer);
  setAmbient(kind, volume);
  previewTimer = setTimeout(() => setAmbient('off', 0), 4000);
}
export function cancelPreview() {
  clearTimeout(previewTimer);
}
