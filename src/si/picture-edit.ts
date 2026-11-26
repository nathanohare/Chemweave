// Picture Format ▸ Crop and Rotate on an SI project's figure. SI Assistant draws a figure from its
// picture file and knows nothing of cropping or turning, so the edited picture is saved as a file
// of its own beside the original ("<name> (edited).png"), and the figure points at it: Chemweave
// and SI Assistant print the same picture. The figure's entry keeps how it was edited, under a
// key of Chemweave's own that SI Assistant keeps as it is:
//
//   "chemweave_picture": {"original": "images/photo.jpg", "rotate": 0-3 (quarter turns to the right),
//                          "flip": true (flipped left to right before turning),
//                          "crop": {"l", "t", "r", "b"} (fractions cut off each side of the turned picture)}
//
// Each edit is made again from the original, so cropping, turning and cropping again loses
// nothing; Reset Picture points the figure back at the original. A picture drawn as SVG stays
// SVG (its drawing turned in a group, the crop as its view box); a photo is saved as PNG at the
// original's resolution, so it prints the same size.

export const EDIT_KEY = 'chemweave_picture';

export type Quarter = 0 | 1 | 2 | 3;
/** The fractions of the turned picture cut off each side. */
export interface Crop { l: number; t: number; r: number; b: number }
export interface PictureEdit {
  original: string; rotate: Quarter; flip: boolean; crop: Crop;
  /** The edited copy this figure writes (made again over the same file on each edit; kept after Reset Picture for the next). */
  copy?: string;
}
export type Turn = 'right' | 'left' | 'flipH' | 'flipV';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const frac = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(0.99, Math.max(0, n)) : 0; };

export const NO_CROP: Crop = { l: 0, t: 0, r: 0, b: 0 };

/** A crop that leaves something: each side's cut no less than 0, and at least 1% of each direction left. */
export function cleanCrop(c: Crop): Crop {
  let { l, t, r, b } = { l: frac(c.l), t: frac(c.t), r: frac(c.r), b: frac(c.b) };
  if (l + r > 0.99) { const k = 0.99 / (l + r); l *= k; r *= k; }
  if (t + b > 0.99) { const k = 0.99 / (t + b); t *= k; b *= k; }
  const round = (x: number): number => Math.round(x * 1e5) / 1e5;
  return { l: round(l), t: round(t), r: round(r), b: round(b) };
}

/**
 * How a figure's picture was edited (null: it wasn't, or the record can't be read). The record
 * holds only while the figure shows its original or its edited copy: a picture changed elsewhere
 * (in SI Assistant, or by hand) leaves it behind, and the new picture is edited from scratch.
 */
export function pictureEditOf(entry: unknown): PictureEdit | null {
  const e = isObj(entry) ? entry[EDIT_KEY] : null;
  if (!isObj(e) || typeof e.original !== 'string' || !e.original) return null;
  const copy = typeof e.copy === 'string' && e.copy ? e.copy : undefined;
  const file = isObj(entry) && typeof entry.file === 'string' ? entry.file : '';
  if (file !== e.original && file !== copy) return null;
  const q = Math.round(Number(e.rotate) || 0);
  const c = isObj(e.crop) ? e.crop : {};
  const out: PictureEdit = { original: e.original, rotate: (((q % 4) + 4) % 4) as Quarter, flip: e.flip === true, crop: cleanCrop({ l: frac(c.l), t: frac(c.t), r: frac(c.r), b: frac(c.b) }) };
  // (showing the original: Reset Picture, so nothing is applied; the copy's name is kept for the next edit)
  if (file === e.original) return { original: out.original, rotate: 0, flip: false, crop: { ...NO_CROP }, ...(copy ? { copy } : {}) };
  return { ...out, ...(copy ? { copy } : {}) };
}

