// @vitest-environment jsdom
//
// Installing an update restarts the desktop app: every open tab is kept first (unsaved changes
// copied into the app's own folder, files on disk left alone) and the first start after the
// update opens them again as they were, in order, with the tab showing, the split screen, other
// windows of a document, each tab's zoom and the slide it was on (Nate, 2026-11-26).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// a pretend disk for the desktop app's file commands, with change times
const disk = new Map<string, { data: Uint8Array; modified: number }>();
let clock = 1_000_000;
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: async (cmd: string, args: unknown, opts?: { headers: Record<string, string> }) => {
    const a = args as Record<string, string>;
    const put = (path: string, data: Uint8Array) => disk.set(path, { data, modified: ++clock });
    if (cmd === 'write_text_file') { put(a.path, new TextEncoder().encode(a.contents)); return; }
    if (cmd === 'write_binary_file') { put(decodeURIComponent(opts!.headers.path), args as Uint8Array); return; }
    if (cmd === 'read_binary_file') {
      const b = disk.get(a.path);
      if (!b) throw new Error('not found');
      return b.data.slice().buffer;
    }
    if (cmd === 'path_exists') return disk.has(a.path);
    if (cmd === 'file_stamp') { const f = disk.get(a.path); return f ? { modified: f.modified, size: f.data.length } : null; }
    throw new Error('unexpected ' + cmd);
  },
}));
vi.mock('../src/ui/ask', () => ({ ask: vi.fn(async () => true) }));

import { Doc } from '../src/model';
import { Workspace, type WorkspaceHooks, type Tab } from '../src/workspace';
import { writeCdxml } from '../src/io/cdxml-write';
import { newDocument, type DocText } from '../src/document/document';
import { memoryStore } from '../src/keep/store';
import { keepForRestart, reopenAfterRestart, parseRestart, forgetRestart, restartWaiting, noteRestart, MAX_TRIES, type RestartHooks } from '../src/keep/restart';
import { UpdateUI } from '../src/ui/update-ui';
import type { Release } from '../src/updates';

const measure = (t: string, s: number) => t.length * s * 0.5;
const bytes = (s: string) => new TextEncoder().encode(s);

function workspace(over: Partial<WorkspaceHooks> = {}) {
  const host = new Doc();
  const entered: { tab: Tab; opened: boolean }[] = [];
  const hooks: WorkspaceHooks = {
    leave: () => {}, enter: (tab, opened) => entered.push({ tab, opened }), changed: () => {}, flash: () => {},
    pptx: { async picture() { return null; }, async svgToPng() { return new Uint8Array(4); } },
    measure,
    sheets: { read: async () => { throw new Error('no sheets here'); }, write: async () => '' },
    // a document as its text, as JSON (Word's format isn't what these tests are about)
    documents: {
      read: async (b) => ({ doc: JSON.parse(new TextDecoder().decode(b)) as DocText, warnings: [] }),
      write: async (d) => bytes(JSON.stringify(d)),
    },
    ...over,
  };
  return { host, ws: new Workspace(host, hooks), entered };
}

function drawing(atoms: number): Uint8Array {
  const d = new Doc();
  d.bulk(() => { for (let i = 0; i < atoms; i++) d.addAtom(i * 14, 0, 6); });
  return bytes(writeCdxml(d, { name: 'x.cdxml', textMeasure: measure }));
}

const view = (scale: number) => ({ view: { scale, ox: 10 * scale, oy: 5 }, fitted: false });
const hooks = (live = view(2)): RestartHooks => ({ liveView: () => live });

beforeEach(() => { disk.clear(); });

