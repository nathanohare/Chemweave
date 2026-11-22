// Torsional energy diagrams (in the Newman Projection window, Chart tab): the energy of a bond's
// conformations against the torsion between two groups, from 0° to 360°, with a Newman
// projection at each minimum and maximum, their names and the barriers between them, as in
// textbook figures of butane. Drawn as ordinary lines, curves and text inside an invisible frame
// that keeps the numbers (as energy diagrams are), so it saves to CDXML and Office files as
// drawn and opens again for editing.

import type { Arrow, Caption, Doc, Frame } from '../model';
import type { Vec } from '../geom';
import type { Measure } from '../editor/arrange';
import { chemRuns } from '../text/chemtext';
import { chordLocal, shapeBox } from '../objects';
import { frameBox } from '../editor/frames';
import { profileAt, type Extremum, type Profile } from '../chem/torsion-profile';
import { norm180, norm360, type NewmanGroup } from '../chem/newman';
import { drawEyeMark, drawNewman, newmanTextSize, type NewmanLook } from './newman';
import { frameRedrawn } from './frame-redrawn';
import { keepLabels, readLabels } from './frame-labels';

export type ConformerNames = 'textbook' | 'klyne' | 'none';

export interface TorsionData {
  /** The fitted curve (kcal/mol) and its minima and maxima. */
  profile: Profile;
  extrema: Extremum[];
  /** The groups compared (the torsion is between them) and the view at torsion `phi0`. */
  front: NewmanGroup[];
  back: NewmanGroup[];
  phi0: number;
  /** The groups the torsion is measured between (3-D model atoms, one in `front`, one in `back`). */
  a?: number;
  d?: number;
  /** Barrier arrows (each with its number) dragged to the side: points moved, by `barrierKey`. */
  shifts?: Record<string, number>;
  unit: 'kcal/mol' | 'kJ/mol';
  /** Newman projections at the minima and maxima. */
  insets: 'all' | 'minima' | 'none';
  /** synperiplanar, gauche, eclipsed, antiperiplanar (textbook); synclinal, anticlinal… (Klyne–Prelog). */
  names: ConformerNames;
  /** The energy of each minimum and maximum, with a dotted arrow up from the lowest. */
  barriers: boolean;
  /** Colour of the barrier arrows and their numbers. */
  barrierColor: string;
  digits: number;
  /** The plot's size in points. */
  w: number;
  h: number;
  method?: string;
  look: NewmanLook;
  /** A boxed sawhorse of the molecule above the plot, with the eye looking down the bond (as in textbook figures). */
  sawhorse?: boolean;
  /**
   * Where the projections at the maxima go: in one row above the plot ('rows', the usual), or each
   * just above its own peak ('follow'). The minima's are always in a row below the axis.
   */
  layout?: 'rows' | 'follow';
  /** The scan the curve was fitted to (φ in degrees, kcal/mol), for Copy Data. */
  points?: { phi: number; energy: number }[];
}

export const TORSION_DEFAULTS = { unit: 'kcal/mol' as const, insets: 'all' as const, names: 'textbook' as const, barriers: true, barrierColor: '#1a56db', digits: 1 };

const KJ = 4.184;

/** The name of a conformation at torsion φ (between the groups compared). */
export function extremumName(phi: number, kind: 'min' | 'max', names: ConformerNames): string {
  const a = Math.abs(norm180(phi));
  if (names === 'none') return '';
  if (names === 'klyne') return a < 30 ? 'synperiplanar' : a < 90 ? 'synclinal' : a < 150 ? 'anticlinal' : 'antiperiplanar';
  if (a < 30) return kind === 'max' ? 'synperiplanar' : 'eclipsed';
  if (a > 150) return 'antiperiplanar';
  return kind === 'min' ? 'gauche' : 'eclipsed';
}

/**
 * The groups as a textbook draws them at torsion φ: 120° apart on each atom, and the torsion
 * between the two compared groups taken to the nearest 60° (a gauche minimum at 65° is drawn at
 * 60°, so its bottom bond points straight down). Returns the groups and the turn for drawNewman.
 */
