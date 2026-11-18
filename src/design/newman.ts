// Newman and sawhorse projections (Chemistry ▸ Newman Projection…): the groups on the two ends
// of a bond as worked out by chem/newman.ts, drawn as an ordinary circle, lines and text inside
// an invisible frame that keeps the numbers and which structure and bond it shows, so the
// projection is drawn again when that structure changes, and double-clicking it opens the window
// again (as energy diagrams do). In CDXML and Office files it is a circle, lines and text, and the
// frame's numbers travel with it.

import { Doc, type Arrow, type Caption, type Frame, type Shape } from '../model';
import type { Vec } from '../geom';
import type { Measure } from '../editor/arrange';
import { chemRuns } from '../text/chemtext';
import { frameBox, frameMembers } from '../editor/frames';
import { tokenize } from '../chem/labels';
import { idealGroups, sizeRanks, type NewmanGroup } from '../chem/newman';
import { elementNumber } from '../chem/elements';
import { OLD_RING_ARC, type EyeStyle, type NewmanLook } from './newman-prefs';

export { DEFAULT_NEWMAN_PREFS, NEWMAN_LOOK, OLD_RING_ARC, parseNewmanPrefs, type EyeStyle, type NewmanLook, type NewmanPrefs, type NewmanText, type RankLook, type RingArcLook } from './newman-prefs';

/** What a projection keeps: the view it shows and where it came from. */
export interface NewmanData {
  kind: 'newman' | 'sawhorse';
  front: NewmanGroup[];
  back: NewmanGroup[];
  /** Degrees the back atom is turned from the conformer (the dial). */
  turn: number;
  /**
   * The drawn structure it shows and the bond, front atom first (drawn atom ids), while linked:
   * `key` is the structure as it was (atoms, labels, bonds and wedges), so a change to it redraws
   * the projection. In a file, ids change: `at` keeps where the bond's two atoms were drawn, and
   * they are found again there on opening.
   */
  link?: { atoms: number[]; front: number; back: number; key: string; at?: [number, number, number, number] };
  /** The viewing mark (eye and dotted arrow) drawn on the structure, while there is one. */
  mark?: { arrows: number[]; shapes: number[]; color: string; at: [number, number, number, number]; eye?: EyeStyle };
  /** Which conformer (0 = the most stable), its energy above the lowest (kcal/mol) and how it was worked out. */
  conformer: number;
  energy?: number;
  method?: string;
  /** Where the conformation came from: the most stable, as drawn, or a turned angle. */
  source: 'stable' | 'drawn' | 'angle';
  look: NewmanLook;
}

export interface NewmanParts { captions: number[]; arrows: number[]; shapes: number[]; atoms?: number[]; /** How much smaller than asked the labels were written to fit (1: full size). */ scale?: number }

const RAD = Math.PI / 180;
/** Unit vector at `deg` clockwise from up, on the page (y down). */
const dir = (deg: number): Vec => ({ x: Math.sin(deg * RAD), y: -Math.cos(deg * RAD) });

/** The label written the other way round, for a group on the left (CH3 → H3C, CO2Me → MeO2C). */
export function reversedLabel(label: string): string {
  const toks = tokenize(label);
  if (toks.length < 2 || toks.some((t) => t.kind === 'other')) return label;
  return toks.map((t) => t.text + (t.count > 1 || t.explicit ? String(t.count) : '') + t.charge).reverse().join('');
}

/** Angles the back groups are drawn at: turned by `offset` when they would sit on a front group. */
export function backAngles(front: NewmanGroup[], back: NewmanGroup[], turn: number, offset: number): number[] {
  const angles = back.map((g) => g.angle + turn);
  return isEclipsed(front, back, turn) ? angles.map((a) => a + offset) : angles;
}

/** A back group sits (within a few degrees) behind a front one. */
export function isEclipsed(front: NewmanGroup[], back: NewmanGroup[], turn: number): boolean {
  return back.some((b) => front.some((f) => Math.abs(((b.angle + turn - f.angle + 540) % 360) - 180) < 8));
}

interface Box { x1: number; y1: number; x2: number; y2: number }

/** The size a projection's labels are written at: the one chosen, else 2 points under the drawing's caption text. */
export function newmanTextSize(look: NewmanLook, captionSize: number): number {
  return look.text?.size ?? Math.max(5, captionSize - 2);
}

/** Where one group's bond and label go (drawNewman's layout, worked out before anything is drawn). */
export interface NewmanPlace {
  g: NewmanGroup; rank: 0 | 1 | 2; back: boolean;
  /** The bond, from the atom (or the circle's edge) to its end. */
  from: Vec; tip: Vec;
  /** The label as written (backwards on the left) and the box its letters fill; none for a ring bond. */
  text: string; box: Box | null;
}

/**
 * Where the bonds and labels of a Newman projection go, centred at `c`. Every label is written
 * at the end of its own bond with the bond aimed at the atom it joins (the C of CH3, written H3C
 * on the left), so a label can never come away from its bond. Labels that would touch are kept
 * apart, in this order: one above or below its bond is written the other way round; an eclipsed
 * pair is fanned further apart; the text
 * is made smaller (down to 70%, with `look.text.auto`); and last the bonds are drawn longer.
 * Returns the places and the text scale used.
 */