describe('keeping the open tabs for the restart', () => {
  it('copies unsaved and never-saved tabs, lists saved ones by their file, and leaves the files on disk alone', async () => {
    const store = memoryStore();
    const { ws, host } = workspace();
    disk.set('/w/saved.cdxml', { data: drawing(2), modified: 50 });
    disk.set('/w/changed.cdxml', { data: drawing(1), modified: 60 });
    await ws.openBytes(drawing(2), 'saved.cdxml', { kind: 'path', path: '/w/saved.cdxml' });
    const saved = ws.active;
    await ws.openBytes(drawing(1), 'changed.cdxml', { kind: 'path', path: '/w/changed.cdxml' });
    host.edit('draw', () => { host.addAtom(100, 0); });
    ws.noteChange();
    const changed = ws.active;
    expect(changed.dirty).toBe(true);
    ws.newDrawing();
    host.edit('draw', () => { host.addAtom(0, 0); host.addAtom(14, 0); host.addAtom(28, 0); });
    ws.noteChange();
    const untitled = ws.active;
    // a new tab nothing was done in isn't worth bringing back
    ws.newDrawing();
    ws.activate(changed);
    const before = new Map([...disk].map(([k, v]) => [k, v.modified]));

    expect(await keepForRestart(ws, store, hooks(), 1234)).toEqual([]);

    expect(new Map([...disk].map(([k, v]) => [k, v.modified]))).toEqual(before);
    const list = parseRestart(new TextDecoder().decode((await store.get('restart/tabs.json'))!))!;
    expect(list.made).toBe(1234);
    expect(list.tabs.map((t) => [t.name, t.path, !!t.copy])).toEqual([
      [saved.name, '/w/saved.cdxml', false],
      [changed.name, '/w/changed.cdxml', true],
      [untitled.name, null, true],
    ]);
    expect(list.active).toBe(1);
    // the tab showing has the view on screen now
    expect(list.tabs[1].view).toEqual(view(2).view);
    expect(await restartWaiting(store)).toBe(true);
  });

  it('names a tab with unsaved changes that has nothing to come back from (an SI project held in memory)', async () => {
    const store = memoryStore();
    let unsaved = true;
    const { ws } = workspace({ si: { dirty: () => unsaved } as unknown as WorkspaceHooks['si'] });
    const si = ws.active;
    si.mode = 'si';
    si.dirty = true;
    si.name = 'Example SI';
    expect(await keepForRestart(ws, store, { ...hooks(), siOf: () => null })).toEqual(['Example SI']);
    unsaved = false;
    expect(await keepForRestart(ws, store, { ...hooks(), siOf: () => null })).toEqual([]);
  });
});

