// Make Editable on a picture of a scheme: the rest of it made editable too, once the structures
// are read and rubbed out (leftover.ts). Arrows are found from their shape (a long thin stroke
// with a head at one end or both, or two half-headed ones side by side for an equilibrium);
// the text (reagents, conditions, compound numbers) is read by the text reader (text-reader.ts)
// and made captions, with formulas' digits as subscripts and bold kept. What is left after that
// stays as picture.

import type { Pixels } from './picture';

/** How dark pixel `i` is, 0 (paper) to 1 (ink). */
function dark(p: Pixels, i: number): number {
  const d = p.data, a = d[i * 4 + 3] / 255;
  return a * (1 - (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255);
}

const INK = 0.2;

/** A mark on the picture: its pixels (indices) and box. */
export interface Mark { pixels: number[]; x1: number; y1: number; x2: number; y2: number }

/** The marks of ink in a picture (joined 8 ways). */
export function marksOf(p: Pixels, min = 1): Mark[] {
  const W = p.width, H = p.height, n = W * H;
  const seen = new Uint8Array(n);
  const out: Mark[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || dark(p, s) <= INK) continue;
    const m: Mark = { pixels: [], x1: W, y1: H, x2: -1, y2: -1 };
    const stack = [s];
    seen[s] = 1;
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
        if (!seen[j] && dark(p, j) > INK) { seen[j] = 1; stack.push(j); }
      }
    }
    if (m.pixels.length >= min) out.push(m);
  }
  return out;
}

/** The picture with these marks made paper (and the soft edges round them). */
export function rubOut(p: Pixels, marks: Mark[]): Pixels {
  const out = new Uint8ClampedArray(p.data);
  const W = p.width, H = p.height;
  for (const m of marks) {
    for (const k of m.pixels) {
      const x = k % W, y = (k - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.set([255, 255, 255, 255], (ny * W + nx) * 4);
      }
    }
  }
  return { width: W, height: H, data: out };
}

/** An arrow found in the picture, in its pixels. */
export interface FoundArrow {
  tail: { x: number; y: number };
  head: { x: number; y: number };
  headStyle: 'none' | 'full' | 'halfLeft' | 'halfRight';
  tailStyle: 'none' | 'full' | 'halfLeft' | 'halfRight';
  headType: 'solid' | 'angle';
  /** The head's length and half its width, and the shaft's width. */
  headLength: number;
  headWidth: number;
  lineWidth: number;
  equilibrium: boolean;
  marks: Mark[];
}

interface Shape { m: Mark; cx: number; cy: number; d: { x: number; y: number }; n: { x: number; y: number }; t0: number; t1: number; w: number; span: number; mid: number }

