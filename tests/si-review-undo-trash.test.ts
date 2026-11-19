// Regression tests from the review of Undo, the Trash and scheme pages: a box's old files go to
// the Trash (never deleted, on a desktop folder too) and Undo brings them back; a save still
// being written when its step ends; two Undos asked for at once; the holding folder and the
// bytes the history keeps.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder, DiskFolder, type SiFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { JournalFolder, MAX_STEPS, fingerprint } from '../src/si/journal';
import { emptyTrash, listTrash, restoreFromTrash } from '../src/si/trash';
import * as E from '../src/si/scheme-edit';

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
const KID = 'k-730d7f01';
const MOL = '\n  x\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\n    1.2000    0.0000    0.0000 O   0  0\n  1  2  1  0\nM  END\n';
function state(f: MemoryFolder): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of f.files) if (!k.startsWith('build/')) out[k] = fingerprint(v);
  return out;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A folder whose writes (and reads) take a while, like a real disk through Tauri IPC. */
class SlowFolder extends MemoryFolder {
  writeMs = 0; readMs = 0;
  async writeText(rel: string, text: string): Promise<void> { if (this.writeMs) await sleep(this.writeMs); return super.writeText(rel, text); }
  async writeBytes(rel: string, b: Uint8Array): Promise<void> { if (this.writeMs) await sleep(this.writeMs); return super.writeBytes(rel, b); }
  async readBytes(rel: string): Promise<Uint8Array | null> { if (this.readMs) await sleep(this.readMs); return super.readBytes(rel); }
  async exists(rel: string): Promise<boolean> { if (this.readMs) await sleep(this.readMs); return super.exists(rel); }
}

/** DiskFolder over an in-memory "disk" whose commands behave as src-tauri/src/folders.rs (si_remove_lock only deletes .lock). */
function fakeDisk(mem: MemoryFolder): SiFolder {
  const root = '/proj';
  const rel = (abs: string): string => (abs === root ? '' : abs.slice(root.length + 1));
  const invoke = async <T,>(cmd: string, args?: Record<string, unknown>, opts?: { headers: Record<string, string> }): Promise<T> => {
    const a = args as Record<string, string>;
    switch (cmd) {
      case 'read_binary_file': return (await mem.readBytes(rel(a.path)))!.buffer as T;
      case 'make_folder': return undefined as T;
      case 'write_text_file': await mem.writeText(rel(a.path), a.contents); return undefined as T;
      case 'write_binary_file': await mem.writeBytes(rel(decodeURIComponent(opts!.headers.path)), args as unknown as Uint8Array); return undefined as T;
      case 'path_exists': return (await mem.exists(rel(a.path))) as T;
      case 'list_folder': return { files: (await mem.list(rel(a.path), (args as { extensions: string[] }).extensions)).map((p) => ({ path: `${root}/${p}` })) } as T;
      case 'si_move': await mem.move(rel(a.from), rel(a.to)); return undefined as T;
      case 'si_remove_lock': {
        // folders.rs: only a file called .lock beside a project.json is ever deleted
        if (!a.path.endsWith('/.lock')) throw new Error(`not an SI project's lock: ${a.path}`);
        await mem.remove(rel(a.path)); return undefined as T;
      }
      case 'si_list_dir': return (await mem.entries(rel(a.path))) as T;
      case 'si_remove_trash': await mem.removeTrash(rel(a.path)); return undefined as T;
    }
    throw new Error('unknown ' + cmd);
  };
  return new DiskFolder(root, invoke as never);
}

