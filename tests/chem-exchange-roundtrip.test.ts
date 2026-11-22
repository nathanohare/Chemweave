// @vitest-environment jsdom
//
// One drawing with what exchange files must keep (R1, an alias label, abbreviations, a dative
// bond, an "and" stereocentre, an isotope, a map number, a radical and a charge) through MOL
// V2000/V3000, SDF, MRV, KET, CML and ChemDoodle JSON and back (the audit's G1-01 to G1-05,
// G1-19, G1-21, G1-24). File syntax follows BIOVIA's "CTfile Formats" (2020), ChemAxon's Marvin
// Documents format and EPAM Ketcher's KET schema; the expected group sizes are from the groups'
// formulas: methoxy OCH3 (2 heavy atoms), tert-butoxycarbonyl C(=O)OC(CH3)3, C5H9O2 (7 heavy
// atoms) (IUPAC Recommendations 2013, P-65.6.3.2.1 and P-65.6.3.3).

import { describe, it, expect } from 'vitest';
import {
  chemFormatOf, readMolfile, readScene, sceneToDoc,
  writeMolFile, writeSdfFile, writeMrvFile, writeKetFile, writeCmlFile, writeChemDoodleJson, writeRxnFile,
} from '../src/io/chem-formats';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';
import { toMolfile } from '../src/chem/molfile';

const L = ACS_1996.bondLength;

/**
 * A stereocentre (map 2, in "and" group 1) with R1, OMe and CO2tBu on it and a wedge to a 13C
 * methyl; Xyz on a CH2 radical cation chain; Me3P→Fe–CH3 with the P–Fe bond drawn dative.
 */
function sample(): Doc {
  const d = new Doc();
  d.style = { ...ACS_1996 };
  d.bulk(() => {
    const c = d.addAtom(0, 0, 6, { mapNo: 2 });
    d.updateAtom(c.id, { enhStereo: { type: 'and', group: 1 } });
    const r1 = d.addAtom(-L * 0.87, -L * 0.5, 6, { label: 'R1' });
    const ome = d.addAtom(L * 0.87, -L * 0.5, 6, { label: 'OMe' });
    const boc = d.addAtom(0, L, 6, { label: 'CO2tBu' });
    const me = d.addAtom(L * 0.6, L * 0.6, 6, { isotope: 13 });
    d.addBond(c.id, r1.id); d.addBond(c.id, ome.id); d.addBond(c.id, boc.id);
    d.addBond(c.id, me.id, 1, 'wedge');
    // a separate chain: Xyz–CH2(•)–N⁺H3
    const x = d.addAtom(L * 5, 0, 6, { label: 'Xyz' });
    const ch = d.addAtom(L * 5.87, -L * 0.5, 6, { radical: 'doublet' });
    const n = d.addAtom(L * 6.74, 0, 7, { charge: 1 });
    d.addBond(x.id, ch.id); d.addBond(ch.id, n.id);
    // trimethylphosphine on iron, with a methyl on the iron
    const fe = d.addAtom(L * 10, 0, 26);
    const p = d.addAtom(L * 11, 0, 15);
    const m1 = d.addAtom(L * 9, 0, 6);
    d.addBond(p.id, fe.id, 1, 'dative');
    d.addBond(m1.id, fe.id);
    for (const [dx, dy] of [[1, 1], [1, -1], [1.7, 0]]) { const q = d.addAtom(L * (11 + dx * 0.6), L * dy * 0.6, 6); d.addBond(p.id, q.id); }
  });
  return d;
}

const back = (name: string, text: string) => sceneToDoc(readScene(chemFormatOf(name, text)!, text)!, ACS_1996).doc;
const labels = (d: Doc) => [...d.atoms.values()].map((a) => a.label).filter(Boolean).sort();

/** The closest two atoms, in bond lengths. */
function closest(pts: { x: number; y: number }[], unit: number): number {
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return min / unit;
}

