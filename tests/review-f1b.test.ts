// @vitest-environment jsdom
//
// Regression tests for the second review of fix phase F1 (review-F1b.md). The chiral flag
// follows BIOVIA's "CTfile Formats" (2020): 1 = the wedges show the absolute configuration,
// 0 = only the relative one; V3000 STERACn for a racemic centre. Structure: (S)-alanine,
// C[C@H](N)C(=O)O (PubChem CID 5950), drawn here in code; read back with RDKit.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { addMolfile, writeMolFile } from '../src/io/chem-formats';
import { toMolfile } from '../src/chem/molfile';
import { addChiralFlag, flagsByAtom, structureFlag, type ChiralFlag } from '../src/chem/chiral-flag';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const L = ACS_1996.bondLength;
const flagOf = (mol: string) => (mol.includes('V3000') ? /COUNTS \d+ \d+ \d+ \d+ (\d)/.exec(mol)![1] : mol.split('\n')[3].slice(12, 15).trim());

/** (S)-alanine at (x, y), with a chiral flag put where Chemistry > Chiral Flag puts it; its atom ids. */
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
const newDoc = () => { const d = new Doc(); d.style = { ...ACS_1996 }; return d; };

describe('each chiral flag belongs to its own structure (F1b-R01)', () => {
  it('a Rac structure beside an Abs one: each written with its own flag', () => {
    const d = newDoc();
    const rac = alanineAt(d, 0, 0, 'Racemic');
    // the second structure's left edge 0.9 bond lengths from the first's right edge
    const abs = alanineAt(d, L * 0.87 + L * 1.73 + L * 0.9, 0, 'Absolute');
    expect(flagOf(toMolfile(d, rac, '', { files: true }).molblock)).toBe('0');
    expect(flagOf(toMolfile(d, abs, '', { files: true }).molblock)).toBe('1');
    expect(toMolfile(d, rac, '', { files: true, v3000: true }).molblock).toMatch(/STERAC1/);
    expect(toMolfile(d, abs, '', { files: true, v3000: true }).molblock).not.toMatch(/STERAC/);
    // the whole drawing in one V3000 file: only the Rac structure's centre is racemic
    const both = toMolfile(d, [...rac, ...abs], '', { files: true, v3000: true }).molblock;
    expect(both.match(/MDLV30\/STERAC\d+ ATOMS=\(1 (\d+)\)/g)).toEqual(['MDLV30/STERAC1 ATOMS=(1 1)']);
    // and RDKit reads the Abs structure's centre as drawn
    const m = RDKit.get_mol(toMolfile(d, abs, '', { files: true }).molblock);
    expect(m.get_smiles()).toBe(RDKit.get_mol('C[C@H](N)C(=O)O').get_smiles());
    m.delete();
  });
  it('an unflagged structure just under another structure\'s Abs flag stays unflagged', () => {
    const d = newDoc();
    const top = alanineAt(d, 0, 0, 'Absolute');
    const flag = [...d.shapes.values()][0];
    // the second structure's top atom 0.4 bond lengths below the flag
    const below = alanineAt(d, 0, flag.y2 + L * 0.4 + L);
    expect(flagOf(toMolfile(d, top, '', { files: true }).molblock)).toBe('1');
    expect(flagOf(toMolfile(d, below, '', { files: true }).molblock)).toBe('0');
    expect(structureFlag(d, below)).toBeUndefined();
  });
  it('keeps each structure\'s flag through CDXML (inside its fragment, as ChemDraw keeps it)', () => {
    const d = newDoc();
    alanineAt(d, 0, 0, 'Racemic');
    alanineAt(d, L * 3.5, 0, 'Absolute');
    const back = readCdxml(writeCdxml(d, { name: 'x.cdxml' })).doc;
    const flags = new Set([...flagsByAtom(back, back.atoms.keys()).values()].map((f) => `${f.frag}:${f.flag}`));
    expect([...flags].map((f) => f.split(':')[1]).sort()).toEqual(['Absolute', 'Racemic']);
    expect([...back.shapes.values()].every((s) => s.pin?.on === 'atom')).toBe(true);
  });
});

describe('a pasted Abs flag goes with its structure (F1b-R04)', () => {
  it('moved after pasting (as Paste reaction does), the flag is still beside it and the file says 1', () => {
    const src = newDoc();
    alanineAt(src, 0, 0, 'Absolute');
    const mb = writeMolFile(src).text;
    expect(flagOf(mb)).toBe('1');
    const d = newDoc();
    let ids: number[] = [];
    d.edit('Paste reaction', () => {
      ids = addMolfile(d, mb, 0, 0);
      d.moveAtoms(ids, 400, 300);
    });
    const flag = [...d.shapes.values()].find((s) => s.symbol === 'Absolute')!;
    const atoms = ids.map((id) => d.atoms.get(id)!);
    expect(flag.x1).toBeGreaterThan(Math.min(...atoms.map((a) => a.x)));
    expect(flag.y1).toBeGreaterThan(Math.max(...atoms.map((a) => a.y)));
    expect(flag.y1 - Math.max(...atoms.map((a) => a.y))).toBeLessThan(L * 2);
    expect(structureFlag(d, ids)?.id).toBe(flag.id);
    expect(flagOf(toMolfile(d, ids, '', { files: true }).molblock)).toBe('1');
  });
});
