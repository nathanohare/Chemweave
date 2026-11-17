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
import { molFacts, isotopePattern, infoFromCounts, parseFormula, parseAdduct, ionMz } from '../src/si/chem';
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
