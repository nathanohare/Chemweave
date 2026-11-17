// SI projects (Chem SI Assistant's folders): read and written so that the files come out as
// SI Assistant writes them, the ID rules, the field library and the text format.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { dumpPyJson, parsePyJson, pyFloat } from '../src/si/pyjson';
import { MemoryFolder, decodeText } from '../src/si/folder';
import { SiProject, compoundName, compoundsOf, fieldKeys, idTableOf, valuesOf } from '../src/si/project';
import { assignIds, checkIds, displayId, indexForLetters, lettersFor, patternIds } from '../src/si/compound-ids';
import { eeWithUnit, fieldDef, isFilled, learnedChoices, nucleusLabel, ALL_FIELDS } from '../src/si/fields';
import { parseMarkup, writeMarkup, mentionsIn, citationsIn, plainMarkup } from '../src/si/markup';
import { avoidDeviceName, safeFilename, slugify, newId } from '../src/si/ids';

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

describe('JSON as SI Assistant writes it', () => {
  it('writes decimals as Python does', () => {
    expect(pyFloat(5)).toBe('5.0');
    expect(pyFloat(0.1)).toBe('0.1');
    expect(pyFloat(1e-4)).toBe('0.0001');
    expect(pyFloat(1e-5)).toBe('1e-05');
    expect(pyFloat(1.5e16)).toBe('1.5e+16');
    expect(pyFloat(123456.75)).toBe('123456.75');
    expect(pyFloat(-2.5)).toBe('-2.5');
  });
  it('keeps "5.0" a decimal, even when changed', () => {
    const o = parsePyJson('{"a": 5.0, "b": 5, "c": [1.0, 2]}') as Record<string, unknown>;
    expect(dumpPyJson(o)).toBe('{\n  "a": 5.0,\n  "b": 5,\n  "c": [\n    1.0,\n    2\n  ]\n}\n');
    o.a = 6;
    expect(dumpPyJson(o)).toContain('"a": 6.0');
  });
  it('writes empty lists and objects, and non-ASCII characters as they are', () => {
    expect(dumpPyJson({ a: [], b: {}, c: 'δ 7.25 – SiO₂ "q"' })).toBe('{\n  "a": [],\n  "b": {},\n  "c": "δ 7.25 – SiO₂ \\"q\\""\n}\n');
  });
  it('reads a byte-order mark and Windows-1252 text', () => {
    expect(parsePyJson('\ufeff[1]')).toEqual([1]);
    expect(decodeText(new Uint8Array([0x32, 0x30, 0xb0, 0x43]))).toBe('20°C');
  });
});