describe('a box’s own files from before it showed a compound', () => {
  it('unlinks a box that was drawn then marked as a compound (desktop folder)', async () => {
    const mem = exampleFolder();
    const p = await SiProject.open(new JournalFolder(fakeDisk(mem)));
    const k = p.schemes.find((x) => x.id === KID)!;
    const b = await E.addBox(p, k, E.editorData(k).steps[0].id);
    await E.setBoxStructure(p, k, String(b.id), MOL);
    await E.markAsCompound(p, k, String(b.id));
    await expect(E.unlinkBox(p, k, String(b.id))).resolves.toBeUndefined();
  });
  it('sends them to the Trash as a scheme structure that can be restored; a picture drawn over too', async () => {
    const f = exampleFolder();
    const p = await SiProject.open(new JournalFolder(f));
    const k = p.schemes.find((x) => x.id === KID)!;
    const b = await E.addBox(p, k, E.editorData(k).steps[0].id);
    await E.setBoxStructure(p, k, String(b.id), MOL);
    await E.markAsCompound(p, k, String(b.id));
    await E.unlinkBox(p, k, String(b.id));
    let items = await listTrash(p);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'scheme_box', pending: false });
    expect(items[0].info).toMatchObject({ scheme_id: KID, where: E.editorData(k).steps[0].id, box: { id: b.id, structure: `editor/${b.id}.mol` }, files: { structure: `${b.id}.mol` } });
    expect(E.findBox(k, String(b.id))!.box.structure).toBe(`editor/${b.id} (2).mol`);
    const boxes = E.allBoxes(k).length;
    await restoreFromTrash(p, items[0].id);
    expect(E.allBoxes(k).length).toBe(boxes + 1);
    expect(await listTrash(p)).toHaveLength(0);
    // a picture pasted in SI Assistant, drawn over here
    const pic = await E.addBox(p, k, E.START);
    await p.folder.writeBytes(`${k.folder}/editor/${pic.id}.png`, new Uint8Array([1, 2, 3]));
    await p.folder.writeBytes(`${k.folder}/editor/${pic.id}.emf`, new Uint8Array([4]));
    Object.assign(pic, { picture: `editor/${pic.id}.png`, picture_source: 'chemdraw' });
    await p.saveScheme(k);
    await E.setBoxStructure(p, k, String(pic.id), MOL);
    items = await listTrash(p);
    expect(items[0]).toMatchObject({ kind: 'scheme_box' });
    expect(items[0].info).toMatchObject({ box: { picture: `editor/${pic.id}.png`, picture_source: 'chemdraw' }, files: { picture: `${pic.id}.png` }, companions: [`${pic.id}.emf`] });
    expect(E.findBox(k, String(pic.id))!.box.picture).toBeUndefined();
    await restoreFromTrash(p, items[0].id);
    const last = E.editorData(k).starting[E.editorData(k).starting.length - 1];
    expect(String(last.picture)).toMatch(/^editor\/b-.*\.png$/);
    expect(f.files.has(`${k.folder}/${String(last.picture).replace('.png', '.emf')}`)).toBe(true);
  });
  it('deletes a scheme compound whose box was drawn first (desktop folder)', async () => {
    const mem = exampleFolder();
    const p = await SiProject.open(new JournalFolder(fakeDisk(mem)));
    const k = p.schemes.find((x) => x.id === KID)!;
    const b = await E.addBox(p, k, E.editorData(k).steps[0].id);
    await E.setBoxStructure(p, k, String(b.id), MOL);
    const c = (await E.markAsCompound(p, k, String(b.id)))!;
    await expect(p.deleteCompound(c.id)).resolves.toBeUndefined();
  });
  it('undo of Unlink puts the folder back as it was, and earlier steps stay undoable (memory folder)', async () => {
    const f = exampleFolder();
    const j = new JournalFolder(f);
    const p = await SiProject.open(j);
    const k = p.schemes.find((x) => x.id === KID)!;
    const s0 = state(f);
    let id = '';
    await j.step('Draw', async () => { const b = await E.addBox(p, k, E.editorData(k).steps[0].id); id = String(b.id); await E.setBoxStructure(p, k, id, MOL); });
    await j.step('Mark', () => E.markAsCompound(p, k, id));
    const s2 = state(f);
    await j.step('Unlink', () => E.unlinkBox(p, k, id));
    await j.undo();
    expect(state(f)).toEqual(s2);
    await j.undo();
    await j.undo();
    expect(state(f)).toEqual(s0);
  });
});

describe('a save still being written when its step ends', () => {
  it('undo of the second save puts the first text back (does not take the file away)', async () => {
    const f = new SlowFolder();
    f.files.set('a/scheme.json', new TextEncoder().encode('v0'));
    const j = new JournalFolder(f);
    await j.writeText('a/scheme.json', 'v1');            // implicit step, ends 600 ms later
    await sleep(560);
    f.writeMs = 120;                                     // (a slow drive: the 600 ms timer fires during this write)
    await j.writeText('a/scheme.json', 'v2');
    f.writeMs = 0;
    j.settle();
    await j.undo();
    expect(f.text('a/scheme.json')).toBe('v1');
  });
});

