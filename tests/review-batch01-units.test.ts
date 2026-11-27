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
import { fileDropAction, filesTaken, markFilesTaken, mayBePicture, pasteTarget } from '../src/ui/window-drop';
import { StylePanel, type ReactionHooks } from '../src/ui/style-panel';
import { joinLoose, units } from '../src/editor/arrange';
import type { Selection } from '../src/editor/editor';

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
    // (paper changed, ink left as it showed: the ink is the picked palette's, each color on its own)
    expect(readingPaletteToKeep({ paper: '#000000', ink: A.ink, name: '' }, A, B)).toEqual({ name: 'B (changed)', paper: '#000000', ink: B.ink });
    expect(readingPaletteToKeep({ paper: A.paper, ink: '#ffffff', name: 'Mine' }, A, B)).toEqual({ name: 'Mine', paper: B.paper, ink: '#ffffff' });
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

describe('F018, F019: what the window does with a file dropped or a paste', () => {
  it('a drop zone that used the files says so; a drop only cancelled by a part of the page does not count', () => {
    const took = new Event('drop', { cancelable: true }), cancelled = new Event('drop', { cancelable: true });
    took.preventDefault();
    markFilesTaken(took);
    cancelled.preventDefault();
    expect(filesTaken(took)).toBe(true);
    expect(filesTaken(cancelled)).toBe(false);
  });
  it('on the SI Project, files that open in a tab still open; pictures and crystal files are not put on the hidden drawing', () => {
    for (const name of ['scheme.cdxml', 'notes.docx', 'data.xlsx', 'deck.pptx', 'list.sdf']) {
      expect(mayBePicture(name), name).toBe(false);
      expect(fileDropAction(name, false, 'si'), name).toBe('open');
    }
    expect(fileDropAction('trace.png', true, 'si')).toBe('not-in-si');
    expect(fileDropAction('cell.cif', false, 'si')).toBe('not-in-si');
    expect(fileDropAction('project.chemsi', false, 'si')).toBe('open');
  });
  it('elsewhere as before: pictures placed, a crystal file in its window, not a picture in a cell', () => {
    expect(fileDropAction('trace.png', true, 'drawing')).toBe('picture');
    expect(fileDropAction('trace.png', true, 'document')).toBe('doc-picture');
    expect(fileDropAction('trace.png', true, 'sheet')).toBe('no-cell-picture');
    expect(fileDropAction('cell.cif', false, 'drawing')).toBe('crystal');
    expect(fileDropAction('cell.cif', false, 'sheet')).toBe('open');
  });
  it('a paste an SI box took, or any paste while the SI Project shows, does not go to the drawing', () => {
    const none = { typing: false, inDialog: false, taken: false, si: false, sheet: false, document: false };
    expect(pasteTarget(none)).toBe('drawing');
    expect(pasteTarget({ ...none, taken: true })).toBe('none');
    expect(pasteTarget({ ...none, si: true })).toBe('none');
    expect(pasteTarget({ ...none, sheet: true })).toBe('sheet');
    expect(pasteTarget({ ...none, document: true })).toBe('document');
    expect(pasteTarget({ ...none, typing: true })).toBe('none');
  });
});

/** A short chain of n carbons, its left end at x, y. */
function chain(doc: Doc, x: number, y: number, n = 2): number[] {
  const L = doc.style.bondLength;
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(doc.addAtom(x + i * L * 0.87, y + (i % 2 ? -L / 2 : 0), 6).id);
  for (let i = 1; i < n; i++) doc.addBond(ids[i - 1], ids[i], 1);
  return ids;
}
const arrowBase: Omit<Arrow, 'id'> = { tail: { x: 0, y: 0 }, head: { x: 60, y: 0 }, sweep: 0, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5 };
function editorOn(doc: Doc): Editor {
  const scene = document.createElement('canvas'), overlay = document.createElement('canvas'), el = document.createElement('div');
  el.append(scene, overlay);
  document.body.append(el);
  const ed = new Editor(doc, new Renderer(scene, overlay), el);
  ed.paused = true;
  const m = plainMeasure(doc);
  Object.assign(ed, { measure: () => m, fullMeasure: () => m });
  return ed;
}

