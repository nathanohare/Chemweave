// The predicted spectrum drawings for Analysis ▸ NMR: a small strip in the panel and a movable
// Spectrum window popped out from it, with zoom, labels, field and quality choices, Copy as Picture
// and Put on Canvas. 1H is the simulated spectrum; 13C is one line per carbon set.

import { DEFAULT_PEAK_LABELS, nmrTraceColor, peakLabels, rangeFor, TRACE_ON_PAPER, type PeakLabels, type TraceColor } from './nmr-settings';
import { multipletHalfWidth, sampleSpectrum, type NmrQuality, type PredictedSpectrum } from '../chem/nmr/spectrum';
import { lorentzian } from '../chem/nmr/spin';
import { clampRange, clampYZoom, CLICK_PX, dragZoom, fullHeight, panRange, ppmAt, rangeFromDrag, stepZoom, wheelZoom, type PpmRange } from './nmr-view';
import { GEAR } from './ribbon-live';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** What one drawing shows. */
export interface SpectrumData {
  nuc: '1H' | '13C' | '19F' | '31P';
  /** 1H: the simulated spectrum. */
  spec?: PredictedSpectrum;
  /** 13C, 19F, 31P: one line per set of equivalent atoms (shift, atoms). */
  sticks?: { shift: number; n: number; row: number }[];
  /** 1H: list row index for each proton group (same order as spec.groups), -1 when none. */
  groupRows?: number[];
  /** A measured list to draw against the prediction (Check Data). */
  measured?: MeasuredOverlay;
  /** The list's Atoms column, by row (for the peak labels). */
  rowLabels?: string[];
}

export interface DrawOpts { w: number; h: number; hi: number; lo: number; labels: boolean; hotRow: number | null; /** What the labels say (Settings ▸ NMR Prediction); the default when left out. */ peakLabels?: PeakLabels;
  /** With a measured list: measured above and predicted mirrored below it (inverted), both upright one above the other (stacked), or both on one baseline (overlay). */
  compare?: CompareMode;
  /** The measured trace's height against the predicted one (1 = each scaled to its own tallest peaks). */
  measScale?: number;
  /** A vertical line with its ppm at the pointer. */
  cursor?: number | null;
  /** The Spectrum window's intensity: the tallest peak in the drawn range is drawn at 3/4 of the
   *  height times this. Left out: the third-tallest point sets the height. */
  yZoom?: number;
  /** Written in the middle when no peak falls in the range drawn (the zoomed window). */
  emptyNote?: string;
  /** The range being dragged out (shaded). */
  band?: PpmRange | null;
  /** The trace color (Settings ▸ NMR Prediction when left out). */
  trace?: TraceColor }

/** Between the baseline and the x-axis line, px, so the two never overlap. */
const BASE_GAP = 4;

export type CompareMode = 'inverted' | 'stacked' | 'overlay';
export function compareMode(): CompareMode { try { const m = localStorage.getItem('ci-nmr-compare'); return m === 'stacked' || m === 'overlay' ? m : 'inverted'; } catch { return 'inverted'; } }
export function setCompareMode(v: CompareMode): void { try { localStorage.setItem('ci-nmr-compare', v); } catch { /* not remembered */ } }

/** A default ppm range: the predicted signals with a margin, on whole or half ppm. */
export function autoRange(d: SpectrumData): { hi: number; lo: number } {
  const xs = d.nuc === '1H' ? (d.spec?.groups ?? []).map((g) => g.shift) : (d.sticks ?? []).map((s) => s.shift);
  if (d.measured) xs.push(...d.measured.links.map((l) => l.m), ...d.measured.marks.map((m) => m.ppm));
  if (d.nuc === '1H' || d.nuc === '13C') return rangeFor(d.nuc, xs);
  if (!xs.length) return { hi: 50, lo: -250 };
  const m = 10;
  const hi = Math.ceil((Math.max(...xs) + m) / m) * m, lo = Math.max(-1000, Math.floor((Math.min(...xs) - m) / m) * m);
  return { hi, lo };
}

function ticks(hi: number, lo: number, w: number): number[] {
  const span = hi - lo, want = Math.max(2, Math.floor(w / 60));
  const step = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].find((s) => span / s <= want) ?? 50;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(3));
  return out;
}


/** A measured list drawn against the prediction (Check Data). */
export interface MeasuredOverlay {
  /** 1H: the list drawn as first-order lines. */
  spec?: PredictedSpectrum;
  /** 13C: one line per listed peak. */
  sticks?: { shift: number; n: number }[];
  /** Matched pairs: measured and predicted shift, how well they agree. */
  links: { m: number; p: number; sev: Severity }[];
  /** Labels over measured peaks that need a look. */
  marks: { ppm: number; text: string; sev: Severity }[];
}
export type Severity = 'ok' | 'warn' | 'bad' | 'info';

/** The spectrum's height at the middle of each of its lines (its peak tops), kept per spectrum. */
const topsCache = new WeakMap<PredictedSpectrum['lines'], Float64Array>();
function lineTops(spec: PredictedSpectrum): Float64Array {
  let t = topsCache.get(spec.lines);
  if (!t) { t = lorentzian(spec.lines, spec.lines.hz); topsCache.set(spec.lines, t); }
  return t;
}

/** The tallest peak top between hi and lo ppm (0 when no line is there). */
export function tallestIn(spec: PredictedSpectrum, hi: number, lo: number): number {
  const tops = lineTops(spec), hz = spec.lines.hz, sf = spec.sf;
  let m = 0;
  for (let i = 0; i < hz.length; i++) { const p = hz[i] / sf; if (p <= hi && p >= lo && tops[i] > m) m = tops[i]; }
  return m;
}

/** Per pixel column, the highest point of a sampled spectrum (narrow lines never vanish). With
 *  `tops`, each line's own top is put in its column too, so a peak is drawn at its full height
 *  however far out it is zoomed. */