export function layoutNewman(d: Pick<NewmanData, 'front' | 'back' | 'turn' | 'look'>, c: Vec, L: number, measure: (text: string, rank: number, scale: number) => { w: number; h: number }): { places: NewmanPlace[]; scale: number; R: number } {
  const look = d.look;
  const R = look.radius * L, end = R * (1 + look.reach), gap = 0.07 * L;
  const { front, back } = look.ideal ? idealGroups(d.front, d.back) : { front: d.front, back: d.back };
  const ranks = (gs: NewmanGroup[]): (0 | 1 | 2)[] => { const own = gs.filter((g) => g.ring === undefined); const r = sizeRanks(own); return gs.map((g) => (g.ring === undefined ? r[own.indexOf(g)] : 2)); };
  const fr = ranks(front), br = ranks(back);
  const eclipsed = isEclipsed(front, back, d.turn);
  const bothRing = front.some((g) => g.ring !== undefined) && back.some((g) => g.ring !== undefined);
  const jobs = [...front.map((g, i) => ({ g, rank: fr[i], back: false, angle: g.angle })), ...back.map((g, i) => ({ g, rank: br[i], back: true, angle: g.angle + d.turn }))];
  const n = jobs.length;
  const extra = jobs.map(() => 0), flip = jobs.map(() => false);
  // a back bond close behind a front one without being eclipsed (a skew turn) is treated the same
  // way: fanned a little further from it before any bond is drawn longer
  let near = 180;
  for (const b of back) for (const f of front) { const dd = ((b.angle + d.turn - f.angle + 540) % 360) - 180; if (Math.abs(dd) < Math.abs(near)) near = dd; }
  const crowded = eclipsed || Math.abs(near) < 30;
  const fanSign = eclipsed ? Math.sign(look.offset || 1) : Math.sign(near || 1), fanMax = eclipsed ? 26 : 26 - Math.abs(near);
  let scale = 1, offset = eclipsed ? look.offset : 0;
  const sym = (t: string, last: boolean) => (last ? /[A-Z][a-z]?$/.exec(t)?.[0] ?? t.slice(-1) : /^[A-Z][a-z]?/.exec(t)?.[0] ?? t.slice(0, 1));
  const lay = (): NewmanPlace[] => jobs.map((j, i) => {
    const u = dir(j.angle + (j.back ? offset : 0));
    const from = j.back ? { x: c.x + u.x * R, y: c.y + u.y * R } : c;
    const tip = { x: c.x + u.x * (end + extra[i]), y: c.y + u.y * (end + extra[i]) };
    if (j.g.ring !== undefined && bothRing) return { g: j.g, rank: j.rank, back: j.back, from, tip, text: '', box: null };
    const fwd = j.g.label, rev = reversedLabel(fwd);
    const single = rev === fwd;
    const upright = Math.abs(u.x) <= 0.26;
    // written backwards on the left; above or below its bond, forwards unless turned round to make room
    const backwards = upright ? flip[i] : u.x < 0;
    const text = backwards ? rev : fwd;
    const m = measure(text, j.rank, scale);
    const hh = 0.36 * m.h;
    // a short name of one piece (Ph, Me, H) above or below its bond sits centred on it
    const centred = single && Math.abs(u.x) <= 0.5 && fwd.length <= 3;
    const wa = centred ? m.w : measure(sym(text, backwards), j.rank, scale).w;
    const t = Math.min(Math.abs(u.x) > 1e-6 ? wa / 2 / Math.abs(u.x) : Infinity, Math.abs(u.y) > 1e-6 ? hh / Math.abs(u.y) : Infinity);
    const gc = { x: tip.x + u.x * (gap + t), y: tip.y + u.y * (gap + t) };
    const x1 = centred ? gc.x - m.w / 2 : backwards ? gc.x + wa / 2 - m.w : gc.x - wa / 2;
    const sub = /\d/.test(text) ? 0.1 * m.h : 0;
    return { g: j.g, rank: j.rank, back: j.back, from, tip, text, box: { x1, y1: gc.y - hh, x2: x1 + m.w, y2: gc.y + hh + sub } };
  });
  /** What touches: [a label, the other label or the bond it touches, whether that is a bond]. */
  const hits = (ps: NewmanPlace[]): [number, number, boolean][] => {
    const out: [number, number, boolean][] = [], e = 0.05 * L;
    for (let i = 0; i < n; i++) {
      const a = ps[i].box;
      if (!a) continue;
      for (let k = i + 1; k < n; k++) { const b = ps[k].box; if (b && a.x1 - e < b.x2 && b.x1 < a.x2 + e && a.y1 - e < b.y2 && b.y1 < a.y2 + e) out.push([i, k, false]); }
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const p = ps[k];
        for (let s = 0; s <= 16; s++) {
          const q = { x: p.from.x + ((p.tip.x - p.from.x) * s) / 16, y: p.from.y + ((p.tip.y - p.from.y) * s) / 16 };
          if (q.x > a.x1 - e && q.x < a.x2 + e && q.y > a.y1 - e && q.y < a.y2 + e) { out.push([i, k, true]); break; }
        }
      }
    }
    return out;
  };
  const upright = (i: number) => Math.abs(dir(jobs[i].angle + (jobs[i].back ? offset : 0)).x) <= 0.26;
  const cap = (crowded ? 1.4 : 2.4) * R;
  let ps = lay(), hs = hits(ps);
  for (let round = 0; round < 400 && hs.length; round++) {
    // 1: a label above or below its bond written the other way round, where that frees it
    let better = false;
    for (const i of new Set(hs.flatMap((h) => [h[0], h[1]]))) {
      if (!upright(i) || !ps[i].box) continue;
      flip[i] = !flip[i];
      const h2 = hits(lay());
      if (h2.length < hs.length) { better = true; break; }
      flip[i] = !flip[i];
    }
    if (!better) {
      // which label gives way: the back one, else the longer one
      const [i, k, bond] = hs[0];
      const mover = bond || !ps[k].box ? i : ps[i].back !== ps[k].back ? (ps[i].back ? i : k) : (ps[i].text.length >= ps[k].text.length ? i : k);
      if (crowded && Math.abs(offset) < fanMax && ps[i].back !== ps[k].back) offset += fanSign * 2;
      else if (extra[mover] < cap) extra[mover] += 0.08 * L;
      else if (look.text?.auto && scale > 0.705) scale -= 0.05;
      else if (extra[mover] < 3 * R) extra[mover] += 0.08 * L;
      else break;
    }
    ps = lay(); hs = hits(ps);
  }
  return { places: ps, scale, R };
}

