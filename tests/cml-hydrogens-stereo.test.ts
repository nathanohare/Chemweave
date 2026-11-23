// @vitest-environment jsdom
//
// Hydrogen counts and enhanced stereo in CML (audit G1-18) and in molfile valences.
// - CML's hydrogenCount (xml-cml.org schema): the total number of hydrogens on an atom, drawn ones
//   included. Chem4Word's own attributes have no count (it works hydrogens out from valence).
// - Enhanced stereo as ChemAxon's mrvStereoGroup (abs, and1, or2; Marvin Documents format).
// - A molfile's valence (BIOVIA CTfile Formats 2020: V2000 vvv, 15 for none; V3000 VAL=).
// Values: ethanol C2H6O (CH3 3 H, CH2 2 H, OH 1 H; PubChem CID 702); the hydroxyl radical HO
// (PubChem CID 157350; SMILES [OH]); pyrrole C4H5N (PubChem CID 8027; NH 1 H, each CH 1 H);
// methylamine CH5N (PubChem CID 6329; CH3 3 H, NH2 2 H).
// Structures are made up here in code.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readCml, writeCml } from '../src/io/cml';
import { readScene, sceneToDoc, writeCmlFile, addMolfile } from '../src/io/chem-formats';
import { Doc, type Contents } from '../src/model';
import { ACS_1996 } from '../src/style';
import { labelHydrogens, hLabel, statedHLabel } from '../src/chem/hydrogen-count';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const atom = (id: number, z: number, x: number, more: object = {}) => ({ id, x, y: 0, z, label: null, charge: 0, isotope: 0, just: 'auto', ...more });
const ethanol = (): Contents => ({
  atoms: [atom(1, 6, 0), atom(2, 6, 14), atom(3, 8, 28, { enhStereo: { type: 'and', group: 1 } })],
  bonds: [{ id: 4, a1: 1, a2: 2, order: 1, display: 'solid', dpos: 'auto' }, { id: 5, a1: 2, a2: 3, order: 1, display: 'solid', dpos: 'auto' }],
  captions: [], arrows: [], shapes: [],
} as unknown as Contents);
const hc = (text: string) => [...text.matchAll(/hydrogenCount="(\d+)"/g)].map((m) => +m[1]);

describe('label helpers', () => {
  it('read and make element-with-hydrogen labels', () => {
    expect([labelHydrogens('NH2', 7), labelHydrogens('H2N', 7), labelHydrogens('OH', 8), labelHydrogens('O', 8), labelHydrogens('OMe', 8)]).toEqual([2, 2, 1, 0, null]);
    expect([hLabel(8, 1), hLabel(6, 2), hLabel(7, 0)]).toEqual(['OH', 'CH2', 'N']);
    // the valence rule gives water's O two hydrogens: one stated is a label, two needs none
    expect([statedHLabel(8, 1, 0, 0), statedHLabel(8, 2, 0, 0), statedHLabel(8, 1, 0, 0, 'doublet')]).toEqual(['OH', null, null]);
  });
});

describe('Chem4Word CML', () => {
  it('writes hydrogenCount for each element (ethanol: 3, 2, 1) and enhanced stereo as mrvStereoGroup', () => {
    const text = writeCml(ethanol(), 'g');
    expect(hc(text)).toEqual([3, 2, 1]);
    expect(text).toContain('mrvStereoGroup="and1"');
    const back = readCml(text)!;
    expect(back.atoms.map((a) => a.label)).toEqual([null, null, null]);
    expect(back.atoms.map((a) => a.enhStereo ?? null)).toEqual([null, null, { type: 'and', group: 1 }]);
  });
  it('reads a stated count the valence rule would not give as a label: the hydroxyl radical is OH', () => {
    const cml = '<cml:cml xmlns:cml="http://www.xml-cml.org/schema" xmlns:c4w="http://www.chem4word.com/cml"><cml:molecule id="m1"><cml:atomArray>'
      + '<cml:atom id="a1" elementType="O" x2="0" y2="0" hydrogenCount="1"/></cml:atomArray></cml:molecule></cml:cml>';
    const c = readCml(cml)!;
    expect(c.atoms[0].label).toBe('OH');
    // and written back with its one hydrogen
    expect(hc(writeCml(c, 'g'))).toEqual([1]);
  });
  it('pyrrole with aromatic bonds: the stated NH becomes a label, the CHs need none', () => {
    const pts = [[0, 0], [14, 0], [18, 13], [7, 21], [-4, 13]];
    const z = [7, 6, 6, 6, 6];
    const cml = '<cml:cml xmlns:cml="http://www.xml-cml.org/schema"><cml:molecule id="m1"><cml:atomArray>'
      + pts.map(([x, y], i) => `<cml:atom id="a${i + 1}" elementType="${z[i] === 7 ? 'N' : 'C'}" x2="${x}" y2="${y}" hydrogenCount="1"/>`).join('')
      + '</cml:atomArray><cml:bondArray>' + pts.map((_, i) => `<cml:bond id="b${i}" atomRefs2="a${i + 1} a${(i + 1) % 5 + 1}" order="A"/>`).join('')
      + '</cml:bondArray></cml:molecule></cml:cml>';
    const c = readCml(cml)!;
    expect(c.atoms.map((a) => a.label)).toEqual(['NH', null, null, null, null]);
    // written back: the label states the N's hydrogen; the ring's carbons are left to the reader
    expect(writeCml(c, 'g')).toMatch(/elementType="N"[^>]*hydrogenCount="1"/);
  });
  it('a file without the attributes (as Chem4Word itself writes) reads as before', () => {
    const text = writeCml(ethanol(), 'g').replace(/ hydrogenCount="\d+"| mrvStereoGroup="\w+"/g, '');
    const back = readCml(text)!;
    expect(back.atoms.map((a) => [a.label, a.enhStereo ?? null])).toEqual([[null, null], [null, null], [null, null]]);
  });
});