/** A mark's long axis and how thick it is along it; null when it isn't a long straight stroke. */
function stroke(p: Pixels, m: Mark, least: number): Shape | null {
  const W = p.width, N = m.pixels.length;
  if (Math.max(m.x2 - m.x1, m.y2 - m.y1) + 1 < least) return null;
  let sx = 0, sy = 0;
  for (const k of m.pixels) { sx += k % W; sy += Math.floor(k / W); }
  const cx = sx / N, cy = sy / N;
  let xx = 0, yy = 0, xy = 0;
  for (const k of m.pixels) { const x = (k % W) - cx, y = Math.floor(k / W) - cy; xx += x * x; yy += y * y; xy += x * y; }
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
  const d = { x: Math.cos(ang), y: Math.sin(ang) }, n = { x: -d.y, y: d.x };
  let t0 = Infinity, t1 = -Infinity;
  const ts = new Float64Array(N), ss = new Float64Array(N), ks = new Float64Array(N);
  m.pixels.forEach((k, i) => {
    const x = (k % W) - cx, y = Math.floor(k / W) - cy;
    ts[i] = x * d.x + y * d.y; ss[i] = x * n.x + y * n.y; ks[i] = dark(p, k);
    if (ts[i] < t0) t0 = ts[i];
    if (ts[i] > t1) t1 = ts[i];
  });
  const L = t1 - t0 + 1;
  if (L < least) return null;
  // across it, in bins along it: how far the ink spreads, how much ink (the line's width), and its middle
  const B = Math.max(8, Math.min(60, Math.round(L / 3)));
  const lo = new Float64Array(B).fill(Infinity), hi = new Float64Array(B).fill(-Infinity), ink = new Float64Array(B), at = new Float64Array(B);
  for (let i = 0; i < N; i++) {
    const b = Math.min(B - 1, Math.floor(((ts[i] - t0) / L) * B));
    if (ss[i] < lo[b]) lo[b] = ss[i];
    if (ss[i] > hi[b]) hi[b] = ss[i];
    ink[b] += ks[i];
    at[b] += ks[i] * ss[i];
  }
  const step = L / B;
  const bins: { span: number; width: number; mid: number }[] = [];
  for (let b = 0; b < B; b++) if (hi[b] >= lo[b] && ink[b] > 0) bins.push({ span: hi[b] - lo[b] + 1, width: ink[b] / step, mid: at[b] / ink[b] });
  const med = (v: number[]) => { const q = [...v].sort((x, y) => x - y); return q[Math.floor(q.length / 2)]; };
  const span = med(bins.map((x) => x.span)), w = med(bins.map((x) => x.width)), mid = med(bins.map((x) => x.mid));
  // mostly thin, straight, and much longer than it is thick
  const thin = bins.filter((x) => x.span <= 2 * span + 1).length;
  if (thin < bins.length * 0.6 || L < 8 * span) return null;
  const straight = bins.filter((x) => x.span > 2 * span + 1 || Math.abs(x.mid - mid) <= span / 2 + 1).length;
  if (straight < bins.length * 0.9) return null;
  return { m, cx, cy, d, n, t0, t1, w, span, mid };
}

/** The head at one end of a stroke (`end` +1 the far end, -1 the near): how far its barbs reach each side, how long it is, and how filled. */
function headAt(p: Pixels, s: Shape, end: 1 | -1): { left: number; right: number; length: number; back: number; fill: number } | null {
  const W = p.width, L = s.t1 - s.t0 + 1;
  const tipT = end > 0 ? s.t1 : s.t0;
  const edge = s.span / 2 + 0.75;
  const reach = Math.min(L * 0.45, 40 * s.span + 20);
  let left = 0, right = 0, length = 0, count = 0;
  for (const k of s.m.pixels) {
    if (dark(p, k) < 0.4) continue;
    const x = (k % W) - s.cx, y = Math.floor(k / W) - s.cy;
    const t = x * s.d.x + y * s.d.y, off = x * s.n.x + y * s.n.y - s.mid;
    const back = (tipT - t) * end;
    if (back < 0 || back > reach) continue;
    // a barb: past the line's edge
    if (Math.abs(off) > edge) {
      if (off < 0) left = Math.max(left, -off); else right = Math.max(right, off);
      length = Math.max(length, back);
      count++;
    }
  }
  const big = s.span / 2 + 1.2;
  if ((left < big && right < big) || count < 3) return null;
  const hw = Math.max(left, right);
  // both sides when each reaches over half as far as the other
  const both = Math.min(left, right) >= 0.5 * hw;
  // how filled: points inside the head's triangle, between the line and a barb, are ink in a solid head and paper in an open one
  let inside = 0, tried = 0;
  for (const f of [0.5, 0.65, 0.8]) {
    const back = length * f, reachSide = hw * f;
    for (const side of [-1, 1]) {
      if ((side < 0 ? left : right) < big) continue;
      const off = side * Math.max(s.span / 2 + 1, reachSide * 0.5);
      if (Math.abs(off) >= reachSide - 0.5) continue;
      const t = tipT - back * end;
      const x = s.cx + s.d.x * t + s.n.x * (s.mid + off), y = s.cy + s.d.y * t + s.n.y * (s.mid + off);
      const xi = Math.round(x), yi = Math.round(y);
      tried++;
      if (xi >= 0 && yi >= 0 && xi < W && yi < p.height && dark(p, yi * W + xi) > 0.4) inside++;
    }
  }
  const fill = tried ? inside / tried : 1;
  return { left: both || left >= right ? left : 0, right: both || right > left ? right : 0, length: Math.max(length, hw), back: length, fill };
}

