// Make Editable on a picture of a whole scheme: the reader reads only structures, so the picture is
// split into its drawings (find.ts, as for a PDF page), each structure is read on its own, and
// what the reader didn't read (arrows, reagents and conditions, compound numbers) is kept as a
// picture behind the structures, in the same place, so nothing in the picture is lost. The ink
// the structures came from is rubbed out of that picture: each stroke and letter that lies on a
// bond read, or by an atom label read (and the letters written on from it, CO2Et), goes.

import type { Pixels } from './picture';
import { findDrawings, type Box } from './find';
import { rgbaToPng } from '../render/emf-read';

/** How dark pixel `i` is, 0 (paper, or see-through) to 1 (ink). */
function dark(p: Pixels, i: number): number {
  const d = p.data, a = d[i * 4 + 3] / 255;
  return a * (1 - (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255);
}

/** Ink, as find.ts takes it for a PDF page (a page pixel is ink when r + g + b < 600). */
const INK = 0.2;
/** Any mark at all: the soft edge of a stroke goes with the stroke. */
const MARK = 0.04;

/** Margin of white round each drawing read on its own (as for a PDF page). */
export const PART_PAD = 6;

/**
 * The drawings in a picture that are each to be read on their own, when it is a scheme (more
 * than one drawing, or one with much ink beside it: arrows, conditions); null when it is a picture
 * of one structure, read whole. `gap` is how far apart two strokes can be and still be one drawing.
 * Each box has PART_PAD pixels of margin round the drawing.
 */
export function schemeParts(p: Pixels, gap: number): Box[] | null {
  const n = p.width * p.height;
  const ink = new Uint8Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) if (dark(p, i) > INK) { ink[i] = 1; total++; }
  if (!total) return null;
  const found = findDrawings(ink, p.width, p.height, [], gap);
  if (!found.length) return null;
  // (a box may go past the picture's edge: its margin is always white)
  const boxes = found.map((b) => ({ x: b.x - PART_PAD, y: b.y - PART_PAD, w: b.w + 2 * PART_PAD, h: b.h + 2 * PART_PAD }));
  if (boxes.length === 1) {
    // one drawing: a scheme only when a good share of the ink is outside it
    const b = boxes[0];
    let inside = 0;
    for (let y = Math.max(0, b.y); y < Math.min(p.height, b.y + b.h); y++) for (let x = Math.max(0, b.x); x < Math.min(p.width, b.x + b.w); x++) inside += ink[y * p.width + x];
    if (total - inside < total * 0.12) return null;
  }
  return boxes;
}

/** A part of the picture to read on its own: the box's pixels, with the margin made white (no bits of the drawings beside it). */
export function partPixels(p: Pixels, box: Box): Pixels {
  const w = Math.max(1, box.w), h = Math.max(1, box.h);
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const m = PART_PAD;
  for (let y = m; y < h - m; y++) {
    const sy = box.y + y;
    if (sy < 0 || sy >= p.height) continue;
    for (let x = m; x < w - m; x++) {
      const sx = box.x + x;
      if (sx < 0 || sx >= p.width) continue;
      const s = (sy * p.width + sx) * 4, t = (y * w + x) * 4, a = p.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) data[t + c] = p.data[s + c] * a + 255 * (1 - a);
    }
  }
  return { width: w, height: h, data };
}

/** A structure read, where it lies in the picture's pixels. */
export interface StructureInk {
  atoms: [number, number][];
  bonds: { a: number; b: number; order: number; display: string }[];
  labelled: boolean[];
  bondPx: number;
  lineWidthPx: number | null;
}

interface Mark { pixels: number[]; x1: number; y1: number; x2: number; y2: number; on: number; byLabel: boolean }

/** How far a point is from the segment a–b. */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/**
 * The picture with the structures read rubbed out: `read` the structures with their atoms'
 * places, `whole` boxes whose ink all goes (a structure an AI model read, with no places). Null
 * when nothing worth keeping is left (stray specks aren't).
 */
