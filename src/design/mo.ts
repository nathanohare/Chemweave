// Molecular orbital diagrams (Chemistry ▸ Orbitals ▸ MO Diagram…): the atomic orbitals of two
// atoms (or fragments) at the sides, the molecular orbitals they make in the middle, each level
// drawn as one short line per orbital (two or three side by side when degenerate), filled with
// ↑ and ↓ electrons by Hund's rule, and joined to the atomic orbitals they come from by dashed
// lines. A level's energy is its relative position in the diagram, 0 (the bottom) to 1 (the top): it
// has no units, and only sets the order and spacing.

import type { Caption, Doc, Shape } from '../model';
import type { Rect, Vec } from '../geom';
import type { Measure } from '../editor/arrange';
import { chemRuns } from '../text/chemtext';
import { orbitalShapes, type OrbitalLook, type OrbitalSpec } from '../chem/orbitals';

export type MoColumn = 'left' | 'middle' | 'right';

export interface MoLevel {
  column: MoColumn;
  /** The orbital's name (1s, 2p, σ, π*, HOMO…): rich text written as markup (see parseMarkup). */
  label: string;
  /**
   * Its energy as a relative position in the diagram, 0 (the bottom) to 1 (the top), when the
   * diagram is `relative`. In a diagram saved before that, any number: the lowest level was drawn
   * at the bottom and the highest at the top (toRelative turns those into 0 to 1).
   */
  e: number;
  /** How many orbitals at this level (1 to 5). */
  n: number;
  /** Electrons in them (0 to 2n), put in by Hund's rule. */
  electrons: number;
  /** A molecular orbital: the names of the atomic orbitals it is made from, joined to it by dashed lines ("2p", or "1s, 2p" when the two sides differ). */
  from?: string;
  /** Made from one side's orbitals only (a nonbonding orbital, as HF's F 2p). */
  fromSide?: 'left' | 'right';
  /** Filled in from the diagram's atoms (see MoSpec.atoms): how many orbitals, their electrons and what they are made from follow from the atoms. Not set: a level added by hand. */
  auto?: boolean;
}

export interface MoSpec {
  levels: MoLevel[];
  /** The names under the three columns ("N", "N₂", "N"). */
  titles: [string, string, string];
  /** An energy arrow up the left side. */
  axis: boolean;
  /** Energies are relative positions, 0 (bottom) to 1 (top). Not set in diagrams saved before that (see MoLevel.e). */
  relative?: boolean;
  /**
   * The two atoms the diagram was filled from (MO_ATOMS ids), the electrons in the molecule and
   * whether π lies below σ in the p set. Not set: a custom diagram, where everything is typed.
   */
  atoms?: { left: string; right: string; electrons: number; mixing: boolean };
  /**
   * Names and titles are rich text kept as markup (parseMarkup), drawn exactly as written. Not set
   * in diagrams made before rich text: theirs went through chemical interpretation (chemRuns),
   * and the window turns them into markup when it opens them.
   */
  rich?: boolean;
  /** The ↑ and ↓ electrons: how tall, in points (see electronLook for the defaults). */
  arrowSize?: number;
  /** Their line width, in points (not set: the drawing's). */
  arrowWidth?: number;
  /** How far above the level line they start, in points. */
  arrowGap?: number;
  /** The diagram's size when the three were set (the square root of its width × height): they grow and shrink with it from there. */
  arrowAt?: number;
  /** The dashed lines' color (not set: black) and how see-through they are, 0 to 1. */
  lineColor?: string;
  lineTransparency?: number;
  /** A white background behind each name: the dashed lines stop at its edge instead of cutting through it. */
  labelBack?: 'white';
  /** Move the molecular orbitals' names to the side, clear of the dashed lines. */
  labelClear?: boolean;
  /** Pictures of the orbitals mixing: each atomic orbital's shape beside it, and each molecular orbital's in-phase or out-of-phase combination beside it. */
  pictures?: boolean;
  /** The pictures' look, as Chemistry ▸ Orbital draws them. */
  pictureLook?: OrbitalLook;
  /** The pictures' size, as a part of the usual (1 = 100%); either way they grow and shrink with the diagram. */
  pictureSize?: number;
}

/** A piece of rich text: plain, subscript or superscript. */
export interface MoPart { text: string; sub?: boolean; sup?: boolean }

/**
 * Rich text from markup: _{…} is a subscript and ^{…} a superscript (or _x and ^x for one
 * character), and a backslash makes the next character plain (\_, \^, \\, \} inside braces).
 */
export function parseMarkup(text: string): MoPart[] {
  const out: MoPart[] = [];
  const put = (t: string, pos?: 'sub' | 'sup') => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && !!last.sub === (pos === 'sub') && !!last.sup === (pos === 'sup')) { last.text += t; return; }
    out.push({ text: t, ...(pos ? { [pos]: true } : {}) });
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) { put(text[i + 1]); i += 2; continue; }
    if ((c === '_' || c === '^') && i + 1 < text.length && !/\s/.test(text[i + 1])) {
      const pos = c === '_' ? 'sub' : 'sup';
      if (text[i + 1] === '{') {
        let j = i + 2, t = '';
        while (j < text.length && text[j] !== '}') {
          if (text[j] === '\\' && j + 1 < text.length) { t += text[j + 1]; j += 2; } else t += text[j++];
        }
        put(t, pos);
        i = j + 1;
      } else {
        const ch = String.fromCodePoint(text.codePointAt(i + 1)!);
        put(ch, pos);
        i += 1 + ch.length;
      }
      continue;
    }
    put(c);
    i++;
  }
  return out;
}

/** Markup for rich text (parseMarkup reads it back the same). */
export function toMarkup(parts: MoPart[]): string {
  return parts.map((p) => {
    if (p.sub || p.sup) return `${p.sub ? '_' : '^'}{${p.text.replace(/[\\}]/g, (c) => `\\${c}`)}}`;
    return p.text.replace(/[\\_^]/g, (c) => `\\${c}`);
  }).join('');
}

/** A name or title as rich text, however the diagram keeps it. */
export const moParts = (spec: Pick<MoSpec, 'rich'>, text: string): MoPart[] => (spec.rich ? parseMarkup(text) : chemRuns(text));

/** A name as plain text (σ2s for σ_{2s}): what "Made from" names it by. */
export const moPlain = (text: string): string => parseMarkup(text).map((p) => p.text).join('').trim();

