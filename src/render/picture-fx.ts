// Picture Format: brightness and contrast, sharpening, recolouring, see-through, Remove
// Background and cutting a picture to a shape, as PowerPoint and Word do them. The picture's
// own data stays as it was; what is shown is worked out from it and kept, keyed by the settings,
// so a picture is only worked out again when a setting changes. The pixel work is plain
// functions on RGBA pixels (top row first), so it can be tested without a browser.

import type { BackgroundRemoval, PictureFx, Recolor } from '../model';
import { geoDef, moveSteps, traceSteps } from '../design/geo';
import { dataUrl, imageFor, loadImage, paintTurn } from './images';

type Px = Uint8ClampedArray | Uint8Array;

/** PowerPoint's sepia: black in the shadows to a warm light brown in the highlights. */
export const SEPIA_LIGHT = '#efdcbc';
/** Washout (PowerPoint's): much brighter, much less contrast. */
export const WASHOUT = { bright: 0.7, contrast: -0.7 };
/** How near a colour counts for Remove Background unless chosen. */
export const BG_TOL = 0.12;

/** Settings worth showing: none of them left at their resting value. */
export function tidyFx(fx: PictureFx | undefined): PictureFx | undefined {
  if (!fx) return undefined;
  const out: PictureFx = {};
  const num = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && Math.abs(v) > 1e-4 ? Math.max(-1, Math.min(1, v)) : undefined);
  const b = num(fx.bright), c = num(fx.contrast), s = num(fx.sharpen);
  if (b !== undefined) out.bright = b;
  if (c !== undefined) out.contrast = c;
  if (s !== undefined) out.sharpen = s;
  if (fx.recolor) out.recolor = fx.recolor;
  if (fx.alpha && fx.alpha > 1e-4) out.alpha = Math.min(1, fx.alpha);
  if (fx.clear) out.clear = fx.clear;
  if (fx.bg) out.bg = fx.bg;
  if (fx.shape && fx.shape !== 'rect') out.shape = fx.shape;
  return Object.keys(out).length ? out : undefined;
}

/** True when the picture is shown changed. */
export const hasFx = (fx: PictureFx | undefined): fx is PictureFx => !!tidyFx(fx);

/** The settings PowerPoint and Word keep worked into the picture itself (they can't redo them on the fly). */
export function bakedPart(fx: PictureFx | undefined): PictureFx | undefined {
  return tidyFx(fx && { sharpen: fx.sharpen, bg: fx.bg });
}

// ---------------------------------------------------------------- colours

/** #rrggbb as [r, g, b] (black when it can't be read). */
export function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Lightness as Office's greyscale works it out. */
const luma = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------------------------------------------------------------- pixel work

/**
 * Brightness and contrast, in place, as Office draws a:lum (office sampler F-V-06): contrast
 * stretches round the middle grey by 128 / (128 - 127c) for more (c > 0) and (128 + 127c) / 128 for
 * less, with half the brightness added before it and half after, as Office does; LibreOffice's
 * way of showing Office's pictures as Office does (vcl, Bitmap::Adjust, its Office brightness),
 * where a steeper curve made pictures too strong (and Washout blank white).
 */
export function brightContrast(d: Px, bright = 0, contrast = 0): void {
  if (!bright && !contrast) return;
  const c = Math.max(-1, Math.min(1, contrast));
  const k = c >= 0 ? 128 / (128 - 127 * c) : (128 + 127 * c) / 128;
  const add = bright * 255;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = clamp255((v + add / 2 - 128) * k + 128 + add / 2);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

/** The colours changed as chosen, in place. */
export function recolor(d: Px, rc: Recolor): void {
  if (rc.kind === 'washout') { brightContrast(d, WASHOUT.bright, WASHOUT.contrast); return; }
  const tint = rc.kind === 'sepia' ? { dark: [0, 0, 0], light: rgbOf(SEPIA_LIGHT) } : rc.kind === 'tint' ? { dark: rgbOf(rc.dark), light: rgbOf(rc.light) } : null;
  const cut = rc.kind === 'bw' ? 255 * (rc.level ?? 0.5) : 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = luma(d[i], d[i + 1], d[i + 2]);
    if (rc.kind === 'grey') {
      d[i] = d[i + 1] = d[i + 2] = y;
    } else if (rc.kind === 'bw') {
      d[i] = d[i + 1] = d[i + 2] = y >= cut ? 255 : 0;
    } else if (tint) {
      const t = y / 255;
      d[i] = tint.dark[0] + (tint.light[0] - tint.dark[0]) * t;
      d[i + 1] = tint.dark[1] + (tint.light[1] - tint.dark[1]) * t;
      d[i + 2] = tint.dark[2] + (tint.light[2] - tint.dark[2]) * t;
    }
  }
}