/** The record kept in the figure's entry (only what differs from the original). */
export function editRecord(e: PictureEdit): Json {
  const c = cleanCrop(e.crop);
  return { original: e.original, ...(e.copy ? { copy: e.copy } : {}), ...(e.rotate ? { rotate: e.rotate } : {}), ...(e.flip ? { flip: true } : {}), ...(c.l || c.t || c.r || c.b ? { crop: c } : {}) };
}

/** Nothing changed from the original. */
export const isPlain = (e: PictureEdit): boolean => !e.rotate && !e.flip && !e.crop.l && !e.crop.t && !e.crop.r && !e.crop.b;

/**
 * Rotate Right or Left 90°, or Flip Horizontal or Vertical, of the picture as it shows: the crop
 * turns with it, so the same part stays.
 */
export function turned(e: PictureEdit, how: Turn): PictureEdit {
  const { l, t, r, b } = e.crop;
  const q = e.rotate;
  if (how === 'right') return { ...e, rotate: ((q + 1) % 4) as Quarter, crop: { l: b, t: l, r: t, b: r } };
  if (how === 'left') return { ...e, rotate: ((q + 3) % 4) as Quarter, crop: { l: t, t: r, r: b, b: l } };
  // (a flip of what shows: the original flipped and turned the other way)
  if (how === 'flipH') return { ...e, rotate: ((4 - q) % 4) as Quarter, flip: !e.flip, crop: { l: r, t, r: l, b } };
  return { ...e, rotate: ((6 - q) % 4) as Quarter, flip: !e.flip, crop: { l, t: b, r, b: t } };
}

/**
 * The turned picture: where a point (x, y) of a picture w × h goes (x' = a·x + c·y + e,
 * y' = b·x + d·y + f, as SVG's and a canvas's matrix), and the size it then has.
 */
export function orientation(w: number, h: number, rotate: Quarter, flip: boolean): { m: [number, number, number, number, number, number]; w: number; h: number } {
  const map = (x: number, y: number): [number, number] => {
    let px = flip ? w - x : x, py = y, cw = w, ch = h;
    for (let i = 0; i < rotate; i++) { [px, py] = [ch - py, px]; [cw, ch] = [ch, cw]; }
    return [px, py];
  };
  const [e, f] = map(0, 0);
  const [x1, y1] = map(1, 0);
  const [x2, y2] = map(0, 1);
  const m: [number, number, number, number, number, number] = [x1 - e, y1 - f, x2 - e, y2 - f, e, f].map((v) => (Object.is(v, -0) ? 0 : v)) as [number, number, number, number, number, number];
  return { m, w: rotate % 2 ? h : w, h: rotate % 2 ? w : h };
}

/** The part of a picture w × h a crop keeps. */
export function cropRect(w: number, h: number, c: Crop): { x: number; y: number; w: number; h: number } {
  return { x: c.l * w, y: c.t * h, w: Math.max(1e-6, (1 - c.l - c.r) * w), h: Math.max(1e-6, (1 - c.t - c.b) * h) };
}

