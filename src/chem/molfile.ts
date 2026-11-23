// Turning drawn structures into MDL molfiles for the chemistry engine (RDKit), and reading
// molfiles back (for pasted SMILES). Abbreviation labels are expanded into real atoms so
// formula, mass and stereo come out right; "R"-type labels become dummy atoms.

import { attachCode } from './attach-codes';
import { Doc, isMetalAtom, outsideValence, radicalElectrons, type EnhancedStereo, type Shape } from '../model';
import { metalCarbonyl } from './hapto';
import { SYMBOLS, elementNumber, hasImplicitH, implicitHydrogens, isMetal, maxValence, valenceOfBonds } from './elements';
import { CARBONYL_LIGAND, isCarbonylLabel, kekulize, labelDonates, labelGraph, MiniGraph } from './labels';
import { stereoAnchor, stereoSense } from './stereo';
import { aromaticAsSingle, kekuleDoubles } from './aromatic';
import { flatStandIn } from './ring-views';
import { readSpecies } from './species';
import { chiralPrefs, flagsByAtom, type ChiralFlag } from './chiral-flag';
import { cleanUp } from './cleanup';
import { molProgramLine } from './molfile-header';
import { labelHydrogens, ruleHydrogens } from './hydrogen-count';

export { molProgramLine };

export interface MolExport {
  molblock: string;
  /** Molfile atom index (0-based) → drawn atom id, or −1 for atoms expanded from a label. */
  map: number[];
  /** Labels that could not be interpreted (shown as warnings). */
  unknownLabels: string[];
  /** Molfile atoms that belong to multi-atom labels (positions made up, so no stereo label for them). */
  inLabel: number[];
  /**
   * Molfile atoms that stand for undefined groups (R, Ar, labels that can't be read), each with
   * the label it comes from: groups with the same label are taken to be the same group.
   */
  generic: [number, string][];
  /** Abbreviations written out as atoms, as superatom S-groups (only with `files`). */
  sgroups: MSgroup[];
  /** Why a V2000 molfile was asked for but V3000 written (only with `files`). */
  v3000Because?: string;
}

export interface MolfileOptions {
  /** Each structure's chiral flag, worked out once for a file of many records (chiral-flag.ts flagOwners; review F1c-R12). */
  flagOwners?: Map<number, Shape>;
  /**
   * For working out R/S and E/Z: R groups, attachment points and labels that can't be read
   * become a very heavy stand-in atom (see stereoTags for how it is ranked), and
   * positions are measured from the first atom so a structure that only moved gives the same
   * molfile.
   */
  stereo?: boolean;
  /**
   * Text boxes read as chemistry (BF4−, DMAP) counted with the atoms: each one's molecules
   * placed round its point, as separate molecules (map −1).
   */
  species?: { graph: MiniGraph; x: number; y: number }[];
  /** Write atom-atom map numbers (Atom.mapNo) in the mmm column, for mapped reaction SMILES and RXN files. */
  maps?: boolean;
  /**
   * Keep a label that can't be read as chemistry (Xyz, Ar′) as the atom's alias (an A line, or
   * the atom's type in V3000), as other programs show it; for files, not for the chemistry engine.
   */
  aliases?: boolean;
  /** Write a V3000 molfile (otherwise V2000). */
  v3000?: boolean;
  /** Write each attachment point's kind as its "*" atom's isotope (src/chem/attach-codes.ts), for Hammett's reference position. */
  attachKinds?: boolean;
  /**
   * For a file other programs open (Save As MOL, SDF, RXN, MRV, KET, CML): the structure as drawn,
   * not as the chemistry engine needs it. Labels that can't be read are kept as aliases; R1, R2 are
   * R# atoms with their numbers; an abbreviation's atoms are laid out at bond length away from the
   * rest and marked as a superatom S-group (so other programs show OMe, Boc as drawn); dative bonds
   * are coordination bonds (type 9) and hydrogen bonds type 10; bonds to metals are written as drawn
   * (no charges or dative bonds added for the engine); enhanced stereo and the chiral flag are
   * written. V2000 has no coordination or hydrogen bonds and no and/or stereo groups: a drawing with
   * them is written as V3000, and `v3000Because` says why.
   */
  files?: boolean;
}

/** Stands in for R groups when working out R/S: oganesson, heavier than any atom in a real drawing. */
const GENERIC_STAND_IN = 'Og';

/** A molfile atom: an element symbol (or R#, *, or a label kept as an alias), position in bond lengths. */
export interface MAtom {
  sym: string; x: number; y: number; charge: number; iso: number; rad?: number; map?: number; alias?: string;
  /**
   * The atom's whole valence, its bonds and hydrogens together, when its hydrogens are fixed as
   * written rather than worked out (N on its own is N, not NH3): V2000's vvv, V3000's VAL. 0 is
   * no valence at all (no bonds, no hydrogens).
   */
  val?: number;
  /** The R-group number of an R# atom (R1 → 1): V2000's M  RGP, V3000's RGROUPS. */
  rg?: number;
  /** Enhanced stereo of a stereocentre (V3000 collections only). */
  enh?: EnhancedStereo;
}
/**
 * A molfile bond between atoms counted from 0, with V2000's bond type and stereo numbers (1 up, 6
 * down, 4 either, 3 cis or trans). Types 9 (coordination, from the donor) and 10 (hydrogen bond)
 * exist only in V3000.
 */
export interface MBond { a: number; b: number; order: number; stereo: number }

/** A superatom (abbreviation) S-group: its atoms (counted from 0, the first the one bonded to the rest) and its label. */
export interface MSgroup { atoms: number[]; label: string }

/** What a connection table holds besides atoms and bonds. */
export interface CtabExtra {
  /** Abbreviations written out as atoms: superatom S-groups (V2000 M  STY/SAL/SBL/SMT, V3000 SGROUP SUP). */
  sgroups?: MSgroup[];
  /** The chiral flag: the wedges show the absolute configuration (1), not only the relative one (0). */
  chiral?: boolean;
}

/** Why a connection table can't be written as V2000 (null when it can): V2000 has no coordination or hydrogen bonds and no enhanced stereo. */
export function needsV3000(atoms: MAtom[], bonds: MBond[]): string | null {
  const why: string[] = [];
  if (bonds.some((b) => b.order === 9)) why.push('coordination (dative) bonds');
  if (bonds.some((b) => b.order === 10)) why.push('hydrogen bonds');
  if (atoms.some((a) => a.enh && a.enh.type !== 'abs')) why.push('and/or stereo groups');
  return why.length ? why.join(' and ') : null;
}

