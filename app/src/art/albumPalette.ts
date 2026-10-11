import { PALETTES, type Palette } from './palettes';

type RGB = [number, number, number];

const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function hsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function rgb(h: number, s: number, l: number): RGB {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/** Five dominant colors via a few rounds of k-means on a 32×32 thumbnail. */
function cluster(px: RGB[], k: number): RGB[] {
  const sorted = [...px].sort((a, b) => lum(a) - lum(b));
  let centers: RGB[] = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)]);
  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let best = 0;
      let bd = Infinity;
      centers.forEach((c, i) => {
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      const s = sums[best];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    }
    centers = centers.map((c, i) => (sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : c));
  }
  return centers;
}

const cache = new Map<string, string>();

/**
 * Builds (and registers) a palette from album artwork. Colors are pushed toward
 * vivid mid/high lightness so they read on the dark canvas; the background is a
 * very dark tint of the dominant hue.
 */
export async function paletteFromArt(dataUrl: string, key: string): Promise<string> {
  const id = `np:${key}`;
  if (cache.has(id)) return id;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  const px: RGB[] = [];
  for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
  const centers = cluster(px, 6);

  // Most saturated hue anchors the background tint.
  const byChroma = [...centers].sort((a, b) => hsl(b)[1] * (1 - Math.abs(hsl(b)[2] - 0.5)) - hsl(a)[1] * (1 - Math.abs(hsl(a)[2] - 0.5)));
  const [bh, bs] = hsl(byChroma[0]);
  const bg = hex(rgb(bh, Math.min(0.5, bs), 0.035));

  const colors = byChroma
    .slice(0, 5)
    .map((c) => {
      const [h, s, l] = hsl(c);
      return { h, s: s < 0.08 ? s : Math.min(1, Math.max(s, 0.5) * 1.15), l: Math.min(0.85, Math.max(0.5, l)) };
    })
    .sort((a, b) => a.l - b.l)
    .map(({ h, s, l }, i) => hex(rgb(h, s, Math.min(0.9, l * (0.75 + i * 0.08))))) as Palette['colors'];

  const palette: Palette = { id, name: 'Album', bg, colors };
  for (let i = PALETTES.length - 1; i >= 0; i--) if (PALETTES[i].id.startsWith('np:')) PALETTES.splice(i, 1);
  PALETTES.push(palette);
  cache.clear();
  cache.set(id, id);
  return id;
}