describe('the first start after the update', () => {
  it('opens every tab again as it was: order, unsaved marks, files, the tab showing, zoom', async () => {
    const store = memoryStore();
    const a = workspace();
    disk.set('/w/saved.cdxml', { data: drawing(2), modified: 50 });
    disk.set('/w/changed.cdxml', { data: drawing(1), modified: 60 });
    await a.ws.openBytes(drawing(2), 'saved.cdxml', { kind: 'path', path: '/w/saved.cdxml' });
    a.ws.active.view = view(3).view;
    await a.ws.openBytes(drawing(1), 'changed.cdxml', { kind: 'path', path: '/w/changed.cdxml' });
    a.host.edit('draw', () => { a.host.addAtom(100, 0); });
    a.ws.noteChange();
    const changedStamp = a.ws.active.stamp;
    a.ws.newDrawing();
    a.host.edit('draw', () => { a.host.addAtom(0, 0); });
    a.ws.noteChange();
    const untitledName = a.ws.active.name;
    a.ws.activate(a.ws.tabs[0]);
    expect(await keepForRestart(a.ws, store, hooks(view(4)))).toEqual([]);

    // the app starts again with its one new drawing
    const b = workspace();
    const r = await reopenAfterRestart(b.ws, store, hooks());
    expect(r).toEqual({ opened: 3, missing: [], moved: [], failed: [] });
    const tabs = b.ws.tabs;
    expect(tabs.map((t) => [t.name, t.ref.kind === 'path' ? t.ref.path : null, t.dirty])).toEqual([
      ['saved.cdxml', '/w/saved.cdxml', false],
      ['changed.cdxml', '/w/changed.cdxml', true],
      [untitledName, null, true],
    ]);
    // the unsaved copy holds the changes; the saved one is the file on disk
    expect(b.ws.docOf(tabs[1]).atoms.size).toBe(2);
    expect(b.ws.docOf(tabs[2]).atoms.size).toBe(1);
    // still told apart from changes made to the file elsewhere since
    expect(tabs[1].stamp).toEqual(changedStamp);
    expect(b.ws.active).toBe(tabs[0]);
    expect(b.entered.at(-1)).toEqual({ tab: tabs[0], opened: false });
    expect(tabs[0].view).toEqual(view(4).view);
    expect(tabs[0].fitted).toBe(false);
    // used once: the next start opens nothing
    expect(await restartWaiting(store)).toBe(false);
    expect(store.files.size).toBe(0);
    expect(await reopenAfterRestart(workspace().ws, store, hooks())).toBeNull();
  });

  it('brings back the split screen and another window of a document', async () => {
    const store = memoryStore();
    const a = workspace();
    disk.set('/w/left.cdxml', { data: drawing(1), modified: 50 });
    await a.ws.openBytes(drawing(1), 'left.cdxml', { kind: 'path', path: '/w/left.cdxml' });
    const left = a.ws.active;
    const d = a.ws.newDocument();
    a.ws.activate(d);
    d.dirty = true;
    d.savedEdits = -1;
    a.ws.newWindow();
    a.ws.setSplit({ left, right: d });
    a.ws.activate(d);
    expect(await keepForRestart(a.ws, store, hooks())).toEqual([]);

    const b = workspace();
    const r = await reopenAfterRestart(b.ws, store, hooks());
    expect(r?.opened).toBe(3);
    const l = b.ws.tabs.find((t) => t.name === 'left.cdxml')!;
    const docs = b.ws.tabs.filter((t) => t.mode === 'document');
    expect(docs).toHaveLength(2);
    expect(docs[1].windowOf).toBe(docs[0]);
    expect(docs[0].dirty).toBe(true);
    expect(b.ws.split).toEqual({ left: l, right: docs[0] });
    expect(b.ws.mainOf(b.ws.active)).toBe(docs[0]);
  });

  it('says which files are gone, and keeps unsaved copies it couldn’t open for the next start', async () => {
    const store = memoryStore();
    const a = workspace();
    disk.set('/w/gone.cdxml', { data: drawing(1), modified: 50 });
    await a.ws.openBytes(drawing(1), 'gone.cdxml', { kind: 'path', path: '/w/gone.cdxml' });
    a.ws.newDrawing();
    a.host.edit('draw', () => { a.host.addAtom(0, 0); });
    a.ws.noteChange();
    expect(await keepForRestart(a.ws, store, hooks())).toEqual([]);
    disk.delete('/w/gone.cdxml');
    // the copy is spoilt
    const copy = [...store.files.keys()].find((k) => /\.cdxml$/.test(k))!;
    await store.put(copy, bytes('not a drawing'));

    const r = await reopenAfterRestart(workspace().ws, store, hooks());
    expect(r?.missing).toEqual(['/w/gone.cdxml']);
    expect(r?.failed).toHaveLength(1);
    // tried again next time: only that copy
    const left = parseRestart(new TextDecoder().decode((await store.get('restart/tabs.json'))!))!;
    expect(left.tabs).toHaveLength(1);
    expect(store.files.has(copy)).toBe(true);
  });

  it('reads only what makes sense from the list', () => {
    expect(parseRestart('nonsense')).toBeNull();
    expect(parseRestart(JSON.stringify({ kind: 'workspace', tabs: [] }))).toBeNull();
    const l = parseRestart(JSON.stringify({ kind: 'restart', tabs: [{ name: 'a', copy: '../../evil' }, { name: 'b', windowOf: 7 }], active: 9, split: [0, 0] }))!;
    expect(l.tabs[0].copy).toBeUndefined();
    expect(l.tabs[1].windowOf).toBeUndefined();
    expect(l.active).toBe(-1);
    expect(l.split).toBeUndefined();
  });
});