/** The bonds (counted from 0) that join an S-group's atoms to the rest. */
function crossingBonds(g: MSgroup, bonds: MBond[]): number[] {
  const inG = new Set(g.atoms);
  return bonds.flatMap((b, i) => (inG.has(b.a) !== inG.has(b.b) ? [i] : []));
}

/**
 * A superatom group's attachment points (CTfile Formats 2020: V2000 "M  SAP", V3000 "SAP="): for each
 * bond that leaves the group, the group's atom on it, no leaving atom (0: nothing is removed when the
 * group is expanded or contracted), and an id counting from 1. Some programs need these to show the
 * group contracted (review F1-R14).
 */
export function attachPoints(g: MSgroup, bonds: MBond[]): { atom: number; id: string }[] {
  const inG = new Set(g.atoms);
  return crossingBonds(g, bonds).map((k, j) => ({ atom: inG.has(bonds[k].a) ? bonds[k].a : bonds[k].b, id: String(j + 1) }));
}

/**
 * The connection table of a V3000 molfile ("M  V30 BEGIN CTAB" … "M  V30 END CTAB"), from BIOVIA's
 * CTfile Formats (2020), V3000 section: atoms with CHG=, MASS=, RAD=, VAL=, RGROUPS= and their map
 * number; bonds with CFG= (1 up, 2 either, 3 down) and types 9 (coordination) and 10 (hydrogen);
 * superatom S-groups (SUP with ATOMS=, XBONDS=, LABEL= and SAP=); enhanced stereo as the collections
 * MDLV30/STEABS, MDLV30/STERACn (and) and MDLV30/STERELn (or); the chiral flag in COUNTS. A label
 * kept as an alias is a "*" atom in a one-atom SUP group with the label (quoted when it has spaces). Lines longer than 80 characters
 * go on to the next with "-".
 */
