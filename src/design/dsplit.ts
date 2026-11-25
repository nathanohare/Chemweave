// d-Orbital splitting diagrams (Chemistry ▸ Orbitals ▸ d-Orbital Splitting): a metal ion's five d
// orbitals on the left, as in the free ion, and the levels they split into in an octahedral,
// tetrahedral or square-planar field on the right, joined by dashed lines and filled with the
// ion's d electrons in the high-spin or low-spin way. The diagram is an MO diagram (mo.ts) with
// MoSpec.dsplit set, so its levels are dragged, clicked and renamed on the page as an MO diagram's
// are, and it is saved wherever an MO diagram is. Everything here is filled in automatically from
// the Side Panel's choices, and every part can still be changed by hand.
//
// The chemistry is from Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed. (Pearson, 2014),
// chapter 10, cited where each value is used.

import type { MoLevel, MoSpec } from './mo';
import { SYMBOLS, elementNumber, tablePosition } from '../chem/elements';

export type DGeometry = 'oh' | 'td' | 'sq';

/** What a d-orbital splitting diagram is of (MoSpec.dsplit). */
export interface DSplit {
  geometry: DGeometry;
  /** The metal ion, as markup (Co^{3+}); text that is no ion is kept as typed. */
  ion: string;
  /** The d electrons, 0 to 10: from the ion when it is typed, and changeable by hand. */
  d: number;
  /** How they are put in: one in each orbital before any pair (high), or the lower levels filled first (low). */
  spin: 'high' | 'low';
  /** The splitting's name, as markup (Δ_{o}). */
  label: string;
  /** A double-headed arrow with the splitting's name between the top level and the one below it. */
  arrow: boolean;
  /** Two short lines under the diagram: the spin, d count and unpaired electrons, and the LFSE (or the spin-only moment). */
  readouts: boolean;
  /** A dotted line across the split levels at their weighted average energy (the barycenter). */
  barycenter?: boolean;
}

/** One set of d orbitals in a field: its name (markup), how many orbitals, its energy in units of the splitting and where it is drawn (0 to 1). */
export interface DSet { label: string; n: number; lf?: number; at: number }

export interface DGeo { id: DGeometry; name: string; delta: string; sets: DSet[] }

/** Where a set is drawn from its energy in units of the splitting: the free ion's level (the average) at 0.55. */
const place = (lf: number): number => Math.round((0.55 + 0.7 * lf) * 1000) / 1000;

/**
 * The fields. Octahedral: t2g at −2/5 Δo and eg at +3/5 Δo relative to the average energy of the
 * five orbitals (Miessler, Fischer and Tarr, 5th ed., section 10.3.3, p. 374, and Figure 10.11).
 * Tetrahedral: the order turned over, e below t2, with Δt about 4/9 Δo for the same ligands
 * (section 10.3.5, p. 381, and Figure 10.18); e at −3/5 Δt and t2 at +2/5 Δt follow from the same
 * rule that the levels average to the free ion's energy (two orbitals at −3/5 and three at +2/5).
 * Square planar: b1g (dx²−y²) far above a1g (dz²), then eg (dxz, dyz) and b2g (dxy) lowest, the
 * order of Figure 10.16 (p. 380) and the text on p. 379 ("x² − y² ≫ z² > xz, yz > xy"); the
 * order of the lower three depends on the ligands (Figure 10.14, σ donors only, has b2g and eg
 * together), so it is only a default and the levels can be dragged. The book gives no LFSE
 * fractions for square planar, so none is given here (lf not set).
 */
export const D_GEOMETRIES: DGeo[] = [
  { id: 'oh', name: 'Octahedral', delta: 'Δ_{o}', sets: [{ label: 't_{2g}', n: 3, lf: -0.4, at: place(-0.4) }, { label: 'e_{g}', n: 2, lf: 0.6, at: place(0.6) }] },
  { id: 'td', name: 'Tetrahedral', delta: 'Δ_{t}', sets: [{ label: 'e', n: 2, lf: -0.6, at: place(-0.6) }, { label: 't_{2}', n: 3, lf: 0.4, at: place(0.4) }] },
  {
    id: 'sq', name: 'Square Planar', delta: 'Δ_{1}',
    sets: [{ label: 'b_{2g}', n: 1, at: 0.06 }, { label: 'e_{g}', n: 2, at: 0.2 }, { label: 'a_{1g}', n: 1, at: 0.36 }, { label: 'b_{1g}', n: 1, at: 0.97 }],
  },
];

