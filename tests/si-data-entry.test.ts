// Round 3 of the SI Assistant integration: the project dictionary, the NMR impurities table, the
// PubChem name lookup and the dashboards, each kept in the files as Chem SI Assistant keeps them.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, valuesOf, type SiCompound } from '../src/si/project';
import { addDictionaryWord, dictionaryWords, withWord } from '../src/si/dictionary';
import { DEFAULT_TOLERANCES, defaultImpurityTable, impurityRowFrom, impurityTolerances, projectImpurityTable, storeImpurityTable, storeImpurityTolerances } from '../src/si/nmr';
import { dumpPyJson } from '../src/si/pyjson';
import { lookupName, NOT_FOUND_TEXT, type Fetch } from '../src/si/pubchem-name';
import {
  DEFAULT_STATUS_COLORS, availableColumns, buildRows, cellStatus, chosenColumns, fieldSummary, filterRows, percent, projectScope,
  sectionScope, setView, shownColumns, statusColors, storeStatusColors, summarize, summaryText, type DashboardFacts,
} from '../src/si/dashboard';
import { fieldDef } from '../src/si/fields';

const FIXTURE = join(__dirname, 'fixtures', 'si-example');
function exampleFolder(): MemoryFolder {
  const f = new MemoryFolder('Example project');
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(FIXTURE, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(FIXTURE);
  return f;
}
const DATA = 's-972b3c47';

describe('the project dictionary (dictionary.txt)', () => {
  it('adds a word in alphabetical order, keeping comments, once in any capitals', () => {
    const text = '# Words of this project\nbenzyl\nTBS\n';
    expect(withWord(text, 'CDK2')).toBe('# Words of this project\nbenzyl\nCDK2\nTBS\n');
    expect(withWord(text, 'zinc')).toBe('# Words of this project\nbenzyl\nTBS\nzinc\n');
    expect(withWord(text, 'tbs')).toBeNull();
    expect(withWord('', 'Boc')).toBe('Boc\n');
    expect(withWord('a\r\nc\r\n\r\n', 'b')).toBe('a\nb\nc\n');
  });

  it('reads and writes the file in the project folder', async () => {
    const f = new MemoryFolder('p');
    expect(await dictionaryWords(f)).toEqual([]);
    expect(await addDictionaryWord(f, 'Boc')).toBe(true);
    expect(await addDictionaryWord(f, 'BOC')).toBe(false);
    expect(await addDictionaryWord(f, 'Ad')).toBe(true);
    expect(await f.readText('dictionary.txt')).toBe('Ad\nBoc\n');
    await f.writeText('dictionary.txt', '# shared\nCbz\n\n');
    expect(await dictionaryWords(f)).toEqual(['Cbz']);
  });
});

describe('the NMR impurities table', () => {
  it('is not stored while it is the built-in one', () => {
    const s: Record<string, unknown> = { impurity_table: [] };
    storeImpurityTable(s, defaultImpurityTable());
    expect('impurity_table' in s).toBe(false);
    expect(projectImpurityTable(s)).toEqual(defaultImpurityTable());
  });

  it('keeps an edited table with its shifts as floats (2.0, not 2)', () => {
    const s: Record<string, unknown> = {};
    const rows = defaultImpurityTable();
    rows[0] = { ...rows[0], on: false };
    rows.push(impurityRowFrom(true, 'chloroform-d', '1H', '2.00', 'my grease')!);
    storeImpurityTable(s, rows);
    const t = projectImpurityTable(s);
    expect(t).toHaveLength(rows.length);
    expect(t[0].on).toBe(false);
    expect(t[t.length - 1]).toEqual({ solvent: 'CDCl3', nucleus: '1H', shift: 2, what: 'my grease', on: true });
    expect(dumpPyJson(s)).toContain('"shift": 2.0');
  });

  it('reads a typed row, leaving out one with no shift', () => {
    expect(impurityRowFrom(true, 'CDCl3', '¹³C', '77.16', 'CHCl3')?.nucleus).toBe('13C');
    expect(impurityRowFrom(true, 'CDCl3', '1H', '', 'x')).toBeNull();
    expect(impurityRowFrom(true, 'CDCl3', '1H', 'abc', 'x')).toBeNull();
  });

  it('stores the tolerances only when they differ from the defaults, and drops the older keys', () => {
    const s: Record<string, unknown> = { impurity_tolerance_1H: 0.02, impurity_tolerance_13C: 0.03 };
    storeImpurityTolerances(s, DEFAULT_TOLERANCES[0], 0.1);
    expect(s).toEqual({ impurity_tolerance_13C_ppm: 0.1 });
    expect(impurityTolerances(s)).toEqual([DEFAULT_TOLERANCES[0], 0.1]);
    storeImpurityTolerances(s, 0.02, DEFAULT_TOLERANCES[1]);
    expect(dumpPyJson(s)).toContain('"impurity_tolerance_1H_ppm": 0.02');
    expect('impurity_tolerance_13C_ppm' in s).toBe(false);
  });
});

describe('Name from PubChem', () => {
  const KEY = 'WAPNOHKVXSQRPX-SSDOTTSWSA-N';
  const answer = (props: object[]): Response => new Response(JSON.stringify({ PropertyTable: { Properties: props } }), { status: 200 });
  const fake = (routes: Record<string, () => Response>): { fetch: Fetch; asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      fetch: (async (url: string) => {
        asked.push(String(url));
        for (const [part, r] of Object.entries(routes)) if (String(url).includes(`/inchikey/${part}/`)) return r();
        return new Response('', { status: 404 });
      }) as Fetch,
    };
  };

  it('sends only the InChIKey, and takes the IUPAC name of the exact structure', async () => {
    const f = fake({ [KEY]: () => answer([{ CID: 6993942, IUPACName: '(1R)-1-phenylethanol', Title: '(R)-1-Phenylethanol' }]) });
    const r = await lookupName(KEY, 1, f.fetch);
    expect(r.status).toBe('found');
    expect(r.name).toBe('(1R)-1-phenylethanol');
    expect(r.cid).toBe(6993942);
    expect(f.asked).toEqual([`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/${KEY}/property/IUPACName,Title/JSON`]);
  });

  it('falls back to the atoms and bonds only when PubChem has exactly one compound for them', async () => {
    const one = fake({ WAPNOHKVXSQRPX: () => answer([{ CID: 7409, IUPACName: '1-phenylethanol', Title: '1-Phenylethanol' }]) });
    const r = await lookupName(KEY, 1, one.fetch);
    expect(r.status).toBe('no_stereo');
    expect(r.message).toMatch(/without \(or with other\) stereochemistry/);
    expect(one.asked[1]).toContain('/inchikey/WAPNOHKVXSQRPX/');
    const many = fake({ WAPNOHKVXSQRPX: () => answer([{ CID: 1, IUPACName: 'a' }, { CID: 2, IUPACName: 'b' }]) });
    expect((await lookupName(KEY, 1, many.fetch)).status).toBe('not_found');
  });

  it('says what happened when it is not found, busy or offline', async () => {
    const none = await lookupName(KEY, 2, fake({}).fetch);
    expect(none.status).toBe('not_found');
    expect(none.message).toContain('2 pieces');
    expect(none.message).toContain(NOT_FOUND_TEXT);
    const busy = await lookupName(KEY, 1, fake({ [KEY]: () => new Response('', { status: 503 }) }).fetch);
    expect(busy.status).toBe('error');
    expect(busy.message).toMatch(/busy/);
    const offline = await lookupName(KEY, 1, (async () => { throw new TypeError('Failed to fetch'); }) as Fetch);
    expect(offline.message).toMatch(/could not be reached/);
    expect((await lookupName('  ', 1, fake({}).fetch)).status).toBe('error');
  });

  it('keeps name.from_pubchem only while the name is unchanged', async () => {
    const p = await SiProject.open(exampleFolder());
    const c = p.compounds[0];
    await p.setValue(c, 'name', { text: '1-phenylethanol', from_pubchem: { cid: 7409, name: '1-phenylethanol', stereo: false } });
    expect((valuesOf(c).name as Record<string, unknown>).from_pubchem).toBeTruthy();
    await p.setValue(c, 'name', { ...(valuesOf(c).name as object), text: '(R)-1-phenylethanol' });
    expect((valuesOf(c).name as Record<string, unknown>).from_pubchem).toBeUndefined();
  });
});

