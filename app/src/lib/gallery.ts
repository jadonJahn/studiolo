import { createStore, del, entries, set } from 'idb-keyval';
import type { ArtStyleId } from '../types';

const db = createStore('flowstate-gallery', 'art');

export interface Artwork {
  id: string; // = session id
  title: string;
  createdAt: number;
  style: ArtStyleId;
  palette: string;
  seed: number;
  activityId?: string;
  durationMs: number;
  intent?: string;
  blob: Blob;
}

export async function saveArtwork(a: Artwork): Promise<void> {
  await set(a.id, a, db);
}

export async function listArtworks(): Promise<Artwork[]> {
  const all = await entries<string, Artwork>(db);
  return all.map(([, v]) => v).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteArtwork(id: string): Promise<void> {
  await del(id, db);
}

/* The live art canvas registers itself here so a finished piece can be captured. */
let liveCanvas: HTMLCanvasElement | null = null;
export const registerCanvas = (c: HTMLCanvasElement | null) => {
  liveCanvas = c;
};
export const isLiveCanvas = (c: HTMLCanvasElement) => liveCanvas === c;

/** Snapshot synchronously (before the next frame changes anything), encode async. */
export function captureArt(maxW = 1920): Promise<Blob | null> {
  const c = liveCanvas;
  if (!c || !c.width || !c.height) return Promise.resolve(null);
  const cssW = c.clientWidth || c.width;
  const cssH = c.clientHeight || c.height;
  const scale = Math.min(1, maxW / cssW);
  const off = document.createElement('canvas');
  off.width = Math.round(cssW * scale);
  off.height = Math.round(cssH * scale);
  off.getContext('2d')!.drawImage(c, 0, 0, off.width, off.height);
  return new Promise((resolve) => off.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
}
