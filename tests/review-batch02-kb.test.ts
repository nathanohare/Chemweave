// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 02: the Knowledge Base.
//   F137: harmonized codes with their EU letter (H360D, H360FD, H350i) were never matched.
//   F627: "Ca" (NIOSH's carcinogen mark) was explained on calcium (the Symbol column, Ca²⁺).
//   F628: groups whose SMILES starts with a stereo bond ([*]/C=C/…) were "Attached through: Other".
//   F629: negative electron affinities, written with a real minus, sorted as positive and pasted as text.
//   F630: the lowest LD50 per route compared only doses in the same unit.
//   F631: the skin permeability estimate was refused for neutral nitro compounds (charges written apart).

import { describe, expect, it } from 'vitest';
import { badges, chargesApartOnly, codeIs, lethalByRoute, oralLd50, rate, skinKp, type SafetyRecord } from '../src/kb/safety';
import { compactRecord } from '../src/kb/pubchem-safety';
import { explainPieces } from '../src/kb/glossary';
import { HAMMETT, joinedBy } from '../src/kb/hammett';
import { HSAB_TABLE } from '../src/kb/inorganic';
import { cellNumbers, sortRows, tableTsv, type RowMatch } from '../src/kb/tables';

const base = (over: Partial<SafetyRecord>): SafetyRecord => ({
  name: 'x', cid: 1, cas: null, formula: null, mw: 100, smiles: null, idlh: null, lethal: [], vp: null, bp: null, mp: null,
  density: null, flash: null, ghs: null, alerts: [], skin: false, incompatible: null, niosh: null, ...over,
});

describe('F137: harmonized codes with their letter suffix', () => {
  it('counts H360D as H360 and H350i as H350, and keeps H361 apart', () => {
    expect(codeIs('H360D', 'H360')).toBe(true);
    expect(codeIs('H360FD', 'H360')).toBe(true);
    expect(codeIs('H350i', 'H350')).toBe(true);
    expect(codeIs('H300+H310', 'H310')).toBe(true);
    expect(codeIs('H361d', 'H360')).toBe(false);
    expect(codeIs('EUH014', 'H014')).toBe(false);
  });

  it('gives N,N-dimethylformamide its reproductive-toxicity reason', () => {
    // DMF: Repr. 1B H360D, Acute Tox. 4 H312 and H332, Eye Irrit. 2 H319 (Regulation (EC) No 1272/2008,
    // Annex VI, Table 3, index no. 616-001-00-X)
    const dmf = base({ name: 'N,N-Dimethylformamide', ghs: { codes: ['H312', 'H319', 'H332', 'H360D'], classes: '' } });
    expect(rate(dmf).why).toContain('May damage fertility or the unborn child (H360, harmonized)');
  });

  it('gives a nickel salt with H350i the Carcinogen 1A/1B badge', () => {
    // nickel sulfate: Carc. 1A H350i, Muta. 2 H341, Repr. 1B H360D, STOT RE 1 H372 (Regulation (EC)
    // No 1272/2008, Annex VI, Table 3, index no. 028-009-00-5)
    const ni = base({ name: 'Nickel sulfate', ghs: { codes: ['H350i', 'H341', 'H360D', 'H372'], classes: '' } });
    expect(badges(ni)).toContain('Carcinogen 1A/1B');
  });
});

describe('F627: Ca is calcium unless it is NIOSH’s mark', () => {
  it('explains (Ca) after a limit, not the element', () => {
    expect(explainPieces('Ca').some((p) => p.tip)).toBe(false);
    expect(explainPieces('Ca²⁺').some((p) => p.tip)).toBe(false);
    expect(explainPieces('500 ppm (Ca)').find((p) => p.text === 'Ca')?.tip).toMatch(/carcinogen/i);
  });
});

describe('F628: a stereo bond before the joining atom', () => {
  // Hansch, Leo and Taft, Chem. Rev. 1991, 91, 165, Table I: 468 CH=CHC6H5 (styryl, joined by
  // carbon), 272 CH=CHMe (E), 419 N=NC6H5 (phenylazo, joined by nitrogen)
  const row = (n: number) => HAMMETT.find((x) => x.row === n)!;
  it('reads the joining atom after the / or \\', () => {
    expect(row(468).smiles.startsWith('[*]/')).toBe(true);
    expect(joinedBy(row(468))).toBe('Carbon');
    expect(joinedBy(row(272))).toBe('Carbon');
    expect(joinedBy(row(419))).toBe('Nitrogen');
  });
});

