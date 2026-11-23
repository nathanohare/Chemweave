// The compound text of the compiled SI: the same paragraphs, run for run, as Chem SI Assistant
// writes (compile/blocks.py). The golden files were made by SI Assistant itself
// (fixtures/si-tools/blocks_golden.py) on the example project, the checks project, and a copy
// given every kind of data (si-tools/blocks_mutate.py).
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { displayId } from '../src/si/compound-ids';
import { molFacts } from '../src/si/chem';
import { compoundBlock } from '../src/si/blocks';
import { formatChemistry, formatNmr, mergeRuns } from '../src/si/format';
import { formulaMatches, rangeMatches } from '../src/si/chemtext';
import type { Run } from '../src/si/markup';

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

type PyRun = [string, boolean, boolean, string, string, boolean];
interface GoldenBlock { title: string; paragraphs: PyRun[][]; figures: [string, string][]; custom: boolean }

/** Runs as SI Assistant writes them, joined where the format is the same (both sides). Where a run came from (`src`, for the Live Preview) is not part of its format. */
const ours = (runs: Run[]): PyRun[] => mergeRuns(runs.filter((r) => r.text || r.ref).map(({ src: _src, ...r }) => r)).map((r) => [r.text, !!r.bold, !!r.italic, r.valign ?? 'normal', r.ref ?? '', !!r.underline]);
const theirs = (runs: PyRun[]): PyRun[] => ours(runs.map(([text, bold, italic, valign, ref, underline]) => ({ text, bold, italic, underline, valign: valign as Run['valign'], ref: ref || undefined })));

async function compare(dir: string): Promise<void> {
  const golden = JSON.parse(readFileSync(join(__dirname, 'fixtures', `${dir}.blocks.json`), 'utf8')) as Record<string, GoldenBlock>;
  const p = await SiProject.open(folder(dir));
  const report = p.idReport();
  for (const c of p.compounds) {
    const want = golden[c.id];
    expect(want, c.id).toBeDefined();
    const mol = await p.readStructure(c);
    const facts = mol ? molFacts(RDKit, mol) : null;
    const b = compoundBlock(p, c, displayId(report, c.id), { facts, helpers: true });
    expect(b.title.map((r) => r.text).join(''), c.id).toBe(want.title);
    expect(b.paragraphs.map((x) => ours(x.runs)), c.id).toEqual(want.paragraphs.map(theirs));
    expect(b.figures.map((f) => [f.file, f.caption]), c.id).toEqual(want.figures);
    expect(b.customText, c.id).toBe(want.custom);
  }
  expect(p.compounds.map((c) => c.id).sort()).toEqual(Object.keys(golden).sort());
}

describe('chemistry in text', () => {
  const words = (t: string): string[] => formulaMatches(t).map((m) => m.groups[0]);
  it('finds formulas as SI Assistant does', () => {
    expect(words('CDCl3, Na2SO4, CH2Cl2, Et3N, Pd(PPh3)4, Pd2(dba)3, [Ir(cod)Cl]2, B2pin2')).toEqual(['CDCl3', 'Na2SO4', 'CH2Cl2', 'Et3N', 'Pd(PPh3)4', 'Pd2(dba)3', '[Ir(cod)Cl]2', 'B2pin2']);
    expect(words('SN2, S1, 3a, THF, IC50, OD600, HCT116')).toEqual([]);
    expect(words('stirred under N2 with Br2')).toEqual(['N2', 'Br2']);
    expect(words('1H, H2 and N2-alkylation')).toEqual([]);
  });
  it('finds number ranges, not CAS numbers or dates', () => {
    expect(rangeMatches('7.36-7.29 and 1-3').length).toBe(2);
    expect(rangeMatches('7647-01-0, 2024-10-04, C2-3, 6-31G')).toEqual([]);
  });
  it('formats NMR text', () => {
    const t = (runs: Run[]): string => runs.map((r) => (r.valign === 'sub' ? `_${r.text}` : r.valign === 'super' ? `^${r.text}` : r.italic ? `*${r.text}*` : r.text)).join('');
    expect(t(formatNmr([{ text: '13C NMR (101MHz, DMSO-d6) δ 7.2-7.1 (d, J = 8 Hz)' }]))).toBe('^13C NMR (101 MHz, DMSO-*d*_6) δ 7.2–7.1 (d, *J* = 8 Hz)');
    expect(t(formatChemistry([{ text: 'dried over MgSO4 in d4-MeOH' }]))).toBe('dried over MgSO_4 in *d*_4-MeOH');
  });
});

describe('the same compound text as SI Assistant', () => {
  it('on the example project', async () => { await compare('si-example'); });
  it('on the checks project', async () => { await compare('si-checks'); });
  it('with every kind of data', async () => { await compare('si-blocks'); });
});
