// Project structure in the SI Project tab: Duplicate, moving scheme pages, Attachment sections'
// files and Save Snapshot, each as Chem SI Assistant does them.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { unzipSync } from 'fflate';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, compoundName, valuesOf } from '../src/si/project';
import { checkCopies, copyName, copyableFields, duplicateCompound, duplicateScheme, neverCopiedFields } from '../src/si/duplicate';
import { saveSnapshot } from '../src/si/snapshot';
import { listTrash, restoreFromTrash } from '../src/si/trash';
import { allBoxes, editorData } from '../src/si/scheme-edit';

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
const DATA = 's-972b3c47', TEXT = 's-c1aa3466';

describe('Duplicate', () => {
  it('copies the fields chosen and never the files, ID or flags', async () => {
    const p = await SiProject.open(exampleFolder());
    const c = p.compound('c-6c300e43');
    expect(copyableFields(c).map((d) => d.key)).not.toContain('spectra');
    expect(neverCopiedFields(c).map((d) => d.key)).toEqual(['nmr', 'spectra']);
    c.data.id_override = '9z';
    c.data.flags = { yield: { comment: 'check' } };
    valuesOf(c).hrms = { ...(valuesOf(c).hrms as object), found_from: { file: 'x.pdf' } };
    const [copy] = await duplicateCompound(p, c, ['structure', 'name', 'procedure', 'hrms']);
    expect(copy.data.fields).toEqual(c.data.fields);
    expect(compoundName(copy)).toBe(compoundName(c));
    expect(await p.readStructure(copy)).toBe(await p.readStructure(c));
    expect(p.compoundText(copy, 'procedure')).toBe(p.compoundText(c, 'procedure'));
    expect(p.compoundText(copy, 'procedure')).not.toBe('');
    expect(valuesOf(copy).yield).toBeUndefined();
    expect(valuesOf(copy).hrms).not.toHaveProperty('found_from');
    expect(copy.data.id_override).toBe('');
    expect(copy.data.flags).toEqual({});
    // (a compound of a scheme page is copied as a page of its own, at the end)
    const s = p.section(DATA);
    expect(s.items[s.items.length - 1]).toBe(copy);
  });

  it('puts copies right after the original when asked', async () => {
    const p = await SiProject.open(exampleFolder());
    const s = p.section(DATA);
    const first = s.items.find((i) => i.kind === 'compound')!;
    const at = s.items.indexOf(first);
    const made = await duplicateCompound(p, p.compound(first.id), [], 2, 'after');
    expect(s.items.slice(at, at + 3)).toEqual([first, ...made]);
    expect(() => checkCopies(51)).toThrow(/between 1 and 50/);
    expect(copyName('Route', 1, 1)).toBe('Route (copy)');
    expect(copyName('Route', 2, 3)).toBe('Route (copy 2)');
  });

  it('copies a scheme page with its drawing, and links its boxes to the copies', async () => {
    const f = exampleFolder();
    const p = await SiProject.open(f);
    const k = p.scheme('k-95c635ac');
    const [copy] = await duplicateScheme(p, k, ['structure', 'name']);
    expect(copy.data.name).toBe('Acetylation of 1-(4-bromophenyl)ethan-1-ol (copy)');
    expect(copy.children).toHaveLength(1);
    const linked = allBoxes(copy).map(([b]) => b.compound).filter(Boolean);
    expect(linked).toEqual([copy.children[0].id]);
    expect(String(allBoxes(copy)[0][0].label)).toBe(String(allBoxes(k)[0][0].label));
    expect(editorData(copy).steps[0].top).toBe(editorData(k).steps[0].top);
    expect(f.files.has(`${copy.folder}/editor/b-3f624a6a.mol`)).toBe(true);
    const again = await SiProject.open(f);
    expect(again.scheme(copy.id).children.map((c) => c.id)).toEqual([copy.children[0].id]);
  });
});

describe('moving scheme pages and Attachment sections', () => {
  it('moves a scheme page with its compounds to another Data section', async () => {
    const f = exampleFolder();
    const p = await SiProject.open(f);
    const other = await p.addSection('data', 'More compounds');
    await p.moveScheme('k-95c635ac', other.id, 0);
    const again = await SiProject.open(f);
    const k = again.scheme('k-95c635ac');
    expect(k.sectionId).toBe(other.id);
    expect(k.children.map((c) => c.id)).toEqual(['c-6c300e43']);
    expect(k.folder.startsWith(other.folder)).toBe(true);
    expect(again.section(DATA).items.some((i) => i.id === 'k-95c635ac')).toBe(false);
  });

  it('keeps an Attachment section’s replaced file in the Trash, and restores it', async () => {
    const p = await SiProject.open(exampleFolder());
    const s = await p.addSection('file', 'HPLC traces');
    expect(s.data).toMatchObject({ file: null, heading: '', caption: '' });
    await p.attachSectionFile(s, 'traces.pdf', new Uint8Array([1]));
    await p.attachSectionFile(s, 'traces v2.pdf', new Uint8Array([2]));
    expect(s.data.file).toBe('traces v2.pdf');
    const [entry] = await listTrash(p);
    expect(entry).toMatchObject({ kind: 'file', name: 'traces.pdf' });
    await restoreFromTrash(p, entry.id);
    const now = p.section(s.id);
    expect(now.data.file).toBe('traces.pdf');
    expect((await listTrash(p)).map((e) => e.name)).toEqual(['traces v2.pdf']);
  });
});

describe('Save Snapshot', () => {
  it('zips the project into snapshots/, without build files or earlier snapshots', async () => {
    const f = exampleFolder();
    f.files.set('build/compiled.pdf', new Uint8Array([9]));
    f.files.set('.lock', new Uint8Array([9]));
    const p = await SiProject.open(f);
    const path = await saveSnapshot(p, 'Submitted version', new Date(2026, 10, 18, 9, 5, 7));
    expect(path).toBe('snapshots/2026-11-18_090507_submitted-version.zip');
    const second = await saveSnapshot(p, 'Submitted version', new Date(2026, 10, 18, 9, 5, 7));
    expect(second).toBe('snapshots/2026-11-18_090507_submitted-version (2).zip');
    const zip = unzipSync(f.files.get(path)!);
    const names = Object.keys(zip);
    expect(names).toContain('Example project/project.json');
    expect(names.some((n) => n.includes('/build/') || n.includes('/snapshots/') || n.endsWith('.lock'))).toBe(false);
    expect(names.filter((n) => !n.startsWith('Example project/'))).toEqual([]);
    expect(zip['Example project/project.json']).toEqual(f.files.get('project.json'));
    expect(TEXT).toBeTruthy();
  });
});
