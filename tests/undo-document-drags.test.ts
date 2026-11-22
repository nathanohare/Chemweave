// @vitest-environment jsdom
// Undo audit, Document mode (review round 2, findings 8 and 16): every way of moving or sizing an
// object on the page with the mouse is one step of Undo. Each test drags, checks the document
// changed, undoes and checks it is exactly as before, then redoes and checks it is as after.
import { describe, it, expect, beforeAll } from 'vitest';
import { docMode } from './doc-mode-harness';
import { objectRun, type DocObject, type DocText } from '../src/document/document';
import type { DocumentMode } from '../src/ui/doc-mode';
import type { DocFile } from '../src/document/doc-file';

const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const EMPTY = { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] };
const ETHANE = {
  atoms: [{ id: 1, x: 0, y: 0, element: 'C' }, { id: 2, x: 20, y: 0, element: 'C' }],
  bonds: [{ id: 3, a1: 1, a2: 2, order: 1 }], captions: [], arrows: [], shapes: [],
};

beforeAll(() => {
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
});

/** A document with one object in its text, the object picked (as a click on it does). */
async function withObject(o: DocObject): Promise<{ dm: DocumentMode; f: DocFile }> {
  const { dm, f } = await docMode({ runs: [{ text: 'Some text before the object. ' }, objectRun(1, {}), { text: ' And after it.' }], paras: [{}], objects: { 1: o } as never });
  // the scrolling area has a size (jsdom gives every element none)
  const v = (dm as never as { view: { scroller: HTMLElement; zoom: number; setZoom(z: number): void } }).view;
  Object.defineProperty(v.scroller, 'clientWidth', { value: 1600, configurable: true });
  Object.defineProperty(v.scroller, 'clientHeight', { value: 1200, configurable: true });
  // shown at 100% (a pixel of the screen is a point of the page, near enough)
  v.setZoom(1);
  expect(v.zoom).toBe(1);
  pick(f);
  return { dm, f };
}

function pick(f: DocFile): void {
  f.ed.select(29, 30);
}

const view = (dm: DocumentMode) => (dm as never as { view: { scroller: HTMLElement; toScreen(x: number, y: number): { x: number; y: number } } }).view;
const placed = (dm: DocumentMode, f: DocFile) => f.layout().objects.find((x) => x.id === 1)!;

/** Press at a point of the page (fractions of the object's box), move by (dx, dy) screen pixels in steps, let go. */
function drag(dm: DocumentMode, f: DocFile, fx: number, fy: number, dx: number, dy: number): void {
  const o = placed(dm, f);
  const v = view(dm);
  const at = v.toScreen(o.x + o.w * fx, o.y + o.h * fy);
  const ev = (type: string, x: number, y: number) => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    v.scroller.dispatchEvent(e);
  };
  ev('pointerdown', at.x, at.y);
  for (let k = 1; k <= 5; k++) ev('pointermove', at.x + (dx * k) / 5, at.y + (dy * k) / 5);
  ev('pointerup', at.x + dx, at.y + dy);
}

const json = (t: DocText) => JSON.stringify({ runs: t.runs, paras: t.paras, objects: t.objects });

/** Do, undo (same as before), redo (same as after). */
function checkUndo(dm: DocumentMode, f: DocFile, act: () => void): void {
  const before = json(f.t);
  act();
  const after = json(f.t);
  expect(after, 'the drag changed nothing').not.toBe(before);
  dm.run('undo');
  expect(json(f.t)).toBe(before);
  dm.run('redo');
  expect(json(f.t)).toBe(after);
  dm.run('undo');
  expect(json(f.t)).toBe(before);
}

describe('Document: moving and sizing objects with the mouse is one undo step', () => {
  it('a floating picture: moved', async () => {
    const { dm, f } = await withObject({ kind: 'picture', src: PIC, w: 120, h: 80, float: { wrap: 'square', x: 50, y: 20 } });
    checkUndo(dm, f, () => drag(dm, f, 0.5, 0.5, 40, 30));
  }, 60000);

  it('a floating picture: sized by its corner (as in the SARA SI document)', async () => {
    const { dm, f } = await withObject({ kind: 'picture', src: PIC, w: 120, h: 80, float: { wrap: 'square', x: 50, y: 20 } });
    checkUndo(dm, f, () => drag(dm, f, 1, 1, 40, 30));
  }, 60000);

  it('a picture in line with the text: sized by its corner', async () => {
    const { dm, f } = await withObject({ kind: 'picture', src: PIC, w: 120, h: 80 });
    checkUndo(dm, f, () => drag(dm, f, 1, 1, 40, 30));
  }, 60000);

  it('a structure: sized by its bottom right corner', async () => {
    const { dm, f } = await withObject({ kind: 'drawing', contents: ETHANE as never });
    checkUndo(dm, f, () => drag(dm, f, 1, 1, 40, 30));
  }, 60000);

  it('a floating structure: sized by its top left corner (the corner across stays put)', async () => {
    const { dm, f } = await withObject({ kind: 'drawing', contents: ETHANE as never, float: { wrap: 'square', x: 60, y: 30 } });
    checkUndo(dm, f, () => drag(dm, f, 0, 0, -30, -20));
  }, 60000);

  it('a figure: its area sized by its corner', async () => {
    const { dm, f } = await withObject({ kind: 'drawing', contents: EMPTY as never, frame: { x: 0, y: 0, w: 150, h: 100 }, float: { wrap: 'square', x: 60, y: 30 } });
    checkUndo(dm, f, () => drag(dm, f, 1, 1, 40, 30));
  }, 60000);

  it('a shape: sized by its corner', async () => {
    const { dm, f } = await withObject({ kind: 'textbox', geo: 'rect', runs: [{ text: '' }], w: 100, h: 60, float: { wrap: 'square', x: 60, y: 30 } });
    checkUndo(dm, f, () => drag(dm, f, 1, 1, 40, 30));
  }, 60000);

  it('a shape: moved', async () => {
    const { dm, f } = await withObject({ kind: 'textbox', geo: 'rect', runs: [{ text: '' }], w: 100, h: 60, float: { wrap: 'square', x: 60, y: 30 } });
    checkUndo(dm, f, () => drag(dm, f, 0.5, 0.5, 40, 30));
  }, 60000);

  it('a text box: made wider by its corner', async () => {
    const { dm, f } = await withObject({ kind: 'textbox', runs: [{ text: 'Boxed text' }], w: 120, float: { wrap: 'square', x: 60, y: 30 } });
    checkUndo(dm, f, () => drag(dm, f, 1, 1, 40, 0));
  }, 60000);

  it('a drag that changes the size twice is still one step', async () => {
    const { dm, f } = await withObject({ kind: 'picture', src: PIC, w: 120, h: 80, float: { wrap: 'square', x: 50, y: 20 } });
    const before = json(f.t);
    drag(dm, f, 1, 1, 40, 30);
    pick(f);
    drag(dm, f, 1, 1, -20, -10);
    dm.run('undo');
    dm.run('undo');
    expect(json(f.t)).toBe(before);
  }, 60000);
});
