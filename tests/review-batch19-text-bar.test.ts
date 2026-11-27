// @vitest-environment jsdom
//
// Review batch 19, the text formatting bar:
//   F177: Escape in the Font, Size and spacing boxes applied the typed value instead of cancelling it,
//         and Enter applied it twice (once by the key, once by the box losing focus).
//   F809: a spacing number the box could not take (too low) or took clamped (too high) stayed in the
//         box as typed, though the text had something else.

import { describe, it, expect } from 'vitest';
import { buildTextBar, type TextBarState } from '../src/ui/text-bar';
import type { TextFormat } from '../src/text/format';

function make() {
  const bar = document.createElement('div');
  document.body.replaceChildren(bar);
  const formats: TextFormat[] = [];
  const state: TextBarState = { style: { size: 12, font: 'Arial' }, align: 'left', line: 1, before: 0, after: 0, link: false };
  const tb = buildTextBar(bar, {
    format: (f) => { formats.push(f); if (f.kind === 'style' && f.patch.size !== undefined) state.style = { ...state.style, size: f.patch.size }; return true; },
    type: () => true, link: () => {}, state: () => state,
    // the caret goes back to the text: the box in use loses focus (the real one then fires 'change' if it was edited)
    back: () => { (document.activeElement as HTMLElement | null)?.blur(); },
  });
  const box = (label: string) => {
    const b = bar.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    // a browser fires 'change' as an edited box loses focus; jsdom does not, so do it as blur() runs
    let atFocus = '';
    b.addEventListener('focus', () => { atFocus = b.value; });
    const blur = b.blur.bind(b);
    b.blur = () => { const was = document.activeElement === b; blur(); if (was && b.value !== atFocus) b.dispatchEvent(new Event('change', { bubbles: true })); };
    return b;
  };
  const type = (b: HTMLInputElement, v: string) => { b.focus(); b.value = v; b.dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (b: HTMLInputElement, k: string) => b.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { bar, tb, formats, state, box, type, key };
}
const sizes = (f: TextFormat[]) => f.filter((x) => x.kind === 'style').map((x) => (x as { patch: { size?: number } }).patch.size);

describe('F177: Escape cancels what was typed in a box', () => {
  it('leaves the size alone and shows the old size', () => {
    const { tb, formats, box, type, key } = make();
    tb.refresh();
    const size = box('Font size');
    expect(size.value).toBe('12');
    type(size, '48');
    key(size, 'Escape');
    expect(sizes(formats)).toEqual([]);
    expect(size.value).toBe('12');
  });
  it('leaves the font alone', () => {
    const { formats, box, type, key, tb } = make();
    tb.refresh();
    const font = box('Font');
    type(font, 'Courier New');
    key(font, 'Escape');
    expect(formats).toEqual([]);
    expect(font.value).toBe('Arial');
  });
  it('leaves line spacing alone', () => {
    const { formats, box, type, key, tb } = make();
    tb.refresh();
    const line = box('Line spacing (1 = single)');
    type(line, '2');
    key(line, 'Escape');
    expect(formats).toEqual([]);
    expect(line.value).toBe('1');
  });
});

describe('F177: Enter applies a typed value once', () => {
  it('sets the size one time', () => {
    const { formats, box, type, key, tb } = make();
    tb.refresh();
    const size = box('Font size');
    type(size, '48');
    key(size, 'Enter');
    expect(sizes(formats)).toEqual([48]);
    expect(size.value).toBe('48');
  });
  it('sets line spacing one time', () => {
    const { formats, box, type, key, tb } = make();
    tb.refresh();
    const line = box('Line spacing (1 = single)');
    type(line, '2');
    key(line, 'Enter');
    expect(formats.filter((f) => f.kind === 'line')).toEqual([{ kind: 'line', v: 2 }]);
  });
  it('still applies on Tab (the box losing focus by itself)', () => {
    const { formats, box, type, tb } = make();
    tb.refresh();
    const size = box('Font size');
    type(size, '20');
    size.dispatchEvent(new Event('change', { bubbles: true }));
    expect(sizes(formats)).toEqual([20]);
  });
});

describe('F809: the spacing box shows what was applied', () => {
  it('brings a number below the lowest back to the text\'s own', () => {
    const { formats, box, type, tb } = make();
    tb.refresh();
    const line = box('Line spacing (1 = single)'); // lowest 0.5
    type(line, '0.2');
    line.dispatchEvent(new Event('change', { bubbles: true }));
    expect(formats).toEqual([]);
    expect(line.value).toBe('1');
  });
  it('shows the top when a bigger number was applied as the top', () => {
    const { formats, box, type, tb } = make();
    tb.refresh();
    const before = box('Space before the selected paragraphs, in points'); // highest 200
    type(before, '300');
    before.dispatchEvent(new Event('change', { bubbles: true }));
    expect(formats).toEqual([{ kind: 'para', patch: { spaceBefore: 200 } }]);
    expect(before.value).toBe('200');
  });
});
