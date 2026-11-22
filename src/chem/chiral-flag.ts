// The chiral flag drawn beside a structure (Chemistry > Chiral Flag: a boxed Abs, Rel or Rac), as
// the molfile writer and readers use it. A molfile's chiral flag (BIOVIA CTfile Formats, 2020: the
// counts line in V2000, COUNTS in V3000) is 1 when the wedges show the absolute configuration and
// 0 when they show only the relative one; this program draws that as an Abs flag.
//
// A flag belongs to one structure, and says so: it is stuck (pinned, see Pin in model.ts) to an
// atom of the structure it was made for, by the Chiral Flag command or when a file is read. So it
// goes where the structure goes, and two flagged structures side by side each keep their own flag
// (review F1b-R01). ChemDraw keeps a flag inside its structure's fragment, which is how a CDXML
// file says the same thing. Only a flag that is stuck to nothing (moved far away by hand, or
// detached) falls back to the nearest structure, one flag to a structure.

import { CHIRAL_FLAGS, type Doc, type Pin, type Shape } from '../model';
import { arialWidth } from '../text-metrics';

export type ChiralFlag = 'Absolute' | 'Relative' | 'Racemic';

/** Is this shape a chiral flag? */
export const isChiralFlag = (s: Shape): boolean => s.kind === 'symbol' && !!s.symbol && !!CHIRAL_FLAGS[s.symbol];

/** How far (in bond lengths) a flag stuck to nothing may be from a structure and still count as its flag. */
const LOOSE_REACH = 3;

const centre = (s: Shape) => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });

/** A pin holding a flag to one atom: it moves with that atom, without turning round it. */
export function flagPin(doc: Doc, s: Pick<Shape, 'x1' | 'y1' | 'x2' | 'y2'>, atomId: number): Pin | undefined {
  const a = doc.atoms.get(atomId);
  if (!a) return undefined;
  const c = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
  return { on: 'atom', ref: [atomId], at: { x: c.x - a.x, y: c.y - a.y }, hand: 1, was: c };
}

/** The atom of `atomIds` nearest the flag's middle (the one to stick it to). */
function nearestOf(doc: Doc, s: Pick<Shape, 'x1' | 'y1' | 'x2' | 'y2'>, atomIds: Iterable<number>): number | undefined {
  const c = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
  let best: number | undefined, bestD = Infinity;
  for (const id of atomIds) {
    const a = doc.atoms.get(id);
    if (!a) continue;
    const d = Math.hypot(a.x - c.x, a.y - c.y);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

/** Stick a flag to the structure made of these atoms (at its atom nearest the flag). */
export function stickFlag(doc: Doc, s: Shape, atomIds: Iterable<number>): void {
  const id = nearestOf(doc, s, atomIds);
  const pin = id === undefined ? undefined : flagPin(doc, s, id);
  if (pin) doc.updateShape(s.id, { pin });
}

/**
 * Which structure each chiral flag belongs to: by the lowest atom id of the structure, its flag.
 * A flag stuck to an atom belongs to that atom's structure; a loose flag to the nearest structure
 * that has none (within a few bond lengths), the nearest flag first.
 */
export function flagOwners(doc: Doc): Map<number, Shape> {
  const out = new Map<number, Shape>();
  const flags = [...doc.shapes.values()].filter(isChiralFlag);
  if (!flags.length) return out;
  const fragKey = new Map<number, number>();
  const keyOf = (id: number) => {
    let k = fragKey.get(id);
    if (k === undefined) { const f = doc.fragmentOf(id); k = Math.min(...f); for (const x of f) fragKey.set(x, k); }
    return k;
  };
  const loose: Shape[] = [];
  for (const s of flags) {
    const at = s.pin?.on === 'atom' ? s.pin.ref[0] : undefined;
    if (at !== undefined && doc.atoms.has(at)) { const k = keyOf(at); if (!out.has(k)) out.set(k, s); }
    else loose.push(s);
  }
  if (!loose.length) return out;
  const L = doc.style.bondLength;
  const pairs: { s: Shape; k: number; d: number }[] = [];
  for (const s of loose) {
    const c = centre(s);
    const best = new Map<number, number>();
    for (const a of doc.atomsNear(c, LOOSE_REACH * L)) {
      if (a.multi) continue;
      const d = Math.hypot(a.x - c.x, a.y - c.y), k = keyOf(a.id);
      if (d <= LOOSE_REACH * L && d < (best.get(k) ?? Infinity)) best.set(k, d);
    }
    for (const [k, d] of best) pairs.push({ s, k, d });
  }
  const taken = new Set<Shape>();
  for (const p of pairs.sort((a, b) => a.d - b.d)) {
    if (taken.has(p.s) || out.has(p.k)) continue;
    out.set(p.k, p.s);
    taken.add(p.s);
  }
  return out;
}

/** The chiral flag of the structure made of these atoms, if it has one. */
export function structureFlag(doc: Doc, atomIds: Iterable<number>): Shape | undefined {
  const first = [...atomIds].find((id) => doc.atoms.has(id));
  if (first === undefined) return undefined;
  return flagOwners(doc).get(Math.min(...doc.fragmentOf(first)));
}

/** Each atom's structure's chiral flag (atoms of a structure without one are left out), with the structure's lowest atom id; `known`: flagOwners already worked out. */
export function flagsByAtom(doc: Doc, atomIds: Iterable<number>, known?: Map<number, Shape>): Map<number, { flag: ChiralFlag; frag: number }> {
  const out = new Map<number, { flag: ChiralFlag; frag: number }>();
  const owners = known ?? flagOwners(doc);
  if (!owners.size) return out;
  const done = new Set<number>();
  for (const id of atomIds) {
    if (done.has(id) || !doc.atoms.has(id)) continue;
    const frag = doc.fragmentOf(id);
    for (const k of frag) done.add(k);
    const first = Math.min(...frag);
    const f = owners.get(first)?.symbol as ChiralFlag | undefined;
    if (!f) continue;
    for (const k of frag) out.set(k, { flag: f, frag: first });
  }
  return out;
}

/** Draw a chiral flag below and to the right of the structure made of these atoms (as Chemistry > Chiral Flag places it), stuck to it. */
export function addChiralFlag(doc: Doc, atomIds: Iterable<number>, flag: ChiralFlag, width?: (text: string, size: number) => number): number | null {
  const ids = [...atomIds].filter((id) => doc.atoms.has(id));
  const atoms = ids.map((id) => doc.atoms.get(id)!);
  if (!atoms.length) return null;
  const x2a = Math.max(...atoms.map((a) => a.x)), y2a = Math.max(...atoms.map((a) => a.y));
  const L = doc.style.bondLength;
  const size = doc.style.captionSize || 10;
  const w = (width ?? arialWidth)(CHIRAL_FLAGS[flag], size) + 4, h = size * 1.15 + 4;
  const x2 = x2a + L * 0.3, y1 = y2a + L * 0.6;
  const box = { x1: x2 - w, y1, x2, y2: y1 + h };
  const at = nearestOf(doc, box, ids);
  const pin = at === undefined ? undefined : flagPin(doc, box, at);
  return doc.addShape({ kind: 'symbol', symbol: flag, ...box, ...(pin ? { pin } : {}) }).id;
}
