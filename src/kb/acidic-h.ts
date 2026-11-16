// The hydrogen a pKa belongs to, drawn on its own bond and picked out in red (Nate's pick B,
// 2026-11-16): the pKa Values pictures, and any other table that draws an acid.

import type { Template, TemplateAtom } from '../chem/templates';

/** The acidic hydrogen and its bond: red, readable on a light or a dark window. */
export const ACIDIC_H_COLOR = '#d93a3a';

/** A lone atom written as its formula (H2O, HCl, NH4) keeps this text once one hydrogen is drawn apart. */
const ALONE_WITH_H: Record<string, string> = { C: 'CH3' };

/**
 * The drawing with a hydrogen added on `atom`, on a bond of its own, both red. `protonate`: the
 * value is the conjugate acid's (pyridine's 5.14 is pyridinium's), so the atom takes the hydrogen on
 * and gains a charge. The hydrogen goes where it has the most room: the widest gap between the
 * atom's bonds (a zigzag off a chain end), clear of the other atoms.
 */
export function withAcidicH(t: Template, atom: number, protonate = false): Template {
  if (atom < 0 || atom >= t.atoms.length) return t;
  const atoms = t.atoms.map((a) => [...a] as TemplateAtom);
  const bonds = t.bonds.map((b) => [...b] as Template['bonds'][number]);
  const [x, y, el, charge, text] = atoms[atom];
  // a lone atom written as its formula (H2O): the drawn hydrogen takes over from the formula's
  const label = text && bonds.length ? text : text ? ALONE_WITH_H[el] : undefined;
  const q = (charge ?? 0) + (protonate ? 1 : 0);
  atoms[atom] = label ? [x, y, el, q, label] : q ? [x, y, el, q] : [x, y, el];
  const dirs = bonds.filter((b) => b[0] === atom || b[1] === atom).map((b) => {
    const o = atoms[b[0] === atom ? b[1] : b[0]];
    return Math.atan2(o[1] - y, o[0] - x);
  });
  const best = hydrogenAngle(atoms, atom, dirs);
  atoms.push([x + Math.cos(best), y + Math.sin(best), 'H']);
  bonds.push([atom, atoms.length - 1, 1]);
  return { ...t, atoms, bonds, highlight: { atoms: [atoms.length - 1], bonds: [bonds.length - 1], color: ACIDIC_H_COLOR } };
}

/** The direction (radians) for a new bond from `atom`, given its bonds' directions. */
function hydrogenAngle(atoms: TemplateAtom[], atom: number, dirs: number[]): number {
  const [x, y] = atoms[atom];
  const apart = (p: number, q: number) => Math.abs(((p - q + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  let best = 0, score = -Infinity;
  for (let d = 0; d < 360; d += 5) {
    const r = (d * Math.PI) / 180, hx = x + Math.cos(r), hy = y + Math.sin(r);
    let near = 1.6;
    atoms.forEach(([ax, ay], i) => { if (i !== atom) near = Math.min(near, Math.hypot(ax - hx, ay - hy)); });
    const gap = dirs.length ? Math.min(...dirs.map((q) => apart(r, q))) : Math.PI;
    // one bond: a zigzag (120°) reads best; a lone atom: to the right
    const zig = dirs.length === 1 ? -Math.abs(gap - (2 * Math.PI) / 3) * 1.5 : dirs.length ? 0 : -apart(r, 0);
    const s = near + gap * 0.8 + zig;
    if (s > score + 1e-9) { score = s; best = r; }
  }
  return best;
}
