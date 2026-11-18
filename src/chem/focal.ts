// Focal points: the spot on a structure that counts as its middle when lining things up (Align
// Center and Middle, Distribute, Arrange in a Row/Column/Grid, Clean Up Reaction, turning), so a
// set of compounds that share a core line up on the core whatever hangs off it.
//
// A structure's focal point is kept as a mark on the atoms it is made from (Atom.focal): one atom,
// the two atoms of a bond (its middle), or the atoms round a ring (its centre). Kept on the atoms,
// it moves, turns and flips with them, and goes along with copy and paste and into files (a hidden
// tag in CDXML). Without a mark, the focal point is the middle of the structure's box.

import type { Vec } from '../geom';
import type { Doc } from '../model';
import { ringsAmong } from './aromatic';

export type FocalKind = 'atom' | 'bond' | 'ring';

/** The ways a structure with no focal point of its own is centered (Preferences). */
export type FocalDefault = 'box' | 'ring';

/** How focal points are marked on screen: A target (default), B diamond, C crosshair, D center of mass. */
export type FocalLook = 'target' | 'diamond' | 'cross' | 'mass';

/** Settings for focal points (Preferences ▸ Focal Points, and the Distribute menu's choice). */
export interface FocalPrefs {
  look: FocalLook;
  /** Where a structure with no focal point of its own centers. */
  dflt: FocalDefault;
  /** What Distribute Horizontally and Vertically make equal: the gaps, or the spacing of focal points. */
  distribute: 'gaps' | 'focal';
  /** The one-time status bar tip about focal points has been shown. */
  tipShown: boolean;
}

export const DEFAULT_FOCAL_PREFS: FocalPrefs = { look: 'target', dflt: 'box', distribute: 'gaps', tipShown: false };

/** Focal point settings from a settings file (anything missing or odd keeps its default). */
export function parseFocalPrefs(r: unknown): FocalPrefs {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  return {
    look: o.look === 'diamond' || o.look === 'cross' || o.look === 'mass' ? o.look : 'target',
    dflt: o.dflt === 'ring' ? 'ring' : 'box',
    distribute: o.distribute === 'focal' ? 'focal' : 'gaps',
    tipShown: o.tipShown === true,
  };
}

let dflt: FocalDefault = 'box';
/** Preferences ▸ Default focal point: how structures without their own are centered. */
export const focalDefault = (): FocalDefault => dflt;
export function setFocalDefault(d: FocalDefault): void { dflt = d; }

/**
 * The marked atoms of a structure, as one atom, one bond's two atoms or one ring. Two structures
 * joined each bring their own marks: the oldest structure's (its lowest atom number) counts.
 */
export function focalAtoms(doc: Doc, atoms: Iterable<number>): number[] {
  const marked = new Set<number>();
  for (const id of atoms) if (doc.atoms.get(id)?.focal) marked.add(id);
  if (!marked.size) return [];
  // the marks that join up through bonds between them, from the lowest-numbered mark
  const start = Math.min(...marked);
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const a = stack.pop()!;
    for (const n of doc.neighbors(a)) if (marked.has(n.id) && !seen.has(n.id)) { seen.add(n.id); stack.push(n.id); }
  }
  return [...seen];
}

/** What a structure's focal point is on: an atom, a bond or a ring (null: the default). */
export function focalKind(doc: Doc, atoms: Iterable<number>): FocalKind | null {
  const f = focalAtoms(doc, atoms);
  return !f.length ? null : f.length === 1 ? 'atom' : f.length === 2 ? 'bond' : 'ring';
}

/** A structure's own focal point (null when it has none and is centered by its box). */
export function focalPoint(doc: Doc, atoms: Iterable<number>): Vec | null {
  return centroid(doc, focalAtoms(doc, atoms));
}

/** The middle of these atoms (null with none). */
export function centroid(doc: Doc, ids: readonly number[]): Vec | null {
  let x = 0, y = 0, n = 0;
  for (const id of ids) { const a = doc.atoms.get(id); if (a) { x += a.x; y += a.y; n++; } }
  return n ? { x: x / n, y: y / n } : null;
}

/**
 * The structure's largest ring nearest its middle (for Preferences ▸ Default focal point ▸ Largest
 * ring), or null when it has no ring.
 */
export function largestRing(doc: Doc, atoms: Iterable<number>, middle: Vec): number[] | null {
  const set = new Set(atoms);
  const bonds = [...doc.bonds.values()].filter((b) => set.has(b.a1) && set.has(b.a2)).map((b) => b.id);
  if (!bonds.length) return null;
  let best: number[] | null = null, bestD = Infinity;
  for (const r of ringsAmong(doc, bonds)) {
    if (!r.every((a) => set.has(a))) continue;
    const c = centroid(doc, r)!;
    const d = Math.hypot(c.x - middle.x, c.y - middle.y);
    if (!best || r.length > best.length || (r.length === best.length && d < bestD - 1e-6)) { best = r; bestD = d; }
  }
  return best;
}

/**
 * Where a structure lines up: its own focal point, else (with the Largest ring preference) the
 * middle of its largest ring, else null (the caller uses the middle of the box).
 */
export function alignPoint(doc: Doc, atoms: readonly number[], middle: Vec, dflt: FocalDefault = 'box'): Vec | null {
  const own = focalPoint(doc, atoms);
  if (own || dflt === 'box') return own;
  const r = largestRing(doc, atoms, middle);
  return r ? centroid(doc, r) : null;
}

