// @vitest-environment jsdom
//
// Regression tests for the independent review of fix phase F1 (review-F1.md, F1-R01 to F1-R12, the
// 999-atom limit, and G1-07's map number). The file syntax follows BIOVIA's "CTfile Formats"
// (2020): chiral flag 1 = the wedges show the absolute configuration, 0 = only the relative one;
// V3000 aliases as "*" atoms in a one-atom SUP group; M  SDS EXP and ESTATE=E for groups shown
// expanded. Written files are also read with RDKit (an independent reader) and compared with
// published SMILES: N-methyl-p-toluenesulfonamide CNS(=O)(=O)c1ccc(C)cc1, N-methylacetamide
// CNC(C)=O, N-methylpropan-1-amine CCCNC and (S)-alanine C[C@H](N)C(=O)O (PubChem compound
// records under those names). Drawings are built here in code.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { addMolfile, readMolfile, readScene, sceneToDoc, writeKetFile, writeMolFile, writeMrvFile, writeSdfFile, chemFormatOf } from '../src/io/chem-formats';
import { parseSdf, readSdf, sdfText } from '../src/io/sheet-files';
import { toMolfile } from '../src/chem/molfile';
import { Doc, type Shape } from '../src/model';
import { ACS_1996 } from '../src/style';
import { takeFrameTexts, pictureSettings } from '../src/io/cdxml';
import { structureDoc } from '../src/sheet/structure-doc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });
const canon = (text: string): string | null => { const m = RDKit.get_mol(text); if (!m) return null; const s = m.get_smiles(); m.delete(); return s; };

const L = ACS_1996.bondLength;
const back = (name: string, text: string) => sceneToDoc(readScene(chemFormatOf(name, text)!, text)!, ACS_1996).doc;

/** CH3–NH–X with X a label. */
function methylAmine(label: string): Doc {
  const d = new Doc();
  d.style = { ...ACS_1996 };
  d.bulk(() => { const c = d.addAtom(0, 0); const n = d.addAtom(L, 0, 7); const x = d.addAtom(2 * L, 0, 6, { label }); d.addBond(c.id, n.id); d.addBond(n.id, x.id); });
  return d;
}
const files = (d: Doc): [string, string][] => [
  ['a.mol', writeMolFile(d).text], ['b.mol', writeMolFile(d, '', { v3000: true }).text], ['a.sdf', writeSdfFile(d).text], ['a.ket', writeKetFile(d).text], ['a.mrv', writeMrvFile(d).text],
];

describe('abbreviations that spell an element stay the abbreviation (F1-R01)', () => {
  for (const [label, smiles] of [['Ts', 'CNS(=O)(=O)c1ccc(C)cc1'], ['Ac', 'CNC(C)=O'], ['Pr', 'CCCNC']] as const) {
    it(`${label} through MOL V2000, V3000, SDF, KET and MRV, and pasted`, () => {
      const d = methylAmine(label);
      for (const [name, text] of files(d)) {
        const got = back(name, text);
        expect([...got.atoms.values()].map((a) => a.label).filter(Boolean), name).toEqual([label]);
        expect([...got.atoms.values()].every((a) => a.z < 50), name).toBe(true);
      }
      const p = new Doc();
      p.style = { ...ACS_1996 };
      p.bulk(() => { addMolfile(p, writeMolFile(d).text, 0, 0); });
      expect([...p.atoms.values()].map((a) => a.label).filter(Boolean)).toEqual([label]);
      // and other programs read the group's atoms (F1-R09)
      expect(canon(writeMolFile(d).text)).toBe(canon(smiles));
      expect(canon(writeMolFile(d, '', { v3000: true }).text)).toBe(canon(smiles));
    });
  }
});

describe('a label kept as an alias (F1-R06)', () => {
  it('goes to V3000 as a "*" atom in a one-atom SUP group, which RDKit reads, and comes back as the label', () => {
    const d = methylAmine('Ar');
    const v3 = writeMolFile(d, '', { v3000: true }).text;
    expect(v3).toMatch(/M {2}V30 3 \* /);
    expect(v3).toMatch(/SUP 0 ATOMS=\(1 3\).*LABEL=Ar/);
    const s = canon(v3);
    expect(s).not.toBeNull();
    expect(s).not.toContain('Ar');
    for (const [name, text] of [['b.mol', v3], ['a.mol', writeMolFile(d).text]]) {
      const got = back(name, text);
      expect([...got.atoms.values()].find((a) => a.label === 'Ar'), name).toBeDefined();
      expect([...got.atoms.values()].some((a) => a.z === 18), name).toBe(false);
    }
  });
});

