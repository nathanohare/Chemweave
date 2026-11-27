// @vitest-environment jsdom
// Code review batch 07: the Table tab and other small windows.
//  F489 Cell Margins, pressed OK with nothing changed, changes nothing (the boxes show margins
//  rounded to a hundredth of an inch, and were read back as new margins); F490 the style gallery
//  lets go of Escape once a style is picked; F484 Sort Table with "The first row is a heading"
//  unchecked sorts the heading row too; F080, F487 and F488 SI commands are one step of Undo;
//  F491 a view taken away stops watching its window and the pictures.
import { afterEach, describe, expect, it, vi } from 'vitest';

type Field = { name: string; value?: string };
let answers: Record<string, string> = {};
let choice = 'fix';
vi.mock('../src/ui/ask', () => ({
  ask: vi.fn(async (_t: string, fields: Field[]) => ({ ...Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])), ...answers })),
  askChoice: vi.fn(async () => choice),
}));

import { DocTablesUI, type DocTablesHost } from '../src/ui/doc-tables-ui';
import { DEFAULT_MARGINS } from '../src/document/table-styles';
import { sortTableRows } from '../src/document/sort';
import { DocSiUI, type DocSiHost, type SiAccess } from '../src/ui/doc-si';
import { DocFile } from '../src/document/doc-file';
import { COMPOUND, newDocument, nextObjectId, objectRun, type DocObject, type DocText } from '../src/document/document';
import type { TableData } from '../src/model';
import type { SiFinding, SiView } from '../src/si/manuscript';
import * as rt from '../src/richtext';

// (the style previews are drawn on canvases that draw nothing here)
const noop = () => undefined;
(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 0 }) : noop), set: () => true });

afterEach(() => { document.body.innerHTML = ''; answers = {}; });

const cell = (text: string) => ({ runs: [{ text }] });
const grid = (): TableData => ({ cols: [60, 60], head: 1, rows: [[cell('Entry'), cell('Yield')], [cell('b'), cell('2')], [cell('a'), cell('1')]] } as unknown as TableData);

function tablesHost(t: TableData) {
  const set: { id: number; t: TableData; kind: string }[] = [];
  const host: DocTablesHost = {
    file: () => null, target: () => ({ id: 1, r: 0, c: 0, t }), block: () => null, setTable: (id, tt, kind) => { set.push({ id, t: tt, kind }); },
    textW: () => 400, flash: () => {}, focus: () => {}, leaveCell: () => {}, startCell: () => {}, changed: () => {}, inCell: () => true,
  };
  return { ui: new DocTablesUI(host), set };
}

describe('Cell Margins (F489)', () => {
  it('OK with nothing changed changes nothing: no new margins, no step of Undo', async () => {
    const { ui, set } = tablesHost(grid());
    await ui.cellMarginsDialog();
    expect(set).toEqual([]);
  });

  it('changing one box changes that margin only, the others keep their exact values', async () => {
    const { ui, set } = tablesHost(grid());
    answers = { top: '0.1' };
    await ui.cellMarginsDialog();
    expect(set).toHaveLength(1);
    const pad = set[0].t.pad!;
    expect(pad.top).toBeCloseTo(7.2, 6);
    expect([pad.bottom, pad.left, pad.right]).toEqual([DEFAULT_MARGINS.bottom, DEFAULT_MARGINS.left, DEFAULT_MARGINS.right]);
  });
});

describe('Table style gallery (F490)', () => {
  it('Escape after picking a style is not swallowed by the gallery that was taken away', async () => {
    const { ui, set } = tablesHost(grid());
    ui.styleGallery(10, 10);
    // (the gallery watches for clicks and keys from the next moment on)
    await new Promise((r) => setTimeout(r, 5));
    document.querySelector<HTMLButtonElement>('.table-gallery .tg-grid button')!.click();
    expect(set).toHaveLength(1);
    expect(document.querySelector('.table-gallery')).toBeNull();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
  });

  it('still closes at Escape when no style is picked', async () => {
    const { ui } = tablesHost(grid());
    ui.styleGallery(10, 10);
    await new Promise((r) => setTimeout(r, 5));
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(document.querySelector('.table-gallery')).toBeNull();
  });
});

describe('Sort Table with the heading box unchecked (F484)', () => {
  const firsts = (t: TableData) => t.rows.map((r) => rt.plainText(r[0].runs));
  it('sorts the heading row with the others when it is said not to be a heading', () => {
    const sorted = sortTableRows(grid(), { keys: [{ field: 0, type: 'text' }], header: false });
    expect(firsts(sorted)).toEqual(['a', 'b', 'Entry']);
    // and the table has no heading row left (the one at the top, 'a', is not styled or repeated as one)
    expect(sorted.head ?? 0).toBe(0);
  });
  it('keeps the heading row at the top when it is, or when nothing is said', () => {
    expect(firsts(sortTableRows(grid(), { keys: [{ field: 0, type: 'text' }], header: true }))).toEqual(['Entry', 'a', 'b']);
    expect(sortTableRows(grid(), { keys: [{ field: 0, type: 'text' }], header: true }).head).toBe(1);
    expect(firsts(sortTableRows(grid(), { keys: [{ field: 0, type: 'text' }] }))).toEqual(['Entry', 'a', 'b']);
  });
});

