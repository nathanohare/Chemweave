// @vitest-environment jsdom
// Code review batch 07 (Document mode): the ones that need the document open.
//  F071 right-click on the body while a box is open; F072 Text Highlight Color menu in a cell;
//  F463 highlight with Select Text with Similar Formatting; F074 Paste from a menu; F461 the
//  Assistant writing at the start; F470 Change Case with nothing selected; F472 0 rows or
//  columns; F473 Compound Number in a cell; F462 Read Mode and tabs; F465 a new split pane;
//  F466 and F468 cancelled pointers; F467 a link to a heading; F075 the top-right corner handle.
import { describe, expect, it, vi } from 'vitest';

// (the first test opens the whole program)
vi.setConfig({ testTimeout: 60000 });

let answers: Record<string, string>[] = [];
vi.mock('../src/ui/ask', () => ({
  ask: vi.fn(async (_t: string, fields: { name: string; value?: string }[]) => ({ ...Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])), ...(answers.shift() ?? {}) })),
  askChoice: vi.fn(async () => 'no'),
}));
let link: { link: string; text?: string } | null = null;
vi.mock('../src/ui/links-ui', async (orig) => ({ ...(await orig<typeof import('../src/ui/links-ui')>()), askLink: vi.fn(async () => link) }));

import { docMode, type } from './doc-mode-harness';
import { newDocument, objectRun } from '../src/document/document';
import { structureDoc } from '../src/sheet/structure-doc';
import { freeRing, placeRing } from '../src/chem/chemgeom';
import { ACS_1996 } from '../src/style';

type Private = Record<string, (...a: never[]) => unknown> & { view: { scroller: HTMLElement; toDoc: (x: number, y: number) => { x: number; y: number }; gridlines: boolean }; split: { view: { gridlines: boolean }; bar: HTMLElement; host: HTMLElement } | null; dragging: unknown; readPage: number; tab: { sheetState: unknown } };
const priv = (dm: unknown) => dm as Private & { [k: string]: never };
const table = { kind: 'table', table: { cols: [100, 100], rows: [[{ runs: [{ text: 'Entry' }] }, { runs: [{ text: 'Yield' }] }]], head: 1 } };
const highlights = (runs: { text: string; highlight?: string }[]) => runs.filter((r) => r.highlight).map((r) => r.text);

describe('Highlight in a table cell (F072)', () => {
  it('the color menu changes the word selected in the cell, not the document body', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'Body text ' }], paras: [{}], objects: { 2: table } as never });
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(2, {})] }, 'Insert table');
    const p = priv(dm);
    p.startCell(2 as never, 0 as never, 1 as never);
    f.textEd.select(0, 5);
    // something selected in the body too (the table's own place), which must stay as it is
    p.highlightMenu();
    const pick = document.querySelector<HTMLButtonElement>('.hl-menu .hl-grid button')!;
    pick.click();
    const cell = (f.t.objects[2] as { table: { rows: { runs: { text: string; highlight?: string }[] }[][] } }).table.rows[0][1].runs;
    expect(highlights(cell)).toEqual(['Yield']);
    expect(highlights(f.t.runs as never)).toEqual([]);
  });
});

describe('Select Text with Similar Formatting then highlight (F463)', () => {
  it('highlights every place that was found, as bold does', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'ab', bold: true }, { text: ' cd ' }, { text: 'ab', bold: true }], paras: [{}] });
    f.ed.setCaret(1);
    dm.run('select-similar');
    dm.run('doc-highlight');
    expect(highlights(f.t.runs as never)).toEqual(['ab', 'ab']);
    // one step to undo
    f.ed.undo();
    expect(highlights(f.t.runs as never)).toEqual([]);
  });
});

describe('Paste from a menu (F074)', () => {
  it('brings the structures and fields of what was copied here, as Ctrl+V does', async () => {
    let clipboard = '';
    const drawing = { kind: 'drawing', contents: { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] } };
    const { dm, f } = await docMode({ runs: [{ text: 'See ' }, objectRun(1, {}), { text: ' there.' }], paras: [{}], objects: { 1: drawing } as never },
      { readPaste: async () => ({ text: clipboard }), copiedOther: () => {} });
    const objectsIn = () => f.t.runs.filter((r) => r.obj !== undefined).length;
    // Ctrl+C
    f.ed.selectAll();
    const data = new Map<string, string>();
    dm.copy({ clipboardData: { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '' }, preventDefault() {} } as never, false);
    clipboard = data.get('text/plain')!;
    f.ed.setCaret(f.ed.text.length);
    expect(objectsIn()).toBe(1);
    // Home > Paste (no clipboard event)
    await dm.paste(null);
    expect(objectsIn()).toBe(2);
  });
});