describe('superatom groups from other programs (F1-R04)', () => {
  // ethanol with its atoms in a SUP group "EtOH" (CH3 0 0, CH2 1 0, O 2 0), hand-written to the V2000 layout
  const ethanol = (extra: string, label = 'EtOH') => `ethanol\n  test\n\n  3  2  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    2.5981    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  2  3  1  0
M  STY  1   1 SUP
M  SAL   1  3   1   2   3
M  SMT   1 ${label}
${extra}M  END`;
  it('keeps the atoms of a group the file shows expanded (M  SDS EXP)', () => {
    expect(readMolfile(ethanol('M  SDS EXP  1   1\n'))!.atoms.map((a) => a.sym)).toEqual(['C', 'C', 'O']);
  });
  it('keeps the atoms of a group whose label stands for other atoms here, or none', () => {
    expect(readMolfile(ethanol('', 'Linker-A'))!.atoms.map((a) => a.sym)).toEqual(['C', 'C', 'O']);
  });
});

/** (S)-alanine drawn with a hashed wedge to its methyl, with a chiral flag shape (or none). */
function alanine(flag?: 'Absolute' | 'Racemic' | 'Relative'): Doc {
  const d = new Doc();
  d.style = { ...ACS_1996 };
  d.bulk(() => {
    const ca = d.addAtom(0, 0), me = d.addAtom(-L * 0.87, L / 2), n = d.addAtom(0, -L, 7), c = d.addAtom(L * 0.87, L / 2), o1 = d.addAtom(L * 1.73, 0, 8), o2 = d.addAtom(L * 0.87, L * 1.5, 8);
    d.addBond(ca.id, me.id, 1, 'hashWedge'); d.addBond(ca.id, n.id); d.addBond(ca.id, c.id); d.addBond(c.id, o1.id, 2); d.addBond(c.id, o2.id);
    if (flag) d.addShape({ kind: 'symbol', symbol: flag, x1: L, y1: L * 2, x2: L * 2, y2: L * 2.8 });
  });
  return d;
}
const flagOf = (mol: string) => (mol.includes('V3000') ? /COUNTS \d+ \d+ \d+ \d+ (\d)/.exec(mol)![1] : mol.split('\n')[3].slice(12, 15).trim());

describe('the chiral flag (F1-R02, F1-R08)', () => {
  it('is 1 only with an Abs flag drawn; 0 for wedges alone, Rac and Rel', () => {
    expect(flagOf(writeMolFile(alanine('Absolute')).text)).toBe('1');
    expect(flagOf(writeMolFile(alanine()).text)).toBe('0');
    expect(flagOf(writeMolFile(alanine('Racemic')).text)).toBe('0');
    expect(flagOf(writeMolFile(alanine('Relative')).text)).toBe('0');
  });
  it('puts a Rac structure\'s wedged centre in an and group, and a Rel one\'s in an or group, in V3000', () => {
    expect(writeMolFile(alanine('Racemic'), '', { v3000: true }).text).toMatch(/MDLV30\/STERAC1 ATOMS=\(1 1\)/);
    expect(writeMolFile(alanine('Relative'), '', { v3000: true }).text).toMatch(/MDLV30\/STEREL1 ATOMS=\(1 1\)/);
  });
  it('comes back as an Abs flag when the file says 1, so saving again keeps 1', () => {
    const text = writeMolFile(alanine('Absolute')).text;
    const d = back('a.mol', text);
    expect([...d.shapes.values()].filter((s: Shape) => s.symbol === 'Absolute')).toHaveLength(1);
    expect(flagOf(writeMolFile(d).text)).toBe('1');
    // pasted, too
    const p = new Doc();
    p.style = { ...ACS_1996 };
    p.bulk(() => { addMolfile(p, text, 0, 0); });
    expect([...p.shapes.values()].some((s) => s.symbol === 'Absolute')).toBe(true);
    // and RDKit reads the stereocentre as drawn
    expect(canon(text)).toBe(canon('C[C@H](N)C(=O)O'));
  });
  it('a file with flag 0 and wedges (as RDKit writes) is saved with 0 again', () => {
    const rd = RDKit.get_mol('C[C@H](N)C(=O)O');
    const mb = rd.get_molblock();
    rd.delete();
    expect(flagOf(mb)).toBe('0');
    const d = back('a.mol', mb);
    expect([...d.shapes.values()].some((s) => s.symbol)).toBe(false);
    expect(flagOf(writeMolFile(d).text)).toBe('0');
  });
  it('an abs mark goes through V2000 as flag 1 and comes back as the Abs flag', () => {
    const d = alanine();
    d.bulk(() => { const ca = [...d.atoms.values()][0]; d.updateAtom(ca.id, { enhStereo: { type: 'abs' } }); });
    const text = writeMolFile(d).text;
    expect(flagOf(text)).toBe('1');
    expect([...back('a.mol', text).shapes.values()].some((s) => s.symbol === 'Absolute')).toBe(true);
  });
});

