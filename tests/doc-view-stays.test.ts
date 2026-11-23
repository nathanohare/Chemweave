// @vitest-environment jsdom
// Document mode (Nate's findings of 2026-11-23, Document 1 and 2): the window doesn't scroll when
// a picture is clicked (even one only partly on screen), nor when typing in a header or footer
// ends after scrolling elsewhere. Moving the caret with the keys still brings it into view.
import { describe, it, expect, beforeAll } from 'vitest';
import { docMode, press } from './doc-mode-harness';
import { objectRun, type DocText } from '../src/document/document';
import type { DocumentMode } from '../src/ui/doc-mode';
import type { DocFile } from '../src/document/doc-file';

const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeAll(() => {
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
});

type View = { scroller: HTMLElement; zoom: number; setZoom(z: number): void; toScreen(x: number, y: number): { x: number; y: number }; reveal(...a: unknown[]): void; revealTop(...a: unknown[]): void };
const viewOf = (dm: DocumentMode) => (dm as never as { view: View }).view;

/** A document with a picture in its text, in a window with a size; every scroll the view is asked for is counted. */
async function setUp(t: Partial<DocText>): Promise<{ dm: DocumentMode; f: DocFile; ta: HTMLTextAreaElement; v: View; scrolls: () => number }> {
  const { dm, f, ta } = await docMode(t);
  const v = viewOf(dm);
  Object.defineProperty(v.scroller, 'clientWidth', { value: 1600, configurable: true });
  Object.defineProperty(v.scroller, 'clientHeight', { value: 1200, configurable: true });
  v.setZoom(1);
  let n = 0;
  const reveal = v.reveal.bind(v), revealTop = v.revealTop.bind(v);
  v.reveal = (...a: unknown[]) => { n++; reveal(...(a as [never])); };
  v.revealTop = (...a: unknown[]) => { n++; revealTop(...(a as [never])); };
  return { dm, f, ta, v, scrolls: () => n };
}

function click(v: View, x: number, y: number, n = 1): void {
  for (let k = 0; k < n; k++) {
    for (const type of ['pointerdown', 'pointerup']) {
      const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, detail: k + 1 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      v.scroller.dispatchEvent(e);
    }
  }
  if (n === 2) v.scroller.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
}

describe('Document: the window stays where it is', () => {
  it('when a picture is clicked', async () => {
    const { dm, f, v, scrolls } = await setUp({ runs: [{ text: 'Some text before the picture. ' }, objectRun(1, {}), { text: ' And after it.' }], paras: [{}], objects: { 1: { kind: 'picture', src: PIC, w: 120, h: 80 } } as never });
    const o = f.layout().objects.find((x) => x.id === 1)!;
    const at = v.toScreen(o.x + o.w / 2, o.y + o.h / 2);
    const before = scrolls();
    click(v, at.x, at.y);
    expect(dm.pickedObject()).toBe(1);
    expect(scrolls() - before, 'clicking the picture scrolled the window').toBe(0);
    // the keys still bring the caret into view
    const ta = document.querySelector<HTMLTextAreaElement>('.doc-input')!;
    press(ta, 'ArrowRight');
    expect(scrolls() - before).toBeGreaterThan(0);
  }, 60000);

  it('when typing in a header ends (Close Header and Footer, Escape, or a double-click on the text)', async () => {
    const { dm, f, ta, v, scrolls } = await setUp({ runs: [{ text: 'The document\'s text.' }], paras: [{}] });
    const lay = f.layout(), p = lay.pages[0];
    for (const how of ['close', 'escape', 'double-click']) {
      dm.run('header-edit');
      expect(f.box?.hf, 'typing in the header').toBeTruthy();
      const before = scrolls();
      if (how === 'close') dm.run('hf-close');
      else if (how === 'escape') press(ta, 'Escape');
      else { const at = v.toScreen(p.x + 100, p.top + p.setup.top + 10); click(v, at.x, at.y, 2); }
      expect(f.box, `${how}: still in the header`).toBeNull();
      expect(scrolls() - before, `${how}: leaving the header scrolled the window`).toBe(0);
    }
  }, 60000);
});
