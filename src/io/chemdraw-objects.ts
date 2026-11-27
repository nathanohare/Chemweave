// ChemDraw's TLC plates and spectra (the CDX objects TLCPlate and Spectrum), drawn as pictures.
//
// Chemweave does not edit these: it shows each one as ChemDraw draws it, and when a CDXML file is
// saved the ChemDraw object itself goes back into the file, moved or sized with its picture
// (cdxml-write.ts writeCdObject), so ChemDraw can still edit it.
//
// How ChemDraw draws them was measured in ChemDraw 25 from a test file of every setting (see
// tests/chemdraw-objects.test.ts); the objects and their properties are those of the published
// CDX specification (https://chemapps.stolaf.edu/iupac/cdx/sdk/TLCPlate.htm, TLCSpot.htm,
// Spectrum.htm).

import { kids } from './xml';
import { arialWidth } from '../text-metrics';

/** A ChemDraw object kept as it was read, shown as its picture. */
export interface CdObject {
  /** The ChemDraw element's name: tlcplate or spectrum. */
  kind: string;
  /** The element as it was read. */
  xml: string;
  /** Where its picture was when read (x1 y1 x2 y2): moving or sizing the picture moves the object with it. */
  box: [number, number, number, number];
}

/** The ChemDraw objects drawn here. */
export const CD_OBJECTS = ['tlcplate', 'spectrum'];

/** What the drawing needs from the file: its colours by index and its line width. */
export interface CdLook {
  color: (el: Element) => string | undefined;
  lineWidth: number;
}

interface Pic { svg: string; x1: number; y1: number; x2: number; y2: number }
type V = { x: number; y: number };

const nums = (v: string | null): number[] => (v ? v.trim().split(/[\s,]+/).map(Number) : []);
const pt = (el: Element, name: string): V | null => {
  const n = nums(el.getAttribute(name));
  return n.length >= 2 && Number.isFinite(n[0]) && Number.isFinite(n[1]) ? { x: n[0], y: n[1] } : null;
};
const f = (n: number) => String(+n.toFixed(3));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const yes = (el: Element, name: string) => el.getAttribute(name) === 'yes' || el.getAttribute(name) === 'true';
const hidden = (el: Element) => el.getAttribute('Visible') === 'no';

