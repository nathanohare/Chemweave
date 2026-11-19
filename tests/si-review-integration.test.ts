// @vitest-environment jsdom
//
// How the SI tab's layers work together (found reviewing the merged fixes): the tab's queue of
// saves, the Undo history, the lock check before each change, and the project read again.
// A folder whose reads and writes take time (SlowFolder) shows what a real disk would.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, valuesOf } from '../src/si/project';
import { JournalFolder } from '../src/si/journal';
import { SiMode } from '../src/ui/si-mode';
import { dumpPyJson } from '../src/si/pyjson';
import * as E from '../src/si/scheme-edit';
import { listTrash, restoreFromTrash } from '../src/si/trash';


const FIXTURE = join(__dirname, 'fixtures', 'si-example');
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A folder whose reads and writes each take `ms` (as a disk or a network drive does). */
class SlowFolder extends MemoryFolder {
  ms = 0;
  log: string[] = [];
  failMove: ((from: string, to: string) => boolean) | null = null;
  async readText(rel: string) { if (this.ms) await tick(this.ms); return super.readText(rel); }
  async readBytes(rel: string) { if (this.ms) await tick(this.ms); return super.readBytes(rel); }
  failWrite: ((rel: string) => boolean) | null = null;
  async writeText(rel: string, text: string) { if (this.failWrite?.(rel)) throw new Error('The process cannot access the file because it is being used by another process. (os error 32)'); if (this.ms) await tick(this.ms); this.log.push('write ' + rel); return super.writeText(rel, text); }
  async writeBytes(rel: string, b: Uint8Array) { if (this.ms) await tick(this.ms); this.log.push('write ' + rel); return super.writeBytes(rel, b); }
  async move(from: string, to: string) {
    if (this.ms) await tick(this.ms);
    if (this.failMove?.(from, to)) throw new Error('file in use');
    this.log.push(`move ${from} -> ${to}`);
    return super.move(from, to);
  }
}
function exampleFolder(name = 'Example project'): SlowFolder {
  const f = new SlowFolder(name);
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n !== 'README.md') f.files.set(relative(FIXTURE, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(FIXTURE);
  return f;
}
async function openProject(name?: string, lock = false) {
  const f = exampleFolder(name);
  const j = new JournalFolder(f);
  const p = await SiProject.open(j);
  if (lock) await p.acquireLock('me', 'here');
  return { f, j, p };
}
const flashes: string[] = [];
function makeMode(over: Record<string, unknown> = {}): SiMode {
  document.body.innerHTML = '<div id="work"></div>';
  try { localStorage.setItem('si.livePreview', 'off'); } catch { /* */ }
  const base: Record<string, unknown> = {
    flash: (m: string) => { flashes.push(m); }, hint: () => {}, changed: () => {},
    contentsOf: () => null, molfileOf: () => ({ molblock: null }), pictureOf: () => '<svg></svg>',
    analyze: async () => null, smiles: async () => null, siFacts: async (m: string[]) => m.map(() => null),
    sizeOf: () => null, siStyle: () => ({}), openDocuments: () => [], drawingFiles: () => null, contentsOfCdxml: () => null,
    ...over,
  };
  const host = new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });
  return new SiMode(host as never);
}
const tabOf = (p: SiProject, id = 1) => ({ id, mode: 'si', name: p.title, si: p, sheetState: null }) as { sheetState: unknown };
const text = (f: MemoryFolder, rel: string): string => new TextDecoder().decode(f.files.get(rel) ?? new Uint8Array());
const within = <T>(p: Promise<T>, ms: number): Promise<T | 'TIMEOUT'> => Promise.race([p, tick(ms).then(() => 'TIMEOUT' as const)]);

beforeEach(() => { flashes.length = 0; });