// ---------------------------------------------------------------- SI commands

const view = (labels: Record<string, string>): SiView => ({
  title: 'SI', targets: Object.entries(labels).map(([key, label]) => ({ key, kind: 'table', label })) as never, pages: new Map(), data: new Map(),
});

function siSetup(t: Partial<DocText>, access: Partial<SiAccess> = {}) {
  const f = new DocFile({ ...newDocument(), ...t } as DocText);
  const host = { file: () => f, ed: () => f.ed, insertObject: () => 1, flash: () => {}, focus: () => {}, si: () => ({ open: () => [{ path: '/p', title: 'P' }], pick: async () => null, view: async () => view({ t1: 'Table S1' }), openCompound() {}, openProject() {}, renumber: async () => 0, ...access }) } as unknown as DocSiHost;
  return { f, ui: new DocSiUI(host) };
}

describe('Use SI Values (F080)', () => {
  it('replaces every value in one step of Undo', async () => {
    const rows = [[cell('Entry'), cell('Yield')], [cell('1'), cell('50%')], [cell('2'), cell('60%')], [cell('3'), cell('70%')]];
    const { f, ui } = siSetup({ runs: [{ text: 'Table ' }, objectRun(5, {})], paras: [{}], objects: { 5: { kind: 'table', table: { cols: [60, 60], head: 1, rows } } } as never });
    const findings = [1, 2, 3].map((row): SiFinding => ({ level: 'problem', key: 'k' + row, id: String(row), what: 'yield', manuscript: '', si: '9' + row + '%', where: '', message: 'differs', at: { table: 5, row, col: 1, start: 0, end: 3 } }));
    (ui as unknown as { check: () => Promise<SiFinding[]> }).check = async () => findings;
    choice = 'fix';
    await ui.showCheck();
    const yields = () => (f.t.objects[5] as { table: TableData }).table.rows.slice(1).map((r) => rt.plainText(r[1].runs));
    expect(yields()).toEqual(['91', '92', '93']);
    f.ed.undo();
    expect(yields()).toEqual(['50%', '60%', '70%']);
  });
});

describe('Linking an SI (F487)', () => {
  it('the link and what it brings in are one step of Undo', async () => {
    const { f, ui } = siSetup({ runs: [{ text: 'See ' }, objectRun(7, {})], paras: [{}], objects: { 7: { kind: 'si', what: 'label', key: 't1', text: 'old' } } as never });
    answers = { which: 'open:/p', typed: 'false' };
    await ui.linkMenu();
    expect(f.t.siLink).toEqual({ path: '/p', title: 'P' });
    expect((f.t.objects[7] as { text: string }).text).toBe('Table S1');
    f.ed.undo();
    expect(f.t.siLink).toBeUndefined();
    expect((f.t.objects[7] as { text: string }).text).toBe('old');
  });
});

describe('What a link brings in, when the text was typed in meanwhile (F487)', () => {
  it('is a step of its own, not part of the typing', async () => {
    const { f, ui } = siSetup({ runs: [{ text: 'See ' }, objectRun(7, {})], paras: [{}], siLink: { path: '/p', title: 'P' }, objects: { 7: { kind: 'si', what: 'label', key: 't1', text: 'old' } } } as never);
    const linkedAs = f.t;
    // typed in after the link was made (while the SI was being read)
    f.ed.replace(0, 0, [{ text: 'Well, ' }], undefined, 'type');
    await ui.update(false, false, false, linkedAs);
    expect((f.t.objects[7] as { text: string }).text).toBe('Table S1');
    f.ed.undo();
    // only what the link brought in is undone: the typing stays
    expect((f.t.objects[7] as { text: string }).text).toBe('old');
    expect(f.ed.text).toBe('Well, See \uFFFC');
  });
});

describe('A letter of an existing compound number (F488)', () => {
  it('the link, the number and its letter are one step of Undo', () => {
    const { f, ui } = siSetup({ runs: [{ text: 'Made ' }, objectRun(3, {}), { text: ' and ' }], paras: [{}], objects: { 3: { kind: 'seq', name: COMPOUND } } as never });
    // the document's insertion, as the program makes it: the object, then its place in the text (one step of its own)
    const host = (ui as unknown as { host: DocSiHost }).host;
    host.insertObject = (o: DocObject, kind = 'Insert') => {
      const id = nextObjectId(f.t);
      f.ed.update({ ...f.t, objects: { ...f.t.objects, [id]: o } } as DocText, kind);
      f.ed.replace(f.ed.start, f.ed.end, [objectRun(id, {})], undefined, null);
      return id;
    };
    f.ed.setCaret(f.ed.text.length);
    const before = rt.plainText(f.t.runs);
    (ui as unknown as { mention: (seq: number, letters: string, key: string, link: boolean) => void }).mention(3, 'd', 'k1', true);
    expect(rt.plainText(f.t.runs)).toContain('d');
    expect((f.t.objects[3] as { si?: Record<string, string> }).si).toEqual({ d: 'k1' });
    f.ed.undo();
    expect(rt.plainText(f.t.runs)).toBe(before);
    expect((f.t.objects[3] as { si?: Record<string, string> }).si).toBeUndefined();
  });
});
