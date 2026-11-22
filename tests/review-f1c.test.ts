// @vitest-environment jsdom
//
// Regression tests for the third review of fix phase F1 (review-F1c.md).
// - V3000 values ending in "-" are written in double quotes (BIOVIA CTfile Formats 2020, V3000:
//   a line ending in "-" goes on to the next; a value with blanks or such an ending is quoted).
//   Chemistry checked with RDKit: methylammonium chloride C[NH3+].[Cl-] (PubChem CID 67939).
// - A molfile's chiral flag is the whole file's (CTfile: 1 = the wedges show the absolute
//   configuration). Structure: (S)-alanine C[C@H](N)C(=O)O (PubChem CID 5950), drawn in code.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { addMolfile, readScene, sceneToDoc, chemFormatOf, writeMolFile, writeSdfFile, writeMrvFile } from '../src/io/chem-formats';
import { toMolfile } from '../src/chem/molfile';
import { addChiralFlag, structureFlag, type ChiralFlag } from '../src/chem/chiral-flag';
import { Doc, type Shape } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { ACS_1996 } from '../src/style';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const L = ACS_1996.bondLength;
const newDoc = () => { const d = new Doc(); d.style = { ...ACS_1996 }; return d; };
const open = (name: string, text: string) => sceneToDoc(readScene(chemFormatOf(name, text)!, text)!, ACS_1996).doc;
const smiles = (mb: string) => { const m = RDKit.get_mol(mb); try { return m ? m.get_smiles() : ''; } finally { m?.delete(); } };
const flagOf = (mol: string) => (mol.includes('V3000') ? /COUNTS \d+ \d+ \d+ \d+ (\d)/.exec(mol)![1] : mol.split('\n')[3].slice(12, 15).trim());

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
/** Each structure's flag in a drawing, left to right. */
const flagsLeftToRight = (d: Doc) => {
  const seen = new Set<number>();
  const out: (string | null)[] = [];
  for (const a of [...d.atoms.values()].sort((p, q) => p.x - q.x)) {
    const f = d.fragmentOf(a.id);
    const k = Math.min(...f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(structureFlag(d, f)?.symbol ?? null);
  }
  return out;
};

describe('a label ending in "-" (F1c-R01)', () => {
  const salt = () => {
    const d = newDoc();
    d.bulk(() => { const c = d.addAtom(0, 0), n = d.addAtom(L, 0, 7, { charge: 1 }); d.addBond(c.id, n.id); d.addAtom(3 * L, 0, 17, { label: 'Cl-' }); });
    return d;
  };
  it('is quoted in V3000 and comes back as Cl- with the chloride', () => {
    const v3 = writeMolFile(salt(), '', { v3000: true }).text;
    expect(v3).toMatch(/LABEL="Cl-"/);
    expect(smiles(v3)).toBe('C[NH3+].[Cl-]');
    for (const [name, text] of [['a.mol', v3], ['a.sdf', writeSdfFile(salt()).text], ['a.mrv', writeMrvFile(salt()).text]]) {
      const back = open(name, text);
      expect([...back.atoms.values()].map((a) => a.label).filter(Boolean), name).toEqual(['Cl-']);
      expect(smiles(writeMolFile(back).text), name).toBe('C[NH3+].[Cl-]');
    }
    // the SD file's V2000 superatom label (M  SMT) is the label itself
    expect(writeSdfFile(salt()).text).toMatch(/M {2}SMT {3}1 Cl-$/m);
  });
  it('reads LABEL=Cl- left unquoted by another writer, and still joins lines broken at 80 characters', () => {
    const mb = ['', '  RDKit          2D', '', '  0  0  0     0  0            999 V3000', 'M  V30 BEGIN CTAB', 'M  V30 COUNTS 1 0 1 0 0', 'M  V30 BEGIN ATOM',
      'M  V30 1 Cl 0 0 0 0 CHG=-1', 'M  V30 END ATOM', 'M  V30 BEGIN SGROUP', 'M  V30 1 SUP 0 ATOMS=(1 1) LABEL=Cl-', 'M  V30 END SGROUP', 'M  V30 END CTAB', 'M  END', ''].join('\n');
    expect([...open('x.mol', mb).atoms.values()].map((a) => a.label)).toEqual(['Cl-']);
    // a value broken across lines by the 80-character rule
    // (in a file of this program's, where every group is a label drawn here)
    const long = mb.replace('  RDKit   ', '  Chemweav').replace('M  V30 1 SUP 0 ATOMS=(1 1) LABEL=Cl-', `M  V30 1 SUP 0 ATOMS=(1 1) LABEL="${'x'.repeat(42)}-\nM  V30 y"`);
    expect([...open('x.mol', long).atoms.values()].map((a) => a.label)).toEqual([`${'x'.repeat(42)}y`]);
  });
});

describe('several structures in one molfile and its one chiral flag (F1c-R03)', () => {
  it('two Abs structures: both come back with their own Abs flag, and SD records say 1 and 1', () => {
    const d = newDoc();
    alanineAt(d, 0, 0, 'Absolute');
    alanineAt(d, 5 * L, 0, 'Absolute');
    const mol = writeMolFile(d).text;
    expect(flagOf(mol)).toBe('1');
    const back = open('a.mol', mol);
    expect(flagsLeftToRight(back)).toEqual(['Absolute', 'Absolute']);
    const sd = writeSdfFile(back).text.split('$$$$\n').filter((r) => r.trim());
    expect(sd.map(flagOf)).toEqual(['1', '1']);
    // pasted (addMolfile) the same
    const p = newDoc();
    p.bulk(() => { addMolfile(p, mol, 0, 0); });
    expect(flagsLeftToRight(p)).toEqual(['Absolute', 'Absolute']);
  });
  it('an Abs structure beside an unflagged wedged one: written as V3000 so the second stays relative, and each comes back as drawn', () => {
    const d = newDoc();
    const abs = alanineAt(d, 0, 0, 'Absolute');
    alanineAt(d, 5 * L, 0);
    const w = writeMolFile(d);
    expect(w.text).toMatch(/V3000/);
    expect(w.notes).toEqual(['written as V3000, since V2000 can\'t hold structures with and without an Abs chiral flag']);
    expect(flagOf(w.text)).toBe('1');
    // only the unflagged structure's centre (atom 7, the first of the second alanine) is in an or group
    expect(w.text).toMatch(/MDLV30\/STEREL1 ATOMS=\(1 7\)/);
    expect(w.text).not.toMatch(/STEREL1 ATOMS=\(\d+ 1\b/);
    const back = open('a.mol', w.text);
    expect(flagsLeftToRight(back)).toEqual(['Absolute', null]);
    expect([...back.atoms.values()].filter((a) => a.enhStereo).map((a) => a.enhStereo)).toEqual([{ type: 'or', group: 1 }]);
    // the Abs structure alone is still plain V2000 with 1
    expect(flagOf(toMolfile(d, abs, '', { files: true }).molblock)).toBe('1');
  });
});

describe('the V3000 save note (F1c-R08)', () => {
  it('reads as a sentence', () => {
    const d = newDoc();
    alanineAt(d, 0, 0, 'Racemic');
    expect(writeMolFile(d).notes).toEqual(['written as V3000, since V2000 can\'t hold a Rac or Rel chiral flag']);
  });
});

describe('a chiral flag stuck to nothing, moved or orphaned (F1c-R07)', () => {
  const flagShape = (d: Doc) => [...d.shapes.values()].find((x) => x.symbol)!;
  const move = (d: Doc, s: Shape, dx: number, dy: number) => d.edit('Move', () => { d.updateShape(s.id, { x1: s.x1 + dx, x2: s.x2 + dx, y1: s.y1 + dy, y2: s.y2 + dy }); });
  it('dragged beside another structure, it becomes that structure\'s and goes where it goes', () => {
    const d = newDoc();
    const left = alanineAt(d, 0, 0, 'Absolute');
    const right = alanineAt(d, 6 * L, 0);
    move(d, flagShape(d), 6 * L, 0);
    expect(flagShape(d).pin?.ref[0] !== undefined && right.includes(flagShape(d).pin!.ref[0])).toBe(true);
    d.edit('Move', () => { d.moveAtoms(right, 0, 3 * L); });
    expect(structureFlag(d, right)?.symbol).toBe('Absolute');
    expect(structureFlag(d, left)).toBeUndefined();
    expect(flagOf(toMolfile(d, right, '', { files: true }).molblock)).toBe('1');
    expect(flagOf(toMolfile(d, left, '', { files: true }).molblock)).toBe('0');
  });
  it('goes with its structure when the whole of it is deleted, so an unflagged neighbour stays 0', () => {
    const d = newDoc();
    const a = alanineAt(d, 0, 0, 'Absolute');
    const b = alanineAt(d, 3.2 * L, 0);
    d.edit('Delete', () => { for (const id of a) d.removeAtom(id); });
    expect([...d.shapes.values()].filter((x) => x.symbol)).toEqual([]);
    expect(flagOf(toMolfile(d, b, '', { files: true }).molblock)).toBe('0');
  });
  it('stays with what is left of its structure when its own atom is deleted', () => {
    const d = newDoc();
    const a = alanineAt(d, 0, 0, 'Absolute');
    alanineAt(d, 3.2 * L, 0);
    const held = flagShape(d).pin!.ref[0];
    d.edit('Delete', () => { d.removeAtom(held); });
    const rest = a.filter((id) => d.atoms.has(id));
    expect(rest.includes(flagShape(d).pin!.ref[0])).toBe(true);
  });
  it('a flag outside any fragment in a CDXML file is stuck to its structure on opening', () => {
    const d = newDoc();
    const a = alanineAt(d, 0, 0, 'Absolute');
    d.edit('Loose', () => { d.updateShape(flagShape(d).id, { pin: undefined }); });
    const back = readCdxml(writeCdxml(d, { name: 'x.cdxml' })).doc;
    const f = [...back.shapes.values()].find((x) => x.symbol)!;
    expect(f.pin?.on).toBe('atom');
    expect(structureFlag(back, back.fragmentOf(f.pin!.ref[0]))?.symbol).toBe('Absolute');
    expect(back.fragmentOf(f.pin!.ref[0]).size).toBe(a.length);
  });
});

describe('an SD file of many flagged structures (F1c-R12)', () => {
  it('works each structure\'s flag out once for the file, not once a record', () => {
    const d = newDoc();
    for (let i = 0; i < 300; i++) alanineAt(d, (i % 20) * 5 * L, Math.floor(i / 20) * 5 * L, 'Absolute');
    writeMolFile(d); writeSdfFile(d);
    let t = performance.now();
    const mol = writeMolFile(d).text;
    const one = performance.now() - t;
    t = performance.now();
    const sd = writeSdfFile(d).text;
    const many = performance.now() - t;
    expect(flagOf(mol)).toBe('1');
    expect(sd.split('$$$$\n').filter((r) => r.trim()).map(flagOf).every((f) => f === '1')).toBe(true);
    // (measured in the review: 0.47 s against 0.05 s, growing with the square of the count)
    expect(many).toBeLessThan(Math.max(4 * one, 200));
  }, 60_000);
});