/**
 * Draw the projection centred at `c` (the front atom). Returns what was made (the caller puts it
 * in a frame). Call inside an edit.
 */
export function drawNewman(doc: Doc, m: Measure, d: NewmanData, c: Vec): NewmanParts {
  if (d.kind === 'sawhorse') return drawSawhorse(doc, d, c);
  const out: NewmanParts = { captions: [], arrows: [], shapes: [] };
  const L = doc.style.bondLength, lw = doc.style.lineWidth;
  const look = d.look, tx = look.text;
  const size = (scale: number) => newmanTextSize(look, doc.style.captionSize) * scale;
  const style = (text: string, rank: number, scale: number) => {
    const rl = look.ranks[rank];
    const sized = true;
    return chemRuns(text).map((r) => ({
      ...r, ...(rl.color !== '#000000' ? { color: rl.color } : {}), ...(rl.bold || tx?.bold ? { bold: true } : {}), ...(rl.italic || tx?.italic ? { italic: true } : {}),
      ...(sized ? { size: Math.round(size(scale) * 100) / 100 } : {}), ...(tx?.font ? { font: tx.font } : {}),
    }));
  };
  const seen = new Map<string, { w: number; h: number }>();
  const measure = (text: string, rank: number, scale: number) => {
    const key = `${text}|${rank}|${scale.toFixed(2)}`;
    let v = seen.get(key);
    if (!v) {
      const cap = doc.addCaption({ x: 0, y: 0, runs: style(text, rank, scale), justify: 'left', chem: false });
      const b = m.captionBox(cap);
      doc.removeCaption(cap.id);
      // (a measure that can't measure, as in a test, guesses from the letters)
      v = b.x2 > b.x1 ? { w: b.x2 - b.x1, h: b.y2 - b.y1 } : { w: text.length * 0.6 * size(scale), h: 1.2 * size(scale) };
      seen.set(key, v);
    }
    return v;
  };
  const { places, scale, R } = layoutNewman(d, c, L, measure);
  const bondInk = (rank: number) => (look.ranks[rank].bond ? look.ranks[rank].color : '#000000');
  const line = (a: Vec, b: Vec, color = '#000000'): number => { const id = doc.addShape({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color }).id; out.shapes.push(id); return id; };
  const bonds = new Map<NewmanPlace, number>();
  // back bonds first, from the circle out; then the circle; then the front bonds from its middle
  for (const p of places) if (p.back) bonds.set(p, line(p.from, p.tip, bondInk(p.rank)));
  out.shapes.push(doc.addShape({ kind: 'oval', x1: c.x - R, y1: c.y - R, x2: c.x + R, y2: c.y + R, color: '#000000', filled: true, fillColor: '#ffffff' }).id);
  for (const p of places) if (!p.back) bonds.set(p, line(p.from, p.tip, bondInk(p.rank)));
  if (look.dot) out.shapes.push(doc.addShape({ kind: 'oval', x1: c.x - 1.6 * lw, y1: c.y - 1.6 * lw, x2: c.x + 1.6 * lw, y2: c.y + 1.6 * lw, color: '#000000', filled: true, fillColor: '#000000', lineWidth: 0 }).id);
  // the rest of a ring through the bond: an arc from one ring bond's end to the other's, bowed away from the middle
  const fTip = places.find((p) => !p.back && p.g.ring !== undefined && !p.box), bTip = places.find((p) => p.back && p.g.ring !== undefined && !p.box);
  if (fTip && bTip) {
    out.arrows.push(ringArc(doc, look, c, fTip.tip, bTip.tip));
    if ((look.arc ?? OLD_RING_ARC).bonds) for (const p of [fTip, bTip]) doc.updateShape(bonds.get(p)!, { color: (look.arc ?? OLD_RING_ARC).color });
  }
  for (const p of places) {
    if (!p.box) continue;
    const cap = doc.addCaption({ x: 0, y: 0, runs: style(p.text, p.rank, scale), justify: 'left', chem: false });
    const b = m.captionBox(cap);
    const sub = /\d/.test(p.text) ? 0.1 * (p.box.y2 - p.box.y1) / 0.82 : 0;
    const cy = (p.box.y1 + p.box.y2 - sub) / 2;
    doc.updateCaption(cap.id, { x: cap.x + p.box.x1 - b.x1, y: cap.y + cy - (b.y1 + b.y2) / 2 });
    out.captions.push(cap.id);
  }
  out.scale = scale;
  return out;
}