/**
 * The straight arrows in a picture (the structures already rubbed out): `least` is the shortest
 * an arrow can be (pixels). Curved, dashed and other arrows aren't found, and stay as picture.
 */
export function findArrows(p: Pixels, least: number): FoundArrow[] {
  const found: FoundArrow[] = [];
  for (const m of marksOf(p, Math.max(8, least))) {
    const s = stroke(p, m, least);
    if (!s) continue;
    const a = headAt(p, s, 1), b = headAt(p, s, -1);
    // a bracket's end: a short bar straight across (an arrowhead's barbs sweep back along the line)
    const serif = (h: typeof a) => !!h && h.back < 0.6 * Math.max(h.left, h.right) && !(h.left && h.right && Math.min(h.left, h.right) >= 0.5 * Math.max(h.left, h.right));
    if (serif(a) || serif(b)) continue;
    const end = (t: number) => ({ x: s.cx + s.d.x * t + s.n.x * s.mid, y: s.cy + s.d.y * t + s.n.y * s.mid });
    // the head is at the far end (+1) unless only the near end has one
    const flip = !a && !!b;
    const head = flip ? b : a, tail = flip ? null : b;
    // a barb on the left of the way it points (the picture's y goes down: left is -n going +d)
    const style = (h: NonNullable<typeof a>, dir: 1 | -1) => (h.left && h.right ? 'full' : (h.left ? 1 : -1) * dir > 0 ? 'halfLeft' : 'halfRight') as FoundArrow['headStyle'];
    const dir: 1 | -1 = flip ? -1 : 1;
    found.push({
      tail: end(flip ? s.t1 : s.t0), head: end(flip ? s.t0 : s.t1),
      headStyle: head ? style(head, dir) : 'none',
      tailStyle: tail ? style(tail, (-dir) as 1 | -1) : 'none',
      headType: head && head.fill < 0.6 ? 'angle' : 'solid',
      headLength: head ? head.length : 0,
      headWidth: head ? Math.max(head.left, head.right) : 0,
      lineWidth: s.w,
      equilibrium: false,
      marks: [m],
    });
  }
  // two half-headed arrows side by side, pointing opposite ways: one equilibrium arrow
  const out: FoundArrow[] = [];
  const used = new Set<FoundArrow>();
  for (const a of found) {
    if (used.has(a)) continue;
    const half = (x: FoundArrow) => x.headStyle === 'halfLeft' || x.headStyle === 'halfRight';
    const pair = half(a) ? found.find((b) => b !== a && !used.has(b) && half(b) && isPair(a, b)) : undefined;
    if (pair) {
      used.add(a); used.add(pair);
      // the one pointing right (or down) leads
      const lead = a.head.x - a.tail.x + (a.head.y - a.tail.y) * 0.01 >= 0 ? a : pair, other = lead === a ? pair : a;
      out.push({ ...lead, tail: mean(lead.tail, other.head), head: mean(lead.head, other.tail), equilibrium: true, marks: [...lead.marks, ...other.marks] });
    } else out.push(a);
  }
  return out;
}

const mean = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function isPair(a: FoundArrow, b: FoundArrow): boolean {
  const da = { x: a.head.x - a.tail.x, y: a.head.y - a.tail.y }, db = { x: b.head.x - b.tail.x, y: b.head.y - b.tail.y };
  const la = Math.hypot(da.x, da.y), lb = Math.hypot(db.x, db.y);
  if (!la || !lb || Math.abs(la - lb) > 0.35 * Math.max(la, lb)) return false;
  const cos = (da.x * db.x + da.y * db.y) / (la * lb);
  if (cos > -0.97) return false;
  // close beside each other
  const ma = mean(a.tail, a.head), mb = mean(b.tail, b.head);
  const nx = -da.y / la, ny = da.x / la;
  const apart = Math.abs((mb.x - ma.x) * nx + (mb.y - ma.y) * ny), along = Math.abs((mb.x - ma.x) * da.x / la + (mb.y - ma.y) * da.y / la);
  return apart < Math.max(6 * a.lineWidth + 6, 0.25 * la) && along < 0.3 * la;
}

