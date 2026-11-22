// The chiral flag drawn beside a structure (Chemistry > Chiral Flag: a boxed Abs, Rel or Rac), as
// the molfile writer and readers use it. A molfile's chiral flag (BIOVIA CTfile Formats, 2020: the
// counts line in V2000, COUNTS in V3000) is 1 when the wedges show the absolute configuration and
// 0 when they show only the relative one; this program draws that as an Abs flag.

import { CHIRAL_FLAGS, type Doc, type Shape } from '../model';
import { arialWidth } from '../text-metrics';

export type ChiralFlag = 'Absolute' | 'Relative' | 'Racemic';

/** The chiral flag drawn for the structure made of these atoms: below it or beside it, within about a bond length. */
export function flagNear(doc: Doc, atomIds: Iterable<number>): Shape | undefined {
  const atoms = [...atomIds].map((id) => doc.atoms.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
  if (!atoms.length) return undefined;
  const box = { x1: Math.min(...atoms.map((a) => a.x)), y1: Math.min(...atoms.map((a) => a.y)), x2: Math.max(...atoms.map((a) => a.x)), y2: Math.max(...atoms.map((a) => a.y)) };
  const L = doc.style.bondLength;
  return [...doc.shapes.values()].find((s) => s.kind === 'symbol' && s.symbol && CHIRAL_FLAGS[s.symbol] && s.x1 < box.x2 + L && s.x2 > box.x1 - L && s.y1 < box.y2 + 2 * L && s.y2 > box.y1 - L);
}

/** Each atom's structure's chiral flag (atoms of a structure without one are left out), with the structure's lowest atom id. */
export function flagsByAtom(doc: Doc, atomIds: Iterable<number>): Map<number, { flag: ChiralFlag; frag: number }> {
  const out = new Map<number, { flag: ChiralFlag; frag: number }>();
  const done = new Set<number>();
  if (![...doc.shapes.values()].some((s) => s.kind === 'symbol' && s.symbol && CHIRAL_FLAGS[s.symbol])) return out;
  for (const id of atomIds) {
    if (done.has(id) || !doc.atoms.has(id)) continue;
    const frag = doc.fragmentOf(id);
    for (const k of frag) done.add(k);
    const f = flagNear(doc, frag)?.symbol as ChiralFlag | undefined;
    if (!f) continue;
    const first = Math.min(...frag);
    for (const k of frag) out.set(k, { flag: f, frag: first });
  }
  return out;
}

/** Draw a chiral flag below and to the right of the structure made of these atoms (as Chemistry > Chiral Flag places it). */
export function addChiralFlag(doc: Doc, atomIds: Iterable<number>, flag: ChiralFlag, width?: (text: string, size: number) => number): number | null {
  const atoms = [...atomIds].map((id) => doc.atoms.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
  if (!atoms.length) return null;
  const x2a = Math.max(...atoms.map((a) => a.x)), y2a = Math.max(...atoms.map((a) => a.y));
  const L = doc.style.bondLength;
  const size = doc.style.captionSize || 10;
  const w = (width ?? arialWidth)(CHIRAL_FLAGS[flag], size) + 4, h = size * 1.15 + 4;
  const x2 = x2a + L * 0.3, y1 = y2a + L * 0.6;
  return doc.addShape({ kind: 'symbol', symbol: flag, x1: x2 - w, y1, x2, y2: y1 + h }).id;
}
