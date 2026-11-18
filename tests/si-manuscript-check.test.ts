// @vitest-environment jsdom
// The manuscript check (SI Assistant SPEC §13o): reading Word and ChemDraw files, the comparison
// with the SI, dismissing, the manuscript folder and its cache. Expected results are SI
// Assistant's own on the same made-up files (tests/fixtures/manuscript, made with its
// tests/manuscript_samples.py).

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, valuesOf } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { prepareReaders, readFile, type Source } from '../src/si/ms-read';
import {
  addManuscriptFile, cachedSources, checkManuscript, compareStructures, dismissFinding, forget, manuscriptFiles,
  problemsOf, readAll, removeManuscriptFile, resolver, restoreFinding, summary, DISMISSED, MANUSCRIPT_DIR, NOTE, OK, type Result,
} from '../src/si/ms-check';
import { listTrash, restoreFromTrash } from '../src/si/trash';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
const DIR = join(__dirname, 'fixtures', 'manuscript');
const expected = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8'));
const bytesOf = (name: string): Uint8Array => new Uint8Array(readFileSync(join(DIR, 'files', name)));
const FOOTNOTE_B = 'Reaction run for 48 h at 60 °C.';
const FOOTNOTE_C = 'Using 10 mol% catalyst in toluene.';

beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
  await prepareReaders();
}, 60000);

const smiles = async (mb: string): Promise<string | null> => { const m = RDKit.get_mol(mb); try { return m?.is_valid() ? m.get_smiles() : null; } finally { m?.delete(); } };
const facts = async (ms: string[]) => ms.map((m) => molFacts(RDKit, m));
const read = (name: string): Promise<Source> => readFile(name, bytesOf(name), { smiles });
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const comparable = (s: Source) => ({ ...plain(s), mentioned: [...s.mentioned].sort() });

/** The made-up SI (SI Assistant's manuscript_samples.build_si). */
async function madeUpSi(): Promise<{ p: SiProject; f: MemoryFolder; label: (id: string) => string }> {
  const f = new MemoryFolder('Made-up SI');
  for (const [rel, text] of Object.entries(expected.si as Record<string, string>)) f.files.set(rel, new TextEncoder().encode(text));
  const p = await SiProject.open(f);
  const report = p.idReport();
  return { p, f, label: (id) => (id ? report.ids.get(id) ?? '' : '') };
}

const shape = (r: Result, label: (id: string) => string) => ({
  summary: summary(r), checked: r.checked, notes: r.notes,
  findings: r.findings.map((x) => ({ kind: x.kind, label: x.label, message: x.message, status: x.status, ms_value: x.ms_value, si_value: x.si_value, where: x.where, key: x.key, fingerprint: x.fingerprint, compound: label(x.compound_id) })),
});
const sourceOf = (j: Record<string, unknown>): Source => j as unknown as Source;

describe('reading Word and ChemDraw files (parity with SI Assistant)', () => {
  const names = Object.keys(expected.files).filter((n) => !n.endsWith('.pdf'));
  for (const name of names) {
    it(name, async () => {
      expect(comparable(await read(name))).toEqual({ ...expected.files[name], mentioned: [...expected.files[name].mentioned].sort() });
    });
  }

  it('reads the structures of a ChemDraw file, and not its atom labels as text', async () => {
    const src = await read('scheme.cdxml');
    const recs = Object.fromEntries(src.records.map((r) => [r.id, r]));
    expect(recs['3a'].smiles).toBe('COC(=O)c1ccc(Br)cc1');
    expect(recs['3i'].smiles).toBe('CC(=O)c1ccccc1');
    expect(src.tokens).not.toContain('o');
    expect(src.tokens).not.toContain('br');
  });

  it('a deeply nested ChemDraw file is read without its structures', async () => {
    const deep = new TextEncoder().encode(`<CDXML>${'<group>'.repeat(3000)}${'</group>'.repeat(3000)}</CDXML>`);
    const src = await readFile('deep.cdxml', deep, { smiles });
    expect(src.records).toEqual([]);
    expect(src.notes.some((n) => n.includes('nested'))).toBe(true);
  });

  it('a file that could not be opened just now is read again later', async () => {
    const src = await readFile('ms.docx', null);
    expect(src.transient).toBe(true);
    expect(src.error).toContain('could not be opened just now');
  });
});

