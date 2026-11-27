// @vitest-environment jsdom
//
// Review batch 19, comment cards:
//   F688: bold, italic and the like landed on the wrong characters after an emoji, because the rich
//         box keeps one look for each UTF-16 unit and runsOf counted code points.
//   F689: an empty Reply box that lost focus was left in the card, dead.

import { describe, it, expect, vi } from 'vitest';
import { looksOf, runsOf, threadCard, type ThreadActions } from '../src/ui/comment-cards';
import type { RunLook } from '../src/sheet/rich-text';

const actions = (): ThreadActions => ({ edit: vi.fn(), reply: vi.fn(), removeReply: vi.fn(), resolve: vi.fn(), remove: vi.fn(), focus: vi.fn(), cancelNew: vi.fn() });

describe('F688: looks after an emoji', () => {
  // U+1F600 takes two UTF-16 units, so "😀 bold" has 7 units and "bold" is units 3 to 6
  it('puts the bold on the word that was made bold', () => {
    const text = '😀 bold';
    const looks: RunLook[] = Array.from({ length: text.length }, (_, i) => (i >= 3 ? { bold: true } : {}));
    expect(text.length).toBe(7);
    expect(runsOf(text, looks)?.map((r) => [r.text, !!r.bold])).toEqual([['😀 ', false], ['bold', true]]);
  });
  it('keeps the looks of several emoji apart from the words after them', () => {
    const text = '😀😀x𝛼y';
    const looks: RunLook[] = Array.from({ length: text.length }, (_, i) => (i === 5 ? { italic: true } : {})); // units: 😀 0-1, 😀 2-3, x 4, 𝛼 5-6, y 7
    expect(runsOf(text, looks)?.map((r) => [r.text, !!r.italic])).toEqual([['😀😀x', false], ['𝛼', true], ['y', false]]);
  });
  it('gives back what looksOf was given', () => {
    const runs = [{ text: 'a😀' }, { text: 'bc', bold: true }];
    expect(runsOf('a😀bc', looksOf('a😀bc', runs))?.map((r) => [r.text, !!r.bold])).toEqual([['a😀', false], ['bc', true]]);
  });
});

describe('F689: an empty reply box that loses focus goes away', () => {
  it('takes the box out, brings the buttons back, and a new Reply makes one box', () => {
    const a = actions();
    const card = threadCard({ id: 1, author: 'Nate', date: '', text: 'Check this' }, { active: true, editing: false, actions: a });
    document.body.replaceChildren(card);
    const reply = () => [...card.querySelectorAll<HTMLButtonElement>('.cmt-bar button')].find((b) => b.textContent === 'Reply')!;
    const bar = card.querySelector<HTMLElement>('.cmt-bar')!;
    reply().click();
    expect(bar.hidden).toBe(true);
    expect(card.querySelectorAll('textarea')).toHaveLength(1);
    card.querySelector('textarea')!.dispatchEvent(new FocusEvent('blur'));
    expect(card.querySelectorAll('textarea')).toHaveLength(0);
    expect(bar.hidden).toBe(false);
    expect(a.reply).not.toHaveBeenCalled();
    // and Reply works again, with one box that saves
    reply().click();
    const boxes = card.querySelectorAll('textarea');
    expect(boxes).toHaveLength(1);
    boxes[0].value = 'Thanks';
    boxes[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(a.reply).toHaveBeenCalledWith('Thanks', null);
  });
});