describe('The Assistant writing text (F461)', () => {
  it('at the very start there is no empty paragraph before the text', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'First' }], paras: [{}] });
    f.ed.setCaret(0);
    dm.writeText('Intro', false);
    expect(f.ed.text.startsWith('\n')).toBe(false);
    expect(f.ed.text).toContain('Intro');
    // after text, it goes on a paragraph of its own
    f.ed.setCaret(f.ed.text.length);
    dm.writeText('Next', false);
    expect(f.ed.text.endsWith('\nNext')).toBe(true);
  });
});

describe('Change Case with the cursor in a word (F470)', () => {
  it('goes round as Word\'s Shift+F3 does (the word looked at is the one at the cursor)', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'hello world' }], paras: [{}] });
    f.ed.setCaret(2);
    const step = () => { dm.run('change-case'); return f.ed.text; };
    // lower case goes to Capitalize Each Word, that to UPPERCASE, that to lowercase (it used to stop at the first UPPERCASE)
    expect(step()).toBe('Hello world');
    expect(step()).toBe('HELLO world');
    expect(step()).toBe('hello world');
  });
});

describe('Insert Table with 0 rows or columns (F472)', () => {
  it('a 0 is the smallest table, 1 by 1 (not the usual 4 by 3)', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'x' }], paras: [{}] });
    answers = [{ rows: '0', cols: '0', kind: 'grid' }];
    await priv(dm).insertTable();
    const t = Object.values(f.t.objects).find((o) => o.kind === 'table') as { table: { rows: unknown[][]; cols: number[] } };
    expect([t.table.rows.length, t.table.cols.length]).toEqual([1, 1]);
  });

  it('nothing typed is the box\'s own 4 by 3', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'x' }], paras: [{}] });
    answers = [{ rows: '', cols: '', kind: 'grid' }];
    await priv(dm).insertTable();
    const t = Object.values(f.t.objects).find((o) => o.kind === 'table') as { table: { rows: unknown[][]; cols: number[] } };
    expect([t.table.rows.length, t.table.cols.length]).toEqual([4, 3]);
  });
});

describe('Compound Number in a table cell (F473)', () => {
  it('what is typed after it is not bold', async () => {
    const { dm, f, ta } = await docMode({ runs: [{ text: 'Body ' }], paras: [{}], objects: { 2: table } as never });
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(2, {})] }, 'Insert table');
    const p = priv(dm);
    p.startCell(2 as never, 0 as never, 1 as never);
    f.textEd.setCaret(f.textEd.text.length);
    answers = [{ which: 'new' }];
    await p.compoundNumber();
    type(ta, ' was made');
    const cell = (f.t.objects[2] as { table: { rows: { runs: { text: string; bold?: boolean; obj?: number }[] }[][] } }).table.rows[0][1].runs;
    const typed = cell.find((r) => r.text.includes('was made'));
    expect(typed).toBeDefined();
    expect(typed!.bold).toBeFalsy();
  });
});

const drawing = (n = 6) => {
  // a ring drawn in the document's own style, so it has a size on the page
  const doc = structureDoc({ atoms: [], bonds: [], captions: [], arrows: [], shapes: [] }, ACS_1996);
  doc.bulk(() => { placeRing(doc, freeRing({ x: 0, y: 0 }, n, ACS_1996.bondLength), { aromatic: true }); });
  return { kind: 'drawing', contents: doc.contents() };
};

