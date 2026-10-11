import type { EngineFactory } from './engine';
import { hexToRgb } from './palettes';
import { makeNoise3, mulberry32 } from './random';

interface P {
  x: number;
  y: number;
  age: number;
  life: number;
  zone: number;
}

export const flowField: EngineFactory = (canvas, seed, palette) => {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const rand = mulberry32(seed);
  const noise = makeNoise3(rand);
  const cols = palette.colors.map(hexToRgb);
  const [br, bg, bb] = hexToRgb(palette.bg);

  // Per-seed character.
  const freq = 0.0011 + rand() * 0.0019;
  const useCurl = rand() < 0.55;
  const swirl = 1.2 + rand() * 2.8;
  const zoneFreq = 0.0006 + rand() * 0.0008;
  const width = 0.9 + rand() * 1.1;

  let w = 0;
  let h = 0;
  let parts: P[] = [];
  let quality = 1;

  const spawn = (p: P) => {
    p.x = rand() * w;
    p.y = rand() * h;
    p.age = 0;
    p.life = 60 + rand() * 260;
    p.zone = (noise(p.x * zoneFreq, p.y * zoneFreq, 7.3) + 1) / 2;
  };

  const paths = cols.map(() => new Path2D());

  return {
    resize(cw, ch, dpr) {
      w = cw;
      h = ch;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, w, h);
      const count = Math.min(5200, Math.floor((w * h) / 320));
      parts = Array.from({ length: count }, () => {
        const p = { x: 0, y: 0, age: 0, life: 0, zone: 0 };
        spawn(p);
        p.age = rand() * p.life;
        return p;
      });
    },
    frame(dt, t, { progress, energy, audio }) {
      // Fade every frame. Alpha stays >= ~0.04: smaller values stall on 8-bit
      // rounding and leave a grey haze (batching fades instead made it flicker).
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(${br},${bg},${bb},${Math.min(0.2, Math.max(0.04, (0.045 + 0.03 * (1 - energy)) * dt * 60))})`;
      ctx.fillRect(0, 0, w, h);

      const active = Math.floor(parts.length * (0.3 + 0.7 * energy) * quality);
      // Bass pushes the particles; beats thicken the strokes.
      const speed = (0.5 + 1.7 * energy) * (1 + audio.bass * 1.6) * 60 * dt;
      const z = t * 0.06;
      const e = 1.5;
      for (let i = 0; i < paths.length; i++) paths[i] = new Path2D();

      for (let i = 0; i < active; i++) {
        const p = parts[i];
        const nx = p.x * freq;
        const ny = p.y * freq;
        let vx: number;
        let vy: number;
        if (useCurl) {
          const a = noise(nx, ny + e * freq, z) - noise(nx, ny - e * freq, z);
          const b = noise(nx + e * freq, ny, z) - noise(nx - e * freq, ny, z);
          const len = Math.hypot(a, b) || 1;
          vx = a / len;
          vy = -b / len;
        } else {
          const ang = noise(nx, ny, z) * Math.PI * swirl;
          vx = Math.cos(ang);
          vy = Math.sin(ang);
        }
        const ox = p.x;
        const oy = p.y;
        p.x += vx * speed;
        p.y += vy * speed;
        p.age += 60 * dt;
        // Palette slowly rotates through the session.
        const ci = Math.floor((((p.zone + progress * 0.6) % 1) + 1) % 1 * cols.length) % cols.length;
        const path = paths[ci];
        path.moveTo(ox, oy);
        path.lineTo(p.x, p.y);
        if (p.age > p.life || p.x < -5 || p.x > w + 5 || p.y < -5 || p.y > h + 5) spawn(p);
      }

      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = width * (1 + audio.beat * 0.8 + audio.treble * 0.3);
      ctx.lineCap = 'round';
      const alpha = Math.min(0.5, 0.1 + 0.14 * energy + 0.12 * audio.level);
      for (let i = 0; i < cols.length; i++) {
        const [r, g, b] = cols[i];
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.stroke(paths[i]);
      }
    },
    setQuality(q) {
      quality = q;
    },
    destroy() {
      parts = [];
    },
  };
};