/** The whole picture made see-through by `amount` (0 to 1), in place. */
export function fade(d: Px, amount: number): void {
  if (amount <= 0) return;
  const k = 1 - Math.min(1, amount);
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] * k;
}

/** One colour (and colours within a few steps of it) made see-through, in place. Returns how many pixels. */
export function clearColour(d: Px, hex: string, tol = 10): number {
  const [r, g, b] = rgbOf(hex);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - r) <= tol && Math.abs(d[i + 1] - g) <= tol && Math.abs(d[i + 2] - b) <= tol && d[i + 3]) { d[i + 3] = 0; n++; }
  }
  return n;
}

/**
 * Each colour channel averaged over a 3 × 3 square (edges repeat), handed over a row at a time
 * (`each(y, row)`, the row's RGBA with the blurred colours) so only three rows are held, not two
 * copies of the whole picture. `each` may change rows of `d` up to and including `y`: the rows
 * still to be read are below it.
 */
function blurRows(d: Px, w: number, h: number, each: (y: number, row: Float32Array) => void): void {
  const stride = w * 4;
  const across = (y: number, into: Float32Array) => {
    const o = y * stride;
    for (let x = 0; x < w; x++) {
      const i = o + x * 4, l = o + Math.max(0, x - 1) * 4, r = o + Math.min(w - 1, x + 1) * 4;
      for (let k = 0; k < 3; k++) into[x * 4 + k] = (d[l + k] + d[i + k] + d[r + k]) / 3;
    }
  };
  // the rows above, at and below the one being worked out, blurred across
  let up = new Float32Array(stride), mid = new Float32Array(stride), down = new Float32Array(stride);
  const out = new Float32Array(stride);
  across(0, mid);
  up.set(mid);
  for (let y = 0; y < h; y++) {
    if (y + 1 < h) across(y + 1, down); else down.set(mid);
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) { const i = x * 4 + k; out[i] = (up[i] + mid[i] + down[i]) / 3; }
    each(y, out);
    const t = up; up = mid; mid = down; down = t;
  }
}

/** Sharper (amount up to 1, an unsharp mask) or softer (down to -1, blurred), in place. */
export function sharpen(d: Px, w: number, h: number, amount: number): void {
  if (!amount || w < 2 || h < 2) return;
  const k = amount > 0 ? amount * 2 : amount;
  const apply = (y: number, b: Float32Array) => {
    const o = y * w * 4;
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) { const i = o + x * 4 + c; d[i] = clamp255(d[i] + k * (d[i] - b[x * 4 + c])); }
    }
  };
  if (amount > 0) { blurRows(d, w, h, apply); return; }
  // softening goes further than one pass of the small blur: blurred once (in whole steps), then again
  const once = new Uint8ClampedArray(d.length);
  blurRows(d, w, h, (y, row) => once.set(row, y * w * 4));
  blurRows(once, w, h, apply);
}

/** A part of the picture in pixels: x0, y0 inclusive, x1, y1 exclusive. */
export interface PxRect { x0: number; y0: number; x1: number; y1: number }

/**
 * Remove Background, in place: the colours most common round the edge of `area` (the part of the
 * picture shown) are the background, and every pixel joined to them through colours near them
 * goes; so do those joined to a `drop` mark. Pixels joined to a `keep` mark stay. The edge
 * between what stays and what goes is softened by a pixel. Returns how many pixels went.
 */
