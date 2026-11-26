// @vitest-environment jsdom
//
// The shell around split screen and tabs: a structure drawn for a figure or cell in place of the
// canvas beside, closing tabs, Reload / Restore Version with other windows open, and the drawing
// that takes the last tab's place.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';
import { newDocument } from '../src/document/document';
import { Workspace, type WorkspaceHooks } from '../src/workspace';

function workspace(extra: Partial<WorkspaceHooks> = {}) {
  const hooks: WorkspaceHooks = {
    leave: () => {}, enter: () => {}, changed: () => {}, flash: () => {},
    pptx: { async picture() { return null; }, async svgToPng() { return new Uint8Array(4); } },
    measure: (t: string, s: number) => t.length * s * 0.5,
    sheets: { read: async () => { throw new Error('no'); }, write: async () => '' },
    documents: { read: async () => ({ doc: newDocument(), warnings: [] }), write: async () => new Uint8Array() },
    ...extra,
  };
  const host = new Doc();
  return { ws: new Workspace(host, hooks), host };
}

const nodes = (data: Uint8Array) => (new TextDecoder().decode(data).match(/<n /g) ?? []).length;

describe('split screen while a figure or cell structure is drawn', () => {
  it('leaves the drawing beside unchanged, unmarked and saved as it was', async () => {
    const { ws, host } = workspace();
    const d = ws.active;
    host.edit('draw', () => { host.addAtom(0, 0); host.addAtom(20, 0); host.addAtom(40, 0); });
    ws.noteChange();
    d.dirty = false;
    const w = ws.newDocument();
    ws.setSplit({ left: w, right: d });
    expect(ws.pane).toBe(d);
    // what the app does for Insert > Structure: the figure takes the drawing's place in the app's document
    const saved = new Doc();
    host.swap(saved);
    ws.aside = saved;
    host.edit('figure', () => host.addAtom(5, 5));
    ws.noteChange();
    expect(d.dirty).toBe(false);
    expect(ws.docOf(d).atoms.size).toBe(3);
    // AutoSave and recovery write the drawing, not the figure
    expect(nodes((await ws.copyOf(d)).data)).toBe(3);
    // Done or Cancel: the drawing comes back, still not changed
    host.swap(saved);
    ws.aside = null;
    d.seen = host.version;
    ws.noteChange();
    expect(d.dirty).toBe(false);
    expect(ws.docOf(d).atoms.size).toBe(3);
  });
});

describe('split screen of any two tabs', () => {
  it('keeps a canvas beside a document live, and any other pair as two tabs with no canvas lent', () => {
    const { ws, host } = workspace();
    const d = ws.active;
    // (a canvas with something on it: a new file takes an empty one's place)
    host.edit('draw', () => host.addAtom(0, 0));
    ws.noteChange();
    const w = ws.newDocument();
    ws.setSplit({ left: d, right: w });
    expect(ws.besideOf(w)).toBe(d);
    expect(ws.besideOf(d)).toBe(w);
    expect(ws.pane).toBe(d);
    // a deck beside the document: neither uses the other's drawing area
    const s = ws.newSlides();
    ws.activate(w);
    ws.setSplit({ left: s, right: w });
    expect(ws.pane).toBeNull();
    expect(ws.besideOf(s)).toBe(w);
    expect(ws.besideOf(d)).toBeNull();
    // two canvases
    const d2 = ws.newDrawing();
    ws.setSplit({ left: d, right: d2 });
    expect(ws.pane).toBeNull();
    expect(ws.besideOf(d2)).toBe(d);
  });

  it('shows the canvas beside a document again on coming back to the document', () => {
    const { ws, host } = workspace();
    const d = ws.active;
    host.edit('draw', () => host.addAtom(0, 0));
    ws.noteChange();
    const w = ws.newDocument();
    ws.setSplit({ left: w, right: d });
    const s = ws.newSlides();
    expect(ws.active).toBe(s);
    // another tab shows on its own: the canvas is back in its own tab
    expect(ws.pane).toBeNull();
    expect(ws.split).not.toBeNull();
    ws.activate(w);
    expect(ws.pane).toBe(d);
  });

  it('refuses a tab beside itself or a tab not open', () => {
    const { ws } = workspace();
    const d = ws.active;
    ws.setSplit({ left: d, right: d });
    expect(ws.split).toBeNull();
    const w = ws.newDocument();
    ws.setSplit({ left: w, right: { ...d, id: 999 } });
    expect(ws.split).toBeNull();
  });
});

describe('split screen and Reload', () => {
  it('brings the canvas back in beside a document reloaded in its place', async () => {
    const { ws, host } = workspace();
    const d = ws.active;
    host.edit('draw', () => host.addAtom(0, 0));
    ws.noteChange();
    const w = ws.newDocument();
    w.ref = { kind: 'path', path: '/x/report.docx' };
    w.name = 'report.docx';
    ws.setSplit({ left: w, right: d });
    expect(ws.pane).toBe(d);
    const t = (await ws.openAs(new Uint8Array([1, 2, 3]), 'v.docx', { name: w.name, ref: w.ref, dirty: false, stamp: null, replace: w }))!;
    expect(ws.split).toEqual({ left: t, right: d });
    expect(ws.pane).toBe(d);
    expect(ws.docOf(d).atoms.size).toBe(1);
  });
});

describe('closing tabs', () => {
  it('lets the app finish what is being drawn before any tab closes', async () => {
    const closing = vi.fn();
    const { ws } = workspace({ closing });
    const d = ws.active;
    const w = ws.newDocument();
    ws.setSplit({ left: w, right: d });
    await ws.close(d);
    expect(ws.split).toBeNull();
    expect(ws.pane).toBeNull();
    expect(closing).toHaveBeenCalledWith(d);
  });

  it('gives the drawing taking the last tab\'s place the style and page of a new drawing', async () => {
    const page = { name: 'a4', w: 595, h: 842, grow: true };
    const { ws, host } = workspace({ newStyle: () => ({ ...ACS_1996, name: 'Mine', bondLength: 30 }), newPage: () => ({ ...page }) });
    await ws.close(ws.active);
    expect(ws.tabs).toHaveLength(1);
    expect(host.style.name).toBe('Mine');
    expect(host.style.bondLength).toBe(30);
    expect(host.page).toEqual(page);
  });
});

describe('Reload and Restore Version with the document in other windows', () => {
  it('shows the new copy in every window, which then saves to the same file', async () => {
    const { ws } = workspace();
    const main = ws.newDocument();
    main.ref = { kind: 'path', path: '/x/report.docx' };
    main.name = 'report.docx';
    const win = ws.newWindow()!;
    ws.activate(main);
    const t = (await ws.openAs(new Uint8Array([1, 2, 3]), 'v.docx', { name: main.name, ref: main.ref, dirty: true, stamp: null, replace: main }))!;
    expect(ws.tabs).not.toContain(main);
    expect(win.windowOf).toBe(t);
    expect(win.document).toBe(t.document);
    expect(win.dirty).toBe(true);
    expect(ws.label(win)).toBe('report.docx:2');
  });
});
