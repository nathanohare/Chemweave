// Hydrogen counts stated by a file, and the labels that show them.
//
// A file can say how many hydrogens an atom has where the usual valence rule would give another
// number: a molfile's valence (V2000 vvv, V3000 VAL=; BIOVIA CTfile Formats 2020) or CML's
// hydrogenCount (xml-cml.org schema: "the total number of hydrogens on an atom", including any
// hydrogen atoms drawn). This app shows such an atom with a label of the element and its
// hydrogens (OH for a hydroxyl radical, CH for a methine), the way ChemDraw does, and writes the
// count back out from that label. A label can always be typed over by hand.

import { hasImplicitH, implicitHydrogens, SYMBOLS } from './elements';

/** Electrons a radical keeps from bonding: 1 for a doublet, 2 for a singlet or a triplet. */
export function radicalElectrons(r: 'singlet' | 'doublet' | 'triplet' | undefined): number {
  return r === 'doublet' ? 1 : r === 'singlet' || r === 'triplet' ? 2 : 0;
}

/** The hydrogens on an element whose label is the element with hydrogens (NH, CH2, OH, H2N, HO; the bare symbol is 0), or null for any other label. */
export function labelHydrogens(label: string, z: number): number | null {
  const sym = SYMBOLS[z];
  if (!sym) return null;
  const t = label.trim();
  if (t === sym) return 0;
  const after = new RegExp(`^${sym}H(\\d*)$`).exec(t) ?? new RegExp(`^H(\\d*)${sym}$`).exec(t);
  return after ? (after[1] ? parseInt(after[1], 10) : 1) : null;
}

/** The label of an element with n hydrogens: N, OH, CH2. */
export function hLabel(z: number, n: number): string {
  return `${SYMBOLS[z]}${n > 0 ? 'H' : ''}${n > 1 ? n : ''}`;
}

/** The hydrogens the valence rule gives an unlabelled atom (none for elements it doesn't cover). */
export function ruleHydrogens(z: number, bondOrderSum: number, charge: number, radical?: 'singlet' | 'doublet' | 'triplet'): number {
  return hasImplicitH(z) ? implicitHydrogens(z, bondOrderSum, charge, radicalElectrons(radical)) : 0;
}

/**
 * The label for an atom whose file states `stated` hydrogens (not counting hydrogen atoms
 * drawn), or null when the valence rule already gives that many (so the atom needs no label).
 */
export function statedHLabel(z: number, stated: number, bondOrderSum: number, charge: number, radical?: 'singlet' | 'doublet' | 'triplet'): string | null {
  if (!hasImplicitH(z) || z === 1 || !Number.isFinite(stated) || stated < 0) return null;
  return stated === ruleHydrogens(z, bondOrderSum, charge, radical) ? null : hLabel(z, stated);
}
