// @vitest-environment jsdom
//
// Review batch 19, Insert ▸ Symbol:
//   F807: a title-bar drag that ended in pointercancel left the window following the pointer.
//   F808: typing a symbol from the grid with the keyboard destroyed the focused tile, so the arrow
//         keys and Esc stopped working.

import { describe, expect, it } from 'vitest';
import { SymbolWindow } from '../src/ui/symbol-window';

(HTMLDialogElement.prototype as unknown as { show: () => void }).show = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; };

function make() {
  const typed: string[] = [];
  const recent: string[] = [];
  const w = new SymbolWindow({ insert: (ch) => { typed.push(ch); return true; }, recent: () => recent, used: (ch) => { recent.unshift(ch); } });
  document.body.replaceChildren();
  w.open();
  return { w, typed };
}
const pointer = (type: string, init: { clientX: number; clientY: number }) => {
  const e = new Event(type, { bubbles: true }) as Event & { clientX: number; clientY: number };
  e.clientX = init.clientX; e.clientY = init.clientY;
  return e;
};

describe('F808: the keyboard keeps its place after a symbol is typed', () => {
  it('leaves focus on the same symbol, so arrows and Esc still work', () => {
    const { w, typed } = make();
    const grid = w.d.querySelector<HTMLElement>('.sym-grid')!;
    const tiles = () => [...grid.querySelectorAll<HTMLButtonElement>('button.sym')];
    expect(tiles().length).toBeGreaterThan(2);
    const third = tiles()[2];
    third.focus();
    expect(document.activeElement).toBe(third);
    third.click(); // Enter or Space on a button is a click
    expect(typed).toEqual([third.textContent]);
    // the tiles were made again; the focus is on the new tile of the same symbol, inside the window
    const now = document.activeElement as HTMLElement;
    expect(now).not.toBe(document.body);
    expect(w.d.contains(now)).toBe(true);
    expect(now.textContent).toBe(third.textContent);
    // Esc still reaches the window's key handler and closes it
    now.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(w.isOpen).toBe(false);
  });
});

describe('F807: a cancelled title-bar drag lets go of the window', () => {
  it('stops following the pointer after pointercancel', () => {
    const { w } = make();
    w.d.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200, x: 100, y: 100, toJSON: () => ({}) });
    const title = w.d.querySelector('h2')!;
    title.dispatchEvent(pointer('pointerdown', { clientX: 120, clientY: 110 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 220, clientY: 210 }));
    expect(w.d.style.left).toBe('200px');
    window.dispatchEvent(new Event('pointercancel'));
    window.dispatchEvent(pointer('pointermove', { clientX: 500, clientY: 500 }));
    expect(w.d.style.left).toBe('200px'); // not followed
  });
});