/** A line of text the text reader read, in the picture's pixels: its words, and the line's baseline. */
export interface ReadLine { words: { t: string; box: [number, number, number, number]; c: number }[]; base: number }

/** A caption made from text read: where (its box's left, first baseline), its lines, how big, and bold. */
export interface FoundText { x: number; y: number; w: number; lines: string[]; size: number; bold: boolean; center: boolean; marks: Mark[] }

/** Least confidence (0 to 100) the text reader's word needs to be taken. */
const SURE_WORD = 50;

/**
 * Captions from the lines read: words far apart on a line are captions of their own (compound
 * numbers under two structures); lines just under one another, overlapping, are one caption
 * (conditions in two lines). Sizes are in pixels (the height of a capital, over CAP_HEIGHT).
 */
export function captionsFrom(lines: ReadLine[], p: Pixels, marks: Mark[]): FoundText[] {
  interface Piece { x1: number; y1: number; x2: number; y2: number; base: number; words: string[]; h: number }
  const pieces: Piece[] = [];
  for (const l of lines) {
    // a word the reader is less sure of is taken beside one it is sure of (a formula in a line of
    // conditions); an A on its own after a comma is heat (Δ), which it has no letter for
    const sureLine = l.words.some((w) => w.c >= 80 && /[A-Za-z0-9]{2}/.test(w.t));
    const words = l.words.filter((w) => (w.c >= SURE_WORD || (sureLine && w.c >= 30)) && /[A-Za-z0-9]/.test(w.t)).map((w, i, all) => ({ ...w, t: /^A[,;]?$/.test(w.t) && /[,;]$/.test(all[i - 1]?.t ?? '') ? 'Δ' + w.t.slice(1) : chemWord(w.t) }));
    let cur: Piece | null = null;
    for (const w of words) {
      const [x1, y1, x2, y2] = w.box, h = y2 - y1 + 1;
      if (cur && x1 - cur.x2 <= 1.6 * Math.max(cur.h, h)) {
        cur.x2 = Math.max(cur.x2, x2); cur.y1 = Math.min(cur.y1, y1); cur.y2 = Math.max(cur.y2, y2); cur.h = Math.max(cur.h, h); cur.words.push(w.t);
      } else {
        cur = { x1, y1, x2, y2, base: l.base, words: [w.t], h };
        pieces.push(cur);
      }
    }
  }
  // lines of one caption: under one another, close, overlapping across
  pieces.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  const groups: Piece[][] = [];
  for (const pc of pieces) {
    const g = groups.find((gr) => {
      const last = gr[gr.length - 1];
      return pc.y1 - last.y2 <= 0.6 * last.h && pc.y1 > last.y1 && Math.min(pc.x2, last.x2) - Math.max(pc.x1, last.x1) > 0.3 * Math.min(pc.x2 - pc.x1, last.x2 - last.x1);
    });
    if (g) g.push(pc); else groups.push([pc]);
  }
  const W = p.width;
  return groups.map((g) => {
    const x1 = Math.min(...g.map((q) => q.x1)), x2 = Math.max(...g.map((q) => q.x2)), y1 = Math.min(...g.map((q) => q.y1)), y2 = Math.max(...g.map((q) => q.y2));
    const inside = marks.filter((m) => m.x1 >= x1 - 2 && m.x2 <= x2 + 2 && m.y1 >= y1 - 2 && m.y2 <= y2 + 2);
    // how big: from the capitals and digits (the line from the top of the tallest to the baseline)
    const first = g[0];
    const cap = Math.max(1, first.base - first.y1 + 1);
    // bold: thick strokes for the size (Arial's are about a tenth of the size, bold's a seventh)
    let area = 0, edge = 0;
    for (const m of inside) for (const k of m.pixels) {
      area++;
      const x = k % W, y = (k - x) / W;
      const ink = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < W && yy < p.height && dark(p, yy * W + xx) > INK;
      if (!ink(x - 1, y) || !ink(x + 1, y) || !ink(x, y - 1) || !ink(x, y + 1)) edge++;
    }
    const strokeW = edge ? (2 * area) / edge : 0;
    const size = cap / 0.72;
    return { x: x1, y: first.base, w: x2 - x1, lines: g.map((q) => q.words.join(' ')), size, bold: strokeW > 0.125 * size, center: g.length > 1, marks: inside };
  });
}

