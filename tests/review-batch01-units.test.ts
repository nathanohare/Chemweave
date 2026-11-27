// @vitest-environment jsdom
// Code review 2026-11-26, batch 01: the fixes that live outside main.ts, run for real (the
// checks that main.ts uses them are in review-batch01-shell.test.ts). Each fails on the code the
// review found: the helpers here are new, and Deck, the Editor and Outline View gained what is
// tested.
import { describe, expect, it } from 'vitest';
import { Doc, type Arrow } from '../src/model';
import { Deck } from '../src/deck/deck';
import { Editor } from '../src/editor/editor';
import { Renderer } from '../src/render/renderer';
import { plainMeasure } from '../src/chem/reaction';
import { guidesOn, plainReactionArrow } from '../src/chem/arrow-text';
import { scaleFactor } from '../src/editor/scale-factor';
import { pagePictureDpi, PAGE_PICTURE_SIDE } from '../src/feedback';
import { renamedFavorite, type FormatFavorite } from '../src/favorites';
import { readingPaletteToKeep, type DarkPalette } from '../src/dark-page';
import { freeBatchName } from '../src/io/batch-convert';
import { OutlineView } from '../src/ui/outline-view';

window.requestAnimationFrame = () => 0;

describe('F317: the Scale window', () => {
  it('a cleared bond length box leaves the Size box in charge', () => {
    // 150 % typed, the bond length box (it showed 14.4) emptied: scaled to 1.5×, not "Type a size above zero"
    expect(scaleFactor('150', '', '14.4', 14.4)).toBe(1.5);
    expect(scaleFactor('150', '   ', '14.4', 14.4)).toBe(1.5);
  });
  it('a bond length changed to a length above zero wins; left as shown, the Size box does', () => {
    expect(scaleFactor('100', '28.8', '14.4', 14.4)).toBe(2);
    expect(scaleFactor('50', '14.4', '14.4', 14.4)).toBe(0.5);
    expect(scaleFactor('50', undefined, '', null)).toBe(0.5);
  });
  it('a bond length typed that is not above zero is not a size', () => {
    expect(scaleFactor('150', '0', '14.4', 14.4)).toBeNaN();
    expect(scaleFactor('150', '-3', '14.4', 14.4)).toBeNaN();
  });
});

describe('F334: the Feedback page picture', () => {
  it('is never more than 2000 px a side, however big the drawing', () => {
    // 3500 pt wide: at the old 48 dpi floor this was 3500 × 48 / 72 ≈ 2333 px
    for (const side of [3000, 3500, 10000, 100000]) expect(Math.ceil(side * pagePictureDpi(side) / 72)).toBeLessThanOrEqual(PAGE_PICTURE_SIDE);
  });
  it('a small drawing is made at 144 dpi', () => {
    expect(pagePictureDpi(500)).toBe(144);
    expect(pagePictureDpi(0)).toBe(96);
  });
});

describe('F340: renaming a Format Favorite', () => {
  const list: FormatFavorite[] = [{ name: 'Box', look: {} }, { name: 'Key', look: {} }];
  it('to a name another favorite has is refused, and both are kept', () => {
    const got = renamedFavorite(list, 'Key', 'Box');
    expect(typeof got).toBe('string');
    expect(got).toMatch(/already a favorite named “Box”/);
  });
  it('to a new name renames it in its place', () => {
    expect(renamedFavorite(list, 'Key', 'Arrow')).toEqual([{ name: 'Box', look: {} }, { name: 'Arrow', look: {} }]);
  });
});

describe('F339: Reading Mode, a palette picked and named', () => {
  const A: DarkPalette = { name: 'A', paper: '#111111', ink: '#eeeeee' };
  const B: DarkPalette = { name: 'B', paper: '#202830', ink: '#d0e0f0' };
  it('is a copy of the palette picked, not of the one that was showing', () => {
    // the window opened on A (its colors in the boxes), B picked, the colors left alone, named "Mine"
    expect(readingPaletteToKeep({ paper: A.paper, ink: A.ink, name: 'Mine' }, A, B)).toEqual({ name: 'Mine', paper: B.paper, ink: B.ink });
  });
  it('colors changed are kept; nothing changed and no name is the palette as it is', () => {
    expect(readingPaletteToKeep({ paper: '#000000', ink: A.ink, name: '' }, A, B)).toEqual({ name: 'B (changed)', paper: '#000000', ink: A.ink });
    expect(readingPaletteToKeep({ paper: A.paper, ink: A.ink, name: '' }, A, B)).toBeNull();
  });
});