describe('reading PDF files', () => {
  it('reads the scheme labels, the table, the footnotes and the names', async () => {
    const src = await read('ms.pdf');
    expect(src.error).toBe('');
    expect(src.figure_text).toBe(true);
    const fig = Object.fromEntries(src.records.filter((r) => r.source === 'figure').map((r) => [r.id, r]));
    expect([fig['3a'].yield, fig['3a'].ee]).toEqual(['92', '95']);
    expect([fig['3b'].yield, fig['3b'].er, fig['3b'].footnotes]).toEqual(['85', '97:3', ['b']]);
    expect((fig['3b'].conditions as Record<string, string>).b).toBe(FOOTNOTE_B);
    expect(fig['3c'].dr).toBe('>20:1');
    expect(fig['3h'].yield).toBe('64');
    expect((fig['3h'].conditions as Record<string, string>).c).toBe(FOOTNOTE_C);
    expect(fig['3i'].ee).toBe('90');
    expect(fig['3a'].where).toBe('Scheme 2, p. 1');
    const table = Object.fromEntries(src.records.filter((r) => r.source === 'table').map((r) => [r.id, r]));
    expect([table['3d'].yield, table['3d'].ee]).toEqual(['88', '91']);
    expect(table['3e'].conditions).toEqual({ c: FOOTNOTE_C });
    expect(table['3e'].where).toBe('Table 1, p. 1');
    expect(new Set(src.names.map((n) => `${n.name}|${n.id}`))).toEqual(new Set(['methyl 4-bromobenzoate|3a', 'Ethyl 2-phenylpropanoate|3c']));
    expect(src.mentioned).toContain('3e');
    expect(src.tokens).toContain('3a');
  });

  it('a PDF whose figures are outlined: only the body text and tables', async () => {
    const src = await read('ms-nofig.pdf');
    expect(src.error).toBe('');
    expect(src.figure_text).toBe(false);
    expect(src.notes.some((n) => n.includes('outlined'))).toBe(true);
    expect(new Set(src.records.filter((r) => r.source === 'table').map((r) => r.id))).toEqual(new Set(['3d', '3e']));
  });

  it('reads a table turned sideways, and says when text is set at a slant', async () => {
    const src = await read('rotated.pdf');
    const table = Object.fromEntries(src.records.filter((r) => r.source === 'table').map((r) => [r.id, r]));
    expect([table['3d'].yield, table['3e'].ee]).toEqual(['88', '93']);
    expect(table['3d'].where).toBe('Table 1, p. 1');
    expect((await read('slanted.pdf')).notes.some((n) => n.includes('slant'))).toBe(true);
  });

  it('justified body text is not a figure label', async () => {
    for (const name of ['justified-12cm.pdf', 'justified-14cm.pdf']) {
      expect((await read(name)).records.filter((r) => r.source === 'figure')).toEqual([]);
    }
  });

  it('a damaged or picture-only PDF gives a message, never an error', async () => {
    for (const name of ['bad.pdf', 'empty.pdf']) expect((await read(name)).error).toContain(name);
    expect((await read('pic.pdf')).error).toContain('no text');
  });
});

describe('comparing with the SI (parity with SI Assistant)', () => {
  it('a Word manuscript and its ChemDraw file', async () => {
    const { p, label } = await madeUpSi();
    const r = await checkManuscript(p, [await read('ms.docx'), await read('scheme.cdxml')], { facts, files: 0 });
    expect(shape(r, label)).toEqual(expected.checks['docx+cdxml']);
  });

  for (const name of Object.keys(expected.synth)) {
    it(name, async () => {
      const { p, label } = await madeUpSi();
      const r = await checkManuscript(p, expected.synth[name].map(sourceOf), { facts, files: 0 });
      expect(shape(r, label)).toEqual(expected.checks[name]);
    });
  }

  it('a PDF manuscript and its ChemDraw file find every planted difference', async () => {
    const { p } = await madeUpSi();
    const r = await checkManuscript(p, [await read('ms.pdf'), await read('scheme.cdxml')], { facts, files: 2 });
    expect(new Set(problemsOf(r).map((f) => `${f.kind} ${f.label}`))).toEqual(new Set([
      'yield 3b', 'conditions 3b', 'structure 3c', 'name 3c', 'deviation 3d', 'conditions 3e', 'missing_si 3i']));
    expect(r.findings.some((f) => f.label === '3f')).toBe(false);
    const msg = Object.fromEntries(problemsOf(r).map((f) => [`${f.kind} ${f.label}`, f.message]));
    expect(msg['yield 3b']).toBe('3b: the manuscript gives 85% yield, the SI 82%.');
    expect(msg['conditions 3b']).toContain('mentions 48 h, which is not');
    expect(msg['structure 3c']).toBe('3c: the structure in scheme.cdxml (C11H14O2) is not the SI structure (C10H12O2).');
    expect(r.checked).toBe(6);
    expect(summary(r)).toMatch(/^6 compounds checked: 1 missing in the SI, 1 structure/);
    const where = Object.fromEntries(problemsOf(r).map((f) => [`${f.kind} ${f.label}`, f.where]));
    expect(where['missing_si 3i']).toBe('Scheme 2, p. 1 (PDF); scheme.cdxml');
  });

  it('a dismissed difference stays dismissed until its values change', async () => {
    const { p, f, label } = await madeUpSi();
    f.files.set(`${MANUSCRIPT_DIR}/dismissed.json`, new TextEncoder().encode(JSON.stringify(expected.dismissed)));
    const sources = [sourceOf(expected.files['ms.pdf']), sourceOf(expected.files['scheme.cdxml'])];
    expect(shape(await checkManuscript(p, sources, { facts, files: 0 }), label)).toEqual(expected.checks.dismissed);
    // the SI's yield changes: it comes back
    const c = p.compounds.find((x) => label(x.id) === '3b')!;
    (valuesOf(c).yield as Record<string, unknown>).percent = '80';
    expect(problemsOf(await checkManuscript(p, sources, { facts })).some((x) => x.kind === 'yield' && x.label === '3b')).toBe(true);
  });

  it('dismiss and restore write dismissed.json', async () => {
    const { p } = await madeUpSi();
    const sources = [await read('ms.docx'), await read('scheme.cdxml')];
    const r = await checkManuscript(p, sources, { facts });
    const y = problemsOf(r).find((x) => x.kind === 'yield')!;
    await dismissFinding(p, y, 'typo in the SI, fixed later', 'Tester');
    const again = await checkManuscript(p, sources, { facts });
    const g = again.findings.find((x) => x.key === y.key)!;
    expect(g.status).toBe(DISMISSED);
    expect(g.reason).toBe('typo in the SI, fixed later');
    expect(summary({ ...again, files: 2 })).toContain('(1 dismissed)');
    await restoreFinding(p, y.key);
    expect((await checkManuscript(p, sources, { facts })).findings.find((x) => x.key === y.key)!.status).toBe('problem');
  });

  it('structures: same, stereo, salt, charge, different', async () => {
    const mol = (x: string) => RDKit.get_mol(x).get_molblock();
    const status = async (ms: string, si: string) => (await compareStructures(facts, ms, mol(si)))[0];
    expect(await status('C[C@H](O)c1ccccc1', 'C[C@H](O)c1ccccc1')).toBe('same');
    expect(await status('C[C@H](O)c1ccccc1', 'C[C@@H](O)c1ccccc1')).toBe('stereo');
    expect(await status('CCN', 'CCN.Cl')).toBe('salt');
    expect(await status('CCN', 'CC[NH3+]')).toBe('charge');
    expect(await status('CCO', 'CCN')).toBe('different');
    expect(await status('not smiles', 'CCN')).toBe('');
    const a = await compareStructures(facts, 'CC(C)O', mol('CCCO')), b = await compareStructures(facts, 'COCC', mol('CCCO'));
    expect([a[0], b[0], a[2] === b[2], a[1] !== b[1]]).toEqual(['different', 'different', true, true]);
  });

  it('IDs with stereo prefixes find their SI compound', () => {
    const r = resolver(['cis-5a', 'trans-5a', '7']);
    expect(r('5a')).toBe('5a');
    expect(r('ent-7')).toBe('7');
    expect(r('trans-5a')).toBe('trans-5a');
  });
});

