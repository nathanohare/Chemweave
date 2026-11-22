// @vitest-environment jsdom
//
// One molfile reader (audit G1-06): the same molfiles pasted (addMolfile), opened in Spreadsheet
// from an SD file (molblockContents) and opened with File > Open (readScene + sceneToDoc) give the
// same atoms, labels and bonds. And an SD file opened in Spreadsheet and saved unchanged keeps each
// record as it was (G1-07). The molfiles are written here by hand to BIOVIA's "CTfile Formats"
// (2020); the 3-D ethanol coordinates are made up for the test (only their survival is checked).

import { describe, it, expect } from 'vitest';
import { addMolfile, readScene, sceneToDoc } from '../src/io/chem-formats';
import { molblockContents, parseSdf, readSdf, sdfText } from '../src/io/sheet-files';
import { Doc, type Contents } from '../src/model';
import { ACS_1996 } from '../src/style';

// toluene drawn with its methyl written out as an abbreviation (Me), an alias (Xyz) on a ring atom,
// an R group R1 and the old charge column on a nitrogen (3 = +1)
const V2000 = `toluene
  test

 10 10  0  0  0  0  0  0  0  0999 V2000
    0.0000    1.5000    0.0000 C   0  0
    1.2990    0.7500    0.0000 C   0  0
    1.2990   -0.7500    0.0000 C   0  0
    0.0000   -1.5000    0.0000 C   0  0
   -1.2990   -0.7500    0.0000 C   0  0
   -1.2990    0.7500    0.0000 *   0  0
    0.0000    3.0000    0.0000 C   0  0
    0.0000    3.5000    0.0000 H   0  0
    2.5981    1.5000    0.0000 R#  0  0
    2.5981   -1.5000    0.0000 N   0  3
  1  2  2  0
  2  3  1  0
  3  4  2  0
  4  5  1  0
  5  6  2  0
  6  1  1  0
  1  7  1  0
  7  8  1  0
  2  9  1  0
  3 10  1  0
A    6
Xyz
M  RGP  1   9   1
M  STY  1   1 SUP
M  SAL   1  2   7   8
M  SMT   1 Me
M  END`;

// the same as V3000, with a coordination bond (type 9) to a copper on the nitrogen and an
// "or" stereo group, which only V3000 can hold
const V3000 = `toluene
  test

  0  0  0     0  0            999 V3000
M  V30 BEGIN CTAB
M  V30 COUNTS 11 11 1 0 0
M  V30 BEGIN ATOM
M  V30 1 C 0 1.5 0 0
M  V30 2 C 1.299 0.75 0 0
M  V30 3 C 1.299 -0.75 0 0
M  V30 4 C 0 -1.5 0 0
M  V30 5 C -1.299 -0.75 0 0
M  V30 6 Xyz -1.299 0.75 0 0
M  V30 7 C 0 3 0 0
M  V30 8 H 0 3.5 0 0
M  V30 9 R# 2.598 1.5 0 0 RGROUPS=(1 1)
M  V30 10 N 2.598 -1.5 0 0 CHG=1
M  V30 11 Cu 3.9 -2.25 0 0
M  V30 END ATOM
M  V30 BEGIN BOND
M  V30 1 2 1 2
M  V30 2 1 2 3
M  V30 3 2 3 4
M  V30 4 1 4 5
M  V30 5 2 5 6
M  V30 6 1 6 1
M  V30 7 1 1 7
M  V30 8 1 7 8
M  V30 9 1 2 9
M  V30 10 1 3 10
M  V30 11 9 10 11
M  V30 END BOND
M  V30 BEGIN SGROUP
M  V30 1 SUP 0 ATOMS=(2 7 8) XBONDS=(1 7) LABEL=Me
M  V30 END SGROUP
M  V30 BEGIN COLLECTION
M  V30 MDLV30/STEREL1 ATOMS=(1 2)
M  V30 END COLLECTION
M  V30 END CTAB
M  END`;

/** What a drawing holds, in a form that doesn't depend on ids or places. */
type A = { z: number; label: string | null; charge: number; enhStereo?: unknown };
type B = { order: number; display: string };
function summary(c: { atoms: Iterable<A> | Map<number, A>; bonds: Iterable<B> | Map<number, B> }): string {
  const vals = <T,>(x: Iterable<T> | Map<number, T>) => (x instanceof Map ? [...x.values()] : [...x]);
  const atoms = vals(c.atoms).map((a) => `${a.label ?? a.z}${a.charge ? `(${a.charge})` : ''}${a.enhStereo ? JSON.stringify(a.enhStereo) : ''}`).sort();
  const bonds = vals(c.bonds).map((b) => `${b.order}${b.display}`).sort();
  return atoms.join(' ') + ' | ' + bonds.join(' ');
}

