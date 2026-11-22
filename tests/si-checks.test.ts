// SI project checks: the same warnings, wording and fingerprints as Chem SI Assistant gives.
// The golden files were made by SI Assistant itself (fixtures/si-tools/golden.py) on the example
// project and on a copy changed so that every check has something to say (si-tools/mutate.py).
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { allWarnings, compoundHrms, isDismissed, monoisotopic } from '../src/si/checks';
import { molFacts, isotopePattern, infoFromCounts, parseFormula, parseAdduct, ionMz, symmetryClasses, hillFormula, parseMFormulaAndCharge, ChemError } from '../src/si/chem';
import { fp, pyF, pyG, pyRepr, pyStr, PyTuple, sortedFp } from '../src/si/pyrepr';
import { carbonSignalCount, protonCount, couplings, impurityMatch, defaultImpurityTable } from '../src/si/nmr';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

function folder(dir: string): MemoryFolder {
  const root = join(__dirname, 'fixtures', dir);
  const f = new MemoryFolder(dir);
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(root, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(root);
  return f;
}

interface GoldenWarning { check: string; field: string; key: string; fp: string; legacy: string; message: string; dismissed: boolean }
type Golden = Record<string, ({ hrms: [number, number | null, number | null, string] } | GoldenWarning | { err: string })[]>;

async function compare(dir: string): Promise<void> {
  const golden = JSON.parse(readFileSync(join(__dirname, 'fixtures', `${dir}.golden.json`), 'utf8')) as Golden;
  const p = await SiProject.open(folder(dir));
  const report = p.idReport();
  const seen = new Set<string>();
  for (const c of p.compounds) {
    seen.add(c.id);
    const want = golden[c.id];
    expect(want, c.id).toBeDefined();
    const mol = await p.readStructure(c);
    const facts = mol ? molFacts(RDKit, mol) : null;
    const got = allWarnings(p, c, report, facts).map((x) => ({ check: x.check, field: x.field, key: x.key, fp: x.fingerprint, legacy: x.legacy, message: x.message, dismissed: isDismissed(c, x) }));
    expect(got, c.id).toEqual(want.filter((x): x is GoldenWarning => 'check' in x));
    const h = want.find((x) => 'hrms' in x) as { hrms: [number, number | null, number | null, string] } | undefined;
    const [r] = compoundHrms(p, c, facts);
    if (!h) { expect(r, c.id).toBeNull(); continue; }
    expect(r, c.id).not.toBeNull();
    const mono = monoisotopic(r!);
    // (Chemweave's isotope masses are the IUPAC 2016 table; SI Assistant's come from RDKit, which
    // rounds some of them: the m/z agree to within 1e-6, far below the 4 decimals printed.)
    expect(mono.mz, c.id).toBeCloseTo(h.hrms[0], 5);
    if (h.hrms[1] === null) expect(r!.ppm).toBeNull(); else expect(r!.ppm!, c.id).toBeCloseTo(h.hrms[1], 2);
    if (h.hrms[2] === null) expect(r!.matched).toBeNull(); else expect(r!.matched!.mz, c.id).toBeCloseTo(h.hrms[2], 5);
    expect(mono.formula, c.id).toBe(h.hrms[3]);
  }
  expect([...seen].sort()).toEqual(Object.keys(golden).sort());
}

describe('Python repr and fingerprints', () => {
  it('writes values as Python repr does', () => {
    expect(pyStr("it's")).toBe('"it\'s"');
    expect(pyStr('a\'b"c')).toBe("'a\\'b\"c'");
    expect(pyStr('δ 7.26\n')).toBe("'δ 7.26\\n'");
    expect(pyStr('\u200b')).toBe("'\\u200b'");
    expect(pyRepr(new PyTuple(['a']))).toBe("('a',)");
    expect(pyRepr([pyF(400), 1, null, true, { a: 1.5 }])).toBe("[400.0, 1, None, True, {'a': 1.5}]");
  });
  it('fingerprints as SI Assistant does', () => {
    // Python: hashlib.sha1(repr(('x', 1, 400.0, None, ['a'])).encode()).hexdigest()[:12]
    expect(fp('x', 1, pyF(400), null, ['a'])).toBe('b897aa8401d9');
    expect(sortedFp(new Set(['b', 'a']))).toBe(fp(['a', 'b']));
    expect(sortedFp(new Set(['a', null]))).toBe('');
  });
  it('formats numbers as Python %g does', () => {
    expect(pyG(400)).toBe('400');
    expect(pyG(0.1)).toBe('0.1');
    expect(pyG(1234567)).toBe('1.23457e+06');
    expect(pyG(0.00001)).toBe('1e-05');
    expect(pyG(100.62)).toBe('100.62');
  });
});

describe('NMR reports', () => {
  it('counts signals, protons and couplings', () => {
    const h = '¹H NMR (400 MHz, CDCl₃) δ 7.35–7.25 (m, 5H), 4.89 (q, J = 6.5 Hz, 1H), 1.50 (d, J = 6.5 Hz, 3H).';
    expect(protonCount(h)).toBe(9);
    expect(couplings(h).map((c) => c.value)).toEqual([6.5, 6.5]);
    expect(carbonSignalCount('¹³C NMR (101 MHz, CDCl₃) δ 145.8, 128.5, 127.5, 125.4, 70.4, 25.2.')).toBe(6);
  });
  it('spots residual solvent peaks', () => {
    const table = defaultImpurityTable();
    expect(impurityMatch('CDCl3', '1H', 7.26, true, table)).toMatch(/CHCl/);
    expect(impurityMatch('CDCl3', '1H', 7.26, false, table)).toBe('');
  });
});

describe('masses', () => {
  it('gives the monoisotopic m/z and isotope peaks', () => {
    const info = infoFromCounts(parseFormula('C8H10O'));
    const { mz } = ionMz(info, '[M+Na]+');
    expect(mz).toBeCloseTo(145.0623856, 6);
    const peaks = isotopePattern(infoFromCounts(parseFormula('C8H9BrO')), '[M+Na]+');
    expect(peaks.length).toBeGreaterThan(1);
    expect(parseAdduct('[M+H]+').charge).toBe(1);
  });
  it('reads structures: unique carbons, H counts and salt pieces', () => {
    const facts = molFacts(RDKit, RDKit.get_mol('CC(O)c1ccccc1').get_molblock())!;
    expect(facts.uniqueCarbons).toBe(6);
    expect(facts.hTotal).toBe(10);
    expect(facts.hExch).toBe(1);
    const salt = molFacts(RDKit, RDKit.get_mol('c1cc[nH+]cc1.O=S(=O)([O-])C(F)(F)F').get_molblock())!;
    expect(salt.pieces.length).toBe(2);
    expect(salt.pieces.filter((x) => x.counterIon).length).toBe(1);
  });
  it('gives the ¹³C count as a range: stereo left out, and diastereotopic carbons apart (G4-07)', () => {
    const range = (smiles: string): [number, number] => {
      const f = molFacts(RDKit, RDKit.get_mol(smiles).get_molblock())!;
      return [f.uniqueCarbons, f.uniqueCarbonsMax!];
    };
    // menthol: 10 ¹³C signals, the isopropyl CH₃ pair at 16.80 and 21.80 ppm (Härtner & Reinscheid,
    // J. Mol. Struct. 2008, 872, 145; "the prochiral methyls could be differentiated")
    expect(range('CC(C)[C@@H]1CC[C@@H](C)C[C@H]1O')).toEqual([9, 10]);
    expect(range('CC(C)C1CCC(C)CC1O')).toEqual([9, 10]);
    // camphor: 10 ¹³C signals, the gem-dimethyl pair at 19.8 and 19.1 ppm (NMRShiftDB2 Problem of
    // the Month 2013-05, C10H16O; Wenkert et al., J. Chem. Soc. D 1969, 1433)
    expect(range('CC1(C)[C@@H]2CC[C@@]1(C)C(=O)C2')).toEqual([9, 10]);
    expect(range('CC1(C)C2CCC1(C)C(=O)C2')).toEqual([9, 10]);
    // ibuprofen: 10 signals, its diastereotopic isobutyl CH₃ pair as one at 22.47 ppm (SDBS no. 10570,
    // 50.32 MHz, CDCl₃, via HMDB spectrum 2954: 181.35, 140.93, 137.02, 129.47, 127.36, 45.11,
    // 45.08, 30.25, 22.47, 18.15), so 10 must be inside the range
    expect(range('CC(C)Cc1ccc(cc1)C(C)C(=O)O')).toEqual([10, 11]);
    // xylitol, a meso compound: 3 signals in D₂O (BMRB bmse000129: 65.314 C1/C5, 74.628 C2/C4,
    // 73.474 C3). Its halves lie across a mirror plane through C3, which the upper count doesn't
    // see (it tells them apart), so the range is 3 to 5 wedged or flat, and 3 is inside it
    expect(range('C([C@H]([C@H]([C@@H](CO)O)O)O)O')).toEqual([3, 5]);
    expect(range('OCC(O)C(O)C(O)CO')).toEqual([3, 5]);
    // meso-2,3-butanediol: 2; cis-1,2-dimethylcyclohexane: 4 (the halves alike)
    expect(range('C[C@@H](O)[C@H](C)O')).toEqual([2, 2]);
    expect(range('C[C@@H]1CCCC[C@@H]1C')).toEqual([4, 4]);
    // no stereocentre: isobutanol's two CH₃ are enantiotopic, one signal (Mislow & Raban, Top.
    // Stereochem. 1967, 1, 1); a phenyl ring's ortho pair stays one (it turns)
    expect(range('CC(C)CO')).toEqual([3, 3]);
    expect(range('CC(O)c1ccccc1')).toEqual([6, 6]);
    // a square-planar metal with four different groups is no stereocentre (review F4-R13)
    expect(range('CC(C)[Pt](N)(Cl)Br')).toEqual([2, 2]);
  });
  it('warns only when the ¹³C count is outside the range, naming both ends (review F4-R02)', async () => {
    const p = await SiProject.open(folder('si-example'));
    const c = p.compounds.find((x) => x.id === 'c-26c39a99')!; // 1-phenylethanol: its ¹³C lists 6 signals
    const facts = molFacts(RDKit, (await p.readStructure(c)))!;
    const c13 = (lo: number, hi: number) => allWarnings(p, c, p.idReport(), { ...facts, uniqueCarbons: lo, uniqueCarbonsMax: hi }).filter((x) => x.check === 'c13').map((x) => x.message);
    expect(c13(6, 6)).toEqual([]);
    expect(c13(5, 7)).toEqual([]);
    // (the same words as SI Assistant when the two ends are the same)
    expect(c13(7, 7)).toEqual(['¹³C NMR lists 6 signals; the structure has 7 symmetry-distinct carbons. (Approximate: C–F coupling, rotamers and overlapping signals can make these differ.)']);
    expect(c13(4, 5)).toEqual(['¹³C NMR lists 6 signals; the structure has 4 symmetry-distinct carbons, or 5 if its diastereotopic CH₃/CH₂ carbons each give their own signal. (Approximate: C–F coupling, rotamers and overlapping signals can make these differ.)']);
  });
  it('works the symmetry classes out quickly for a 1,200-atom chain (G4-08)', () => {
    const chain = (n: number) => ({
      atoms: Array.from({ length: n }, (_, i) => ({ z: 6, isotope: 0, chg: 0, impHs: i === 0 || i === n - 1 ? 3 : 2 })),
      bonds: Array.from({ length: n - 1 }, (_, i) => [i, i + 1, 1] as [number, number, number]),
    });
    const time = (n: number): number => { const { atoms, bonds } = chain(n); const t0 = performance.now(); symmetryClasses(atoms, bonds); return performance.now() - t0; };
    const { atoms, bonds } = chain(1200);
    const cls = symmetryClasses(atoms, bonds);
    // (the classes pair each atom with its mirror atom from the other end)
    expect(new Set(cls).size).toBe(600);
    expect(cls[0]).toBe(cls[1199]);
    // Doubling the chain: the old refinement took 11.7 times as long (162 ms → 1.9 s), this one
    // about 3.4 times (132 → 446 ms), up to about 7 on a busy machine. Timed side by side, so a
    // busy machine slows both alike; best of three. (Or simply quick.)
    const best = (n: number) => Math.min(time(n), time(n), time(n));
    const t600 = best(600), t1200 = best(1200);
    expect(t1200 < 1500 || t1200 / t600 < 10, `${Math.round(t600)} ms → ${Math.round(t1200)} ms`).toBe(true);
  }, 30_000); // (seven runs: more than the usual 5 s on a busy machine)
});

describe('formulas typed and written', () => {
  it('writes every labelled carbon right after C and labelled hydrogen after H (G4-13)', () => {
    // Hill order (CAS; IUPAC Red Book IR-4.4.2.1): C first, then H, then the rest alphabetically;
    // labelled nuclides stay with their element. [13C]-acetone C2[13C]H6O; [14C]-toluene C6[14C]H8
    expect(hillFormula(new Map([['C', 2], ['13C', 1], ['H', 6], ['O', 1]]))).toBe('C2[13C]H6O');
    expect(hillFormula(new Map([['C', 6], ['14C', 1], ['H', 8]]))).toBe('C6[14C]H8');
    expect(hillFormula(new Map([['C', 5], ['14C', 1], ['13C', 1], ['H', 7], ['D', 1], ['3H', 1], ['Br', 1]]))).toBe('C5[13C][14C]H7D[3H]Br');
    // no carbon: all alphabetical
    expect(hillFormula(new Map([['O', 1], ['H', 2]]))).toBe('H2O');
  });
  it('reads a hydrate dot and groups in brackets in a typed M formula (G4-14)', () => {
    const f = (t: string): string => { const [c, q] = parseMFormulaAndCharge(t); return hillFormula(c) + (q ? ` ${q}` : ''); };
    // PubChem molecular formulas: glucose monohydrate C6H14O7 (CID 22814120), copper(II) sulfate
    // pentahydrate CuH10O9S (CID 24463), ferrocene C10H10Fe (CID 7611), calcium hydroxide CaH2O2
    // (CID 6093208), tetraamminecopper sulfate CuH12N4O4S (CID 167053)
    expect(f('C6H12O6·H2O')).toBe('C6H14O7');
    expect(f('CuSO4·5H2O')).toBe('CuH10O9S');
    expect(f('CuSO4.5H2O')).toBe('CuH10O9S');
    expect(f('Fe(C5H5)2')).toBe('C10H10Fe');
    expect(f('Ca(OH)2')).toBe('CaH2O2');
    expect(f('[Cu(NH3)4]SO4')).toBe('CuH12N4O4S');
    // with a charge and an isotope label
    expect(f('[Fe(C5H5)2]+')).toBe('C10H10Fe 1');
    expect(f('C5[13C]H6(OH)2')).toBe('C5[13C]H8O2');
    // still refused, with the reason
    expect(() => parseMFormulaAndCharge('Fe(C5H5')).toThrow(ChemError);
    expect(() => parseMFormulaAndCharge('Fe)2')).toThrow(ChemError);
  });
  it('refuses an empty group or a count of 0, names a fractional hydrate count, and gives no charge hint for a bracket (review F4-R11)', () => {
    const msg = (t: string): string => { try { parseMFormulaAndCharge(t); return ''; } catch (e) { return (e as Error).message; } };
    expect(msg('()')).toBe('“()” has an empty group ().');
    expect(msg('C2H6[]')).toMatch(/empty group/);
    expect(msg('(C2H5)0')).toBe('“(C2H5)0” has a group with the count 0 ((C2H5)0).');
    expect(msg('CuSO4·0H2O')).toMatch(/count 0 after a dot/);
    expect(msg('CuSO4·0.5H2O')).toMatch(/^“CuSO4·0\.5H2O” has a fractional count \(0\.5H2O\)\. M is one ion/);
    expect(msg('C10H12O2·0.25H2O')).toMatch(/fractional count \(0\.25H2O\)/);
    // a bracket error is said as it is, without "Write a charge at the end of the formula"
    expect(msg('Fe(C5H5')).toBe('“Fe(C5H5” has a bracket that isn’t closed.');
    expect(msg('Fe)2')).not.toMatch(/charge/);
    // (still read: PubChem formulas of sodium carbonate decahydrate CH20Na2O13, CID 151402, and
    // potassium ferrocyanide trihydrate C6H6FeK4N6O3, CID 161067)
    expect(hillFormula(parseMFormulaAndCharge('Na2CO3·10H2O')[0])).toBe('CH20Na2O13');
    expect(hillFormula(parseMFormulaAndCharge('K4[Fe(CN)6]·3H2O')[0])).toBe('C6H6FeK4N6O3');
  });
});

describe('the same warnings as SI Assistant', () => {
  it('on the example project', async () => { await compare('si-example'); });
  it('on a project with something wrong in every compound', async () => { await compare('si-checks'); });
});

describe('dismissing warnings', () => {
  it('saves a dismissal as SI Assistant does, and restores it', async () => {
    const f = folder('si-checks');
    const p = await SiProject.open(f);
    const c = p.compounds.find((x) => x.id === 'c-26c39a99')!;
    const facts = molFacts(RDKit, await p.readStructure(c));
    const w = allWarnings(p, c, p.idReport(), facts).find((x) => x.key === 'hrms:ppm')!;
    await p.dismissWarning(c, w, '  sodium adduct from the glassware ');
    expect(isDismissed(c, w)).toBe(true);
    const path = [...f.files.keys()].find((k) => k.includes('c-26c39a99') && k.endsWith('compound.json'))!;
    const saved = JSON.parse(new TextDecoder().decode(f.files.get(path)!)) as { dismissed: Record<string, Record<string, string>> };
    expect(Object.keys(saved.dismissed['hrms:ppm'])).toEqual(['fingerprint', 'message', 'reason', 'by', 'at']);
    expect(saved.dismissed['hrms:ppm'].fingerprint).toBe('98746b0a425d');
    expect(saved.dismissed['hrms:ppm'].reason).toBe('sodium adduct from the glassware');
    expect(saved.dismissed['hrms:ppm'].at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
    // the data changes: the warning is back
    const again = allWarnings(p, c, p.idReport(), facts).find((x) => x.key === 'hrms:ppm')!;
    expect(isDismissed(c, again)).toBe(true);
    (c.data.values as Record<string, Record<string, string>>).hrms.found = '145.0800';
    const changed = allWarnings(p, c, p.idReport(), facts).find((x) => x.key === 'hrms:ppm')!;
    expect(isDismissed(c, changed)).toBe(false);
    await p.restoreWarning(c, 'hrms:ppm');
    expect(c.data.dismissed).toEqual({});
  });
});
