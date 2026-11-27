// @vitest-environment jsdom
// Code review batch 13, the slide list: F187 (a section let go over its own heading stays put),
// F838 (the section of the slide being edited can be folded), F839 (two slides edited within the
// wait both get their pictures redrawn), F185 and F186 (a rebuild or a repaint of every picture
// does not draw every slide again).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const painted: number[] = [];
vi.mock('../src/deck/slide-view', async (orig) => ({
  ...(await orig<typeof import('../src/deck/slide-view')>()),
  // a stand-in for the drawing, which needs a real canvas: it notes which slide it drew
  paintSlide: (c: HTMLCanvasElement, w: number, h: number, _dpr: number, page: { index: number }) => { c.width = w; c.height = h; painted.push(page.index); },
}));

import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { SlideList, type SlideListHooks } from '../src/ui/slide-list';

const hooks = (deck: Deck): SlideListHooks => ({
  go: (i) => deck.go(i), remove() {}, duplicate() {}, add() {}, copy() {}, cut() {}, paste() {}, menu() {},
});

function deckWith(n: number): Deck {
  const d = Deck.blank(new Doc());
  d.attach();
  for (let i = 1; i < n; i++) d.addSlide('title-content');
  return d;
}

function listFor(deck: Deck): SlideList {
  const el = document.createElement('div');
  document.body.append(el);
  const list = new SlideList(el, hooks(deck));
  list.show(deck);
  return list;
}

beforeEach(() => {
  painted.length = 0;
  // a canvas that can be copied from
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as never;
  (Element.prototype as { scrollIntoView: () => void }).scrollIntoView = () => {};
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('F187: a section let go over its own heading', () => {
  it('stays where it is', () => {
    const d = deckWith(6);
    const a = d.addSection(0, 'A'), b = d.addSection(2, 'B'), c = d.addSection(4, 'C');
    const list = listFor(d);
    const move = vi.spyOn(d, 'moveSection');
    const l = list as unknown as { dragSection: number | null; dropAt: () => unknown; onDrop: (e: unknown) => void };
    l.dragSection = b;
    l.dropAt = () => ({ at: 2, section: b, mark: { x: 0, y: 0, vertical: false } });
    l.onDrop({ clientX: 0, clientY: 0, preventDefault() {} });
    expect(move).not.toHaveBeenCalled();
    expect(d.sections.map((x) => x.id)).toEqual([a, b, c]);
  });
});

describe('F838: folding the section of the slide being edited', () => {
  it('folds when its arrow is clicked, and opens again when a slide in it is gone to', () => {
    const d = deckWith(4);
    const a = d.addSection(0, 'A');
    const b = d.addSection(2, 'B');
    d.go(0);
    d.onChange = () => list.rebuild();
    const list = listFor(d);
    expect(d.slides[d.index].section).toBe(a);
    (document.querySelector(`.sl-sec[data-section="${a}"] .sl-sec-fold`) as HTMLElement).click();
    expect(d.folded.has(a)).toBe(true);
    expect(document.querySelector(`.sl-sec[data-section="${a}"]`)!.classList.contains('folded')).toBe(true);
    expect(document.querySelectorAll('.sl-item').length).toBe(2);
    // going to a slide of the folded section opens it
    d.go(2);
    d.go(0);
    list.switched();
    expect(d.folded.has(a)).toBe(false);
    expect(b).toBeGreaterThan(0);
  });
});

describe('F839: two slides edited within the wait', () => {
  it('both pictures are redrawn', () => {
    const d = deckWith(3);
    const list = listFor(d);
    vi.advanceTimersByTime(1000);
    painted.length = 0;
    list.refresh(0);
    vi.advanceTimersByTime(100);
    list.refresh(1);
    vi.advanceTimersByTime(300);
    expect(painted.sort()).toEqual([0, 1]);
  });
});

describe('F185: a rebuild draws only the slides that changed', () => {
  it('copies the pictures of slides that look as they did', () => {
    const d = deckWith(5);
    const list = listFor(d);
    vi.advanceTimersByTime(1000);
    expect(painted.length).toBe(5);
    painted.length = 0;
    list.rebuild();
    vi.advanceTimersByTime(1000);
    expect(painted).toEqual([]);
  });

  it('draws a slide again after it was edited', () => {
    const d = deckWith(3);
    const list = listFor(d);
    vi.advanceTimersByTime(1000);
    painted.length = 0;
    d.editSlides('Edit', [1], (doc) => { doc.addAtom(100, 100); });
    list.rebuild();
    vi.advanceTimersByTime(1000);
    expect(painted).toEqual([1]);
  });

  it('draws the slide being edited at once and the rest a few at a time', () => {
    const d = deckWith(4);
    painted.length = 0;
    const list = listFor(d);
    expect(painted[0]).toBe(d.index);
    vi.advanceTimersByTime(1000);
    expect(painted.length).toBe(4);
    expect(list).toBeTruthy();
  });
});

describe('F186: pictures loading one after another', () => {
  it('draw each slide once, not once for every picture', () => {
    const d = deckWith(6);
    const list = listFor(d);
    vi.advanceTimersByTime(1000);
    painted.length = 0;
    for (let k = 0; k < 8; k++) list.refreshAll();
    vi.advanceTimersByTime(1000);
    expect(painted.length).toBe(6);
  });
});