/** A diagram made before rich text, with its names and titles turned into markup that draws the same. */
export function toRich(spec: MoSpec): MoSpec {
  if (spec.rich) return spec;
  const conv = (t: string) => toMarkup(chemRuns(t));
  return {
    ...spec, rich: true,
    titles: spec.titles.map(conv) as [string, string, string],
    levels: spec.levels.map((l) => ({ ...l, label: conv(l.label), ...(l.from ? { from: l.from.split(',').map((x) => moPlain(x)).filter(Boolean).join(', ') } : {}) })),
  };
}

/** A level's place up the diagram, 0 (bottom) to 1 (top): where drawMo draws it. */
const place = (e: number): number => Math.max(0, Math.min(1, e));

/**
 * A diagram with its energies as relative positions, 0 (bottom) to 1 (top). One saved before that
 * had energies in any units, drawn with the lowest at the bottom and the highest at the top: the
 * same places, so it draws as it did (all at one energy: the middle).
 */
export function toRelative(spec: MoSpec): MoSpec {
  if (spec.relative) return spec;
  const es = spec.levels.map((l) => l.e).filter((e) => Number.isFinite(e));
  const lo = Math.min(...es), hi = Math.max(...es);
  const at = (e: number) => (!Number.isFinite(e) ? e : hi === lo ? 0.5 : Math.round(((e - lo) / (hi - lo)) * 1000) / 1000);
  return { ...spec, relative: true, levels: spec.levels.map((l) => ({ ...l, e: at(l.e) })) };
}

export interface MoPreset { id: string; name: string; spec: MoSpec; /** An ion's charge: the molecular orbitals hold that many fewer electrons than the atoms gave. */ charge?: number }

const lv = (column: MoColumn, label: string, e: number, n: number, electrons: number, from?: string, fromSide?: 'left' | 'right'): MoLevel =>
  ({ column, label, e, n, electrons, ...(from ? { from } : {}), ...(fromSide ? { fromSide } : {}) });

/** One atom's valence orbitals for Autofill, with their potential energies in eV (approximate, as tabulated in inorganic chemistry texts). */
export interface MoAtom { id: string; /** Atomic number. */ z: number; name: string; symbol: string; orbitals: { label: string; e: number; n: number; electrons: number }[] }

export const MO_ATOMS: MoAtom[] = [
  { id: 'H', z: 1, name: 'Hydrogen', symbol: 'H', orbitals: [{ label: '1s', e: -13.6, n: 1, electrons: 1 }] },
  { id: 'He', z: 2, name: 'Helium', symbol: 'He', orbitals: [{ label: '1s', e: -24.6, n: 1, electrons: 2 }] },
  { id: 'Li', z: 3, name: 'Lithium', symbol: 'Li', orbitals: [{ label: '2s', e: -5.4, n: 1, electrons: 1 }, { label: '2p', e: -3.5, n: 3, electrons: 0 }] },
  { id: 'Be', z: 4, name: 'Beryllium', symbol: 'Be', orbitals: [{ label: '2s', e: -9.3, n: 1, electrons: 2 }, { label: '2p', e: -6.0, n: 3, electrons: 0 }] },
  { id: 'B', z: 5, name: 'Boron', symbol: 'B', orbitals: [{ label: '2s', e: -14.0, n: 1, electrons: 2 }, { label: '2p', e: -8.3, n: 3, electrons: 1 }] },
  { id: 'C', z: 6, name: 'Carbon', symbol: 'C', orbitals: [{ label: '2s', e: -19.4, n: 1, electrons: 2 }, { label: '2p', e: -10.7, n: 3, electrons: 2 }] },
  { id: 'N', z: 7, name: 'Nitrogen', symbol: 'N', orbitals: [{ label: '2s', e: -25.6, n: 1, electrons: 2 }, { label: '2p', e: -13.2, n: 3, electrons: 3 }] },
  { id: 'O', z: 8, name: 'Oxygen', symbol: 'O', orbitals: [{ label: '2s', e: -32.4, n: 1, electrons: 2 }, { label: '2p', e: -15.9, n: 3, electrons: 4 }] },
  { id: 'F', z: 9, name: 'Fluorine', symbol: 'F', orbitals: [{ label: '2s', e: -40.2, n: 1, electrons: 2 }, { label: '2p', e: -18.7, n: 3, electrons: 5 }] },
  { id: 'Ne', z: 10, name: 'Neon', symbol: 'Ne', orbitals: [{ label: '2s', e: -48.5, n: 1, electrons: 2 }, { label: '2p', e: -21.6, n: 3, electrons: 6 }] },
  { id: 'Cl', z: 17, name: 'Chlorine', symbol: 'Cl', orbitals: [{ label: '3s', e: -25.3, n: 1, electrons: 2 }, { label: '3p', e: -13.7, n: 3, electrons: 5 }] },
  { id: 'Csp3', z: 6, name: 'Carbon, sp³ hybrid (one bond)', symbol: 'C', orbitals: [{ label: 'sp^{3}', e: -12.9, n: 1, electrons: 1 }] },
  { id: 'Csp2', z: 6, name: 'Carbon, sp² hybrid (one bond)', symbol: 'C', orbitals: [{ label: 'sp^{2}', e: -13.5, n: 1, electrons: 1 }] },
  { id: 'Csp', z: 6, name: 'Carbon, sp hybrid (one bond)', symbol: 'C', orbitals: [{ label: 'sp', e: -15.1, n: 1, electrons: 1 }] },
];

/** Put electrons into the molecular orbitals lowest first (two to an orbital); Hund's rule spreads them within a level. */
export function aufbau(levels: MoLevel[], total: number): MoLevel[] {
  let left = total;
  const order = levels.map((l, i) => ({ l, i })).filter((x) => x.l.column === 'middle').sort((a, b) => a.l.e - b.l.e);
  const out = levels.map((l) => ({ ...l }));
  for (const { i } of order) { const k = Math.min(left, 2 * out[i].n); out[i].electrons = k; left -= k; }
  return out;
}

/** The atomic orbitals on one side from an atom. */
export const atomLevels = (atom: MoAtom, column: 'left' | 'right'): MoLevel[] => atom.orbitals.map((o) => lv(column, o.label, o.e, o.n, o.electrons));

const atom = (id: string) => MO_ATOMS.find((a) => a.id === id)!;