async function onScheme(ms = 0) {
  const { f, j, p } = await openProject();
  const mode = makeMode();
  const k = p.schemes[0];
  const tab = tabOf(p);
  tab.sheetState = { pick: { kind: 'scheme', id: k.id } };
  mode.show(tab as never);
  await tick(80);
  f.ms = ms;
  const cond = document.querySelector<HTMLElement>('.si-scheme-cond')!;
  return { f, j, p, mode, k, cond };
}
function type(el: HTMLElement, s: string): void {
  el.focus();
  el.textContent = s;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('scheme page saves and the SI tab save queue', () => {
  it('saved() waits for conditions typed on a scheme page', async () => {
    const { f, p, mode, k, cond } = await onScheme(5);
    expect(cond).toBeTruthy();
    type(cond, 'TYPED-CONDITIONS');
    await mode.saved(p);
    // (what main.ts does on close: saved(), then the lock is released and the window goes)
    expect(text(f, k.folder + '/scheme.json')).toContain('TYPED-CONDITIONS');
  });

  it('Undo right after typing conditions works (no "wait" error)', async () => {
    const { f, mode, k, cond } = await onScheme(5);
    type(cond, 'TYPED-CONDITIONS');
    await mode.undo(false);
    await tick(200);
    expect(flashes.filter((m) => /Wait for the change/.test(m))).toEqual([]);
    expect(text(f, k.folder + '/scheme.json')).not.toContain('TYPED-CONDITIONS');
  });

  it('a ribbon command right after typing conditions keeps its own Undo step', async () => {
    const { f, j, p, mode, k, cond } = await onScheme(5);
    type(cond, 'TYPED-CONDITIONS');
    const before = p.dataSections.find((s) => s.id === k.sectionId)!.items.length;
    await within(mode.run('new-compound'), 3000);
    await tick(300);
    expect(text(f, k.folder + '/scheme.json')).toContain('TYPED-CONDITIONS');
    const label = j.history(false);
    await mode.undo(false);
    await tick(300);
    // Undo of the command must not take the typed conditions with it
    expect({ label, kept: text(f, k.folder + '/scheme.json').includes('TYPED-CONDITIONS'), items: p.dataSections.find((s) => s.id === k.sectionId)!.items.length })
      .toEqual({ label: 'New Compound', kept: true, items: before });
  });
});

async function onCompound(lock = true) {
  const { f, j, p } = await openProject(undefined, lock);
  const mode = makeMode();
  const c = p.compounds.find((x) => !x.schemeId)!;
  const tab = tabOf(p);
  tab.sheetState = { pick: { kind: 'compound', id: c.id } };
  const said: string[] = [];
  p.onReadOnly = (m) => { said.push(m); mode.readOnlyNow(p); };   // as main.ts sets it
  mode.show(tab as never);
  await tick(80);
  return { f, j, p, mode, c, said };
}
const partInputs = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>('.si-page .si-parts input')];
const takeOver = (f: { files: Map<string, Uint8Array> }): void => { f.files.set('.lock', new TextEncoder().encode('{"user": "Lauren", "computer": "PC2", "opened_at": "", "session": "other"}')); };

describe('the lock is lost while the project is open', () => {
  it('the page shown is locked when the project turns read-only (window focus check)', async () => {
    const { f, p, said } = await onCompound();
    takeOver(f);
    expect(await p.checkLock()).toBe(false);
    await tick(20);
    expect(said.length).toBe(1);
    expect(p.readOnly).toBe(true);
    // the fields of the page on screen should be disabled now, as on a project opened read-only
    expect(partInputs().filter((i) => !i.disabled).length).toBe(0);
  });

  it('text typed in a text box stays on screen when its save is refused', async () => {
    const { f, p, c } = await onCompound();
    const box = document.querySelector<HTMLElement>('.si-page .si-field[data-key="notes"] .si-rich')!;
    expect(box).toBeTruthy();
    takeOver(f);
    await tick(1600);                       // (past the lock check's throttle)
    box.focus();
    box.append(document.createTextNode(' A LONG SENTENCE TYPED AFTER THE LOCK WAS TAKEN'));
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(900);
    expect(p.readOnly).toBe(true);
    expect(flashes.join('\n')).toMatch(/not saved/);
    const onScreen = [...document.querySelectorAll<HTMLElement>('.si-page .si-rich')].some((b) => (b.textContent ?? '').includes('A LONG SENTENCE TYPED'));
    const onDisk = [...f.files.keys()].filter((k) => k.startsWith(c.folder)).some((k) => text(f, k).includes('A LONG SENTENCE TYPED'));
    expect({ onDisk, onScreen }).toEqual({ onDisk: false, onScreen: true });
  });
});