export function idealView(d: Pick<TorsionData, 'front' | 'back' | 'a' | 'd'>, phi: number): { front: NewmanGroup[]; back: NewmanGroup[]; turn: number } {
  const big = (gs: NewmanGroup[]) => [...gs].sort((p, q) => q.size - p.size || p.angle - q.angle)[0];
  const fr = d.front.find((g) => g.atom === d.a) ?? big(d.front), br = d.back.find((g) => g.atom === d.d) ?? big(d.back);
  const snap = (gs: NewmanGroup[], ref: NewmanGroup | undefined) => gs.map((g) => ({ ...g, angle: ref ? norm360(ref.angle + Math.round(norm180(g.angle - ref.angle) / 120) * 120) : g.angle }));
  const front = snap(d.front, fr), back = snap(d.back, br);
  if (!fr || !br) return { front, back, turn: 0 };
  const want = Math.round(phi / 60) * 60;
  return { front, back, turn: norm180(want - (br.angle - fr.angle)) };
}

/** The turning points as drawn: the one at 0° (within 10°: a scan's can sit a little off) shown at 360° too. */
function shownExtrema(d: Pick<TorsionData, 'extrema'>): Extremum[] {
  const ext = d.extrema.map((e) => ({ ...e }));
  const atZero = ext.find((e) => e.phi < 10 || e.phi > 350);
  if (atZero) { atZero.phi = 0; ext.push({ ...atZero, phi: 360 }); }
  return ext.sort((p, q) => p.phi - q.phi);
}

/** The name a barrier's sideways move is kept under. */
const barrierKey = (e: Extremum) => `${e.kind}${Math.round(e.phi)}`;

export interface TorsionParts { captions: number[]; arrows: number[]; shapes: number[]; atoms?: number[] }