export const dGeometry = (id: DGeometry | string | undefined): DGeo => D_GEOMETRIES.find((g) => g.id === id) ?? D_GEOMETRIES[0];

const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '−': '-' };
const ROMAN: Record<string, number> = { 0: 0, I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };

/** A metal ion as typed: Co3+, Co^{3+}, Co³⁺, Co+3, Co(III), Fe2+, Cu+, Ni (no charge). Null: not an element and a charge. */
export function parseIon(text: string): { symbol: string; z: number; charge: number } | null {
  const t = [...text].map((c) => SUP[c] ?? c).join('').replace(/[\s^{}_]/g, '');
  let m = /^([A-Z][a-z]?)\(([0IVX]+)\)$/.exec(t);
  let symbol: string, charge: number;
  if (m) {
    if (!(m[2] in ROMAN)) return null;
    symbol = m[1]; charge = ROMAN[m[2]];
  } else if ((m = /^([A-Z][a-z]?)(\d*)([+-])$/.exec(t))) {
    symbol = m[1]; charge = (m[2] ? Number(m[2]) : 1) * (m[3] === '-' ? -1 : 1);
  } else if ((m = /^([A-Z][a-z]?)([+-])(\d+)$/.exec(t))) {
    symbol = m[1]; charge = Number(m[3]) * (m[2] === '-' ? -1 : 1);
  } else if ((m = /^([A-Z][a-z]?)$/.exec(t))) {
    symbol = m[1]; charge = 0;
  } else return null;
  const z = elementNumber(symbol);
  if (!z || SYMBOLS[z] !== symbol) return null;
  return { symbol, z, charge };
}

/** An ion as markup: Co^{3+}, Cu^{+}, Ni. */
export const ionMarkup = (ion: { symbol: string; charge: number }): string =>
  (ion.charge ? `${ion.symbol}^{${Math.abs(ion.charge) > 1 ? Math.abs(ion.charge) : ''}${ion.charge > 0 ? '+' : '−'}}` : ion.symbol);

/**
 * The d electrons of a d-block ion: its group number less its charge, since a transition metal ion
 * loses its s electrons first (Miessler, Fischer and Tarr, 5th ed., section 2.2.4; Table 10.6,
 * p. 374, lists V²⁺ to Zn²⁺ as d³ to d¹⁰ and Ti³⁺ to Co³⁺ as d¹ to d⁶). Null: not a d-block
 * element in rows 4 to 6, or a count outside 0 to 10.
 */
export function dCount(z: number, charge: number): number | null {
  const p = tablePosition(z);
  if (!p || p.row < 4 || p.row > 6 || p.col < 3 || p.col > 12) return null;
  const d = p.col - charge;
  return d >= 0 && d <= 10 ? d : null;
}

/** The d shell's name: 3d for the first transition series (row 4), 4d and 5d below it. Null: not a d-block element. */
export function dShell(z: number): string | null {
  const p = tablePosition(z);
  return p && p.row >= 4 && p.row <= 6 && p.col >= 3 && p.col <= 12 ? `${p.row - 1}d` : null;
}

/** Electrons in each of a level's orbitals, by Hund's rule, counted as unpaired. */
const singles = (n: number, e: number): number => (e <= n ? e : 2 * n - e);

/**
 * The d electrons put into levels listed lowest first (each { n } orbitals). High spin: one in
 * every orbital, lowest first, before any pair; low spin: each level filled before the next.
 */
export function dFill(levels: { n: number }[], d: number, spin: 'high' | 'low'): number[] {
  const room = levels.reduce((t, l) => t + 2 * l.n, 0);
  let left = Math.max(0, Math.min(room, Math.round(d)));
  const out = levels.map(() => 0);
  if (spin === 'low') {
    levels.forEach((l, i) => { const k = Math.min(left, 2 * l.n); out[i] = k; left -= k; });
    return out;
  }
  for (const pass of [0, 1]) {
    levels.forEach((l, i) => { const k = Math.min(left, l.n); out[i] += k; left -= k; });
    if (!left || pass) break;
  }
  return out;
}

