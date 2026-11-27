// Pictures on the page: each image is decoded once and kept, keyed by its data. Drawing asks
// for an image and gets it when it is ready; until then the picture shows as a grey box, and
// a redraw is asked for when it arrives. Windows metafiles (EMF, from MestReNova, Excel and
// Office) are kept as they are, and shown through an SVG copy so they stay sharp.

import { emfToSvg, emfSize } from './emf-read';

interface Entry { img: HTMLImageElement; ready: boolean; failed: boolean; /** The turn it was last asked for in (see `paintTurn`). */ used?: number }

let turn = 0, turnEnding = false;
/**
 * A count that goes up once the code running now has finished. A paint runs all at once, so
 * what was asked for in this turn is on the screen now and must not be forgotten for room: that
 * would load it again, redraw, and forget another, round and round.
 */
export function paintTurn(): number {
  if (!turnEnding) {
    turnEnding = true;
    void Promise.resolve().then(() => { turn++; turnEnding = false; });
  }
  return turn;
}

const cache = new Map<string, Entry>();
/** Pictures are forgotten, least recently drawn first, once their data passes `keepChars` characters (decoded again if needed; tests set it lower). */
export const imageCache = { keepChars: 150_000_000 };

function forgetOld(now: number): void {
  let total = 0;
  for (const k of cache.keys()) total += k.length;
  for (const [k, e] of cache) {
    if (total <= imageCache.keepChars || cache.size <= 1) break;
    // (one drawn in this paint stays, even past the limit)
    if (e.used === now) continue;
    total -= k.length;
    cache.delete(k);
    shown.delete(k);
  }
}
const listeners: (() => void)[] = [];

/** Call `fn` whenever a picture finishes loading (to redraw). */
export function onImageReady(fn: () => void): () => void {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}

const shown = new Map<string, string | null>();

/** What a browser can show for a picture: EMF pictures become SVG (null when that can't be done). */
export function showableSrc(src: string): string | null {
  if (!src.startsWith('data:image/x-emf')) return src;
  let s = shown.get(src);
  if (s === undefined) {
    try {
      const svg = emfToSvg(fromDataUrl(src).bytes);
      s = svg ? dataUrl(new TextEncoder().encode(svg.svg), 'image/svg+xml') : null;
    } catch {
      s = null;
    }
    shown.set(src, s);
  }
  return s;
}

/** Whether a picture is still loading (starting it when it hasn't been asked for yet): false once it is ready or has failed. */
export function imageLoading(src: string): boolean {
  if (imageFor(src)) return false;
  const e = cache.get(src);
  return !!e && !e.failed && typeof Image !== 'undefined';
}

/** The decoded image, or null while it loads (or when it can't be shown). */
export function imageFor(src: string): HTMLImageElement | null {
  const now = paintTurn();
  let e = cache.get(src);
  if (e) {
    // used now: last to be forgotten
    cache.delete(src);
    cache.set(src, e);
    e.used = now;
  } else {
    forgetOld(now);
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    e = { img, ready: false, failed: false, used: now };
    cache.set(src, e);
    const entry = e;
    img.onload = () => { entry.ready = true; for (const f of listeners) f(); };
    img.onerror = () => { entry.failed = true; };
    const s = showableSrc(src);
    if (s) img.src = s; else entry.failed = true;
  }
  return e.ready ? e.img : null;
}

const rasters = new Map<string, string | null>();

/**
 * A picture the browser has already decoded (an SVG equation, a WebP photo) as a PNG data URL,
 * about `w` by `h` pixels, for files that hold only some picture types (ChemDraw's). Null while
 * it is still loading, or when it can't be drawn. Made at once, so a save or copy needs no wait.
 */
export function rasterPng(src: string, w: number, h: number, background?: string): string | null {
  const key = `${Math.round(w)}x${Math.round(h)}:${background ?? ''}:${src}`;
  if (rasters.has(key)) return rasters.get(key)!;
  const img = imageFor(src);
  if (!img || typeof document === 'undefined') return null;
  let out: string | null = null;
  try {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const ctx = c.getContext('2d');
    if (ctx) {
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/png');
    }
    if (!out?.startsWith('data:image/png')) out = null;
  } catch {
    out = null;
  }
  // (only the last few are kept: they are big)
  if (rasters.size > 20) rasters.delete(rasters.keys().next().value!);
  rasters.set(key, out);
  return out;
}

/** True when a picture's data could not be read as an image. */
export function imageFailed(src: string): boolean {
  return cache.get(src)?.failed ?? false;
}