export function removeBackground(d: Px, w: number, h: number, bg: BackgroundRemoval, area: PxRect = { x0: 0, y0: 0, x1: w, y1: h }): number {
  const tol = Math.max(0.005, Math.min(1, bg.tol ?? BG_TOL)) * 441.7;
  const x0 = Math.max(0, Math.floor(area.x0)), y0 = Math.max(0, Math.floor(area.y0));
  const x1 = Math.min(w, Math.ceil(area.x1)), y1 = Math.min(h, Math.ceil(area.y1));
  if (x1 - x0 < 1 || y1 - y0 < 1) return 0;
  const near = (i: number, r: number, g: number, b: number) => {
    const dr = d[i * 4] - r, dg = d[i * 4 + 1] - g, db = d[i * 4 + 2] - b;
    return dr * dr + dg * dg + db * db <= tol * tol;
  };
  // marks are fractions of the whole picture (as Office keeps them), kept inside the part shown
  const at = (fx: number, fy: number) => {
    const x = Math.max(x0, Math.min(x1 - 1, Math.floor(fx * w))), y = Math.max(y0, Math.min(y1 - 1, Math.floor(fy * h)));
    return y * w + x;
  };
  const n = w * h;
  // flood from seeds through pixels near each seed's own colour; `mark` says which flood got a pixel.
  // `ref` is the seed each pixel was reached from, or CLEAR for a see-through seed: that flood
  // only goes through see-through pixels, never into the picture's own colours (a transparent
  // pixel's colour is usually black, which would eat black ink next to it). One buffer serves
  // both floods: a flood only reads what it wrote itself.
  const CLEAR = -2;
  const ref = new Int32Array(n);
  const stack: number[] = [];
  const flood = (mark: Uint8Array, seeds: number[], stop: Uint8Array | null) => {
    for (const s of seeds) if (!mark[s] && !(stop && stop[s])) { mark[s] = 1; ref[s] = d[s * 4 + 3] < 8 ? CLEAR : s; stack.push(s); }
    while (stack.length) {
      const i = stack.pop()!;
      const from = ref[i], clear = from === CLEAR;
      const o = clear ? 0 : from * 4, r = d[o], g = d[o + 1], b = d[o + 2];
      const x = i % w, y = (i - x) / w;
      for (let t = 0; t < 4; t++) {
        let j: number;
        if (t === 0) { if (x <= x0) continue; j = i - 1; }
        else if (t === 1) { if (x >= x1 - 1) continue; j = i + 1; }
        else if (t === 2) { if (y <= y0) continue; j = i - w; }
        else { if (y >= y1 - 1) continue; j = i + w; }
        if (mark[j] || (stop && stop[j])) continue;
        if (d[j * 4 + 3] === 0 || (!clear && near(j, r, g, b))) { mark[j] = 1; ref[j] = from; stack.push(j); }
      }
    }
  };
  const keep = new Uint8Array(n);
  if (bg.keep?.length) flood(keep, bg.keep.map(([fx, fy]) => at(fx, fy)), null);
  // the background's colours: those that cover a good share of the edge
  const edge: number[] = [];
  for (let x = x0; x < x1; x++) { edge.push(y0 * w + x); if (y1 - 1 > y0) edge.push((y1 - 1) * w + x); }
  for (let y = y0 + 1; y < y1 - 1; y++) { edge.push(y * w + x0); if (x1 - 1 > x0) edge.push(y * w + x1 - 1); }
  const bins = new Map<number, number>();
  const bin = (i: number) => (d[i * 4 + 3] < 8 ? -1 : ((d[i * 4] >> 4) << 8) | ((d[i * 4 + 1] >> 4) << 4) | (d[i * 4 + 2] >> 4));
  for (const i of edge) bins.set(bin(i), (bins.get(bin(i)) ?? 0) + 1);
  const common = [...bins].filter(([k, c]) => k >= 0 && c >= edge.length * 0.1).map(([k]) => [((k >> 8) & 15) * 16 + 8, ((k >> 4) & 15) * 16 + 8, (k & 15) * 16 + 8]);
  const seeds = edge.filter((i) => d[i * 4 + 3] < 8 || common.some(([r, g, b]) => near(i, r, g, b)));
  for (const [fx, fy] of bg.drop ?? []) seeds.push(at(fx, fy));
  const gone = new Uint8Array(n);
  flood(gone, seeds, keep);
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (gone[i]) {
        if (d[i * 4 + 3]) count++;
        d[i * 4 + 3] = 0;
      }
    }
  }
  // a soft edge: what stays beside what went is half see-through
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (gone[i]) continue;
      const by = (x > x0 && gone[i - 1]) || (x < x1 - 1 && gone[i + 1]) || (y > y0 && gone[i - w]) || (y < y1 - 1 && gone[i + w]);
      if (by) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * 0.6);
    }
  }
  return count;
}

