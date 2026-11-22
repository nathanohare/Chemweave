// @vitest-environment jsdom
//
// Text boxes in Slides and Design (review round 2, #12 and #13): PowerPoint's round handles on
// the corners and edges resize the box, the border shows the four-way arrow and moves the box,
// and typing shows only the box's own (dashed) frame, with no smaller box of the editor's own.

import { describe, it, expect, afterEach } from 'vitest';
import { Doc } from '../src/model';
import { Renderer } from '../src/render/renderer';
import { Editor } from '../src/editor/editor';
import { turnedHandleCursor } from '../src/editor/cursors';
import { turnAbout, turnedCorners } from '../src/geom';

window.requestAnimationFrame = () => 0;
// a stand-in for measuring text (jsdom has no canvas): every letter 0.6 em wide
const ctx = new Proxy({ font: '', measureText(t: string) { return { width: [...t].length * 60 }; } } as Record<string, unknown>, {
  get: (o, k) => (k in o ? o[k as string] : () => undefined),
  set: (o, k, v) => { o[k as string] = v; return true; },
});
HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;

let last: Editor | null = null;
afterEach(() => { if (last) last.paused = true; });

function setup() {
  document.body.innerHTML = '';
  const scene = document.createElement('canvas'), overlay = document.createElement('canvas');
  const host = document.createElement('div');
  host.append(scene, overlay);
  document.body.append(host);
  const doc = new Doc();
  const r = new Renderer(scene, overlay);
  overlay.setPointerCapture = () => {};
  const ed = new Editor(doc, r, host);
  last = ed;
  ed.textFirst = true;
  ed.setTool('select');
  let id = 0;
  doc.edit('Text', () => { id = doc.addCaption({ x: 100, y: 100, runs: [{ text: 'Route to the enoate' }], justify: 'left', wrap: 300, fit: 'fixed', boxH: 80 }).id; });
  return { doc, ed, r, overlay, id };
}

const at = (r: Renderer, p: { x: number; y: number }) => r.toScreen(p);
function press(overlay: HTMLCanvasElement, r: Renderer, from: { x: number; y: number }, by: { x: number; y: number } | null) {
  const a = at(r, from);
  overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: a.x, clientY: a.y, bubbles: true }));
  overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: a.x, clientY: a.y, button: 0, buttons: 1, bubbles: true }));
  const k = r.view.scale;
  const end = by ? { x: a.x + by.x * k, y: a.y + by.y * k } : a;
  if (by) for (let i = 1; i <= 4; i++) overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: a.x + (end.x - a.x) * i / 4, clientY: a.y + (end.y - a.y) * i / 4, buttons: 1, bubbles: true }));
  overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: end.x, clientY: end.y, button: 0, bubbles: true }));
}

