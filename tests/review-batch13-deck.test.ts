// @vitest-environment jsdom
// Code review batch 13, the deck model: F191 (slides made by Summary Zoom, References and Canvas
// carry the unlocked layout items as their own), F192 (citation numbers follow slides deleted,
// pasted or moved), F193 (Change Slide Size moves the master's artwork and the guides),
// F853 (Undo goes on past a slide step its slide no longer remembers), F855 (Accept keeps a
// slide's number, so custom shows and links still find it).

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Deck, layoutDef } from '../src/deck/deck';
import { MASTER_PAGE } from '../src/deck/master-view';
import { blankRef, type Reference } from '../src/document/references';

function deck(): Deck {
  const d = Deck.blank(new Doc());
  d.attach();
  d.addSlide('title-content');
  d.addSlide('two-content');
  return d;
}
const bar = (color: string, x1 = 0, y = 520) => ({ kind: 'rect', x1, y1: y, x2: x1 + 60, y2: y + 20, color, fill: color, width: 1 }) as never;

/** A deck with a bar on the master, and one on the Blank layout. */
function withItems(): Deck {
  const d = deck();
  d.openMasterView();
  d.go(0);
  d.host.edit('Shape', () => d.host.addShape(bar('#c05428', 900)));
  d.closeMasterView();
  return d;
}

describe('F191: slides added by Summary Zoom, References and Canvas with unlocked layout items', () => {
  it('are marked as having their own copies, so the items are drawn once', () => {
    const d = withItems();
    d.setItemsLocked(false);
    expect(d.master.itemsUnlocked).toBe(true);
    const s = d.insertSlide(1, 'title-only', () => {});
    expect(d.docOf(d.slides.indexOf(s)).shapes.size).toBe(1);
    expect(s.ownItems).toBe(true);
    d.go(0);
    d.addCanvasSlide();
    expect(d.current!.canvas).toBeTruthy();
    expect(d.docOf(d.index).shapes.size).toBe(1);
    expect(d.current!.ownItems).toBe(true);
  });
  it('are not marked when the items are locked', () => {
    const d = withItems();
    const s = d.insertSlide(1, 'title-only', () => {});
    expect(s.ownItems).toBeUndefined();
  });
});

describe('F192: citations after slides come and go', () => {
  const ref = (n: number, doi: string): Reference => ({ ...blankRef('article'), id: `r-${n}`, authors: [`Author${n}, A.`], title: `Paper ${n}`, journal: 'Org. Lett.', year: '2019', volume: '21', pages: `${n}00–${n}05`, doi });
  const cites = (doc: Doc) => [...doc.captions.values()].flatMap((c) => c.runs.filter((r) => r.cite).map((r) => r.text));
  /** References numbered through the presentation: slide 1 shows A, slide 2 shows B and cites it (as 2). */
  function numbered(): Deck {
    const d = deck();
    d.tickRef(1, ref(1, '10.1/a'));
    d.tickRef(2, ref(2, '10.1/b'));
    d.setSlideRefs([1, 2], d.slides[1].refs!, null, { numbering: 'deck' });
    d.setSlideRefs([1], ['r-1']);
    d.setSlideRefs([2], ['r-2']);
    d.go(2);
    d.host.edit('Text', () => d.host.addCaption({ x: 50, y: 200, justify: 'left', runs: [{ text: 'Aryl bromides' }, { text: '*', cite: 'r-2' }] }));
    d.refreshCites();
    return d;
  }
  it('are renumbered when a slide before them is deleted, and again by Undo', () => {
    const d = numbered();
    expect(cites(d.host)).toEqual(['2']);
    d.remove([1]);
    expect(d.slides).toHaveLength(2);
    expect(cites(d.docOf(1))).toEqual(['1']);
    d.undo();
    expect(cites(d.docOf(2))).toEqual(['2']);
    d.redo();
    expect(cites(d.docOf(1))).toEqual(['1']);
  });
  it('are renumbered when a slide with references is pasted before them', () => {
    const d = numbered();
    d.go(0);
    d.duplicate([1]);
    // the copy of slide 1 shows A first, as before: B is still 2
    expect(cites(d.docOf(3))).toEqual(['2']);
    d.go(3);
    d.remove([1, 2]);
    expect(cites(d.docOf(d.slides.length - 1))).toEqual(['1']);
  });
});

describe('F193: Change Slide Size moves what the master draws', () => {
  it('moves the master\'s and layouts\' items and the guides with the slides\' contents, and Undo puts them back', () => {
    const d = withItems();
    d.openMasterView();
    d.go(d.slides.findIndex((s) => s.layout === 'two-content'));
    d.host.edit('Shape', () => d.host.addShape(bar('#1d3557', 100, 40)));
    d.closeMasterView();
    d.settings.view = { guides: { x: [480, 100], y: [270] }, showGuides: true, snapToGrid: true, grid: 7.2 };
    expect(d.size).toEqual({ w: 960, h: 540 });
    // Standard 4:3, centred (no scaling): everything moves 120 points left and 0 down (PowerPoint's 10 by 7.5 inch slide is 720 by 540 points)
    d.setSize({ w: 720, h: 540 }, 'centre');
    expect(d.master.items!.shapes[0].x1).toBe(780);
    expect(layoutDef(d.master, 'two-content').items!.shapes[0].x1).toBe(-20);
    expect(d.settings.view!.guides).toEqual({ x: [360, -20], y: [270] });
    d.undo();
    expect(d.master.items!.shapes[0].x1).toBe(900);
    expect(layoutDef(d.master, 'two-content').items!.shapes[0].x1).toBe(100);
    expect(d.settings.view!.guides).toEqual({ x: [480, 100], y: [270] });
    d.redo();
    expect(d.master.items!.shapes[0].x1).toBe(780);
    expect(MASTER_PAGE).toBeTruthy();
  });
  it('scales them with Ensure Fit', () => {
    const d = withItems();
    d.setSize({ w: 720, h: 540 }, 'fit');
    // k = min(720/960, 540/540) = 0.75; x about the middle: 360 + (900 - 480) * 0.75
    expect(d.master.items!.shapes[0].x1).toBeCloseTo(675, 6);
  });
});

describe('F853: Undo past a slide step the slide has let go', () => {
  it('goes on to the older deck steps', () => {
    const d = deck();
    expect(d.slides).toHaveLength(3);
    d.go(2);
    for (let k = 0; k < 520; k++) d.host.edit('Add', () => d.host.addAtom(10 + k, 10));
    let n = 0;
    while (d.canUndo() && n < 2000) { if (!d.undo()) break; n++; }
    // all the slide's own steps (the last 500) are taken back, then the deck's: the two slides added
    expect(d.canUndo()).toBe(false);
    expect(d.slides).toHaveLength(1);
  });
});

describe('F855: Accept (replaceSlide) keeps the slide\'s number', () => {
  it('so a custom show and links to it still find it', () => {
    const a = deck();
    const b = deck();
    const id = a.slides[1].id;
    expect(a.replaceSlide(1, b.copySlides([1]))).toBe(true);
    expect(a.slides[1].id).toBe(id);
    a.undo();
    expect(a.slides[1].id).toBe(id);
  });
});