describe('the dashboards', () => {
  const facts = (over: Partial<DashboardFacts> = {}): DashboardFacts => ({
    idOf: (c: SiCompound) => c.id.slice(0, 4), warnings: () => [], label: (r) => r, formula: () => ({ formula: 'C8H10O', generic: [] }), hrmsPpm: () => 0.8, ...over,
  });

  it('builds a row per compound, its cells filled, missing, empty or not used', async () => {
    const p = await SiProject.open(exampleFolder());
    const s = p.dataSections.find((x) => x.id.startsWith(DATA))!;
    const scope = sectionScope(s);
    const rows = buildRows(p, scope, facts());
    expect(rows).toHaveLength(scope.compounds.length);
    expect(rows.every((r) => r.cells.get('yield')!.state === 'filled')).toBe(true);
    expect(summaryText(rows)).toBe(`${rows.length} / ${rows.length} compounds complete · 0 flags · 0 warnings`);
    // a required field emptied is missing; a flag and a warning color the cell
    const c = scope.compounds[0];
    await p.setValue(c, 'yield', { percent: '', mass: '', mass_unit: 'mg' });
    const flagged = facts({ warnings: (x) => (x === c ? [{ check: 'hrms', field: 'hrms', message: 'HRMS is off by 9 ppm' }] : []) });
    const again = buildRows(p, sectionScope(s), flagged);
    const r = again.find((x) => x.compound === c)!;
    expect(r.cells.get('yield')!.state).toBe('missing');
    expect(r.cells.get('yield')!.summary).toBe('');
    expect(r.missing.length).toBeGreaterThan(0);
    expect(cellStatus(r.cells.get('hrms')!)).toBe('warning');
    expect(filterRows(again, 'incomplete')).toEqual([r]);
    expect(filterRows(again, 'warnings')).toEqual([r]);
    expect(filterRows(again, 'flagged')).toEqual([]);
    expect(summaryText(again)).toMatch(/^\d+ \/ \d+ compounds complete · 0 flags · 1 warning$/);
  });

  it('summarizes a cell in a few words', async () => {
    const p = await SiProject.open(exampleFolder());
    const c = p.compounds.find((x) => (valuesOf(x).yield as Record<string, string> | undefined)?.percent === '94')!;
    expect(fieldSummary(p, c, fieldDef({ key: 'yield' })!, facts())).toBe('94% · 57.4 mg');
    expect(fieldSummary(p, c, fieldDef({ key: 'structure' })!, facts())).toBe('C8H10O');
    expect(fieldSummary(p, c, fieldDef({ key: 'hrms' })!, facts())).toMatch(/\(Δ \+0\.8 ppm\)$/);
  });

  it('keeps the view choices where SI Assistant keeps them', async () => {
    const p = await SiProject.open(exampleFolder());
    const s = p.dataSections[0];
    const all = availableColumns(sectionScope(s));
    expect(all).not.toContain('structure');
    expect(all).not.toContain('name');
    setView(s.data, 'columns', ['yield', 'nmr']);
    setView(s.data, 'split_nuclei', true);
    expect(chosenColumns(sectionScope(s))).toEqual(['yield', 'nmr']);
    expect(shownColumns(sectionScope(s))).toEqual(['yield', 'nmr:1H', 'nmr:13C', 'nmr:19F']);
    setView(p.settings, 'filter', 'flagged', 'project_dashboard');
    expect(projectScope(p).view).toEqual({ filter: 'flagged' });
  });

  it('stores only the status colors that differ from the standard ones', () => {
    const s: Record<string, unknown> = {};
    storeStatusColors(s, { ...DEFAULT_STATUS_COLORS });
    expect('status_colors' in s).toBe(false);
    storeStatusColors(s, { ...DEFAULT_STATUS_COLORS, missing: '#FF0000', empty: '#eeeeee', filled: 'green' });
    expect(s.status_colors).toEqual({ missing: '#ff0000', empty: '#eeeeee' });
    expect(statusColors(s).missing).toBe('#ff0000');
    expect(statusColors({ status_colors: { filled: 'not a color' } }).filled).toBe(DEFAULT_STATUS_COLORS.filled);
  });

  it('works out the progress by section, rounding down', async () => {
    const p = await SiProject.open(exampleFolder());
    const rows = buildRows(p, projectScope(p), facts());
    const sum = summarize(p, p.dataSections.map((s) => [s, rows.filter((r) => r.compound.sectionId === s.id)]));
    expect(sum.compounds).toBe(p.compounds.length);
    expect(sum.missing).toEqual([]);
    expect(percent(2, 3)).toBe(66);
    expect(percent(199, 200)).toBe(99);
    expect(percent(0, 0)).toBe(100);
  });
});