function pasted(mb: string): Doc {
  const d = new Doc();
  d.style = { ...ACS_1996 };
  d.bulk(() => { addMolfile(d, mb, 0, 0); });
  return d;
}

describe('one molfile reader for paste, Spreadsheet SD files and File > Open (G1-06)', () => {
  for (const [name, mb] of [['V2000', V2000], ['V3000', V3000]] as const) {
    it(`reads the ${name} molfile the same way on all three paths`, () => {
      const open = sceneToDoc(readScene('mol', mb)!, ACS_1996).doc;
      const paste = pasted(mb);
      const sheet = molblockContents(mb, ACS_1996) as Contents;
      expect(summary(paste)).toBe(summary(open));
      expect(summary({ atoms: sheet.atoms, bonds: sheet.bonds })).toBe(summary(open));
      // the abbreviation, alias, R group and charge, as written
      const labels = [...paste.atoms.values()].map((a) => a.label).filter(Boolean).sort();
      expect(labels).toEqual(['Me', 'R1', 'Xyz']);
      expect(paste.atoms.size).toBe(name === 'V2000' ? 9 : 10);
      expect([...paste.atoms.values()].find((a) => a.z === 7)?.charge).toBe(1);
    });
  }

  it('reads a coordination bond as a dative bond and an or group as enhanced stereo when pasted', () => {
    const d = pasted(V3000);
    expect([...d.bonds.values()].filter((b) => b.display === 'dative')).toHaveLength(1);
    expect([...d.atoms.values()].filter((a) => a.enhStereo).map((a) => a.enhStereo)).toEqual([{ type: 'or', group: 1 }]);
  });
});

// ethanol as a 3-D record (an RDKit-style header), with a data item and a superatom group
const ETHANOL_3D = `ethanol
     RDKit          3D

  3  2  0  0  0  0  0  0  0  0999 V2000
   -0.8883    0.4022    0.1234 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.4723   -0.0200   -0.3311 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.3780   -0.3822    0.6610 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  2  3  1  0
M  STY  1   1 DAT
M  SAL   1  1   3
M  END`;

const SDF = `${ETHANOL_3D}\n> <Yield>\n85%\n\n$$$$\n`;

describe('Spreadsheet SD files saved unchanged keep each record (G1-07)', () => {
  it('writes an unchanged record back as it was read: 3-D coordinates, header and S-groups', () => {
    const { book } = readSdf(SDF, 'compounds');
    const out = sdfText(book.sheet, book.drawingStyle);
    const recs = parseSdf(out);
    expect(recs).toHaveLength(1);
    expect(recs[0].molblock).toBe(ETHANOL_3D);
    expect(recs[0].data).toEqual([['Yield', '85%']]);
  });

  it('writes a record afresh once its drawing has changed', () => {
    const { book } = readSdf(SDF, 'compounds');
    const s = book.sheet;
    const st = s.cell(1, 0)!.structure!;
    // add a methyl to the oxygen: another drawing
    const d = new Doc();
    d.style = { ...book.drawingStyle };
    d.restoreContents(st.contents);
    d.bulk(() => { const o = [...d.atoms.values()].find((a) => a.z === 8)!; const c = d.addAtom(o.x + 14, o.y, 6); d.addBond(o.id, c.id); });
    book.build(() => { s.setStructure(1, 0, d.contents()); });
    const recs = parseSdf(sdfText(s, book.drawingStyle));
    expect(recs[0].molblock).not.toBe(ETHANOL_3D);
    expect(recs[0].molblock.split('\n')[1].slice(2, 11)).toBe('Chemweave');
    expect(recs[0].molblock.split('\n')[3].slice(0, 6)).toBe('  4  3');
  });

  it('keeps the record through a copy of the cell (the structure keeps its source)', () => {
    const { book } = readSdf(SDF, 'compounds');
    const st = book.sheet.cell(1, 0)!.structure!;
    expect(st.source?.molblock).toBe(ETHANOL_3D);
  });
});