/** Draw the diagram with its plot's top left corner at `at`. Call inside an edit. */
export function drawTorsion(doc: Doc, m: Measure, d: TorsionData, at: Vec): TorsionParts {
  const out: TorsionParts = { captions: [], arrows: [], shapes: [] };
  const L = doc.style.bondLength, lw = doc.style.lineWidth;
  const k = d.unit === 'kJ/mol' ? KJ : 1;
  const samples: { phi: number; e: number }[] = [];
  for (let phi = 0; phi <= 360; phi += 5) samples.push({ phi, e: profileAt(d.profile, phi) });
  const lo = Math.min(...samples.map((s) => s.e)), hi = Math.max(...samples.map((s) => s.e));
  const top = hi - lo || 1;
  const x = (phi: number) => at.x + (phi / 360) * d.w;
  const y = (e: number) => at.y + d.h - ((e - lo) / top) * d.h;
  const y0 = at.y + d.h;

  const caption = (text: string, target: Vec, anchor: 'above' | 'below' | 'left' | 'right', extra: Partial<Caption> = {}, color?: string): Caption => {
    const runs = chemRuns(text).map((r) => ({ ...r, ...(color ? { color } : {}) }));
    const c = doc.addCaption({ x: 0, y: 0, runs, justify: 'left', chem: false, ...extra });
    const b = m.captionBox(c);
    const w = b.x2 - b.x1, h = b.y2 - b.y1;
    const want = anchor === 'above' ? { x: target.x - w / 2, y: target.y - h } : anchor === 'below' ? { x: target.x - w / 2, y: target.y }
      : anchor === 'left' ? { x: target.x - w, y: target.y - h / 2 } : { x: target.x, y: target.y - h / 2 };
    doc.updateCaption(c.id, { x: c.x + want.x - b.x1, y: c.y + want.y - b.y1 });
    out.captions.push(c.id);
    return doc.captions.get(c.id)!;
  };
  const line = (a: Vec, b: Vec, more: Record<string, unknown> = {}): number => out.shapes.push(doc.addShape({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: '#000000', ...more }).id);
  const arrow = (tail: Vec, head: Vec, more: Partial<Arrow> = {}) => out.arrows.push(doc.addArrow({
    tail, head, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0,
    headLength: lw * 8, headWidth: lw * 2.6, ...more,
  }).id);

  // axes, with "E (kcal/mol)" up the side and φ at the end
  arrow({ x: at.x, y: y0 }, { x: at.x, y: at.y - 0.5 * L });
  arrow({ x: at.x, y: y0 }, { x: at.x + d.w + 1.0 * L, y: y0 });
  const ylab = caption(`E (${d.unit})`, { x: 0, y: 0 }, 'right');
  const yb = m.captionBox(ylab);
  doc.updateCaption(ylab.id, { x: at.x - 0.45 * L - (yb.y2 - ylab.y), y: at.y + d.h * 0.25 + (yb.x2 - yb.x1) / 2, rot: -90 });
  caption('φ', { x: at.x + d.w + 1.3 * L, y: y0 }, 'right', { runs: [{ text: 'φ', italic: true }] });
  for (let phi = 60; phi <= 360; phi += 60) {
    line({ x: x(phi), y: y0 - 0.2 * L }, { x: x(phi), y: y0 + 0.2 * L });
    caption(`${phi}°`, { x: x(phi), y: y0 + 0.3 * L }, 'below', { runs: [{ text: `${phi}°`, bold: true }] });
  }

  // the curve: smooth Bézier pieces through points every 5°
  const P = samples.map((s) => ({ x: x(s.phi), y: y(s.e) }));
  const bez: Vec[] = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    bez.push({ x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 });
    if (i + 2 < P.length) bez.push(p2);
  }
  const tail = P[0], head = P[P.length - 1];
  // the curve every half degree or so, for keeping words off it (steep parts jump between the 5° points)
  const dense: Vec[] = [];
  for (let i = 0; i + 1 < P.length; i++) for (let k = 0; k < 10; k++) dense.push({ x: P[i].x + ((P[i + 1].x - P[i].x) * k) / 10, y: P[i].y + ((P[i + 1].y - P[i].y) * k) / 10 });
  out.arrows.push(doc.addArrow({
    tail, head, headStyle: 'none', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0,
    headLength: 0, headWidth: 0, color: '#9a9a9a', lineWidth: lw * 1.6, bez: bez.map((q) => chordLocal(tail, head, q)), bent: true,
  }).id);

  // each minimum and maximum: a level, its projection, name and energy, and the climb to it.
  // Nothing is written inside the plot, so no words can sit on the curve: each energy goes under
  // its conformation's name, the maxima's projections in a row above the plot (or each above its
  // own peak) and the minima's in a row below the axis.
  const ext = shownExtrema(d).sort((p, q) => p.phi - q.phi);
  const bar = 0.9 * L;
  const fmt = (e: number) => (e * k).toFixed(d.digits).replace(/^-/, '−');
  const rows = (d.layout ?? 'rows') === 'rows';
  const wanted = (e: Extremum) => d.insets === 'all' || (d.insets === 'minima' && e.kind === 'min');
  // every projection with its labels the same size: the smallest any of them needs
  let look = d.look;
  if (look.text?.auto) {
    let least = 1;
    for (const e of ext) {
      if (!wanted(e) || e.phi === 360) continue;
      const v = idealView(d, e.phi);
      const parts = drawNewman(doc, m, { kind: 'newman', front: v.front, back: v.back, turn: v.turn, conformer: 0, source: 'angle', look }, { x: 0, y: 0 });
      least = Math.min(least, parts.scale ?? 1);
      for (const id of parts.captions) doc.removeCaption(id);
      for (const id of parts.shapes) doc.removeShape(id);
      for (const id of parts.arrows) doc.removeArrow(id);
    }
    look = { ...look, text: { ...look.text, size: Math.round(newmanTextSize(look, doc.style.captionSize) * least * 100) / 100, auto: false } };
  }
  type Block = { e: Extremum; captions: number[]; shapes: number[]; arrows: number[]; x1: number; x2: number; y1: number; y2: number; dx: number };
  /** A projection with its name and energy under it, drawn centred on x with its top at 0: moved into place after. */
  const block = (e: Extremum, cx: number): Block => {
    const b: Block = { e, captions: [], shapes: [], arrows: [], x1: cx, x2: cx, y1: 0, y2: 0, dx: 0 };
    let yy = 0;
    const grow = (r: { x1: number; y1: number; x2: number; y2: number }) => { b.x1 = Math.min(b.x1, r.x1); b.x2 = Math.max(b.x2, r.x2); b.y2 = Math.max(b.y2, r.y2); };
    if (wanted(e)) {
      const v = idealView(d, e.phi);
      const parts = drawNewman(doc, m, { kind: 'newman', front: v.front, back: v.back, turn: v.turn, conformer: 0, source: 'angle', look }, { x: cx, y: 0 });
      const boxes = [...parts.captions.map((id) => m.captionBox(doc.captions.get(id)!)), ...parts.shapes.map((id) => shapeBox(doc.shapes.get(id)!))];
      const top = Math.min(...boxes.map((r) => r.y1));
      for (const id of parts.captions) { const c = doc.captions.get(id)!; doc.updateCaption(id, { y: c.y - top }); }
      for (const id of parts.shapes) { const sh = doc.shapes.get(id)!; doc.updateShape(id, { y1: sh.y1 - top, y2: sh.y2 - top }); }
      for (const id of parts.arrows) { const a = doc.arrows.get(id)!; doc.updateArrow(id, { tail: { x: a.tail.x, y: a.tail.y - top }, head: { x: a.head.x, y: a.head.y - top } }); }
      b.captions.push(...parts.captions); b.shapes.push(...parts.shapes); b.arrows.push(...parts.arrows);
      for (const r of boxes) grow({ ...r, y1: r.y1 - top, y2: r.y2 - top });
      yy = b.y2 + 0.1 * L;
    }
    const words = (text: string, runs: Caption['runs']) => {
      const cap = caption(text, { x: cx, y: yy }, 'below', { runs });
      out.captions.pop();
      b.captions.push(cap.id);
      const r = m.captionBox(cap);
      grow(r);
      yy = r.y2;
    };
    const name = extremumName(e.phi, e.kind, d.names);
    if (name) words(name, [{ text: name, italic: true }]);
    if (d.barriers) { const text = `${fmt(e.energy)} ${d.unit}`; words(text, [{ text, bold: true, color: d.barrierColor, size: doc.style.captionSize * 0.9 }]); }
    return b;
  };
  const move = (b: Block, dx: number, dy: number) => {
    for (const id of b.captions) { const c = doc.captions.get(id)!; doc.updateCaption(id, { x: c.x + dx, y: c.y + dy }); }
    for (const id of b.shapes) { const sh = doc.shapes.get(id)!; doc.updateShape(id, { x1: sh.x1 + dx, y1: sh.y1 + dy, x2: sh.x2 + dx, y2: sh.y2 + dy }); }
    for (const id of b.arrows) { const a = doc.arrows.get(id)!; doc.updateArrow(id, { tail: { x: a.tail.x + dx, y: a.tail.y + dy }, head: { x: a.head.x + dx, y: a.head.y + dy } }); }
    b.x1 += dx; b.x2 += dx; b.y1 += dy; b.y2 += dy; b.dx += dx;
    out.captions.push(...b.captions); out.shapes.push(...b.shapes); out.arrows.push(...b.arrows);
  };
  /** Blocks in one row kept from touching: each pushed just clear of the one on its left, the row then centred on where it was. */
  const apart = (bs: Block[]): number[] => {
    const gap = 0.35 * L, dx = bs.map(() => 0);
    for (let i = 1; i < bs.length; i++) { const over = bs[i - 1].x2 + dx[i - 1] + gap - (bs[i].x1 + dx[i]); if (over > 0) dx[i] += over; }
    const mean = dx.reduce((p, q) => p + q, 0) / (dx.length || 1);
    return dx.map((v) => v - mean);
  };
  const lows = ext.filter((e) => e.kind === 'min').map((e) => block(e, x(e.phi)));
  const highs = ext.filter((e) => e.kind === 'max').map((e) => block(e, x(e.phi)));
  const lowDx = apart(lows);
  lows.forEach((b, i) => move(b, lowDx[i], y0 + 1.1 * L));
  const peakTop = at.y - 0.5 * L;
  if (rows) {
    const tall = Math.max(0, ...highs.map((b) => b.y2));
    const highDx = apart(highs);
    highs.forEach((b, i) => move(b, highDx[i], peakTop - 0.5 * L - tall));
  } else {
    // each above its own peak, pushed up clear of the one before where they would touch
    highs.forEach((b, i) => {
      const py = y(b.e.energy + lo);
      let top = Math.min(py - 0.35 * L, b.e.phi === 0 ? peakTop - 0.2 * L : Infinity) - b.y2;
      const prev = highs[i - 1];
      if (prev && prev.x2 + 0.35 * L > b.x1 && top + b.y2 > prev.y1 - 0.2 * L && top < prev.y2) top = prev.y1 - 0.3 * L - b.y2;
      move(b, 0, top);
    });
  }
  const shown: Extremum[] = [];
  for (const b of [...lows, ...highs]) {
    const e = b.e;
    const px = x(e.phi), py = y(e.energy + lo);
    const half = bar / 2;
    if (e.energy > 0.02) line({ x: Math.max(at.x, px - half), y: py }, { x: Math.min(at.x + d.w, px + half), y: py });
    // a thin grey leader from a level to its projection, where the row had to move it aside or sits well above the peak
    const mid = (b.x1 + b.x2) / 2;
    if (e.kind === 'max' && (rows || Math.abs(b.dx) > 1) && b.y2 < py - 0.6 * L) line({ x: px, y: py - 0.15 * L }, { x: mid, y: b.y2 + 0.15 * L }, { color: '#b0b0b0', dotted: true, dashed: true });
    if (e.kind === 'min' && Math.abs(b.dx) > 1) line({ x: px, y: y0 + 0.95 * L }, { x: mid, y: b.y1 - 0.05 * L }, { color: '#b0b0b0', dotted: true, dashed: true });
    if (!d.barriers || e.energy <= 0.02 || e.phi === 0) continue;
    // one climb for each distinct height (the mirror-image conformation has the same one)
    if (shown.some((o) => o.kind === e.kind && Math.abs(o.energy - e.energy) < 0.3)) continue;
    shown.push(e);
    // dragged to the side: past the end of its level, a dashed grey line leads back to it
    const ax = px + (d.shifts?.[barrierKey(e)] ?? 0);
    if (Math.abs(ax - px) > half) line({ x: ax, y: py }, { x: px + Math.sign(ax - px) * half, y: py }, { color: '#9a9a9a', dashed: true });
    if (y0 - py > lw * 10) arrow({ x: ax, y: y0 }, { x: ax, y: py + lw }, { line: 'dashed', color: d.barrierColor, headLength: lw * 6, headWidth: lw * 2.2 });
  }
  if (d.sawhorse) drawSawhorseBox(doc, m, d, at, out);
  return out;
}

