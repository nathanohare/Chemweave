// @vitest-environment jsdom
// Presentation Insert ▸ Header & Footer… (retrospective audit G5-14): the help is behind the "i" by
// the title (UI rule 2), and a slide and a notes page show where the date, footer and number go,
// following the boxes as they change, as PowerPoint's preview does.
import { describe, expect, it } from 'vitest';
import { editHeaderFooter, previewBox } from '../src/ui/header-footer-dialog';
import { defaultMaster } from '../src/deck/deck';

(HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; };

const q = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const spot = (pic: string, k: string) => q<HTMLElement>(`${pic} .hf-${k}`);

describe('previewBox', () => {
  it('shows only the places that have text, and names them for a screen reader', () => {
    const p = previewBox('hf-preview hf-slide', 'Where they go on a slide');
    p.set({ bl: '22/11/2026', bc: '', br: '1' });
    const t = (k: string) => p.box.querySelector<HTMLElement>(`.hf-${k}`)!;
    expect(t('bl').textContent).toBe('22/11/2026');
    expect(t('bl').hidden).toBe(false);
    expect(t('bc').hidden).toBe(true);
    expect(t('br').textContent).toBe('1');
    expect(p.box.getAttribute('aria-label')).toBe('Where they go on a slide: bottom left 22/11/2026, bottom right 1');
    p.set({});
    expect(p.box.getAttribute('aria-label')).toBe('Where they go on a slide: none');
  });
});

describe('Header and Footer window', () => {
  it('has no help line of its own; the "i" by the title says what Apply and Apply to All do', async () => {
    const m = { ...defaultMaster(), footer: 'Smith group' };
    const got = editHeaderFooter(m, { layout: 'title-content' }, 3);
    const d = q<HTMLDialogElement>('dialog.hf-dialog');
    expect(d.querySelector('.hf-note')).toBeNull();
    expect([...d.querySelectorAll('p')].filter((p) => !p.classList.contains('ask-buttons'))).toEqual([]);
    const info = d.querySelector('h2 .info-icon, h2 + .info-icon, h2 [data-tip]');
    expect(info).toBeTruthy();
    expect(d.textContent).not.toContain('Slides show');
    expect(d.querySelector('h2')!.parentElement!.innerHTML).toContain('the 3 selected slides');
    // the footer typed shows bottom middle; the slide number bottom right when checked
    const boxes = [...d.querySelectorAll<HTMLInputElement>('.hf-page:not(.hf-notes) input[type=checkbox]')];
    const footText = [...d.querySelectorAll<HTMLInputElement>('input[type=text]')].find((i) => i.value === 'Smith group')!;
    footText.value = 'Jones lab';
    footText.dispatchEvent(new Event('input', { bubbles: true }));
    expect(spot('.hf-slide', 'bc').textContent).toBe('Jones lab');
    const number = boxes.find((b) => b.parentElement!.textContent!.includes('Slide number'))!;
    number.checked = true;
    number.dispatchEvent(new Event('change', { bubbles: true }));
    expect(spot('.hf-slide', 'br').textContent).toBe('1');
    number.checked = false;
    number.dispatchEvent(new Event('change', { bubbles: true }));
    expect(spot('.hf-slide', 'br').hidden).toBe(true);
    // the notes page: header top left
    const header = [...d.querySelectorAll<HTMLLabelElement>('label.hf-check')].find((l) => l.textContent!.trim() === 'Header')!;
    const headerText = header.parentElement!.querySelector<HTMLInputElement>('input[type=text]')!;
    headerText.value = 'Group meeting';
    headerText.dispatchEvent(new Event('input', { bubbles: true }));
    expect(spot('.hf-notes', 'tl').textContent).toBe('Group meeting');
    d.querySelector<HTMLButtonElement>('.ask-buttons button')!.click(); // Cancel
    expect(await got).toBeNull();
  });
});
