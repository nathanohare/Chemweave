// @vitest-environment jsdom
//
// F8a round 2: a label's hydrogens through CDXML. The CDX SDK (chemapps.stolaf.edu/iupac/cdx/sdk/,
// Atom_NumHydrogens): "The number of (explicit) hydrogens in a labeled atom consisting of one heavy
// atom and (optionally) the symbol H (e.g., CH3)"; when it is missing, "The number of hydrogens is
// assumed to be the minimum value necessary to satisfy the valence requirements for the atom." So a bare "N" on a
// carbon in a ChemDraw file is an amine, CH3NH2 (methylamine, PubChem CID 6329), while a label
// typed "N" here (Nate, F1 Needs Nate 12) is written with NumHydrogens="0", so ChemDraw and this
// program both read N with no hydrogens. The file is typed here in ChemDraw's layout.

import { describe, it, expect } from 'vitest';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { toMolfile } from '../src/chem/molfile';
import { Doc } from '../src/model';

const file = (nh: string) => '<?xml version="1.0" encoding="UTF-8" ?><CDXML><page id="1"><fragment id="2">'
  + `<n id="3" p="50 50"/><n id="4" p="62 57" Element="7"${nh}><t p="59 60"><s font="3" size="10" face="96">N</s></t></n><b id="5" B="3" E="4"/></fragment></page></CDXML>`;
/** The N's hydrogens as the chemistry engine is told them: its V2000 valence column (0: the rule's, 1: one bond and none). */
const nValence = (d: Doc) => toMolfile(d, [...d.atoms.keys()]).molblock.split('\n').find((l) => / N {3}/.test(l))!.slice(48, 51).trim();

describe('a label\'s hydrogens in CDXML', () => {
  it('a ChemDraw "N" with no NumHydrogens is an amine, and is still shown as "N"', () => {
    const d = readCdxml(file('')).doc;
    expect([...d.atoms.values()].find((a) => a.z === 7)!.label).toBe('N');
    expect(nValence(d)).toBe('0');
  });
  it('a carbon "CH" with no NumHydrogens on one bond is a methyl, CH3, as the SDK says (review F8a2-R03)', () => {
    const d = readCdxml(file('').replace('Element="7"', '').replace('>N<', '>CH<')).doc;
    // (ethane, CH3CH3: PubChem CID 6324)
    expect(toMolfile(d, [...d.atoms.keys()]).molblock.split('\n').filter((l) => / C {3}/.test(l)).map((l) => l.slice(48, 51).trim())).toEqual(['0', '0']);
  });
  it('a ChemDraw "N" with NumHydrogens="0" has none', () => {
    expect(nValence(readCdxml(file(' NumHydrogens="0"')).doc)).toBe('1');
  });
  it('saves the ChemDraw "N" with no NumHydrogens again, and a label typed "N" here with NumHydrogens="0"', () => {
    const d = readCdxml(file('')).doc;
    d.edit('Move', () => { for (const a of d.atoms.values()) d.updateAtom(a.id, { x: a.x + 5 }); });
    expect(writeCdxml(d)).not.toMatch(/Element="7"[^>]*NumHydrogens/);
    const mine = new Doc();
    mine.bulk(() => { const c = mine.addAtom(0, 0), n = mine.addAtom(14.4, 0, 7, { label: 'N' }); mine.addBond(c.id, n.id); });
    const xml = writeCdxml(mine);
    expect(xml).toMatch(/Element="7"[^>]*NumHydrogens="0"|NumHydrogens="0"[^>]*Element="7"/);
    expect(nValence(readCdxml(xml).doc)).toBe('1');
  });
});