/** Whether high and low spin fill this many d electrons differently in these levels (lowest first). */
export const spinMatters = (levels: { n: number }[], d: number): boolean => dFill(levels, d, 'high').join() !== dFill(levels, d, 'low').join();

/** The split levels of a diagram, lowest first. */
export const splitLevels = (spec: MoSpec): MoLevel[] => spec.levels.filter((l) => l.column === 'middle' && Number.isFinite(l.e)).sort((a, b) => a.e - b.e);

/** The free ion's level (the left column's first). */
const freeIon = (spec: MoSpec): MoLevel | undefined => spec.levels.find((l) => l.column === 'left');

/** A whole diagram for these choices. `shell` names the free ion's level when the ion is not one dShell knows. */
export function fromDSplit(ds: DSplit, shell = '3d'): MoSpec {
  const g = dGeometry(ds.geometry);
  const ion = parseIon(ds.ion);
  const name = (ion && dShell(ion.z)) || shell;
  const d = Math.max(0, Math.min(10, Math.round(ds.d)));
  const fill = dFill(g.sets, d, ds.spin);
  const bary = Math.round((g.sets.reduce((t, s) => t + s.n * s.at, 0) / 5) * 1000) / 1000;
  const levels: MoLevel[] = [
    { column: 'left', label: name, e: bary, n: 5, electrons: d, auto: true },
    ...g.sets.map((s, i): MoLevel => ({ column: 'middle', label: s.label, e: s.at, n: s.n, electrons: fill[i], from: name, auto: true, ...(s.lf !== undefined ? { lf: s.lf } : {}) })),
  ];
  return { levels, titles: [`${ds.ion} free ion`, g.name, ''], axis: true, rich: true, relative: true, labelBack: 'white', dsplit: { ...ds, d } };
}

/** A new diagram: cobalt(III), octahedral and low spin, as [Co(NH₃)₆]³⁺ (d⁶ low spin: Miessler, Fischer and Tarr, 5th ed., Table 10.7). */
export const newDSplit = (): MoSpec => fromDSplit({ geometry: 'oh', ion: 'Co^{3+}', d: 6, spin: 'low', label: 'Δ_{o}', arrow: true, readouts: true });

/**
 * The diagram with its choices changed, as one change. A new geometry or ion draws the levels
 * again (and the titles); a new d count or spin fills the levels that are there again, where they
 * now are; the rest only changes the look. An ion that is a d-block ion sets the d count (unless
 * one is given too); other text is kept as typed and changes nothing else.
 */
export function setDSplit(spec: MoSpec, patch: Partial<DSplit>): MoSpec {
  const was = spec.dsplit;
  if (!was) return spec;
  const next: DSplit = { ...was, ...patch };
  if (patch.ion !== undefined) {
    const ion = parseIon(patch.ion);
    next.ion = ion ? ionMarkup(ion) : patch.ion.trim();
    const d = ion ? dCount(ion.z, ion.charge) : null;
    if (patch.d === undefined && d !== null) next.d = d;
  }
  if (patch.geometry !== undefined && patch.geometry !== was.geometry) {
    // tetrahedral splitting is small, so tetrahedral complexes are high spin (section 10.3.5);
    // square planar's top level lies far above the rest, almost always more than the pairing
    // energy, so it stays empty below d⁹ (p. 380): low spin
    if (patch.spin === undefined && patch.geometry === 'td') next.spin = 'high';
    if (patch.spin === undefined && patch.geometry === 'sq') next.spin = 'low';
    if (patch.label === undefined && was.label === dGeometry(was.geometry).delta) next.label = dGeometry(patch.geometry).delta;
  }
  next.d = Math.max(0, Math.min(10, Math.round(next.d)));
  const { levels: _l, titles: _t, dsplit: _d, ...look } = spec;
  if (next.geometry !== was.geometry || next.ion !== was.ion) {
    const made = fromDSplit(next, freeIon(spec)?.label || '3d');
    return { ...look, levels: made.levels, titles: made.titles, dsplit: made.dsplit };
  }
  if (next.d !== was.d || next.spin !== was.spin) return { ...spec, dsplit: next, levels: refill(spec.levels, next) };
  return { ...spec, dsplit: next };
}

