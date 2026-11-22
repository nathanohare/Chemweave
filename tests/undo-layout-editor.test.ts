// @vitest-environment jsdom
// Undo audit, Presentation mode (review round 2, finding 16): in Slide Master > Edit Layouts,
// Ctrl+Z undoes moving or sizing a placeholder (and every other change made in the window), and
// Ctrl+Y redoes it, before Apply. After Apply the whole edit is one step of the deck's Undo
// (tests/deck-*.test.ts).
import './doc-mode-harness';
import { describe, it, expect, beforeAll } from 'vitest';
import { editLayouts } from '../src/ui/layout-editor';
import { defaultMaster, type LayoutDef } from '../src/deck/deck';

beforeAll(() => {
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  const dlg = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dlg.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});

const SIZE = { w: 960, h: 540 };

function open(): { done: Promise<LayoutDef[] | null>; d: HTMLDialogElement } {
  const done = editLayouts({ master: defaultMaster(), size: SIZE, current: 'title-content', used: new Map() });
  return { done, d: document.querySelector<HTMLDialogElement>('dialog.layout-editor')! };
}

const places = (d: HTMLDialogElement) => [...d.querySelectorAll<HTMLElement>('.le-ph')].map((e) => `${e.style.left} ${e.style.top} ${e.style.width} ${e.style.height}`).join(' | ');
const key = (d: HTMLDialogElement, k: string, mods: KeyboardEventInit = {}) => {
  const stage = d.querySelector<HTMLElement>('.le-stage')!;
  stage.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
};
const mouse = (el: EventTarget, type: string, x: number, y: number) => {
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  el.dispatchEvent(e);
};
/** Drag a placeholder (or one of its corner handles) by (dx, dy) pixels. */
function drag(el: HTMLElement, dx: number, dy: number): void {
  mouse(el, 'pointerdown', 100, 100);
  for (let k = 1; k <= 4; k++) mouse(window, 'pointermove', 100 + (dx * k) / 4, 100 + (dy * k) / 4);
  mouse(window, 'pointerup', 100 + dx, 100 + dy);
}

describe('Edit Layouts: Undo and Redo inside the window', () => {
  it('Ctrl+Z undoes moving a placeholder, Ctrl+Y redoes it', async () => {
    const { done, d } = open();
    const before = places(d);
    drag(d.querySelector<HTMLElement>('.le-ph')!, 60, 40);
    const moved = places(d);
    expect(moved).not.toBe(before);
    key(d, 'z', { ctrlKey: true });
    expect(places(d)).toBe(before);
    key(d, 'y', { ctrlKey: true });
    expect(places(d)).toBe(moved);
    key(d, 'z', { ctrlKey: true, shiftKey: false });
    key(d, 'z', { ctrlKey: true, shiftKey: true });
    expect(places(d)).toBe(moved);
    d.close();
    expect(await done).toBe(null);
  });

  it('Ctrl+Z undoes sizing a placeholder by its corner', async () => {
    const { done, d } = open();
    const before = places(d);
    drag(d.querySelector<HTMLElement>('.le-ph .le-handle.se')!, 50, 30);
    expect(places(d)).not.toBe(before);
    key(d, 'z', { metaKey: true });
    expect(places(d)).toBe(before);
    d.close();
    await done;
  });

  it('a click on a placeholder that moves nothing is no step (Ctrl+Z then undoes the change before)', async () => {
    const { done, d } = open();
    const before = places(d);
    drag(d.querySelector<HTMLElement>('.le-ph')!, 60, 40);
    drag(d.querySelector<HTMLElement>('.le-ph')!, 0, 0);
    key(d, 'z', { ctrlKey: true });
    expect(places(d)).toBe(before);
    d.close();
    await done;
  });

  it('arrow-key nudges, a deleted placeholder and an added one are undone one at a time', async () => {
    const { done, d } = open();
    const start = places(d);
    drag(d.querySelector<HTMLElement>('.le-ph')!, 0, 0); // pick it
    key(d, 'ArrowRight');
    const nudged = places(d);
    expect(nudged).not.toBe(start);
    key(d, 'Delete');
    expect(d.querySelectorAll('.le-ph').length).toBe(1);
    [...d.querySelectorAll<HTMLButtonElement>('.le-tools button')].find((b) => b.textContent === '+ Text')!.click();
    expect(d.querySelectorAll('.le-ph').length).toBe(2);
    key(d, 'z', { ctrlKey: true });
    expect(d.querySelectorAll('.le-ph').length).toBe(1);
    key(d, 'z', { ctrlKey: true });
    expect(places(d)).toBe(nudged);
    key(d, 'z', { ctrlKey: true });
    expect(places(d)).toBe(start);
    d.close();
    await done;
  });

  it('Apply hands back the layouts as they are after undoing', async () => {
    const { done, d } = open();
    drag(d.querySelector<HTMLElement>('.le-ph')!, 60, 40);
    key(d, 'z', { ctrlKey: true });
    d.querySelector<HTMLFormElement>('form')!.requestSubmit();
    const got = await done;
    const fresh = open();
    const untouched = [...fresh.d.querySelectorAll('.le-ph')].length;
    fresh.d.close();
    await fresh.done;
    expect(got).not.toBe(null);
    expect(JSON.stringify(got!.find((l) => l.id === 'title-content')!.boxes)).toBe(JSON.stringify((await import('../src/deck/deck')).builtinLayout('title-content').boxes));
    expect(untouched).toBe(2);
  });
});