/**
 * The molecule as a sawhorse in a box above the plot's left end, with the eye and dotted arrow
 * looking down the bond from the front, as in textbook figures of butane.
 */
function drawSawhorseBox(doc: Doc, m: Measure, d: TorsionData, at: Vec, out: TorsionParts): void {
  const L = doc.style.bondLength;
  // the most stable conformation, the one the reader compares the rest with
  const lowest = [...d.extrema].filter((e) => e.kind === 'min').sort((p, q) => p.energy - q.energy)[0];
  const v = idealView(d, lowest ? lowest.phi : 180);
  const parts = drawNewman(doc, m, { kind: 'sawhorse', front: v.front, back: v.back, turn: v.turn, conformer: 0, source: 'angle', look: d.look }, { x: 0, y: 0 });
  // where the sawhorse put its two atoms (drawNewman: yaw 48°, pitch 32°, the atoms 1.35 bond lengths apart)
  const sep = 1.35 * L, yaw = (48 * Math.PI) / 180, pitch = (32 * Math.PI) / 180;
  const back = { x: sep * Math.sin(yaw), y: -sep * Math.cos(yaw) * Math.sin(pitch) };
  const mark = drawEyeMark(doc, { x: 0, y: 0 }, back, d.barrierColor, d.look.eye ?? 'plain');
  const ids = { captions: parts.captions, shapes: [...parts.shapes, ...mark.shapes], arrows: [...parts.arrows, ...mark.arrows], atoms: parts.atoms ?? [] };
  // (the sawhorse is a structure: room for a label about each of its atoms)
  const room = 0.75 * L;
  const boxes = [
    ...ids.atoms.map((id) => { const a = doc.atoms.get(id)!; const r = a.label || a.z !== 6 ? room * (1 + 0.22 * Math.max(0, (a.label ?? '').length - 2)) : 0; return { x1: a.x - r, y1: a.y - room * 0.6, x2: a.x + r, y2: a.y + room * 0.6 }; }),
    ...ids.captions.map((id) => m.captionBox(doc.captions.get(id)!)),
    ...ids.shapes.map((id) => shapeBox(doc.shapes.get(id)!)),
    ...ids.arrows.flatMap((id) => { const a = doc.arrows.get(id)!; return [{ x1: Math.min(a.tail.x, a.head.x), y1: Math.min(a.tail.y, a.head.y), x2: Math.max(a.tail.x, a.head.x), y2: Math.max(a.tail.y, a.head.y) }]; }),
  ];
  const bx1 = Math.min(...boxes.map((r) => r.x1)), by1 = Math.min(...boxes.map((r) => r.y1)), bx2 = Math.max(...boxes.map((r) => r.x2)), by2 = Math.max(...boxes.map((r) => r.y2));
  // above everything drawn so far, its left edge on the energy axis
  const tops = [
    ...out.captions.map((id) => m.captionBox(doc.captions.get(id)!).y1),
    ...out.shapes.map((id) => shapeBox(doc.shapes.get(id)!).y1),
    at.y - 0.5 * L,
  ];
  const pad = 0.3 * L;
  const dx = at.x + pad - bx1, dy = Math.min(...tops) - 0.4 * L - pad - by2;
  for (const id of ids.captions) { const c = doc.captions.get(id)!; doc.updateCaption(id, { x: c.x + dx, y: c.y + dy }); }
  for (const id of ids.shapes) { const sh = doc.shapes.get(id)!; doc.updateShape(id, { x1: sh.x1 + dx, y1: sh.y1 + dy, x2: sh.x2 + dx, y2: sh.y2 + dy }); }
  for (const id of ids.arrows) { const a = doc.arrows.get(id)!; doc.updateArrow(id, { tail: { x: a.tail.x + dx, y: a.tail.y + dy }, head: { x: a.head.x + dx, y: a.head.y + dy } }); }
  for (const id of ids.atoms) { const a = doc.atoms.get(id)!; doc.updateAtom(id, { x: a.x + dx, y: a.y + dy }); }
  (out.atoms ??= []).push(...ids.atoms);
  const box = doc.addShape({ kind: 'rect', x1: bx1 + dx - pad, y1: by1 + dy - pad, x2: bx2 + dx + pad, y2: by2 + dy + pad, color: '#000000', filled: false });
  out.captions.push(...ids.captions);
  out.shapes.push(box.id, ...ids.shapes);
  out.arrows.push(...ids.arrows);
}

