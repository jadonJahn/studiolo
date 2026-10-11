import type { EngineFactory } from './engine';
import { hexToRgb, samplePalette } from './palettes';
import { mulberry32 } from './random';

const RATIOS: [number, number][] = [
  [1, 1], [2, 1], [3, 2], [3, 1], [4, 3], [5, 4], [2, 3], [5, 3], [1, 2],
];

/**
 * A simulated four-pendulum harmonograph with a rotary table. The pen traces
 * exactly one figure over the session: progress 0 → blank paper, 1 → finished.
 */
export const harmonograph: EngineFactory = (canvas, seed, palette) => {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const paper = document.createElement('canvas');
  const pctx = paper.getContext('2d')!;
  const rand = mulberry32(seed);
  const cols = palette.colors.map(hexToRgb).slice(1) as [number, number, number][];

  const [ra, rb] = RATIOS[Math.floor(rand() * RATIOS.length)];
  const jit = () => (rand() - 0.5) * 0.02;
  const base = 2 + rand() * 1.2;
  const f = [ra * base / 2 + jit(), rb * base / 2 + jit(), ra * base / 2 + jit(), rb * base / 2 + jit()];
  const ph = [0, 1, 2, 3].map(() => rand() * Math.PI * 2);
  const amp = [0, 1, 2, 3].map(() => 0.35 + rand() * 0.65);
  const ax = amp[0] + amp[2];
  const ay = amp[1] + amp[3];
  const T_MAX = 240;
  const damp = Math.log(7) / T_MAX;
  const rot = (rand() - 0.5) * 0.012;
  const STEP = 0.02;

  let w = 0;
  let h = 0;
  let dpr = 1;
  let drawnT = 0;

  const raw = (t: number): [number, number] => [
    (amp[0] * Math.sin(f[0] * t + ph[0]) + amp[2] * Math.sin(f[2] * t + ph[2])) / ax,
    (amp[1] * Math.sin(f[1] * t + ph[1]) + amp[3] * Math.sin(f[3] * t + ph[3])) / ay,
  ];
  // Fit the figure's actual extent (pendulums partly cancel), rotation-safe via radius.
  let rMax = 0.2;
  for (let t = 0; t < T_MAX; t += 0.05) {
    const [x, y] = raw(t);
    rMax = Math.max(rMax, Math.hypot(x, y) * Math.exp(-damp * t));
  }

  const point = (t: number): [number, number] => {
    const d = Math.exp(-damp * t);
    let [x, y] = raw(t);
    const a = rot * t;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const s = (Math.min(w, h) * 0.46 * d) / rMax;
    const rx = x * ca - y * sa;
    const ry = x * sa + y * ca;
    x = w / 2 + rx * s;
    y = h / 2 + ry * s;
    return [x, y];
  };

  const drawRange = (t0: number, t1: number, alpha: number, lw: number) => {
    pctx.globalCompositeOperation = 'lighter';
    pctx.lineWidth = lw;
    pctx.lineCap = 'round';
    pctx.lineJoin = 'round';
    const CHUNK = 1.5;
    for (let c0 = t0; c0 < t1; c0 += CHUNK) {
      const c1 = Math.min(t1, c0 + CHUNK);
      const [r, g, b] = samplePalette(cols, c0 / T_MAX);
      pctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
      pctx.beginPath();
      let [x, y] = point(c0);
      pctx.moveTo(x, y);
      for (let t = c0 + STEP; t <= c1 + 1e-6; t += STEP) {
        [x, y] = point(t);
        pctx.lineTo(x, y);
      }
      pctx.stroke();
    }
  };

  const resetPaper = () => {
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pctx.globalCompositeOperation = 'source-over';
    pctx.fillStyle = palette.bg;
    pctx.fillRect(0, 0, w, h);
    drawRange(0, T_MAX, 0.05, 0.8); // faint ghost of the whole figure
    drawnT = 0;
  };

  return {
    resize(cw, ch, d) {
      w = cw;
      h = ch;
      dpr = d;
      canvas.width = paper.width = Math.round(cw * d);
      canvas.height = paper.height = Math.round(ch * d);
      resetPaper();
    },
    frame(_dt, t, { progress, energy, audio }) {
      const target = Math.min(1, progress) * T_MAX;
      if (target < drawnT - 1) resetPaper();
      if (target - drawnT >= STEP) {
        drawRange(drawnT, target, 0.42, 1.2);
        drawnT = target;
      }
      // The paper "breathes" with the bass and kicks on beats.
      const pulse = 1 + audio.bass * 0.025 + audio.beat * 0.02;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (pulse > 1.001) {
        ctx.fillStyle = palette.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        ctx.setTransform(pulse, 0, 0, pulse, cx * (1 - pulse), cy * (1 - pulse));
      }
      ctx.drawImage(paper, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Pen head glow while drawing.
      if (progress > 0 && progress < 1) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const [x, y] = point(drawnT);
        const [r, g, b] = samplePalette(cols, drawnT / T_MAX);
        const rad = 10 + 6 * Math.sin(t * 2) * energy + audio.level * 22 + audio.beat * 26;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rad * 2);
        grad.addColorStop(0, `rgba(255,255,255,${0.7 * energy + 0.2})`);
        grad.addColorStop(0.2, `rgba(${r | 0},${g | 0},${b | 0},${0.5 * energy + 0.1})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillRect(x - rad * 2, y - rad * 2, rad * 4, rad * 4);
        ctx.globalCompositeOperation = 'source-over';
      }
    },
    destroy() {
      paper.width = paper.height = 0;
    },
  };
};