describe('F026: Batch Convert into a folder', () => {
  it('gives a converted file a new name rather than writing over one already in the folder', async () => {
    const there = new Set(['a.cdxml', 'b.cdxml', 'b (2).cdxml']);
    const used = new Set<string>();
    const taken = async (n: string) => there.has(n);
    expect(await freeBatchName('a', 'cdxml', used, taken)).toBe('a (2).cdxml');
    expect(await freeBatchName('b', 'cdxml', used, taken)).toBe('b (3).cdxml');
    expect(await freeBatchName('c', 'cdxml', used, taken)).toBe('c.cdxml');
    // and within the batch as before
    expect(await freeBatchName('c', 'cdxml', used, taken)).toBe('c (2).cdxml');
  });
});

describe('F326: narration and timings kept from one rehearsal', () => {
  it('undo once takes back both', () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    const was = d.historyLength;
    d.editSlides('Record narration', [0], (sd) => { sd.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 } as Parameters<Doc['addShape']>[0]); });
    d.setTimings(new Map([[0, 12]]), 'Record slide show timings');
    d.joinSince(was, 'Record slide show timings');
    expect(d.historyLength).toBe(was + 1);
    expect(d.undoLabel).toBe('Record slide show timings');
    expect(d.docOf(0).shapes.size).toBe(1);
    expect(d.slides[0].transition?.advanceAfter).toBe(12);
    d.undo();
    expect(d.docOf(0).shapes.size).toBe(0);
    expect(d.slides[0].transition?.advanceAfter).toBeUndefined();
    d.redo();
    expect(d.docOf(0).shapes.size).toBe(1);
    expect(d.slides[0].transition?.advanceAfter).toBe(12);
  });
});

describe('F332: Text Guides on a plain reaction arrow and an equilibrium arrow together', () => {
  const base: Omit<Arrow, 'id'> = { tail: { x: 0, y: 0 }, head: { x: 60, y: 0 }, sweep: 0, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5 };
  it('turned off hides them on both, and turned on shows them on both', () => {
    const doc = new Doc();
    const [plain, eq] = doc.edit('arrows', () => [doc.addArrow({ ...base }).id, doc.addArrow({ ...base, tail: { x: 0, y: 40 }, head: { x: 60, y: 40 }, equilibrium: true }).id]);
    const scene = document.createElement('canvas'), overlay = document.createElement('canvas'), el = document.createElement('div');
    el.append(scene, overlay);
    document.body.append(el);
    const ed = new Editor(doc, new Renderer(scene, overlay), el);
    ed.paused = true;
    const m = plainMeasure(doc);
    Object.assign(ed, { measure: () => m, fullMeasure: () => m });
    const on = () => [plain, eq].map((id) => guidesOn(doc.arrows.get(id)!));
    expect(plainReactionArrow(doc.arrows.get(plain)!)).toBe(true);
    expect(plainReactionArrow(doc.arrows.get(eq)!)).toBe(false);
    ed.setArrowGuides([plain, eq], true, plainReactionArrow);
    expect(on()).toEqual([true, true]);
    // (the plain arrow shows them by default: nothing stored for it)
    expect(doc.arrows.get(plain)!.textLook?.guides).toBeUndefined();
    ed.setArrowGuides([plain, eq], false, plainReactionArrow);
    expect(on()).toEqual([false, false]);
    expect(doc.undoLabel).toBe('Hide Text Guides');
  });
});

describe('F029: Outline View after a change on one slide', () => {
  it('makes only that slide\'s row again, and everything when the slides change', () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.setLayout('title-content');
    d.duplicate([0]);
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new OutlineView(parent, { deck: () => d, go: () => undefined, focusSlide: () => undefined });
    view.show(true);
    const rows = () => [...parent.querySelectorAll<HTMLElement>('.ol-slide')];
    expect(rows()).toHaveLength(2);
    const [first, second] = rows();
    const doc = d.docOf(0);
    const title = [...doc.captions.values()].find((c) => c.ph === 'title')!;
    doc.edit('type', () => doc.updateCaption(title.id, { runs: [{ text: 'Aldol' }] }));
    view.refresh(0);
    const now = rows();
    expect(now[0]).not.toBe(first);
    expect(now[0].querySelector('.ol-title')!.textContent).toBe('Aldol');
    expect(now[1]).toBe(second);
    // a slide added: the whole outline again
    d.duplicate([1]);
    view.refresh(0);
    expect(rows()).toHaveLength(3);
    expect(rows()[1]).not.toBe(second);
  });
});