describe('Right-click on the body while typing in a box (F071)', () => {
  it('leaves the box first, so the menu is about the body text clicked', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'Body text ' }, objectRun(1, {})], paras: [{}], objects: { 1: { kind: 'note', runs: [{ text: 'Note' }] } } as never });
    const p = priv(dm);
    p.startBox(1 as never);
    expect(f.box).not.toBeNull();
    // the pointer is on the body (the note's own text is at the foot of the page)
    p.view.scroller.dispatchEvent(new MouseEvent('contextmenu', { clientX: 5, clientY: 5, bubbles: true, cancelable: true }));
    expect(f.box).toBeNull();
  });

  it('in a header being typed in: leaves it for the body text, stays for the header', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'Body text' }], paras: [{}] });
    const p = priv(dm);
    const hfAt = vi.spyOn(p.view as unknown as { hfAt(x: number, y: number): unknown }, 'hfAt');
    p.startHf(0 as never, 'header' as never);
    expect(f.box?.hf).toBeTruthy();
    // the pointer on the header: the menu is about it, the box stays
    hfAt.mockReturnValue({ page: 0, kind: 'header' });
    p.view.scroller.dispatchEvent(new MouseEvent('contextmenu', { clientX: 5, clientY: 5, bubbles: true, cancelable: true }));
    expect(f.box?.hf).toBeTruthy();
    // the pointer on the body: the header is left, and the menu is not made of the header's text
    hfAt.mockReturnValue(null);
    p.view.scroller.dispatchEvent(new MouseEvent('contextmenu', { clientX: 5, clientY: 5, bubbles: true, cancelable: true }));
    expect(f.box).toBeNull();
  });
});

describe('Read Mode and tabs (F462)', () => {
  it('comes back on the page that was being read', async () => {
    const pages = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    const { dm, f } = await docMode({ runs: [{ text: pages.join('\n') }], paras: pages.map((_, i) => (i ? { pageBreak: true } : {})) });
    const p = priv(dm);
    expect(f.layout().pages.length).toBeGreaterThanOrEqual(6);
    dm.run('view-read');
    p.turn(1 as never);
    p.turn(1 as never);
    expect(p.readPage).toBe(4);
    dm.leave();
    dm.show(p.tab as never);
    expect(p.readPage).toBe(4);
  });
});

describe('A new split pane (F465)', () => {
  it('shows tables with gridlines when View Gridlines is on', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'x' }], paras: [{}], objects: { 2: table } as never });
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(2, {})] }, 'Insert table');
    const p = priv(dm);
    p.startCell(2 as never, 0 as never, 0 as never);
    dm.run('table-gridlines');
    expect(p.view.gridlines).toBe(true);
    dm.run('view-split');
    expect(p.split!.view.gridlines).toBe(true);
  });
});

describe('Pointers that are cancelled (F466, F468)', () => {
  it('the split bar stops following the pointer', async () => {
    const { dm } = await docMode({ runs: [{ text: 'x' }], paras: [{}] });
    const p = priv(dm);
    dm.run('view-split');
    const { bar, host } = p.split!;
    (bar as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    bar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    bar.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }));
    expect(host.style.flexBasis).not.toBe('');
    bar.dispatchEvent(new Event('pointercancel'));
    host.style.flexBasis = '';
    bar.dispatchEvent(new MouseEvent('pointermove', { clientY: 10 }));
    expect(host.style.flexBasis).toBe('');
  });

  it('a drag in the page ends', async () => {
    const { dm } = await docMode({ runs: [{ text: 'x' }], paras: [{}] });
    const p = priv(dm);
    p.dragging = { kind: 'text' };
    p.view.scroller.dispatchEvent(new Event('pointercancel'));
    expect(p.dragging).toBeNull();
  });
});

describe('A link to a heading (F467)', () => {
  it('the hidden bookmark and the link are one step of Undo', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'Intro\nSee here' }], paras: [{ style: 'Heading1' }, {}] });
    f.ed.select(f.ed.text.indexOf('here'), f.ed.text.length);
    link = { link: '#heading:0', text: 'here' };
    await priv(dm).editLink();
    expect(f.t.runs.some((r) => r.link)).toBe(true);
    expect(f.t.paras.some((q) => q.marks?.length)).toBe(true);
    f.ed.undo();
    expect(f.t.runs.some((r) => r.link)).toBe(false);
    expect(f.t.paras.some((q) => q.marks?.length)).toBe(false);
  });
});