function columns(spec: PredictedSpectrum, o: DrawOpts, tops = false): { col: Float64Array; ymax: number } {
  // the last columns of each spectrum are kept: while only the pointer moves, nothing is sampled again
  const key = `${o.hi}|${o.lo}|${o.w}|${tops}`, kept = colCache.get(spec.lines);
  if (kept?.key === key) return kept.got;
  const n = Math.max(64, Math.round(o.w * 3));
  const { y } = sampleSpectrum(spec, o.hi, o.lo, n);
  // the third-tallest point sets the height, so one tall singlet does not flatten the rest (not
  // needed with `tops`: the window gives the height itself)
  let ymax = 1;
  if (!tops) {
    const sortedY = [...y].sort((a, b) => b - a);
    ymax = (sortedY[Math.min(2 * Math.round(n / o.w), n - 1)] || sortedY[0] || 1) * 1.08;
  }
  const cols = Math.round(o.w), col = new Float64Array(cols);
  for (let c = 0; c < cols; c++) {
    let m = 0;
    for (let i = Math.floor((c * n) / cols); i < Math.floor(((c + 1) * n) / cols); i++) m = Math.max(m, y[i]);
    col[c] = m;
  }
  if (tops) {
    const t = lineTops(spec), hz = spec.lines.hz;
    for (let i = 0; i < hz.length; i++) {
      const c = Math.floor(((o.hi - hz[i] / spec.sf) / (o.hi - o.lo)) * cols);
      if (c >= 0 && c < cols && t[i] > col[c]) col[c] = t[i];
    }
  }
  const got = { col, ymax };
  colCache.set(spec.lines, { key, got });
  return got;
}
const colCache = new WeakMap<PredictedSpectrum['lines'], { key: string; got: { col: Float64Array; ymax: number } }>();

/** The text over each peak: one entry per line, as Settings ▸ NMR Prediction asks. */
function peakLines(d: SpectrumData, p: PeakLabels, sf: number): { ppm: number; row: number; lines: string[] }[] {
  const out: { ppm: number; row: number; lines: string[] }[] = [];
  if (d.nuc === '1H' && d.spec) {
    d.spec.groups.forEach((g, gi) => {
      const row = d.groupRows?.[gi] ?? -1, lines: string[] = [];
      if (p.label && row >= 0 && d.rowLabels?.[row]) lines.push(d.rowLabels[row]);
      if (p.shift) {
        const hw = multipletHalfWidth(g, sf);
        lines.push(g.mult === 'm' && hw > 0.005 ? `${(g.shift + hw).toFixed(2)}–${(g.shift - hw).toFixed(2)}` : g.shift.toFixed(2));
      }
      const mc = [p.mult ? g.mult : '', p.count ? `${g.n}H` : ''].filter(Boolean).join(', ');
      if (mc) lines.push(mc);
      if (p.j && g.j.length) lines.push(`J = ${g.j.map((j) => j.toFixed(1)).join(', ')} Hz`);
      out.push({ ppm: g.shift, row, lines });
    });
  } else if (d.sticks) {
    for (const k of d.sticks) {
      const lines: string[] = [];
      if (p.label && d.rowLabels?.[k.row]) lines.push(d.rowLabels[k.row]);
      if (p.shift || !p.label) lines.push(k.shift.toFixed(1));
      if (p.count && k.n > 1) lines.push(`${k.n}${d.nuc === '13C' ? 'C' : ''}`);
      out.push({ ppm: k.shift, row: k.row, lines });
    }
  }
  return out;
}

/** How tall the labels' band at the top is. */
function labelBand(items: { lines: string[] }[], p: PeakLabels, h: number): number {
  const lh = p.size * 1.2;
  if (!items.some((x) => x.lines.length)) return 4;
  if (p.place === 'top') return lh + 14;
  if (p.place === 'upright') return Math.min(h * 0.45, Math.max(...items.map((x) => x.lines.join(' · ').length)) * p.size * 0.56 + 8);
  return Math.max(...items.map((x) => x.lines.length)) * lh + 6;
}

/** The sample Settings ▸ NMR Prediction draws its preview with: ethyl acetate in CDCl₃, δ 4.12 (q,
 *  J = 7 Hz, 2H, OCH₂), 2.05 (s, 3H, COCH₃), 1.26 (t, J = 7 Hz, 3H, CH₂CH₃) (Fulmer, G. R. et al.,
 *  Organometallics 2010, 29, 2176–2179, doi:10.1021/om100106e, Table 1: ethyl acetate in CDCl₃,
 *  CH₃CO 2.05 s; CH₂ 4.12 q, J = 7; CH₃ 1.26 t, J = 7 Hz), as first-order lines at `sf` MHz. With `measured`, the
 *  same list again as a pasted report, so the comparison layout shows. */
export function sampleSpectrumData(sf: number, measured: boolean): SpectrumData {
  const groups: PredictedSpectrum['groups'] = [
    { atoms: [0], shift: 4.12, n: 2, mult: 'q', j: [7] },
    { atoms: [1], shift: 2.05, n: 3, mult: 's', j: [] },
    { atoms: [2], shift: 1.26, n: 3, mult: 't', j: [7] },
  ];
  const split: Record<string, number> = { s: 0, d: 1, t: 2, q: 3 };
  const hz: number[] = [], int: number[] = [], width: number[] = [];
  for (const g of groups) {
    const k = split[g.mult] ?? 0, j = g.j[0] ?? 0;
    for (let m = 0, b = 1; m <= k; b = (b * (k - m)) / (m + 1), m++) { hz.push(g.shift * sf + (m - k / 2) * j); int.push((g.n * b) / 2 ** k); width.push(0.9); }
  }
  const spec: PredictedSpectrum = { sf, groups, lines: { hz: Float64Array.from(hz), intensity: Float64Array.from(int), width: Float64Array.from(width), sf } };
  return {
    nuc: '1H', spec, groupRows: [0, 1, 2], rowLabels: ['OCH₂', 'COCH₃', 'CH₂CH₃'],
    ...(measured ? { measured: { spec, links: groups.map((g) => ({ m: g.shift, p: g.shift, sev: 'ok' as const })), marks: [] } } : {}),
  };
}

/** The spectrum as SVG (theme colors from CSS variables). Peaks carry data-row for hovering. With
 *  overlay and measured data: the measured list above, the prediction mirrored below. */