describe('F332: the Style panel\'s Show Text Guides on a plain reaction arrow and an equilibrium arrow', () => {
  it('unticked hides them on both, ticked shows them on both', () => {
    const doc = new Doc();
    const ids = doc.edit('arrows', () => [doc.addArrow({ ...arrowBase }).id, doc.addArrow({ ...arrowBase, tail: { x: 0, y: 40 }, head: { x: 60, y: 40 }, equilibrium: true }).id]);
    const ed = editorOn(doc);
    const sel = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(ids), shapes: new Set() });
    const section = document.createElement('section'), body = document.createElement('div');
    const p = new StylePanel(section, body, doc, sel, () => p.refresh(true));
    // (the hooks main.ts gives it: only what this check uses does anything)
    p.reaction = new Proxy({ setGuides: (arrowIds: number[], on: boolean | null) => ed.setArrowGuides(arrowIds, on, plainReactionArrow) } as Partial<ReactionHooks>, {
      get: (t, k) => (k in t ? t[k as keyof ReactionHooks] : () => null),
    }) as ReactionHooks;
    p.refresh(true);
    const box = () => [...body.querySelectorAll<HTMLLabelElement>('label.style-row.check')].find((l) => l.textContent === 'Show text guides')!.querySelector('input')!;
    const on = () => ids.map((id) => guidesOn(doc.arrows.get(id)!));
    expect(on()).toEqual([true, false]);
    expect(box().checked).toBe(false);
    box().checked = true;
    box().dispatchEvent(new Event('change'));
    expect(on()).toEqual([true, true]);
    p.refresh(true);
    expect(box().checked).toBe(true);
    box().checked = false;
    box().dispatchEvent(new Event('change'));
    expect(on()).toEqual([false, false]);
  });
});

describe('F020: a pasted reaction wrapped onto rows at a fixed page edge', () => {
  it('keeps each arrow and + sign with the structure before it', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const made = doc.edit('scheme', () => {
      const a = chain(doc, 0, 0, 3), b = chain(doc, 4 * L, 0, 3), c = chain(doc, 10 * L, 0, 3);
      const plus = doc.addCaption({ x: 3 * L, y: 0, runs: [{ text: '+' }], justify: 'left' }).id;
      const arrow = doc.addArrow({ ...arrowBase, tail: { x: 7 * L, y: 0 }, head: { x: 9 * L, y: 0 } }).id;
      return { a, b, c, plus, arrow };
    });
    const ed = editorOn(doc);
    const sel: Selection = { atoms: new Set([...made.a, ...made.b, ...made.c]), bonds: new Set(), captions: new Set([made.plus]), arrows: new Set([made.arrow]), shapes: new Set() };
    const before = units(doc, sel, ed.measure());
    // (each its own piece before: five, so a wrap could put the arrow or + on a row alone)
    expect(before).toHaveLength(5);
    const got = joinLoose(before);
    expect(got).toHaveLength(3);
    const holding = (pred: (u: (typeof got)[number]) => boolean) => got.find(pred)!;
    expect(holding((u) => u.captions.includes(made.plus)).atoms).toEqual(expect.arrayContaining(made.a));
    expect(holding((u) => u.arrows.includes(made.arrow)).atoms).toEqual(expect.arrayContaining(made.b));
    // its box takes in what joined it
    const withArrow = holding((u) => u.arrows.includes(made.arrow));
    expect(withArrow.box.x2).toBeGreaterThanOrEqual(9 * L);
  });
});

describe('F321: Clean Up and Orient Reaction', () => {
  it('turns and tidies in one undo step', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const made = doc.edit('scheme', () => {
      const a = chain(doc, 0, 0, 3), b = chain(doc, 5 * L, 6, 4);
      doc.addArrow({ ...arrowBase, tail: { x: 2.4 * L, y: 4 }, head: { x: 4.2 * L, y: 4 } });
      return { a, b };
    });
    const ed = editorOn(doc);
    const where = () => JSON.stringify([...doc.atoms.values()].map((x) => [x.id, +x.x.toFixed(3), +x.y.toFixed(3)]));
    const start = where();
    let cx = 0, cy = 0;
    for (const id of made.b) { const p = doc.atoms.get(id)!; cx += p.x / made.b.length; cy += p.y / made.b.length; }
    const turn = [{ atoms: new Set(made.b), f: (p: { x: number; y: number }) => ({ x: cx - (p.y - cy), y: cy + (p.x - cx) }), mirror: false }];
    const steps = doc.canUndo() ? 1 : 0;
    ed.cleanUpAndOrient(turn);
    expect(where()).not.toBe(start);
    expect(doc.undoLabel).toBe('Clean Up and Orient Reaction');
    doc.undo();
    expect(where()).toBe(start);
    expect(doc.undoLabel).toBe(steps ? 'scheme' : '');
  });
});
