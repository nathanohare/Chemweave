// @vitest-environment jsdom
//
// Undo audit (review round 2, finding 16): moving or resizing a placeholder of a layout can be
// undone. Edit Layouts is now the Slide Master view (#672), whose pages are edited with the
// slide editor's own steps of Undo, so a move there is one Ctrl+Z, and closing the view (which
// keeps the moved boxes in the layout) is one Ctrl+Z more.

import { describe, it, expect } from 'vitest';
import { Doc, type Caption } from '../src/model';
import { Deck, layoutDef } from '../src/deck/deck';

function deck(): Deck {
  const d = Deck.blank(new Doc());
  d.attach();
  d.addSlide('title-content');
  return d;
}
const ph = (doc: Doc, kind: Caption['ph']) => [...doc.captions.values()].find((c) => c.ph === kind)!;
const where = (c: Caption) => ({ x: c.x, y: c.y, wrap: c.wrap, boxH: c.boxH });
const boxes = (d: Deck) => JSON.stringify(layoutDef(d.master, 'title-content').boxes);

describe('Slide Master view: placeholder moves undo', () => {
  for (const [what, patch] of [
    ['moving', (c: Caption) => ({ x: c.x + 60, y: c.y + 40 })],
    ['resizing', (c: Caption) => ({ wrap: (c.wrap ?? 100) - 120, boxH: (c.boxH ?? 100) - 50 })],
  ] as const) {
    it(`${what} a layout's body placeholder: one undo in the view, and one for closing it`, () => {
      const d = deck();
      const was = boxes(d);
      d.openMasterView();
      d.go(d.slides.findIndex((s) => s.layout === 'title-content'));
      const c = ph(d.host, 'body');
      const start = where(c);
      d.host.edit(what === 'moving' ? 'Move' : 'Resize', () => d.host.updateCaption(c.id, patch(c)));
      const moved = where(ph(d.host, 'body'));
      expect(moved).not.toEqual(start);
      d.undo();
      expect(where(ph(d.host, 'body'))).toEqual(start);
      d.redo();
      expect(where(ph(d.host, 'body'))).toEqual(moved);
      d.closeMasterView();
      expect(boxes(d)).not.toBe(was);
      d.undo();
      expect(boxes(d)).toBe(was);
    });
  }
});