describe('A link to a heading from a table cell (F467)', () => {
  it('the hidden bookmark and the link are one step of Undo while typing in the cell', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'Intro\n' }, objectRun(2, {})], paras: [{ style: 'Heading1' }, {}], objects: { 2: table } as never });
    const p = priv(dm);
    p.startCell(2 as never, 0 as never, 0 as never);
    f.textEd.select(0, 5);
    link = { link: '#heading:0', text: 'Entry' };
    await p.editLink();
    const cellRuns = () => (f.t.objects[2] as { table: { rows: { runs: { link?: string }[] }[][] } }).table.rows[0][0].runs;
    expect(cellRuns().some((r) => r.link)).toBe(true);
    expect(f.t.paras.some((q) => q.marks?.length)).toBe(true);
    f.ed.undo();
    expect(cellRuns().some((r) => r.link)).toBe(false);
    expect(f.t.paras.some((q) => q.marks?.length)).toBe(false);
  });
});

describe('A letter of a compound number typed in a table cell (F488)', () => {
  it('the link, the number and its letter are one step of Undo while typing in the cell', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'Made ' }, objectRun(3, {}), { text: ' and ' }, objectRun(2, {})], paras: [{}], objects: { 2: table, 3: { kind: 'seq', name: 'Compound' } } as never });
    const p = priv(dm);
    p.startCell(2 as never, 0 as never, 0 as never);
    f.textEd.setCaret(f.textEd.text.length);
    const cell = () => (f.t.objects[2] as { table: { rows: { runs: { text: string; obj?: number }[] }[][] } }).table.rows[0][0].runs;
    const before = JSON.stringify(f.t);
    (priv(dm).siUi as unknown as { mention(seq: number, letters: string, key: string, link: boolean): void }).mention(3, 'd', 'k1', true);
    expect(cell().length).toBeGreaterThan(1);
    expect((f.t.objects[3] as { si?: Record<string, string> }).si).toEqual({ d: 'k1' });
    f.ed.undo();
    expect(JSON.stringify(f.t)).toBe(before);
  });
});

describe('A structure\'s top-right corner handle (F075)', () => {
  it('drags from the left edge, which stays where it is (it used to start from the right edge, as a width of nothing)', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'Text ' }, objectRun(1, {}), { text: ' more' }], paras: [{}], objects: { 1: drawing() } as never });
    const p = priv(dm);
    f.ed.select(5, 6);
    const o = f.layout().objects.find((x) => x.id === 1)!;
    expect(dm.pickedObject()).toBe(1);
    // client coordinates are the document's, and the scrolling area is wide
    p.view.toDoc = (x: number, y: number) => ({ x, y });
    (p.view as unknown as { zoom: number }).zoom = 1;
    for (const k of ['clientWidth', 'clientHeight']) Object.defineProperty(p.view.scroller, k, { value: 5000, configurable: true });
    (p.view.scroller as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    const down = { button: 0, clientX: o.x + o.w, clientY: o.y, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, pointerId: 1, preventDefault() {} };
    p.pointerDown(down as never);
    const d = p.dragging as { kind: string; x0: number; left: boolean; top: boolean };
    expect(d.kind).toBe('resize');
    expect([d.left, d.top]).toEqual([false, true]);
    expect(d.x0).toBeCloseTo(o.x, 6);
  });
});

describe('Wrap Text from in line, in a section of another page size (F469)', () => {
  it('the figure stays where it was shown', async () => {
    const n = newDocument();
    // the first section is landscape, the second (where the figure is) portrait: its pages sit in the middle of the wider ones
    const landscape = { ...n.page, w: 792, h: 612 };
    const portrait = { ...n.page, w: 612, h: 792, left: 90, right: 54 };
    const { dm, f } = await docMode({
      page: landscape, runs: [{ text: 'First\nSee ' }, objectRun(1, {}), { text: ' there.' }], paras: [{}, { section: { kind: 'nextPage', page: portrait, restart: undefined } }],
      objects: { 1: drawing() } as never,
    });
    const was = f.layout().objects.find((x) => x.id === 1)!;
    dm.setWrap(1, 'square');
    const now = f.layout().objects.find((x) => x.id === 1)!;
    expect(now.x).toBeCloseTo(was.x, 1);
  });
});