describe('text box handles in Slides and Design', () => {
  it('a selected text box has eight round handles on its frame', () => {
    const { ed, r, doc, id } = setup();
    ed.sel.captions = new Set([id]);
    const f = r.captionFrame(doc.captions.get(id)!);
    const hs = ed.handles();
    expect(hs.map((h) => h.which).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    expect(hs.every((h) => h.kind === 'caption')).toBe(true);
    expect(hs.find((h) => h.which === 'se')!.at).toEqual({ x: f.x2, y: f.y2 });
  });

  it('not in a drawing, with another tool, or with something else selected too', () => {
    const { ed, doc, id } = setup();
    ed.sel.captions = new Set([id]);
    ed.textFirst = false;
    expect(ed.handles()).toEqual([]);
    ed.textFirst = true;
    ed.setTool('bond-single');
    expect(ed.textBoxes()).toEqual([]);
    ed.setTool('select');
    let atom = 0;
    doc.edit('Atom', () => { atom = doc.addAtom(500, 500).id; });
    ed.sel.atoms = new Set([atom]);
    expect(ed.textBoxes()).toEqual([]);
  });

  it('the right handle sets the width, the bottom one the height, each one undo step', () => {
    const { ed, r, doc, overlay, id } = setup();
    ed.sel.captions = new Set([id]);
    const f = r.captionFrame(doc.captions.get(id)!);
    const undos = doc.undoStack.length;
    press(overlay, r, { x: f.x2, y: (f.y1 + f.y2) / 2 }, { x: -100, y: 0 });
    let c = doc.captions.get(id)!;
    expect(c.wrap).toBeCloseTo(200, 3);
    expect(c.x).toBeCloseTo(100, 6);
    expect(doc.undoStack.length).toBe(undos + 1);
    const g = r.captionFrame(c);
    press(overlay, r, { x: (g.x1 + g.x2) / 2, y: g.y2 }, { x: 0, y: 40 });
    c = doc.captions.get(id)!;
    expect(c.boxH).toBeCloseTo(120, 3);
    expect(c.y).toBeCloseTo(100, 6);
    expect(doc.undoStack.length).toBe(undos + 2);
    // still selected, not being typed in
    expect(ed.captionOpen()).toBe(false);
    expect([...ed.sel.captions]).toEqual([id]);
  });

  it('the top-left handle moves the top and left edges, keeping the other two', () => {
    const { ed, r, doc, overlay, id } = setup();
    ed.sel.captions = new Set([id]);
    const f = r.captionFrame(doc.captions.get(id)!);
    press(overlay, r, { x: f.x1, y: f.y1 }, { x: 50, y: 20 });
    const g = r.captionFrame(doc.captions.get(id)!);
    expect(g.x1).toBeCloseTo(f.x1 + 50, 3);
    expect(g.y1).toBeCloseTo(f.y1 + 20, 3);
    expect(g.x2).toBeCloseTo(f.x2, 3);
    expect(g.y2).toBeCloseTo(f.y2, 3);
  });

  it('a text box that grew with its text keeps the height it is given', () => {
    const { ed, r, doc, overlay } = setup();
    let id = 0;
    doc.edit('Text', () => { id = doc.addCaption({ x: 100, y: 400, runs: [{ text: 'Grows' }], justify: 'left', wrap: 200 }).id; });
    ed.sel.captions = new Set([id]);
    const f = r.captionFrame(doc.captions.get(id)!);
    press(overlay, r, { x: (f.x1 + f.x2) / 2, y: f.y2 }, { x: 0, y: 50 });
    const c = doc.captions.get(id)!;
    expect(c.fit).toBe('fixed');
    expect(c.boxH).toBeCloseTo(f.y2 - f.y1 + 50, 3);
  });

  it('a drag on the border moves the box; a click there selects it without typing', () => {
    const { ed, r, doc, overlay, id } = setup();
    const f = r.captionFrame(doc.captions.get(id)!);
    const top = { x: (f.x1 + f.x2) / 2 + 40, y: f.y1 };
    press(overlay, r, top, null);
    expect(ed.captionOpen()).toBe(false);
    expect([...ed.sel.captions]).toEqual([id]);
    press(overlay, r, top, { x: 30, y: 25 });
    const c = doc.captions.get(id)!;
    expect(c.x).toBeCloseTo(130, 3);
    expect(c.y).toBeCloseTo(125, 3);
    expect(c.wrap).toBe(300);
  });

  it('a click inside the text still types there, with the box\'s own frame and handles', () => {
    const { ed, r, doc, overlay, id } = setup();
    const c = doc.captions.get(id)!;
    press(overlay, r, { x: c.x + 20, y: c.y - 5 }, null);
    expect(ed.captionOpen()).toBe(true);
    expect(ed.textBoxes()).toEqual([id]);
    expect(ed.handles().length).toBe(8);
    // a press on a handle while typing ends the typing and resizes the box
    const f = ed.textBoxFrame(id)!;
    press(overlay, r, { x: f.x2, y: (f.y1 + f.y2) / 2 }, { x: 60, y: 0 });
    expect(ed.captionOpen()).toBe(false);
    expect(doc.captions.get(id)!.wrap).toBeCloseTo(360, 3);
  });
});

describe('turned text boxes', () => {
  function turned(rot: number) {
    const t = setup();
    t.doc.edit('Turn', () => t.doc.updateCaption(t.id, { rot }));
    t.ed.sel.captions = new Set([t.id]);
    return t;
  }

  it('have the same handles, turned with the box, and a rotate handle above its turned top', () => {
    const { ed, r, doc, id } = turned(30);
    const c = doc.captions.get(id)!, f = r.captionFrame(c);
    const corners = turnedCorners(f, c, 30);
    const hs = ed.handles();
    expect(hs.length).toBe(8);
    const nw = hs.find((h) => h.which === 'nw')!.at, se = hs.find((h) => h.which === 'se')!.at;
    expect(nw.x).toBeCloseTo(corners[0].x, 6); expect(nw.y).toBeCloseTo(corners[0].y, 6);
    expect(se.x).toBeCloseTo(corners[2].x, 6); expect(se.y).toBeCloseTo(corners[2].y, 6);
    const rh = ed.rotateHandle()!;
    const want = turnAbout({ x: (f.x1 + f.x2) / 2, y: f.y1 - 24 / r.view.scale }, c, 30);
    expect(rh.x).toBeCloseTo(want.x, 6); expect(rh.y).toBeCloseTo(want.y, 6);
  });

  it('size along their own sides, the sides not dragged staying put', () => {
    const { ed, r, doc, overlay, id } = turned(90);
    const c0 = doc.captions.get(id)!, f0 = r.captionFrame(c0);
    const before = turnedCorners(f0, c0, 90);
    // turned a quarter clockwise, the right-hand side faces down: dragging its handle down widens the box
    const e = ed.handles().find((h) => h.which === 'e')!.at;
    press(overlay, r, e, { x: 0, y: 100 });
    let c = doc.captions.get(id)!;
    expect(c.wrap).toBeCloseTo(400, 3);
    let after = turnedCorners(r.captionFrame(c), c, 90);
    // the left side (top-left and bottom-left corners) hasn't moved
    expect(after[0].x).toBeCloseTo(before[0].x, 3); expect(after[0].y).toBeCloseTo(before[0].y, 3);
    expect(after[3].x).toBeCloseTo(before[3].x, 3); expect(after[3].y).toBeCloseTo(before[3].y, 3);
    // the top-left handle: the bottom-right corner stays
    const nw = ed.handles().find((h) => h.which === 'nw')!.at;
    const keep = after[2];
    press(overlay, r, nw, { x: -20, y: 30 });
    c = doc.captions.get(id)!;
    after = turnedCorners(r.captionFrame(c), c, 90);
    expect(after[2].x).toBeCloseTo(keep.x, 3); expect(after[2].y).toBeCloseTo(keep.y, 3);
    expect(c.rot).toBe(90);
  });

  it('show resize pointers turned with the box, and move by the border', () => {
    expect(turnedHandleCursor('e', 0)).toBe('ew-resize');
    expect(turnedHandleCursor('e', 90)).toBe('ns-resize');
    expect(turnedHandleCursor('n', 45)).toBe('nesw-resize');
    expect(turnedHandleCursor('ne', -45)).toBe('ns-resize');
    const { r, doc, overlay, id } = turned(90);
    const c = doc.captions.get(id)!, f = r.captionFrame(c);
    // the middle of the box's top side, turned
    const top = turnAbout({ x: (f.x1 + f.x2) / 2 + 40, y: f.y1 }, c, 90);
    press(overlay, r, top, { x: 30, y: 25 });
    const m = doc.captions.get(id)!;
    expect(m.x).toBeCloseTo(c.x + 30, 3);
    expect(m.y).toBeCloseTo(c.y + 25, 3);
  });
});