/** The torsion diagram a thing belongs to (its frame's id), if any. */
export function torsionFrameOf(doc: Doc, kind: 'atom' | 'bond' | 'caption' | 'arrow' | 'shape', id: number): number | null {
  if (kind === 'shape' && doc.shapes.get(id)?.torsion) return id;
  for (const s of doc.shapes.values()) {
    if (!s.torsion || !s.frame) continue;
    const f = s.frame;
    if ((kind === 'caption' && f.captions.includes(id)) || (kind === 'arrow' && f.arrows.includes(id)) || (kind === 'shape' && f.shapes.includes(id))) return s.id;
  }
  return null;
}

/**
 * A barrier arrow or its number dragged inside a chart (the rest of the chart where it was): the
 * pair moves sideways together, kept as the chart's own, and the chart is drawn again (with a
 * dashed grey line back to the level once the arrow is past its end). Call in doc.beforeCommit.
 */
export function refitTorsion(doc: Doc, m: Measure, before: ReadonlyMap<string, unknown>): void {
  for (const s of [...doc.shapes.values()]) {
    const d = s.torsion, f = s.frame;
    if (!d || !f || before.has('s' + s.id)) continue;
    const movedArrows = f.arrows.filter((id) => before.get('r' + id));
    const movedCaps = f.captions.filter((id) => before.get('c' + id));
    if (!movedArrows.length && !movedCaps.length) continue;
    const at = plotCorner(doc, d, f.arrows);
    // the whole chart moved (its axes too): nothing to do
    if (!at || f.arrows.some((id) => before.get('r' + id) && isAxis(doc.arrows.get(id)!))) continue;
    const x = (phi: number) => at.x + (phi / 360) * d.w;
    const shifts = { ...(d.shifts ?? {}) };
    let changed = false;
    for (const e of shownExtrema(d)) {
      const key = barrierKey(e), was = x(e.phi) + (shifts[key] ?? 0);
      // the arrow that stood at this barrier
      const arrowMoved = movedArrows.find((id) => { const o = before.get('r' + id) as Arrow; return o.line === 'dashed' && o.color === d.barrierColor && Math.abs(o.tail.x - was) < 0.5 && Math.abs(o.tail.x - o.head.x) < 0.5; });
      let dx: number | null = null;
      if (arrowMoved !== undefined) dx = doc.arrows.get(arrowMoved)!.tail.x - (before.get('r' + arrowMoved) as Arrow).tail.x;
      if (dx === null || Math.abs(dx) < 0.01) continue;
      // a value shared by mirror-image turning points moves only the one drawn
      shifts[key] = (shifts[key] ?? 0) + dx;
      changed = true;
      break;
    }
    if (changed) putTorsion(doc, m, { ...d, shifts }, at, s.id);
  }
}

