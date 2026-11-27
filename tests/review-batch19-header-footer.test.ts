// @vitest-environment jsdom
//
// Review batch 19, Insert ▸ Header & Footer (F157): confirming on the Notes and Handouts tab changes
// only the notes pages and handouts. As in PowerPoint, the slide number, date and footer of the
// slides, and each slide's own setting, stay as they were.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { Deck, showsNumber } from '../src/deck/deck';
import { applyHeaderFooter, editHeaderFooter } from '../src/ui/header-footer-dialog';

(HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; };

describe('F157: Apply to All on the Notes and Handouts tab', () => {
  it('leaves every slide\'s number, date, footer and own setting alone', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('title-content');
    d.addSlide('title-content');
    // slide numbers on for all slides, then slide 3 (index 2) turns its own number off
    d.setHeaderFooter({ ...d.master, footer: 'Smith group' }, { number: true, footer: true, date: false });
    d.setHeaderFooter(d.master, { number: false, footer: true, date: false }, [2]);
    const slide3 = d.slides[2];
    expect(slide3.hf).toEqual({ number: false, footer: true, date: false });
    const before = { numbers: d.master.slideNumbers, dateOn: d.master.dateOn, footerOff: d.master.footerOff, footer: d.master.footer };

    // slide 3 is the current slide; open on the Notes and Handouts tab, tick Page number, Apply to All
    document.body.replaceChildren();
    const got = editHeaderFooter(d.master, slide3, 1, 'notes');
    const dlg = document.querySelector<HTMLDialogElement>('dialog.hf-dialog')!;
    const notes = dlg.querySelectorAll<HTMLElement>('.hf-page')[1];
    const header = [...notes.querySelectorAll<HTMLLabelElement>('label.hf-check')].find((l) => l.textContent!.trim() === 'Header')!;
    const headerText = header.parentElement!.querySelector<HTMLInputElement>('input[type=text]')!;
    headerText.value = 'Group meeting';
    headerText.dispatchEvent(new Event('input', { bubbles: true }));
    dlg.querySelector<HTMLButtonElement>('button.primary')!.click(); // Apply to All
    const r = (await got)!;
    expect(r.scope).toBe('notes');
    applyHeaderFooter(d, r, [2]);

    // the notes change ...
    expect(d.master.notesHF?.header).toBe('Group meeting');
    // ... the slides do not
    expect({ numbers: d.master.slideNumbers, dateOn: d.master.dateOn, footerOff: d.master.footerOff, footer: d.master.footer }).toEqual(before);
    expect(d.slides[2].hf).toEqual({ number: false, footer: true, date: false });
    expect(showsNumber(d.master, d.slides[2].layout, d.slides[2].hf)).toBe(false);
    expect(showsNumber(d.master, d.slides[1].layout, d.slides[1].hf)).toBe(true);
    // one step of Undo takes the notes change back
    d.undo();
    expect(d.master.notesHF?.header ?? '').toBe('');
    expect(d.slides[2].hf).toEqual({ number: false, footer: true, date: false });
  });

  it('still applies the slide boxes to every slide from the Slide tab', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('title-content');
    document.body.replaceChildren();
    const got = editHeaderFooter(d.master, d.slides[1], 1, 'slide');
    document.querySelector<HTMLButtonElement>('dialog.hf-dialog button.primary')!.click();
    const r = (await got)!;
    expect(r.scope).toBe('all');
    d.setHeaderFooter(d.master, { number: false, footer: true, date: false }, [1]);
    applyHeaderFooter(d, r, [1]);
    expect(d.slides[1].hf).toBeUndefined(); // Apply to All clears each slide's own setting
  });
});