describe('SI project folders', () => {
  it('opens the example project', async () => {
    const p = await SiProject.open(exampleFolder());
    expect(p.warnings).toEqual([]);
    expect(p.top.map((s) => s.name)).toEqual(['Reaction Optimization', 'Synthesis and Characterization', 'Spectra']);
    const data = p.dataSections[0];
    expect(idTableOf(data)).toEqual(['2a', '2b', '2c', '2d', '2e', '2f', '3']);
    const r = p.idReport();
    const names = compoundsOf(data).map((c) => `${displayId(r, c.id)} ${compoundName(c)}`);
    expect(names[1]).toBe('2b 1-(4-Methoxyphenyl)ethan-1-ol');
    expect(names.length).toBe(7);
    expect(p.references.length).toBeGreaterThan(0);
  });

  it('saves every file back exactly as it was', async () => {
    const f = exampleFolder();
    const before = new Map(f.files);
    const p = await SiProject.open(f);
    await p.saveSettings();
    for (const s of p.sections) await p.saveSection(s);
    for (const c of p.compounds) await p.saveCompound(c);
    await p.saveReferences();
    for (const [k, v] of before) expect(f.text(k), k).toBe(decodeText(v));
    expect([...f.files.keys()].sort()).toEqual([...before.keys()].sort());
  });

  it('keeps what it does not know about', async () => {
    const f = exampleFolder();
    const path = 'sections/s-972b3c47_synthesis-and-charac/compounds/c-cf3f4417_1-4-methoxyphe/compound.json';
    const raw = parsePyJson(f.text(path)!) as Record<string, unknown>;
    (raw.values as Record<string, unknown>).new_field = ['x'];
    await f.writeText(path, dumpPyJson(raw).replace('{\n', '{\n  "future_thing": {"kept": 1.0},\n'));
    const p = await SiProject.open(f);
    const c = p.compound('c-cf3f4417');
    await p.setPart(c, 'yield', 'percent', '92');
    const back = parsePyJson(f.text(path)!) as Record<string, any>;
    expect(back.future_thing).toEqual({ kept: 1 });
    expect(f.text(path)).toContain('"kept": 1.0');
    expect(back.values.new_field).toEqual(['x']);
    expect(back.values.yield.percent).toBe('92');
  });

  it('makes sections and compounds the way SI Assistant does', async () => {
    const f = new MemoryFolder('New SI');
    const p = await SiProject.create(f, 'New SI');
    const s = await p.addSection('data', 'Synthesis and Characterization');
    expect(s.folder).toMatch(/^sections\/s-[0-9a-f]{8}_synthesis-and-charac$/);
    await p.setIdTable(s.id, patternIds('3', 'letters', 'a', 3));
    const c = await p.addCompound(s.id, undefined, 'Ethyl benzoate');
    expect(fieldKeys(c)).toEqual(['structure', 'name', 'procedure', 'scale', 'yield', 'physical_state', 'rf', 'nmr', 'hrms', 'spectra', 'files', 'notes']);
    expect(valuesOf(c).scale).toEqual({ value: '', unit: '' });
    expect((valuesOf(c).nmr as { nucleus: string }[]).map((r) => r.nucleus)).toEqual(['1H', '13C']);
    expect(displayId(p.idReport(), c.id)).toBe('3a');
    const project = parsePyJson(f.text('project.json')!) as Record<string, unknown>;
    expect(project.section_tree).toEqual([{ id: s.id }]);
    expect(f.text('project.json')).toContain('"hrms_tolerance_ppm": 5.0');
    // reopened, the same
    const q = await SiProject.open(f);
    expect(q.compounds.map(compoundName)).toEqual(['Ethyl benzoate']);
    expect(q.completion(q.compounds[0])).toEqual({ filled: 0, total: 8, missing: ['Structure', 'Experimental procedure', 'Reaction scale', 'Yield', 'Physical state', 'NMR peak reports', 'HRMS', 'Spectra'] });
  });

  it('counts a general procedure as the procedure, and a structure once stored', async () => {
    const p = await SiProject.open(exampleFolder());
    const c = p.compound('c-cf3f4417');
    expect(p.compoundGp(c)?.name).toBe('General Procedure A');
    expect(p.completion(c)).toEqual({ filled: 8, total: 8, missing: [] });
  });

  it('moves compounds (IDs follow) and sends deleted ones to the Trash', async () => {
    const f = exampleFolder();
    const p = await SiProject.open(f);
    const s = p.dataSections[0];
    const first = compoundsOf(s)[0];
    await p.moveCompound('c-cf3f4417', s.id, 1);
    expect(displayId(p.idReport(), 'c-cf3f4417')).toBe('2a');
    expect(displayId(p.idReport(), first.id)).toBe('2b');
    await p.deleteCompound('c-cf3f4417');
    expect(p.compounds.some((c) => c.id === 'c-cf3f4417')).toBe(false);
    const entry = [...f.files.keys()].find((k) => k.startsWith('trash/') && k.endsWith('/entry.json'))!;
    const info = parsePyJson(f.text(entry)!) as Record<string, unknown>;
    expect(info).toMatchObject({ kind: 'compound', compound_id: 'c-cf3f4417', item: 'c-cf3f4417_1-4-methoxyphe', original_index: 1 });
    expect(info.pending).toBeUndefined();
    expect([...f.files.keys()].some((k) => k.endsWith('c-cf3f4417_1-4-methoxyphe/compound.json') && k.startsWith('trash/'))).toBe(true);
    const order = (parsePyJson(f.text(`${s.folder}/section.json`)!) as { compound_order: string[] }).compound_order;
    expect(order).not.toContain('c-cf3f4417');
  });

  it('keeps a compound whose file can’t be read in its place', async () => {
    const f = exampleFolder();
    const bad = 'sections/s-972b3c47_synthesis-and-charac/compounds/c-26c39a99_1-phenylethan/compound.json';
    await f.writeText(bad, '{ damaged');
    const p = await SiProject.open(f);
    expect(p.warnings.some((w) => w.includes('c-26c39a99_1-phenylethan'))).toBe(true);
    const s = p.dataSections[0];
    await p.saveSection(s);
    const order = (parsePyJson(f.text(`${s.folder}/section.json`)!) as { compound_order: string[] }).compound_order;
    expect(order.indexOf('c-26c39a99')).toBe(1);
  });

  it('opens a project from a newer SI Assistant read-only', async () => {
    const f = exampleFolder();
    const raw = parsePyJson(f.text('project.json')!) as Record<string, unknown>;
    raw.format_version = 2;
    await f.writeText('project.json', dumpPyJson(raw));
    const p = await SiProject.open(f);
    expect(p.readOnly).toBe(true);
    await expect(p.saveSettings()).rejects.toThrow(/read-only/);
  });

  it('writes a lock SI Assistant understands, and takes it away', async () => {
    const f = exampleFolder();
    const p = await SiProject.open(f);
    await p.acquireLock('nate', 'NPO-Laptop');
    const lock = parsePyJson(f.text('.lock')!) as Record<string, string>;
    expect(Object.keys(lock)).toEqual(['user', 'computer', 'opened_at', 'session']);
    expect(await p.lockStillOurs()).toBe(true);
    await p.release();
    expect(f.files.has('.lock')).toBe(false);
  });

  it('adds a reference once per DOI', async () => {
    const p = await SiProject.open(exampleFolder());
    const n = p.references.length;
    const a = await p.addReference({ type: 'article', title: 'X', doi: '10.1000/ABC' });
    const b = await p.addReference({ type: 'article', title: 'X again', doi: '10.1000/abc' });
    expect(a).toBe(b);
    expect(p.references.length).toBe(n + 1);
  });
});