export function spectrumSvg(d: SpectrumData, o: DrawOpts & { overlay?: boolean }): string {
  const ov = o.overlay && d.measured ? d.measured : null;
  const pl = o.labels ? o.peakLabels ?? DEFAULT_PEAK_LABELS : null;
  const items = pl ? peakLines(d, pl, d.spec?.sf ?? 400) : [];
  const top = pl ? labelBand(items, pl, o.h) : o.labels ? 18 : 4, bot = 15;
  const cmp: CompareMode = ov ? o.compare ?? 'inverted' : 'inverted';
  const split = ov && cmp !== 'overlay';
  const mid = split ? top + (o.h - top - bot) / 2 : 0;
  // predicted band: base line and height (upward; downward under the measured list when inverted)
  // (the baseline sits BASE_GAP px above the x-axis line)
  // (and, one above the other, BASE_GAP px from the line between the two)
  const pBase = split && cmp === 'inverted' ? mid + BASE_GAP : o.h - bot - BASE_GAP, pH = split ? o.h - bot - 2 * BASE_GAP - mid : o.h - top - bot - BASE_GAP, pDir = split && cmp === 'inverted' ? 1 : -1;
  const mk = Math.max(0.1, o.measScale ?? 1);
  const xs = (v: number) => ((o.hi - v) / (o.hi - o.lo)) * o.w;
  // the window's intensity: the tallest peak in the fitted range at 3/4 of the height, times yZoom
  const yz = o.yZoom, fit = { hi: o.hi, lo: o.lo };
  const specTop = (sp: PredictedSpectrum) => fullHeight(tallestIn(sp, fit.hi, fit.lo) || tallestIn(sp, Infinity, -Infinity), yz);
  const stickTop = (ks: { shift: number; n: number }[], maxN: number) => {
    const rel = (k: { n: number }) => 0.55 + 0.45 * (k.n / maxN);
    const inFit = ks.filter((k) => k.shift <= fit.hi && k.shift >= fit.lo);
    return fullHeight(Math.max(0, ...(inFit.length ? inFit : ks).map(rel)), yz);
  };
  let s = `<svg class="nmr-spec" data-trace="${o.trace ?? nmrTraceColor()}" viewBox="0 0 ${o.w} ${o.h}" width="${o.w}" height="${o.h}" xmlns="http://www.w3.org/2000/svg">`;
  s += `<rect x="0" y="0" width="${o.w}" height="${o.h}" class="sp-bg"/>`;
  if (o.band) {
    const x0 = Math.max(0, Math.min(xs(o.band.hi), xs(o.band.lo))), x1 = Math.min(o.w, Math.max(xs(o.band.hi), xs(o.band.lo)));
    if (x1 > x0) s += `<rect x="${x0.toFixed(1)}" y="0" width="${(x1 - x0).toFixed(1)}" height="${o.h - bot}" class="sp-band"/>`;
  }
  const trace = (col: Float64Array, ymax: number, base: number, h: number, dir: number, from = 0, to = col.length) => {
    let path = '';
    for (let c = from; c < to; c++) path += `${path ? 'L' : 'M'}${c + 0.5},${(base + dir * Math.min(1, col[c] / ymax) * h).toFixed(1)}`;
    return path;
  };
  if (d.nuc === '1H' && d.spec) {
    const { col, ymax: auto } = columns(d.spec, o, yz !== undefined);
    const ymax = yz !== undefined ? specTop(d.spec) : auto;
    s += `<path d="${trace(col, ymax, pBase, pH, pDir)}" class="sp-line"/>`;
    const groups = d.spec.groups;
    if (o.hotRow !== null && d.groupRows) {
      groups.forEach((g, gi) => {
        if (d.groupRows![gi] !== o.hotRow) return;
        const hw = multipletHalfWidth(g, d.spec!.sf);
        const c0 = Math.max(0, Math.floor(xs(g.shift + hw))), c1 = Math.min(col.length, Math.ceil(xs(g.shift - hw)));
        if (c1 > c0) s += `<path d="${trace(col, ymax, pBase, pH, pDir, c0, c1)}" class="sp-hot"/>`;
      });
    }
  } else if (d.sticks) {
    const maxN = Math.max(1, ...d.sticks.map((k) => k.n));
    const top1 = yz !== undefined ? stickTop(d.sticks, maxN) : 1;
    for (const k of d.sticks) {
      const x = xs(k.shift);
      if (x < 0 || x > o.w) continue;
      const hot = o.hotRow === k.row;
      s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${pBase}" y2="${(pBase + pDir * Math.min(1, (0.55 + 0.45 * (k.n / maxN)) / top1) * pH).toFixed(1)}" class="${hot ? 'sp-hot' : 'sp-line'}"/>`;
    }
  }
  if (pl) s += drawPeakLabels(items, pl, o, xs, top);
  if (o.emptyNote) {
    const inRange = (v: number) => v <= o.hi && v >= o.lo;
    const any = (d.spec ? tallestIn(d.spec, o.hi, o.lo) > 0 : (d.sticks ?? []).some((k) => inRange(k.shift)))
      || (ov ? (ov.spec ? tallestIn(ov.spec, o.hi, o.lo) > 0 : (ov.sticks ?? []).some((k) => inRange(k.shift))) || ov.marks.some((m) => inRange(m.ppm)) : false);
    if (!any) s += `<text x="${(o.w / 2).toFixed(1)}" y="${((top + o.h - bot) / 2).toFixed(1)}" text-anchor="middle" class="sp-tick sp-empty">${esc(o.emptyNote)}</text>`;
  }
  if (ov) {
    const mBase = split ? mid - BASE_GAP : o.h - bot - BASE_GAP, mH = split ? mid - BASE_GAP - top : o.h - bot - BASE_GAP - top;
    if (ov.spec) {
      const { col, ymax: auto } = columns(ov.spec, o, yz !== undefined);
      const ymax = yz !== undefined ? specTop(ov.spec) : auto;
      s += `<path d="${trace(col, ymax / mk, mBase, mH, -1)}" class="sp-meas"/>`;
    } else if (ov.sticks) {
      const maxN = Math.max(1, ...ov.sticks.map((k) => k.n));
      const top1 = yz !== undefined ? stickTop(ov.sticks, maxN) : 1;
      for (const k of ov.sticks) {
        const x = xs(k.shift);
        if (x >= 0 && x <= o.w) s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${mBase}" y2="${(mBase - Math.min(1, ((0.55 + 0.45 * (k.n / maxN)) / top1) * mk) * mH).toFixed(1)}" class="sp-meas"/>`;
      }
    }
    if (split) {
      s += `<line x1="0" x2="${o.w}" y1="${mid}" y2="${mid}" class="sp-ax"/>`;
      for (const l of ov.links) s += `<path d="M${xs(l.m).toFixed(1)},${mid - BASE_GAP}L${xs(l.p).toFixed(1)},${mid + BASE_GAP}" class="sp-link sp-${l.sev}"/>`;
    } else {
      // one baseline: a short tick under each matched pair, measured to predicted
      for (const l of ov.links) s += `<path d="M${xs(l.m).toFixed(1)},${o.h - bot + 1}L${xs(l.p).toFixed(1)},${o.h - bot + 1}" class="sp-link sp-${l.sev}" stroke-width="3"/>`;
    }
    const placed: number[] = [];
    for (const m of [...ov.marks].sort((a, b) => b.ppm - a.ppm)) {
      let x = xs(m.ppm);
      if (x < 0 || x > o.w) continue;
      for (const q of placed) if (Math.abs(q - x) < 56) x = q + 56;
      placed.push(x);
      s += `<text x="${x.toFixed(1)}" y="12" text-anchor="middle" class="sp-mark sp-${m.sev}">${esc(m.text)}</text>`;
    }
    // (stacked: "Predicted" at the top of its band, clear of its baseline)
    if (split) s += `<text x="5" y="${top + 10}" class="sp-tick">Measured</text><text x="5" y="${cmp === 'stacked' ? mid + BASE_GAP + 10 : o.h - bot - BASE_GAP - 4}" class="sp-tick">Predicted</text>`;
    else s += `<line x1="6" x2="20" y1="${top + 7}" y2="${top + 7}" class="sp-meas"/><text x="24" y="${top + 10}" class="sp-tick">Measured</text><line x1="86" x2="100" y1="${top + 7}" y2="${top + 7}" class="sp-line"/><text x="104" y="${top + 10}" class="sp-tick">Predicted</text>`;
  }
  s += `<line x1="0" x2="${o.w}" y1="${o.h - bot + 0.5}" y2="${o.h - bot + 0.5}" class="sp-ax"/>`;
  if (o.cursor != null && o.cursor <= o.hi && o.cursor >= o.lo) {
    const x = xs(o.cursor), right = x > o.w - 60;
    s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${top}" y2="${o.h - bot}" class="sp-cursor"/><text x="${(x + (right ? -4 : 4)).toFixed(1)}" y="${o.h - bot - BASE_GAP - 4}" text-anchor="${right ? 'end' : 'start'}" class="sp-tick sp-cursor-at">${o.cursor.toFixed(d.nuc === '1H' ? 3 : 1)}</text>`;
  }
  for (const v of ticks(o.hi, o.lo, o.w)) {
    const x = xs(v);
    if (x < 6 || x > o.w - 6) continue;
    s += `<line x1="${x}" x2="${x}" y1="${o.h - bot + 0.5}" y2="${o.h - bot + 3.5}" class="sp-ax"/><text x="${x}" y="${o.h - 3}" text-anchor="middle" class="sp-tick">${v}</text>`;
  }
  return s + '</svg>';
}