describe('typing while Undo is putting files back', () => {
  it('a field changed during Undo is not written from the objects of before the Undo', async () => {
    const { f, p, mode, c } = await onCompound(false);
    const [a, b] = partInputs();
    a.value = 'STEP-ONE';
    a.dispatchEvent(new Event('change', { bubbles: true }));
    await mode.saved(p);
    expect(text(f, c.folder + '/compound.json')).toContain('STEP-ONE');
    f.ms = 15;
    const undo = mode.undo(false);          // takes STEP-ONE back
    expect(document.querySelector<HTMLElement>('.si-page')!.inert).toBe(true);   // (nothing is typed on the old page meanwhile)
    await tick(40);                          // (the undo is under way: files being put back, the project read again)
    b.value = 'TYPED-DURING-UNDO';
    b.dispatchEvent(new Event('change', { bubbles: true }));
    await undo;
    await mode.saved(p);
    await tick(300);
    f.ms = 0;
    const disk = text(f, p.compounds.find((x) => x.id === c.id)!.folder + '/compound.json');
    const mem = JSON.stringify(valuesOf(p.compounds.find((x) => x.id === c.id)!));
    // what is on disk and what the page shows must agree
    expect({ diskHasUndone: disk.includes('STEP-ONE'), memHasUndone: mem.includes('STEP-ONE'), diskTyped: disk.includes('TYPED-DURING-UNDO'), memTyped: mem.includes('TYPED-DURING-UNDO') })
      .toEqual({ diskHasUndone: false, memHasUndone: false, diskTyped: false, memTyped: false });
    // (a change that did get in from the page of before is refused, and said)
    expect(flashes.join('\n')).toMatch(/being read again.*not saved/);
    expect(document.querySelector<HTMLElement>('.si-page')!.inert).toBe(false);
  });

  it('Undo is refused, with nothing put back, once the lock is someone else\'s', async () => {
    const { f, p, mode, c } = await onCompound();
    const [a] = partInputs();
    a.value = 'STEP-ONE';
    a.dispatchEvent(new Event('change', { bubbles: true }));
    await mode.saved(p);
    takeOver(f);
    await mode.undo(false);
    expect(p.readOnly).toBe(true);
    expect(text(f, c.folder + '/compound.json')).toContain('STEP-ONE');
    expect(flashes.join('\n')).toMatch(/read-only/);
  });
});

describe('a save that fails once (the file is held by a sync program or a virus scanner)', () => {
  it('what was typed in a text box is still on the page, to be saved again', async () => {
    const { f, p } = await openProject();
    const mode = makeMode();
    const c = p.compounds.find((x) => !x.schemeId)!;
    const tab = tabOf(p);
    tab.sheetState = { pick: { kind: 'compound', id: c.id } };
    mode.show(tab as never);
    await tick(80);
    const box = document.querySelector<HTMLElement>('.si-page .si-field[data-key="notes"] .si-rich')!;
    expect(box).toBeTruthy();
    let failed = 0;
    f.failWrite = (rel) => rel.endsWith('notes.txt') && failed++ === 0;
    box.focus();
    box.append(document.createTextNode(' A SENTENCE TYPED JUST NOW'));
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(900);
    expect(failed).toBeGreaterThan(0);
    const texts = [...document.querySelectorAll<HTMLElement>('.si-page .si-rich')].map((b) => (b.closest<HTMLElement>('[data-key]')?.dataset.key ?? '?') + '=' + (b.textContent ?? '').slice(-40));
    expect(flashes.join('\n')).toMatch(/Could not save/);
    const onScreen = [...document.querySelectorAll<HTMLElement>('.si-page .si-rich')].some((b) => (b.textContent ?? '').includes('A SENTENCE TYPED JUST NOW'));
    expect(onScreen).toBe(true);
    // and it is saved when the box is left (or the tab, or the window, goes)
    await mode.saved(p);
    expect(text(f, c.folder + '/notes.txt')).toContain('A SENTENCE TYPED JUST NOW');
  });
});