/**
 * A diatomic of second-row atoms: σ2s, σ*2s, then the 2p set, with π below σ2p when the s and p
 * orbitals mix (B₂, C₂, N₂; CN⁻) and above it when they don't (O₂, F₂). `charge` adds or takes electrons.
 */
function diatomic(a: string, b: string, mixing: boolean, charge = 0): MoSpec {
  const A = atom(a), B = atom(b);
  const s = (A.orbitals[0].e + B.orbitals[0].e) / 2, p = (A.orbitals[1].e + B.orbitals[1].e) / 2, g = p - s;
  const r = (x: number) => Math.round(x * 10) / 10;
  const twoP = mixing
    ? [lv('middle', 'π_{2p}', r(p - 0.32 * g), 2, 0, '2p'), lv('middle', 'σ_{2p}', r(p - 0.15 * g), 1, 0, '2p')]
    : [lv('middle', 'σ_{2p}', r(p - 0.38 * g), 1, 0, '2p'), lv('middle', 'π_{2p}', r(p - 0.2 * g), 2, 0, '2p')];
  const levels = [...atomLevels(A, 'left'), ...atomLevels(B, 'right'),
    lv('middle', 'σ_{2s}', r(s - 0.22 * g), 1, 0, '2s'), lv('middle', 'σ^{*}_{2s}', r(s + 0.18 * g), 1, 0, '2s'),
    ...twoP, lv('middle', 'π^{*}_{2p}', r(p + 0.22 * g), 2, 0, '2p'), lv('middle', 'σ^{*}_{2p}', r(p + 0.45 * g), 1, 0, '2p')];
  const total = levels.filter((l) => l.column !== 'middle').reduce((t, l) => t + l.electrons, 0) - charge;
  return { titles: [A.symbol, a === b ? `${A.symbol}_{2}` : `${A.symbol}${B.symbol}`, B.symbol], axis: true, rich: true, levels: aufbau(levels, total) };
}

/** Two s orbitals (H₂, He₂). */
function sOnly(a: string): MoSpec {
  const A = atom(a), e = A.orbitals[0].e, d = a === 'H' ? 0.6 : 0.4;
  const levels = [...atomLevels(A, 'left'), ...atomLevels(A, 'right'),
    lv('middle', `σ_{${A.orbitals[0].label}}`, e - 8 * d, 1, 0, A.orbitals[0].label), lv('middle', `σ^{*}_{${A.orbitals[0].label}}`, e + 10 * d, 1, 0, A.orbitals[0].label)];
  return { titles: [A.symbol, `${A.symbol}_{2}`, A.symbol], axis: true, rich: true, levels: aufbau(levels, 2 * A.orbitals[0].electrons) };
}

const withTitle = (spec: MoSpec, middle: string): MoSpec => ({ ...spec, titles: [spec.titles[0], middle, spec.titles[2]] });

/** Starting points for teaching: qualitative orders from MO theory, energies near the atoms' orbital potential energies (eV). */
const PRESETS: MoPreset[] = [
  { id: 'h2', name: 'H₂ (two 1s orbitals)', spec: sOnly('H') },
  { id: 'he2', name: 'He₂ (bond order 0)', spec: sOnly('He') },
  { id: 'li2', name: 'Li₂ (2s only)', spec: (() => {
    const L = atom('Li'), e = L.orbitals[0].e;
    const levels = [lv('left', '2s', e, 1, 1), lv('right', '2s', e, 1, 1), lv('middle', 'σ_{2s}', e - 1.6, 1, 2, '2s'), lv('middle', 'σ^{*}_{2s}', e + 1.9, 1, 0, '2s')];
    return { titles: ['Li', 'Li_{2}', 'Li'], axis: true, rich: true, levels };
  })() },
  { id: 'b2', name: 'B₂ (π below σ2p; two unpaired)', spec: diatomic('B', 'B', true) },
  { id: 'c2', name: 'C₂ (π below σ2p)', spec: diatomic('C', 'C', true) },
  { id: 'n2', name: 'N₂ (s–p mixing: π below σ2p)', spec: diatomic('N', 'N', true) },
  { id: 'o2', name: 'O₂ (σ2p below π; two unpaired electrons)', spec: diatomic('O', 'O', false) },
  { id: 'o2-', name: 'O₂⁻ (superoxide)', spec: withTitle(diatomic('O', 'O', false, -1), 'O_{2}^{−}'), charge: -1 },
  { id: 'o22-', name: 'O₂²⁻ (peroxide)', spec: withTitle(diatomic('O', 'O', false, -2), 'O_{2}^{2−}'), charge: -2 },
  { id: 'f2', name: 'F₂', spec: diatomic('F', 'F', false) },
  { id: 'cn-', name: 'CN⁻ (like N₂)', spec: withTitle(diatomic('C', 'N', true, -1), 'CN^{−}'), charge: -1 },
  { id: 'co', name: 'CO (C higher, O lower)', spec: { titles: ['C', 'CO', 'O'], axis: true, rich: true, levels: [
    ...atomLevels(atom('C'), 'left'), ...atomLevels(atom('O'), 'right'),
    lv('middle', '1σ', -34.5, 1, 2, '2s'), lv('middle', '2σ^{*}', -20.8, 1, 2, '2s'), lv('middle', '1π', -17.2, 2, 4, '2p'),
    lv('middle', '3σ (HOMO)', -14.0, 1, 2, '2p'), lv('middle', '2π^{*} (LUMO)', -8.5, 2, 0, '2p'), lv('middle', '4σ^{*}', -4.5, 1, 0, '2p'),
  ] } },
  { id: 'hf', name: 'HF (nonbonding F orbitals)', spec: { titles: ['H', 'HF', 'F'], axis: true, rich: true, levels: [
    ...atomLevels(atom('H'), 'left'), ...atomLevels(atom('F'), 'right'),
    lv('middle', '1σ', -40.2, 1, 2, '2s', 'right'), lv('middle', '2σ', -20.6, 1, 2, '1s, 2p'),
    lv('middle', '1π', -18.7, 2, 4, '2p', 'right'), lv('middle', '3σ^{*}', -9.5, 1, 0, '1s, 2p'),
  ] } },
  { id: 'cf', name: 'C–F σ bond (sp³ C with F 2p)', spec: { titles: ['C', 'C–F', 'F'], axis: true, rich: true, levels: [
    lv('left', 'sp^{3}', -12.9, 1, 1), lv('right', '2p', -18.7, 1, 1),
    lv('middle', 'σ_{C–F}', -20.4, 1, 2, 'sp^{3}, 2p'), lv('middle', 'σ^{*}_{C–F}', -9.8, 1, 0, 'sp^{3}, 2p'),
  ] } },
  { id: 'ethylene', name: 'Ethylene π bond (two p orbitals)', spec: { titles: ['C', 'C=C π', 'C'], axis: true, rich: true, levels: [
    lv('left', '2p', 0, 1, 1), lv('right', '2p', 0, 1, 1), lv('middle', 'π (HOMO)', -1, 1, 2, '2p'), lv('middle', 'π^{*} (LUMO)', 1, 1, 0, '2p'),
  ] } },
  { id: 'custom', name: 'Custom MO Diagram', spec: { titles: ['A', 'AB', 'B'], axis: true, rich: true, levels: [
    lv('left', 'φ_{A}', 0.4, 1, 1), lv('right', 'φ_{B}', -0.4, 1, 1), lv('middle', 'ψ_{1}', -1.2, 1, 2, 'φA, φB'), lv('middle', 'ψ_{2}', 1.4, 1, 0, 'φA, φB'),
  ] } },
];