/** The arc that stands for the rest of a ring, from one ring bond's end to the other's. */
function ringArc(doc: Doc, look: NewmanLook, c: Vec, f: Vec, b: Vec): number {
  const mid = { x: (f.x + b.x) / 2 - c.x, y: (f.y + b.y) / 2 - c.y };
  const chord = { x: b.x - f.x, y: b.y - f.y };
  const outward = chord.x * mid.y - chord.y * mid.x;
  const sweep = (outward > 0 ? -1 : 1) * 110 * RAD;
  const arc = look.arc ?? OLD_RING_ARC, ink = arc.color.toLowerCase() === '#000000' ? {} : { color: arc.color };
  return doc.addArrow({ tail: f, head: b, headStyle: 'none', tailStyle: 'none', headType: 'solid', line: arc.line, noGo: false, equilibrium: false, sweep, headLength: 0, headWidth: 0, ...ink } as Omit<Arrow, 'id'>).id;
}

/** How the sawhorse is seen: from above and to one side, the back atom up and to the right. */
export const SAWHORSE = { yaw: 48, pitch: 32, sep: 2.0, arm: 1.25 };

/** A point of the sawhorse's model (x right, y up, z along the bond away from the reader) as seen: across, up, and toward the reader. */
function sawView(x: number, y: number, z: number): [number, number, number] {
  const yaw = SAWHORSE.yaw * RAD, pitch = SAWHORSE.pitch * RAD;
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw), z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  return [x1, y * Math.cos(pitch) + z1 * Math.sin(pitch), y * Math.sin(pitch) - z1 * Math.cos(pitch)];
}

const det3 = (a: number[], b: number[], c: number[]) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);

/**
 * Which of an atom's three groups is drawn as a solid wedge and which as a hashed wedge, so the
 * drawing read as an ordinary wedge-and-hash structure has the atom's real handedness: `subs`
 * are the groups and `other` the other atom of the bond, each as seen (across, up, toward the
 * reader) from the atom. The group nearest the reader is the wedge and the farthest the hash
 * where that reads true; otherwise the next best pair that does. Null when there aren't three groups.
 */
export function sawhorseWedges(subs: [number, number, number][], other: [number, number, number]): { wedge: number; hash: number } | null {
  if (subs.length !== 3) return null;
  const real = Math.sign(det3(subs[0], subs[1], subs[2]) - det3(other, subs[1], subs[2]) + det3(other, subs[0], subs[2]) - det3(other, subs[0], subs[1]));
  const pairs: { wedge: number; hash: number; score: number }[] = [];
  for (let w = 0; w < 3; w++) for (let h = 0; h < 3; h++) {
    if (w === h) continue;
    const flat = (i: number): number[] => [subs[i][0], subs[i][1], i === w ? 1 : i === h ? -1 : 0];
    const o = [other[0], other[1], 0];
    const read = Math.sign(det3(flat(0), flat(1), flat(2)) - det3(o, flat(1), flat(2)) + det3(o, flat(0), flat(2)) - det3(o, flat(0), flat(1)));
    if (read === real && real !== 0) pairs.push({ wedge: w, hash: h, score: subs[w][2] - subs[h][2] });
  }
  pairs.sort((p, q) => q.score - p.score);
  return pairs[0] ? { wedge: pairs[0].wedge, hash: pairs[0].hash } : null;
}

/**
 * A sawhorse, drawn as a structure of its own (atoms and bonds, so its labels sit on its bonds as
 * in any structure and it opens in ChemDraw as one): the front atom at `c`, each group leaving
 * its atom at the tetrahedral angle, and (with `look.wedges`) a wedge and a hashed wedge on each
 * atom showing which groups point toward and away from the reader.
 */
