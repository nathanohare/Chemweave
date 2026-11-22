// @vitest-environment jsdom
//
// Every label this program knows comes back as the same label through the exchange formats
// (review F1b-R02, F1b-R03): each built-in abbreviation (NICKNAMES: Me, Boc, OTBS, CO2R…)
// bonded to a methyl group, and each name a text box reads as a species on its own (the
// species list: DCM, LDA, DBU, NBS, PPh3…), plus generic labels (R, X, base, hν, Δ, cat.).
// Formats: MOL V2000 and V3000, SDF, KET and MRV (BIOVIA CTfile Formats 2020; EPAM Ketcher's KET;
// ChemAxon's Marvin Documents), and the MOL and SD files again under another program's name in
// their header (read as a foreign file, as for files saved before this phase). Besides the label,
// the chemistry must come back: RDKit's canonical SMILES of the drawing, written as a molfile,
// is the same before and after (review F1c-R11). Counter-ions typed on an atom (Cl-, AcO-, BF4-,
// whose V3000 label must be quoted, review F1c-R01) and D and T (hydrogen-2 and hydrogen-3,
// review F1c-R02) are in the lists. The structures are built here in code. (Every label through
// eight files takes a few minutes.)

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readScene, sceneToDoc, chemFormatOf, writeKetFile, writeMolFile, writeSdfFile, writeMrvFile } from '../src/io/chem-formats';
import { builtInNicknames } from '../src/chem/labels';
import { SPECIES_ENTRIES } from '../src/chem/species-list';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const L = ACS_1996.bondLength;
/** The drawing's chemistry: RDKit's canonical SMILES of it written as a molfile ('' when RDKit can't read it). */
function smilesOf(d: Doc): string {
  const m = RDKit.get_mol(writeMolFile(d).text);
  if (!m) return '';
  try { return m.get_smiles(); } finally { m.delete(); }
}
/** The same file as another program would have written it (its name in the header's second line). */
const foreign = (text: string) => text.split('\n').map((l, i, all) => (i === 1 || (i > 0 && all[i - 1] === '$$$$') ? l.replace(/^(.{2})Chemweav/, '$1  RDKit ') : l)).join('\n');
const back = (name: string, text: string) => sceneToDoc(readScene(chemFormatOf(name, text)!, text)!, ACS_1996).doc;
const files = (d: Doc): [string, string][] => {
  const mol = writeMolFile(d).text, v3 = writeMolFile(d, '', { v3000: true }).text, sdf = writeSdfFile(d).text;
  return [['a.mol', mol], ['b.mol', v3], ['a.sdf', sdf], ['a.ket', writeKetFile(d).text], ['a.mrv', writeMrvFile(d).text],
    ['foreign.mol', foreign(mol)], ['foreign-v3.mol', foreign(v3)], ['foreign.sdf', foreign(sdf)]];
};
const labels = (d: Doc) => [...d.atoms.values()].map((a) => a.label).filter(Boolean);

