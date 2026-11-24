// @vitest-environment jsdom
//
// Comment cards: Escape keeps the text of a new comment (as Word does) and takes back an edit.

import { describe, it, expect, vi } from 'vitest';
import { threadCard, type ThreadActions } from '../src/ui/comment-cards';
import { freeSpot } from '../src/ui/slide-comments';

const actions = (): ThreadActions => ({ edit: vi.fn(), reply: vi.fn(), removeReply: vi.fn(), resolve: vi.fn(), remove: vi.fn(), focus: vi.fn(), cancelNew: vi.fn() });

function typeAndEscape(text: string, typed: string, a: ThreadActions): void {
  const card = threadCard({ id: 1, author: 'Nate', date: '', text }, { active: true, editing: true, actions: a });
  const ta = card.querySelector('textarea')!;
  ta.value = typed;
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('comment cards', () => {
  it('keeps what was typed into a new comment on Escape', () => {
    const a = actions();
    typeAndEscape('', 'Check the yield', a);
    expect(a.edit).toHaveBeenCalledWith('Check the yield', undefined, null);
    expect(a.cancelNew).not.toHaveBeenCalled();
  });

  it('takes away a new comment left empty on Escape', () => {
    const a = actions();
    typeAndEscape('', '  ', a);
    expect(a.cancelNew).toHaveBeenCalled();
  });

  it('takes back changes to an old comment on Escape', () => {
    const a = actions();
    typeAndEscape('Old text', 'New text', a);
    expect(a.edit).toHaveBeenCalledWith('Old text', undefined, null);
  });
});

describe('rich comment box (Word and PowerPoint comments)', () => {
  // review R01: Shift+Enter is a new line in the shared rich text box; Enter saves
  it('Shift+Enter starts a new line, and Enter saves the comment on two lines', () => {
    const a = actions();
    const card = threadCard({ id: 1, author: 'Nate', date: '', text: 'ab' }, { active: true, editing: true, actions: a, rich: true });
    document.body.append(card);
    const box = card.querySelector<HTMLElement>('.cmt-rich')!;
    box.tabIndex = 0;
    box.focus();
    const put = () => {
      const t = [...box.querySelectorAll('span')].at(-1)!.firstChild as Text;
      const r = document.createRange();
      r.setStart(t, t.data.length);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(r);
      return t;
    };
    put();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    const e = new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true });
    box.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    const t = put();
    t.data += 'cd';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(a.edit).toHaveBeenCalledWith('ab\ncd', undefined, null);
    card.remove();
  });
});

describe('slide comment markers', () => {
  const size = { w: 960, h: 540 };
  it('puts a new marker where asked when the place is free', () => {
    expect(freeSpot({ x: 8, y: 8 }, [], size)).toEqual({ x: 8, y: 8 });
  });
  it('moves a new marker below the ones already there', () => {
    const a = freeSpot({ x: 8, y: 8 }, [{ x: 8, y: 8 }], size);
    expect(a.x).toBe(8);
    expect(a.y).toBeGreaterThanOrEqual(30);
    const b = freeSpot({ x: 8, y: 8 }, [{ x: 8, y: 8 }, a], size);
    expect(b.y).toBeGreaterThan(a.y);
  });
});