function drawSawhorse(doc: Doc, d: NewmanData, c: Vec): NewmanParts {
  const out: NewmanParts = { captions: [], arrows: [], shapes: [], atoms: [] };
  const L = doc.style.bondLength, look = d.look, tx = look.text;
  const { front, back } = look.ideal ? idealGroups(d.front, d.back) : { front: d.front, back: d.back };
  const ranks = (gs: NewmanGroup[]): (0 | 1 | 2)[] => { const own = gs.filter((g) => g.ring === undefined); const r = sizeRanks(own); return gs.map((g) => (g.ring === undefined ? r[own.indexOf(g)] : 2)); };
  const sep = SAWHORSE.sep * L, arm = SAWHORSE.arm * L;
  const page = (v: [number, number, number]): Vec => ({ x: c.x + v[0], y: c.y - v[1] });
  const ringBoth = front.some((g) => g.ring !== undefined) && back.some((g) => g.ring !== undefined);
  const scale = doc.style.captionSize ? newmanTextSize(look, doc.style.captionSize) / doc.style.captionSize : undefined;
  const ends: { ring: boolean; front: boolean; at: Vec }[] = [];
  /** Each group's bond (from its atom to the group) and about half the width of its name. */
  const tips: { from: Vec; at: Vec; box: Box | null }[] = [];
  const centre = (z0: number) => doc.addAtom(page(sawView(0, 0, z0)).x, page(sawView(0, 0, z0)).y, 6, look.rs ? { showStereo: true } : {});
  const cf = centre(0), cbk = centre(sep);
  out.atoms!.push(cf.id, cbk.id);
  doc.addBond(cf.id, cbk.id);
  const side = (gs: NewmanGroup[], atom: number, z0: number, dz: number, turn: number, isFront: boolean) => {
    const rk = ranks(gs);
    const s = 0.943 * arm;
    const model = gs.map((g) => [Math.sin((g.angle + turn) * RAD) * s, Math.cos((g.angle + turn) * RAD) * s, z0 + dz * arm] as const);
    const seen = model.map((p) => sawView(p[0], p[1], p[2]));
    const own = sawView(0, 0, z0), far = sawView(0, 0, z0 === 0 ? sep : 0);
    const rel = (v: [number, number, number]): [number, number, number] => [v[0] - own[0], v[1] - own[1], v[2] - own[2]];
    const marks = look.wedges ? sawhorseWedges(seen.map(rel), rel(far)) : null;
    gs.forEach((g, i) => {
      const p = page(seen[i]);
      const rl = look.ranks[rk[i]];
      const ring = g.ring !== undefined && ringBoth;
      const el = /^[A-Z][a-z]?/.exec(g.label)?.[0] ?? 'C';
      const plain = ring || (g.label === el && elementNumber(el) !== undefined);
      const a = doc.addAtom(p.x, p.y, ring ? 6 : elementNumber(el) ?? 6, {
        ...(plain ? {} : { label: g.label }), ...(rl.color !== '#000000' && !ring ? { color: rl.color } : {}),
        ...(scale && Math.abs(scale - 1) > 0.01 ? { s: scale } : {}), ...(tx?.font ? { font: tx.font } : {}), ...(rl.bold || tx?.bold ? { face: 1 } : {}),
      });
      out.atoms!.push(a.id);
      const display = marks?.wedge === i ? 'wedge' : marks?.hash === i ? 'hashWedge' : 'solid';
      doc.addBond(atom, a.id, 1, display, rl.bond && !ring ? { color: rl.color } : {});
      if (ring) ends.push({ ring: true, front: isFront, at: p });
      {
        // about the box its name fills: it starts on the atom and runs away from the bond
        const ls = doc.style.labelSize * (scale ?? 1), wd = ring ? 0 : 0.62 * ls * Math.max(1, g.label.replace(/\d/g, '').length + 0.5 * g.label.replace(/\D/g, '').length), left = p.x < page(own).x;
        tips.push({ from: page(own), at: p, box: ring ? null : { x1: left ? p.x + 0.4 * ls - wd : p.x - 0.4 * ls, x2: left ? p.x + 0.4 * ls : p.x - 0.4 * ls + wd, y1: p.y - 0.5 * ls, y2: p.y + 0.6 * ls } });
      }
    });
  };
  side(back, cbk.id, sep, 0.333, d.turn, false);
  side(front, cf.id, 0, -0.333, 0, true);
  if (look.rs) {
    // R/S labels in the clearest spot beside each atom: as far as can be from every bond and
    // group label of the drawing (they can be dragged like any stereo label)
    const size = 0.75 * doc.style.labelSize * (scale ?? 1), w = 1.75 * size;
    const segs: [Vec, Vec][] = [[cf, cbk], ...tips.map((t): [Vec, Vec] => [t.from, t.at])];
    const h = 0.8 * size;
    // how far a point is from the label's box when the label is centred at q
    const gapTo = (q: Vec, o: Vec) => Math.hypot(Math.max(Math.abs(o.x - q.x) - w / 2, 0), Math.max(Math.abs(o.y - q.y) - h / 2, 0));
    const toSeg = (q: Vec, [m, n]: [Vec, Vec]) => { let d = Infinity; for (let i = 0; i <= 12; i++) d = Math.min(d, gapTo(q, { x: m.x + ((n.x - m.x) * i) / 12, y: m.y + ((n.y - m.y) * i) / 12 })); return d; };
    const taken: Vec[] = [];
    for (const atom of [cf, cbk]) {
      let best = { x: atom.x, y: atom.y + 0.6 * L }, score = -Infinity;
      for (const r of [0.5 * L, 0.65 * L, 0.8 * L, 0.95 * L, 1.1 * L]) for (let deg = 0; deg < 360; deg += 10) {
        const q = { x: atom.x + r * Math.sin(deg * RAD), y: atom.y - r * Math.cos(deg * RAD) };
        let sc = Math.min(...segs.map((sg) => toSeg(q, sg)));
        for (const t of tips) if (t.box) sc = Math.min(sc, Math.hypot(Math.max(t.box.x1 - (q.x + w / 2), q.x - w / 2 - t.box.x2, 0), Math.max(t.box.y1 - (q.y + h / 2), q.y - h / 2 - t.box.y2, 0)));
        for (const o of taken) sc = Math.min(sc, gapTo(q, o) - w / 2);
        // clear by a comfortable margin is enough; past that, nearer its atom is better
        sc = Math.min(sc, 0.16 * L) - 0.05 * (r - 0.5 * L);
        if (sc > score + 1e-6) { score = sc; best = q; }
      }
      taken.push(best);
      doc.updateAtom(atom.id, { stereoLabel: { text: '', dx: best.x - atom.x - w / 2, dy: best.y - atom.y + 0.36 * size, size, italic: true } });
    }
  }
  const f = ends.find((e) => e.front), b = ends.find((e) => !e.front);
  if (f && b) out.arrows.push(ringArc(doc, look, c, f.at, b.at));
  return out;
}

