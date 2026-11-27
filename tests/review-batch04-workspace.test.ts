// @vitest-environment jsdom
//
// Fixes from the code review of 2026-11-26 (batch 04) in the tabs: Next File past a canvas beside a
// document, which tabs an opened file takes the place of, saving a drawing kept on its page, Save
// Workspace with a drawing from Word, and Open Workspace with a file open beside a document.

import { describe, it, expect, vi } from 'vitest';

const disk = new Map<string, { data: Uint8Array; modified: number }>();
let clock = 1;
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

import { Doc } from '../src/model';
import { newDocument } from '../src/document/document';
import { writeCdxml } from '../src/io/cdxml-write';
import { Workspace, type WorkspaceHooks, type Tab } from '../src/workspace';

const measure = (t: string, s: number) => t.length * s * 0.5;

function workspace() {
  const hooks: WorkspaceHooks = {
    leave: () => {}, enter: () => {}, changed: () => {}, flash: () => {},
    pptx: { async picture() { return null; }, async svgToPng() { return new Uint8Array(4); } },
    measure,
    sheets: { read: async () => { throw new Error('no'); }, write: async () => '' },
    documents: { read: async () => ({ doc: newDocument(), warnings: [] }), write: async () => new Uint8Array() },
  };
  const host = new Doc();
  return { ws: new Workspace(host, hooks), host };
}

/** A drawing file's text with one atom. */
function drawingText(): string {
  const d = new Doc();
  d.edit('draw', () => d.addAtom(10, 10));
  return writeCdxml(d, { name: 'x.cdxml', textMeasure: measure });
}
const bytes = (s: string) => new TextEncoder().encode(s);
const drawSomething = (ws: Workspace, host: Doc) => { host.edit('draw', () => host.addAtom(0, 0)); ws.noteChange(); };

describe('F100: Next File', () => {
  it('goes on past a canvas shown beside the document showing', () => {
    const { ws, host } = workspace();
    const a = ws.active;
    drawSomething(ws, host);
    const doc1 = ws.newDocument();
    const canvas = ws.newDrawing();
    drawSomething(ws, host);
    const b = ws.newDocument();
    expect(ws.tabs).toEqual([a, doc1, canvas, b]);
    ws.setSplit({ left: doc1, right: canvas });
    ws.activate(doc1);
    ws.cycle(1);
    expect(ws.active).toBe(b);
    ws.activate(b);
    ws.cycle(-1);
    // back: the canvas shows its document, then on to the first tab
    ws.activate(doc1);
    ws.cycle(-1);
    expect(ws.active).toBe(a);
  });
});

describe('the tab an opened file takes the place of', () => {
  it('F526: is never an SI project (no error)', () => {
    const { ws } = workspace();
    const si = { ...ws.active, id: 999, mode: 'si', name: 'Untitled project', deck: null, book: null, document: null } as Tab;
    ws.tabs.push(si);
    expect(() => (ws as unknown as { spare(t: Tab): Tab | null }).spare(si)).not.toThrow();
    expect((ws as unknown as { spare(t: Tab): Tab | null }).spare(si)).toBeNull();
  });

  it('F527: is not a new document that has another window open', async () => {
    const { ws } = workspace();
    const owner = ws.newDocument();
    const second = ws.newWindow()!;
    expect(second.windowOf).toBe(owner);
    ws.activate(owner);
    expect(await ws.openBytes(bytes(drawingText()), 'Opened.cdxml')).toBe(true);
    expect(ws.tabs).toContain(owner);
    expect(ws.tabs.includes(second.windowOf!)).toBe(true);
  });

  it('F528: is not a file opened that has a name like a new one\'s', async () => {
    const { ws } = workspace();
    // (in a browser without file handles every file opened has no place on disk)
    expect(await ws.openBytes(new Uint8Array([1, 2, 3]), 'Document 1.docx')).toBe(true);
    const opened = ws.active;
    expect(opened.name).toBe('Document 1.docx');
    expect(await ws.openBytes(bytes(drawingText()), 'Other.cdxml')).toBe(true);
    expect(ws.tabs).toContain(opened);
  });

  it('is still an untouched new drawing', async () => {
    const { ws } = workspace();
    const first = ws.active;
    expect(await ws.openBytes(bytes(drawingText()), 'Opened.cdxml')).toBe(true);
    expect(ws.tabs).not.toContain(first);
    expect(ws.tabs.length).toBe(1);
  });
});

describe('F529: saving a drawing on a fixed page that pokes off it', () => {
  it('leaves the tab saved', async () => {
    const { ws, host } = workspace();
    const t = ws.active;
    host.page = { w: 200, h: 200, grow: false } as never;
    host.edit('draw', () => { const a = host.addAtom(190, 100); const b = host.addAtom(230, 100); host.addBond(a.id, b.id); });
    ws.noteChange();
    expect(t.dirty).toBe(true);
    const ok = await (ws as unknown as { writeTo(t: Tab, r: unknown, n: string): Promise<boolean> }).writeTo(t, { kind: 'path', path: '/w/Page.cdxml' }, 'Page.cdxml');
    expect(ok).toBe(true);
    expect(Math.max(...[...host.atoms.values()].map((a) => a.x))).toBeLessThanOrEqual(200);
    ws.noteChange();
    expect(t.dirty).toBe(false);
  });

  it('a recovery copy changes nothing', async () => {
    const { ws, host } = workspace();
    host.page = { w: 200, h: 200, grow: false } as never;
    host.edit('draw', () => host.addAtom(250, 100));
    const v = host.version;
    await ws.copyOf(ws.active);
    expect(host.version).toBe(v);
    expect([...host.atoms.values()][0].x).toBe(250);
  });
});

describe('F531: Save Workspace with a drawing being edited from Word', () => {
  it('keeps the drawing going back to Word', async () => {
    const { ws, host } = workspace();
    const d = ws.active;
    drawSomething(ws, host);
    d.ref = { kind: 'embedded', id: 1, app: 'Word', doc: 'Report.docx' };
    ws.newDocument();
    expect(ws.unsavedTabs).not.toContain(d);
    expect(await ws.saveWorkspace('/w1/Work.ciworkspace', { copyIn: false, saveChanges: false })).toBe(true);
    expect(d.ref.kind).toBe('embedded');
    expect(disk.get('/w1/Work.ciworkspace')).toBeDefined();
  });
});

describe('F532: Open Workspace with a file already open beside a document', () => {
  it('pairs the file\'s own tab', async () => {
    const { ws, host } = workspace();
    const scheme = ws.active;
    drawSomething(ws, host);
    scheme.ref = { kind: 'path', path: '/w2/Scheme.cdxml' };
    scheme.name = 'Scheme.cdxml';
    const report = ws.newDocument();
    report.ref = { kind: 'path', path: '/w2/Report.docx' };
    report.name = 'Report.docx';
    ws.setSplit({ left: report, right: scheme });
    ws.activate(report);
    disk.set('/w2/Other.cdxml', { data: bytes(drawingText()), modified: ++clock });
    disk.set('/w2/Scheme.cdxml', { data: bytes(drawingText()), modified: ++clock });
    const list = JSON.stringify({ app: 'Chem Illustrator', kind: 'workspace', version: 1, tabs: [{ file: 'Other.cdxml', beside: 1 }, { file: 'Scheme.cdxml' }], active: 0 });
    await ws.openWorkspace(list, '/w2/Work.ciworkspace');
    const other = ws.tabs.find((t) => t.name === 'Other.cdxml')!;
    expect(ws.besideOf(other)).toBe(scheme);
  });
});
