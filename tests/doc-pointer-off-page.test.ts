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

beforeAll(() => {
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
});

type View = { scroller: HTMLElement; setZoom(z: number): void; toScreen(x: number, y: number): { x: number; y: number }; onPage(x: number, y: number): boolean };
const viewOf = (dm: DocumentMode) => (dm as never as { view: View }).view;

/** The pointer shown after moving over a point of the document (points, from the first page's top left). */
function pointerAt(v: View, x: number, y: number): string {
  const s = v.toScreen(x, y);
  v.scroller.dispatchEvent(new MouseEvent('pointermove', { clientX: s.x, clientY: s.y, bubbles: true }));
  return v.scroller.style.cursor;
}

describe('the pointer in a document', () => {
  it('is the I-beam over the page (margins too, where a click puts the caret) and the arrow off it', async () => {
    const { dm } = await docMode({});
    const v = viewOf(dm);
    Object.defineProperty(v.scroller, 'clientWidth', { value: 1600, configurable: true });
    Object.defineProperty(v.scroller, 'clientHeight', { value: 1200, configurable: true });
    v.setZoom(1);
    // (a new document: US Letter, 612 × 792 pt, the page's top left at 0, 0)
    expect(pointerAt(v, 300, 300)).toBe('text');
    expect(pointerAt(v, 10, 10)).toBe('text');
    // left of the page, right of it, above it
    expect(pointerAt(v, -20, 300)).toBe('default');
    expect(pointerAt(v, 640, 300)).toBe('default');
    expect(pointerAt(v, 300, -10)).toBe('default');
    // back onto the page: the I-beam again (it doesn't stick either way)
    expect(pointerAt(v, 300, 300)).toBe('text');
  }, 60000);

  it('starts as the arrow before the pointer has moved (the style sheet no longer gives the whole view an I-beam)', async () => {
    const css = readFileSync(join(__dirname, '../src/app.css'), 'utf8');
    const rule = css.match(/\.doc-scroll \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/cursor: default/);
  });
});
