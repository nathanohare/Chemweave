// @vitest-environment jsdom
//
// Fix phase F8a, items 1 to 3: Nate's answers of 2026-11-23 on wedges without a chiral flag, an
// unflagged structure beside an Abs one in one molfile, and a bonded label read as written.
// - Chiral flag and stereo groups: BIOVIA CTfile Formats 2026, Stereochemistry (the chiral flag 1:
//   the wedges show one enantiomer; 0: "a mixture of the stereoisomer as drawn and its
//   enantiomer"); V3000 collections MDLV30/STEABS and STERACn. Structure: (S)-alanine
//   C[C@H](N)C(=O)O (PubChem CID 5950), drawn in code.
// - A label read as written: a methyl N labelled "N" is that N with no hydrogens, C[N] (OpenSMILES
//   specification, Atoms: an atom in brackets has exactly the hydrogens written, none here).
//   The valence field: CTfile Formats, V2000 atom block vvv and V3000 VAL=; Ketcher's KET schema
//   explicitValence; ChemAxon's Marvin Documents format mrvValence; ChemDoodle JSON h.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { addMolfile, chemFormatOf, readScene, sceneToDoc, writeChemDoodleJson, writeCmlFile, writeKetFile, writeMolFile, writeMrvFile, writeSdfFile, writeRxnFile } from '../src/io/chem-formats';
import { toMolfile } from '../src/chem/molfile';
import { addChiralFlag, chiralPrefs, structureFlag, type ChiralFlag } from '../src/chem/chiral-flag';
import { atomWarnings } from '../src/chem/warnings';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });
afterEach(() => { chiralPrefs.unflagged = 'racemic'; });

const L = ACS_1996.bondLength;
const newDoc = () => { const d = new Doc(); d.style = { ...ACS_1996 }; return d; };
const open = (name: string, text: string) => sceneToDoc(readScene(chemFormatOf(name, text)!, text)!, ACS_1996).doc;
const flagOf = (mol: string) => (mol.includes('V3000') ? /COUNTS \d+ \d+ \d+ \d+ (\d)/.exec(mol)![1] : mol.split('\n')[3].slice(12, 15).trim());
const rd = (mb: string, f: 'get_smiles' | 'get_cxsmiles') => { const m = RDKit.get_mol(mb); try { return m ? m[f]().replace(/\|\([^)]*\),?/, '|') : ''; } finally { m?.delete(); } };

/** (S)-alanine at (x, y), with a chiral flag if asked; its atom ids. */
function alanineAt(d: Doc, x: number, y: number, flag?: ChiralFlag): number[] {
  let ids: number[] = [];
  d.bulk(() => {
    const ca = d.addAtom(x, y), me = d.addAtom(x - L * 0.87, y + L / 2), n = d.addAtom(x, y - L, 7), c = d.addAtom(x + L * 0.87, y + L / 2), o1 = d.addAtom(x + L * 1.73, y, 8), o2 = d.addAtom(x + L * 0.87, y + L * 1.5, 8);
    d.addBond(ca.id, me.id, 1, 'hashWedge'); d.addBond(ca.id, n.id); d.addBond(ca.id, c.id); d.addBond(c.id, o1.id, 2); d.addBond(c.id, o2.id);
    ids = [ca.id, me.id, n.id, c.id, o1.id, o2.id];
    if (flag) addChiralFlag(d, ids, flag);
  });
  return ids;
}
const flags = (d: Doc) => [...d.shapes.values()].filter((s) => s.symbol).map((s) => s.symbol);