describe('two Undo calls at once (Ctrl+Z held down)', () => {
  it('each call takes back one step, in order', async () => {
    const f = new SlowFolder();
    const j = new JournalFolder(f);
    await j.step('one', () => j.writeText('x.txt', '1'));
    await j.step('two', () => j.writeText('y.txt', '2'));
    await j.step('three', () => j.writeText('z.txt', '3'));
    f.readMs = 5;
    const got = await Promise.all([j.undo(), j.undo()]);
    f.readMs = 0;
    expect(got).toEqual(['three', 'two']);
    expect(['x.txt', 'y.txt', 'z.txt'].filter((n) => f.files.has(n))).toEqual(['x.txt']);
    expect(j.history(false)).toBe('one');
    expect(await j.redo()).toBe('two');
    expect(await j.redo()).toBe('three');
    expect(['x.txt', 'y.txt', 'z.txt'].filter((n) => f.files.has(n))).toEqual(['x.txt', 'y.txt', 'z.txt']);
  });
  it('keeps a command that starts during an Undo as its own step', async () => {
    const f = new SlowFolder();
    const j = new JournalFolder(f);
    await j.step('one', () => j.writeText('x.txt', '1'));
    await j.step('two', () => j.writeText('y.txt', '2'));
    f.readMs = 5;
    const undo = j.undo();
    const cmd = j.step('later', () => j.writeText('w.txt', 'w'));
    await Promise.all([undo, cmd]);
    f.readMs = 0;
    expect(f.files.has('y.txt')).toBe(false);
    expect(j.history(false)).toBe('later');
    expect(await j.undo()).toBe('later');
    expect(f.files.has('w.txt')).toBe(false);
    expect(await j.undo()).toBe('one');
  });
});

describe('what the history keeps', () => {
  const held = (f: MemoryFolder): string[] => [...f.files.keys()].filter((k) => k.startsWith('build/chemweave-undo/'));
  it('a file taken away with remove() comes back with Undo (only the lock is deleted)', async () => {
    const f = new MemoryFolder();
    f.files.set('a/b.txt', new TextEncoder().encode('b'));
    f.files.set('.lock', new TextEncoder().encode('{}'));
    const j = new JournalFolder(f);
    await j.step('Remove', () => j.remove('a/b.txt'));
    expect(f.files.has('a/b.txt')).toBe(false);
    await j.undo();
    expect(f.text('a/b.txt')).toBe('b');
    await j.remove('.lock');
    expect(f.files.has('.lock')).toBe(false);
    expect(j.history(false)).toBeNull();
  });
  it('empties the holding folder of steps that can no longer be redone or undone', async () => {
    const f = new MemoryFolder();
    const j = new JournalFolder(f);
    await j.step('make', () => j.writeText('a/new.txt', 'n'));
    await j.undo();
    expect(held(f).length).toBe(1);
    await j.step('other', () => j.writeText('b.txt', 'b'));   // (Redo of "make" is gone)
    await sleep(0);
    expect(held(f)).toEqual([]);
    f.files.set('trash/20260101-000000-abc/entry.json', new TextEncoder().encode('{}'));
    await j.step('Empty Trash', () => j.removeTrash('trash'));
    expect(held(f).length).toBe(1);
    for (let i = 0; i < MAX_STEPS; i++) await j.step(`s${i}`, () => j.writeText('b.txt', `b${i}`));
    await sleep(0);
    expect(held(f)).toEqual([]);
  });
  it('drops the oldest steps when the earlier contents kept pass the limit', async () => {
    const f = new MemoryFolder();
    const j = new JournalFolder(f);
    j.maxHeldBytes = 2500;
    f.files.set('big.bin', new Uint8Array(1000));
    for (let i = 1; i <= 5; i++) await j.step(`s${i}`, () => j.writeBytes('big.bin', new Uint8Array(1000).fill(i)));
    const left: string[] = [];
    for (let l = await j.undo(); l; l = await j.undo()) left.push(l);
    expect(left).toEqual(['s5', 's4']);
  });
});