describe('molfiles with more than 999 atoms', () => {
  it('are written as V3000, which can count them, with the reason given', () => {
    const d = new Doc();
    d.bulk(() => { let prev = d.addAtom(0, 0); for (let i = 1; i < 1000; i++) { const a = d.addAtom(i * L, (i % 2) * L / 2); d.addBond(prev.id, a.id); prev = a; } });
    const files = toMolfile(d, d.atoms.keys(), '', { files: true });
    expect(files.molblock).toContain('V3000');
    expect(files.v3000Because).toMatch(/999/);
    expect(toMolfile(d, d.atoms.keys(), '').molblock).toContain('V3000');
    expect(readMolfile(files.molblock)!.atoms).toHaveLength(1000);
  });
});

describe('an SD record whose map number was changed (G1-07, F1-R05)', () => {
  it('is written afresh, with the new number', () => {
    const rec = `ethanol\n  test\n\n  3  2  0  0  0  0  0  0  0  0999 V2000
   -0.8883    0.4022    0.1234 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.4723   -0.0200   -0.3311 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.3780   -0.3822    0.6610 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0
  2  3  1  0
M  END`;
    const { book } = readSdf(`${rec}\n$$$$\n`, 'c');
    const s = book.sheet;
    const st = s.cell(1, 0)!.structure!;
    const d = structureDoc(st.contents, book.drawingStyle);
    d.bulk(() => { const o = [...d.atoms.values()].find((a) => a.z === 8)!; d.updateAtom(o.id, { mapNo: 5 }); });
    book.build(() => { s.setStructure(1, 0, d.contents(), st.source); });
    const out = parseSdf(sdfText(s, book.drawingStyle))[0].molblock;
    expect(out).not.toBe(rec);
    expect(readMolfile(out)!.atoms.find((a) => a.sym === 'O')!.map).toBe(5);
  });
});

describe('frame texts and picture settings (F1-R11, F1-R12)', () => {
  it('a changed lane label goes into the label, never into a setting that equals it', () => {
    const d = new Doc();
    let id = 0;
    d.bulk(() => {
      const c = d.addCaption({ x: 0, y: 0, runs: [{ text: 'pencil2' }], justify: 'left' });
      id = d.addShape({ kind: 'geo', geo: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, frame: { atoms: [], captions: [c.id], arrows: [], shapes: [], padX: 0, padY: 0, fit: false },
        plate: { kind: 'tlc', look: 'pencil', lanes: [{ label: 'pencil', marks: '0.5' }], w: 10, h: 10, rf: false, lines: false, labels: true, note: '', unit: 'bp', sizes: false } } as never).id;
    });
    d.bulk(() => { expect(takeFrameTexts(d, d.shapes.get(id)!, ['pencil'])).toBe(true); });
    const p = d.shapes.get(id)!.plate!;
    expect(p.lanes[0].label).toBe('pencil2');
    expect(p.look).toBe('pencil');
  });
  it('a picture tag\'s fields are taken only with the right types', () => {
    expect(pictureSettings({ look: { line: 'x', round: 3, shadow: 'soft' }, transparency: '0.5', name: 7, hidden: 'yes', locked: true, link: 'https://example.org/' }))
      .toEqual({ look: { round: 0.5, shadow: 'soft' }, locked: true, link: 'https://example.org/' });
  });
});
