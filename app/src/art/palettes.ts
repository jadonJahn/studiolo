export interface Palette {
  id: string;
  name: string;
  bg: string;
  colors: [string, string, string, string, string];
}

export const PALETTES: Palette[] = [
  { id: 'midnight', name: 'Midnight', bg: '#06060e', colors: ['#3b2f9e', '#6c63ff', '#3ec5ff', '#c56cff', '#f2efff'] },
  { id: 'ember', name: 'Ember', bg: '#0c0504', colors: ['#7a1f12', '#e63946', '#ff6b35', '#f7c548', '#fff1e0'] },
  { id: 'lagoon', name: 'Lagoon', bg: '#020c0c', colors: ['#0b4f4a', '#1d7874', '#00b4a6', '#57e2c8', '#e6fff8'] },
  { id: 'bloom', name: 'Bloom', bg: '#0e050d', colors: ['#5a189a', '#c77dff', '#fb6f92', '#ff8fab', '#ffe5ec'] },
  { id: 'moss', name: 'Moss', bg: '#060904', colors: ['#31572c', '#4f772d', '#90a955', '#ecf39e', '#f7f3e3'] },
  { id: 'dusk', name: 'Dusk', bg: '#0a0614', colors: ['#3a2c7a', '#7a5cff', '#ff7eb6', '#ffb86b', '#fff3c4'] },
  { id: 'glacier', name: 'Glacier', bg: '#04070d', colors: ['#1b3a5c', '#3d6e9e', '#7fb7e6', '#c3e4ff', '#ffffff'] },
  { id: 'mono', name: 'Graphite', bg: '#080808', colors: ['#2e2e2e', '#5c5c5c', '#9a9a9a', '#cfcfcf', '#ffffff'] },
];

export function getPalette(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Sample a palette as a smooth gradient, t in [0,1]. */
export function samplePalette(cols: [number, number, number][], t: number): [number, number, number] {
  const x = Math.min(0.9999, Math.max(0, t)) * (cols.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = cols[i];
  const b = cols[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
