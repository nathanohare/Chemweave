// @vitest-environment jsdom
// Code review batch 07, F073: on a Mac, Option+Left and Option+Right move by word, and Option+Backspace
// and Option+Delete delete a word (the keys did nothing because Alt was left out of every key).
// (Option+Shift+Arrow is the outline keys' chord in the key map, left as it is.)
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60000 });
// a Mac: set before the program is loaded (it asks once)
Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });

import { docMode, press } from './doc-mode-harness';

describe('Option and the arrow keys on a Mac (F073)', () => {
  it('Option+Right and Option+Left move by word', async () => {
    const { f, ta } = await docMode({ runs: [{ text: 'alpha beta gamma' }], paras: [{}] });
    f.ed.setCaret(0);
    // (to the start of the next word, as Word's Ctrl+Right does)
    press(ta, 'ArrowRight', { altKey: true });
    expect(f.ed.focus).toBe(6);
    press(ta, 'ArrowRight', { altKey: true });
    expect(f.ed.focus).toBe(11);
    press(ta, 'ArrowLeft', { altKey: true });
    expect(f.ed.focus).toBe(6);
  });

  it('Option+Backspace and Option+Delete delete a word', async () => {
    const { f, ta } = await docMode({ runs: [{ text: 'alpha beta gamma' }], paras: [{}] });
    f.ed.setCaret(10);
    press(ta, 'Backspace', { altKey: true });
    expect(f.ed.text).toBe('alpha  gamma');
    const again = await docMode({ runs: [{ text: 'alpha beta gamma' }], paras: [{}] });
    again.f.ed.setCaret(6);
    press(again.ta, 'Delete', { altKey: true });
    expect(again.f.ed.text).toBe('alpha gamma');
  });
});
