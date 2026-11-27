// @vitest-environment jsdom
// Code review batch 13, Review > Compare: F183 (Accept All is one Undo), F184 (accepting or
// rejecting one change does not draw every picture again), F833 (closing with the x or Esc lets go
// of the other version), F834 (pictures loading do not each redraw every picture), F835 (Go to it
// on a slide that goes in first), F190 (isomers, wedges and isotopes are different structures),
// F852 (a picture made bigger is a change).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const painted = vi.hoisted(() => ({ n: 0 }));
const watchers = vi.hoisted(() => ({ list: [] as (() => void)[] }));
vi.mock('../src/deck/slide-view', async (orig) => ({
  ...(await orig<typeof import('../src/deck/slide-view')>()),
  paintSlide: () => { painted.n++; },
}));
vi.mock('../src/render/images', async (orig) => ({
  ...(await orig<typeof import('../src/render/images')>()),
  onImageReady: (fn: () => void) => { watchers.list.push(fn); return () => { const i = watchers.list.indexOf(fn); if (i >= 0) watchers.list.splice(i, 1); }; },
}));

import { Doc } from '../src/model';
import type { BondDisplay } from '../src/model';
import { Deck } from '../src/deck/deck';
import { slideDifferences, type SlideView } from '../src/deck/compare';
import { SlideComparePane, viewsOf } from '../src/ui/slide-compare';

function deckOf(titles: string[], attach = false): Deck {
  const d = Deck.blank(new Doc());
  if (attach) d.attach();
  for (let i = 1; i < titles.length; i++) d.addSlide('title-content');
  d.editSlides('Fill', titles.map((_, i) => i), (doc, i) => {
    for (const c of [...doc.captions.values()]) if (c.ph === 'title') doc.updateCaption(c.id, { runs: [{ text: titles[i] }] });
  });
  return d;
}
const titleOf = (d: Deck) => viewsOf(d).map((v) => v.contents.captions.find((c) => c.ph === 'title')?.runs.map((r) => r.text).join(''));