export const MO_PRESETS: MoPreset[] = PRESETS.map((p) => ({ ...p, spec: toRelative(p.spec) }));

/** How many orbitals an atomic orbital's name stands for: one s (or hybrid), three p, five d, seven f. Fixed by what the orbital is. */
export function aoDegeneracy(label: string): number {
  const k = aoKind(label);
  if (k !== 's' && k !== 'p') return 1;
  const t = moPlain(label).toLowerCase().replace(/[^a-z]/g, '');
  return t.endsWith('p') ? 3 : t.endsWith('d') ? 5 : t.endsWith('f') ? 7 : 1;
}

/**
 * Whether π lies below σ in the p set of a diatomic of these two atoms: so for Li₂ through N₂, and
 * σ below π from O₂ on ("Homonuclear Diatomic Molecules", LibreTexts Inorganic Chemistry, after
 * Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed., Pearson 2014:
 * https://chem.libretexts.org/Courses/Centre_College/CHE_332%3A_Inorganic_Chemistry/04%3A_Molecular_Orbitals/4.02%3A_Molecular_Orbital_Theory_of_Diatomic_Molecules/4.2.02%3A_Homonuclear_Diatomic_Molecules).
 * For two different atoms there is no one rule; this takes the earlier atom's, which puts CO's 1π
 * below its 3σ as the same book's heteronuclear section has it, and the window lets it be changed.
 */
export const mixingFor = (a: MoAtom, b: MoAtom): boolean => Math.min(a.z, b.z) <= 7;

const sOf = (a: MoAtom) => a.orbitals.find((o) => o.n === 1 && aoKind(o.label) === 's');
const pOf = (a: MoAtom) => a.orbitals.find((o) => o.n === 3);

/** Whether a diagram can be filled in from these two atoms (hybrids and other one-orbital fragments only pair with each other or with a p orbital by hand). */
export const canFill = (a: MoAtom, b: MoAtom): boolean => !!sOf(a) && !!sOf(b);

/**
 * The diagram for a diatomic of two atoms, with `electrons` in the molecule (not given: the
 * atoms' own, a neutral molecule). Two s orbitals make σ and σ*; two p sets make σ, π, π* and σ*;
 * an atom with only an s orbital beside one with s and p (HF) makes σ and σ* from its s and the
 * other's p, and leaves the other's s and two of its p orbitals nonbonding. Energies are relative
 * positions worked out from the atoms' orbital energies.
 */
export function fromAtoms(a: string, b: string, electrons?: number, mixing?: boolean): MoSpec | null {
  const A = MO_ATOMS.find((x) => x.id === a), B = MO_ATOMS.find((x) => x.id === b);
  if (!A || !B || !canFill(A, B)) return null;
  const mix = mixing ?? mixingFor(A, B);
  const sa = sOf(A)!, sb = sOf(B)!, pa = pOf(A), pb = pOf(B);
  const same = a === b;
  const title = same ? `${A.symbol}_{2}` : `${A.symbol}${B.symbol}`;
  const r = (x: number) => Math.round(x * 10) / 10;
  const mid: MoLevel[] = [];
  const both = (x: string, y: string) => (x === y ? x : `${x}, ${y}`);
  /** Names: σ2s, σ*2s… when both sides' orbitals have one name, else numbered by kind (1σ, 2σ*, 1π…) from the bottom. */
  const named = sa.label === sb.label && (!pa || !pb || pa.label === pb.label);
  if (pa && pb) {
    const s = (sa.e + sb.e) / 2, p = (pa.e + pb.e) / 2, g = p - s, fs = both(sa.label, sb.label), fp = both(pa.label, pb.label);
    const twoP = mix
      ? [lv('middle', 'π', r(p - 0.32 * g), 2, 0, fp), lv('middle', 'σ', r(p - 0.15 * g), 1, 0, fp)]
      : [lv('middle', 'σ', r(p - 0.38 * g), 1, 0, fp), lv('middle', 'π', r(p - 0.2 * g), 2, 0, fp)];
    mid.push(lv('middle', 'σ', r(s - 0.22 * g), 1, 0, fs), lv('middle', 'σ*', r(s + 0.18 * g), 1, 0, fs), ...twoP,
      lv('middle', 'π*', r(p + 0.22 * g), 2, 0, fp), lv('middle', 'σ*', r(p + 0.45 * g), 1, 0, fp));
  } else if (!pa && !pb) {
    const s = (sa.e + sb.e) / 2, d = Math.max(1.5, Math.abs(s) * 0.3), fs = both(sa.label, sb.label);
    mid.push(lv('middle', 'σ', r(Math.min(sa.e, sb.e) - d), 1, 0, fs), lv('middle', 'σ*', r(Math.max(sa.e, sb.e) + 1.2 * d), 1, 0, fs));
  } else {
    // one atom has only its s orbital: it mixes with the other's p (end on); the rest of the other atom stays as it was
    const one = pa ? sb : sa, other = pa ? A : B, side = pa ? 'left' : 'right';
    const os = sOf(other)!, op = pOf(other)!;
    const pair = pa ? `${op.label}, ${one.label}` : `${one.label}, ${op.label}`;
    const d = Math.max(1.5, Math.abs(one.e - op.e) * 0.35);
    mid.push(lv('middle', 'σ', os.e, 1, 0, os.label, side), lv('middle', 'σ', r(Math.min(one.e, op.e) - d), 1, 0, pair),
      lv('middle', 'π', op.e, 2, 0, op.label, side), lv('middle', 'σ*', r(Math.max(one.e, op.e) + 1.6 * d), 1, 0, pair));
  }
  // the names, lowest first
  const count: Record<string, number> = {};
  for (const l of [...mid].sort((x, y) => x.e - y.e)) {
    const star = l.label.endsWith('*'), sym = l.label[0];
    const ao = (l.from ?? '').split(',')[0].trim();
    if (named && !l.fromSide && pa && pb) l.label = `${sym}${star ? '^{*}' : ''}_{${ao}}`;
    else if (named && !pa && !pb) l.label = `${sym}${star ? '^{*}' : ''}_{${ao}}`;
    else { count[sym] = (count[sym] ?? 0) + 1; l.label = `${count[sym]}${sym}${star ? '^{*}' : ''}`; }
  }
  const sides = [...atomLevels(A, 'left'), ...atomLevels(B, 'right')];
  const own = sides.reduce((t, l) => t + l.electrons, 0);
  const room = mid.reduce((t, l) => t + 2 * l.n, 0);
  const total = Math.max(0, Math.min(room, Math.round(electrons ?? own)));
  const levels = aufbau([...sides, ...mid].map((l) => ({ ...l, auto: true })), total);
  return toRelative({ titles: [A.symbol, title, B.symbol], axis: true, rich: true, levels, atoms: { left: a, right: b, electrons: total, mixing: mix } });
}