describe('chemistry exchange files keep the drawing (audit G1-01 to G1-05)', () => {
  const d = sample();
  const files: [string, string][] = [
    ['a.mol', writeMolFile(d).text], ['b.mol', writeMolFile(d, '', { v3000: true }).text], ['a.sdf', writeSdfFile(d).text],
    ['a.mrv', writeMrvFile(d).text], ['a.ket', writeKetFile(d).text], ['a.cml', writeCmlFile(d).text], ['a.json', writeChemDoodleJson(d).text],
  ];

  it('keeps R1 with its number and Xyz as its label in every format', () => {
    for (const [name, text] of files) {
      const got = labels(back(name, text));
      expect(got, name).toContain('R1');
      expect(got, name).toContain('Xyz');
    }
    // other programs see the R group number: R# with RGROUPS (V3000), rgroupRef (Marvin), rg-label (Ketcher)
    expect(files[1][1]).toMatch(/ R# .*RGROUPS=\(1 1\)/);
    expect(files[3][1]).toContain('rgroupRef="1"');
    expect(files[4][1]).toContain('"rg-1"');
  });

  it('writes an R1-only drawing as V2000 with R# and M  RGP, and reads it back as R1', () => {
    const r = new Doc();
    r.bulk(() => { const a = r.addAtom(0, 0); const b = r.addAtom(L, 0, 6, { label: 'R2' }); r.addBond(a.id, b.id); });
    const text = writeMolFile(r).text;
    expect(text).toMatch(/V2000/);
    expect(text).toMatch(/ R# {2}0/);
    expect(text).toMatch(/^M {2}RGP {2}1 {3}2 {3}2$/m);
    expect(labels(back('a.mol', text))).toEqual(['R2']);
  });

  it('marks abbreviations as superatom groups, so they come back as OMe and CO2tBu (MOL, SDF, MRV, KET)', () => {
    for (const [name, text] of files.slice(0, 5)) {
      const got = labels(back(name, text));
      expect(got, name).toContain('OMe');
      expect(got, name).toContain('CO2tBu');
    }
    expect(files[1][1]).toMatch(/M {2}V30 \d+ SUP 0 ATOMS=\(2 \d+ \d+\) XBONDS=\(1 \d+\) LABEL=OMe/);
    expect(files[3][1]).toMatch(/role="SuperatomSgroup" title="OMe"/);
    expect(JSON.parse(files[4][1]).mol0.sgroups.map((g: { name: string; atoms: number[] }) => [g.name, g.atoms.length]).sort()).toEqual([['CO2tBu', 7], ['OMe', 2]]);
  });

  it('writes V2000 superatom lines (STY, SAL, SBL, SMT) for a drawing V2000 can hold', () => {
    const r = new Doc();
    r.bulk(() => { const a = r.addAtom(0, 0); const b = r.addAtom(L, 0, 6, { label: 'OMe' }); r.addBond(a.id, b.id); });
    const text = writeMolFile(r).text;
    expect(text).toMatch(/V2000/);
    expect(text).toMatch(/^M {2}STY {2}1 {3}1 SUP$/m);
    expect(text).toMatch(/^M {2}SAL {3}1 {2}2 {3}2 {3}3$/m);
    // (bond 1 is the O–C inside the group, bond 2 the one joining it to the rest)
    expect(text).toMatch(/^M {2}SBL {3}1 {2}1 {3}2$/m);
    expect(text).toMatch(/^M {2}SMT {3}1 OMe$/m);
    expect(labels(back('a.mol', text))).toEqual(['OMe']);
  });

  it('lays the abbreviations\' atoms out at bond length: no two atoms closer than half a bond', () => {
    for (const [name, text] of files) {
      let pts: { x: number; y: number }[];
      if (name.endsWith('.mol') || name.endsWith('.sdf')) pts = readMolfile(text, { keepSup: true })!.atoms;
      else if (name.endsWith('.ket')) pts = Object.values(JSON.parse(text)).filter((m) => (m as { type?: string }).type === 'molecule').flatMap((m) => (m as { atoms: { location: number[] }[] }).atoms.map((a) => ({ x: a.location[0], y: a.location[1] })));
      else if (name.endsWith('.mrv')) continue; // (contracted, as Marvin keeps an abbreviation)
      else pts = readScene(chemFormatOf(name, text)!, text)!.mols.flatMap((m) => m.atoms);
      const unit = name.endsWith('.cml') ? 1.54 : name.endsWith('.json') ? 20 : 1;
      expect(closest(pts, unit), name).toBeGreaterThan(0.5);
    }
    // CML and ChemDoodle have no abbreviations: the atoms are written out (OMe 2 + CO2tBu 7 + the rest)
    for (const [name, text] of files.slice(5)) expect(back(name, text).atoms.size, name).toBe(d.atoms.size - 2 + 2 + 7);
  });

  it('keeps the dative bond, so the complex stays one molecule (V3000 type 9, Marvin cxn:coord, KET 9)', () => {
    for (const [name, text] of files) {
      const b = back(name, text);
      // (CML and ChemDoodle write the groups' atoms out: OMe's one bond and CO2tBu's six more)
      expect(b.bonds.size, name).toBe(d.bonds.size + (name.endsWith('.cml') || name.endsWith('.json') ? 1 + 6 : 0));
      if (!name.endsWith('.cml')) expect([...b.bonds.values()].filter((x) => x.display === 'dative'), name).toHaveLength(1);
    }
    expect(files[1][1]).toMatch(/^M {2}V30 \d+ 9 \d+ \d+$/m);
  });

  it('writes V3000 by itself when the drawing has a dative bond or an and/or group, and says so', () => {
    const got = writeMolFile(d);
    expect(got.text).toMatch(/V3000/);
    expect(got.notes?.join(' ')).toMatch(/V3000.*coordination \(dative\) bonds and and\/or stereo groups/);
    expect(writeSdfFile(d).text).toMatch(/V3000/);
  });

  it('keeps the and-group stereocentre (V3000 STERAC1, Marvin mrvStereoGroup, Ketcher stereoLabel)', () => {
    for (const [name, text] of files.slice(0, 5)) {
      const b = back(name, text);
      expect([...b.atoms.values()].filter((a) => a.enhStereo).map((a) => a.enhStereo), name).toEqual([{ type: 'and', group: 1 }]);
    }
    expect(files[1][1]).toMatch(/^M {2}V30 MDLV30\/STERAC1 ATOMS=\(1 \d+\)$/m);
    expect(files[3][1]).toContain('mrvStereoGroup="and1"');
    expect(files[4][1]).toContain('"stereoLabel": "&1"');
  });

  it('keeps isotope, radical, charge and the map number', () => {
    for (const [name, text] of files) {
      const atoms = [...back(name, text).atoms.values()];
      expect(atoms.some((a) => a.isotope === 13), name).toBe(true);
      expect(atoms.some((a) => a.radical === 'doublet'), name).toBe(true);
      expect(atoms.some((a) => a.z === 7 && a.charge === 1), name).toBe(true);
      if (!name.endsWith('.cml') && !name.endsWith('.json')) expect(atoms.filter((a) => a.mapNo).map((a) => a.mapNo), name).toEqual([2]);
    }
    expect(writeChemDoodleJson(d).notes?.join(' ')).toMatch(/map numbers left out/);
  });

  it('reads V3000 enhanced stereo collections and the chiral flag as other programs write them', () => {
    // syntax from BIOVIA CTfile Formats (2020), V3000 collection block
    const text = `\n  test\n\n  0  0  0     0  0            999 V3000
M  V30 BEGIN CTAB
M  V30 COUNTS 4 3 0 0 1
M  V30 BEGIN ATOM
M  V30 1 C 0 0 0 0
M  V30 2 C 1 0 0 0
M  V30 3 C 2 0 0 0
M  V30 4 O 1 1 0 0
M  V30 END ATOM
M  V30 BEGIN BOND
M  V30 1 1 1 2
M  V30 2 1 2 3
M  V30 3 1 2 4 CFG=1
M  V30 END BOND
M  V30 BEGIN COLLECTION
M  V30 MDLV30/STEREL2 ATOMS=(1 2)
M  V30 MDLV30/STEABS ATOMS=(1 3)
M  V30 END COLLECTION
M  V30 END CTAB
M  END
`;
    const m = readMolfile(text)!;
    expect(m.chiral).toBe(true);
    expect(m.atoms.map((a) => a.enh)).toEqual([undefined, { type: 'or', group: 2 }, { type: 'abs' }, undefined]);
  });

  it('sets the chiral flag for a wedged centre that is in no and/or group, and not otherwise', () => {
    const w = new Doc();
    w.bulk(() => { const a = w.addAtom(0, 0); const b = w.addAtom(L, 0, 8); const c = w.addAtom(-L, 0); w.addBond(a.id, b.id, 1, 'wedge'); w.addBond(a.id, c.id); });
    expect(writeMolFile(w).text.split('\n')[3]).toMatch(/^ {2}3 {2}2 {2}0 {2}0 {2}1 /);
    const flat = new Doc();
    flat.bulk(() => { const a = flat.addAtom(0, 0); const b = flat.addAtom(L, 0, 8); flat.addBond(a.id, b.id); });
    expect(writeMolFile(flat).text.split('\n')[3]).toMatch(/^ {2}2 {2}1 {2}0 {2}0 {2}0 /);
  });

  it('names the program as Chemweave in the header line, with the dimension code in columns 21–22 (G1-24)', () => {
    const r = new Doc();
    r.bulk(() => { r.addAtom(0, 0); });
    const line = writeMolFile(r).text.split('\n')[1];
    expect(line.slice(2, 11)).toBe('Chemweave');
    expect(line.slice(20, 22)).toBe('2D');
    expect(toMolfile(r, r.atoms.keys()).molblock.split('\n')[1]).toBe(line);
  });

  it('keeps the chemistry engine\'s molfile as before: no dative bonds, no S-groups, flag 0', () => {
    const ex = toMolfile(d, d.atoms.keys());
    expect(ex.molblock).not.toMatch(/SUP|RGP|V3000/);
    expect(ex.molblock.split('\n')[3]).toMatch(/ {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0999 V2000$/);
  });

  it('keeps the map numbers of a reaction in CML as its atom map', () => {
    const r = new Doc();
    r.style = { ...ACS_1996 };
    r.bulk(() => {
      const a = r.addAtom(0, 0, 6, { mapNo: 1 }); const b = r.addAtom(L, 0, 8, { mapNo: 2 }); r.addBond(a.id, b.id, 2);
      const c = r.addAtom(L * 6, 0, 6, { mapNo: 1 }); const e = r.addAtom(L * 7, 0, 8, { mapNo: 2 }); r.addBond(c.id, e.id);
      r.addArrow({ tail: { x: L * 2.5, y: 0 }, head: { x: L * 4.5, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 10, headWidth: 3 });
    });
    const text = writeCmlFile(r).text;
    expect(text).toMatch(/<map fromType="atom" toType="atom"/);
    expect(text.match(/<link /g)).toHaveLength(2);
    const maps = [...back('a.cml', text).atoms.values()].map((a) => a.mapNo).sort();
    expect(maps).toEqual([1, 1, 2, 2]);
    // and RXN writes the 9-letter program name in its 9-column field (columns 7–15)
    expect(writeRxnFile(r).text.split('\n')[2]).toBe('      Chemweave');
  });
});