describe('the lock is found lost while the project is being read again', () => {
  it('the project stays read-only (Reload, or the reload after Undo, must not make it writable again)', async () => {
    const { f, p } = await openProject(undefined, true);
    const said: string[] = [];
    p.onReadOnly = (m) => said.push(m);
    const c = p.compounds[0];
    // someone takes the project over in Chem SI Assistant
    f.files.set('.lock', new TextEncoder().encode('{"user": "Lauren", "computer": "PC2", "opened_at": "", "session": "other"}'));
    f.ms = 5;
    // back in Chemweave: the person clicks Reload; the window's focus check finds the lock gone while the folder is read
    const reload = p.reload();
    await tick(8);
    expect(await p.checkLock()).toBe(false);
    expect(p.readOnly).toBe(true);
    await reload;
    f.ms = 0;
    expect(said.length).toBe(1);
    const before = text(f, c.folder + '/compound.json');
    const c2 = p.compounds[0];
    const wrote = await p.setIdOverride(c2, 'OVERWRITES-THEIR-PROJECT').then(() => true, () => false);
    expect({ readOnly: p.readOnly, wrote, changed: text(f, c.folder + '/compound.json') !== before }).toEqual({ readOnly: true, wrote: false, changed: false });
  });
});

const MOL = '\n  test\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\nM  END\n';

async function schemeWithLinkedBox() {
  const { f, j, p } = await openProject();
  const k = p.schemes[0];
  // a box with a structure of its own, then marked as a compound (its own file stays, hidden)
  const box = await E.addBox(p, k, E.START);
  await E.setBoxStructure(p, k, String(box.id), MOL);
  const c = (await E.markAsCompound(p, k, String(box.id), 'New one'))!;
  return { f, j, p, k, c, box };
}

describe('deleting a scheme compound', () => {
  it('a delete that fails leaves the project and the Trash as they were', async () => {
    const { f, p, k, c, box } = await schemeWithLinkedBox();
    const trashBefore = (await listTrash(p)).length;
    const filesBefore = [...f.files.keys()].filter((x) => x.startsWith(k.folder)).sort();
    const schemeBefore = text(f, k.folder + '/scheme.json');
    f.failMove = (from, to) => from === c.folder && to.startsWith('trash/');
    await expect(p.deleteCompound(c.id)).rejects.toThrow(/nothing was deleted/);
    f.failMove = null;
    const trash = await listTrash(p);
    const filesAfter = [...f.files.keys()].filter((x) => x.startsWith(k.folder)).sort();
    const ownThere = await p.folder.exists(k.folder + '/' + String(E.findBox(k, String(box.id))!.box.structure));
    expect({
      trashAdded: trash.slice(0, trash.length - trashBefore).map((t) => `${t.kind}: ${t.name}`),
      schemeSame: text(f, k.folder + '/scheme.json') === schemeBefore,
      filesSame: JSON.stringify(filesAfter) === JSON.stringify(filesBefore),
      ownThere,
    }).toEqual({ trashAdded: [], schemeSame: true, filesSame: true, ownThere: true });
  });

  it('delete, then Undo: everything is back; then restore of the leftovers is not offered', async () => {
    const { f, j, p, k, c } = await schemeWithLinkedBox();
    j.settle();
    const before = new Map([...f.files].filter(([x]) => !x.startsWith('build/')).map(([x, b]) => [x, new TextDecoder().decode(b)]));
    await j.step('Delete', () => p.deleteCompound(c.id));
    const trash = await listTrash(p);
    expect(trash.map((t) => t.kind).sort()).toEqual(['compound', 'scheme_box']);
    await j.undo();
    await p.reload();
    const after = new Map([...f.files].filter(([x]) => !x.startsWith('build/')).map(([x, b]) => [x, new TextDecoder().decode(b)]));
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [x, t] of before) expect(after.get(x), x).toBe(t);
    expect(k.id).toBe(p.schemes[0].id);
  });

  it('delete, restore the compound from the Trash, then Undo the restore, then Redo', async () => {
    const { j, p, c } = await schemeWithLinkedBox();
    j.settle();
    await j.step('Delete', () => p.deleteCompound(c.id));
    const entry = (await listTrash(p)).find((t) => t.kind === 'compound')!;
    await j.step('Restore', () => restoreFromTrash(p, entry.id));
    expect(p.compounds.some((x) => x.id === c.id)).toBe(true);
    await j.undo(); await p.reload();
    expect(p.compounds.some((x) => x.id === c.id)).toBe(false);
    expect((await listTrash(p)).some((t) => t.kind === 'compound' && !t.pending)).toBe(true);
    await j.redo(); await p.reload();
    expect(p.compounds.some((x) => x.id === c.id)).toBe(true);
    await j.undo(); await p.reload();
    await j.undo(); await p.reload();     // the delete itself
    expect(p.compounds.some((x) => x.id === c.id)).toBe(true);
    expect((await listTrash(p)).length).toBe(0);
  });
});