export function v3000Ctab(atoms: MAtom[], bonds: MBond[], extra: CtabExtra = {}): string[] {
  const n = (v: number) => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4);
  // (a value with a space, quote, bracket or "=", or one ending in "-" (Cl-, AcO-), which would read
  // as going on to the next line, goes in double quotes, a quote in it doubled; review F1c-R01)
  const q = (t: string) => (/[\s"()=]|-$/.test(t) || t === '' ? `"${t.replace(/"/g, '""')}"` : t);
  // a label kept as an alias is a "*" atom with a one-atom superatom group holding the label (so no
  // program reads Ar, aryl, as argon; review F1-R06)
  const type = (a: MAtom) => q(a.alias ? '*' : a.sym);
  const sgroups = [...(extra.sgroups ?? []).filter((g) => g.atoms.length && g.label),
    ...atoms.flatMap((a, i) => (a.alias ? [{ atoms: [i], label: a.alias }] : []))];
  const out = ['BEGIN CTAB', `COUNTS ${atoms.length} ${bonds.length} ${sgroups.length} 0 ${extra.chiral ? 1 : 0}`, 'BEGIN ATOM'];
  atoms.forEach((a, i) => out.push([i + 1, type(a), n(a.x), n(a.y), n(0), a.map ?? 0,
    ...(a.charge ? [`CHG=${a.charge}`] : []), ...(a.rad ? [`RAD=${a.rad}`] : []), ...(a.val !== undefined ? [`VAL=${a.val || -1}`] : []), ...(a.iso ? [`MASS=${a.iso}`] : []),
    ...(a.rg ? [`RGROUPS=(1 ${a.rg})`] : [])].join(' ')));
  out.push('END ATOM');
  if (bonds.length) {
    out.push('BEGIN BOND');
    bonds.forEach((b, i) => out.push([i + 1, b.order, b.a + 1, b.b + 1, ...(b.stereo === 1 ? ['CFG=1'] : b.stereo === 6 ? ['CFG=3'] : b.stereo === 4 || b.stereo === 3 ? ['CFG=2'] : [])].join(' ')));
    out.push('END BOND');
  }
  if (sgroups.length) {
    out.push('BEGIN SGROUP');
    sgroups.forEach((g, i) => {
      const x = crossingBonds(g, bonds);
      const sap = attachPoints(g, bonds).map((p) => ` SAP=(3 ${p.atom + 1} 0 ${p.id})`).join('');
      out.push(`${i + 1} SUP 0 ATOMS=(${g.atoms.length} ${g.atoms.map((k) => k + 1).join(' ')})${x.length ? ` XBONDS=(${x.length} ${x.map((k) => k + 1).join(' ')})` : ''} LABEL=${q(g.label)}${sap}`);
    });
    out.push('END SGROUP');
  }
  const coll: string[] = [];
  const list = (ids: number[]) => `ATOMS=(${ids.length} ${ids.map((k) => k + 1).join(' ')})`;
  const abs = atoms.flatMap((a, i) => (a.enh?.type === 'abs' ? [i] : []));
  if (abs.length) coll.push(`MDLV30/STEABS ${list(abs)}`);
  for (const [kind, tag] of [['and', 'STERAC'], ['or', 'STEREL']] as const) {
    const groups = [...new Set(atoms.flatMap((a) => (a.enh?.type === kind ? [a.enh.group ?? 1] : [])))].sort((p, r) => p - r);
    for (const g of groups) coll.push(`MDLV30/${tag}${g} ${list(atoms.flatMap((a, i) => (a.enh?.type === kind && (a.enh.group ?? 1) === g ? [i] : [])))}`);
  }
  if (coll.length) out.push('BEGIN COLLECTION', ...coll, 'END COLLECTION');
  out.push('END CTAB');
  return out.flatMap((t) => {
    const parts: string[] = [];
    let rest = t;
    while (rest.length > 72) { parts.push(`M  V30 ${rest.slice(0, 72)}-`); rest = rest.slice(72); }
    parts.push(`M  V30 ${rest}`);
    return parts;
  });
}

/** A whole V3000 molfile: three header lines, the counts line, the connection table and M  END. */
export function v3000Molfile(head: string[], atoms: MAtom[], bonds: MBond[], extra: CtabExtra = {}): string {
  return [...head, '  0  0  0     0  0            999 V3000', ...v3000Ctab(atoms, bonds, extra), 'M  END', ''].join('\n');
}

const f = (v: number, w: number, d = 4) => v.toFixed(d).padStart(w);
const i3 = (v: number) => String(v).padStart(3);

/**
 * A whole V2000 molfile, from BIOVIA's CTfile Formats (2020), V2000 section: the counts line (with
 * the chiral flag), the atom block (valence in vvv, map number in mmm), the bond block, A alias
 * lines, then the properties block: M  CHG, ISO, RAD, RGP (R-group numbers on R# atoms) and the
 * superatom S-groups (M  STY … SUP, SAL, SBL, SAP, SMT), and M  END. Coordination and hydrogen
 * bonds (types 9 and 10) and enhanced stereo are V3000 only; see needsV3000.
 */
export function v2000Molfile(head: string[], atoms: MAtom[], bonds: MBond[], extra: CtabExtra = {}): string {
  const lines: string[] = [...head];
  lines.push(`${i3(atoms.length)}${i3(bonds.length)}  0  0${i3(extra.chiral ? 1 : 0)}  0  0  0  0  0999 V2000`);
  for (const a of atoms) {
    // (after the symbol, the sixth number is the valence, 15 for none, and the tenth the atom-atom map number)
    const val = a.val === undefined ? 0 : a.val || 15;
    lines.push(`${f(a.x, 10)}${f(a.y, 10)}${f(0, 10)} ${a.sym.padEnd(3)} 0  0  0  0  0${i3(val)}  0  0  0${i3(a.map ?? 0)}  0  0`);
  }
  for (const b of bonds) lines.push(`${i3(b.a + 1)}${i3(b.b + 1)}${i3(b.order)}${i3(b.stereo)}`);
  atoms.forEach((a, i) => { if (a.alias) lines.push(`A  ${i3(i + 1)}`, a.alias); });
  const prop = (tag: string, vals: (readonly [number, number])[]) => {
    for (let k = 0; k < vals.length; k += 8) {
      const part = vals.slice(k, k + 8);
      lines.push(`M  ${tag}${i3(part.length)}` + part.map(([i, v]) => ` ${i3(i + 1)} ${i3(v)}`).join(''));
    }
  };
  prop('CHG', atoms.map((a, i) => [i, a.charge] as const).filter(([, c]) => c !== 0));
  prop('ISO', atoms.map((a, i) => [i, a.iso] as const).filter(([, m]) => m > 0));
  prop('RAD', atoms.map((a, i) => [i, a.rad ?? 0] as const).filter(([, r]) => r > 0));
  prop('RGP', atoms.map((a, i) => [i, a.rg ?? 0] as const).filter(([, r]) => r > 0));
  const sgroups = (extra.sgroups ?? []).filter((g) => g.atoms.length && g.label);
  for (let k = 0; k < sgroups.length; k += 8) {
    const part = sgroups.slice(k, k + 8);
    lines.push(`M  STY${i3(part.length)}` + part.map((_, j) => ` ${i3(k + j + 1)} SUP`).join(''));
  }
  sgroups.forEach((g, j) => {
    const s = i3(j + 1);
    const each = (tag: string, ids: number[]) => {
      for (let k = 0; k < ids.length; k += 15) {
        const part = ids.slice(k, k + 15);
        lines.push(`M  ${tag} ${s}${i3(part.length)}` + part.map((v) => ` ${i3(v + 1)}`).join(''));
      }
    };
    each('SAL', g.atoms);
    each('SBL', crossingBonds(g, bonds));
    const sap = attachPoints(g, bonds);
    // M  SAP sssnn6 iii ooo cc: up to six points a line (attachment atom, leaving atom, id)
    for (let k = 0; k < sap.length; k += 6) {
      const part = sap.slice(k, k + 6);
      lines.push(`M  SAP ${s}${i3(part.length)}` + part.map((p) => ` ${i3(p.atom + 1)} ${i3(0)} ${p.id.padEnd(2)}`).join(''));
    }
    lines.push(`M  SMT ${s} ${g.label}`);
  });
  lines.push('M  END');
  return lines.join('\n') + '\n';
}

/**
 * Whether a label is written to a file as a superatom group, so it comes back as the label: any
 * label of several atoms, and a one-atom label that is more than its atom's element with
 * hydrogens (Me, DCM's Cl… but not N, OH or NH2 on N, which read back as the element; review F1b-R02),
 * nor D or T.
 */
function asGroup(g: MiniGraph, label: string, z: number | undefined): boolean {
  // (D and T are hydrogen with its mass, which every format holds: never a group; review F1c-R02)
  if (g.atoms.length === 1 && (label === 'D' || label === 'T') && g.atoms[0].z === 1) return false;
  return g.atoms.length > 1 || (g.atoms.length === 1 && (z === undefined || labelHydrogens(label, z) === null || g.atoms[0].z !== z));
}

/**
 * The valence to write for a bonded atom labelled with its element and the hydrogens it shows (N,
 * NH, CH on a structure) when the valence rule would give it another number of hydrogens: its
 * bonds and those hydrogens. Undefined for any other label, for a count the rule already gives
 * or one above it, and beside a 1½ or partial bond, where the count depends on the ring.
 */
export function shownValence(doc: Doc, id: number, label: string, z: number, charge: number, dative: Set<number> = new Set()): number | undefined {
  const shown = labelHydrogens(label, z);
  if (shown === null || !hasImplicitH(z) || z === 1) return undefined;
  const orders = (doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => !outsideValence(b) && !dative.has(b.id)).map((b) => b.order);
  if (!orders.length || orders.some((o) => o !== 1 && o !== 2 && o !== 3)) return undefined;
  const own = orders.reduce((t, o) => t + o, 0);
  const a = doc.atoms.get(id);
  // (only fewer hydrogens than the rule: more, as on a neutral NH3 bonded to carbon, is a label
  // that can't be right, which the chemistry engine would turn down whole; it is left to the rule,
  // and Check Structure says so: review F8a-R05)
  if (shown >= ruleHydrogens(z, own, charge, a?.radical)) return undefined;
  return own + shown;
}

/** Group 13 elements (B, Al, Ga, In, Tl), which the chemistry engine gives no fourth bond as a dative one. */
const ATE = new Set([5, 13, 31, 49, 81]);

export function toMolfile(doc: Doc, atomIds: Iterable<number>, name = '', opts: MolfileOptions = {}): MolExport {
  // a ring's middle, where a metal is bonded (η⁵), is not an atom: it and its bonds are left out
  const ids = [...atomIds].filter((id) => doc.atoms.has(id) && !doc.atoms.get(id)!.multi);
  const inSet = new Set(ids);
  // rings drawn as chairs or boats show their stereo by their shape: the engine is shown them flat, with wedges
  const stand = flatStandIn(doc, inSet);
  const L = doc.style.bondLength || 14.4;
  const atoms: MAtom[] = [];
  const bonds: MBond[] = [];
  const map: number[] = [];
  const attach = new Map<number, number>();
  const unknown: string[] = [];
  const inLabel: number[] = [];
  const genericAt: [number, string][] = [];
  const first = opts.stereo && ids.length ? doc.atoms.get(ids[0])! : { x: 0, y: 0 };
  const generic = opts.stereo ? GENERIC_STAND_IN : '*';
  const files = !!opts.files;
  const aliases = opts.aliases || files;
  const sgroups: MSgroup[] = [];

  // Bonds to metals that are a lone pair or π-bond given to the metal (PPh3, a pyridine, the
  // second bond of a bridging Cl) go to the engine as dative bonds, which take no hydrogen off
  // the atom giving them; the rest (a methyl, a chloride) are ordinary bonds.
  const dative = new Set<number>();
  const toMetal = (id: number) => (doc.adj.get(id) ?? []).some((bid) => { const b = doc.bonds.get(bid)!; return isMetalAtom(doc.atoms.get(b.a1 === id ? b.a2 : b.a1)); });
  const metalBonds = (id: number) => (doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!)
    .filter((b) => !outsideValence(b) && isMetalAtom(doc.atoms.get(b.a1 === id ? b.a2 : b.a1)));
  // a carbonyl ligand, drawn M–C≡O, is M←C⁻≡O⁺ to the engine
  const charged = new Map<number, number>();
  // (a file shows the drawing as drawn: none of these charges and dative bonds for the engine)
  if (!files) for (const id of ids) {
    const c = metalCarbonyl(doc, doc.atoms.get(id)!);
    if (!c || !inSet.has(c.id)) continue;
    charged.set(id, 1);
    charged.set(c.id, -1);
    for (const b of metalBonds(c.id)) dative.add(b.id);
  }
  // an N-heterocyclic carbene (a carbon with two N, bonded to the metal) gives it its lone pair
  const carbene = new Set<number>();
  if (!files) for (const id of ids) {
    const a = doc.atoms.get(id)!;
    if (a.z !== 6 || a.label || a.charge || a.radical || isMetalAtom(a) || charged.has(id)) continue;
    const mb = metalBonds(id);
    if (mb.length !== 1) continue;
    const rest = (doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => b !== mb[0]);
    if (rest.length !== 2 || rest.some((b) => b.order !== 1 || doc.atoms.get(b.a1 === id ? b.a2 : b.a1)?.z !== 7)) continue;
    carbene.add(id);
    charged.set(id, 0);
    dative.add(mb[0].id);
  }
  // An odd π-system bonded through its middle (η⁵-Cp, η³-allyl) is an anion on a cation to the
  // engine: one of its carbons −1, the metal +1 (Cp⁻ Fe²⁺ Cp⁻ for ferrocene), so it reads as the
  // aromatic ring or allyl it is and the formula comes out right.
  const kekule = new Map<number, number>();
  const centres = new Set(ids.flatMap((id) => [...(doc.centresOf.get(id) ?? [])]));
  for (const id of centres) {
    const c = doc.atoms.get(id);
    if (!c?.multi || c.multi.length % 2 === 0 || !c.multi.every((m) => inSet.has(m))) continue;
    const metals = (doc.adj.get(id) ?? []).map((bid) => { const b = doc.bonds.get(bid)!; return b.a1 === id ? b.a2 : b.a1; }).filter((m) => inSet.has(m));
    if (!metals.length) continue;
    const members = new Set(c.multi);
    const inner = (m: number) => (doc.adj.get(m) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => members.has(b.a1 === m ? b.a2 : b.a1));
    const plain = (m: number) => inner(m).every((b) => b.order !== 2);
    const ends = c.multi.filter((m) => inner(m).length === 1);
    // the anion: the carbon with no double bond (an end of an allyl, the CH of a Kekulé Cp)
    const anion = (ends.length ? ends : c.multi).find(plain);
    const at = anion !== undefined ? doc.atoms.get(anion)! : null;
    if (!at || at.z !== 6 || at.label || at.charge || charged.has(anion!)) continue;
    charged.set(anion!, -1);
    charged.set(metals[0], (charged.get(metals[0]) ?? 0) + 1);
    // a ring's 1½ bonds written out round from the anion: single, double, single… (C5H5⁻)
    if (!ends.length && c.multi.every((m) => inner(m).every((b) => b.order === 1.5))) {
      let cur = anion!, prev = -1;
      for (let k = 0; k < members.size; k++) {
        const next = inner(cur).find((b) => (b.a1 === cur ? b.a2 : b.a1) !== prev && !kekule.has(b.id));
        if (!next) break;
        kekule.set(next.id, k % 2 === 1 && k < members.size - 1 ? 2 : 1);
        prev = cur; cur = next.a1 === cur ? next.a2 : next.a1;
      }
    }
    // an open chain's 1½ bonds: double, single… from the far end
    if (ends.length === 2) {
      let cur = ends.find((e) => e !== anion)!, prev = -1, k = 0;
      while (cur !== anion && k < members.size) {
        const next = inner(cur).find((b) => (b.a1 === cur ? b.a2 : b.a1) !== prev);
        if (!next) break;
        if (next.order === 1.5) kekule.set(next.id, k % 2 === 0 ? 2 : 1);
        prev = cur; cur = next.a1 === cur ? next.a2 : next.a1; k++;
      }
    }
  }
  // 1½ bonds where no aromatic ring can be (in no ring, or a ring with no Kekulé structure, such
  // as a pyranose from an old file) are single bonds, as ChemDraw draws them
  const bonds15: number[] = [];
  for (const id of ids) for (const bid of doc.adj.get(id) ?? []) { const b = doc.bonds.get(bid)!; if (b.order === 1.5 && inSet.has(b.a1) && inSet.has(b.a2) && !kekule.has(bid)) bonds15.push(bid); }
  if (bonds15.length) for (const bid of aromaticAsSingle(doc, bonds15)) kekule.set(bid, 1);
  // A charged atom in a ring of 1½ bonds (tropylium's C⁺, cyclopentadienide's C⁻) takes its
  // hydrogen from the double bonds it hasn't got, which aromatic bonds alone don't tell the
  // engine (it gives C⁺ with two aromatic bonds no H, and can't kekulize the ring): the ring is
  // written with alternating bonds instead, the charged atom left without a double bond.
  const seen15 = new Set<number>();
  for (const id of ids) {
    const a = doc.atoms.get(id)!;
    if (!a.charge || a.label || charged.has(id)) continue;
    const start = (doc.adj.get(id) ?? []).filter((bid) => doc.bonds.get(bid)!.order === 1.5 && !kekule.has(bid) && !seen15.has(bid));
    if (!start.length) continue;
    const part = new Set<number>();
    const stack = [...start];
    while (stack.length) {
      const bid = stack.pop()!;
      const b = doc.bonds.get(bid)!;
      if (part.has(bid) || kekule.has(bid) || !inSet.has(b.a1) || !inSet.has(b.a2)) continue;
      part.add(bid);
      for (const at of [b.a1, b.a2]) for (const n of doc.adj.get(at) ?? []) if (doc.bonds.get(n)!.order === 1.5 && !part.has(n)) stack.push(n);
    }
    for (const bid of part) seen15.add(bid);
    const doubles = kekuleDoubles(doc, part);
    if (doubles) for (const bid of part) kekule.set(bid, doubles.has(bid) ? 2 : 1);
  }
  if (!files) for (const id of ids) {
    const a = doc.atoms.get(id)!;
    if (isMetalAtom(a) || charged.has(id)) continue;
    const mb = metalBonds(id);
    if (!mb.length) continue;
    if (a.label) {
      const others = (doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => !outsideValence(b) && !mb.includes(b)).reduce((s, b) => s + b.order, 0);
      if (labelDonates(a.label, others)) for (const b of mb) dative.add(b.id);
      continue;
    }
    // as many as the atom's hydrogens were worked out with stay ordinary (see Doc.valenceSum)
    let own = 0;
    for (const bid of doc.adj.get(id) ?? []) { const b = doc.bonds.get(bid)!; if (!outsideValence(b) && !mb.includes(b)) own += b.order; }
    let keep = doc.valenceSum(id) - own - radicalElectrons(a);
    for (const b of mb) { if (keep >= b.order) keep -= b.order; else dative.add(b.id); }
  }
  // Boron, aluminium, gallium and indium take no dative bond past their three bonds in the
  // engine: a pair given to one (the chloride bridging to the aluminium of the Tebbe reagent) is
  // written as an ordinary bond with the charges of an ate complex, Cl⁺–Al⁻
  for (const bid of [...dative]) {
    const b = doc.bonds.get(bid)!;
    const donor = isMetalAtom(doc.atoms.get(b.a1)) ? b.a2 : b.a1;
    const acceptor = donor === b.a1 ? b.a2 : b.a1;
    const d = doc.atoms.get(donor)!;
    if (!ATE.has(doc.atoms.get(acceptor)!.z) || d.label || isMetalAtom(d)) continue;
    dative.delete(bid);
    charged.set(donor, (charged.get(donor) ?? 0) + 1);
    charged.set(acceptor, (charged.get(acceptor) ?? 0) - 1);
  }
  /**
   * Atoms and bonds with their hydrogens as written (a text box read as chemistry, or a label on
   * its own): written out as single and double bonds, and an atom shown without hydrogens it
   * would otherwise take is a radical or carbene (TEMPO's O, NO, a free NHC's carbon), its
   * valence fixed so the engine adds none (N on its own is N, not NH3). The first atom stands for
   * `owner` (-1: none, every atom is one the drawing doesn't have).
   */
  const pushWritten = (g: MiniGraph, x0: number, y0: number, owner: number, map0?: number, label?: string): void => {
    const kb = kekulize(g);
    const base = atoms.length;
    const used = g.atoms.map(() => 0);
    for (const b of kb) { used[b.a] += b.order === 1.5 ? 1.5 : b.order; used[b.b] += b.order === 1.5 ? 1.5 : b.order; }
    // (for a file, laid out at bond length; for the engine, spread a little so no two share a position)
    const laid = files ? layOutGroup(g, x0, y0, { x: 1, y: 0 }) : null;
    if (files && label && owner >= 0 && asGroup(g, label, doc.atoms.get(owner)?.z)) sgroups.push({ atoms: g.atoms.map((_, k) => base + k), label });
    g.atoms.forEach((ga, k) => {
      const missing = ga.hCount !== undefined && hasImplicitH(ga.z) ? implicitHydrogens(ga.z, used[k], ga.charge) - ga.hCount : 0;
      const ang = k * 2.4, r = k === 0 ? 0 : 0.35 + 0.05 * k;
      const sym = ga.dummy ? generic : SYMBOLS[ga.z] || generic;
      atoms.push({
        sym, x: laid ? laid[k].x : x0 + r * Math.cos(ang), y: laid ? laid[k].y : y0 + r * Math.sin(ang), charge: ga.charge, iso: ga.iso ?? 0, rad: missing === 1 ? 2 : missing === 2 ? 1 : 0,
        ...(missing > 0 ? { val: Math.round(used[k]) + ga.hCount! } : {}), ...(k === 0 && map0 ? { map: map0 } : {}),
      });
      map.push(k === 0 ? owner : -1);
      if (owner < 0 || g.atoms.length > 1) inLabel.push(base + k);
    });
    // (positions are made up, so double bonds are written as either cis or trans)
    for (const b of kb) bonds.push({ a: base + b.a, b: base + b.b, order: b.order === 1.5 ? 4 : b.order, stereo: b.order === 2 ? 3 : 0 });
  };
  for (const id of ids) {
    const a = doc.atoms.get(id)!;
    const at = stand?.moves.get(id) ?? a;
    const x = (at.x - first.x) / L, y = -(at.y - first.y) / L;
    let g: MiniGraph | null = null;
    // a label on its own, with no bonds (N, OMe, NH3 typed with the Text tool): what is written,
    // as a text box set to Chemical reads it, with no hydrogens the label doesn't show
    const lone = a.label && !a.charge && !a.isotope && !a.radical && !doc.adj.get(id)?.length ? readSpecies(a.label, { fragments: true }) : null;
    if (lone && !lone.expected && !lone.graph.atoms.some((ga) => ga.dummy)) {
      attach.set(id, atoms.length);
      pushWritten(lone.graph, x, y, id, opts.maps ? a.mapNo : undefined, a.label!);
      continue;
    }
    if (a.label) {
      const own = valenceOfBonds((doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => !outsideValence(b) && !dative.has(b.id)).map((b) => b.order));
      g = !own && isCarbonylLabel(a.label) && toMetal(id) ? CARBONYL_LIGAND : labelGraph(a.label, own);
      if (!g) unknown.push(a.label);
    }
    // (for a file, a label standing for an undefined group, R1, Ar, X, is written as that label)
    const dummyLabel = !!a.label && (!g || (files && g.atoms.length === 1 && g.atoms[0].dummy));
    if (!g || g.atoms.length === 0 || dummyLabel) {
      attach.set(id, atoms.length);
      const rad = a.radical === 'singlet' || carbene.has(id) ? 1 : a.radical === 'doublet' ? 2 : a.radical === 'triplet' ? 3 : 0;
      const sym = dummyLabel ? generic : SYMBOLS[a.z] || generic;
      if (sym === generic) genericAt.push([atoms.length, a.label ?? '']);
      const iso = opts.attachKinds && a.attach ? attachCode(a.attach, a.attachNum) : a.isotope;
      // an R group numbered as drawn (R1) is an R# atom with its number (BIOVIA CTfile: M  RGP, RGROUPS=)
      const rg = files && dummyLabel ? /^R(\d+)$/.exec(a.label!) : null;
      atoms.push({
        sym: rg ? 'R#' : sym, x, y, charge: a.charge + (charged.get(id) ?? 0), iso, rad, ...(opts.maps && a.mapNo ? { map: a.mapNo } : {}),
        ...(rg ? { rg: +rg[1] } : aliases && dummyLabel ? { alias: a.label! } : {}), ...(files && a.enhStereo ? { enh: a.enhStereo } : {}),
      });
      map.push(id);
      continue;
    }
    const base = atoms.length;
    attach.set(id, base);
    // For a file, the group's atoms laid out at bond length, away from the atoms it is bonded to, and
    // marked as a superatom S-group with the label, so other programs (and this one) show the label.
    let laid: { x: number; y: number }[] | null = null;
    if (files) {
      const near = (doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!).map((b) => (b.a1 === id ? b.a2 : b.a1)).filter((n) => inSet.has(n)).map((n) => stand?.moves.get(n) ?? doc.atoms.get(n)!);
      const mx = near.reduce((t, p) => t + (p.x - first.x) / L, 0) / (near.length || 1), my = near.reduce((t, p) => t - (p.y - first.y) / L, 0) / (near.length || 1);
      const len = Math.hypot(x - mx, y - my);
      laid = layOutGroup(g, x, y, near.length && len > 1e-6 ? { x: (x - mx) / len, y: (y - my) / len } : { x: 1, y: 0 });
      if (asGroup(g, a.label!, a.z)) sgroups.push({ atoms: g.atoms.map((_, k) => base + k), label: a.label! });
    }
    // the label's own charge (the charge tool's, or one kept from a CDXML file: PPh3 +, CO2 −) goes on
    // its first atom, unless the charge is negative and that atom can't take it with its bonds:
    // then on the group's first O, S or N that would carry one (CO2 − is the carboxylate's O⁻, not C⁻;
    // SO3 − the sulfonate's; review F1d-R02)
    const q = a.charge + (charged.get(id) ?? 0);
    let qAt = 0;
    if (q < 0 && g.atoms.length > 1) {
      const used = g.atoms.map(() => 0);
      for (const gb of g.bonds) { const o = gb.order === 1.5 ? 1.5 : gb.order; used[gb.a] += o; used[gb.b] += o; }
      used[0] += valenceOfBonds((doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => !outsideValence(b)).map((b) => b.order));
      // (only when the charge would break that atom's valence: B of B(OH)3 − takes it with its four
      // bonds, as a borate is drawn; review F1e-R02)
      const most = maxValence(g.atoms[0].z, q);
      if (implicitHydrogens(g.atoms[0].z, Math.ceil(used[0]), 0) <= 0 && most !== undefined && Math.ceil(used[0]) > most) {
        const k = g.atoms.findIndex((ga, i) => i > 0 && (ga.z === 8 || ga.z === 16 || ga.z === 7) && !ga.charge && implicitHydrogens(ga.z, Math.ceil(used[i]), 0) > 0);
        if (k > 0) qAt = k;
      }
    }
    // A bonded label that is its element with the hydrogens it shows (N, NH on a methyl) means that
    // atom with those hydrogens, whatever the valence rule gives (Nate, 2026-11-23): its valence is
    // written (V2000 vvv, V3000 VAL=; BIOVIA CTfile Formats), so the engine and every reader take
    // the count as shown ([N] in SMILES). Check Structure warns when that valence is unusual.
    const val = g.atoms.length === 1 ? shownValence(doc, id, a.label!, a.z, a.charge + (charged.get(id) ?? 0), dative) : undefined;
    g.atoms.forEach((ga, k) => {
      // (for the engine, spread expanded atoms a little so no two share a position)
      const ang = (k * 2.4);
      const r = k === 0 ? 0 : 0.35 + 0.05 * k;
      const sym = ga.dummy ? generic : SYMBOLS[ga.z] || generic;
      if (sym === generic) genericAt.push([atoms.length, `${a.label}/${k}`]);
      atoms.push({ sym, x: laid ? laid[k].x : x + r * Math.cos(ang), y: laid ? laid[k].y : y + r * Math.sin(ang), charge: ga.charge + (k === qAt ? q : 0), iso: ga.iso ?? 0, ...(k === 0 && opts.maps && a.mapNo ? { map: a.mapNo } : {}), ...(k === 0 && val !== undefined ? { val } : {}) });
      map.push(k === 0 ? id : -1);
      if (g!.atoms.length > 1) inLabel.push(base + k);
    });
    for (const gb of g.bonds) bonds.push({ a: base + gb.a, b: base + gb.b, order: gb.order === 1.5 ? 4 : gb.order, stereo: 0 });
  }
  for (const sp of opts.species ?? []) pushWritten(sp.graph, (sp.x - first.x) / L, -(sp.y - first.y) / L, -1);
  const seen = new Set<number>();
  for (const id of ids) {
    for (const bid of doc.adj.get(id) ?? []) {
      if (seen.has(bid)) continue;
      seen.add(bid);
      const b = doc.bonds.get(bid)!;
      if (!inSet.has(b.a1) || !inSet.has(b.a2)) continue;
      // A dative bond joins two molecules that are each whole (the formula is the same), so the
      // engine gets none; a file keeps it as a coordination bond from the donor (a1), and a
      // hydrogen bond (a1 the H) as one, both V3000 types (BIOVIA CTfile: bond types 9 and 10).
      if (outsideValence(b)) {
        if (files && (b.display === 'dative' || b.display === 'hydrogen')) bonds.push({ a: attach.get(b.a1)!, b: attach.get(b.a2)!, order: b.display === 'dative' ? 9 : 10, stereo: 0 });
        continue;
      }
      if (dative.has(b.id)) {
        // from the atom giving the bond to the metal (V2000 bond type 9, a coordination bond)
        const donor = isMetalAtom(doc.atoms.get(b.a1)) ? b.a2 : b.a1;
        bonds.push({ a: attach.get(donor)!, b: attach.get(donor === b.a1 ? b.a2 : b.a1)!, order: 9, stereo: 0 });
        continue;
      }
      const order = kekule.get(b.id) ?? (b.order === 1.5 ? 4 : b.order === 2 ? 2 : b.order === 3 ? 3 : 1);
      // a stereo bond is written from the atom it describes
      const flat = stand?.bonds.get(b.id);
      const drawn = flat ? { ...b, ...flat } : b;
      // (a wedge on a 1½ bond read as single describes its atom as on any single bond)
      const sb = order === 1 && drawn.order === 1.5 ? { ...drawn, order: 1 } : drawn;
      const sense = stereoSense(sb);
      const from = sense ? stereoAnchor(doc, sb)! : sb.a1;
      const stereo = sense === 'up' ? 1 : sense === 'down' ? 6 : sense === 'either' ? 4 : 0;
      const to = from === sb.a1 ? sb.a2 : sb.a1;
      bonds.push({ a: attach.get(from)!, b: attach.get(to)!, order, stereo });
    }
  }

  hydrogensLast(atoms, bonds, map, inLabel, genericAt, sgroups);
  const head = [name.slice(0, 80), molProgramLine(), ''];
  // The chiral flag (BIOVIA CTfile: 1 = the wedges show the absolute configuration, 0 = only the
  // relative one; review F1-R02): 1 only where the drawing says so, by an Abs chiral flag beside the
  // structure (Chemistry > Chiral Flag; one read from a file comes back as that flag) or a centre
  // marked abs. Wedges alone, a Rac flag or a Rel flag give 0. In V3000 a Rac or Rel structure's
  // wedged centres also go in an and (Rac) or or (Rel) group of their own, which says which it is.
  // Wedges alone give 1 instead when Settings ▸ Preferences says they mean one enantiomer
  // (chiralPrefs): such a structure is written as if it had an Abs flag.
  const flagOf = files ? flagsByAtom(doc, ids, opts.flagOwners) : new Map<number, { flag: ChiralFlag; frag: number }>();
  if (files && chiralPrefs.unflagged === 'absolute') {
    for (const b of bonds) {
      if ((b.stereo !== 1 && b.stereo !== 6) || map[b.a] < 0 || atoms[b.a].enh || flagOf.has(map[b.a])) continue;
      const frag = doc.fragmentOf(map[b.a]);
      const first = Math.min(...frag);
      for (const k of frag) flagOf.set(k, { flag: 'Absolute', frag: first });
    }
  }
  const flags = new Set([...flagOf.values()].map((f) => f.flag));
  const hasAbs = files && (flags.has('Absolute') || atoms.some((t) => t.enh?.type === 'abs'));
  const racRel = flags.has('Racemic') || flags.has('Relative');
  // (V2000's counts line has three columns for each count: more than 999 atoms or bonds, the
  // engine's molfile included, go as V3000)
  const big = atoms.length > 999 || bonds.length > 999 ? 'more than 999 atoms or bonds' : null;
  // (a Rac or Rel flag on wedged centres: V2000 can say only 0, the same as no flag; V3000's
  // and/or groups say which, review F1b-R13)
  const flagGroups = files && racRel && bonds.some((b) => (b.stereo === 1 || b.stereo === 6) && map[b.a] >= 0 && flagOf.get(map[b.a])?.flag !== 'Absolute' && !!flagOf.get(map[b.a])) ? 'a Rac or Rel chiral flag' : null;
  // (Abs structures beside wedged ones with no flag in one file: V2000's one flag would make them
  // all absolute. V3000 says it without touching the others: the file's flag 0, and the Abs
  // structures' wedged centres in the absolute collection (STEABS), which the reader turns back
  // into their Abs flags; review F1c-R03, F1d-R04. Each unflagged structure's wedged centres go in
  // an and group of their own (STERACn), so every reader agrees they are racemic rather than
  // reading the file's flag 0 its own way: BIOVIA CTfile Formats 2026, Stereochemistry, gives
  // wedges without the chiral flag as "a mixture of the stereoisomer as drawn and its enantiomer",
  // which is what an and group says, and Ketcher, for one, reads such centres otherwise (Ketcher
  // issue #56). Nate's decision, 2026-11-23. This program's reader turns the group back into an
  // unflagged structure.)
  const unflagged = (k: number) => map[k] >= 0 && !flagOf.has(map[k]) && !atoms[k].enh;
  const mixedAbs = files && hasAbs && bonds.some((b) => (b.stereo === 1 || b.stereo === 6) && unflagged(b.a)) ? 'structures with and without an Abs chiral flag' : null;
  const because = opts.v3000 ? null : (files ? needsV3000(atoms, bonds) ?? flagGroups ?? mixedAbs : null) ?? big;
  const v3 = !!(opts.v3000 || because);
  if (files && v3 && mixedAbs) {
    let nextAnd = 0;
    for (const t of atoms) if (t.enh?.type === 'and') nextAnd = Math.max(nextAnd, t.enh.group ?? 1);
    const andOf = new Map<number, EnhancedStereo>();
    for (const b of bonds) {
      if ((b.stereo !== 1 && b.stereo !== 6) || map[b.a] < 0 || atoms[b.a].enh) continue;
      const f = flagOf.get(map[b.a]);
      if (f?.flag === 'Absolute') atoms[b.a] = { ...atoms[b.a], enh: { type: 'abs' } };
      else if (!f) {
        const frag = Math.min(...doc.fragmentOf(map[b.a]));
        if (!andOf.has(frag)) andOf.set(frag, { type: 'and', group: ++nextAnd });
        atoms[b.a] = { ...atoms[b.a], enh: andOf.get(frag)! };
      }
    }
  }
  if (files && v3 && racRel) {
    const next = { and: 0, or: 0 };
    for (const t of atoms) if (t.enh && t.enh.type !== 'abs') next[t.enh.type] = Math.max(next[t.enh.type], t.enh.group ?? 1);
    const groupOf = new Map<number, EnhancedStereo>();
    for (const b of bonds) {
      if (b.stereo !== 1 && b.stereo !== 6) continue;
      const f = map[b.a] >= 0 ? flagOf.get(map[b.a]) : undefined;
      if (!f || f.flag === 'Absolute' || atoms[b.a].enh) continue;
      const type = f.flag === 'Racemic' ? 'and' : 'or';
      if (!groupOf.has(f.frag)) groupOf.set(f.frag, { type, group: ++next[type] });
      atoms[b.a] = { ...atoms[b.a], enh: groupOf.get(f.frag)! };
    }
  }
  const chiral = hasAbs && (v3 || !racRel) && !(v3 && mixedAbs);
  const extra = files ? { sgroups, chiral } : {};
  const out = { map, unknownLabels: unknown, inLabel, generic: genericAt, sgroups, ...(because ? { v3000Because: because } : {}) };
  if (opts.v3000 || because) return { molblock: v3000Molfile(head, atoms, bonds, extra), ...out };
  return { molblock: v2000Molfile(head, atoms, bonds, extra), ...out };
}

/**
 * Places for a label's atoms in a file, in bond lengths with y upwards: the first atom (the one
 * bonded to the rest) at (x0, y0) and the others drawn out as Clean Up Structure draws them
 * (regular rings, chains zig-zagging at 120°, bonds one bond length), turned so the group lies
 * along `away`, which points away from the atoms the label is bonded to.
 */
export function layOutGroup(g: MiniGraph, x0: number, y0: number, away: { x: number; y: number }): { x: number; y: number }[] {
  const n = g.atoms.length;
  if (n <= 1) return [{ x: x0, y: y0 }];
  // A first guess: each part of the group (a salt has two) as a tree from its first atom, then
  // cleaned up. The rest of the structure is stood in for by one more atom bonded to the first
  // (index n, the guess's start), so the group's bonds leave the first atom at even angles to it.
  const adj: number[][] = [...g.atoms.map(() => [] as number[]), [0]];
  adj[0].push(n);
  for (const b of g.bonds) { adj[b.a].push(b.b); adj[b.b].push(b.a); }
  const guess = [...g.atoms.map(() => ({ x: 0, y: 0 })), { x: -1, y: 0 }];
  const dir = guess.map(() => 0);
  const seen = new Set<number>([n]);
  let right = 0;
  for (let root = 0; root < n; root++) {
    if (seen.has(root)) continue;
    seen.add(root);
    guess[root] = { x: root === 0 ? 0 : right + 1.5, y: 0 };
    const queue = [root];
    while (queue.length) {
      const u = queue.shift()!;
      const next = adj[u].filter((v) => !seen.has(v));
      next.forEach((v, i) => {
        seen.add(v);
        const ang = dir[u] + (next.length === 1 ? (u % 2 ? 1 : -1) * Math.PI / 6 : (i - (next.length - 1) / 2) * (Math.PI / 3));
        dir[v] = ang;
        guess[v] = { x: guess[u].x + Math.cos(ang), y: guess[u].y + Math.sin(ang) };
        queue.push(v);
      });
    }
    right = Math.max(...guess.map((p) => p.x));
  }
  let pos: { x: number; y: number }[] = guess;
  try {
    const clean = cleanUp(guess.map((p) => ({ ...p })), [...g.bonds.map((b) => [b.a, b.b, b.order] as [number, number, number]), [0, n, 1]], 1);
    if (clean.length === n + 1 && clean.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) pos = clean;
  } catch { /* keep the guess */ }
  // turned so the stand-in lies behind the first atom, opposite `away`
  const turn = Math.atan2(away.y, away.x) - Math.atan2(pos[0].y - pos[n].y, pos[0].x - pos[n].x);
  const c = Math.cos(turn), s = Math.sin(turn);
  return pos.slice(0, n).map((p) => { const dx = p.x - pos[0].x, dy = p.y - pos[0].y; return { x: x0 + dx * c - dy * s, y: y0 + dx * s + dy * c }; });
}

/**
 * Drawn hydrogen atoms (an H on a wedge) moved after every other atom, in place. OpenChemLib
 * moves such "simple" hydrogens to the end of its atom list as it reads a molfile (swapping each
 * with the last heavy atom), so the 3-D models it builds would number their atoms differently
 * from the molfile, and a Newman projection or 3-D pose read back through `map` would put one
 * atom's label on another (an H written as CH3). With them already last, its numbering is the
 * molfile's. A simple hydrogen is OpenChemLib's: plain H (no charge or isotope) with at most one
 * single bond, not to a metal other than aluminium; any other H keeps its place.
 */
function hydrogensLast(atoms: MAtom[], bonds: MBond[], map: number[], inLabel: number[], generic: [number, string][], sgroups: MSgroup[] = []): void {
  const n = atoms.length;
  const simple = atoms.map((a) => a.sym === 'H' && !a.charge && !a.iso && !a.alias);
  const degree = atoms.map(() => 0);
  for (const b of bonds) {
    degree[b.a]++; degree[b.b]++;
    for (const [x, y] of [[b.a, b.b], [b.b, b.a]]) {
      const z = elementNumber(atoms[y].sym);
      if (b.order !== 1 || (z !== undefined && isMetal(z) && z !== 13)) simple[x] = false;
    }
  }
  for (let i = 0; i < n; i++) if (degree[i] > 1) simple[i] = false;
  const order = [...atoms.keys()].filter((i) => !simple[i]);
  const firstH = order.length;
  order.push(...[...atoms.keys()].filter((i) => simple[i]));
  if (order.every((old, i) => old === i) || firstH === n) return;
  const to = new Array<number>(n);
  order.forEach((old, i) => { to[old] = i; });
  const was = [...atoms], wasMap = [...map];
  order.forEach((old, i) => { atoms[i] = was[old]; map[i] = wasMap[old]; });
  for (const b of bonds) { b.a = to[b.a]; b.b = to[b.b]; }
  for (let k = 0; k < inLabel.length; k++) inLabel[k] = to[inLabel[k]];
  for (const g of generic) g[0] = to[g[0]];
  for (const g of sgroups) g.atoms = g.atoms.map((k) => to[k]);
}
