// @vitest-environment jsdom
//
// Every label this program knows comes back as the same label through the exchange formats
// (review F1b-R02, F1b-R03): each built-in abbreviation (NICKNAMES: Me, Boc, OTBS, CO2R…)
// bonded to a methyl group, and each name a text box reads as a species on its own (the
// species list: DCM, LDA, DBU, NBS, PPh3…), plus generic labels (R, X, base, hν, Δ, cat.).
// Formats: MOL V2000 and V3000, SDF and KET (BIOVIA CTfile Formats 2020; EPAM Ketcher's KET).
// The structures are built here in code. (Every label through five formats takes about a minute.)

import { describe, it, expect } from 'vitest';
import { readScene, sceneToDoc, chemFormatOf, writeKetFile, writeMolFile, writeSdfFile, writeMrvFile } from '../src/io/chem-formats';
import { builtInNicknames } from '../src/chem/labels';
import { SPECIES_ENTRIES } from '../src/chem/species-list';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';

const L = ACS_1996.bondLength;
const back = (name: string, text: string) => sceneToDoc(readScene(chemFormatOf(name, text)!, text)!, ACS_1996).doc;
const files = (d: Doc): [string, string][] => [
  ['a.mol', writeMolFile(d).text], ['b.mol', writeMolFile(d, '', { v3000: true }).text], ['a.sdf', writeSdfFile(d).text], ['a.ket', writeKetFile(d).text], ['a.mrv', writeMrvFile(d).text],
];
const labels = (d: Doc) => [...d.atoms.values()].map((a) => a.label).filter(Boolean);

function failures(make: (label: string) => Doc, list: string[]): string[] {
  const bad: string[] = [];
  for (const label of list) {
    const d = make(label);
    for (const [name, text] of files(d)) {
      let got: (string | null)[] = [];
      try { got = labels(back(name, text)); } catch (e) { got = [String(e)]; }
      if (got.length !== 1 || got[0] !== label) bad.push(`${label} (${name}): ${JSON.stringify(got)}`);
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
    expect(failures(bonded, [...new Set([...builtInNicknames().map(([n]) => n), ...reviewed])])).toEqual([]);
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
    expect(failures(alone, [...new Set([...names, ...reviewed, 'R', 'X', 'R1', 'Ar', 'base', 'hν', 'Δ', 'cat.', 'Pd/C', 'Py'])])).toEqual([]);
  }, 600_000);
});