/**
 * Draw a projection in a frame of its own centred at `c`, or draw the one in frame `id` again
 * (what it drew before goes). Returns the frame's id. Call inside an edit.
 */
export function putNewman(doc: Doc, m: Measure, d: NewmanData, c: Vec, id?: number): number {
  const old = id !== undefined ? doc.shapes.get(id) : undefined;
  if (old?.frame) {
    for (const x of old.frame.captions) doc.removeCaption(x);
    for (const x of old.frame.arrows) doc.removeArrow(x);
    for (const x of old.frame.shapes) doc.removeShape(x);
    for (const x of old.frame.atoms) if (doc.atoms.has(x)) doc.removeAtom(x);
  }
  const parts = drawNewman(doc, m, d, c);
  const pad = 0.2 * doc.style.bondLength;
  const frame: Frame = { atoms: parts.atoms ?? [], captions: parts.captions, arrows: parts.arrows, shapes: parts.shapes, padX: pad, padY: pad, fit: true };
  const b = frameBox(doc, frame, m) ?? { x1: c.x - 20, y1: c.y - 20, x2: c.x + 20, y2: c.y + 20 };
  const name = d.kind === 'newman' ? 'Newman projection' : 'Sawhorse projection';
  if (old) { doc.updateShape(old.id, { ...b, frame, newman: d }); return old.id; }
  return doc.addShape({ kind: 'geo', geo: 'rect', ...b, filled: false, lineWidth: 0, color: '#000000', frame, newman: d, name }).id;
}

/** Where a projection's front atom was drawn (the centre it is drawn round again). */
export function newmanCentre(doc: Doc, s: Shape): Vec | null {
  const f = s.frame;
  if (!f || !s.newman) return null;
  const circle = f.shapes.map((id) => doc.shapes.get(id)).find((x) => x?.kind === 'oval');
  if (circle && s.newman.kind === 'newman') return { x: (circle.x1 + circle.x2) / 2, y: (circle.y1 + circle.y2) / 2 };
  // a sawhorse drawn as a structure: its front atom is the first one made
  const fa = f.atoms.length ? doc.atoms.get(f.atoms[0]) : undefined;
  if (fa) return { x: fa.x, y: fa.y };
  // an older sawhorse, drawn in lines: the front atom starts the most lines (its bonds and the one to the back atom)
  const starts = new Map<string, { p: Vec; n: number }>();
  for (const id of f.shapes) {
    const x = doc.shapes.get(id);
    if (x?.kind !== 'line') continue;
    const k = `${Math.round(x.x1 * 100)},${Math.round(x.y1 * 100)}`;
    const e = starts.get(k) ?? { p: { x: x.x1, y: x.y1 }, n: 0 };
    e.n++;
    starts.set(k, e);
  }
  let best: { p: Vec; n: number } | null = null;
  for (const e of starts.values()) if (!best || e.n > best.n) best = e;
  return best ? best.p : null;
}

/** The projection a thing belongs to (its frame's id), if any. */
export function newmanFrameOf(doc: Doc, kind: 'atom' | 'bond' | 'caption' | 'arrow' | 'shape', id: number): number | null {
  if (kind === 'shape' && doc.shapes.get(id)?.newman) return id;
  for (const s of doc.shapes.values()) {
    if (!s.newman || !s.frame) continue;
    const f = s.frame;
    if (kind === 'caption' && f.captions.includes(id)) return s.id;
    if (kind === 'arrow' && f.arrows.includes(id)) return s.id;
    if (kind === 'shape' && f.shapes.includes(id)) return s.id;
    if (kind === 'atom' || kind === 'bond') {
      const atom = kind === 'atom' ? id : doc.bonds.get(id)?.a1;
      if (atom !== undefined && frameMembers(doc, f).atoms.has(atom)) return s.id;
    }
  }
  return null;
}

/**
 * The viewing-direction mark on the structure (an eye looking along the bond at its front atom,
 * with a dotted arrow), as in textbook figures. The eye is side on: its lids meet at the corner
 * farthest from the bond and open toward it, with the eyeball's curve across the opening.
 * Returns what was made. Call inside an edit.
 */