export function leftover(p: Pixels, read: StructureInk[], whole: Box[] = []): Pixels | null {
  const W = p.width, H = p.height, n = W * H;
  const seen = new Int32Array(n).fill(-1);
  const marks: Mark[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] >= 0 || dark(p, s) <= MARK) continue;
    const m: Mark = { pixels: [], x1: W, y1: H, x2: -1, y2: -1, on: 0, byLabel: false };
    const stack = [s];
    seen[s] = marks.length;
    while (stack.length) {
      const k = stack.pop()!;
      m.pixels.push(k);
      const x = k % W, y = (k - x) / W;
      if (x < m.x1) m.x1 = x;
      if (x > m.x2) m.x2 = x;
      if (y < m.y1) m.y1 = y;
      if (y > m.y2) m.y2 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] < 0 && dark(p, j) > MARK) { seen[j] = marks.length; stack.push(j); }
      }
    }
    marks.push(m);
  }
  // how much of each mark lies on what was read
  const gone = new Uint8Array(marks.length);
  let unit = 0;
  for (const r of read) unit = Math.max(unit, r.bondPx);
  const near = read.map((r) => {
    const xs = r.atoms.map((a) => a[0]), ys = r.atoms.map((a) => a[1]), m = 0.4 * r.bondPx;
    return { x1: Math.min(...xs) - m, y1: Math.min(...ys) - m, x2: Math.max(...xs) + m, y2: Math.max(...ys) + m };
  });
  for (let mi = 0; mi < marks.length; mi++) {
    const m = marks[mi];
    let on = 0, byLabel = 0;
    for (const k of m.pixels) {
      const x = k % W, y = (k - x) / W;
      let hit = false;
      for (const b of whole) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) { hit = true; break; }
      for (let ri = 0; !hit && ri < read.length; ri++) {
        const r = read[ri], L = r.bondPx, nb = near[ri];
        if (x < nb.x1 || x > nb.x2 || y < nb.y1 || y > nb.y2) continue;
        for (const bd of r.bonds) {
          const a = r.atoms[bd.a], b = r.atoms[bd.b];
          const d = bd.order >= 2 ? 0.26 * L : bd.display === 'solid' ? Math.max(2, (r.lineWidthPx ?? 1) * 1.5 + 1.5, 0.08 * L) : 0.13 * L;
          if (segDist(x, y, a[0], a[1], b[0], b[1]) <= d) { hit = true; break; }
        }
        if (hit) break;
        for (let i = 0; i < r.atoms.length; i++) {
          if (!r.labelled[i]) continue;
          if (Math.hypot(x - r.atoms[i][0], y - r.atoms[i][1]) <= 0.34 * L) { hit = true; byLabel++; break; }
        }
      }
      if (hit) on++;
    }
    m.on = on;
    m.byLabel = byLabel > 0;
    if (on >= m.pixels.length * 0.6) gone[mi] = 1;
  }
  // letters written on from a label read (CO2Et: the O2Et after the C by the atom), a letter's
  // width apart on the same line
  if (unit > 0) {
    const glyph = (m: Mark) => m.x2 - m.x1 < 0.9 * unit && m.y2 - m.y1 < 0.9 * unit;
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < marks.length; i++) {
        if (gone[i] || !glyph(marks[i])) continue;
        const m = marks[i];
        for (let j = 0; j < marks.length; j++) {
          if (!gone[j] || !glyph(marks[j]) || !(marks[j].byLabel || marks[j].on < marks[j].pixels.length)) continue;
          const o = marks[j];
          const dx = Math.max(0, o.x1 - m.x2, m.x1 - o.x2);
          const overlap = Math.min(o.y2, m.y2) - Math.max(o.y1, m.y1);
          if (dx <= 0.3 * unit && overlap >= 0.3 * Math.min(o.y2 - o.y1 + 1, m.y2 - m.y1 + 1)) { gone[i] = 1; m.byLabel = true; grew = true; break; }
        }
      }
    }
  }
  const out = new Uint8ClampedArray(p.data);
  // the faintest specks (a stroke's soft edge left alone) go too
  for (let i = 0; i < n; i++) if (seen[i] < 0) out.set([255, 255, 255, 255], i * 4);
  let kept = false;
  const speck = Math.max(8, (0.12 * unit) ** 2);
  for (let mi = 0; mi < marks.length; mi++) {
    const m = marks[mi];
    if (gone[mi]) { for (const k of m.pixels) out.set([255, 255, 255, 255], k * 4); continue; }
    if (m.pixels.length >= speck) kept = true;
  }
  return kept ? { width: W, height: H, data: out } : null;
}

/** The picture as a PNG data URL with its paper made see-through (it lies behind the structures). */
export function leftoverPng(p: Pixels): string {
  const n = p.width * p.height, rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = p.data[i * 4], g = p.data[i * 4 + 1], b = p.data[i * 4 + 2];
    const lo = Math.min(r, g, b), a = (255 - lo) / 255;
    if (a <= 0) continue;
    // the colour that, this see-through over white, looks as the pixel did
    rgba[i * 4] = Math.round((r - 255 * (1 - a)) / a);
    rgba[i * 4 + 1] = Math.round((g - 255 * (1 - a)) / a);
    rgba[i * 4 + 2] = Math.round((b - 255 * (1 - a)) / a);
    rgba[i * 4 + 3] = Math.round(a * 255);
  }
  const bytes = rgbaToPng(rgba, p.width, p.height);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}