describe('compound IDs', () => {
  it('counts in letters and numbers', () => {
    expect([0, 25, 26, 27, 701, 702].map(lettersFor)).toEqual(['a', 'z', 'aa', 'ab', 'zz', 'aaa']);
    expect(indexForLetters('aa')).toBe(26);
    expect(patternIds('3', 'letters', 'y', 3)).toEqual(['3y', '3z', '3aa']);
    expect(patternIds('S', 'numbers', '9', 2)).toEqual(['S9', 'S10']);
  });
  it('lets a Manual ID use up its row', () => {
    expect(assignIds(['', 'X1', '', ''], ['1a', '1b', '1c'])).toEqual(['1a', 'X1', '1c', null]);
    expect(assignIds([''], [' '])).toEqual([null]);
  });
  it('warns about missing and repeated IDs', () => {
    const r = checkIds([
      { sectionId: 's1', sectionName: 'A', table: ['1a', '1A', ''], compoundIds: ['c1', 'c2', 'c3'], overrides: ['', '', ''] },
      { sectionId: 's2', sectionName: 'B', table: ['1a'], compoundIds: [], overrides: [] },
    ]);
    expect(r.compoundWarnings.get('c1')![0]).toMatch(/^Duplicate ID/);
    expect(r.compoundWarnings.get('c3')![0]).toMatch(/row 3 of the ID table is empty/);
    expect(r.tableWarnings.get('s1:0')).toMatch(/also in row\(s\) 2/);
    expect(r.tableWarnings.get('s2:0')).toMatch(/already used by/);
  });
});

describe('the field library', () => {
  it('knows when a field is filled', () => {
    const y = ALL_FIELDS.get('yield')!;
    expect(isFilled(y, { percent: '91', mass: '69.2', mass_unit: 'mg', note: '' })).toBe(true);
    expect(isFilled(y, { percent: '91', mass: '', mass_unit: 'mg' })).toBe(false);
    expect(isFilled(ALL_FIELDS.get('nmr')!, [{ text: ' ' }, { text: 'δ 7.2' }])).toBe(true);
    expect(isFilled(ALL_FIELDS.get('references')!, { text: 'x', refs: [] })).toBe(false);
    expect(fieldDef({ key: 'purity', custom: { label: 'Purity', type: 'number_unit' } })?.parts?.map((p) => p.key)).toEqual(['value', 'unit']);
    expect(fieldDef({ key: 'mystery' })).toBeNull();
  });
  it('shows nuclei, ee and learned choices', () => {
    expect(nucleusLabel('13C')).toBe('¹³C');
    expect(eeWithUnit('99%')).toBe('99% ee');
    expect(eeWithUnit('97:3')).toBe('97:3 er');
    expect(eeWithUnit('94% ee')).toBe('94% ee');
    const part = ALL_FIELDS.get('physical_state')!.parts![0];
    expect(learnedChoices(part, ['amber oil', 'colorless oil', 'Amber Oil']).slice(-1)).toEqual(['amber oil']);
  });
});

describe('the text format', () => {
  const cases = [
    '**¹H NMR** (400 MHz, CDCl_{3}) δ 7.25 (d, *J* = 2.0 Hz, 1H)',
    'Prepared from @{c-7f3a2c91} as reported.@cite{r-1,r-2}',
    '# A heading',
    '!align{center} centered',
    '!figure{f-12345678} The caption',
    'a\\_b and \\*not italic\\* and 5 \\^ 2 and \\}',
    '\\# not a heading',
    '__under__ ___{2}__ ^{+}',
  ];
  it.each(cases)('reads and writes %s unchanged', (t) => {
    expect(writeMarkup(parseMarkup(t))).toBe(t);
  });
  it('finds mentions and citations', () => {
    const ps = parseMarkup(cases[1]);
    expect(mentionsIn(ps)).toEqual(['c-7f3a2c91']);
    expect(citationsIn(ps)).toEqual(['r-1', 'r-2']);
    expect(plainMarkup(cases[1], (r) => (r.startsWith('c:') ? '2b' : '¹'))).toBe('Prepared from 2b as reported.¹');
    const runs = parseMarkup(cases[0])[0].runs;
    expect(runs.find((r) => r.text === '3')?.valign).toBe('sub');
  });
});

describe('IDs and folder names', () => {
  it('makes names as SI Assistant does', () => {
    expect(slugify('1-(4-Methoxyphenyl)ethan-1-ol', 14)).toBe('1-4-methoxyphe');
    expect(slugify('Synthèse β', 40)).toBe('synthese');
    expect(slugify('—', 40)).toBe('untitled');
    expect(slugify('Aux', 40)).toBe('aux_');
    expect(safeFilename('a/b:c?.txt ')).toBe('a_b_c_.txt');
    expect(avoidDeviceName('com1.tar.gz')).toBe('com1_.tar.gz');
    expect(newId('c')).toMatch(/^c-[0-9a-f]{8}$/);
  });
});
