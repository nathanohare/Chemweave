// @vitest-environment jsdom
//
// Outline View shows and sets bold, italic, underline and sub- and superscripts (G3-16), as
// PowerPoint's outline does: its boxes are the rich text box the cells and notes use, and what is
// set there goes onto the slide's title and body placeholders.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { applyOutline, outlineLooks, slideOutline } from '../src/deck/outline';
import { OutlineView } from '../src/ui/outline-view';

/** A title-and-content slide: "The E isomer" (E in italics) over "CH3OH" (3 lowered) and "Boron" a level in. */
function deck(): { host: Doc; d: Deck; doc: Doc } {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.setLayout('title-content');
  const doc = d.docOf(0);
  const title = [...doc.captions.values()].find((c) => c.ph === 'title')!;
  const body = [...doc.captions.values()].find((c) => c.ph === 'body')!;
  doc.edit('fill', () => {
    doc.updateCaption(title.id, { runs: [{ text: 'The ' }, { text: 'E', italic: true }, { text: ' isomer' }] });
    doc.updateCaption(body.id, { runs: [{ text: 'CH' }, { text: '3', sub: true }, { text: 'OH\nBoron' }], paras: [{ list: 'bullet' }, { list: 'bullet', level: 1 }] });
  });
  return { host, d, doc };
}
const capOf = (doc: Doc, ph: string) => [...doc.captions.values()].find((c) => c.ph === ph)!;