/** What a diagram adds up to: electrons and orbitals on the atoms and in the molecule, the bond order and the unpaired electrons in the molecule. */
export interface MoCounts { atomElectrons: number; moElectrons: number; atomOrbitals: number; moOrbitals: number; bondOrder: number; unpaired: number }

/**
 * Bond order = (electrons in bonding orbitals − electrons in antibonding ones) / 2. A molecular
 * orbital made from one side only (or joined to nothing) is nonbonding; otherwise mixOf says
 * which it is (a * in its name: antibonding).
 */
export function moCounts(levels: MoLevel[]): MoCounts {
  const out: MoCounts = { atomElectrons: 0, moElectrons: 0, atomOrbitals: 0, moOrbitals: 0, bondOrder: 0, unpaired: 0 };
  let net = 0;
  for (const l of levels) {
    const fill = hund(l.n, l.electrons), e = fill.reduce((t, x) => t + x, 0);
    if (l.column !== 'middle') { out.atomElectrons += e; out.atomOrbitals += fill.length; continue; }
    out.moElectrons += e;
    out.moOrbitals += fill.length;
    out.unpaired += fill.filter((x) => x === 1).length;
    const mix = l.fromSide ? null : mixOf(levels, l);
    if (mix && mix.left && mix.right) net += mix.bonding ? e : -e;
  }
  out.bondOrder = net / 2;
  return out;
}

/** One more electron in a level, as a click on it gives: back to none once it is full. */
export const nextElectrons = (l: Pick<MoLevel, 'n' | 'electrons'>): number => (l.electrons >= 2 * hund(l.n, 0).length ? 0 : l.electrons + 1);

/**
 * Where the molecule's electrons break the aufbau principle: each pair of molecular orbitals
 * where the higher one holds electrons while the lower one has room, lowest first. (Within a
 * level the electrons are always drawn by Hund's rule, and no orbital can hold more than two.)
 * Empty: the ground state for that many electrons. Levels at one energy do not count against each other.
 */
export function fillProblems(levels: MoLevel[]): { empty: MoLevel; filled: MoLevel }[] {
  const mos = levels.filter((l) => l.column === 'middle' && Number.isFinite(l.e)).sort((a, b) => a.e - b.e);
  const out: { empty: MoLevel; filled: MoLevel }[] = [];
  for (const low of mos) {
    if (low.electrons >= 2 * hund(low.n, 0).length) continue;
    const high = mos.find((h) => h.e > low.e && h.electrons > 0);
    if (high) out.push({ empty: low, filled: high });
  }
  return out;
}

/** Electrons in each of a level's n orbitals, by Hund's rule: one in each first, then pairs. */
export function hund(n: number, electrons: number): number[] {
  const k = Math.max(1, Math.min(5, Math.round(n)));
  const e = Math.max(0, Math.min(2 * k, Math.round(electrons)));
  return Array.from({ length: k }, (_, i) => (e >= k + i + 1 ? 2 : e > i ? 1 : 0));
}