/** The example project with a compound linked to a drawn box of the scheme page. */
async function withSchemeCompound(own = true): Promise<{ f: MemoryFolder; j: JournalFolder; p: SiProject; cid: string }> {
  const f = exampleFolder(); const j = new JournalFolder(f); const p = await SiProject.open(j);
  const k = p.schemes.find((x) => x.id === KID)!;
  const b = await E.addBox(p, k, E.editorData(k).steps[0].id);
  if (own) await E.setBoxStructure(p, k, String(b.id), MOL);
  const c = (await E.markAsCompound(p, k, String(b.id)))!;
  if (!own) await p.setStructure(c, MOL);
  await j.clear();
  await p.reload();
  return { f, j, p, cid: c.id };
}

describe('sequences', () => {
  it('delete a scheme compound, restore, undo twice, redo twice', async () => {
    const { f, j, p, cid } = await withSchemeCompound();
    const s0 = state(f);
    await j.step('Delete', () => p.deleteCompound(cid));
    const s1 = state(f);
    await j.step('Restore', async () => { await restoreFromTrash(p, (await listTrash(p))[0].id); });
    const s2 = state(f);
    await j.undo(); expect(state(f)).toEqual(s1);
    await j.undo(); expect(state(f)).toEqual(s0);
    await j.redo(); expect(state(f)).toEqual(s1);
    await j.redo(); expect(state(f)).toEqual(s2);
  });
  it('empty trash, undo, redo, undo', async () => {
    const { f, j, p } = await withSchemeCompound();
    const s0 = state(f);
    await j.step('Delete', () => p.deleteScheme(KID));
    await p.reload();
    const s1 = state(f);
    await j.step('Empty', () => emptyTrash(p));
    const s2 = state(f);
    await j.undo(); expect(state(f)).toEqual(s1);
    await j.redo(); expect(state(f)).toEqual(s2);
    await j.undo(); expect(state(f)).toEqual(s1);
    await j.undo(); expect(state(f)).toEqual(s0);
  });
  it('move out of a scheme, back in, convert: undo each', async () => {
    const { f, j, p, cid } = await withSchemeCompound();
    const s0 = state(f);
    await j.step('Out', () => p.moveCompound(cid, DATA, 0, null));
    await j.undo(); expect(state(f)).toEqual(s0);
    await p.reload();
    const loose = p.dataSections.find((x) => x.id === DATA)!.items.find((i) => i.kind === 'compound')!;
    await j.step('In', () => p.moveCompound(loose.id, DATA, 0, KID));
    await j.undo(); expect(state(f)).toEqual(s0);
    await p.reload();
    await j.step('Convert', () => p.convertToScheme(loose.id));
    await j.undo(); expect(state(f)).toEqual(s0);
  });
  it('(a box with no file of its own) delete a scheme compound, restore, undo twice, redo twice', async () => {
    const { f, j, p, cid } = await withSchemeCompound(false);
    const s0 = state(f);
    await j.step('Delete', () => p.deleteCompound(cid));
    const s1 = state(f);
    await j.step('Restore', async () => { await restoreFromTrash(p, (await listTrash(p))[0].id); });
    const s2 = state(f);
    await j.undo(); expect(state(f)).toEqual(s1);
    await j.undo(); expect(state(f)).toEqual(s0);
    await j.redo(); expect(state(f)).toEqual(s1);
    await j.redo(); expect(state(f)).toEqual(s2);
  });
  it('(a box with no file of its own) move out of a scheme, back in, convert: undo each', async () => {
    const { f, j, p, cid } = await withSchemeCompound(false);
    const s0 = state(f);
    await j.step('Out', () => p.moveCompound(cid, DATA, 0, null));
    await j.undo(); expect(state(f)).toEqual(s0);
    await p.reload();
    const loose = p.dataSections.find((x) => x.id === DATA)!.items.find((i) => i.kind === 'compound')!;
    await j.step('In', () => p.moveCompound(loose.id, DATA, 0, KID));
    await j.undo(); expect(state(f)).toEqual(s0);
    await p.reload();
    await j.step('Convert', () => p.convertToScheme(loose.id));
    await j.undo(); expect(state(f)).toEqual(s0);
  });
});