function failures(make: (label: string) => Doc, list: string[]): string[] {
  const bad: string[] = [];
  for (const label of list) {
    const d = make(label);
    const was = smilesOf(d);
    for (const [name, text] of files(d)) {
      let got: (string | null)[] = [];
      let now = '';
      try { const b = back(name, text); got = labels(b); now = smilesOf(b); } catch (e) { got = [String(e)]; }
      // (D and T come back as hydrogen with its mass, which the label box shows as D and T)
      const want = label === 'D' || label === 'T' ? [] : [label];
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${label} (${name}): ${JSON.stringify(got)}`);
      else if (now !== was) bad.push(`${label} (${name}): ${was} became ${now}`);
    }
  }
  return bad;
}

describe('every label comes back as itself', () => {
  it('each built-in abbreviation, bonded to a methyl group', () => {
    const bonded = (label: string) => {
      const d = new Doc();
      d.style = { ...ACS_1996 };
      d.bulk(() => { const c = d.addAtom(0, 0); const x = d.addAtom(L, 0, 6, { label }); d.addBond(c.id, x.id); });
      return d;
    };
    // (and the labels the second review found drawn out as atoms, F1b-R02)
    const reviewed = ['OR', 'NR2', 'CO2R', 'SiR3', 'NHR', 'COR', 'SR', 'CH2R', 'OPG', 'HetAr', 'OSEM', 'DMT'];
    // (charged groups: acetate's CO2-, methoxide's O-, methanesulfonate's SO3-, methanethiolate's S-, methylammonium's NH3+)
    const charged = ['CO2-', 'O-', 'SO3-', 'S-', 'NH3+'];
    expect(failures(bonded, [...new Set([...builtInNicknames().map(([n]) => n), ...reviewed, ...charged])])).toEqual([]);
  }, 600_000);
  it('each species name, and generic labels, on their own', () => {
    const alone = (label: string) => {
      const d = new Doc();
      d.style = { ...ACS_1996 };
      d.bulk(() => { d.addAtom(0, 0, 6, { label }); });
      return d;
    };
    const names = [...new Set(SPECIES_ENTRIES.flatMap((e) => e.names))];
    const reviewed = ['DCM', 'DCE', 'TEA', 'DIPEA', 'DBU', 'LDA', 'LiHMDS', 'DIBAL', 'NBS', 'NCS', 'NIS', 'TBAF', 'TFAA', 'HATU', 'EDC', 'DDQ', 'PCC', 'DMP', 'TEMPO', 'AIBN', 'MeI'];
    // counter-ions typed on an atom (review F1c-R01)
    const ions = ['Cl-', 'Br-', 'I-', 'F-', 'OH-', 'AcO-', 'BF4-', 'PF6-', 'TfO-', 'N3-', 'CN-', 'S2-', 'Na+', 'K+', 'NH4+'];
    expect(failures(alone, [...new Set([...names, ...reviewed, ...ions, 'R', 'X', 'R1', 'Ar', 'base', 'hν', 'Δ', 'cat.', 'Pd/C', 'Py'])])).toEqual([]);
  }, 600_000);
});

describe('D and T (review F1c-R02)', () => {
  it('a methyl\'s D or T comes back as hydrogen-2 or hydrogen-3 through every format', () => {
    const bonded = (label: string) => {
      const d = new Doc();
      d.style = { ...ACS_1996 };
      d.bulk(() => { const c = d.addAtom(0, 0); const x = d.addAtom(L, 0, 1, { label, isotope: label === 'D' ? 2 : 3 }); d.addBond(c.id, x.id); });
      return d;
    };
    expect(smilesOf(bonded('D'))).toBe('[2H]C');
    expect(smilesOf(bonded('T'))).toBe('[3H]C');
    expect(failures(bonded, ['D', 'T'])).toEqual([]);
  });
});

// review F1d-R02: a label whose charge is on the atom (the charge tool's PPh3 then +; every charged
// label of several atoms after a CDXML save and reopen). Values: methyltriphenylphosphonium and
// tetramethylammonium (PubChem CID 6380) cations, acetate (CID 175), methanesulfonate and chloride
// (CID 312) anions, as RDKit writes their SMILES.
describe('labels with their charge on the atom (review F1d-R02)', () => {
  const cases: [string, number, boolean, string][] = [
    ['PPh3', 1, true, 'C[P+](c1ccccc1)(c1ccccc1)c1ccccc1'],
    ['NMe3', 1, true, 'C[N+](C)(C)C'],
    ['CO2', -1, true, 'CC(=O)[O-]'],
    ['SO3', -1, true, 'CS(=O)(=O)[O-]'],
    ['AcO', -1, false, 'CC(=O)[O-]'],
    ['Cl', -1, false, '[Cl-]'],
  ];
  const make = (label: string, charge: number, bonded: boolean) => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => {
      const x = d.addAtom(L, 0, 6, { label, charge });
      if (bonded) d.addBond(d.addAtom(0, 0).id, x.id);
    });
    return d;
  };
  const charged = (d: Doc) => [...d.atoms.values()].filter((a) => a.label).map((a) => `${a.label} ${a.charge}`);
  for (const [label, charge, bonded, smiles] of cases) {
    it(`${bonded ? 'Me–' : ''}${label} ${charge > 0 ? '+' : '−'} keeps its charge through every format${bonded ? ', and through CDXML first' : ''}`, () => {
      const d = make(label, charge, bonded);
      expect(smilesOf(d)).toBe(smiles);
      // (a label on its own comes back from CDXML as text, or as the element, as ChemDraw's own
      // loose labels are read, so only a bonded label goes through CDXML first)
      const viaCdxml = readCdxml(writeCdxml(d, { name: 'x.cdxml' })).doc;
      viaCdxml.style = { ...ACS_1996 };
      for (const start of bonded ? [d, viaCdxml] : [d]) {
        for (const [name, text] of files(start)) {
          const b = back(name, text);
          expect(charged(b), name).toEqual([`${label} ${charge}`]);
          expect(smilesOf(b), name).toBe(smiles);
        }
      }
    });
  }
});