/** A TLC plate or spectrum as an SVG picture, in page points, with the box it covers; null if it can't be drawn. */
export function cdObjectPicture(el: Element, look: CdLook): Pic | null {
  try {
    const out = el.nodeName === 'tlcplate' ? tlcPlate(el, look) : el.nodeName === 'spectrum' ? spectrum(el, look) : null;
    if (!out) return null;
    const { body, box } = out;
    const pad = 1;
    const x1 = box.x1 - pad, y1 = box.y1 - pad, x2 = box.x2 + pad, y2 = box.y2 + pad;
    if (![x1, y1, x2, y2].every(Number.isFinite) || x2 - x1 < 1 || y2 - y1 < 1) return null;
    const w = x2 - x1, h = y2 - y1;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="${f(x1)} ${f(y1)} ${f(w)} ${f(h)}">${body}</svg>`;
    return { svg, x1, y1, x2, y2 };
  } catch {
    return null;
  }
}

class Box {
  x1 = Infinity; y1 = Infinity; x2 = -Infinity; y2 = -Infinity;
  add(x: number, y: number, r = 0): void {
    this.x1 = Math.min(this.x1, x - r); this.y1 = Math.min(this.y1, y - r);
    this.x2 = Math.max(this.x2, x + r); this.y2 = Math.max(this.y2, y + r);
  }
}

// ------------------------------------------------------------------------------------------------
// TLC plates

/**
 * A TLC plate as ChemDraw 25 draws it: the plate's four corners (its border if ShowBorders), the
 * origin and solvent front as dashed lines across it (if shown), a tick on the origin at each lane,
 * and each spot as an outline at its Rf between them. Lanes share the middle nine tenths of the
 * plate's width equally. A spot's Width, Height and Tail are in CDX units (1/65536 point) even in
 * CDXML; ChemDraw draws one no smaller than 0.6 point across. Its outline is dashed for CurveType 2
 * and bold for 4; with a tail its lower half reaches (Height + 2 Tail) / 2 below its middle. The Rf
 * shows as "Rf = 0.50" (7.5 point Arial, f as a subscript) above and to the right of the spot, where
 * ChemDraw keeps it in an objecttag named rf.
 */
function tlcPlate(el: Element, look: CdLook): { body: string; box: Box } | null {
  const tl = pt(el, 'TopLeft'), tr = pt(el, 'TopRight'), br = pt(el, 'BottomRight'), bl = pt(el, 'BottomLeft');
  if (!tl || !tr || !br || !bl) return null;
  const box = new Box();
  const color = look.color(el) ?? '#000000';
  const lw = Number(el.getAttribute('LineWidth') ?? look.lineWidth) || look.lineWidth;
  // (a bold spot's outline is twice the line, as ChemDraw 25 draws it: not the drawing's bond bold width)
  const bold = 2 * lw;
  // a point on the plate: u across from the left, v down from the top (0 to 1)
  const at = (u: number, v: number): V => {
    const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
    const bot = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
    return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
  };
  const parts: string[] = [];
  const line = (a: V, b: V, extra = '') => parts.push(`<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"${extra}/>`);
  for (const c of [tl, tr, br, bl]) box.add(c.x, c.y, lw / 2);
  if (yes(el, 'ShowBorders')) parts.push(`<polygon points="${[tl, tr, br, bl].map((c) => `${f(c.x)},${f(c.y)}`).join(' ')}" fill="none"/>`);
  const origin = 1 - num(el, 'OriginFraction', 0.1), front = num(el, 'SolventFrontFraction', 0.1);
  const dash = ` stroke-dasharray="${f(2.2)} ${f(1.5)}"`;
  if (yes(el, 'ShowOrigin')) line(at(0, origin), at(1, origin), dash);
  if (yes(el, 'ShowSolventFront')) line(at(0, front), at(1, front), dash);
  const lanes = kids(el).filter((k) => k.nodeName === 'tlclane');
  // the plate's own directions, for the ticks and spots of a turned plate
  const across = unit({ x: tr.x - tl.x, y: tr.y - tl.y }), down = unit({ x: bl.x - tl.x, y: bl.y - tl.y });
  const texts: string[] = [];
  lanes.forEach((lane, i) => {
    const u = 0.05 + ((i + 0.5) * 0.9) / lanes.length;
    if (hidden(lane)) return;
    const o = at(u, origin), tick = 2.5;
    line({ x: o.x - down.x * tick, y: o.y - down.y * tick }, { x: o.x + down.x * tick, y: o.y + down.y * tick });
    for (const spot of kids(lane)) {
      if (spot.nodeName !== 'tlcspot' || hidden(spot)) continue;
      const rf = num(spot, 'Rf', 0);
      const c = at(u, origin + (front - origin) * rf);
      const rx = Math.max(0.3, num(spot, 'Width', 39321) / 65536 / 2), ry = Math.max(0.3, num(spot, 'Height', 39321) / 65536 / 2);
      const tail = Math.max(0, num(spot, 'Tail', 0) / 65536);
      const ct = num(spot, 'CurveType', 0);
      const sw = ct & 4 ? bold : lw;
      const sc = look.color(spot) ?? color;
      const ang = (Math.atan2(across.y, across.x) * 180) / Math.PI;
      const rb = ry + tail; // the lower half's half-height
      // upper half then lower half, drawn in the spot's own frame and turned with the plate
      const d = `M ${f(-rx)} 0 A ${f(rx)} ${f(ry)} 0 0 1 ${f(rx)} 0 A ${f(rx)} ${f(rb)} 0 0 1 ${f(-rx)} 0 Z`;
      parts.push(`<path transform="translate(${f(c.x)} ${f(c.y)})${Math.abs(ang) > 1e-3 ? ` rotate(${f(ang)})` : ''}" d="${d}"${sw !== lw ? ` stroke-width="${f(sw)}"` : ''}${ct & 2 ? ` stroke-dasharray="${f(1.2)} ${f(1)}"` : ''}${sc !== color ? ` stroke="${sc}"` : ''}/>`);
      box.add(c.x, c.y, Math.max(rx, rb) + sw);
      if (!yes(spot, 'ShowRf')) continue;
      // the label where ChemDraw keeps it, else where ChemDraw puts it
      const tag = kids(spot).find((k) => k.nodeName === 'objecttag' && k.getAttribute('Name') === 'rf');
      const t = tag && kids(tag).find((k) => k.nodeName === 't');
      const p = (t && pt(t, 'p')) ?? { x: c.x + rx - 0.87, y: c.y - ry - 0.3 };
      const runs = t ? kids(t).filter((k) => k.nodeName === 's').map((s) => ({ text: s.textContent ?? '', size: num(s, 'size', 7.5), sub: (num(s, 'face', 0) & 32) !== 0, color: look.color(s) })) : null;
      const shown = runs?.length ? runs : [{ text: 'R', size: 7.5, sub: false, color: undefined }, { text: 'f', size: 7.5, sub: true, color: undefined }, { text: ` = ${rf.toFixed(2)}`, size: 7.5, sub: false, color: undefined }];
      texts.push(textEl(p, shown, sc));
      const width = shown.reduce((w, r) => w + arialWidth(r.text, r.sub ? r.size * 0.75 : r.size), 0);
      const size = shown.reduce((m, r) => Math.max(m, r.size), 0);
      box.add(p.x, p.y - size * 0.85); box.add(p.x + width, p.y + size * 0.3);
    }
  });
  const body = `<g fill="none" stroke="${color}" stroke-width="${f(lw)}">${parts.join('')}</g>${texts.join('')}`;
  return { body, box };
}

function unit(v: V): V {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function num(el: Element, name: string, def: number): number {
  const v = el.getAttribute(name);
  if (v === null) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/** A line of text runs (a subscript drawn smaller and lower), its baseline starting at p. */
function textEl(p: V, runs: { text: string; size: number; sub: boolean; color?: string }[], color: string, anchor = 'start', extra = ''): string {
  const size = runs[0]?.size ?? 7.5;
  // (dy moves from where the run before left off: a subscript drops to its place below the
  // baseline from wherever the text is, so one straight after another stays level with it, and
  // the run after a subscript goes back up; review F551)
  let out = '', down = 0;
  for (const r of runs) {
    const s = r.sub ? r.size * 0.75 : r.size;
    const want = r.sub ? r.size * 0.2 : 0;
    const dy = want - down;
    down = want;
    out += `<tspan${Math.abs(dy) > 1e-9 ? ` dy="${f(dy)}"` : ''}${s !== size ? ` font-size="${f(s)}"` : ''}${r.color && r.color !== color ? ` fill="${r.color}"` : ''}>${esc(r.text)}</tspan>`;
  }
  return `<text x="${f(p.x)}" y="${f(p.y)}" font-family="Arial, Helvetica, sans-serif" font-size="${f(size)}" fill="${color}" text-anchor="${anchor}"${extra}>${out}</text>`;
}

// ------------------------------------------------------------------------------------------------
// Spectra

/** The spectrum types ChemDraw 25 reads; any other Class name is drawn as Unknown (and Raman as Infrared, as ChemDraw does). */
function spectrumClass(c: string | null): string {
  if (c === 'Raman') return 'Infrared';
  return c === 'Infrared' || c === 'UVVis' || c === 'MassSpectrum' || c === 'NMR' ? c : 'Unknown';
}

/** A round step (1, 2 or 5 times a power of ten) at least `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw - 1e-12) return m * p;
  return 10 * p;
}

/**
 * The multiples of `step` from lo to hi, as whole numbers of steps; none where they would be too
 * many to draw or too large to count one by one (an axis from 1e17 would never end).
 */
function ticks(lo: number, hi: number, step: number): number[] {
  const k0 = Math.ceil(lo / step - 1e-9), k1 = Math.floor(hi / step + 1e-9);
  if (!Number.isSafeInteger(k0) || !Number.isSafeInteger(k1) || k1 - k0 > 200) return [];
  const out: number[] = [];
  for (let k = k0; k <= k1; k++) out.push(k);
  return out;
}

const decimals = (step: number) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));

/**
 * A spectrum as ChemDraw 25 draws it: the data (Y values on an even X grid from XLow in steps of
 * XSpacing) as a line in a thin frame filling the BoundingBox's width and its top, with the X axis's
 * numbers and label below. Infrared, UV-Vis and mass spectra also have a Y axis with numbers and a
 * turned label at the left; Infrared, and NMR in PPM, run their X axis high to low. Mass units are
 * drawn as sticks. An axis with no label of its own is labelled Unknown (PPM for NMR in PPM; none
 * for X type Other). The text takes the spectrum's colour; the frame and line stay black.
 */
function spectrum(el: Element, look: CdLook): { body: string; box: Box } | null {
  const bb = nums(el.getAttribute('BoundingBox'));
  if (bb.length !== 4 || !bb.every(Number.isFinite)) return null;
  const [bx1, by1, bx2, by2] = [Math.min(bb[0], bb[2]), Math.min(bb[1], bb[3]), Math.max(bb[0], bb[2]), Math.max(bb[1], bb[3])];
  const ys = (el.textContent ?? '').trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite);
  const cls = spectrumClass(el.getAttribute('Class'));
  const xType = el.getAttribute('XType'), yType = el.getAttribute('YType');
  const yAxis = cls === 'Infrared' || cls === 'UVVis' || cls === 'MassSpectrum';
  const reversed = cls === 'Infrared' || (cls === 'NMR' && xType === 'PartsPerMillion');
  const xLabel = el.getAttribute('XAxisLabel') ?? (xType === 'Other' ? '' : cls === 'NMR' && xType === 'PartsPerMillion' ? 'PPM' : 'Unknown');
  const yLabel = el.getAttribute('YAxisLabel') ?? (yType === 'Other' ? '' : 'Unknown');
  const color = look.color(el) ?? '#000000';
  const box = new Box();
  box.add(bx1, by1); box.add(bx2, by2);
  // the frame: the box's width (less the Y axis's room) and its height less the X axis's numbers
  const fx1 = bx1 + (yAxis ? 20 : 0), fx2 = bx2, fy1 = by1, fy2 = Math.max(by1 + 5, by2 - 13);
  const parts: string[] = [`<rect x="${f(fx1)}" y="${f(fy1)}" width="${f(fx2 - fx1)}" height="${f(fy2 - fy1)}"/>`];
  const texts: string[] = [];
  const numSize = 8.5, labelSize = 9.5;
  const xLow = num(el, 'XLow', 0), dx = num(el, 'XSpacing', 1);
  let yNumbers = 0; // the widest Y axis number
  if (ys.length) {
    const xFirst = xLow, xLast = xLow + dx * (ys.length - 1);
    // the X axis runs from the first point to the last, or the other way for a reversed type
    const left = reversed ? Math.max(xFirst, xLast) : xFirst, right = reversed ? Math.min(xFirst, xLast) : xLast;
    const span = right - left || 1;
    const X = (x: number) => fx1 + ((x - left) / span) * (fx2 - fx1);
    // (a loop, not one call given every point: a long spectrum has more points than a call may take)
    let lo = Infinity, hi = -Infinity;
    for (const y of ys) { if (y < lo) lo = y; if (y > hi) hi = y; }
    if (hi - lo < 1e-12) { lo -= 0.5; hi += 0.5; }
    const top = fy1 + 2, bot = fy2 - 1.5;
    const Y = (y: number) => bot - ((y - lo) / (hi - lo)) * (bot - top);
    if (xType === 'MassUnits') {
      const base = Y(Math.max(lo, Math.min(hi, 0)));
      ys.forEach((y, i) => { const x = X(xLow + dx * i); parts.push(`<line x1="${f(x)}" y1="${f(base)}" x2="${f(x)}" y2="${f(Y(y))}"/>`); });
      parts.push(`<line x1="${f(fx1)}" y1="${f(base)}" x2="${f(fx2)}" y2="${f(base)}"/>`);
    } else {
      parts.push(`<polyline fill="none" points="${ys.map((y, i) => `${f(X(xLow + dx * i))},${f(Y(y))}`).join(' ')}"/>`);
    }
    // X axis: ticks up from the frame's foot, numbers below them
    const lo2 = Math.min(left, right), hi2 = Math.max(left, right);
    const step = niceStep((hi2 - lo2) / Math.max(1, (fx2 - fx1) / 40));
    for (const k of ticks(lo2, hi2, step / 2)) {
      const v = k * (step / 2), x = X(v), major = k % 2 === 0;
      parts.push(`<line x1="${f(x)}" y1="${f(fy2)}" x2="${f(x)}" y2="${f(fy2 - (major ? 2.5 : 1.5))}"/>`);
      if (!major) continue;
      const label = v.toFixed(decimals(step)).replace(/^-0(\.0*)?$/, '0$1');
      const half = arialWidth(label, numSize) / 2;
      if (x - half < fx1 - 3 || x + half > fx2 + 3) continue;
      texts.push(textEl({ x, y: fy2 + 9 }, [{ text: label, size: numSize, sub: false }], color, 'middle'));
      box.add(x - half, fy2 + 9); box.add(x + half, fy2 + 9);
    }
    // Y axis: ticks out to the left, numbers right-aligned beside them
    if (yAxis) {
      const ystep = niceStep((hi - lo) / Math.max(1, (bot - top) / 15));
      for (const k of ticks(lo, hi, ystep / 2)) {
        const v = k * (ystep / 2), y = Y(v), major = k % 2 === 0;
        parts.push(`<line x1="${f(fx1)}" y1="${f(y)}" x2="${f(fx1 - (major ? 2.5 : 1.5))}" y2="${f(y)}"/>`);
        if (!major) continue;
        const label = v.toFixed(Math.max(1, decimals(ystep)));
        yNumbers = Math.max(yNumbers, arialWidth(label, numSize));
        texts.push(textEl({ x: fx1 - 3, y: y + numSize * 0.35 }, [{ text: label, size: numSize, sub: false }], color, 'end'));
      }
    }
  }
  if (xLabel) {
    const x = (fx1 + fx2) / 2, w = arialWidth(xLabel, labelSize);
    texts.push(textEl({ x, y: fy2 + 21 }, [{ text: xLabel, size: labelSize, sub: false }], color, 'middle'));
    box.add(x - w / 2, fy2 + 23); box.add(x + w / 2, fy2 + 23);
  }
  if (yAxis && yLabel) {
    // turned, just left of the numbers (it may stand out of the box to the left, as ChemDraw's does)
    const base = fx1 - 3 - yNumbers - 1.5, y = (fy1 + fy2) / 2, w = arialWidth(yLabel, labelSize);
    texts.push(textEl({ x: base, y }, [{ text: yLabel, size: labelSize, sub: false }], color, 'middle', ` transform="rotate(-90 ${f(base)} ${f(y)})"`));
    box.add(base - labelSize * 0.8, y - w / 2); box.add(base, y + w / 2);
  }
  const body = `<g fill="none" stroke="#000000" stroke-width="${f(0.5)}">${parts.join('')}</g>${texts.join('')}`;
  return { body, box };
}