/** The atomic orbitals a molecular orbital is joined to: the levels named in its `from`, on both sides (or one, with `fromSide`). */
export function sources(levels: MoLevel[], mo: MoLevel): MoLevel[] {
  const names = (mo.from ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const plain = new Set(names.map(moPlain));
  return levels.filter((l) => l.column !== 'middle' && (!mo.fromSide || l.column === mo.fromSide) && (names.includes(l.label.trim()) || plain.has(moPlain(l.label))));
}

/** The shapes an atomic orbital can be drawn as. */
export type MoAo = 's' | 'p' | 'sp' | 'sp2' | 'sp3';

/** What an atomic orbital is, from its name: an sp, sp² or sp³ hybrid, a p orbital (a "p" in its name), or else s-like. */
export function aoKind(label: string): MoAo {
  const t = moPlain(label).toLowerCase();
  if (/sp(3|³)/.test(t)) return 'sp3';
  if (/sp(2|²)/.test(t)) return 'sp2';
  if (/sp(?![0-9²³])/.test(t)) return 'sp';
  return /p/.test(t) ? 'p' : 's';
}

/** What a molecular orbital's picture shows: its left and right atomic orbitals, end on (σ) or side by side (π), in phase or out of phase. */
export interface MoMix { left: MoAo | null; right: MoAo | null; sym: 'σ' | 'π'; bonding: boolean }

/**
 * How a molecular orbital is made, read from its name and the atomic orbitals it comes from: π
 * if its name has π (and they are p orbitals), out of phase if it has a * (or, with neither σ nor
 * π in the name, if it lies above the orbitals it comes from). A nonbonding orbital made from one
 * side's orbitals shows that orbital alone.
 */
export function mixOf(levels: MoLevel[], mo: MoLevel): MoMix | null {
  const from = sources(levels, mo);
  if (!from.length) return null;
  const name = moPlain(mo.label);
  const l = from.find((x) => x.column === 'left'), r = from.find((x) => x.column === 'right');
  const left = l ? aoKind(l.label) : null, right = r ? aoKind(r.label) : null;
  const sym = name.includes('π') && left !== 's' && right !== 's' && (left === 'p' || right === 'p') ? 'π' : 'σ';
  const mean = from.reduce((t, x) => t + x.e, 0) / from.length;
  const bonding = name.includes('*') ? false : /[σπ]/.test(name) ? true : mo.e <= mean;
  return { left, right, sym, bonding };
}

type Piece = Omit<Shape, 'id'>;
const untag = (s: Piece): Piece => { const { orb: _o, ...rest } = s; return rest; };

/** How far an orbital reaches along the bond from its centre: towards the other atom (its big lobe) and away. */
const reach = (k: MoAo, u: number): { front: number; back: number; half: number } => {
  const back = { s: 0.42, p: 1, sp: 0.42, sp2: 0.36, sp3: 0.3 }[k];
  return { front: k === 's' ? 0.42 * u : u, back: back * u, half: k === 's' ? 0.42 * u : 0.31 * u };
};

/** One orbital centred at `c`, its big (shaded) lobe pointing `angle` degrees clockwise from up; `flip` swaps the phases. */
const orbital = (k: MoAo, c: Vec, u: number, look: OrbitalLook, angle: number, flip = false): Piece[] =>
  orbitalShapes({ kind: k, look, angle, size: u, ...(flip ? { flip } : {}) } as OrbitalSpec, c).map(untag);

/** An atomic orbital's picture: an s sphere, or a p orbital or hybrid pointing along the bond towards the other atom. */
function aoPicture(k: MoAo, side: 'left' | 'right', u: number, look: OrbitalLook): { w: number; h: number; draw(at: Vec): Piece[] } {
  const r = reach(k, u), towards = side === 'left' ? 90 : 270;
  const w = (r.front + r.back) / 2, shift = (r.front - r.back) / 2;
  return { w, h: r.half, draw: (at) => orbital(k, { x: at.x + (side === 'left' ? -shift : shift), y: at.y }, u, look, towards) };
}

/** A molecular orbital's picture: its two atomic orbitals meeting in the middle, in phase or out of phase (or one, for a nonbonding orbital). */
function moPicture(mix: MoMix, u: number, look: OrbitalLook): { w: number; h: number; draw(at: Vec): Piece[] } {
  const { left, right } = mix;
  if (!left || !right) {
    const k = (left ?? right)!;
    return { w: k === 's' ? 0.42 * u : u, h: reach(k, u).half, draw: (at) => orbital(k, at, u, look, k === 's' ? 0 : 90) };
  }
  if (left === 's' && right === 's' && mix.bonding) {
    // the two spheres run together into one
    const rx = u * 0.8, ry = u * 0.42;
    return { w: rx, h: ry, draw: (at) => [{ ...orbital('s', at, u, look, 0)[0], x1: at.x - rx, y1: at.y - ry, x2: at.x + rx, y2: at.y + ry }] };
  }
  if (mix.sym === 'π') {
    // side by side: the shaded lobes both up when in phase
    const d = u * 0.36;
    return { w: d + 0.31 * u, h: u, draw: (at) => [...orbital('p', { x: at.x - d, y: at.y }, u, look, 0), ...orbital('p', { x: at.x + d, y: at.y }, u, look, mix.bonding ? 0 : 180)] };
  }
  // end on: the big lobes meet in the middle, the same phase when in phase
  const a = reach(left, u), b = reach(right, u);
  const sep = mix.bonding ? 0.9 : 1.05;
  const lc = -a.front * sep, rc = b.front * sep;
  const x1 = lc - a.back, x2 = rc + b.back, mid = (x1 + x2) / 2;
  return {
    w: (x2 - x1) / 2, h: Math.max(a.half, b.half),
    draw: (at) => [...orbital(left, { x: at.x + lc - mid, y: at.y }, u, look, 90), ...orbital(right, { x: at.x + rc - mid, y: at.y }, u, look, 270, !mix.bonding)],
  };
}

/** A color faded towards white by `t` (0 none, 1 white): how see-through looks on the page. */
function fade(color: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  const k = Math.max(0, Math.min(1, t));
  if (!m || !k) return color;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** Where the line from p to q runs through the box, as parts of its length [t0, t1] (null: it misses it). */
function through(p: Vec, q: Vec, b: Rect): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (const [pp, qq] of [[-dx, p.x - b.x1], [dx, b.x2 - p.x], [-dy, p.y - b.y1], [dy, b.y2 - p.y]] as const) {
    if (pp === 0) { if (qq < 0) return null; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return t0 < t1 ? [t0, t1] : null;
}

/** The pieces of the line from p to q outside every box. */
function outside(p: Vec, q: Vec, boxes: Rect[]): [Vec, Vec][] {
  const cuts = boxes.map((b) => through(p, q, b)).filter((x): x is [number, number] => !!x).sort((a, b) => a[0] - b[0]);
  const at = (t: number): Vec => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const out: [Vec, Vec][] = [];
  let from = 0;
  for (const [a, b] of cuts) { if (a > from + 1e-3) out.push([at(from), at(a)]); from = Math.max(from, b); }
  if (from < 1 - 1e-3) out.push([at(from), at(1)]);
  return out;
}

/**
 * The narrowest clearance between anything in the molecule's column and either atom's levels, in
 * points: the straight-line gap between their boxes, so a level far above or below a name doesn't
 * count as crowding it. Negative when they overlap.
 */
export function roomBeside(mid: Rect[], left: Rect[], right: Rect[]): number | undefined {
  if (!mid.length || (!left.length && !right.length)) return undefined;
  const clear = (a: Rect, b: Rect): number => {
    // a is left of b
    const dx = b.x1 - a.x2, dy = Math.max(a.y1 - b.y2, b.y1 - a.y2);
    return dy > 0 ? Math.hypot(Math.max(0, dx), dy) : dx;
  };
  let r = Infinity;
  for (const m of mid) {
    for (const s of left) r = Math.min(r, clear(s, m));
    for (const s of right) r = Math.min(r, clear(m, s));
  }
  return r;
}

/**
 * The width that leaves `room` points between the molecule's column and the atoms' levels, for a
 * diagram `h` high: `roomAt(w)` draws it at width w and says how much room there is.
 */
export function fitWidth(roomAt: (w: number) => number | undefined, w0: number, room: number): number {
  let w = Math.max(40, w0), r = roomAt(w);
  if (r === undefined) return w;
  for (let i = 0; i < 16 && Math.abs(r - room) > 0.25; i++) {
    // the room grows about a quarter to a third as fast as the width, so stepping by four times the shortfall settles in a few steps
    const next = Math.max(40, Math.min(5000, w + (room - r) * 4));
    const rn = roomAt(next);
    if (rn === undefined) break;
    w = next;
    r = rn;
  }
  return Math.round(w);
}

/** The electrons' height, line width and gap above the line in a diagram w × h. */
export interface ElectronLook { tall: number; thick: number; lift: number }

/**
 * The electrons as drawn in a diagram w × h: as set, grown or shrunk with the diagram since; or
 * the defaults (the caption size high, 1.5 line widths thick, 3.5 line widths up at 14 × 12 bond
 * lengths), which grow and shrink with it the same way.
 */
export function electronLook(spec: MoSpec, style: { captionSize: number; lineWidth: number; bondLength: number }, w: number, h: number): ElectronLook {
  const now = Math.sqrt(Math.max(1, w * h));
  const set = spec.arrowAt && spec.arrowAt > 0 ? now / spec.arrowAt : 1;
  const dflt = now / (Math.sqrt(14 * 12) * style.bondLength);
  const lw = style.lineWidth;
  return {
    tall: spec.arrowSize && spec.arrowSize > 0 ? spec.arrowSize * set : style.captionSize * dflt,
    thick: spec.arrowWidth && spec.arrowWidth > 0 ? spec.arrowWidth * set : 1.5 * lw * dflt,
    lift: spec.arrowGap !== undefined && spec.arrowGap >= 0 ? spec.arrowGap * set : 3.5 * lw * dflt,
  };
}

/** The electron settings fixed at what they now draw as, with one changed (the window or the Style panel set it). */
export function setElectrons(spec: MoSpec, now: ElectronLook, w: number, h: number): MoSpec {
  return { ...spec, arrowSize: now.tall, arrowWidth: now.thick, arrowGap: now.lift, arrowAt: Math.sqrt(Math.max(1, w * h)) };
}

export interface MoParts {
  captions: number[]; arrows: number[]; shapes: number[];
  /** The narrowest room between the molecule's column (its levels, names and pictures) and either atom's levels, in points. */
  room?: number;
}

/** Draw the diagram in the box w × h with its top left at `at`. Call inside an edit. */
export function drawMo(doc: Doc, m: Measure, spec: MoSpec, at: Vec, w: number, h: number): MoParts {
  const out: MoParts = { captions: [], arrows: [], shapes: [] };
  const lw = doc.style.lineWidth, L = doc.style.bondLength;
  const levels = spec.levels.filter((l) => Number.isFinite(l.e));
  if (!levels.length) return out;
  const hi = Math.max(...levels.map((l) => l.e)), lo = Math.min(...levels.map((l) => l.e));
  // relative: 0 is the bottom of the box and 1 the top; before that, the lowest and highest levels were
  const y = spec.relative ? (e: number) => at.y + (1 - place(e)) * h
    : (e: number) => (hi === lo ? at.y + h / 2 : at.y + ((hi - e) / (hi - lo)) * h);
  const pics = !!spec.pictures;
  const colX: Record<MoColumn, number> = pics
    ? { left: at.x + w * 0.24, middle: at.x + w * 0.5, right: at.x + w * 0.76 }
    : { left: at.x + w * 0.14, middle: at.x + w * 0.5, right: at.x + w * 0.86 };
  const one = Math.min(w * 0.09, 1.3 * L), gapX = one * 0.3;
  const gap = 0.25 * L;
  /** A level's ends (from the first orbital's left to the last one's right). */
  const span = (l: MoLevel): [number, number] => {
    const k = hund(l.n, 0).length, total = k * one + (k - 1) * gapX;
    return [colX[l.column] - total / 2, colX[l.column] + total / 2];
  };
  const caption = (text: string, target: Vec, anchor: 'above' | 'below' | 'left' | 'right', extra: Partial<Caption> = {}): Rect => {
    const c = doc.addCaption({ x: 0, y: 0, runs: moParts(spec, text), justify: 'left', chem: false, ...extra });
    const b = m.captionBox(c);
    const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    const want = anchor === 'above' ? { x: target.x - bw / 2, y: target.y - bh } : anchor === 'below' ? { x: target.x - bw / 2, y: target.y }
      : anchor === 'left' ? { x: target.x - bw, y: target.y - bh / 2 } : { x: target.x, y: target.y - bh / 2 };
    doc.updateCaption(c.id, { x: want.x - b.x1, y: want.y - b.y1 });
    out.captions.push(c.id);
    return m.captionBox(doc.captions.get(c.id)!);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, more: Partial<Shape> = {}) =>
    out.shapes.push(doc.addShape({ kind: 'line', x1, y1, x2, y2, color: '#000000', ...more }).id);

  // the dashed correlation lines first, so the levels sit on top of them; see-through is drawn as
  // the color faded towards the white page, which reads the same and saves to every format
  const dashColor = fade(spec.lineColor ?? '#000000', spec.lineTransparency ?? 0);
  const dashes: [Vec, Vec][] = [];
  /** Which side of a molecular orbital its name goes: away from its atomic orbitals when they are all on the right (a nonbonding orbital). */
  const nameLeft = new Set<MoLevel>();
  for (const mo of levels.filter((l) => l.column === 'middle')) {
    const [m1, m2] = span(mo);
    const from = sources(levels, mo);
    if (from.length && from.every((ao) => ao.column === 'right')) nameLeft.add(mo);
    for (const ao of from) {
      const [a1, a2] = span(ao);
      dashes.push(ao.column === 'left' ? [{ x: a2, y: y(ao.e) }, { x: m1, y: y(mo.e) }] : [{ x: a1, y: y(ao.e) }, { x: m2, y: y(mo.e) }]);
    }
  }
  // the levels' lines go on top of the dashed lines (drawn after the names, so they can stop at a name's frame)
  const levelLines: Shape['id'][] = [];
  const { tall, thick, lift } = electronLook(spec, doc.style, w, h);
  /** An electron: an arrow `tall` high, starting `lift` above the level line, up or down. */
  const electron = (x: number, yy: number, up: boolean) => {
    const lo = { x, y: yy - lift }, hi = { x, y: yy - lift - tall };
    out.arrows.push(doc.addArrow({
      tail: up ? lo : hi, head: up ? hi : lo, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid',
      noGo: false, equilibrium: false, sweep: 0, headLength: Math.max(tall * 0.32, thick * 3), headWidth: Math.max(tall * 0.12, thick * 1.4),
      lineWidth: thick,
    }).id);
  };
  /** Where each label ended up, for the pictures beside them. */
  const labelBox = new Map<MoLevel, Rect>();
  const pad = 0.08 * L;
  for (const l of levels) {
    const [x0] = span(l), yy = y(l.e);
    const fill = hund(l.n, l.electrons);
    const apart = Math.max(tall * 0.2, thick * 2.5);
    fill.forEach((e, i) => {
      const xa = x0 + i * (one + gapX);
      levelLines.push(doc.addShape({ kind: 'line', x1: xa, y1: yy, x2: xa + one, y2: yy, color: '#000000', bold: true }).id);
      // ↑ and ↓ over the line: one electron sits in the middle, a pair side by side
      const cx = xa + one / 2;
      if (e === 1) electron(cx, yy, true);
      if (e === 2) { electron(cx - apart, yy, true); electron(cx + apart, yy, false); }
    });
    const [, x1] = span(l);
    if (!l.label.trim()) continue;
    const left = l.column === 'left' || nameLeft.has(l);
    let box = left ? caption(l.label.trim(), { x: x0 - gap, y: yy }, 'left') : caption(l.label.trim(), { x: x1 + gap, y: yy }, 'right');
    if (spec.labelClear && l.column === 'middle') {
      // move the name outwards, a little at a time, until no dashed line runs through it
      const id = out.captions[out.captions.length - 1];
      const way = left ? -1 : 1;
      let dx = 0;
      const grow = (b: Rect, d: number): Rect => ({ x1: b.x1 + way * d - pad, y1: b.y1 - pad, x2: b.x2 + way * d + pad, y2: b.y2 + pad });
      while (dx < 3 * L && dashes.some(([p, q]) => through(p, q, grow(box, dx)))) dx += 0.1 * L;
      if (dx >= 3 * L) dx = 0;
      if (dx) { const c = doc.captions.get(id)!; doc.updateCaption(id, { x: c.x + way * dx }); box = m.captionBox(doc.captions.get(id)!); }
    }
    labelBox.set(l, box);
  }
  // the dashed lines, stopping at the names' frames when they have them
  const frames = spec.labelBack ? [...labelBox.values()].map((b) => ({ x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad })) : [];
  for (const [p, q] of dashes) for (const [a, b] of outside(p, q, frames)) line(a.x, a.y, b.x, b.y, { dashed: true, lineWidth: lw * 0.7, color: dashColor });
  out.shapes.push(...levelLines);
  let leftmost = Infinity;
  // what the molecule's column takes up (its levels, names and pictures), for the room left beside it
  const mid: Rect[] = [];
  const levelBox = (l: MoLevel): Rect => { const [s0, s1] = span(l), yy = y(l.e); return { x1: s0, y1: yy - L * 0.6, x2: s1, y2: yy + lw }; };
  for (const l of levels.filter((x) => x.column === 'middle')) {
    mid.push(levelBox(l));
    const b = labelBox.get(l);
    if (b) mid.push(b);
  }
  if (pics) drawPictures();
  out.room = roomBeside(mid, levels.filter((x) => x.column === 'left').map(levelBox), levels.filter((x) => x.column === 'right').map(levelBox));
  const bottom = at.y + h + 1.2 * L;
  (['left', 'middle', 'right'] as const).forEach((c, i) => { if (spec.titles[i]?.trim()) caption(spec.titles[i].trim(), { x: colX[c], y: bottom }, 'below'); });
  if (spec.axis) {
    // left of everything (the left atom's pictures can reach past the box)
    const ax = Math.min(at.x, leftmost) - 0.4 * L;
    out.arrows.push(doc.addArrow({
      tail: { x: ax, y: at.y + h + 0.6 * L }, head: { x: ax, y: at.y - 0.8 * L }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid',
      noGo: false, equilibrium: false, sweep: 0, headLength: lw * 8, headWidth: lw * 2.2,
    }).id);
    caption('E', { x: ax - gap, y: at.y - 0.4 * L }, 'left', { runs: [{ text: 'E', italic: true }] });
  }
  return out;

  /**
   * Each atomic orbital's picture outside its name, and each molecular orbital's beside its name,
   * moved apart up and down where two would overlap.
   */
  function drawPictures(): void {
    const look = spec.pictureLook ?? 'shaded';
    // the usual size at 14 × 12 bond lengths, growing and shrinking with the diagram
    const u = 0.42 * Math.sqrt(Math.max(1, w * h) / (14 * 12)) * Math.max(0.2, Math.min(4, spec.pictureSize ?? 1));
    const put = (pieces: Piece[]) => { for (const p of pieces) out.shapes.push(doc.addShape(p).id); };
    const side = (col: 'left' | 'right') => {
      // atomic orbitals: one picture per name, outside it (the degenerate p orbitals share one)
      for (const l of levels.filter((x) => x.column === col)) {
        const pic = aoPicture(aoKind(l.label), col, u, look);
        const b = labelBox.get(l), [s0, s1] = span(l);
        const x = col === 'left' ? (b ? b.x1 : s0) - gap - pic.w : (b ? b.x2 : s1) + gap + pic.w;
        leftmost = Math.min(leftmost, x - pic.w);
        put(pic.draw({ x, y: y(l.e) }));
      }
    };
    side('left');
    side('right');
    // molecular orbitals: beside their names, highest first, pushed down where they would overlap
    const mos = levels.filter((l) => l.column === 'middle').map((l) => ({ l, mix: mixOf(levels, l) })).filter((x): x is { l: MoLevel; mix: MoMix } => !!x.mix)
      .sort((a, b) => b.l.e - a.l.e);
    let floor = -Infinity;
    for (const { l, mix } of mos) {
      const pic = moPicture(mix, u, look), b = labelBox.get(l), [s0, s1] = span(l);
      const cy = Math.max(y(l.e), floor + pic.h + lw * 2);
      floor = cy + pic.h;
      const x = nameLeft.has(l) ? (b ? b.x1 : s0) - gap - pic.w : (b ? b.x2 : s1) + gap + pic.w;
      mid.push({ x1: x - pic.w, y1: cy - pic.h, x2: x + pic.w, y2: cy + pic.h });
      put(pic.draw({ x, y: cy }));
    }
  }
}
