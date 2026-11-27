// @vitest-environment jsdom
//
// Review batch 19, Edit ▸ Typing and Spelling (F818): "Use the standard list" threw away the person's
// own replacements with no question and no way back.

import { describe, expect, it } from 'vitest';
import { TypingDialog } from '../src/ui/typing-dialog';
import { DEFAULT_REPLACEMENTS } from '../src/text/chemtext';
import type { TypingPrefs } from '../src/text/typing';

(HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; };

const tick = () => new Promise((r) => setTimeout(r, 0));
function make(replacements: [string, string][]) {
  document.body.replaceChildren();
  const prefs = { chemistry: true, spelling: true, stereoItalic: true, boldNumbers: true, links: true, linkCtrlClick: true, dictionary: [], replacements } as unknown as TypingPrefs;
  const dlg = new TypingDialog({ get: () => prefs, set: (v) => Object.assign(prefs, v), location: async () => 'settings.json' });
  dlg.open();
  const reset = () => document.querySelector<HTMLButtonElement>('[data-act=reset]')!.click();
  const choose = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.ask-buttons button')].find((b) => b.textContent === label)!.click();
  return { prefs, reset, choose };
}

describe('F818: Use the Standard List asks before replacing custom replacements', () => {
  it('keeps the list when the question is canceled', async () => {
    const { prefs, reset, choose } = make([['(c)', '©'], ['mine', 'MINE']]);
    reset();
    await tick();
    choose('Cancel');
    await tick();
    expect(prefs.replacements).toEqual([['(c)', '©'], ['mine', 'MINE']]);
  });
  it('names the button, the question and its answer the same way', async () => {
    const { reset } = make([['mine', 'MINE']]);
    const button = document.querySelector<HTMLButtonElement>('[data-act=reset]')!;
    reset();
    await tick();
    const question = [...document.querySelectorAll('dialog.ask')].pop()!;
    const answers = [...document.querySelectorAll<HTMLButtonElement>('.ask-buttons button')].map((b) => b.textContent);
    expect(button.textContent).toBe('Use the Standard List');
    expect(answers).toContain(button.textContent);
    expect(question.textContent).toContain('Use the Standard List?');
    expect(question.textContent).toContain('custom replacements');
  });
  it('replaces it when confirmed', async () => {
    const { prefs, reset, choose } = make([['mine', 'MINE']]);
    reset();
    await tick();
    choose('Use the Standard List');
    await tick();
    expect(prefs.replacements).toEqual(DEFAULT_REPLACEMENTS);
  });
  it('does not ask when the list is the standard one already', async () => {
    const { prefs, reset } = make(DEFAULT_REPLACEMENTS.map(([a, b]) => [a, b] as [string, string]));
    reset();
    await tick();
    expect(document.querySelectorAll('dialog.ask').length).toBe(0);
    expect(prefs.replacements).toEqual(DEFAULT_REPLACEMENTS);
  });
});
