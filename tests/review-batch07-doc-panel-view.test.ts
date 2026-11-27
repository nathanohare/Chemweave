// @vitest-environment jsdom
// Code review batch 07: the Document panel and the page view.
//  F480 a floating figure's "... from" measured with its own page's margins; F481 Line spacing "At"
//  reads the paragraph typed in (a table cell's), not the body's; F482 clearing First page number
//  leaves the numbering alone; F491 a view taken away stops watching; F081 the views without pages
//  draw only the lines on the screen.
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60000 });
const drawn: { from: number; to: number }[] = [];
vi.mock('../src/text/draw', async (orig) => {
  const real = await orig<typeof import('../src/text/draw')>();
  return { ...real, drawLayout: (ctx: never, lay: { lines: unknown[] }, ox: number, oy: number, from = 0, to = lay.lines.length) => { drawn.push({ from, to }); return real.drawLayout(ctx, lay as never, ox, oy, from, to); } };
});
const watchers: { off: ReturnType<typeof vi.fn> }[] = [];
vi.mock('../src/render/images', async (orig) => {
  const real = await orig<typeof import('../src/render/images')>();
  return { ...real, onImageReady: (fn: () => void) => { const off = vi.fn(real.onImageReady(fn)); watchers.push({ off }); return off; } };
});

import { docMode } from './doc-mode-harness';
import { newDocument, objectRun } from '../src/document/document';
import { DocView } from '../src/ui/doc-view';

type Panel = { fields: Map<string, HTMLInputElement | HTMLSelectElement>; refrom(axis: 'x' | 'y', from: string): void };
const panelOf = (dm: unknown) => (dm as { panel: Panel }).panel;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('A figure\'s position "from" (F480)', () => {
  it('uses the margins of the page the figure is on: Margin to Page keeps it where it is', async () => {
    const n = newDocument();
    const portrait = { ...n.page, left: 100 };
    const { dm, f } = await docMode({
      runs: [{ text: 'First\nSee ' }, objectRun(1, {}), { text: ' there.' }], paras: [{}, { section: { kind: 'nextPage', page: portrait, restart: undefined } }],
      objects: { 1: { kind: 'picture', src: PNG, w: 50, h: 40, float: { wrap: 'square', x: 10, y: 0 } } } as never,
    });
    f.ed.select(f.ed.text.indexOf('\n') + 5, f.ed.text.indexOf('\n') + 6);
    expect(dm.pickedObject()).toBe(1);
    panelOf(dm).refrom('x', 'page');
    const fl = (f.t.objects[1] as { float: { x: number; xFrom?: string } }).float;
    expect(fl.xFrom).toBe('page');
    // 10 in from the second section's left margin, which is 100 in from the page's edge
    expect(fl.x).toBeCloseTo(110, 6);
  });
});

describe('Line spacing in a table cell (F481)', () => {
  it('"At" takes points for a cell paragraph that is Exactly, as the cell shows', async () => {
    const table = { kind: 'table', table: { cols: [100], rows: [[{ runs: [{ text: 'Cell' }], paras: [{ linePt: 14, lineRule: 'exact' }] }]], head: 0 } };
    const { dm, f } = await docMode({ runs: [{ text: 'Body ' }], paras: [{}], objects: { 2: table } as never });
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(2, {})] }, 'Insert table');
    (dm as unknown as { startCell(id: number, r: number, c: number): boolean }).startCell(2, 0, 0);
    const at = panelOf(dm).fields.get('p-line') as HTMLInputElement;
    at.dispatchEvent(new Event('focus'));
    at.value = '16';
    at.dispatchEvent(new Event('change'));
    const cell = (f.t.objects[2] as { table: { rows: { paras: { linePt?: number; line?: number }[] }[][] } }).table.rows[0][0];
    expect(cell.paras[0].linePt).toBe(16);
    expect(cell.paras[0].line).toBeUndefined();
  });
});

describe('Styles while a table cell is typed in (F481)', () => {
  it('the Style controls are left off, so no style is put on the paragraph that holds the table', async () => {
    const table = { kind: 'table', table: { cols: [100], rows: [[{ runs: [{ text: 'Cell' }], paras: [{}] }]], head: 0 } };
    const { dm, f } = await docMode({ runs: [{ text: 'Body ' }], paras: [{}], objects: { 2: table } as never });
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(2, {})] }, 'Insert table');
    const sel = panelOf(dm).fields.get('p-style') as HTMLSelectElement;
    const size = panelOf(dm).fields.get('s-size') as HTMLInputElement;
    (dm as unknown as { panel: { update(): void } }).panel.update();
    expect(sel.disabled).toBe(false);
    (dm as unknown as { startCell(id: number, r: number, c: number): boolean }).startCell(2, 0, 0);
    (dm as unknown as { panel: { update(): void } }).panel.update();
    expect(sel.disabled).toBe(true);
    expect(size.disabled).toBe(true);
    expect(sel.title).toMatch(/click it first/);
  });
});

describe('First page number (F482)', () => {
  it('clearing the box leaves the numbering alone, and 0 is a number (a cover page left unnumbered)', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'x' }], paras: [{}] });
    const box = panelOf(dm).fields.get('hf-start') as HTMLInputElement;
    const was = JSON.stringify(f.t);
    box.dispatchEvent(new Event('focus'));
    box.value = '';
    box.dispatchEvent(new Event('change'));
    expect(JSON.stringify(f.t)).toBe(was);
    box.dispatchEvent(new Event('focus'));
    box.value = '0';
    box.dispatchEvent(new Event('change'));
    expect(JSON.stringify(f.t)).not.toBe(was);
    expect(box.value).toBe('0');
    box.dispatchEvent(new Event('focus'));
    box.value = 'x';
    box.dispatchEvent(new Event('change'));
    // not a number: the box shows what the section has
    expect(box.value).toBe('0');
    box.dispatchEvent(new Event('focus'));
    box.value = '5';
    box.dispatchEvent(new Event('change'));
    expect(box.value).toBe('5');
  });
});

describe('A view taken away (F491)', () => {
  it('stops watching its window and the pictures', () => {
    const disconnect = vi.fn();
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() { disconnect(); } };
    watchers.length = 0;
    const v = new DocView(document.createElement('div'));
    expect(watchers).toHaveLength(1);
    v.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(watchers[0].off).toHaveBeenCalledTimes(1);
  });
});

describe('Draft view on a long document (F081)', () => {
  it('draws the lines on the screen, not all of them', async () => {
    const paras = Array.from({ length: 800 }, (_, i) => `Paragraph ${i} of a long document.`);
    const { dm, f } = await docMode({ runs: [{ text: paras.join('\n') }], paras: paras.map(() => ({})) });
    dm.run('view-draft');
    const lines = f.layout().text.lines.length;
    expect(lines).toBeGreaterThan(700);
    drawn.length = 0;
    (dm as unknown as { view: DocView }).view.paint();
    const total = drawn.reduce((s, d) => s + (d.to - d.from), 0);
    expect(drawn.length).toBeGreaterThan(0);
    expect(total).toBeLessThan(lines / 4);
  });
});