/** The edited picture's file name, beside the original ("<name> (edited).<ext>", for its type). */
export function editedName(original: string, mime: string): string {
  const name = original.slice(original.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  return `${name} (edited).${mime === 'image/svg+xml' ? 'svg' : mime === 'image/jpeg' ? 'jpg' : 'png'}`;
}

const num = (s: string): number => Number.parseFloat(s);
/** CSS's pixels in an SVG length (its user units when it has no view box); NaN for a percentage. */
const PX: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };
function px(v: string): number {
  const m = /^\s*([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(v);
  const k = m ? PX[m[2].toLowerCase()] : undefined;
  return m && k ? Number(m[1]) * k : NaN;
}
const fmt = (n: number): string => String(Math.round(n * 1e6) / 1e6);

/**
 * An SVG picture turned and cropped: its drawing in a group that turns it, the crop as the view
 * box, the printed size following. Null when it isn't an SVG whose size can be read.
 */
/** An SVG's root tag (its place in the text) and its size in pixels as drawn; null when it has none. */
function svgRoot(text: string): { at: number; tag: string; close: number; attr: (n: string) => string | null; box: { w: number; h: number }; sized: boolean; hasVb: boolean } | null {
  // (the root tag: past the prolog, comments, a DOCTYPE and CDATA; a ">" inside a quoted value is part of it)
  const blank = text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE(?:[^[>]|\[[^\]]*\])*>|<\?[\s\S]*?\?>/gi, (m) => ' '.repeat(m.length));
  const open = /<svg\b(?:"[^"]*"|'[^']*'|[^'">])*>/i.exec(blank);
  const close = blank.lastIndexOf('</svg>');
  if (!open || close < open.index || open[0].endsWith('/>')) return null;
  const tag = text.slice(open.index, open.index + open[0].length);
  const attr = (name: string): string | null => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2] ?? null;
  const vb = (attr('viewBox') ?? '').trim().split(/[\s,]+/).map(num);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const wAttr = attr('width'), hAttr = attr('height');
  // (the picture's size in pixels, as it is drawn: its width and height, else its view box's)
  const sized = !!wAttr && !!hAttr && px(wAttr) > 0 && px(hAttr) > 0;
  const box = sized ? { w: px(wAttr!), h: px(hAttr!) } : hasVb ? { w: vb[2], h: vb[3] } : null;
  return box ? { at: open.index, tag, close, attr, box, sized, hasVb } : null;
}

/** An SVG picture's size in pixels as drawn (null when it can't be read). */
export const svgSize = (text: string): { w: number; h: number } | null => svgRoot(text)?.box ?? null;

/** How wide the part shown is, over the original's width (the original w × h): a figure's printed width follows it. */
export function shownWidth(w: number, h: number, e: PictureEdit): number {
  const o = orientation(w, h, e.rotate, e.flip);
  return cropRect(o.w, o.h, cleanCrop(e.crop)).w / w;
}

export function editSvg(text: string, e: PictureEdit): string | null {
  const r = svgRoot(text);
  if (!r) return null;
  const { tag, attr, box, sized, hasVb, close } = r;
  const open = { index: r.at };
  const vbAttr = attr('viewBox');
  const wAttr = attr('width'), hAttr = attr('height');
  const o = orientation(box.w, box.h, e.rotate, e.flip);
  const cut = cropRect(o.w, o.h, cleanCrop(e.crop));
  // (the printed size: the original's, rotated, times the part kept; in each side's own unit)
  const size = (v: string | null, along: number, kept: number): string | null => {
    if (!v || !sized) return null;
    return fmt((num(v) * kept) / along) + v.replace(/^\s*[-+]?[\d.]+(?:[eE][-+]?\d+)?\s*/, '');
  };
  const [sw, sh] = e.rotate % 2 ? [hAttr, wAttr] : [wAttr, hAttr];
  const nw = size(sw, o.w, cut.w), nh = size(sh, o.h, cut.h);
  // (the root keeps everything but its size; the original drawing, with its own view box and
  // preserveAspectRatio, goes in an <svg> of the original's size inside the rotated group, so
  // percentages and stretching inside it work as before)
  const pAR = attr('preserveAspectRatio');
  let root = tag.replace(/\s(width|height|viewBox|preserveAspectRatio)\s*=\s*(["']).*?\2/gi, '');
  root = root.replace(/\s*\/?>$/, '') + `${nw ? ` width="${nw}"` : ''}${nh ? ` height="${nh}"` : ''} viewBox="${fmt(cut.x)} ${fmt(cut.y)} ${fmt(cut.w)} ${fmt(cut.h)}">`;
  const inner = `<svg x="0" y="0" width="${fmt(box.w)}" height="${fmt(box.h)}"${hasVb ? ` viewBox="${vbAttr}"` : ''}${pAR ? ` preserveAspectRatio="${pAR}"` : ''} overflow="visible">`;
  const g = `<g transform="matrix(${o.m.map(fmt).join(' ')})">`;
  return text.slice(0, open.index) + root + g + inner + text.slice(open.index + tag.length, close) + '</svg></g>' + text.slice(close);
}