/**
 * A word read as a chemist wrote it. The text reader knows English, not formulas: it reads a
 * subscript as a comma (CO,Me, Et,O), chlorine's l as I (HCI, CICO,Et) and O beside a subscript as
 * a nought (H,0), and sometimes a subscript 3 as a semicolon (Ph;P, CrO;). A comma inside a word, or ending a formula's group, is its subscript: 4 after BH
 * and AlH, 3 for Ph3P, Et3N and CrO3, else 2 (the commonest; any of them can be typed over).
 */
export function chemWord(w: string): string {
  if (!/[A-Za-z]/.test(w)) return w;
  const sub = (before: string, after: string) => {
    if (/(BH|AlH)$/.test(before)) return '4';
    if ((/Ph$/.test(before) && /^P/.test(after)) || (/Et$/.test(before) && /^N/.test(after)) || /CrO$/.test(before) || /\((OMe|OEt)\)$/.test(before)) return '3';
    return '2';
  };
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const c = w[i], before = out, after = w.slice(i + 1);
    // a comma between a letter (or bracket) and a capital, digit or bracket, with no space: a subscript
    const inner = /[A-Za-z)\]]$/.test(before) && /^[A-Z0-9(]/.test(after);
    // ...or ending a formula's group (LiBH, CH,Cl, (OMe), but not THF, or 23,)
    // (a real comma may follow it: CH,Cl,, rt and Br,, Ph3P)
    const last = (!after || after === ',') && /(BH|AlH|[a-z]?H\d*Cl|\((OMe|OEt)\)|^Br|^I|\dCO)$/.test(before) && /[A-Z]/.test(before);
    if (c === ',' && (inner || last)) out += /\dCO$/.test(before) ? '3' : sub(before, after);
    else if (c === ';' && (inner || /(O|Ph)$/.test(before))) out += sub(before, after);
    else out += c;
  }
  // l read as I: Cl (HCI, CICO2Et, TBDPSCI, NaCI, AcCI), before the end, a subscript, a bracket
  // or the C or O of a formula going on (ClCO2Et, NaClO4); not CIP, CIS and the like. After a
  // small letter only in a word that starts as a formula does (Na, Ac, Ms), not in an English word
  out = out.replace(/(^|[A-Za-z0-9(])CI(?=$|[0-9,)(/;]|[CO](?![a-z]))/g, (all, pre: string) =>
    (/[a-z]/.test(pre) && !/^[A-Z]/.test(out) ? all : `${pre}Cl`));
  // O read as a nought after a group's subscript (H20 is H2O, Et20 is Et2O, (Boc)20 is (Boc)2O,
  // CH30H is CH3OH); never in a compound's label or a count of carbons (S10, C10H21)
  out = out.replace(/([A-Za-z)]+)([23])0(?=$|[^0-9])/g, (all, pre: string, d: string) => (/(?:H|D|Et|Ac|Bz|Tf|Ms|Ts|Piv|Me|\))$/.test(pre) ? `${pre}${d}O` : all));
  return out;
}

/**
 * A caption's text as runs: formulas (CH2Cl2, Et3N, H2O, Pd(PPh3)4) with their digits as
 * subscripts (the caption's formula style), the rest as it is.
 */
export function textRuns(text: string): { text: string; formula?: boolean }[] {
  const out: { text: string; formula?: boolean }[] = [];
  const push = (t: string, formula: boolean) => {
    const last = out[out.length - 1];
    if (last && !!last.formula === formula) last.text += t;
    else out.push(formula ? { text: t, formula: true } : { text: t });
  };
  for (const part of text.split(/(\s+|,|;)/)) {
    if (!part) continue;
    push(part, isFormula(part));
  }
  return out;
}

