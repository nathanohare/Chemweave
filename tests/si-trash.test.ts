// The SI project's Trash, shared with Chem SI Assistant: what Chemweave deletes goes there in SI
// Assistant's form, and the Trash window lists, restores and empties the same folder.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder, isTrashPath } from '../src/si/folder';
import { parsePyJson } from '../src/si/pyjson';
import { SiProject, type Json } from '../src/si/project';
import { deleteFromTrash, emptyTrash, listTrash, restoreFromTrash } from '../src/si/trash';

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
const snapshot = (f: MemoryFolder): Map<string, string> => new Map([...f.files].filter(([k]) => !k.startsWith('trash/')).map(([k, v]) => [k, Buffer.from(v).toString('hex')]));
const DATA = 's-972b3c47', TEXT = 's-c1aa3466', SPECTRA = 's-d79a6040';

describe('the Trash', () => {
  it('restores a deleted section to its place, leaving the folder as it was', async () => {
    const f = exampleFolder();
    const p = await SiProject.open(f);
    const before = snapshot(f);
    await p.deleteSection(DATA);
    expect(p.top.map((s) => s.id)).toEqual([TEXT, SPECTRA]);
    const [entry] = await listTrash(p);
    expect(entry).toMatchObject({ kind: 'section', name: 'Synthesis and Characterization', pending: false });
    expect(entry.info).toMatchObject({ section_id: DATA, type: 'data', original_index: 1, parent_id: '', tree: { id: DATA }, subsections: 0 });
    expect(await restoreFromTrash(p, entry.id)).toBe('Restored section “Synthesis and Characterization”.');
    expect(p.top.map((s) => s.id)).toEqual([TEXT, DATA, SPECTRA]);
    expect(p.compounds.length).toBeGreaterThan(0);
    expect(await listTrash(p)).toEqual([]);
    expect(snapshot(f)).toEqual(before);
  });

  it('keeps sub-sections with their section and puts it back inside its parent', async () => {
    const p = await SiProject.open(exampleFolder());
    const a = await p.addSection('text', 'Methods', undefined, TEXT);
    const b = await p.addSection('text', 'Glassware', undefined, a.id);
    await p.deleteSection(a.id);
    expect(p.section(TEXT).children).toEqual([]);
    const [entry] = await listTrash(p);
    expect(entry.info).toMatchObject({ parent_id: TEXT, subsections: 1, tree: { id: a.id, children: [{ id: b.id }] } });
    expect(entry.info.companions).toEqual([b.folder.split('/').pop()]);
    expect(await restoreFromTrash(p, entry.id)).toBe('Restored section “Methods” with 1 sub-section.');
    expect(p.section(TEXT).children.map((s) => s.id)).toEqual([a.id]);
    expect(p.section(a.id).children.map((s) => s.id)).toEqual([b.id]);
  });

  it('puts a section whose parent is gone at the top level', async () => {
    const p = await SiProject.open(exampleFolder());
    const a = await p.addSection('text', 'Methods', undefined, TEXT);
    await p.deleteSection(a.id);
    await p.deleteSection(TEXT);
    const entry = (await listTrash(p)).find((e) => e.info.section_id === a.id)!;
    expect(await restoreFromTrash(p, entry.id)).toContain('put at the top level');
    expect(p.top.map((s) => s.id)).toContain(a.id);
  });

  it('never deletes the Spectra section', async () => {
    const p = await SiProject.open(exampleFolder());
    await expect(p.deleteSection(SPECTRA)).rejects.toThrow(/can’t be deleted/);
  });

  it('restores compounds, scheme pages and general procedures where they were', async () => {
    const f = exampleFolder();
    const p = await SiProject.open(f);
    const s = p.section(DATA);
    const ids = s.items.map((i) => i.id);
    const gp = p.generalProcedures(s)[0];
    const before = snapshot(f);
    await p.deleteCompound(ids[1]);
    await p.deleteGeneralProcedure(String(gp.id));
    expect(p.generalProcedures(p.section(DATA))).toEqual([]);
    for (const e of await listTrash(p)) await restoreFromTrash(p, e.id);
    expect(p.section(DATA).items.map((i) => i.id)).toEqual(ids);
    expect(p.generalProcedures(p.section(DATA))[0]).toEqual(gp);
    expect(snapshot(f)).toEqual(before);

    const k = await p.addScheme(DATA, 0, 'Route');
    const c = await p.addSchemeCompound(k, 0, 'ketone');
    await p.deleteScheme(k.id);
    expect(p.schemes.map((x) => x.id)).not.toContain(k.id);
    const [entry] = await listTrash(p);
    expect(entry.info).toMatchObject({ kind: 'scheme', scheme_id: k.id, original_index: 0, children: [c.folder.split('/').pop()] });
    await restoreFromTrash(p, entry.id);
    expect(p.section(DATA).items[0].id).toBe(k.id);
    expect(p.scheme(k.id).children.map((x) => x.id)).toEqual([c.id]);
  });

  it('puts a figure back at the end of its text with its caption', async () => {
    const p = await SiProject.open(exampleFolder());
    const s = p.section(TEXT);
    const path = await p.addSectionPicture(s, 'plot.png', new Uint8Array([1, 2, 3]));
    s.data.figures = { 'f-1': { file: path, label: 'Figure A' } };
    await p.saveSection(s);
    await p.writeSectionText(s, 'Text.\n!align{right} !figure{f-1} The **plot**.');
    await p.deleteTextObject(s, 'figure', 'f-1');
    expect(await p.readSectionText(s)).toBe('Text.');
    const [entry] = await listTrash(p);
    expect(entry.info).toMatchObject({ kind: 'figure', object_id: 'f-1', align: 'right', caption: 'The **plot**.', label: 'Figure A' });
    expect(await restoreFromTrash(p, entry.id)).toBe('Restored the figure at the end of “Reaction Optimization”.');
    expect(await p.readSectionText(s)).toBe('Text.\n!align{right} !figure{f-1} The **plot**.');
    expect((s.data.figures as Json)['f-1']).toMatchObject({ file: 'images/plot.png', label: 'Figure A' });
    expect(await p.readSectionFile(s, 'images/plot.png')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('lists what it can’t restore and leaves it to move back by hand', async () => {
    const f = exampleFolder();
    const p = await SiProject.open(f);
    f.files.set('trash/20261101-120000-aaaa/entry.json', new TextEncoder().encode('{"kind": "scheme_file", "name": "paper.png", "item": "paper.png", "deleted_at": "2026-11-01T12:00:00", "deleted_by": "Nathan"}'));
    f.files.set('trash/20261101-120000-aaaa/paper.png', new Uint8Array([1]));
    f.files.set('trash/20261102-090000-bbbb/stray.pdf', new Uint8Array([2]));
    f.files.set('trash/20261103-090000-cccc/entry.json', new TextEncoder().encode('{"kind": "compound", "name": "x", "item": "../project.json", "pending": true}'));
    const list = await listTrash(p);
    expect(list.map((e) => [e.kind, e.name])).toEqual([
      ['compound', 'x (deletion did not finish)'],
      ['incomplete', 'Unfinished deletion: stray.pdf'],
      ['scheme_file', 'paper.png'],
    ]);
    expect(list[2]).toMatchObject({ deletedAt: '2026-11-01T12:00:00', deletedBy: 'Nathan' });
    await expect(restoreFromTrash(p, list[2].id)).rejects.toThrow(/can't be put back here/);
    await expect(restoreFromTrash(p, list[1].id)).rejects.toThrow(/can't tell where/);
    await expect(restoreFromTrash(p, list[0].id)).rejects.toThrow(/damaged/);
    expect(f.files.has('project.json')).toBe(true);
    await deleteFromTrash(p, list[1].id);
    expect((await listTrash(p)).length).toBe(2);
    await emptyTrash(p);
    expect([...f.files.keys()].some((k) => k.startsWith('trash/'))).toBe(false);
    expect(f.files.has('project.json')).toBe(true);
  });

  it('only ever deletes inside the Trash', async () => {
    expect(isTrashPath('trash')).toBe(true);
    expect(isTrashPath('trash/20261101-x')).toBe(true);
    expect(isTrashPath('trash/a/b')).toBe(false);
    expect(isTrashPath('trash/..')).toBe(false);
    expect(isTrashPath('sections')).toBe(false);
    const f = new MemoryFolder();
    await expect(f.removeTrash('sections')).rejects.toThrow();
    expect(parsePyJson('[]')).toEqual([]);
  });
});

describe('stored files (Store additional files and folders)', () => {
  it('stores a file in private/ as SI Assistant lists it, keeps its note, and comes back from the Trash', async () => {
    const f = exampleFolder();
    const p = await SiProject.open(f);
    const c = p.compounds.find((x) => !x.schemeId)!;
    const name = await p.addPrivateFile(c, '1H NMR.mnova', new Uint8Array([1, 2, 3]));
    expect(name).toBe('1H NMR.mnova');
    expect(await p.addPrivateFile(c, '1H NMR.mnova', new Uint8Array([4]))).toBe('1H NMR (2).mnova');
    expect([...f.files.get(`${c.folder}/private/1H NMR.mnova`)!]).toEqual([1, 2, 3]);
    await p.setPrivateNote(c, name, 'processed, CDCl3');
    const read = parsePyJson(new TextDecoder().decode(f.files.get(`${c.folder}/compound.json`)!)) as Json;
    expect((read.values as Json).private_files).toEqual([
      { file: '1H NMR.mnova', kind: 'file', note: 'processed, CDCl3' },
      { file: '1H NMR (2).mnova', kind: 'file', note: '' },
    ]);
    await p.removePrivateItem(c, name);
    expect(f.files.has(`${c.folder}/private/1H NMR.mnova`)).toBe(false);
    const entry = (await listTrash(p)).find((e) => e.info.field_key === 'private_files')!;
    expect(await restoreFromTrash(p, entry.id)).toContain('Restored 1H NMR.mnova');
    expect([...f.files.get(`${c.folder}/private/1H NMR.mnova`)!]).toEqual([1, 2, 3]);
    const back = (await SiProject.open(f)).compounds.find((x) => x.id === c.id)!;
    expect((back.data.values as Json).private_files).toContainEqual({ file: '1H NMR.mnova', kind: 'file', note: 'processed, CDCl3' });
    // a hand-edited name never reaches outside private/
    await p.removePrivateItem(c, '../structure.mol');
    expect(f.files.has(`${c.folder}/structure.mol`)).toBe(true);
  });
});