const isAxis = (a: Arrow) => a.line === 'solid' && !a.bez && a.headStyle !== 'none' && (!a.color || a.color === '#000000');

/** Where a drawn chart's plot starts (its top left corner), found from its axes: two arrows from one point. */
function plotCorner(doc: Doc, d: TorsionData, arrows: number[]): Vec | null {
  const axes = arrows.map((id) => doc.arrows.get(id)).filter((a): a is Arrow => !!a && isAxis(a));
  for (const a of axes) {
    if (Math.abs(a.tail.x - a.head.x) > 0.01 || a.head.y >= a.tail.y) continue;
    if (axes.some((b) => b !== a && Math.abs(b.tail.x - a.tail.x) < 0.01 && Math.abs(b.tail.y - a.tail.y) < 0.01 && Math.abs(b.head.y - b.tail.y) < 0.01)) return { x: a.tail.x, y: a.tail.y - d.h };
  }
  return null;
}

/** The scan as text to paste into a spreadsheet: φ and the energy, one row each. */
export function torsionCsv(d: Pick<TorsionData, 'points' | 'unit' | 'profile'>): string {
  const k = d.unit === 'kJ/mol' ? KJ : 1;
  const pts = d.points?.length ? d.points : Array.from({ length: 37 }, (_, i) => ({ phi: i * 10, energy: profileAt(d.profile, i * 10) }));
  return [`phi (deg)\tE (${d.unit})`, ...pts.map((p) => `${p.phi}\t${(p.energy * k).toFixed(3)}`)].join('\n');
}

