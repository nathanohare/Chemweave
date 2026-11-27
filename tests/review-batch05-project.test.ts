// Code review 2026-11-26, batch 05 (SI builder): the SI project's files, its Trash and Undo, on
// the example project (made by hand for the tests, tests/fixtures/si-example). No chemistry values.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { JournalFolder } from '../src/si/journal';
import { SiProject, compoundsOf, fieldKeys, valuesOf, type Json } from '../src/si/project';
import { ALL_FIELDS } from '../src/si/fields';
import { listTrash, restoreFromTrash } from '../src/si/trash';
import * as E from '../src/si/scheme-edit';
import { storePageSettings, pageSettings } from '../src/si/page-setup';
import { storeSiDrawingStyle } from '../src/si/drawing-style';
import { ACS_1996 } from '../src/style';
import { projectWarnings } from '../src/si/project-warnings';

const ROOT = join(__dirname, 'fixtures', 'si-example');
function folder<T extends MemoryFolder>(make: () => T): T {
  const f = make();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(ROOT, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(ROOT);
  return f;
}
const example = (): MemoryFolder => folder(() => new MemoryFolder('si-example'));
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const json = (f: MemoryFolder, rel: string): Json => JSON.parse(new TextDecoder().decode(f.files.get(rel)));
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('F223: restoring a spectrum whose name is taken again', () => {
  it('its original follows its new name', async () => {
    const f = example();
    const p = await SiProject.open(f);
    const c = p.compounds[0];
    const def = ALL_FIELDS.get('spectra')!;
    if (!fieldKeys(c).includes('spectra')) await p.addField(c, { key: 'spectra' });
    const dir = `${c.folder}/${def.subdir || 'spectra'}`;
    f.files.set(`${dir}/pasted 1H.svg`, enc('<svg>first</svg>'));
    f.files.set(`${dir}/pasted 1H.emf`, enc('emf-first'));
    valuesOf(c).spectra = [{ file: 'pasted 1H.svg', type: '1H', original: 'pasted 1H.emf' }];
    await p.saveCompound(c);
    await p.removeAttachment(c, def, 'pasted 1H.svg');
    // a second spectrum takes the same names
    f.files.set(`${dir}/pasted 1H.svg`, enc('<svg>second</svg>'));
    f.files.set(`${dir}/pasted 1H.emf`, enc('emf-second'));
    (valuesOf(c).spectra as Json[]).push({ file: 'pasted 1H.svg', type: '1H', original: 'pasted 1H.emf' });
    await p.saveCompound(c);
    const entry = (await listTrash(p)).find((e) => e.kind === 'compound_file')!;
    await restoreFromTrash(p, entry.id);
    await p.reload();
    const back = (valuesOf(p.compounds[0]).spectra as Json[]).find((x) => x.file !== 'pasted 1H.svg')!;
    expect(back.file).toBe('pasted 1H (2).svg');
    expect(back.original).toBe('pasted 1H (2).emf');
    expect(new TextDecoder().decode(f.files.get(`${dir}/pasted 1H (2).emf`))).toBe('emf-first');
    expect(new TextDecoder().decode(f.files.get(`${dir}/pasted 1H.emf`))).toBe('emf-second');
  });

  it('an original that cannot be put back stays in the Trash as files to move by hand', async () => {
    const f = example();
    const p = await SiProject.open(f);
    const c = p.compounds[0];
    const def = ALL_FIELDS.get('spectra')!;
    if (!fieldKeys(c).includes('spectra')) await p.addField(c, { key: 'spectra' });
    const dir = `${c.folder}/${def.subdir || 'spectra'}`;
    f.files.set(`${dir}/pasted 1H.svg`, enc('<svg>first</svg>'));
    f.files.set(`${dir}/pasted 1H.emf`, enc('emf-first'));
    valuesOf(c).spectra = [{ file: 'pasted 1H.svg', type: '1H', original: 'pasted 1H.emf' }];
    await p.saveCompound(c);
    await p.removeAttachment(c, def, 'pasted 1H.svg');
    const entry = (await listTrash(p)).find((e) => e.kind === 'compound_file')!;
    const move = f.move.bind(f);
    f.move = async (from, to) => { if (from.endsWith('.emf') && !to.toLowerCase().includes('trash')) throw new Error('locked'); await move(from, to); };
    const message = await restoreFromTrash(p, entry.id);
    expect(message).toMatch(/pasted 1H\.emf could not be put back beside it; it is still in the Trash .*to move back by hand/);
    const left = await listTrash(p);
    expect(left.some((e) => e.kind === 'compound_file')).toBe(false);
    expect(left.some((e) => e.kind === 'incomplete' && e.name.includes('pasted 1H.emf'))).toBe(true);
  });
});

describe('F924: a write under way when Undo is asked for', () => {
  it('is finished, and recorded, before Undo runs', async () => {
    const mem = new MemoryFolder('j');
    const j = new JournalFolder(mem);
    await j.step('First', () => j.writeText('a.txt', '1'));
    const write = mem.writeText.bind(mem);
    mem.writeText = async (rel, text) => { await tick(30); await write(rel, text); };
    const saving = j.writeText('a.txt', '2');
    await tick(5);
    // (the save is undone, not the step before it)
    expect(await j.undo()).toBe('Change');
    await saving;
    expect(await mem.readText('a.txt')).toBe('1');
    expect(j.history(false)).toBe('First');
  });
  it('a move under way is finished, and recorded, before Undo runs', async () => {
    const mem = new MemoryFolder('j');
    const j = new JournalFolder(mem);
    await j.step('First', () => j.writeText('a/x.txt', '1'));
    const move = mem.move.bind(mem);
    let slow = true;
    mem.move = async (from, to) => { if (slow) { slow = false; await tick(30); } await move(from, to); };
    const moving = j.move('a/x.txt', 'a/y.txt');
    await tick(5);
    expect(await j.undo()).toBe('Change');
    await moving;
    expect(await mem.readText('a/x.txt')).toBe('1');
    expect(await mem.exists('a/y.txt')).toBe(false);
    expect(j.history(false)).toBe('First');
  });
});

describe('F935: saving page settings keeps keys it does not know', () => {
  it('a key of SI Assistant’s or a later version stays', () => {
    const s: Json = { page: { from_si_assistant: { x: 1 } } };
    storePageSettings(s, { ...pageSettings(s), header: ['x', '', ''] });
    expect((s.page as Json).from_si_assistant).toEqual({ x: 1 });
  });
});

describe('F921: a label font chosen with the default sizes', () => {
  it('is written for SI Assistant', () => {
    const s: Json = {};
    storeSiDrawingStyle(s, { ...ACS_1996, labelFont: 'Times New Roman' });
    expect((s.structure_drawing as Json | undefined)?.font).toBe('Times New Roman');
  });
});

describe('F938: opening a project reads only the compounds’ own texts', () => {
  it('not .txt files attached in their folders', async () => {
    const f = example();
    const c = 'sections/s-972b3c47_synthesis-and-charac/compounds/c-26c39a99_1-phenylethan';
    f.files.set(`${c}/hrms/peaks.txt`, enc('100.0 5'));
    f.files.set(`${c}/private/log.txt`, enc('a log'));
    const read: string[] = [];
    const text = f.readText.bind(f);
    f.readText = async (rel) => { read.push(rel); return text(rel); };
    await SiProject.open(f);
    expect(read.filter((r) => r.endsWith('peaks.txt') || r.endsWith('log.txt'))).toEqual([]);
  });
});

describe('F939: deleting a section while another one can’t be read', () => {
  it('the Trash entry holds the deleted section’s own place in the tree', async () => {
    const f = example();
    // (Reaction Optimization's section.json damaged: it is skipped on opening)
    f.files.set('sections/s-c1aa3466_reaction-optimizatio/section.json', enc('{ not json'));
    const p = await SiProject.open(f);
    await p.deleteSection('s-972b3c47');
    const entry = [...f.files.keys()].filter((k) => /^trash\/[^/]+\/entry\.json$/.test(k)).map((k) => json(f, k)).find((e) => e.kind === 'section')!;
    expect((entry.tree as Json).id).toBe('s-972b3c47');
  });
});

describe('F940: a picture added beside one of another extension', () => {
  it('never writes over it', async () => {
    const f = example();
    const p = await SiProject.open(f);
    const s = p.sections.find((x) => x.type === 'text') ?? await p.addSection('text', 'Pictures');
    f.files.set(`${s.folder}/images/figure.wmf`, enc('old wmf'));
    const rel = await p.addSectionPicture(s, 'figure.wmf', enc('new wmf'));
    expect(rel).toBe('images/figure (2).wmf');
    expect(new TextDecoder().decode(f.files.get(`${s.folder}/images/figure.wmf`))).toBe('old wmf');
  });
});

describe('F941: replacing an X-ray section’s CIF when the new one can’t be put in place', () => {
  it('leaves the section with its old file', async () => {
    const f = example();
    const p = await SiProject.open(f);
    const s = await p.addSection('xray', 'Crystal');
    await p.attachSectionFile(s, 'old.cif', enc('data_old'));
    const move = f.move.bind(f);
    f.move = async (from, to) => { if (from.includes('.incoming-')) throw new Error('locked by another program'); return move(from, to); };
    await expect(p.attachSectionFile(s, 'new.cif', enc('data_new'))).rejects.toThrow();
    expect(s.data.file).toBe('old.cif');
    expect(new TextDecoder().decode(f.files.get(`${s.folder}/old.cif`))).toBe('data_old');
  });
});

describe('F942: Apply Default Fields with Notes among the defaults', () => {
  it('lists Notes once', async () => {
    const f = example();
    const p = await SiProject.open(f);
    const s = p.sections.find((x) => x.id === 's-972b3c47')!;
    s.data.default_fields = [{ key: 'name' }, { key: 'notes' }, { key: 'yield' }];
    await p.applyDefaultFields(s.id);
    for (const c of compoundsOf(s)) expect(fieldKeys(c).filter((k) => k === 'notes')).toHaveLength(1);
  });
});

describe('F943 and F948: scheme pages when a file can’t be moved or written', () => {
  const SCHEME = 'k-730d7f01';
  it('a compound that can’t leave for another section keeps its scheme box', async () => {
    const f = example();
    const p = await SiProject.open(f);
    const k = p.schemes.find((x) => x.id === SCHEME)!;
    const c = p.compounds.find((x) => x.sectionId === k.sectionId && !x.schemeId)!;
    await p.moveCompound(c.id, k.sectionId, 0, k.id);
    const box = E.editorData(k).steps[0].products[0];
    box.compound = c.id;
    await p.saveScheme(k);
    const other = await p.addSection('data', 'Other');
    const move = f.move.bind(f);
    f.move = async (from, to) => { if (from === c.folder) throw new Error('a file in it is open in another program'); return move(from, to); };
    await expect(p.moveCompound(c.id, other.id, 0)).rejects.toThrow();
    expect(E.editorData(k).steps[0].products[0].compound).toBe(c.id);
    expect(((json(f, `${k.folder}/scheme.json`).editor as Json).steps as Json[])[0]).toMatchObject({ products: [{ compound: c.id }] });
  });

  it('a structure drawn over a box’s picture that can’t be written keeps the picture', async () => {
    const f = example();
    const p = await SiProject.open(f);
    const k = p.schemes.find((x) => x.id === SCHEME)!;
    const box = E.editorData(k).starting[0];
    // (a box showing a picture instead of a structure)
    delete box.structure;
    box.picture = 'editor/pasted.png';
    f.files.set(`${k.folder}/editor/pasted.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await p.saveScheme(k);
    const write = f.writeText.bind(f);
    f.writeText = async (rel, text) => { if (rel.endsWith('.mol')) throw new Error('not writable'); return write(rel, text); };
    await expect(E.setBoxStructure(p, k, String(box.id), 'mol\n')).rejects.toThrow();
    expect(box.picture).toBe('editor/pasted.png');
    expect(f.files.has(`${k.folder}/editor/pasted.png`)).toBe(true);
  });

  it('a picture that can’t go to the Trash stays, and leaves no MOL file that nothing names', async () => {
    const f = example();
    const p = await SiProject.open(f);
    const k = p.schemes.find((x) => x.id === SCHEME)!;
    const box = E.editorData(k).starting[0];
    delete box.structure;
    box.picture = 'editor/pasted.png';
    f.files.set(`${k.folder}/editor/pasted.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await p.saveScheme(k);
    const mols = (): string[] => [...f.files.keys()].filter((x) => x.startsWith(`${k.folder}/editor/`) && x.endsWith('.mol'));
    const before = mols();
    const move = f.move.bind(f);
    f.move = async (from, to) => { if (from.endsWith('pasted.png')) throw new Error('locked'); return move(from, to); };
    await expect(E.setBoxStructure(p, k, String(box.id), 'mol\n')).rejects.toThrow();
    expect(box.picture).toBe('editor/pasted.png');
    // (the new MOL file is the box's structure, beside the picture it keeps)
    const made = mols().filter((x) => !before.includes(x));
    expect(made.map((x) => x.slice(k.folder.length + 1))).toEqual([String(box.structure)]);
    expect(((json(f, `${k.folder}/scheme.json`).editor as Json).starting as Json[])[0]).toMatchObject({ picture: 'editor/pasted.png', structure: box.structure });
  });
});

describe('F937: a reference whose authors are one line of text', () => {
  it('is named by its first author, as a list of authors is', async () => {
    const p = await SiProject.open(example());
    p.references = [{ id: 'r-1', type: 'article', title: 'A title long enough to tell apart', year: '2010', authors: 'Smith, J., Jones, K., Lee, M.' }];
    const warnings = await projectWarnings(p);
    const w = warnings.find((x) => x.check === 'reference');
    expect(w?.message).toContain('Reference “Smith 2010”');
  });
});
