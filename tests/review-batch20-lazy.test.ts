// @vitest-environment jsdom
//
// Review batch 20, windows that painted every slide or chart at once:
//  F151 the All Charts pane waits for the selection to settle and draws one chart at a time;
//  F174 Reuse Slides is on screen before its pictures are painted, a few at a time;
//  F753 Notes Page view paints its slides a few at a time.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const paints = vi.hoisted(() => ({ slides: 0, charts: 0, order: [] as string[] }));
vi.mock('../src/deck/slide-view', () => ({ paintSlide: () => { paints.slides++; paints.order.push('paint'); return { x: 0, y: 0, k: 1 }; } }));
vi.mock('../src/render/chart-draw', async (orig) => ({
  ...(await orig<typeof import('../src/render/chart-draw')>()),
  chartCanvas: () => { paints.charts++; return document.createElement('canvas'); },
}));

import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { Workbook } from '../src/sheet/workbook';
import { ChartGallery } from '../src/ui/chart-gallery';
import { pickReuseSlides } from '../src/ui/reuse-slides';
import { NotesPageView } from '../src/ui/notes-page-view';

let clock = 0;
beforeEach(() => {
  paints.slides = 0; paints.charts = 0; paints.order = [];
  vi.useFakeTimers();
  // every look at the clock is 20 ms later, so a slice of painting (30 ms) takes two pictures
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (clock += 20));
  (HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { paints.order.push('shown'); this.setAttribute('open', ''); };
  document.body.replaceChildren();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('F151: the All Charts pane', () => {
  function gallery() {
    const wb = new Workbook(['S']);
    wb.edit('fill', () => { for (let r = 0; r < 8; r++) { wb.sheet.setInput(r, 0, `n${r}`); wb.sheet.setInput(r, 1, String(r * 3)); } });
    const view = { sheet: wb.sheet, wb, sel: { range: { r1: 0, c1: 0, r2: 7, c2: 1 } } };
    const g = new ChartGallery(() => view as never, () => undefined);
    return { g, view };
  }

  it('draws the pane\'s charts one after another, with every button there at once', () => {
    const { g } = gallery();
    g.toggle();
    expect(document.querySelectorAll('.cg-item')).toHaveLength(14);
    expect(paints.charts).toBeLessThan(14);
    vi.runAllTimers();
    expect(paints.charts).toBe(14);
  });

  it('draws again once, after the selection stops changing, not at every step of it', () => {
    const { g, view } = gallery();
    g.toggle();
    vi.runAllTimers();
    paints.charts = 0;
    for (const r2 of [3, 4, 5, 6]) { view.sel.range = { r1: 0, c1: 0, r2, c2: 1 }; g.refresh(true); }
    expect(paints.charts).toBe(0);
    vi.runAllTimers();
    expect(paints.charts).toBe(14);
  });
});

describe('F174: Reuse Slides', () => {
  it('is shown before any of its pictures is painted, and then paints them all', () => {
    const from = { slides: Array.from({ length: 12 }, () => ({})), size: { w: 960, h: 540 }, page: () => ({}), docOf: () => new Doc() } as unknown as Deck;
    void pickReuseSlides('big.pptx', from, false);
    expect(paints.order[0]).toBe('shown');
    expect(paints.slides).toBeLessThan(12);
    vi.runAllTimers();
    expect(paints.slides).toBe(12);
    expect(document.querySelectorAll('.rs-card canvas')).toHaveLength(12);
  });

  it('stops painting when the window is closed', () => {
    const from = { slides: Array.from({ length: 12 }, () => ({})), size: { w: 960, h: 540 }, page: () => ({}), docOf: () => new Doc() } as unknown as Deck;
    void pickReuseSlides('big.pptx', from, false);
    document.querySelector('dialog')!.dispatchEvent(new Event('close'));
    vi.runAllTimers();
    expect(paints.slides).toBe(0);
  });
});

describe('F753: Notes Page view', () => {
  function view(slides: number) {
    const d = Deck.blank(new Doc());
    d.attach();
    for (let i = 1; i < slides; i++) d.addSlide();
    const host = document.createElement('div');
    document.body.append(host);
    const v = new NotesPageView(host, { deck: () => d, open: () => undefined });
    return { v, host };
  }

  it('has every page up at once and paints the slides a few at a time', () => {
    const { v, host } = view(10);
    v.show(true);
    expect(host.querySelectorAll('.np-page')).toHaveLength(10);
    expect(paints.slides).toBeLessThan(10);
    vi.runAllTimers();
    expect(paints.slides).toBe(10);
  });

  it('stops painting the pages of a view that was closed or built again', () => {
    const { v } = view(10);
    v.show(true);
    const first = paints.slides;
    v.show(false);
    vi.runAllTimers();
    expect(paints.slides).toBe(first);
  });
});