/** The list row nearest a ppm position (within a multiplet's reach), or null. */
export function rowAt(d: SpectrumData, ppm: number, tolerance: number): number | null {
  if (d.nuc === '1H' && d.spec && d.groupRows) {
    let best: number | null = null, bd = Infinity;
    d.spec.groups.forEach((g, gi) => {
      const dist = Math.abs(g.shift - ppm), reach = multipletHalfWidth(g, d.spec!.sf) + tolerance;
      if (dist <= reach && dist < bd && d.groupRows![gi] >= 0) { bd = dist; best = d.groupRows![gi]; }
    });
    return best;
  }
  let best: number | null = null, bd = tolerance;
  for (const k of d.sticks ?? []) { const dist = Math.abs(k.shift - ppm); if (dist <= bd) { bd = dist; best = k.row; } }
  return best;
}

/** An SVG drawing as PNG bytes, with the theme variables filled in. */
export async function svgToPng(svg: string, scale = 2): Promise<Uint8Array> {
  const css = getComputedStyle(document.documentElement);
  // pictures go on white paper with dark lines, whatever the theme
  const ink = TRACE_ON_PAPER[/<svg[^>]*data-trace="maroon"/.test(svg) ? 'maroon' : 'blue'];
  const style = `<style>.sp-bg{fill:#fff}.sp-band{display:none}.sp-line{fill:none;stroke:${ink};stroke-width:1.5;stroke-linejoin:round}.sp-hot{fill:none;stroke:${css.getPropertyValue('--accent').trim() || '#0e7c86'};stroke-width:1.8}.sp-lab{font-size:10px;fill:#1d2527}.sp-tick{font-size:9.5px;fill:#5f6b6e}.sp-ax{stroke:#9aa5a7}.sp-meas{fill:none;stroke:${css.getPropertyValue('--accent').trim() || '#0e7c86'};stroke-width:1}.sp-link{fill:none;stroke-width:1.4}.sp-ok{stroke:#3c9a5f;fill:#3c9a5f}.sp-warn{stroke:#d08a1e;fill:#d08a1e}.sp-bad{stroke:#c4483e;fill:#c4483e}.sp-info{stroke:#7b8a8f;fill:#7b8a8f}.sp-mark{stroke:none;font-size:10px;font-weight:600}text{font-family:system-ui,sans-serif}</style>`;
  const solid = svg.replace(/(<svg[^>]*>)/, `$1${style}`);
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(solid)!;
  const w = +m[1], h = +m[2];
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(solid);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No picture'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export interface SpectrumWindowHost {
  /** The data for the current structure at this field and quality (null when nothing is shown). */
  data(sf: number, quality: NmrQuality): SpectrumData | null;
  hover(row: number | null): void;
  copyPicture(png: Uint8Array): Promise<void>;
  putOnCanvas(png: Uint8Array): void;
  flash(text: string): void;
  closed(): void;
  /** The solvent choice in the window's top bar (the Analysis panel's, shared); optional. */
  solvent?: { ids: readonly string[]; label(id: string): string; get(): string; set(id: string): void };
  /** Check Data…: opens the paste box for a measured list; optional. */
  checkData?(): void;
  /** Opens Settings ▸ NMR Prediction; optional. */
  openSettings?(): void;
}

/** The NMR quality setting (Fast, Balanced, Accurate), kept on this computer: the Spectrum window's
 *  dropdown and Settings ▸ Preferences change the same value. */
export function nmrQuality(): NmrQuality { try { const q = localStorage.getItem('ci-nmr-quality'); return q === 'fast' || q === 'accurate' ? q : 'balanced'; } catch { return 'balanced'; } }
export function setNmrQuality(v: NmrQuality): void { try { localStorage.setItem('ci-nmr-quality', v); } catch { /* not remembered */ } }
export function nmrSpectrumMhz(): number { try { return Number(localStorage.getItem('ci-nmr-mhz')) || 400; } catch { return 400; } }
export function setNmrSpectrumMhz(v: number): void { try { localStorage.setItem('ci-nmr-mhz', String(v)); } catch { /* not remembered */ } }

/** What a nucleus view of the window shows: the ppm range (null: all of it) and the intensity zoom
 *  (1: the tallest peak in the range shown at 3/4 of the height, refitted as the range moves). */
interface View { range: PpmRange | null; y: number }

/** What the pointer is doing in the plot. */
type Gesture =
  | { kind: 'select'; id: number; x0: number; x: number; touch: boolean }
  | { kind: 'pan'; id: number; x: number }
  | { kind: 'y'; id: number; y0: number; z0: number }
  /** On the left edge, until the drag shows its way: up or down for the height, sideways for a range. */
  | { kind: 'edge'; id: number; x0: number; y0: number; z0: number }
  | { kind: 'pinch'; d0: number; z0: number };

/** The shifts a spectrum is drawn from: when they change (a new prediction, another structure) the view starts again. */
export function spectrumKey(d: SpectrumData): string {
  return d.nuc + '|' + (d.nuc === '1H' ? (d.spec?.groups ?? []).map((g) => `${g.shift.toFixed(3)}:${g.n}`) : (d.sticks ?? []).map((k) => `${k.shift.toFixed(2)}:${k.n}`)).join(',');
}

