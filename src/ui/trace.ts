// Tracing (Convert to Figure, and structures made editable): the picture a structure is drawn
// from, shown faintly on it exactly where the picture was, to draw over. Its paper is taken out
// (white shows nothing) and its ink drawn at the opacity and in the tint chosen, under the
// structure, never clicked and never printed or saved with the drawing.

import type { TraceLook, TraceTint } from '../document/document';
import { showableSrc } from '../render/images';

/** Each tint's ink color (null: the picture's own colors). */
export const TINTS: Record<TraceTint, [number, number, number] | null> = {
  original: null,
  gray: [96, 96, 96],
  blue: [40, 110, 200],
  red: [205, 60, 50],
};

/**
 * The picture's pixels (RGBA, in place) as a tracing: the paper see-through, the ink as dark as
 * it was (times `opacity`), in the tint's color or its own.
 */
export function tracePixels(data: Uint8ClampedArray, tint: TraceTint, opacity: number): void {
  const t = TINTS[tint];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    // how much ink: white paper none, black ink all (colored ink as dark as it looks)
    const ink = a * (1 - lum);
    if (t) { data[i] = t[0]; data[i + 1] = t[1]; data[i + 2] = t[2]; }
    else if (ink > 0) {
      // the ink's own color, undiluted by the paper it was mixed with
      for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, Math.round(255 - (255 - data[i + k]) / Math.max(ink, 1e-3))));
    }
    data[i + 3] = Math.round(255 * Math.min(1, ink * opacity));
  }
}

/** The pictures loaded for tracing, by their source (a document's pictures are drawn often while tracing). */
const loaded = new Map<string, HTMLImageElement>();
const made = new Map<string, HTMLCanvasElement>();

/**
 * The tracing of a picture (`src`, cropped by `crop`) as a canvas, `w` × `h` pixels; null until
 * the picture has loaded (`ready` is called then, to draw again).
 */
export function traceImage(src: string, crop: { l: number; t: number; r: number; b: number } | undefined, look: TraceLook, w: number, h: number, ready: () => void): HTMLCanvasElement | null {
  const W = Math.max(1, Math.min(4096, Math.round(w))), H = Math.max(1, Math.min(4096, Math.round(h)));
  const c = crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const key = `${src.length}:${src.slice(-64)}|${c.l},${c.t},${c.r},${c.b}|${look.tint}|${look.opacity}|${W}x${H}`;
  const have = made.get(key);
  if (have) return have;
  let img = loaded.get(src);
  if (!img) {
    const show = showableSrc(src);
    if (!show) return null;
    img = new Image();
    img.onload = () => ready();
    img.src = show;
    loaded.set(src, img);
    if (loaded.size > 24) loaded.delete(loaded.keys().next().value!);
  }
  if (!img.complete || !img.naturalWidth) { if (img.complete) return null; img.addEventListener('load', () => ready(), { once: true }); return null; }
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  g.drawImage(img, c.l * iw, c.t * ih, Math.max(1e-3, (1 - c.l - c.r) * iw), Math.max(1e-3, (1 - c.t - c.b) * ih), 0, 0, W, H);
  try {
    const d = g.getImageData(0, 0, W, H);
    tracePixels(d.data, look.tint, look.opacity);
    g.putImageData(d, 0, 0);
  } catch {
    // (a picture the canvas may not read back: shown as it is, faintly)
    g.clearRect(0, 0, W, H);
    g.globalAlpha = look.opacity;
    g.drawImage(img, c.l * iw, c.t * ih, Math.max(1e-3, (1 - c.l - c.r) * iw), Math.max(1e-3, (1 - c.t - c.b) * ih), 0, 0, W, H);
  }
  made.set(key, out);
  if (made.size > 8) made.delete(made.keys().next().value!);
  return out;
}