/** Load a picture and wait for it. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!cache.has(src)) cache.set(src, { img, ready: true, failed: false });
      resolve(img);
    };
    img.onerror = () => reject(new Error('This picture could not be read'));
    const s = showableSrc(src);
    if (s) img.src = s; else reject(new Error('This picture could not be read'));
  });
}

/** Bytes as a data URL. */
export function dataUrl(bytes: Uint8Array, mime: string): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(s)}`;
}

/** The bytes and type of a data URL. */
export function fromDataUrl(src: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) throw new Error('Not a data URL');
  const mime = m[1];
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, bytes };
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
}

const BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
  svg: 'image/svg+xml', emf: 'image/x-emf', tif: 'image/tiff', tiff: 'image/tiff',
};

/**
 * A WebP picture as PNG (Word and PowerPoint files can't hold WebP), drawn by the browser.
 * Null when it can't be read.
 */
export async function webpToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  return bitmapToPng(bytes, 'image/webp');
}

/** A picture the browser can draw (WebP, GIF, BMP...) as PNG. Null when it can't be read. */
export async function bitmapToPng(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    // (a canvas element where there is no OffscreenCanvas)
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    (c.getContext('2d') as CanvasRenderingContext2D).drawImage(bmp, 0, 0);
    bmp.close();
    const blob = 'convertToBlob' in c ? await c.convertToBlob({ type: 'image/png' }) : await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('no picture'))), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** A picture file's type, from its first bytes, or else from its name. Null when it isn't a picture. */
export function pictureMime(name: string, b: Uint8Array): string | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x42, 0x4d)) return 'image/bmp';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  // a Windows enhanced metafile: record type 1, then " EMF" 40 bytes in
  if (at(0, 1, 0, 0, 0) && at(40, 0x20, 0x45, 0x4d, 0x46)) return 'image/x-emf';
  if (/<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 2000)))) return 'image/svg+xml';
  return BY_EXTENSION[name.toLowerCase().split('.').pop() ?? ''] ?? null;
}

/** A picture's size in pixels, from its header. */
export function imageSize(b: Uint8Array, mime: string): { w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (mime === 'image/png' && b.length >= 24) return { w: dv.getUint32(16), h: dv.getUint32(20) };
    if (mime === 'image/gif' && b.length > 10) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
    if (mime === 'image/bmp' && b.length > 26) return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + dv.getUint16(i + 2);
      }
    }
    if (mime === 'image/x-emf' && b.length > 40) {
      // its intended size (the frame, in hundredths of a millimetre), as pixels at 96 per inch
      const pt = emfSize(b);
      if (pt) return { w: Math.round(pt.w / 0.75), h: Math.round(pt.h / 0.75) };
      const w = dv.getInt32(16, true) - dv.getInt32(8, true), h = dv.getInt32(20, true) - dv.getInt32(12, true);
      if (w > 0 && h > 0) return { w, h };
    }
    if (mime === 'image/svg+xml') return svgSize(new TextDecoder().decode(b.subarray(0, 2000)));
  } catch {
    return null;
  }
  return null;
}

/** CSS pixels in one of each unit an SVG's width and height may be given in (CSS Values and Units, 96 px to the inch). */
const PX_PER: Record<string, number> = { '': 1, px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };

/**
 * An SVG's size in pixels, from its root's start tag: its width and height, in their units, as
 * browsers size it (SVG 2, the outermost svg element's width and height), with the viewBox giving
 * the shape where only one of them is given, and the size where neither is (or they are
 * percentages, which need a page to mean anything).
 */
function svgSize(t: string): { w: number; h: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(t)?.[0] ?? t;
  const length = (m: RegExpExecArray | null): number | null => {
    if (!m) return null;
    const k = PX_PER[m[2].toLowerCase()];
    const v = Number(m[1]) * (k ?? NaN);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const vb = /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i.exec(tag);
  const vw = vb ? Number(vb[1]) : NaN, vh = vb ? Number(vb[2]) : NaN;
  const shape = vw > 0 && vh > 0 ? vh / vw : NaN;
  const w = length(/\swidth\s*=\s*["']\s*([\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*["']/i.exec(tag));
  const h = length(/\sheight\s*=\s*["']\s*([\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*["']/i.exec(tag));
  if (w && h) return { w, h };
  if (w && shape) return { w, h: w * shape };
  if (h && shape) return { w: h / shape, h };
  if (shape) return { w: vw, h: vh };
  return null;
}