/** A word that is a formula: starts with an element or group, and has a digit after a letter or bracket (not 23, 1a, 4.0). */
export function isFormula(w: string): boolean {
  return /^\(?[A-Z][A-Za-z()[\]]*\d/.test(w) && /[A-Za-z)\]]\d/.test(w) && !/^\d/.test(w) && !/[°%]/.test(w);
}

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Where the lines of text are (the structures and arrows already rubbed out): marks of letter
 * size, side by side on a line, a letter or so apart. Each is read on its own (a reader asked
 * for a whole page passes over lone compound numbers).
 */
export function textLineBoxes(p: Pixels, marks = marksOf(p, 2)): Box[] {
  if (!marks.length) return [];
  const hs = marks.map((m) => m.y2 - m.y1 + 1).sort((a, b) => a - b);
  const typical = hs[Math.floor(hs.length * 0.75)];
  // not letters: much bigger than the text (a curved arrow, a box) stays out
  const small = marks.filter((m) => m.y2 - m.y1 + 1 <= typical * 2.5 && m.x2 - m.x1 + 1 <= typical * 6);
  const lines: Box[] = [];
  const used = new Uint8Array(small.length);
  const order = small.map((_, i) => i).sort((a, b) => small[a].x1 - small[b].x1);
  for (const i of order) {
    if (used[i]) continue;
    used[i] = 1;
    let b = { x1: small[i].x1, y1: small[i].y1, x2: small[i].x2, y2: small[i].y2 };
    for (let grew = true; grew;) {
      grew = false;
      for (const j of order) {
        if (used[j]) continue;
        const m = small[j], h = Math.max(b.y2 - b.y1 + 1, typical);
        const gap = Math.max(0, m.x1 - b.x2 - 1, b.x1 - m.x2 - 1);
        // on the line: within its height (and a little more, for dots, degree signs and subscripts)
        const within = m.y1 >= b.y1 - 0.45 * h && m.y2 <= b.y2 + 0.45 * h && Math.min(m.y2, b.y2) - Math.max(m.y1, b.y1) >= -0.1 * h;
        if (within && gap <= 0.8 * h) {
          b = { x1: Math.min(b.x1, m.x1), y1: Math.min(b.y1, m.y1), x2: Math.max(b.x2, m.x2), y2: Math.max(b.y2, m.y2) };
          used[j] = 1;
          grew = true;
        }
      }
    }
    lines.push({ x: b.x1, y: b.y1, w: b.x2 - b.x1 + 1, h: b.y2 - b.y1 + 1 });
  }
  return lines.sort((a, c) => a.y - c.y || a.x - c.x);
}

/** A line's pixels to read: with a white margin, made bigger when small (the reader likes letters about 30 pixels tall). */
export function lineCrop(p: Pixels, b: Box): { pixels: Pixels; scale: number; x: number; y: number } {
  const scale = Math.max(1, Math.min(4, Math.ceil(32 / Math.max(1, b.h))));
  const pad = Math.round(b.h * 0.5) + 4;
  const x = b.x - pad, y = b.y - pad, w = (b.w + 2 * pad) * scale, h = (b.h + 2 * pad) * scale;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let yy = 0; yy < h; yy++) {
    const sy = Math.min(p.height - 1, Math.max(0, y + (yy + 0.5) / scale - 0.5));
    for (let xx = 0; xx < w; xx++) {
      const sx = Math.min(p.width - 1, Math.max(0, x + (xx + 0.5) / scale - 0.5));
      // only the line's own box: whatever is round it stays white
      const inX = x + xx / scale, inY = y + yy / scale;
      if (inX < b.x - 1 || inX > b.x + b.w || inY < b.y - 1 || inY > b.y + b.h) continue;
      // bilinear, over white
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, p.width - 1), y1 = Math.min(y0 + 1, p.height - 1), fx = sx - x0, fy = sy - y0;
      const t = (yy * w + xx) * 4;
      for (let c = 0; c < 3; c++) {
        const v = (q: number, r: number) => { const i = (r * p.width + q) * 4, a = p.data[i + 3] / 255; return p.data[i + c] * a + 255 * (1 - a); };
        data[t + c] = (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
      }
    }
  }
  return { pixels: { width: w, height: h, data }, scale, x, y };
}
