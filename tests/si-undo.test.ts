// Undo and Redo in the SI Project tab: Chemweave's own history of the project's files. After Undo
// the project folder holds exactly what it held before the step (the files Undo took away wait
// in build/chemweave-undo until the project closes); Redo makes it as it was after the step.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { JournalFolder, MAX_STEPS, fingerprint } from '../src/si/journal';
import { emptyTrash, listTrash, restoreFromTrash } from '../src/si/trash';
import { duplicateScheme } from '../src/si/duplicate';
import { saveSnapshot } from '../src/si/snapshot';

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

/** The project's own files (not build/), as text, to compare. */
function state(f: MemoryFolder): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of f.files) if (!k.startsWith('build/')) out[k] = fingerprint(v);
  return out;
}

async function setup(): Promise<{ f: MemoryFolder; j: JournalFolder; p: SiProject }> {
  const f = exampleFolder();
  const j = new JournalFolder(f);
  const p = await SiProject.open(j);
  return { f, j, p };
}

/** Run `change` as one step; Undo puts every file back as it was, Redo as it was after. */
async function roundTrip(label: string, change: (p: SiProject) => Promise<unknown>): Promise<{ f: MemoryFolder; j: JournalFolder; p: SiProject }> {
  const all = await setup();
  const { f, j, p } = all;
  const before = state(f);
  await j.step(label, () => change(p));
  const after = state(f);
  expect(after).not.toEqual(before);
  expect(j.history(false)).toBe(label);
  expect(await j.undo()).toBe(label);
  expect(state(f)).toEqual(before);
  expect(j.history(false)).toBeNull();
  expect(j.history(true)).toBe(label);
  await p.reload();
  expect(await j.redo()).toBe(label);
  expect(state(f)).toEqual(after);
  await p.reload();
  return all;
}

describe('Undo and Redo of an SI project', () => {
  it('takes back adding a compound, and its new folder', async () => {
    const { p } = await roundTrip('New Compound', (p) => p.addCompound(DATA));
    expect(p.section(DATA).items.filter((i) => i.kind === 'compound').length).toBeGreaterThan(0);
  });

  it('takes back a section added, renamed, or moved', async () => {
    await roundTrip('New Section', (p) => p.addSection('text', 'Notes'));
    await roundTrip('Rename', (p) => p.renameSection(DATA, 'Experimental data'));
    await roundTrip('Move Up', async (p) => p.moveSection(DATA, 0, null));
  });

  it('takes back a delete (the item comes out of the Trash), and a restore', async () => {
    const { f, j, p } = await setup();
    const id = p.compounds[0].id;
    const start = state(f);
    await j.step('Delete', () => p.deleteCompound(id));
    await p.reload();
    expect(p.compounds.some((c) => c.id === id)).toBe(false);
    const [entry] = await listTrash(p);
    const deleted = state(f);
    await j.step('Restore', () => restoreFromTrash(p, entry.id));
    await p.reload();
    expect(p.compounds.some((c) => c.id === id)).toBe(true);
    await j.undo();
    expect(state(f)).toEqual(deleted);
    await j.undo();
    expect(state(f)).toEqual(start);
    expect(await listTrash(p)).toEqual([]);
    await j.redo();
    await j.redo();
    await p.reload();
    expect(p.compounds.some((c) => c.id === id)).toBe(true);
  });

  it('takes back Empty Trash until the project closes', async () => {
    const { f, j, p } = await setup();
    await j.step('Delete', () => p.deleteCompound(p.compounds[0].id));
    const full = state(f);
    await j.step('Empty Trash', () => emptyTrash(p));
    expect(await listTrash(p)).toEqual([]);
    await j.undo();
    expect(state(f)).toEqual(full);
    expect(await listTrash(p)).toHaveLength(1);
    await j.clear();
    expect([...f.files.keys()].some((k) => k.startsWith('build/chemweave-undo'))).toBe(false);
    expect(j.history(false)).toBeNull();
  });

  it('takes back a scheme page copied, with its compounds and drawing', async () => {
    await roundTrip('Duplicate', (p) => duplicateScheme(p, p.scheme('k-95c635ac'), ['structure', 'name']));
  });

  it('takes back a value typed in a field, and settings', async () => {
    await roundTrip('Edit', async (p) => { const c = p.compounds[0]; await p.setValue(c, 'yield', { text: '42' }); });
  });

  it('says so, and changes nothing, when a file was changed outside Chemweave since', async () => {
    const { f, j, p } = await setup();
    await j.step('Rename', () => p.renameSection(DATA, 'Experimental data'));
    const path = [...f.files.keys()].find((k) => k.endsWith('section.json') && f.text(k)!.includes('Experimental data'))!;
    f.files.set(path, new TextEncoder().encode(f.text(path)!.replace('Experimental data', 'Edited in SI Assistant')));
    const now = state(f);
    await expect(j.undo()).rejects.toThrow(/changes made outside Chemweave/);
    expect(state(f)).toEqual(now);
    expect(j.history(false)).toBe('Rename');
  });

  it('keeps one step per command, drops redo after a new change, and keeps at most MAX_STEPS', async () => {
    const { j, p } = await setup();
    await j.step('Outer', async () => { await j.step('Inner', () => p.addCompound(DATA)); await p.addCompound(DATA); });
    expect(j.history(false)).toBe('Outer');
    await j.undo();
    expect(j.history(true)).toBe('Outer');
    await j.step('Rename', () => p.renameSection(DATA, 'X'));
    expect(j.history(true)).toBeNull();
    for (let i = 0; i < MAX_STEPS + 5; i++) await j.step(`R${i}`, () => p.renameSection(DATA, `X${i}`));
    let n = 0;
    while (await j.undo()) n++;
    expect(n).toBe(MAX_STEPS);
  });

  it('records no step for a snapshot, the lock or a step that changed nothing', async () => {
    const { j, p } = await setup();
    await j.step('Save Snapshot', () => saveSnapshot(p, 'v1'));
    await j.step('Nothing', async () => {});
    await j.writeText('.lock', '{}');
    j.settle();
    expect(j.history(false)).toBeNull();
  });

  it('makes a change outside any command its own step', async () => {
    const { j, p } = await setup();
    await p.renameSection(DATA, 'Typed');
    expect(j.history(false)).toBe('Change');
    j.settle();
    expect(await j.undo()).toBe('Change');
  });
});