describe('F629: negative values written with a minus sign', () => {
  // Pearson, Inorg. Chem. 1988, 27, 734 (Miessler, Fischer and Tarr, Table 6.16): A of H₂O −6.4 eV, of Na⁺ 5.14 eV
  const hard = HSAB_TABLE.rows.filter((r) => r.part === 'hardness');
  const ea = HSAB_TABLE.parts!.find((p) => p.key === 'hardness')!.columns.find((c) => c.key === 'ea')!;
  it('reads them as negative, sorts them first and pastes them as numbers', () => {
    expect(cellNumbers('−6.4')).toEqual([-6.4]);
    const sorted = sortRows(hard.map((row) => ({ row }) as RowMatch), ea, false).map((m) => m.row.species);
    expect(sorted.slice(0, 5).sort()).toEqual(['BF₃', 'H₂O', 'NH₃', 'PF₃', 'PH₃'].sort());
    const tsv = tableTsv({ ...HSAB_TABLE, parts: undefined, columns: [ea] }, hard.filter((r) => r.species === 'H₂O').map((row) => ({ row }) as RowMatch));
    expect(tsv.split('\n')[1]).toBe('-6.4');
  });
});

describe('F630: the lowest dose is compared in mg/kg', () => {
  it('keeps 50 mg/kg over 0.2 g/kg, in the table and the small record alike', () => {
    // 0.2 g/kg is 200 mg/kg
    const r = base({ lethal: [
      { kind: 'LD50', species: 'rat', route: 'oral', value: 0.2, unit: 'g/kg', time: '', source: 'HSDB' },
      { kind: 'LD50', species: 'mouse', route: 'oral', value: 50, unit: 'mg/kg', time: '', source: 'HSDB' },
    ] });
    expect(oralLd50(r)).toBe(50);
    expect(lethalByRoute(r).oral).toBe('mouse 50 mg/kg');
    expect(compactRecord(r).lethal).toEqual([r.lethal[1]]);
  });
});

describe('F631: a neutral nitro compound gets a skin estimate, a zwitterion none', () => {
  it('takes a nitro group or N-oxide written with its charges apart as neutral, and nothing else', () => {
    expect(chargesApartOnly('C1=CC=C(C=C1)[N+](=O)[O-]')).toBe(true);
    // pyridine N-oxide, written with its charges apart
    expect(chargesApartOnly('C1=CC=[N+](C=C1)[O-]')).toBe(true);
    expect(chargesApartOnly('[NH4+]')).toBe(false);
    expect(chargesApartOnly('C[N+](C)(C)C')).toBe(false);
    // glycine as its zwitterion: an ion in water, not a neutral molecule
    expect(chargesApartOnly('C(C(=O)[O-])[NH3+]')).toBe(false);
    // nitrobenzene: SMILES, MW 123.11 g/mol and XLogP3 1.9 as PubChem gives them (CID 7416)
    const pnb = base({ smiles: 'C1=CC=C(C=C1)[N+](=O)[O-]', mw: 123.11, xlogp: 1.9 });
    expect(skinKp(pnb)).not.toBeNull();
    // a quaternary ammonium ion and a zwitterion still get none (glycine: MW 75.07, XLogP3 -3.2, PubChem CID 750)
    expect(skinKp(base({ smiles: 'C[N+](C)(C)C', mw: 74.1, xlogp: -2 }))).toBeNull();
    expect(skinKp(base({ smiles: 'C(C(=O)[O-])[NH3+]', mw: 75.07, xlogp: -3.2 }))).toBeNull();
  });
});

describe('The safety script can load the PubChem reader', () => {
  // scripts/kb/build-safety.mjs loads src/kb/pubchem-safety.ts in Node itself, which can't follow
  // an import of another .ts file written without its ending: only type imports may be there
  it('has only type imports, and loads in Node as the script loads it', async () => {
    const { readFileSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const text = readFileSync(`${process.cwd()}/src/kb/pubchem-safety.ts`, 'utf8');
    const imports = text.split('\n').filter((l) => /^\s*import\b/.test(l));
    expect(imports.filter((l) => !/^\s*import type\b/.test(l))).toEqual([]);
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', "const m = await import('./src/kb/pubchem-safety.ts'); console.log(Object.keys(m).sort().join(','))"], { cwd: process.cwd(), encoding: 'utf8' });
    expect(out).toMatch(/\bcompactRecord\b.*\bsafetyRecordFrom\b/);
    expect(out).toMatch(/\blowerDose\b/);
  });
});