describe('CML files (File > Save As .cml)', () => {
  const draw = () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    const L = ACS_1996.bondLength;
    d.bulk(() => {
      const c1 = d.addAtom(0, 0), c2 = d.addAtom(L, 0), o = d.addAtom(2 * L, 0, 8);
      d.addBond(c1.id, c2.id); d.addBond(c2.id, o.id);
      d.updateAtom(c2.id, { enhStereo: { type: 'or', group: 2 } });
      // a hydroxyl radical, drawn as the label OH on its own
      d.addAtom(0, 3 * L, 8, { label: 'OH' });
    });
    return d;
  };
  it('writes hydrogenCount (ethanol 3, 2, 1; the radical 1) and the stereo group, and reads them back', () => {
    const text = writeCmlFile(draw()).text;
    expect(hc(text)).toEqual([3, 2, 1, 1]);
    expect(text).toContain('mrvStereoGroup="or2"');
    const back = sceneToDoc(readScene('cml', text)!, ACS_1996).doc;
    const atoms = [...back.atoms.values()];
    // (the radical comes back as an O with one unpaired electron, which takes one hydrogen: HO•)
    expect(atoms.map((a) => [a.label, a.radical ?? null])).toEqual([[null, null], [null, null], [null, null], [null, 'doublet']]);
    expect(atoms.filter((a) => a.enhStereo).map((a) => a.enhStereo)).toEqual([{ type: 'or', group: 2 }]);
  });
});

// A methyl N the user labelled "N": Nate (2026-11-23, F1 Needs Nate 12) reads it literally, an N with
// no hydrogens, so both CML writers state hydrogenCount 0 (it was left out before, review F1b-R12)
describe('a bonded label whose hydrogens differ from the rule', () => {
  const methylN = (label: string) => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => { const c = d.addAtom(0, 0), n = d.addAtom(ACS_1996.bondLength, 0, 7, { label }); d.addBond(c.id, n.id); });
    return d;
  };
  const contents = (label: string): Contents => ({
    atoms: [atom(1, 6, 0), atom(2, 7, 14, { label })],
    bonds: [{ id: 3, a1: 1, a2: 2, order: 1, display: 'solid', dpos: 'auto' }],
    captions: [], arrows: [], shapes: [],
  } as unknown as Contents);
  it('states the N\'s hydrogenCount as 0 in both the .cml file and the Chem4Word part', () => {
    const file = writeCmlFile(methylN('N')).text;
    expect(file).toMatch(/elementType="C" hydrogenCount="3"/);
    expect(file).toMatch(/elementType="N" hydrogenCount="0"/);
    const c4w = writeCml(contents('N'), 'g');
    expect(hc(c4w)).toEqual([3, 0]);
  });
  it('states it where the label and the rule agree (NH2: 2)', () => {
    expect(hc(writeCmlFile(methylN('NH2')).text)).toEqual([3, 2]);
    expect(hc(writeCml(contents('NH2'), 'g'))).toEqual([3, 2]);
  });
});

describe('molfile valences', () => {
  it('an O with valence 1 (the hydroxyl radical as another program writes it) opens as OH, and RDKit agrees it is [OH]', () => {
    const mb = '\n  test\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 O   0  0  0  0  0  1  0  0  0  0  0  0\nM  END\n';
    const m = RDKit.get_mol(mb);
    expect(m.get_smiles()).toBe('[OH]');
    m.delete();
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => { addMolfile(d, mb, 0, 0); });
    expect([...d.atoms.values()].map((a) => a.label)).toEqual(['OH']);
    // V3000 VAL= the same
    const v3 = '\n  test\n\n  0  0  0     0  0            999 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 1 0 0 0 0\nM  V30 BEGIN ATOM\nM  V30 1 O 0 0 0 0 VAL=1\nM  V30 END ATOM\nM  V30 END CTAB\nM  END\n';
    const d3 = new Doc();
    d3.style = { ...ACS_1996 };
    d3.bulk(() => { addMolfile(d3, v3, 0, 0); });
    expect([...d3.atoms.values()].map((a) => a.label)).toEqual(['OH']);
  });
  it('a valence the rule already gives (ethanol written with every valence) adds no labels', () => {
    const mb = '\n  test\n\n  3  2  0  0  0  0  0  0  0  0999 V2000\n'
      + '    0.0000    0.0000    0.0000 C   0  0  0  0  0  4  0  0  0  0  0  0\n'
      + '    1.0000    0.0000    0.0000 C   0  0  0  0  0  4  0  0  0  0  0  0\n'
      + '    2.0000    0.0000    0.0000 O   0  0  0  0  0  2  0  0  0  0  0  0\n'
      + '  1  2  1  0\n  2  3  1  0\nM  END\n';
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => { addMolfile(d, mb, 0, 0); });
    expect([...d.atoms.values()].map((a) => a.label)).toEqual([null, null, null]);
  });
});