describe('Preferences: wedges without a flag mean (F1 Needs Nate 10)', () => {
  it('Racemic, the default: an unflagged alanine is saved with the chiral flag 0, and a 0 file opens with no flag', () => {
    expect(chiralPrefs.unflagged).toBe('racemic');
    const d = newDoc();
    alanineAt(d, 0, 0);
    const mol = writeMolFile(d).text;
    expect(mol).toMatch(/V2000/);
    expect(flagOf(mol)).toBe('0');
    expect(flags(open('a.mol', mol))).toEqual([]);
  });
  it('One enantiomer: the same alanine is saved with 1 (V2000) and STEABS-free V2000 stays V2000; RDKit reads it as absolute', () => {
    chiralPrefs.unflagged = 'absolute';
    const d = newDoc();
    alanineAt(d, 0, 0);
    const mol = writeMolFile(d).text;
    expect(mol).toMatch(/V2000/);
    expect(flagOf(mol)).toBe('1');
    // (RDKit: a chiral flag 1 file has no stereo group, so its centre is absolute)
    expect(rd(mol, 'get_cxsmiles')).not.toMatch(/&\d|o\d/);
    // SD and RXN records the same
    expect(flagOf(writeSdfFile(d).text)).toBe('1');
    // it opens again with an Abs flag drawn, so the meaning stays whatever the setting is later
    expect(flags(open('a.mol', mol))).toEqual(['Absolute']);
  });
  it('One enantiomer: a flag drawn by hand still wins (Rac gives 0 and an and group, Abs gives 1)', () => {
    chiralPrefs.unflagged = 'absolute';
    const rac = newDoc();
    alanineAt(rac, 0, 0, 'Racemic');
    const r = writeMolFile(rac).text;
    expect(flagOf(r)).toBe('0');
    expect(r).toMatch(/MDLV30\/STERAC1 ATOMS=\(1 1\)/);
    const abs = newDoc();
    alanineAt(abs, 0, 0, 'Absolute');
    expect(flagOf(writeMolFile(abs).text)).toBe('1');
  });
  it('One enantiomer: another program\'s file with the flag 0 opens with a Rac flag, so saving it keeps it racemic', () => {
    const d = newDoc();
    alanineAt(d, 0, 0);
    const zero = writeMolFile(d).text;
    chiralPrefs.unflagged = 'absolute';
    const back = open('a.mol', zero);
    expect(flags(back)).toEqual(['Racemic']);
    expect(flagOf(writeMolFile(back).text)).toBe('0');
    // pasted the same
    const p = newDoc();
    p.bulk(() => { addMolfile(p, zero, 0, 0); });
    expect(flags(p)).toEqual(['Racemic']);
  });
  it('a reaction\'s structures follow the setting in an RXN file too', () => {
    chiralPrefs.unflagged = 'absolute';
    const d = newDoc();
    alanineAt(d, 0, 0);
    alanineAt(d, 8 * L, 0);
    d.bulk(() => d.addArrow({ tail: { x: 3 * L, y: 0 }, head: { x: 6 * L, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 10, headWidth: 3 }));
    const rxn = writeRxnFile(d).text;
    const mols = rxn.split('$MOL\n').slice(1);
    expect(mols.map(flagOf)).toEqual(['1', '1']);
  });
});

describe('an unflagged wedged structure beside an Abs one in one MOL file (F1 Needs Nate 13)', () => {
  it('Racemic: its centres go in an and group (STERAC), the Abs one\'s in STEABS, and both come back as drawn', () => {
    const d = newDoc();
    alanineAt(d, 0, 0, 'Absolute');
    const plain = alanineAt(d, 5 * L, 0);
    const mol = writeMolFile(d).text;
    expect(mol).toMatch(/MDLV30\/STEABS ATOMS=\(1 1\)/);
    expect(mol).toMatch(/MDLV30\/STERAC1 ATOMS=\(1 7\)/);
    // (RDKit, as another reader: the first centre absolute, the second racemic)
    expect(rd(mol, 'get_cxsmiles')).toMatch(/a:1,&1:7\|$/);
    const back = open('a.mol', mol);
    expect(flags(back)).toEqual(['Absolute']);
    expect([...back.atoms.values()].some((a) => a.enhStereo)).toBe(false);
    expect(structureFlag(d, plain)).toBeUndefined();
  });
  it('a drawn and group keeps its own number and the neighbour takes the next', () => {
    const d = newDoc();
    alanineAt(d, 0, 0, 'Absolute');
    const marked = alanineAt(d, 5 * L, 0);
    d.bulk(() => d.updateAtom(marked[0], { enhStereo: { type: 'and', group: 1 } }));
    alanineAt(d, 10 * L, 0);
    const mol = writeMolFile(d).text;
    expect(mol).toMatch(/MDLV30\/STERAC1 ATOMS=\(1 7\)/);
    expect(mol).toMatch(/MDLV30\/STERAC2 ATOMS=\(1 13\)/);
  });
  it('One enantiomer: no and group; the unflagged structure is absolute too, with the chiral flag 1', () => {
    chiralPrefs.unflagged = 'absolute';
    const d = newDoc();
    alanineAt(d, 0, 0, 'Absolute');
    alanineAt(d, 5 * L, 0);
    const mol = writeMolFile(d).text;
    expect(mol).not.toMatch(/STERAC|STEREL/);
    expect(flagOf(mol)).toBe('1');
  });
  it('a file written with the default opened under One enantiomer keeps the and group (the meaning, not the setting)', () => {
    const d = newDoc();
    alanineAt(d, 0, 0, 'Absolute');
    alanineAt(d, 5 * L, 0);
    const mol = writeMolFile(d).text;
    chiralPrefs.unflagged = 'absolute';
    const back = open('a.mol', mol);
    expect([...back.atoms.values()].filter((a) => a.enhStereo).map((a) => a.enhStereo)).toEqual([{ type: 'and', group: 1 }]);
  });
});

describe('a bonded label read as written: "N" on a methyl (F1 Needs Nate 12)', () => {
  const methylN = () => {
    const d = newDoc();
    let n = 0;
    d.bulk(() => { const c = d.addAtom(0, 0); const a = d.addAtom(L, 0, 7, { label: 'N' }); d.addBond(c.id, a.id); n = a.id; });
    return { d, n };
  };
  it('writes the N\'s valence (1: its bond, no hydrogens) in V2000 and V3000, and RDKit reads C[N]', () => {
    const { d } = methylN();
    const v2 = writeMolFile(d).text;
    const nLine = v2.split('\n').find((l) => / N {3}/.test(l))!;
    // V2000 atom block: the sixth number after the symbol is vvv
    expect(nLine.slice(48, 51).trim()).toBe('1');
    expect(rd(v2, 'get_smiles')).toBe('C[N]');
    const v3 = writeMolFile(d, '', { v3000: true }).text;
    expect(v3).toMatch(/^M {2}V30 2 N [-\d.]+ [-\d.]+ [-\d.]+ 0 VAL=1$/m);
    expect(rd(v3, 'get_smiles')).toBe('C[N]');
    // the SD file the same
    expect(rd(writeSdfFile(d).text.split('$$$$')[0], 'get_smiles')).toBe('C[N]');
  });
  it('the chemistry engine gets the same: SMILES C[N]', () => {
    const { d } = methylN();
    expect(rd(toMolfile(d, [...d.atoms.keys()]).molblock, 'get_smiles')).toBe('C[N]');
  });
  it('states it in every other format: CML hydrogenCount 0, Marvin mrvValence, Ketcher explicitValence, ChemDoodle h', () => {
    const { d } = methylN();
    expect(writeCmlFile(d).text).toMatch(/elementType="N" hydrogenCount="0"/);
    expect(writeMrvFile(d).text).toMatch(/elementType="N"[^>]*mrvValence="1"/);
    const ket = JSON.parse(writeKetFile(d).text).mol0.atoms;
    expect(ket.find((a: { label: string }) => a.label === 'N').explicitValence).toBe(1);
    const cdj = JSON.parse(writeChemDoodleJson(d).text).m[0].a;
    expect(cdj.find((a: { l?: string }) => a.l === 'N').h).toBe(0);
    // the carbon's count is the rule's and isn't stated
    expect(ket.find((a: { label: string }) => a.label === 'C').explicitValence).toBeUndefined();
  });
  it('comes back as the label "N" from every format', () => {
    const { d } = methylN();
    for (const [name, text] of [['a.mol', writeMolFile(d).text], ['b.mol', writeMolFile(d, '', { v3000: true }).text], ['a.sdf', writeSdfFile(d).text],
      ['a.cml', writeCmlFile(d).text], ['a.mrv', writeMrvFile(d).text], ['a.ket', writeKetFile(d).text], ['a.json', writeChemDoodleJson(d).text]]) {
      const back = open(name, text);
      expect([...back.atoms.values()].map((a) => a.label).filter(Boolean), name).toEqual(['N']);
    }
  });
  it('NH2, the count the rule gives, states nothing extra', () => {
    const d = newDoc();
    d.bulk(() => { const c = d.addAtom(0, 0); const a = d.addAtom(L, 0, 7, { label: 'NH2' }); d.addBond(c.id, a.id); });
    const v2 = writeMolFile(d).text;
    expect(v2.split('\n').find((l) => / N {3}/.test(l))!.slice(48, 51).trim()).toBe('0');
    expect(rd(v2, 'get_smiles')).toBe('CN');
  });
  it('Check Structure warns about the N\'s unusual valence', () => {
    const { d, n } = methylN();
    expect(atomWarnings(d, d.atoms.get(n)!)).toEqual(['N in “N” has 1 bond (min 3)']);
  });
});