describe('Outline View with looks', () => {
  it('reads each character\'s look of the title and of each body line', () => {
    const { doc } = deck();
    const l = outlineLooks(doc);
    expect(l.title!.map((x) => !!x.italic)).toEqual([...'The E isomer'].map((c, i) => i === 4));
    expect(l.body!.map((line) => line.length)).toEqual([5, 5]);
    expect(l.body![0][2]).toEqual({ sub: true });
  });

  it('writes looks set in the outline onto the slide, keeping the rest', () => {
    const { doc } = deck();
    const o = slideOutline(doc);
    const l = outlineLooks(doc);
    // Boron made bold
    const body = [l.body![0], l.body![1].map((x) => ({ ...x, bold: true }))];
    let changed = false;
    doc.edit('Outline', () => { changed = applyOutline(doc, o.title, o.body, { title: l.title!, body }); });
    expect(changed).toBe(true);
    expect(capOf(doc, 'body').runs).toEqual([{ text: 'CH' }, { text: '3', sub: true }, { text: 'OH\n' }, { text: 'Boron', bold: true }]);
    // its paragraphs (bullet, level) are as they were
    expect(capOf(doc, 'body').paras).toEqual([{ list: 'bullet' }, { list: 'bullet', level: 1 }]);
    expect(capOf(doc, 'title').runs).toEqual([{ text: 'The ' }, { text: 'E', italic: true }, { text: ' isomer' }]);
    // the same again: nothing written
    const again = outlineLooks(doc);
    doc.edit('Outline', () => { changed = applyOutline(doc, o.title, o.body, { title: again.title!, body: again.body! }); });
    expect(changed).toBe(false);
  });

  it('shows the looks in its boxes, and Ctrl+B and typing there reach the slide', () => {
    const { host, d, doc } = deck();
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new OutlineView(parent, { deck: () => d, go: () => undefined, focusSlide: () => undefined });
    view.show(true);
    const title = parent.querySelector<HTMLElement>('.ol-title')!, body = parent.querySelector<HTMLElement>('.ol-body')!;
    expect(title.getAttribute('role')).toBe('textbox');
    const spans = (el: HTMLElement) => [...el.querySelectorAll('span')];
    expect(spans(title).find((s) => s.textContent === 'E')!.style.fontStyle).toBe('italic');
    expect(spans(body).find((s) => s.textContent === '3')!.style.verticalAlign).toBe('sub');
    // the level's tab shows, with no look of its own
    expect(body.textContent).toBe('CH3OH\n\tBoron');

    // "The" selected, Ctrl+B
    title.tabIndex = 0;
    title.focus();
    const first = spans(title)[0].firstChild!;
    getSelection()!.setBaseAndExtent(first, 0, first, 3);
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(capOf(doc, 'title').runs).toEqual([{ text: 'The', bold: true }, { text: ' ' }, { text: 'E', italic: true }, { text: ' isomer' }]);
    title.blur();

    // typed after Boron: the 3 stays lowered
    const last = spans(body).at(-1)!.firstChild as Text;
    last.data += ' enolates';
    body.dispatchEvent(new Event('input'));
    body.dispatchEvent(new Event('change'));
    expect(slideOutline(doc).body).toEqual([{ text: 'CH3OH', level: 0 }, { text: 'Boron enolates', level: 1 }]);
    expect(capOf(doc, 'body').runs.find((r) => r.text === '3')).toEqual({ text: '3', sub: true });
    // (each change is a step of the deck's own Undo)
    expect(host.canUndo()).toBe(true);
    view.show(false);
    parent.remove();
  });

  it('Ctrl+Z and Ctrl+Y in a box take back and bring again what was typed there', () => {
    const { d, doc } = deck();
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new OutlineView(parent, { deck: () => d, go: () => undefined, focusSlide: () => undefined });
    view.show(true);
    const body = parent.querySelector<HTMLElement>('.ol-body')!;
    body.tabIndex = 0;
    body.focus();
    const last = [...body.querySelectorAll('span')].at(-1)!.firstChild as Text;
    last.data += ' enolates';
    body.dispatchEvent(new Event('input'));
    const key = (k: string, shift = false) => body.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true }));
    key('z');
    expect(body.textContent).toBe('CH3OH\n\tBoron');
    body.dispatchEvent(new Event('change'));
    expect(slideOutline(doc).body![1].text).toBe('Boron');
    // (the 3 is still lowered in the box)
    expect([...body.querySelectorAll('span')].find((x) => x.textContent === '3')!.style.verticalAlign).toBe('sub');
    key('y');
    expect(body.textContent).toBe('CH3OH\n\tBoron enolates');
    body.blur();
    view.show(false);
    parent.remove();
  });

  it('Enter in a body box starts a new line there (review R01)', () => {
    const { d, doc } = deck();
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new OutlineView(parent, { deck: () => d, go: () => undefined, focusSlide: () => undefined });
    view.show(true);
    const body = parent.querySelector<HTMLElement>('.ol-body')!;
    body.tabIndex = 0;
    body.focus();
    const last = [...body.querySelectorAll('span')].at(-1)!.firstChild as Text;
    const r = document.createRange();
    r.setStart(last, last.data.length);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r);
    const e = new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true });
    body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    const end = [...body.querySelectorAll('span')].at(-1)!.firstChild as Text;
    end.data += '\tAldol';
    const r2 = document.createRange();
    r2.setStart(end, end.data.length);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r2);
    body.dispatchEvent(new Event('input'));
    body.dispatchEvent(new Event('change'));
    expect(slideOutline(doc).body!.map((l) => l.text)).toEqual(['CH3OH', 'Boron', 'Aldol']);
    body.blur();
    view.show(false);
    parent.remove();
  });

  it('a slide made with Shift+Tab takes its words\' looks with it', () => {
    const { d } = deck();
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new OutlineView(parent, { deck: () => d, go: () => undefined, focusSlide: () => undefined });
    view.show(true);
    const body = parent.querySelector<HTMLElement>('.ol-body')!;
    body.tabIndex = 0;
    body.focus();
    // the caret on the first line (CH3OH, all the way out): Shift+Tab makes it a slide's title
    const t = body.querySelector('span')!.firstChild!;
    getSelection()!.setBaseAndExtent(t, 1, t, 1);
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(d.slides).toHaveLength(2);
    const next = capOf(d.docOf(1), 'title');
    expect(next.runs.map((r) => r.text).join('')).toBe('CH3OH');
    expect(next.runs.find((r) => r.text === '3')?.sub).toBe(true);
    view.show(false);
    parent.remove();
  });
});