describe('a restart that goes wrong', () => {
  async function oneUnsaved(store = memoryStore()) {
    const a = workspace();
    a.ws.newDrawing();
    a.host.edit('draw', () => { a.host.addAtom(0, 0); });
    a.ws.noteChange();
    return { store, ...a };
  }

  it('keeps copies an earlier restart couldn’t open when the next update is installed', async () => {
    const { store, ws } = await oneUnsaved();
    expect(await keepForRestart(ws, store, hooks(), 1000)).toEqual([]);
    const first = parseRestart(new TextDecoder().decode((await store.get('restart/tabs.json'))!))!;
    // (as if it couldn't be opened at the last start, and was kept for the next)
    await store.put('restart/tabs.json', bytes(JSON.stringify({ ...first, tries: 1 })));
    expect(await keepForRestart(ws, store, hooks(), 2000)).toEqual([]);
    const second = parseRestart(new TextDecoder().decode((await store.get('restart/tabs.json'))!))!;
    expect(second.tabs.map((t) => t.copy)).toEqual([expect.stringMatching(/^t1jk-/), first.tabs[0].copy]);
    for (const t of second.tabs) expect(store.files.has(`restart/${t.copy}`)).toBe(true);
  });

  it('gives up on a list after several starts that didn’t finish it (a file that stops the app as it opens)', async () => {
    const { store, ws } = await oneUnsaved();
    await keepForRestart(ws, store, hooks());
    const list = parseRestart(new TextDecoder().decode((await store.get('restart/tabs.json'))!))!;
    await store.put('restart/tabs.json', bytes(JSON.stringify({ ...list, tries: MAX_TRIES })));
    const b = workspace();
    const r = await reopenAfterRestart(b.ws, store, hooks());
    expect(r?.gaveUp).toBe(true);
    expect(b.ws.tabs).toHaveLength(1);
    // (left where it is, for the person to find)
    expect(await restartWaiting(store)).toBe(true);
  });

  it('says why the update didn’t install, and holds AutoSave off a tab whose file has gone or was held off', async () => {
    const store = memoryStore();
    const a = workspace();
    disk.set('/w/gone.cdxml', { data: drawing(1), modified: 50 });
    disk.set('/w/held.cdxml', { data: drawing(1), modified: 50 });
    for (const n of ['gone', 'held']) {
      await a.ws.openBytes(drawing(1), `${n}.cdxml`, { kind: 'path', path: `/w/${n}.cdxml` });
      a.host.edit('draw', () => { a.host.addAtom(50, 0); });
      a.ws.noteChange();
    }
    const held = a.ws.active;
    expect(await keepForRestart(a.ws, store, { ...hooks(), paused: (t) => t === held })).toEqual([]);
    await noteRestart(store, 'the disk is full');
    disk.delete('/w/gone.cdxml');
    const paused: string[] = [];
    const secured = vi.fn(async () => {});
    const b = workspace();
    const r = await reopenAfterRestart(b.ws, store, { ...hooks(), pause: (t) => paused.push(t.name), secure: secured });
    expect(r).toMatchObject({ opened: 2, moved: ['gone.cdxml'], note: 'the disk is full' });
    expect(paused.sort()).toEqual(['gone.cdxml', 'held.cdxml']);
    // the reopened tabs had their recovery copies made before the restart's own copies went
    expect(secured).toHaveBeenCalledOnce();
    expect(await restartWaiting(store)).toBe(false);
  });
});

describe('installing the update', () => {
  const run = (ui: UpdateUI, r: Release) => (ui as unknown as { install(r: Release, bar: HTMLElement, row: HTMLElement): Promise<void> }).install(r, document.createElement('div'), document.createElement('div'));
  const ui = (steps: string[], closing: () => Promise<void> = async () => { steps.push('closing'); }) => new UpdateUI({
    unkept: () => [], skipped: () => null, skip: () => {}, channel: () => 'latest', openPage: () => {}, closing,
    keepFailed: () => steps.push('forget'), notInstalled: async (why) => { steps.push('restart: ' + why); return true; },
  });

  it('restarts with the kept tabs when the update doesn’t install after the app put its safety nets away', async () => {
    const steps: string[] = [];
    await run(ui(steps), { version: '9.9.9', notes: '', async install(_p, closing) { await closing?.(); throw new Error('installer refused'); } });
    expect(steps).toEqual(['closing', 'restart: installer refused']);
  });

  it('blocks the window while the tabs are kept and the installer runs', async () => {
    const steps: string[] = [];
    let blocked = false;
    await run(ui(steps, async () => { blocked = !!document.querySelector('dialog.update-restart[open]'); }), { version: '9.9.9', notes: '', async install(_p, closing) { await closing?.(); } });
    expect(blocked).toBe(true);
  });

  it('forgets what was kept when keeping failed, and the app carries on', async () => {
    document.body.replaceChildren();
    const steps: string[] = [];
    await run(ui(steps, async () => { throw new Error('a copy failed'); }), { version: '9.9.9', notes: '', async install(_p, closing) { await closing?.(); } });
    expect(steps).toEqual(['forget']);
    expect(document.querySelector('dialog.update-restart')).toBeNull();
  });

  it('does nothing of the kind when the download failed before closing', async () => {
    const steps: string[] = [];
    await run(ui(steps), { version: '9.9.9', notes: '', async install() { throw new Error('offline'); } });
    expect(steps).toEqual([]);
  });

  it('forgetting removes the list and the copies', async () => {
    const store = memoryStore();
    await store.put('restart/tabs.json', bytes('{}'));
    await store.put('restart/tab-0.cdxml', bytes('x'));
    await forgetRestart(store);
    expect(store.files.size).toBe(0);
  });
});