export function drawEyeMark(doc: Doc, front: Vec, back: Vec, color = '#1a56db', eye: EyeStyle = 'plain'): { arrows: number[]; shapes: number[] } {
  const L = doc.style.bondLength, lw = doc.style.lineWidth;
  const ux = (front.x - back.x), uy = (front.y - back.y), l = Math.hypot(ux, uy) || 1;
  const u = { x: ux / l, y: uy / l }, n = { x: -u.y, y: u.x };
  // a point `a` bond lengths along the bond (away from it) and `k` across it from `o`
  const at = (o: Vec, a: number, k: number): Vec => ({ x: o.x + (u.x * a + n.x * k) * L, y: o.y + (u.y * a + n.y * k) * L });
  const tip = at(front, 0.35, 0), tail = at(front, 1.9, 0);
  const arrows: number[] = [], shapes: number[] = [];
  const arc = (t: Vec, h: Vec, deg: number) => arrows.push(doc.addArrow({ tail: t, head: h, headStyle: 'none', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: deg * RAD, headLength: 0, headWidth: 0, color } as Omit<Arrow, 'id'>).id);
  const line = (p: Vec, q: Vec) => shapes.push(doc.addShape({ kind: 'line', x1: p.x, y1: p.y, x2: q.x, y2: q.y, color }).id);
  arrows.push(doc.addArrow({ tail, head: tip, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'dashed', noGo: false, equilibrium: false, sweep: 0, headLength: lw * 7, headWidth: lw * 2.6, color } as Omit<Arrow, 'id'>).id);
  // the opening's middle sits `o` past the arrow's tail; the lids are `s` long
  const s = 0.6, o = 0.33, w = s * 0.62;
  const corner = at(tail, o + s, 0), lid1 = at(tail, o, w), lid2 = at(tail, o, -w);
  if (eye === 'almond') { arc(corner, lid1, -28); arc(lid2, corner, -28); }
  else if (eye === 'lashes') { line(corner, at(tail, o - 0.08, w + 0.05)); line(corner, at(tail, o - 0.08, -w - 0.05)); }
  else { line(corner, lid1); line(corner, lid2); }
  arc(lid1, lid2, 110);
  if (eye === 'inner' || eye === 'lashes') arc(at(tail, o + 0.2, 0.2), at(tail, o + 0.2, -0.2), 110);
  if (eye === 'pupil' || eye === 'almond') {
    const c = at(tail, o + 0.02, 0), r = 0.085 * L;
    shapes.push(doc.addShape({ kind: 'oval', x1: c.x - r, y1: c.y - r, x2: c.x + r, y2: c.y + r, color, filled: true, fillColor: color }).id);
  }
  return { arrows, shapes };
}

/** A caption's look, for tests. */
export const captionText = (c: Caption): string => c.runs.map((r) => r.text).join('');

/**
 * The structure as far as its projection cares: its atoms (ids, elements, labels, charges,
 * isotopes) and bonds (orders and wedges, which way round), not where they are drawn.
 */
export function structureKey(doc: Doc, ids: Iterable<number>): string {
  const set = [...ids].filter((id) => doc.atoms.has(id)).sort((p, q) => p - q);
  const inSet = new Set(set);
  const atoms = set.map((id) => { const a = doc.atoms.get(id)!; return `${id}:${a.z}:${a.label ?? ''}:${a.charge}:${a.isotope}`; });
  const bonds: string[] = [];
  for (const id of set) for (const bid of doc.adj.get(id) ?? []) {
    const b = doc.bonds.get(bid);
    if (b && b.a1 === id && inSet.has(b.a2)) bonds.push(`${b.a1}-${b.a2}:${b.order}:${b.display}`);
  }
  return atoms.join(',') + '|' + bonds.sort().join(',');
}

/** Draw a projection's viewing mark at the bond as it is now drawn (the old one goes). Returns the mark. Call inside an edit. */
export function putMark(doc: Doc, d: NewmanData, color: string): NewmanData['mark'] {
  if (d.mark) {
    for (const x of d.mark.arrows) doc.removeArrow(x);
    for (const x of d.mark.shapes) doc.removeShape(x);
  }
  const f = d.link && doc.atoms.get(d.link.front), b = d.link && doc.atoms.get(d.link.back);
  if (!f || !b) return undefined;
  const eye = d.mark?.eye ?? d.look.eye ?? 'plain';
  return { ...drawEyeMark(doc, f, b, color, eye), color, at: [f.x, f.y, b.x, b.y], ...(eye !== 'plain' ? { eye } : {}) };
}

/**
 * After a change: a linked projection's viewing mark follows its bond when the structure moves,
 * and the projections whose structure changed (an atom, label, bond or wedge) are returned, to be
 * worked out again. One whose bond is gone lets go of it. Call inside an edit (doc.beforeCommit).
 */