const PLOT_HELP = 'Drag across the spectrum to zoom to a range; double-click (or double-tap) for the full spectrum. Wheel, pinch, Up and Down arrows or dragging the left edge: peak height. Shift+drag, dragging the ppm scale or Left and Right arrows: move along.';

/** The popped-out Spectrum window: drag by its title, resize from the corner, drag a range to zoom,
 *  wheel for peak height, double-click to show everything. */
export class SpectrumWindow {
  readonly el: HTMLDivElement;
  private hotRow: number | null = null;
  private d: SpectrumData | null = null;
  private ro: ResizeObserver;
  /** The pointer's ppm (the cursor line), the signal last stepped to, the measured height (log2). */
  private cursor: number | null = null;
  private step = -1;
  private measK = 0;
  /** The view of each nucleus, and the shifts it was set up for. */
  private views = new Map<string, View>();
  private keys = new Map<string, string>();
  private gesture: Gesture | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private lastTap: { t: number; x: number } | null = null;
  private plot: HTMLElement;
  private svgBox: HTMLElement;

  get sf(): number { return nmrSpectrumMhz(); }
  set sf(v: number) { setNmrSpectrumMhz(v); }
  get quality(): NmrQuality { return nmrQuality(); }
  set quality(v: NmrQuality) { setNmrQuality(v); }

  /** The view of the nucleus shown. */
  private get view(): View {
    const n = this.d?.nuc ?? '1H';
    let v = this.views.get(n);
    if (!v) this.views.set(n, (v = { range: null, y: 1 }));
    return v;
  }
  private get range(): PpmRange | null { return this.view.range; }