/** Draw a diagram in a frame of its own, or the one in frame `id` again. Returns the frame's id. Call inside an edit. */
export function putTorsion(doc: Doc, m: Measure, d: TorsionData, at: Vec, id?: number): number {
  const old = id !== undefined ? doc.shapes.get(id) : undefined;
  // (a frame changed in another program is redrawn too, in this edit's undo step; review F1d-R01)
  frameRedrawn(doc, old);
  const was = readLabels(doc, old);
  if (old?.frame) {
    for (const x of old.frame.captions) doc.removeCaption(x);
    for (const x of old.frame.arrows) doc.removeArrow(x);
    for (const x of old.frame.shapes) doc.removeShape(x);
    for (const x of old.frame.atoms) if (doc.atoms.has(x)) doc.removeAtom(x);
  }
  const parts = drawTorsion(doc, m, d, at);
  const pad = 0.3 * doc.style.bondLength;
  const frame: Frame = { atoms: parts.atoms ?? [], captions: parts.captions, arrows: parts.arrows, shapes: parts.shapes, padX: pad, padY: pad, fit: true };
  const b = frameBox(doc, frame, m) ?? { x1: at.x, y1: at.y, x2: at.x + d.w, y2: at.y + d.h };
  // (looks set on its labels by hand stay)
  const madeLabels = keepLabels(doc, was, frame);
  if (old) { doc.updateShape(old.id, { ...b, frame, torsion: d, madeLabels, editedOutside: undefined }); return old.id; }
  return doc.addShape({ kind: 'geo', geo: 'rect', ...b, filled: false, lineWidth: 0, color: '#000000', frame, torsion: d, name: 'Torsional energy diagram', madeLabels }).id;
}