/**
 * Every setting but the shape worked into the pixels, in place, in the order PowerPoint works
 * them: Remove Background and sharpening (kept in the picture), then the see-through colour,
 * brightness and contrast, the new colours and the see-through amount.
 */
export function applyFx(d: Px, w: number, h: number, fx: PictureFx, area?: PxRect, only?: 'baked' | 'live'): void {
  if (only !== 'live') {
    if (fx.bg) removeBackground(d, w, h, fx.bg, area);
    if (fx.sharpen) sharpen(d, w, h, fx.sharpen);
  }
  if (only === 'baked') return;
  if (fx.clear) clearColour(d, fx.clear);
  brightContrast(d, fx.bright ?? 0, fx.contrast ?? 0);
  if (fx.recolor) recolor(d, fx.recolor);
  if (fx.alpha) fade(d, fx.alpha);
}

// ---------------------------------------------------------------- the shapes

/** The shapes a picture can be cut to (Crop to Shape), by PowerPoint's names, with ours for them. */
export const PICTURE_SHAPES: { prst: string; name: string }[] = [
  { prst: 'rect', name: 'Rectangle' },
  { prst: 'roundRect', name: 'Rounded rectangle' },
  { prst: 'ellipse', name: 'Oval' },
  { prst: 'triangle', name: 'Triangle' },
  { prst: 'rtTriangle', name: 'Right triangle' },
  { prst: 'diamond', name: 'Diamond' },
  { prst: 'parallelogram', name: 'Parallelogram' },
  { prst: 'trapezoid', name: 'Trapezoid' },
  { prst: 'pentagon', name: 'Pentagon' },
  { prst: 'hexagon', name: 'Hexagon' },
  { prst: 'octagon', name: 'Octagon' },
  { prst: 'star5', name: 'Star' },
  { prst: 'plus', name: 'Cross' },
  { prst: 'heart', name: 'Heart' },
  { prst: 'cloud', name: 'Cloud' },
  { prst: 'chevron', name: 'Chevron' },
  { prst: 'homePlate', name: 'Pentagon arrow' },
  { prst: 'rightArrow', name: 'Right arrow' },
];

/** The library's shape for one of PowerPoint's preset names (null for a rectangle, or one we don't draw). */
export function shapeDef(prst: string | undefined): ReturnType<typeof geoDef> | null {
  if (!prst || prst === 'rect') return null;
  const def = geoDef(prst);
  return def.prst === prst ? def : null;
}

/** True when a picture can be cut to PowerPoint's preset shape of this name. */
export const knownShape = (prst: string): boolean => prst === 'rect' || !!shapeDef(prst);

/** The outline of the shape a picture is cut to, on a canvas (or anything drawn like one), filling x, y, w, h. */
export function traceShape(ctx: Parameters<typeof traceSteps>[0], prst: string, x: number, y: number, w: number, h: number): boolean {
  const def = shapeDef(prst);
  if (!def) return false;
  traceSteps(ctx, moveSteps(def.draw(w, h).body, x, y));
  return true;
}