const stressInputs = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>('.si-page .si-parts input')];
const shape = (p: SiProject): string => dumpPyJson(p.sections.map((s) => ({ id: s.id, data: s.data, items: s.items.map((i) => (i.kind === 'scheme' ? { id: i.id, data: i.data, kids: i.children.map((c) => ({ id: c.id, data: c.data })) } : { id: i.id, data: i.data })) })));

describe('many things at once on a slow folder', () => {
  it('nothing hangs, and the folder ends as the page shows it', async () => {
    const { f, p } = await openProject(undefined, true);
    const mode = makeMode();
    const c = p.compounds.find((x) => !x.schemeId)!;
    const tab = tabOf(p);
    tab.sheetState = { pick: { kind: 'compound', id: c.id } };
    mode.show(tab as never);
    await tick(80);
    f.ms = 3;
    const all: Promise<unknown>[] = [];
    const typeIn = (n: number, v: string): void => { const i = stressInputs()[n]; if (!i) return; i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); };
    typeIn(0, 'one');
    all.push(mode.run('new-compound'));
    typeIn(1, 'two');
    all.push(mode.run('move-down'));
    all.push(mode.undo(false));
    typeIn(0, 'three');
    all.push(mode.undo(false));
    all.push(mode.undo(true));
    all.push(mode.run('move-up'));
    all.push(mode.run('duplicate'));
    typeIn(1, 'four');
    all.push(mode.undo(false));
    all.push(mode.run('reload'));
    all.push(mode.saved(p));
    const got = await within(Promise.all(all), 8000);
    expect(got).not.toBe('TIMEOUT');
    await mode.saved(p);
    await tick(800);
    f.ms = 0;
    const fresh = await SiProject.open(f, { readOnly: true });
    expect(shape(fresh)).toBe(shape(p));
  }, 20000);
});

describe('the background reader of HRMS report files', () => {
  it('a reader that stops takes only the file it was reading with it', async () => {
    vi.resetModules();
    const posted: string[] = [];
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      terminate(): void { /* gone */ }
      postMessage(m: { id: number; name: string; bytes: Uint8Array }): void {
        posted.push(m.name);
        // (the first file is too much for it; the others are read)
        setTimeout(() => {
          if (m.name === 'huge.mzML') this.onerror?.();
          else this.onmessage?.({ data: { id: m.id, data: { name: m.name, readable: true, message: 'read ' + m.name } } });
        }, 5);
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const { readInBackground } = await import('../src/si/report-files');
      const got = await Promise.all(['huge.mzML', 'small.csv', 'other.csv'].map((n) => readInBackground(new Uint8Array([1, 2, 3]), n)));
      expect(got.map((d) => d.readable)).toEqual([false, true, true]);
      expect(got[0].message).toMatch(/the reading stopped/);
      expect(posted).toEqual(['huge.mzML', 'small.csv', 'other.csv']);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
