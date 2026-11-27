// @vitest-environment jsdom
//
// Review batch 19, RichField (Smart Scheme rows, TLC lane names):
//   F175: the field redrew its text in the middle of an input-method composition.
//   F783: characters outside the Basic Multilingual Plane (an emoji, 𝛼) threw every offset after
//         them off by one, because characters were counted by code point and the page's
//         selection by UTF-16 unit.

import { describe, expect, it } from 'vitest';
import { RichField, chemPositions } from '../src/ui/rich-field';
import type { TextPart } from '../src/chem/smart-scheme';

function make(parts: TextPart[], looks = false) {
  const got: TextPart[][] = [];
  const f = new RichField(parts, { placeholder: 'Species', label: 'Species 1', chem: () => false, looks, done: (p) => got.push(p) });
  document.body.replaceChildren(f.el);
  f.el.focus();
  return { f, got };
}
const input = (f: RichField, inputType: string, data?: string, init: InputEventInit = {}) =>
  f.el.dispatchEvent(new InputEvent('beforeinput', { inputType, data, cancelable: true, bubbles: true, ...init }));
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('F783: characters outside the BMP', () => {
  // U+1F600 is one character that takes two UTF-16 units (Unicode, section 3.8, surrogates)
  it('puts the caret and Backspace on the right character after an emoji', () => {
    const { f } = make([{ text: '😀ab' }]);
    expect(f.text()).toBe('😀ab');
    f.select(4); // after the b: 😀 is two units
    input(f, 'deleteContentBackward');
    expect(f.text()).toBe('😀a');
    input(f, 'deleteContentBackward');
    expect(f.text()).toBe('😀');
    // Backspace over the emoji takes both halves
    input(f, 'deleteContentBackward');
    expect(f.text()).toBe('');
  });
  it('takes both halves of an emoji with Delete', () => {
    const { f } = make([{ text: '😀ab' }]);
    f.select(0);
    input(f, 'deleteContentForward');
    expect(f.text()).toBe('ab');
  });
  it('makes the selected character bold, not its neighbor', () => {
    const { f } = make([{ text: '😀ab' }], true);
    f.select(3, 4); // the b
    f.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true, bubbles: true }));
    expect(f.parts()).toEqual([{ text: '😀a' }, { text: 'b', bold: true }]);
  });
  it('types after an emoji at the caret', () => {
    const { f } = make([{ text: '😀' }]);
    f.select(2);
    input(f, 'insertText', 'x');
    input(f, 'insertText', '𝛼'); // mathematical italic small alpha, also outside the BMP
    expect(f.text()).toBe('😀x𝛼');
    f.select(3);
    input(f, 'deleteContentBackward');
    expect(f.text()).toBe('😀𝛼');
  });
  it('gives chemical interpretation one place for each UTF-16 unit', () => {
    // 😀H2O: the digit is the fourth unit (two for the emoji, then H, then 2)
    expect(chemPositions('😀H2O')).toEqual(['', '', '', 'sub', '']);
  });
});

describe('F175: an input method is not interrupted by a redraw', () => {
  it('leaves the text being composed alone until the composition ends', async () => {
    const { f } = make([{ text: 'ab' }]);
    f.select(2);
    f.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    // the browser puts the half-composed text in the page and reports it
    const text = f.el.firstChild as Text;
    text.data = 'abか';
    input(f, 'insertCompositionText', 'か', { isComposing: true });
    await tick();
    expect(f.el.firstChild).toBe(text); // the node the input method is working in is still there
    expect(f.text()).toBe('ab'); // read when it ends
    f.el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'か' }));
    expect(f.text()).toBe('abか');
  });
  it('still reads a change made outside a composition', async () => {
    const { f } = make([{ text: 'ab' }]);
    f.select(2);
    (f.el.firstChild as Text).data = 'abc';
    input(f, 'insertReplacementText2'); // an input type the field does not handle itself
    await tick();
    expect(f.text()).toBe('abc');
  });
  it('leaves Enter and Escape to the input method while composing', () => {
    const { f, got } = make([{ text: 'ab' }]);
    f.select(2);
    f.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    (f.el.firstChild as Text).data = 'abか';
    input(f, 'insertCompositionText', 'か', { isComposing: true });
    // Enter accepts the candidate and Escape drops it: neither ends the editing of the field
    for (const key of ['Enter', 'Escape']) {
      const e = new KeyboardEvent('keydown', { key, isComposing: true, cancelable: true, bubbles: true });
      f.el.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(f.el);
    }
    expect(got).toEqual([]);
    // after the composition, Enter finishes the field as before
    f.el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'か' }));
    const e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    f.el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(f.el);
  });
});