  constructor(private host: SpectrumWindowHost) {
    const el = document.createElement('div');
    el.className = 'nmr-spec-win';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Predicted spectrum');
    const sol = host.solvent;
    el.innerHTML = `<div class="nmr-spec-hd"><span class="nmr-spec-title"></span><span class="info-icon" tabindex="0" role="img" aria-label="About the spectrum" title="Simulated from the predicted shifts and coupling constants. Coupled protons are simulated exactly, so second-order patterns (roofing, AA'XX') show as they would be measured. Couplings come from the 2D structure, so ring protons use averaged values. ${PLOT_HELP} Hover a peak to find its atoms.">i</span>
      <span class="nmr-spec-tools"><select class="nmr-spec-mhz" title="Spectrometer frequency">${[300, 400, 500, 600, 800].map((m) => `<option value="${m}"${m === this.sf ? ' selected' : ''}>${m} MHz</option>`).join('')}</select><select class="nmr-spec-quality" title="Fast: first-order multiplets. Balanced: exact simulation of up to 8 coupled protons. Accurate: up to 10.">${(['fast', 'balanced', 'accurate'] as const).map((q) => `<option value="${q}"${q === this.quality ? ' selected' : ''}>${q[0].toUpperCase() + q.slice(1)}</option>`).join('')}</select><button type="button" class="nmr-spec-copy" title="Copy the spectrum as a picture">Copy as Picture</button><button type="button" class="nmr-spec-put" title="Put the spectrum on the drawing as a picture">Put on Canvas</button><button type="button" class="nmr-spec-close" aria-label="Close" title="Close">×</button></span></div>
      <div class="nmr-spec-bar" role="toolbar" aria-label="Spectrum">${sol ? `<select class="nmr-spec-solvent" title="Solvent" aria-label="Solvent">${sol.ids.map((s) => `<option value="${esc(s)}"${s === sol.get() ? ' selected' : ''}>${esc(sol.label(s))}</option>`).join('')}</select>` : ''}${host.checkData ? '<button type="button" class="nmr-spec-check" title="Compare a measured peak list (pasted in SI format) with the prediction">Check Data…</button>' : ''}${host.openSettings ? `<button type="button" class="nmr-spec-gear" title="NMR Settings" aria-label="NMR Settings">${GEAR}</button>` : ''}<span class="nmr-spec-sep" aria-hidden="true"></span><button type="button" class="nmr-yout" title="Decrease Intensity (−, Down arrow, wheel down, or drag down on the left edge)" aria-label="Decrease Intensity">−</button><button type="button" class="nmr-yin" title="Increase Intensity (+, Up arrow, wheel up, or drag up on the left edge)" aria-label="Increase Intensity">+</button><button type="button" class="nmr-fit" title="Reset View: the full spectrum at the standard height (0, or double-click the spectrum)" aria-label="Reset View">Reset View</button><span class="nmr-spec-sep" aria-hidden="true"></span><button type="button" class="nmr-prev" title="Previous Signal (zooms to it)" aria-label="Previous Signal">◀</button><button type="button" class="nmr-next" title="Next Signal (zooms to it)" aria-label="Next Signal">▶</button><span class="nmr-cmp seg" role="group" aria-label="Measured against predicted">${(['inverted', 'stacked', 'overlay'] as const).map((m) => `<button type="button" data-cmp="${m}" aria-pressed="${m === compareMode()}" title="${{ inverted: 'Inverted: measured above, predicted mirrored below', stacked: 'Stacked: measured above predicted, both upright', overlay: 'Overlay: both on one baseline' }[m]}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</span><input type="range" class="nmr-meas-k" min="-2" max="2" step="0.1" value="0" title="Height of the measured trace against the predicted one (double-click to reset)" aria-label="Measured height"></div>
      <div class="nmr-spec-plot" tabindex="0" aria-label="Spectrum. ${PLOT_HELP}"><div class="nmr-spec-svg"></div><div class="nmr-yzone" role="img" aria-label="Peak height: drag up or down" title="Drag up or down to change the peak height (drag sideways to zoom to a range)"></div><div class="nmr-xzone" role="img" aria-label="Move along: drag the ppm scale" title="Drag to move along the spectrum"></div></div>`;
    this.el = el;
    document.body.appendChild(el);
    const plot = this.plot = el.querySelector<HTMLElement>('.nmr-spec-plot')!;
    this.svgBox = el.querySelector<HTMLElement>('.nmr-spec-svg')!;
    // drag by the title bar
    const hd = el.querySelector<HTMLElement>('.nmr-spec-hd')!;
    hd.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('select, button, .info-icon')) return;
      const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      hd.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx))}px`;
        el.style.top = `${Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - dy))}px`;
      };
      const up = () => { hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); };
      hd.addEventListener('pointermove', move);
      hd.addEventListener('pointerup', up);
    });
    el.querySelector('.nmr-spec-mhz')!.addEventListener('change', (e) => { this.sf = Number((e.target as HTMLSelectElement).value); this.refresh(); });
    el.querySelector('.nmr-spec-quality')!.addEventListener('change', (e) => { this.quality = (e.target as HTMLSelectElement).value as NmrQuality; this.refresh(); });
    el.querySelector('.nmr-spec-solvent')?.addEventListener('change', (e) => sol?.set((e.target as HTMLSelectElement).value));
    el.querySelector('.nmr-spec-check')?.addEventListener('click', () => host.checkData?.());
    el.querySelector('.nmr-spec-gear')?.addEventListener('click', () => host.openSettings?.());
    el.querySelector('.nmr-spec-close')!.addEventListener('click', () => this.close());
    el.querySelector('.nmr-spec-copy')!.addEventListener('click', () => void this.picture().then((p) => this.host.copyPicture(p)).then(() => this.host.flash('Copied the spectrum as a picture.'), () => this.host.flash('Copying was refused by the system.')));
    el.querySelector('.nmr-spec-put')!.addEventListener('click', () => void this.picture().then((p) => this.host.putOnCanvas(p), () => this.host.flash('Couldn\'t create the picture.')));

    // the wheel (and a trackpad's two-finger scroll and pinch) changes the peak height; sideways moves along
    let lastGesture = 0;
    plot.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.d) return;
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) { this.pan(-e.deltaX * (e.deltaMode === 1 ? 16 : 1)); return; }
      if (e.ctrlKey && performance.now() - lastGesture < 250) return; // Safari sends its pinch as gesture events too
      this.setY(wheelZoom(this.view.y, e.deltaY, e.deltaMode, e.ctrlKey));
    }, { passive: false });
    // Safari's own pinch (the Mac app): the peak height, never the page's zoom
    let g0 = 1;
    plot.addEventListener('gesturestart', (e) => { e.preventDefault(); g0 = this.view.y; lastGesture = performance.now(); });
    plot.addEventListener('gesturechange', (e) => { e.preventDefault(); lastGesture = performance.now(); const k = (e as Event & { scale?: number }).scale; if (k) this.setY(g0 * k); });
    plot.addEventListener('dblclick', (e) => { e.preventDefault(); this.resetView(); });
    plot.addEventListener('pointerdown', (e) => this.down(e));
    plot.addEventListener('pointermove', (e) => this.move(e));
    plot.addEventListener('pointerup', (e) => this.up(e));
    plot.addEventListener('pointercancel', (e) => { this.touches.delete(e.pointerId); this.gesture = null; this.draw(); });
    plot.addEventListener('pointerleave', (e) => {
      if (this.gesture || this.touches.has(e.pointerId)) return;
      this.cursor = null; if (this.hotRow !== null) { this.hotRow = null; this.host.hover(null); } this.draw();
    });
    // the comparison tools
    for (const b of el.querySelectorAll<HTMLButtonElement>('.nmr-cmp button')) b.addEventListener('click', () => {
      setCompareMode(b.dataset.cmp as CompareMode);
      for (const x of el.querySelectorAll('.nmr-cmp button')) x.setAttribute('aria-pressed', String(x === b));
      this.draw();
    });
    const k = el.querySelector<HTMLInputElement>('.nmr-meas-k')!;
    k.addEventListener('input', () => { this.measK = Number(k.value); this.draw(); });
    k.addEventListener('dblclick', () => { k.value = '0'; this.measK = 0; this.draw(); });
    el.querySelector('.nmr-yin')!.addEventListener('click', () => this.setY(stepZoom(this.view.y, 1)));
    el.querySelector('.nmr-yout')!.addEventListener('click', () => this.setY(stepZoom(this.view.y, -1)));
    el.querySelector('.nmr-fit')!.addEventListener('click', () => this.resetView());
    el.querySelector('.nmr-prev')!.addEventListener('click', () => this.stepTo(-1));
    el.querySelector('.nmr-next')!.addEventListener('click', () => this.stepTo(1));
    el.tabIndex = -1;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Esc while dragging out a range drops the range; otherwise it closes the window
        if (this.gesture) { e.preventDefault(); e.stopPropagation(); this.gesture = null; this.draw(); return; }
        this.close();
        return;
      }
      // (Ctrl/Cmd with − + 0 zooms the page, Alt+arrows go back and forward: never the spectrum's)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('select, input')) return;
      const onPlot = e.target === plot, w = Math.max(200, plot.clientWidth);
      if (onPlot && e.key === 'ArrowLeft') { e.preventDefault(); this.pan(w / 10); }
      else if (onPlot && e.key === 'ArrowRight') { e.preventDefault(); this.pan(-w / 10); }
      else if (onPlot && e.key === 'ArrowUp') { e.preventDefault(); this.setY(stepZoom(this.view.y, 1)); }
      else if (onPlot && e.key === 'ArrowDown') { e.preventDefault(); this.setY(stepZoom(this.view.y, -1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.stepTo(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.stepTo(1); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); this.setY(stepZoom(this.view.y, 1)); }
      else if (e.key === '-' || e.key === '−' || e.key === '_') { e.preventDefault(); this.setY(stepZoom(this.view.y, -1)); }
      else if (e.key === '0') { e.preventDefault(); this.resetView(); }
    });
    // a new size keeps the ppm range shown (the view is kept in ppm, not pixels)
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(plot);
  }

  /** The pointer's x in the plot, px. */
  private px(e: { clientX: number }): number { return e.clientX - this.plot.getBoundingClientRect().left; }

  private down(e: PointerEvent): void {
    if (!this.d) return;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        // two fingers: pinch up and down for the peak height (a range being dragged out is dropped)
        const [a, b] = [...this.touches.values()];
        this.gesture = { kind: 'pinch', d0: Math.max(20, Math.abs(a.y - b.y)), z0: this.view.y };
        this.draw();
        return;
      }
      if (this.touches.size > 2) return;
    } else if (e.button !== 0) return;
    try { this.plot.setPointerCapture(e.pointerId); } catch { /* not captured */ }
    this.plot.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    const t = e.target as HTMLElement;
    if (t.closest('.nmr-yzone')) this.gesture = { kind: 'edge', id: e.pointerId, x0: this.px(e), y0: e.clientY, z0: this.view.y };
    else if (t.closest('.nmr-xzone') || e.shiftKey) this.gesture = { kind: 'pan', id: e.pointerId, x: e.clientX };
    else { const x = this.px(e); this.gesture = { kind: 'select', id: e.pointerId, x0: x, x, touch: e.pointerType === 'touch' }; }
    if (e.pointerType !== 'mouse') e.preventDefault();
  }

  private move(e: PointerEvent): void {
    if (!this.d) return;
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture, w = Math.max(200, this.plot.clientWidth);
    if (g?.kind === 'pinch') {
      const [a, b] = [...this.touches.values()];
      if (a && b) this.setY(g.z0 * (Math.max(20, Math.abs(a.y - b.y)) / g.d0));
      return;
    }
    if (g && 'id' in g && g.id !== e.pointerId) return;
    if (g?.kind === 'edge') {
      // the left edge: a drag sideways still selects a range, so the highest ppm can be reached from there
      const dx = this.px(e) - g.x0, dy = e.clientY - g.y0;
      if (Math.abs(dx) >= CLICK_PX && Math.abs(dx) > Math.abs(dy)) this.gesture = { kind: 'select', id: g.id, x0: g.x0, x: g.x0, touch: e.pointerType === 'touch' };
      else if (Math.abs(dy) >= CLICK_PX) this.gesture = { kind: 'y', id: g.id, y0: g.y0, z0: g.z0 };
      else return;
      this.move(e);
      return;
    }
    if (g?.kind === 'y') { this.setY(dragZoom(g.z0, e.clientY - g.y0)); return; }
    if (g?.kind === 'pan') { this.pan(e.clientX - g.x); g.x = e.clientX; }
    if (g?.kind === 'select') g.x = this.px(e);
    const r = this.range ?? autoRange(this.d);
    const ppm = ppmAt(this.px(e), w, r);
    this.cursor = ppm;
    const row = rowAt(this.d, ppm, (r.hi - r.lo) / 80);
    if (row !== this.hotRow) { this.hotRow = row; this.host.hover(row); }
    this.draw();
  }

  private up(e: PointerEvent): void {
    const wasTouch = this.touches.delete(e.pointerId);
    const g = this.gesture;
    if (g?.kind === 'pinch') { if (!this.touches.size) this.gesture = null; return; }
    if (!g || !('id' in g) || g.id !== e.pointerId || !this.d) return;
    this.gesture = null;
    if (g.kind === 'select') {
      const w = Math.max(200, this.plot.clientWidth);
      const r = rangeFromDrag(g.x0, this.px(e), w, this.range ?? autoRange(this.d), this.d.nuc === '1H' ? 0.05 : 2);
      if (r) { this.zoomTo(r); return; }
      // a tap: two close together show the full spectrum (a mouse has dblclick)
      if (wasTouch) {
        const now = performance.now();
        if (this.lastTap && now - this.lastTap.t < 350 && Math.abs(this.lastTap.x - g.x0) < 30) { this.lastTap = null; this.resetView(); return; }
        this.lastTap = { t: now, x: g.x0 };
      }
    }
    this.draw();
  }

  /** Shows a range (null: the whole spectrum), the tallest peak in it at 3/4 of the height. */
  private zoomTo(r: PpmRange | null): void {
    if (!this.d) return;
    const v = this.view;
    v.range = r ? clampRange(r, autoRange(this.d)) : null;
    v.y = 1;
    this.draw();
  }

  /** The full spectrum at the standard height (double-click, Reset View, 0). */
  resetView(): void { this.step = -1; this.zoomTo(null); }

  /** The view shown: the ppm range (null: the whole spectrum) and the intensity zoom. */
  get shownView(): { range: PpmRange | null; y: number } { const v = this.view; return { range: v.range && { ...v.range }, y: v.y }; }

  /** Forgets every nucleus's view (another structure). */
  forget(): void { this.views.clear(); this.keys.clear(); }

  /** Moves the range shown by dx px (positive: toward higher ppm), within the spectrum. */
  private pan(dx: number): void {
    const v = this.view;
    if (!this.d || !v.range || !dx) return;
    // (the height is fitted again to the range now showing, keeping the intensity zoom)
    v.range = panRange(v.range, dx, Math.max(200, this.plot.clientWidth), autoRange(this.d));
    this.draw();
  }

  private setY(y: number): void { this.view.y = clampYZoom(y); this.draw(); }

  /** Shows the window near the panel (first time) and draws the current structure. */
  open(near: DOMRect | null): void {
    if (!this.el.style.left) {
      const w = Math.min(900, window.innerWidth - 40);
      this.el.style.width = `${w}px`;
      this.el.style.left = `${Math.max(10, (near ? near.left : window.innerWidth) - w - 16)}px`;
      this.el.style.top = `${Math.max(60, window.innerHeight - 380)}px`;
    }
    this.el.hidden = false;
    this.refresh();
  }

  close(): void { this.gesture = null; this.el.hidden = true; this.host.hover(null); this.host.closed(); }
  get visible(): boolean { return !this.el.hidden; }

  /** Re-reads the data (structure, nucleus, field or quality changed). */
  refresh(): void {
    if (this.el.hidden) return;
    const qs = this.el.querySelector<HTMLSelectElement>('.nmr-spec-quality');
    if (qs) qs.value = this.quality;
    const ss = this.el.querySelector<HTMLSelectElement>('.nmr-spec-solvent');
    if (ss && this.host.solvent) ss.value = this.host.solvent.get();
    this.d = this.host.data(this.sf, this.quality);
    // a new prediction or another structure starts its view again; another nucleus has its own
    if (this.d) {
      const key = spectrumKey(this.d);
      if (this.keys.get(this.d.nuc) !== key) { this.keys.set(this.d.nuc, key); this.views.delete(this.d.nuc); }
      // a measured list (Check Data) can change the full range: the view kept stays inside it
      const v = this.view;
      if (v.range) v.range = clampRange(v.range, autoRange(this.d));
    }
    const n = this.d?.nuc ?? '1H';
    const nucHtml = `<sup>${n.slice(0, -1)}</sup>${n.slice(-1)}`;
    this.el.querySelector('.nmr-spec-title')!.innerHTML = this.d?.measured ? `Measured vs Predicted ${nucHtml} Spectrum` : `Predicted ${nucHtml} Spectrum`;
    this.el.querySelector<HTMLElement>('.nmr-spec-mhz')!.hidden = n !== '1H';
    this.el.querySelector<HTMLElement>('.nmr-spec-quality')!.hidden = n !== '1H';
    this.el.querySelector<HTMLElement>('.nmr-cmp')!.hidden = !this.d?.measured;
    this.el.querySelector<HTMLElement>('.nmr-meas-k')!.hidden = !this.d?.measured;
    for (const x of this.el.querySelectorAll('.nmr-cmp button')) x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.cmp === compareMode()));
    this.step = -1;
    this.draw();
  }

  /** The signals, high to low ppm: predicted ones, and with a measured list its peaks too. */
  private signals(): { ppm: number; reach: number; row: number | null }[] {
    const d = this.d;
    if (!d) return [];
    const out: { ppm: number; reach: number; row: number | null }[] = [];
    if (d.nuc === '1H' && d.spec) d.spec.groups.forEach((g, gi) => out.push({ ppm: g.shift, reach: multipletHalfWidth(g, d.spec!.sf), row: d.groupRows?.[gi] ?? null }));
    else for (const k of d.sticks ?? []) out.push({ ppm: k.shift, reach: 0, row: k.row });
    // a matched measured peak goes with its prediction (the pair is shown together)
    for (const l of d.measured?.links ?? []) { const p = out.find((x) => Math.abs(x.ppm - l.p) < 1e-6); if (p) { const lo = Math.min(p.ppm - p.reach, l.m), hi = Math.max(p.ppm + p.reach, l.m); p.ppm = (hi + lo) / 2; p.reach = (hi - lo) / 2; } }
    for (const m of d.measured?.marks ?? []) if (!out.some((x) => Math.abs(x.ppm - m.ppm) <= x.reach + 0.02)) out.push({ ppm: m.ppm, reach: 0, row: null });
    return out.sort((a, b) => b.ppm - a.ppm);
  }

  /** Step to the next (1) or previous (-1) signal, zoomed to show it whole. */
  private stepTo(dir: 1 | -1): void {
    const sig = this.signals();
    if (!sig.length || !this.d) return;
    this.step = this.step < 0 ? (dir > 0 ? 0 : sig.length - 1) : (this.step + dir + sig.length) % sig.length;
    const g = sig[this.step], pad = Math.max(this.d.nuc === '1H' ? 0.15 : 5, g.reach * 1.6);
    const step = this.step;
    this.zoomTo({ hi: g.ppm + pad, lo: g.ppm - pad });
    this.step = step;
    this.hotRow = g.row;
    this.host.hover(g.row);
    this.draw();
  }

  /** Highlights a list row's peaks (hover in the panel). */
  highlight(row: number | null): void { if (row !== this.hotRow) { this.hotRow = row; this.draw(); } }

  /** What the view draws: the range, the intensity and the range being dragged out. */
  private viewOpts(): Pick<DrawOpts, 'hi' | 'lo' | 'yZoom'> {
    const v = this.view, r = v.range ?? autoRange(this.d!);
    return { hi: r.hi, lo: r.lo, yZoom: v.y };
  }

  /** Draws on the next frame: a burst of pointer moves or wheel steps is drawn once. */
  private draw(): void {
    if (typeof requestAnimationFrame !== 'function') { this.drawNow(); return; }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.drawNow(); });
  }
  private frame = 0;

  private drawNow(): void {
    if (this.el.hidden) return;
    const box = this.svgBox, plot = this.plot;
    if (!this.d) { box.innerHTML = '<p class="muted small">Select a structure to see its predicted spectrum.</p>'; return; }
    const w = Math.max(200, plot.clientWidth), h = Math.max(120, plot.clientHeight);
    const g = this.gesture, vo = this.viewOpts();
    const band = g?.kind === 'select' && Math.abs(g.x - g.x0) >= CLICK_PX ? { hi: ppmAt(Math.min(g.x0, g.x), w, vo), lo: ppmAt(Math.max(g.x0, g.x), w, vo) } : null;
    box.innerHTML = spectrumSvg(this.d, { w, h, ...vo, labels: true, hotRow: this.hotRow, overlay: true, peakLabels: peakLabels(), compare: compareMode(), measScale: 2 ** this.measK, cursor: this.cursor, band, emptyNote: this.view.range ? 'No peaks in this range. Double-click to show everything.' : undefined });
    plot.classList.toggle('zoomed', !!this.view.range);
  }

  private picture(): Promise<Uint8Array> {
    if (!this.d) return Promise.reject(new Error('Nothing to copy'));
    return svgToPng(spectrumSvg(this.d, { w: 720, h: 260, ...this.viewOpts(), labels: true, hotRow: null, overlay: true, peakLabels: peakLabels(), compare: compareMode(), measScale: 2 ** this.measK }));
  }

  dispose(): void { this.ro.disconnect(); this.el.remove(); }
}