/**
 * Put a structure's focal point on these atoms (one atom, a bond's two, or a ring's), clearing any
 * it had. An empty list resets it to the default. Call inside an edit.
 */
export function setFocal(doc: Doc, on: readonly number[]): void {
  if (!on.length) return;
  const frag = doc.fragmentOf(on[0]);
  for (const id of frag) if (doc.atoms.get(id)?.focal) doc.updateAtom(id, { focal: undefined });
  for (const id of on) if (frag.has(id)) doc.updateAtom(id, { focal: true });
}

/** Reset a structure's focal point to the default (the middle of its box). Call inside an edit. */
export function clearFocal(doc: Doc, atoms: Iterable<number>): boolean {
  let any = false;
  for (const id of atoms) if (doc.atoms.get(id)?.focal) { doc.updateAtom(id, { focal: undefined }); any = true; }
  return any;
}

/**
 * The focal spot a selection names, when it names one: one atom, one bond, or every atom and bond
 * of one ring (within one structure). Null for anything else.
 */
export function focalTarget(doc: Doc, sel: { atoms: Set<number>; bonds: Set<number> }): number[] | null {
  const atoms = new Set(sel.atoms);
  for (const id of sel.bonds) { const b = doc.bonds.get(id); if (b) { atoms.add(b.a1); atoms.add(b.a2); } }
  if (!atoms.size) return null;
  const ids = [...atoms];
  if (ids.length === 1) return ids;
  if (ids.length === 2) {
    const [p, q] = ids;
    return doc.neighbors(p).some((n) => n.id === q) ? ids : null;
  }
  // a ring: exactly the atoms of one ring among them
  const bonds = [...doc.bonds.values()].filter((b) => atoms.has(b.a1) && atoms.has(b.a2)).map((b) => b.id);
  const ring = ringsAmong(doc, bonds).find((r) => r.length === atoms.size && r.every((a) => atoms.has(a)));
  return ring ?? null;
}

/**
 * Keep focal points sound as a change finishes (Doc.beforeCommit): a focal point whose atom, bond
 * or ring was broken up goes back to the default, and when joining brings two structures' focal
 * points together only one stays: the structure drawn from (`from`, an atom of it), else the
 * oldest. Returns how many structures lost theirs (for a note in the status bar).
 */
export function tidyFocal(doc: Doc, before: ReadonlyMap<string, unknown>, from?: number): number {
  const touched = new Set<number>();
  const created = new Set<number>();
  let lost = 0;
  for (const [key, was] of before) {
    const id = Number(key.slice(1));
    if (key[0] === 'a') {
      if (doc.atoms.has(id)) touched.add(id);
      else if ((was as { focal?: boolean } | null)?.focal) lost++;
    } else if (key[0] === 'b') {
      const now = doc.bonds.get(id);
      const old = was as { a1: number; a2: number } | null;
      if (!old && now) created.add(id);
      for (const b of [old, now]) if (b) { touched.add(b.a1); touched.add(b.a2); }
      // a bond that was a focal point taken out: its ends let go too
      if (old && !now && doc.atoms.get(old.a1)?.focal && doc.atoms.get(old.a2)?.focal) {
        doc.updateAtom(old.a1, { focal: undefined });
        doc.updateAtom(old.a2, { focal: undefined });
        lost++;
      }
    }
  }
  const done = new Set<number>();
  for (const start of touched) {
    if (done.has(start) || !doc.atoms.has(start)) continue;
    const frag = doc.fragmentOf(start);
    for (const id of frag) done.add(id);
    const comps = markGroups(doc, frag);
    if (!comps.length) continue;
    // joined: the structure drawn from keeps its focal point (its side, before the new bonds)
    let keep = comps.find((c) => c.includes(Math.min(...comps.flat()))) ?? comps[0];
    if (comps.length > 1 && from !== undefined && frag.has(from)) {
      const side = new Set([from]);
      const stack = [from];
      while (stack.length) {
        const a = stack.pop()!;
        for (const n of doc.neighbors(a)) {
          const b = doc.bondBetween(a, n.id);
          if (!b || created.has(b.id) || side.has(n.id)) continue;
          side.add(n.id);
          stack.push(n.id);
        }
      }
      keep = comps.find((c) => c.some((id) => side.has(id))) ?? keep;
    }
    for (const c of comps) if (c !== keep) for (const id of c) doc.updateAtom(id, { focal: undefined });
    if (!soundSpot(doc, keep)) { for (const id of keep) doc.updateAtom(id, { focal: undefined }); lost++; }
  }
  return lost;
}

/** The marked atoms of a structure in groups joined by bonds between them. */
function markGroups(doc: Doc, frag: Set<number>): number[][] {
  const marked = [...frag].filter((id) => doc.atoms.get(id)?.focal).sort((a, b) => a - b);
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const s of marked) {
    if (seen.has(s)) continue;
    const c = focalAtoms(doc, [s, ...marked.filter((id) => !seen.has(id) && id !== s)]);
    // (focalAtoms starts from the lowest id given, which is s)
    for (const id of c) seen.add(id);
    out.push(c);
  }
  return out;
}

/** One atom, two bonded atoms, or exactly the atoms of one ring. */
function soundSpot(doc: Doc, ids: number[]): boolean {
  if (ids.length <= 2) return true;
  const set = new Set(ids);
  const bonds = [...doc.bonds.values()].filter((b) => set.has(b.a1) && set.has(b.a2)).map((b) => b.id);
  return ringsAmong(doc, bonds).some((r) => r.length === ids.length && r.every((a) => set.has(a)));
}
