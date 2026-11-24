// @vitest-environment jsdom
// The Orbital window's Phases row: "Phases in two colors" shows two color boxes beside the list
// (hidden for the other looks, so the row adds no height), and their colors come back with the rest.

import { describe, it, expect } from 'vitest';
import { ask } from '../src/ui/ask';

// jsdom has no showModal
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

describe('color boxes beside a drop-down list', () => {
  it('show only for their choice and come back under their own names', async () => {
    const got = ask('Orbital', [
      { name: 'look', label: 'Phases', value: 'shaded', options: [{ value: 'shaded', label: 'Shaded' }, { value: 'colour', label: 'Two colors' }],
        colors: { when: 'colour', items: [{ name: 'c0', value: '#3b6fb6', label: 'First phase color' }, { name: 'c1', value: '#d0453b', label: 'Second phase color' }] } },
    ]);
    const d = document.querySelector('dialog.ask')!;
    const box = d.querySelector<HTMLElement>('.ask-colors')!;
    const sel = d.querySelector('select')!;
    expect(box.hidden).toBe(true);
    sel.value = 'colour';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(box.hidden).toBe(false);
    const [a, b] = box.querySelectorAll('input');
    expect(a.getAttribute('aria-label')).toBe('First phase color');
    b.value = '#e69500';
    d.querySelector('form')!.requestSubmit();
    expect(await got).toEqual({ look: 'colour', c0: '#3b6fb6', c1: '#e69500' });
  });
});