beforeEach(() => { painted.n = 0; watchers.list.length = 0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('F183: Accept All', () => {
  it('is taken back by one Undo, and done again by one Redo', () => {
    const a = deckOf(['Intro', 'Dropped', 'Thanks'], true);
    const b = deckOf(['Intro', 'Scope', 'More', 'Thanks', 'Backup']);
    const pane = new SlideComparePane({ deck: () => a, flash: () => {}, changed: () => {} });
    pane.start(a, b, 'b.pptx');
    (document.querySelector('.sc-bar button') as HTMLButtonElement).click();
    expect(titleOf(a)).toEqual(titleOf(b));
    expect(a.undoLabel).toBe('Accept All Changes');
    a.undo();
    expect(titleOf(a)).toEqual(['Intro', 'Dropped', 'Thanks']);
    a.redo();
    expect(titleOf(a)).toEqual(titleOf(b));
    pane.close();
  });
});

describe('F184: one change decided', () => {
  it('draws only the pictures of the rows that changed', () => {
    const a = deckOf(['A', 'B', 'C', 'D', 'E', 'F'], true);
    const b = deckOf(['A', 'B', 'C', 'D', 'E', 'F']);
    b.editSlides('Edit', [1, 2, 3, 4], (doc) => { doc.addAtom(100, 100); });
    const pane = new SlideComparePane({ deck: () => a, flash: () => {}, changed: () => {} });
    expect(pane.start(a, b, 'b.pptx')).toBe(4);
    vi.advanceTimersByTime(2000);
    expect(painted.n).toBe(8);
    painted.n = 0;
    (document.querySelector('.sc-act button') as HTMLButtonElement).click(); // Reject the first
    vi.advanceTimersByTime(2000);
    // its row now shows only the other version's picture; the others are not drawn again
    expect(painted.n).toBe(1);
    pane.close();
  });
});

describe('F184: a slide of this deck edited while the pane is open', () => {
  it('has its "This deck" picture drawn again, and no other', () => {
    const a = deckOf(['A', 'B', 'C'], true);
    const b = deckOf(['A', 'B2', 'C2']);
    const pane = new SlideComparePane({ deck: () => a, flash: () => {}, changed: () => {} });
    pane.start(a, b, 'b.pptx');
    vi.advanceTimersByTime(2000);
    painted.n = 0;
    pane.deckChanged(a);
    vi.advanceTimersByTime(2000);
    expect(painted.n).toBe(0);
    a.editSlides('Edit', [1], (doc) => { doc.addAtom(100, 100); });
    pane.deckChanged(a);
    vi.advanceTimersByTime(2000);
    expect(painted.n).toBe(1);
    pane.close();
  });
});

describe('F833 and F834', () => {
  it('closing with the x lets go of the image watcher and the other deck', () => {
    const a = deckOf(['A', 'B'], true);
    const b = deckOf(['A', 'C']);
    const pane = new SlideComparePane({ deck: () => a, flash: () => {}, changed: () => {} });
    pane.start(a, b, 'b.pptx');
    expect(watchers.list.length).toBe(1);
    (document.querySelector('.sc-pane .fb-close') as HTMLButtonElement).click();
    expect(watchers.list.length).toBe(0);
    expect(document.querySelectorAll('.sc-pane canvas').length).toBe(0);
    expect(pane.open).toBe(false);
  });

  it('closing with Esc does the same', () => {
    const a = deckOf(['A', 'B'], true);
    const b = deckOf(['A', 'C']);
    const pane = new SlideComparePane({ deck: () => a, flash: () => {}, changed: () => {} });
    pane.start(a, b, 'b.pptx');
    document.querySelector('.sc-pane')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(watchers.list.length).toBe(0);
  });

  it('pictures loading one after another are drawn again once', () => {
    const a = deckOf(['A', 'B', 'C'], true);
    const b = deckOf(['A', 'B2', 'C2']);
    const pane = new SlideComparePane({ deck: () => a, flash: () => {}, changed: () => {} });
    pane.start(a, b, 'b.pptx');
    vi.advanceTimersByTime(2000);
    const first = painted.n;
    painted.n = 0;
    for (let k = 0; k < 10; k++) { for (const f of [...watchers.list]) f(); vi.advanceTimersByTime(20); }
    vi.advanceTimersByTime(2000);
    expect(first).toBe(4);
    expect(painted.n).toBe(4);
    pane.close();
  });
});

describe('F835: Go to it on a slide that goes in first', () => {
  it('goes to the first slide', () => {
    const a = deckOf(['B', 'C'], true);
    const b = deckOf(['A', 'B', 'C']);
    a.go(1);
    const pane = new SlideComparePane({ deck: () => a, flash: () => {}, changed: () => {} });
    pane.start(a, b, 'b.pptx');
    (document.querySelector('.sc-head') as HTMLButtonElement).click();
    expect(a.index).toBe(0);
    pane.close();
  });
});

/** A ring of six carbons with a methyl on each of the ring atoms listed (xylenes: 1,4 is para, 1,2 is ortho). */
function ring(subst: number[], opts: { wedge?: BondDisplay; isotope?: number } = {}): SlideView {
  const d = new Doc();
  d.edit('draw', () => {
  const ids: number[] = [];
  for (let k = 0; k < 6; k++) ids.push(d.addAtom(300 + 40 * Math.cos((k * Math.PI) / 3), 300 + 40 * Math.sin((k * Math.PI) / 3)).id);
  for (let k = 0; k < 6; k++) d.addBond(ids[k], ids[(k + 1) % 6], k % 2 ? 1 : 2);
  for (const k of subst) {
    const m = d.addAtom(300 + 80 * Math.cos((k * Math.PI) / 3), 300 + 80 * Math.sin((k * Math.PI) / 3), 6, opts.isotope && k === subst[0] ? { isotope: opts.isotope } : {});
    d.addBond(ids[k], m.id, 1, opts.wedge && k === subst[0] ? opts.wedge : 'solid');
  }
  });
  return { layout: 'blank', contents: d.contents(), notes: '' };
}

describe('F190: structures that differ only in how the atoms are joined', () => {
  it('para-xylene and ortho-xylene (same atoms, same bond orders) are different', () => {
    expect(slideDifferences(ring([0, 3]), ring([0, 3]))).toEqual([]);
    expect(slideDifferences(ring([0, 3]), ring([0, 1]))).toContain('Structure changed');
  });
  it('a wedge and a hash are different', () => {
    expect(slideDifferences(ring([0], { wedge: 'wedge' }), ring([0], { wedge: 'hash' }))).toContain('Structure changed');
    expect(slideDifferences(ring([0], { wedge: 'wedge' }), ring([0], { wedge: 'wedge' }))).toEqual([]);
  });
  it('an isotope is a difference', () => {
    expect(slideDifferences(ring([0]), ring([0], { isotope: 13 }))).toContain('Structure changed');
  });
});

describe('F190: isomers far from their ends, and cis and trans', () => {
  const view = (draw: (d: Doc) => void): SlideView => {
    const d = new Doc();
    d.edit('draw', () => draw(d));
    return { layout: 'blank', contents: d.contents(), notes: '' };
  };
  /** An icosane chain (20 carbons, zigzag) with a methyl on carbon `at` (counting from 0): 8-methyl is 7, 9-methyl is 8. */
  const methylIcosane = (at: number) => view((d) => {
    const ids: number[] = [];
    for (let k = 0; k < 20; k++) ids.push(d.addAtom(50 + 20 * k, 300 + (k % 2 ? 10 : 0)).id);
    for (let k = 0; k < 19; k++) d.addBond(ids[k], ids[k + 1]);
    const m = d.addAtom(50 + 20 * at, at % 2 ? 330 : 280);
    d.addBond(ids[at], m.id);
  });
  /** 2-butene: the last carbon on the same side of the double bond as the first (cis) or the other (trans). */
  const butene = (cis: boolean, flip = false) => view((d) => {
    const y = (v: number) => (flip ? 240 - v : v);
    const c = [d.addAtom(100, y(100)), d.addAtom(130, y(120)), d.addAtom(160, y(120)), d.addAtom(190, y(cis ? 100 : 140))];
    d.addBond(c[0].id, c[1].id);
    d.addBond(c[1].id, c[2].id, 2);
    d.addBond(c[2].id, c[3].id);
  });
  it('8-methylicosane and 9-methylicosane differ, though no atom sees an end of the chain within six bonds', () => {
    expect(slideDifferences(methylIcosane(7), methylIcosane(7))).toEqual([]);
    expect(slideDifferences(methylIcosane(7), methylIcosane(8))).toContain('Structure changed');
  });
  it('cis- and trans-2-butene differ, and each is the same as itself drawn the other way up', () => {
    expect(slideDifferences(butene(true), butene(false))).toContain('Structure changed');
    expect(slideDifferences(butene(true), butene(true))).toEqual([]);
    expect(slideDifferences(butene(true), butene(true, true))).not.toContain('Structure changed');
    expect(slideDifferences(butene(false), butene(false, true))).not.toContain('Structure changed');
  });
});

describe('F852: a picture made bigger', () => {
  const pic = (half: number): SlideView => {
    const d = new Doc();
    d.edit('pic', () => d.addShape({ kind: 'picture', x1: 200 - half, y1: 200 - half, x2: 200 + half, y2: 200 + half, src: 'data:image/png;base64,iVBORw0KGgo=' }));
    return { layout: 'blank', contents: d.contents(), notes: '' };
  };
  it('about its centre is reported as resized', () => {
    expect(slideDifferences(pic(50), pic(50))).toEqual([]);
    expect(slideDifferences(pic(50), pic(80))).toContain('Resized: 1 thing');
  });
});