describe('the manuscript folder', () => {
  it('lists, reads once, keeps check.json, removes to the Trash and restores', async () => {
    const { p, f } = await madeUpSi();
    for (const n of ['.DS_Store', 'desktop.ini', 'Thumbs.db', '._ms.pdf', '~$ms.docx']) f.files.set(`${MANUSCRIPT_DIR}/${n}`, new Uint8Array([1]));
    await addManuscriptFile(p, 'ms.docx', bytesOf('ms.docx'));
    await addManuscriptFile(p, 'scheme.cdxml', bytesOf('scheme.cdxml'));
    expect(await manuscriptFiles(p)).toEqual(['ms.docx', 'scheme.cdxml']);
    const sources = await readAll(p, { smiles });
    expect(sources.map((s) => s.file)).toEqual(['ms.docx', 'scheme.cdxml']);
    expect(f.files.has(`${MANUSCRIPT_DIR}/check.json`)).toBe(true);
    expect(await manuscriptFiles(p)).toEqual(['ms.docx', 'scheme.cdxml']); // (its own files are not listed)
    forget(p);
    const back = await cachedSources(p); // read back from check.json
    expect(back?.map((s) => s.records.length)).toEqual(sources.map((s) => s.records.length));
    const r = await checkManuscript(p, back, { facts });
    expect(summary(r)).toMatch(/^6 compounds checked/);
    // a changed file: the cache no longer counts
    f.files.set(`${MANUSCRIPT_DIR}/ms.docx`, new Uint8Array([...bytesOf('ms.docx'), 10]));
    expect(await cachedSources(p)).toBeNull();
    // the Trash
    await removeManuscriptFile(p, 'scheme.cdxml');
    expect(await manuscriptFiles(p)).toEqual(['ms.docx']);
    const entry = (await listTrash(p)).find((e) => e.kind === 'manuscript_file')!;
    expect(await restoreFromTrash(p, entry.id)).toContain('Restored');
    expect(await manuscriptFiles(p)).toEqual(['ms.docx', 'scheme.cdxml']);
    // the same name again gets " (2)"
    expect(await addManuscriptFile(p, 'ms.docx', bytesOf('ms.docx'))).toBe('ms (2).docx');
  });

  it('no manuscript yet', async () => {
    const { p } = await madeUpSi();
    expect(summary(await checkManuscript(p, []))).toBe('No manuscript added yet.');
    const r = await checkManuscript(p, [sourceOf(expected.synth.a4[0])], { facts });
    expect(r.findings.map((x) => [x.kind, x.status])).toEqual([['mention', NOTE]]);
    expect(OK).toBe('ok');
  });
});
