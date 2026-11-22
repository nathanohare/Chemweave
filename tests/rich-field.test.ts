// @vitest-environment jsdom
//
// The Smart Scheme pane's rows: text shown as it looks on the page, with subscripts and
// superscripts set by the bar or worked out by chemical interpretation as you type.

import { describe, expect, it } from 'vitest';
import { RichField, chemPositions } from '../src/ui/rich-field';
import type { TextPart } from '../src/chem/smart-scheme';

function make(parts: TextPart[], chem = true) {
  const got: TextPart[][] = [];
  let on = chem;
  const f = new RichField(parts, { placeholder: 'Species', label: 'Species 1', chem: () => on, done: (p) => got.push(p) });
  document.body.append(f.el);
  f.el.focus();
  return { f, got, setChem: (v: boolean) => { on = v; } };
}

const type = (f: RichField, text: string) => {
  for (const ch of text) f.el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ch, cancelable: true, bubbles: true }));
};
const flat = (ps: TextPart[]) => ps.map((p) => (p.sub ? `_{${p.text}}` : p.sup ? `^{${p.text}}` : p.text)).join('');

describe('species list rows', () => {
  it('works out where formula digits go', () => {
    expect(chemPositions('Pd(PPh3)4')).toEqual(['', '', '', '', '', '', 'sub', '', 'sub']);
    expect(chemPositions('Step 2')).toEqual(['', '', '', '', '', '']);
  });

  it('shows subscripts as subscripts, not as markup', () => {
    const { f } = make([{ text: 'Pd(PPh' }, { text: '3', sub: true }, { text: ')' }, { text: '4', sub: true }]);
    expect(f.el.innerHTML).toBe('Pd(PPh<sub>3</sub>)<sub>4</sub>');
  });

  it('drops formula digits as they are typed, with Chem on', () => {
    const { f, got } = make([]);
    f.select(0);
    type(f, 'K2CO3');
    expect(flat(f.parts())).toBe('K_{2}CO_{3}');
    f.el.blur();
    expect(got.length).toBe(1);
    expect(flat(got[0])).toBe('K_{2}CO_{3}');
  });

  it('leaves the text as typed with Chem off, and turning it on works it out', () => {
    const { f, setChem } = make([], false);
    f.select(0);
    type(f, 'H2O');
    expect(flat(f.parts())).toBe('H2O');
    setChem(true);
    f.rechem();
    expect(flat(f.parts())).toBe('H_{2}O');
  });

  it('superscript from the bar for what is typed next, and over a selection', () => {
    const { f } = make([{ text: 'ArPd' }]);
    f.select(4);
    f.toggle('sup');
    expect(f.state('sup')).toBe(true);
    type(f, 'II');
    f.toggle('sup');
    type(f, 'X');
    expect(flat(f.parts())).toBe('ArPd^{II}X');
    // taking the subscript off a digit Chem dropped keeps it up
    const g = make([{ text: 'L' }, { text: '2', sub: true }]).f;
    g.select(1, 2);
    g.toggle('sub');
    expect(flat(g.parts())).toBe('L2');
    g.select(2);
    type(g, 'a');
    expect(flat(g.parts())).toBe('L2a');
  });

  it('deletes, inserts symbols, and Escape goes back to what it was', () => {
    const { f, got } = make([{ text: 'TS1' }]);
    f.select(3);
    f.el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', cancelable: true }));
    f.insert('‡');
    expect(f.text()).toBe('TS‡');
    f.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(f.text()).toBe('TS1');
    expect(got.length).toBe(0);
  });
});

describe('Undo and Redo in a row (G3-09)', () => {
  const key = (f: RichField, k: string, shift = false) => f.el.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true }));
  function withHistory(parts: TextPart[]) {
    const calls: string[] = [];
    const got: TextPart[][] = [];
    const f = new RichField(parts, { placeholder: '', label: 'Species 1', chem: () => true, done: (p) => got.push(p), history: (redo) => calls.push(redo ? 'redo' : 'undo') });
    document.body.append(f.el);
    f.el.focus();
    return { f, calls, got };
  }

  it('Ctrl+Z takes back what is typed in the row first, then hands Ctrl+Z to the drawing', () => {
    const { f, calls } = withHistory([{ text: 'Pd' }]);
    f.select(2);
    type(f, 'X');
    key(f, 'z');
    expect(f.text()).toBe('Pd');
    expect(calls).toEqual([]);
    key(f, 'z');
    expect(calls).toEqual(['undo']);
  });

  it('after Enter (the text gone to the drawing), Ctrl+Z and Ctrl+Y are the drawing\'s', () => {
    const { f, calls, got } = withHistory([{ text: '' }]);
    f.select(0);
    type(f, 'Pd');
    f.commit();
    expect(got.length).toBe(1);
    key(f, 'z');
    key(f, 'y');
    key(f, 'z', true);
    expect(calls).toEqual(['undo', 'redo', 'redo']);
    expect(f.text()).toBe('Pd');
  });

  it('typed and not finished, Ctrl+Y does nothing (the drawing\'s Redo would lose the typing)', () => {
    const { f, calls } = withHistory([{ text: 'Pd' }]);
    f.select(2);
    type(f, 'X');
    key(f, 'y');
    expect(calls).toEqual([]);
    expect(f.text()).toBe('PdX');
  });

  it('a change event (the app\'s Ctrl+S) finishes what is typed', () => {
    const { f, got } = withHistory([{ text: 'Pd' }]);
    f.select(2);
    type(f, 'Cl');
    f.el.dispatchEvent(new Event('change'));
    expect(got.length).toBe(1);
    expect(got[0].map((p) => p.text).join('')).toBe('PdCl');
  });
});