export function refitNewman(doc: Doc, before: ReadonlyMap<string, unknown>): number[] {
  const stale: number[] = [];
  let bondsTouched = false;
  for (const k of before.keys()) if (k[0] === 'b') { bondsTouched = true; break; }
  for (const s of [...doc.shapes.values()]) {
    const d = s.newman;
    if (!d?.link) continue;
    const link = d.link;
    // a mark with a piece deleted is the person's to keep or delete: it is no longer moved
    if (d.mark && (d.mark.arrows.some((x) => !doc.arrows.has(x)) || d.mark.shapes.some((x) => !doc.shapes.has(x)))) {
      doc.updateShape(s.id, { newman: { ...d, mark: undefined } });
      continue;
    }
    if (!bondsTouched && !link.atoms.some((id) => before.has('a' + id)) && !before.has('a' + link.front) && !before.has('a' + link.back)) continue;
    const f = doc.atoms.get(link.front), b = doc.atoms.get(link.back);
    const joined = f && b && (doc.adj.get(f.id) ?? []).some((bid) => { const x = doc.bonds.get(bid); return !!x && (x.a1 === b.id || x.a2 === b.id) && x.order === 1; });
    if (!joined) { doc.updateShape(s.id, { newman: { ...d, link: undefined } }); continue; }
    if (d.mark && (Math.abs(d.mark.at[0] - f.x) + Math.abs(d.mark.at[1] - f.y) + Math.abs(d.mark.at[2] - b.x) + Math.abs(d.mark.at[3] - b.y) > 1e-6)) {
      const moved = d.mark.arrows.some((x) => before.has('r' + x)) || d.mark.shapes.some((x) => before.has('s' + x));
      // moved along with the structure: it is where it should be already
      const mark = moved ? { ...d.mark, at: [f.x, f.y, b.x, b.y] as [number, number, number, number] } : putMark(doc, d, d.mark.color);
      doc.updateShape(s.id, { newman: { ...d, mark } });
    }
    if (structureKey(doc, doc.fragmentOf(link.front)) !== link.key) stale.push(s.id);
  }
  return stale;
}

/**
 * A projection's numbers as a file keeps them: the bond by where its atoms are drawn (ids change
 * between files), its mark by its colour, found again by its lines on opening.
 */
export function newmanForFile(doc: Doc, d: NewmanData): NewmanData {
  const f = d.link && doc.atoms.get(d.link.front), b = d.link && doc.atoms.get(d.link.back);
  if (!d.link || !f || !b) { const { link: _l, mark: _m, ...rest } = d; return rest; }
  const at: [number, number, number, number] = [f.x, f.y, b.x, b.y];
  return { ...d, link: { atoms: [], front: -1, back: -1, key: '', at }, ...(d.mark ? { mark: { arrows: [], shapes: [], color: d.mark.color, at: d.mark.at, ...(d.mark.eye ? { eye: d.mark.eye } : {}) } } : {}) };
}

/** After opening a file: each projection finds its bond again where it was drawn, and its viewing mark by its lines; one that can't lets go. */
export function relinkNewman(doc: Doc): void {
  const near = (x: number, y: number) => {
    let best: number | null = null, bd = 0.75;
    for (const a of doc.atoms.values()) { const dd = Math.hypot(a.x - x, a.y - y); if (dd < bd) { bd = dd; best = a.id; } }
    return best;
  };
  for (const s of [...doc.shapes.values()]) {
    const d = s.newman;
    if (!d?.link?.at) continue;
    const [fx, fy, bx, by] = d.link.at;
    const f = near(fx, fy), b = near(bx, by);
    const joined = f !== null && b !== null && (doc.adj.get(f) ?? []).some((bid) => { const x = doc.bonds.get(bid); return !!x && (x.a1 === b || x.a2 === b); });
    if (!joined) { const { link: _l, mark: _m, ...rest } = d; doc.updateShape(s.id, { newman: rest }); continue; }
    const atoms = [...doc.fragmentOf(f!)];
    const link = { atoms, front: f!, back: b!, key: structureKey(doc, atoms) };
    let mark: NewmanData['mark'];
    if (d.mark) {
      // the mark as it would be drawn, matched line for line with what is on the page
      const tmp = new Doc();
      tmp.style = { ...doc.style };
      const [mfx, mfy, mbx, mby] = d.mark.at;
      let want: { arrows: number[]; shapes: number[] } = { arrows: [], shapes: [] };
      tmp.bulk(() => { want = drawEyeMark(tmp, { x: mfx, y: mfy }, { x: mbx, y: mby }, d.mark!.color, d.mark!.eye ?? 'plain'); });
      const close = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y) < 0.5;
      const arrows = want.arrows.map((id) => { const w = tmp.arrows.get(id)!; return [...doc.arrows.values()].find((a) => close(a.tail, w.tail) && close(a.head, w.head))?.id; });
      const shapes = want.shapes.map((id) => { const w = tmp.shapes.get(id)!; return [...doc.shapes.values()].find((x) => x.kind === w.kind && close({ x: x.x1, y: x.y1 }, { x: w.x1, y: w.y1 }) && close({ x: x.x2, y: x.y2 }, { x: w.x2, y: w.y2 }))?.id; });
      if (arrows.every((x) => x !== undefined) && shapes.every((x) => x !== undefined)) mark = { arrows: arrows as number[], shapes: shapes as number[], color: d.mark.color, at: d.mark.at, ...(d.mark.eye ? { eye: d.mark.eye } : {}) };
    }
    const { mark: _m, ...rest } = d;
    doc.updateShape(s.id, { newman: { ...rest, link, ...(mark ? { mark } : {}) } });
  }
}
