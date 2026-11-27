// @vitest-environment jsdom
//
// Touch Mode's long press is a right-click, and the lift after it isn't also a click. When the
// browser ended the press with pointercancel (the finger moved on and the page scrolled) instead
// of pointerup, the "swallow the next click" state was never cleared and every later click in the
// app was stopped.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { installTouchUi } from '../src/ui/touch-ui';

const ptr = (type: string, id: number, timeStamp?: number) => {
  const e = new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, button: 0, clientX: 10, clientY: 10, bubbles: true, cancelable: true });
  if (timeStamp !== undefined) Object.defineProperty(e, 'timeStamp', { value: timeStamp });
  return e;
};
/** A click on a fresh button: was it let through? */
function clicked(at: number): boolean {
  const b = document.createElement('button');
  document.body.append(b);
  let got = false;
  b.addEventListener('click', () => { got = true; });
  const e = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'timeStamp', { value: at });
  b.dispatchEvent(e);
  b.remove();
  return got;
}

describe('long press in Touch Mode', () => {
  let target: HTMLElement;
  beforeAll(() => {
    vi.useFakeTimers();
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
    const host = document.createElement('div');
    document.body.append(host);
    installTouchUi({ canvasHost: host, keypad: () => true, command: () => {}, say: () => {} }, 'on');
    target = document.createElement('div');
    document.body.append(target);
  });
  afterAll(() => vi.useRealTimers());

  it('swallows the click from the lift after a hold that ends with pointerup', () => {
    target.dispatchEvent(ptr('pointerdown', 1));
    vi.advanceTimersByTime(600);
    window.dispatchEvent(ptr('pointerup', 1, 1000));
    expect(clicked(1100)).toBe(false); // the lift's own click
    expect(clicked(2000)).toBe(true);
  });

  it('lets clicks through again after a hold the browser ends with pointercancel', () => {
    let menus = 0;
    const count = () => { menus++; };
    document.addEventListener('contextmenu', count);
    target.dispatchEvent(ptr('pointerdown', 2));
    vi.advanceTimersByTime(600);
    document.removeEventListener('contextmenu', count);
    expect(menus).toBe(1); // the hold opened the menu (its own pointercancel didn't end the swallowing)
    expect(clicked(3000)).toBe(false); // still held: a click now is the press's own
    // the finger moves on and the browser takes over to scroll
    window.dispatchEvent(ptr('pointercancel', 2, 3100));
    expect(clicked(4000)).toBe(true);
    expect(clicked(4100)).toBe(true);
  });

  it('forgets a held press that never ended when a new first touch begins', () => {
    target.dispatchEvent(ptr('pointerdown', 3));
    vi.advanceTimersByTime(600);
    // no pointerup or pointercancel for 3 arrives; a new touch starts and lifts before the hold time
    target.dispatchEvent(ptr('pointerdown', 4));
    window.dispatchEvent(ptr('pointerup', 4, 5000));
    expect(clicked(6000)).toBe(true);
  });
});