/** The peak labels in the band at the top, kept apart from one another, with a line down to the peak when moved off it. */
function drawPeakLabels(items: { ppm: number; row: number; lines: string[] }[], p: PeakLabels, o: DrawOpts, xs: (v: number) => number, top: number): string {
  const lh = p.size * 1.2, cw = p.size * 0.56;
  const shown = items
    .map((it) => ({ ...it, x: xs(it.ppm), lines: p.hover && it.row !== o.hotRow ? it.lines.slice(0, 1) : it.lines }))
    .filter((it) => it.lines.length && it.x >= 0 && it.x <= o.w)
    .sort((a, b) => a.x - b.x);
  const font = `font-size="${p.size}"`;
  let s = '';
  if (p.place === 'upright') {
    let last = -Infinity;
    for (const it of shown) {
      const x = Math.max(it.x, last + lh);
      last = x;
      s += `<text transform="translate(${(x + p.size * 0.35).toFixed(1)},${(top - 4).toFixed(1)}) rotate(-90)" class="sp-lab" ${font}>${esc(it.lines.join(' · '))}</text>`;
      if (Math.abs(x - it.x) > 2) s += `<path d="M${x.toFixed(1)},${top - 2}L${it.x.toFixed(1)},${top + 4}" class="sp-lead"/>`;
    }
    return s;
  }
  const one = p.place === 'top';
  const text = (it: { lines: string[] }) => (one ? [it.lines.join(', ')] : it.lines);
  const width = (it: { lines: string[] }) => Math.max(...text(it).map((l) => l.length)) * cw;
  // left to right, each pushed clear of the one before; then the row pulled back inside the right edge
  const xsPlaced: number[] = [];
  let right = -Infinity;
  for (const it of shown) {
    const w = width(it);
    const x = Math.max(it.x, right + w / 2 + 6, w / 2);
    xsPlaced.push(x);
    right = x + w / 2;
  }
  for (let k = shown.length - 1, edge = o.w; k >= 0; k--) {
    const w = width(shown[k]);
    xsPlaced[k] = Math.min(xsPlaced[k], edge - w / 2);
    edge = xsPlaced[k] - w / 2 - 6;
  }
  shown.forEach((it, k) => {
    const x = xsPlaced[k], ls = text(it);
    const y0 = one ? lh : top - 6 - (ls.length - 1) * lh;
    ls.forEach((l, li) => { s += `<text x="${x.toFixed(1)}" y="${(y0 + li * lh).toFixed(1)}" text-anchor="middle" class="sp-lab" ${font}>${esc(l)}</text>`; });
    if (one || Math.abs(x - it.x) > 2) s += `<path d="M${x.toFixed(1)},${(one ? lh + 3 : top - 4).toFixed(1)}L${it.x.toFixed(1)},${(top - 1).toFixed(1)}" class="sp-lead"/>`;
  });
  return s;
}