// ---------------------------------------------------------------- shown pictures

/** What a picture's showing depends on. */
interface FxPicture { src?: string; fx?: PictureFx; crop?: { l: number; t: number; r: number; b: number }; px?: { w: number; h: number } }

interface Made { canvas: HTMLCanvasElement; url?: string; /** The paint it was last used in (see `paintTurn`). */ used: number }
/**
 * Pictures worked out, by their data, then by their settings: both most recently used last, so
 * the oldest go first. What they hold together is kept under a number of pixels, not a number of
 * canvases (one large photo takes as much as many small pictures), and nothing used in the paint
 * going on now is let go, so a page or slide strip with many pictures doesn't redo them all on
 * every repaint.
 */
const made = new Map<string, Map<string, Made>>();
let held = 0;
/** About 256 MB of canvases. */
const KEEP_PIXELS = 64 * 1024 * 1024;
/** Versions kept of one picture (a slider makes one per step). */
const VERSIONS = 5;

const pixelsOf = (m: Made) => m.canvas.width * m.canvas.height;

function keyOf(p: FxPicture, fx: PictureFx, side: number): string {
  const c = p.crop;
  return `${side}|${JSON.stringify(fx)}|${c ? [c.l, c.t, c.r, c.b].join() : ''}`;
}

/** Biggest side a picture is worked on at for files (larger ones are shrunk first). */
const MAX_SIDE = 4096;
/** Biggest side a picture is worked on at to be shown on the screen (more than a screen shows of it). */
const SHOW_SIDE = 2048;

/** The size a picture is worked on at, in pixels. */
function workSize(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap, p: FxPicture, side: number): { w: number; h: number } {
  let iw = (img as HTMLImageElement).naturalWidth || img.width || p.px?.w || 1;
  let ih = (img as HTMLImageElement).naturalHeight || img.height || p.px?.h || 1;
  // a vector picture (SVG) is drawn at its saved pixel size, or twice its own
  if (/^data:image\/(svg|x-emf)/.test(p.src ?? '')) {
    const k = Math.max(1, (p.px?.w ?? iw * 2) / iw);
    iw *= k; ih *= k;
  }
  const k = Math.min(1, side / Math.max(iw, ih));
  return { w: Math.max(1, Math.round(iw * k)), h: Math.max(1, Math.round(ih * k)) };
}

/** The picture worked out on a new canvas from its loaded image (at most `side` pixels a side). */
export function makeFxCanvas(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap, p: FxPicture, fx: PictureFx, only?: 'baked' | 'live', side = MAX_SIDE): HTMLCanvasElement {
  const { w, h } = workSize(img, p, side);
  return workOn(img, w, h, p, fx, only);
}

