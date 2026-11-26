// @vitest-environment jsdom
// Document mode (Nate's finding of 2026-11-26): the I-beam shows only over the pages. Off the page,
// on the grey round it, the pointer is the plain arrow: there is no text there to type into, and
// the system I-beam (drawn on Windows by inverting what is under it) vanishes into a mid grey such
// as Dark Gray's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { docMode } from './doc-mode-harness';
import type { DocumentMode } from '../src/ui/doc-mode';
import type { DocText } from '../src/document/document';
import { PAGE_GAP } from '../src/document/doc-layout';
import type { ParaStyle, TextRun } from '../src/model';
import { IBEAM } from '../src/editor/cursors';
import { HIDE_SPACE_CURSOR } from '../src/ui/doc-view';

beforeAll(() => {
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
});

type View = { scroller: HTMLElement; setZoom(z: number): void; toScreen(x: number, y: number): { x: number; y: number }; onPage(x: number, y: number): boolean };
const viewOf = (dm: DocumentMode) => (dm as never as { view: View }).view;

/** The pointer shown after moving to a point on screen (client coordinates). */
function pointerAtScreen(v: View, clientX: number, clientY: number): string {
  v.scroller.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY, bubbles: true }));
  return v.scroller.style.cursor;
}
/** The pointer shown after moving over a point of the document (points, from the first page's top left). */
const pointerAt = (v: View, x: number, y: number): string => { const s = v.toScreen(x, y); return pointerAtScreen(v, s.x, s.y); };

/** A document in a window 1600 × 1200 pixels, at 100%. */
async function setUp(t: Partial<DocText> = {}): Promise<{ dm: DocumentMode; v: View }> {
  const { dm } = await docMode(t);
  const v = viewOf(dm);
  Object.defineProperty(v.scroller, 'clientWidth', { value: 1600, configurable: true });
  Object.defineProperty(v.scroller, 'clientHeight', { value: 1200, configurable: true });
  v.setZoom(1);
  return { dm, v };
}

describe('the pointer in a document', () => {
  it('is the outlined I-beam over the page (margins too, where a click puts the caret) and the arrow off it', async () => {
    const { v } = await setUp();
    // (a new document: US Letter, 612 × 792 pt, the page's top left at 0, 0)
    expect(pointerAt(v, 300, 300)).toBe(IBEAM);
    expect(pointerAt(v, 10, 10)).toBe(IBEAM);
    expect(pointerAt(v, 300, 785)).toBe(IBEAM);
    // left of the page, right of it, above it, below it
    expect(pointerAt(v, -20, 300)).toBe('default');
    expect(pointerAt(v, 640, 300)).toBe('default');
    expect(pointerAt(v, 300, -10)).toBe('default');
    expect(pointerAt(v, 300, 800)).toBe('default');
    // back onto the page: the I-beam again (it doesn't stick either way)
    expect(pointerAt(v, 300, 300)).toBe(IBEAM);
  }, 60000);

  it('finds the page on screen by its own sums, not only through the view\'s (window 1600 px wide, page 612 px, so it starts at 494 px)', async () => {
    const { v } = await setUp();
    Object.defineProperty(v.scroller, 'scrollLeft', { value: 0, configurable: true });
    Object.defineProperty(v.scroller, 'scrollTop', { value: 0, configurable: true });
    // (jsdom: the view's top left is at 0, 0 on screen; the page sits in the middle, 16 px down)
    expect(pointerAtScreen(v, 500, 300)).toBe(IBEAM);
    expect(pointerAtScreen(v, 1100, 300)).toBe(IBEAM);
    expect(pointerAtScreen(v, 480, 300)).toBe('default');
    expect(pointerAtScreen(v, 1115, 300)).toBe('default');
    expect(pointerAtScreen(v, 800, 8)).toBe('default');
  }, 60000);

  it('is the hide-white-space pointer between two pages and the arrow beside them, and follows the zoom', async () => {
    const { v } = await setUp({ runs: [{ text: 'One\nTwo' } as TextRun], paras: [{} as ParaStyle, { pageBreak: true } as ParaStyle] });
    // the second page starts 792 pt plus the gap below the first; in the gap, Word's pointer for
    // hiding the white space (it shows on any background: drawn with an outline)
    expect(pointerAt(v, 300, 792 + PAGE_GAP / 2)).toBe(HIDE_SPACE_CURSOR);
    // beside the gap, the arrow
    expect(pointerAt(v, -20, 792 + PAGE_GAP / 2)).toBe('default');
    expect(pointerAt(v, 300, 792 + PAGE_GAP + 20)).toBe(IBEAM);
    v.setZoom(2);
    expect(pointerAt(v, 300, 300)).toBe(IBEAM);
    expect(pointerAt(v, -5, 300)).toBe('default');
  }, 60000);

  it('is the I-beam right across in Web Layout, which is white right across', async () => {
    const { dm, v } = await setUp();
    (dm as never as { run(c: string): boolean }).run('view-web');
    expect(pointerAtScreen(v, 5, 300)).toBe(IBEAM);
  }, 60000);

  it('is worked out again when the view scrolls under a still mouse', async () => {
    const { v } = await setUp();
    const s = v.toScreen(300, 300);
    expect(pointerAtScreen(v, s.x, s.y)).toBe(IBEAM);
    // the page scrolled away to the left: the grey is under the mouse now
    Object.defineProperty(v.scroller, 'scrollLeft', { value: 1000, configurable: true });
    v.scroller.dispatchEvent(new Event('scroll'));
    expect(v.scroller.style.cursor).toBe('default');
  }, 60000);

  it('starts as the arrow before the pointer has moved (the style sheet no longer gives the whole view an I-beam)', () => {
    const css = readFileSync(join(__dirname, '../src/app.css'), 'utf8');
    const rule = css.match(/\.doc-scroll \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/cursor: default/);
  });
});