/** The levels with the d electrons put in again: all on the free ion, and in the split levels in the order they are now drawn. */
function refill(levels: MoLevel[], ds: DSplit): MoLevel[] {
  const split = levels.map((l, i) => ({ l, i })).filter((x) => x.l.column === 'middle' && Number.isFinite(x.l.e)).sort((a, b) => a.l.e - b.l.e);
  const fill = dFill(split.map((x) => x.l), ds.d, ds.spin);
  const out = levels.map((l) => ({ ...l }));
  split.forEach((x, k) => { out[x.i].electrons = fill[k]; });
  const ion = out.findIndex((l) => l.column === 'left' && l.auto);
  if (ion >= 0) out[ion].electrons = Math.min(2 * out[ion].n, ds.d);
  return out;
}

/** What the split levels add up to, from the electrons drawn in them. */
export interface DReadout {
  /** t_{2g}^{6} e_{g}^{0}, lowest first (markup). */
  config: string;
  electrons: number;
  unpaired: number;
  /** The LFSE in fifths of the splitting (−12 for −12/5 Δo); null when a level has no energy in units of the splitting (square planar, or one added by hand). */
  lfse: number | null;
  /** The spin-only moment, √(n(n + 2)) Bohr magnetons. */
  moment: number;
  /** Which way the drawn electrons are put in, when high and low spin differ and they match one of them. */
  spin: 'high' | 'low' | null;
}

/**
 * The readout. LFSE: each electron's energy relative to the five orbitals' average, added up, as
 * Miessler, Fischer and Tarr define it (5th ed., section 10.3.3, p. 374; Table 10.7, p. 375 for
 * octahedral values), without the pairing energy. Spin-only moment: μS = √(n(n + 2)) μB for n
 * unpaired electrons (p. 360, and Table 10.3, p. 361).
 */
export function dReadout(spec: MoSpec): DReadout {
  const split = splitLevels(spec);
  const electrons = split.reduce((t, l) => t + l.electrons, 0);
  const unpaired = split.reduce((t, l) => t + singles(l.n, l.electrons), 0);
  const lfse = split.length && split.every((l) => typeof l.lf === 'number') ? Math.round(split.reduce((t, l) => t + l.electrons * l.lf!, 0) * 5) || 0 : null;
  const drawn = split.map((l) => l.electrons).join();
  const hs = dFill(split, electrons, 'high').join(), ls = dFill(split, electrons, 'low').join();
  const spin = hs === ls ? null : drawn === hs ? 'high' : drawn === ls ? 'low' : null;
  const config = split.map((l) => `${l.label.trim()}^{${l.electrons}}`).join(' ');
  return { config, electrons, unpaired, lfse, moment: Math.sqrt(unpaired * (unpaired + 2)), spin };
}

/** An LFSE in fifths as markup with the splitting's name: −12/5 Δ_{o}, or 0. */
export const lfseMarkup = (fifths: number, label: string): string => (fifths === 0 ? '0' : `${fifths < 0 ? '−' : ''}${Math.abs(fifths)}/5 ${label}`);

/** The two lines drawn under the diagram (markup). */
export function readoutLines(spec: MoSpec): [string, string] {
  const r = dReadout(spec), ds = spec.dsplit;
  const spin = r.spin === 'high' ? 'High spin ' : r.spin === 'low' ? 'Low spin ' : '';
  const first = `${spin}d^{${r.electrons}}, ${r.unpaired} unpaired`;
  const second = r.lfse !== null ? `LFSE = ${lfseMarkup(r.lfse, ds?.label || 'Δ')}` : `μ_{S} = ${r.moment.toFixed(2)} μ_{B}`;
  return [first, second];
}

/** A splitting name typed in the Side Panel as markup: Δo becomes Δ_{o}; markup is kept. */
export function deltaMarkup(text: string): string {
  const t = text.trim();
  if (/[_^\\]/.test(t)) return t;
  const m = /^Δ\s*([A-Za-z0-9]+)$/.exec(t);
  return m ? `Δ_{${m[1]}}` : t;
}