/** `img` drawn at w × h on a new canvas with the settings `only` says worked in. */
function workOn(img: CanvasImageSource, w: number, h: number, p: FxPicture, fx: PictureFx, only?: 'baked' | 'live'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const cr = p.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const area = { x0: cr.l * w, y0: cr.t * h, x1: (1 - cr.r) * w, y1: (1 - cr.b) * h };
  const live = only === 'live' || (only === undefined && !bakedPart(fx));
  if (only === 'baked' || !live || fx.clear || fx.bright || fx.contrast || fx.recolor || fx.alpha) {
    const data = g.getImageData(0, 0, w, h);
    applyFx(data.data, w, h, fx, area, only);
    g.putImageData(data, 0, 0);
  }
  if (only !== 'baked' && fx.shape && shapeDef(fx.shape)) {
    // cut to the shape: only what is inside its outline (filling the part shown) stays
    g.globalCompositeOperation = 'destination-in';
    g.beginPath();
    traceShape(g, fx.shape, area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}

/** Keep `m` as the newest version of `key` of the picture `mine` holds. */
function remember(mine: Map<string, Made>, key: string, m: Made): void {
  const old = mine.get(key);
  if (old) { held -= pixelsOf(old); mine.delete(key); }
  mine.set(key, m);
  held += pixelsOf(m);
}

/** Let the oldest versions go: past VERSIONS of one picture, then past KEEP_PIXELS in all (never one used in this paint). */
function forget(mine: Map<string, Made>, now: number): void {
  for (const [key, m] of mine) {
    if (mine.size <= VERSIONS) break;
    if (m.used === now) continue;
    mine.delete(key);
    held -= pixelsOf(m);
  }
  for (const [src, list] of made) {
    if (held <= KEEP_PIXELS) break;
    for (const [key, m] of list) {
      if (held <= KEEP_PIXELS) break;
      if (m.used === now) continue;
      list.delete(key);
      held -= pixelsOf(m);
    }
    if (!list.size) made.delete(src);
  }
}

/** A version of the picture, kept or worked out now; `make` works it out. */
function version(mine: Map<string, Made>, key: string, now: number, make: () => HTMLCanvasElement): Made {
  const got = mine.get(key);
  if (got) {
    // used now: last to be forgotten
    mine.delete(key);
    mine.set(key, got);
    got.used = now;
    return got;
  }
  const m: Made = { canvas: make(), used: now };
  remember(mine, key, m);
  return m;
}

function find(p: FxPicture, fx: PictureFx, side: number): Made | null {
  if (typeof document === 'undefined' || !p.src) return null;
  const now = paintTurn();
  let mine = made.get(p.src);
  // used now, hit or miss: this picture is the last to be forgotten
  if (mine) made.delete(p.src);
  made.set(p.src, (mine ??= new Map()));
  const key = keyOf(p, fx, side);
  if (mine.has(key)) return version(mine, key, now, () => mine.get(key)!.canvas);
  const img = imageFor(p.src);
  if (!img) { if (!mine.size) made.delete(p.src); return null; }
  let m: Made;
  try {
    const baked = bakedPart(fx);
    if (baked) {
      // Remove Background and sharpening, worked out once and kept, with the quick settings
      // (brightness, contrast, colours, see-through, the shape) worked on a copy of it each time
      const b = version(mine, `baked|${keyOf(p, baked, side)}`, now, () => makeFxCanvas(img, p, baked, 'baked', side));
      m = version(mine, key, now, () => workOn(b.canvas, b.canvas.width, b.canvas.height, p, fx, 'live'));
    } else m = version(mine, key, now, () => makeFxCanvas(img, p, fx, undefined, side));
  } catch {
    if (!mine.size) made.delete(p.src);
    return null;
  }
  forget(mine, now);
  return m;
}

/** The picture as shown (a canvas the same size as its image), or null when it is shown as it is or hasn't loaded. */
export function fxCanvas(p: FxPicture): HTMLCanvasElement | null {
  const fx = tidyFx(p.fx);
  return fx ? find(p, fx, SHOW_SIDE)?.canvas ?? null : null;
}

/** The picture as shown, as a PNG data URL (its own data when unchanged or not loaded yet). */
export function fxSrc(p: FxPicture): string | undefined {
  const fx = tidyFx(p.fx);
  if (!fx || !p.src) return p.src;
  // for pictures in files and copies: at full size
  const m = find(p, fx, MAX_SIDE);
  if (!m) return p.src;
  m.url ??= m.canvas.toDataURL('image/png');
  return m.url;
}

/** The picture with only the settings `only` says worked in, as PNG bytes, once its image has loaded (null with nothing to do). */
export async function fxPng(p: FxPicture, only?: 'baked' | 'live'): Promise<Uint8Array | null> {
  const fx = only === 'baked' ? bakedPart(p.fx) : tidyFx(p.fx);
  if (!fx || !p.src || typeof document === 'undefined') return null;
  const img = await loadImage(p.src);
  const c = makeFxCanvas(img, p, fx, only);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** The picture as shown, as a data URL, once loaded (for exports, which can wait). */
export async function fxSrcAsync(p: FxPicture): Promise<string | undefined> {
  if (!hasFx(p.fx) || !p.src) return p.src;
  const png = await fxPng(p).catch(() => null);
  return png ? dataUrl(png, 'image/png') : p.src;
}
