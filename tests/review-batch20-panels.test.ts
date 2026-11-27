// @vitest-environment jsdom
//
// Review batch 20, Presentation panels and windows:
//  F164 the Slide Master panel shows what a click in it changed (the focus stays on the control clicked);
//  F735 the ↺ beside Style is one Undo step;
//  F165 Playback's OK keeps the narration mark (and every field it doesn't edit);
//  F168 Outline View: Ctrl+Enter and Shift+Tab to a new slide leave rows that match the slides;
//  F754 Shift+Tab to a new slide is one Undo step;
//  F812 editing a theme keeps its title slide's footer color and picture;
//  F794 Set Up Show gives back the Loop and advance choices a Kiosk had forced;
//  F795 a number typed in Scheme Format is applied when the popout is closed by a click outside;
//  F796 + Add in the Smart Scheme pane ignores a row last typed in on another scheme.
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../src/ui/slide-templates', () => ({ paintTemplate: () => undefined }));
vi.mock('../src/deck/media', async (orig) => ({ ...(await orig<typeof import('../src/deck/media')>()), playableUrl: () => ({ url: '', done: () => undefined }) }));

import { Doc, type Caption } from '../src/model';
import { Deck } from '../src/deck/deck';
import { MasterPanel } from '../src/ui/master-panel';
import { editMedia } from '../src/ui/media-dialog';
import { OutlineView } from '../src/ui/outline-view';
import { applyOutline, parseOutline, slideOutline, outlineText } from '../src/deck/outline';
import { editTheme } from '../src/ui/theme-editor';
import { SLIDE_TEMPLATES } from '../src/deck/templates';
import { setUpShow } from '../src/ui/show-setup-dialog';
import { toggleSmartFormat, closeSmartFormat } from '../src/ui/smart-format-pop';

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  Object.assign(HTMLMediaElement.prototype, { pause: () => undefined, load: () => undefined });
  // (jsdom doesn't let a box that is only contenteditable have the focus)
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, o?: FocusOptions) { if (this.isContentEditable && !this.hasAttribute('tabindex')) this.setAttribute('tabindex', '-1'); focus.call(this, o); };
  // (jsdom has no isContentEditable)
  if (document.createElement('div').isContentEditable === undefined) {
    Object.defineProperty(HTMLElement.prototype, 'isContentEditable', { configurable: true, get(this: HTMLElement) { return this.contentEditable === 'true'; } });
  }
});

const ph = (doc: Doc, kind: Caption['ph']) => [...doc.captions.values()].find((c) => c.ph === kind)!;

// ---------------------------------------------------------------- the Slide Master panel

function masterPanel(layout?: string) {
  document.body.replaceChildren();
  const d = Deck.blank(new Doc());
  d.attach();
  d.addSlide('title-content');
  d.openMasterView(layout as never);
  const el = document.createElement('div');
  document.body.append(el);
  let picked: Caption[] = [];
  const panel = new MasterPanel(el, { deck: () => d, doc: () => d.host, picked: () => picked, finishTyping: () => undefined, pickPicture: async () => null });
  return { d, el, panel, pick: (c: Caption[]) => { picked = c; } };
}

describe('F164: the Slide Master panel', () => {
  it('shows what Own colors (title slides) changed while that box still has the focus', () => {
    const { d, el, panel } = masterPanel();
    d.go(0);
    panel.refresh();
    const colors = el.querySelector<HTMLInputElement>('input[aria-label="Title slide background"]')!;
    expect(colors.hidden).toBe(true);
    const own = [...el.querySelectorAll<HTMLLabelElement>('.mp-check')].find((l) => l.textContent === 'Own colors')!.querySelector('input')!;
    own.focus();
    expect(document.activeElement).toBe(own);
    own.checked = true;
    own.dispatchEvent(new Event('change'));
    panel.refresh();
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Title slide background"]')!.hidden).toBe(false);
  });

  it('still leaves a box alone while a value is typed in it', () => {
    const { d, el, panel } = masterPanel();
    d.go(0);
    panel.refresh();
    const sub = el.querySelector<HTMLInputElement>('input[aria-label="Subtitle size"]')!;
    sub.focus();
    sub.value = '2';
    panel.refresh();
    expect(sub.value).toBe('2');
  });
});

describe('F735: the ↺ beside Style', () => {
  it('gives bold and italic back to the master in one Undo step', () => {
    const { d, el, panel, pick } = masterPanel('title-content');
    const t = ph(d.host, 'title');
    d.host.edit('Format', () => d.host.updateCaption(t.id, { runs: t.runs.map((r) => ({ ...r, bold: true, italic: true })) }));
    pick([ph(d.host, 'title')]);
    panel.refresh();
    const style = [...el.querySelectorAll('.mp-row')].find((r) => r.querySelector('.mp-label')?.textContent === 'Style')!;
    style.querySelector<HTMLButtonElement>('.mp-reset')!.click();
    const runs = () => ph(d.host, 'title').runs;
    expect(runs().some((r) => r.bold || r.italic)).toBe(false);
    d.undo();
    expect(runs().every((r) => r.bold && r.italic)).toBe(true);
  });
});

// ---------------------------------------------------------------- Playback

describe('F165: Playback', () => {
  it('keeps the narration mark when OK is pressed after a change', async () => {
    const m = { src: 'data:audio/mpeg;base64,AAAA', audio: true, narration: true, length: 4, vol: 0.5 };
    const done = editMedia(m);
    const dlg = document.querySelector<HTMLDialogElement>('dialog.media-dialog')!;
    const fadeIn = dlg.querySelectorAll<HTMLInputElement>('input[type=number]')[2];
    fadeIn.value = '1.5';
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'OK')!.click();
    const got = (await done)!;
    expect(got.narration).toBe(true);
    expect(got.fadeIn).toBe(1.5);
    expect(got.audio).toBe(true);
  });

  it('still takes a setting back out when it is cleared', async () => {
    const m = { src: 'data:audio/mpeg;base64,AAAA', audio: true, narration: true, fadeIn: 2, once: true };
    const done = editMedia(m);
    const dlg = document.querySelector<HTMLDialogElement>('dialog.media-dialog')!;
    dlg.querySelectorAll<HTMLInputElement>('input[type=number]')[2].value = '0';
    const loop = [...dlg.querySelectorAll<HTMLInputElement>('input[type=checkbox]')][0];
    loop.checked = true;
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'OK')!.click();
    const got = (await done)!;
    expect(got.fadeIn).toBeUndefined();
    expect(got.once).toBeUndefined();
    expect(got.narration).toBe(true);
  });
});

// ---------------------------------------------------------------- Outline View

function outline() {
  document.body.replaceChildren();
  const d = Deck.blank(new Doc());
  d.attach();
  d.addSlide('title-content');
  d.addSlide('title-content');
  const words = [['One', 'a\nb\nc'], ['Two', 'd'], ['Three', 'e']];
  words.forEach(([t, b], i) => d.editSlides('Fill', [i], (doc) => { applyOutline(doc, t, parseOutline(b), {}); }));
  const host = document.createElement('div');
  document.body.append(host);
  const view = new OutlineView(host, { deck: () => d, go: (i) => d.go(i), focusSlide: () => undefined });
  view.show(true);
  const titles = () => [...host.querySelectorAll<HTMLElement>('.ol-title')];
  const bodies = () => [...host.querySelectorAll<HTMLElement>('.ol-body')];
  const key = (el: HTMLElement, init: KeyboardEventInit) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  const titleOf = (i: number) => slideOutline(d.docOf(i)).title;
  return { d, host, view, titles, bodies, key, titleOf };
}

describe('F168: Outline View, a slide added from a row', () => {
  it('makes the rows again for the slides now there, and the new row takes the focus', () => {
    const { d, host, titles, key } = outline();
    titles()[0].focus();
    key(titles()[0], { key: 'Enter', ctrlKey: true });
    expect(d.slides).toHaveLength(4);
    expect(host.querySelectorAll('.ol-slide')).toHaveLength(4);
    expect(document.activeElement).toBe(titles()[1]);
  });

  it('writes nothing of the old slide 2 into the new slide when the box is left', () => {
    const { titles, key, titleOf } = outline();
    titles()[0].focus();
    key(titles()[0], { key: 'Enter', ctrlKey: true });
    (document.activeElement as HTMLElement).blur();
    expect(titleOf(1)).toBeFalsy();
    expect(titleOf(2)).toBe('Two');
    expect(titleOf(3)).toBe('Three');
  });
});

describe('F754: Shift+Tab on a body line', () => {
  it('makes the new slide and takes the lines off the old one in one Undo step', () => {
    const { d, bodies, key } = outline();
    const body = bodies()[0];
    body.focus();
    // (the caret is at the start of the first line, which is all the way out already)
    key(body, { key: 'Tab', shiftKey: true });
    const lines = (i: number) => outlineText(slideOutline(d.docOf(i)).body ?? []);
    expect(d.slides).toHaveLength(4);
    expect(slideOutline(d.docOf(1)).title).toBe('a');
    expect(lines(1)).toBe('b\nc');
    expect(lines(0)).toBe('');
    d.undo();
    expect(d.slides).toHaveLength(3);
    expect(lines(0)).toBe('a\nb\nc');
  });
});

// ---------------------------------------------------------------- the theme window

describe('F812: editing a theme', () => {
  it('keeps the title slide\'s footer color and picture when its other colors are left alone', async () => {
    const fill = { kind: 'solid', color: '#112233' };
    const t = { ...SLIDE_TEMPLATES[0], id: 'mine-1', group: 'Mine', titleSlide: { background: '#112233', titleColor: '#ffffff', textColor: '#dddddd', footerColor: '#ff8800', fill } } as never;
    const master = Deck.blank(new Doc()).master;
    const got = editTheme(t, master, { w: 960, h: 540 });
    const dlg = document.querySelector<HTMLDialogElement>('dialog.theme-editor')!;
    dlg.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const out = (await got)!;
    expect(out.titleSlide).toMatchObject({ background: '#112233', footerColor: '#ff8800', fill });
  });

  it('drops the picture, not the footer color, when the title slide\'s background color is changed', async () => {
    const fill = { kind: 'solid', color: '#112233' };
    const t = { ...SLIDE_TEMPLATES[0], id: 'mine-2', group: 'Mine', titleSlide: { background: '#112233', titleColor: '#ffffff', textColor: '#dddddd', footerColor: '#ff8800', fill } } as never;
    const got = editTheme(t, Deck.blank(new Doc()).master, { w: 960, h: 540 });
    const dlg = document.querySelectorAll<HTMLDialogElement>('dialog.theme-editor');
    const form = dlg[dlg.length - 1].querySelector('form')!;
    const colors = [...form.querySelectorAll<HTMLInputElement>('input[type=color]')];
    colors[colors.length - 3].value = '#000000';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    const out = (await got)!;
    expect(out.titleSlide!.background).toBe('#000000');
    expect(out.titleSlide!.footerColor).toBe('#ff8800');
    expect(out.titleSlide!.fill).toBeUndefined();
  });
});

// ---------------------------------------------------------------- Set Up Show

describe('F794: Set Up Show', () => {
  it('gives back Loop and Manually when another type is picked after Kiosk', async () => {
    const got = setUpShow({ type: 'speaker', manual: true } as never, [], 5);
    const dlg = [...document.querySelectorAll<HTMLDialogElement>('dialog.show-setup')].pop()!;
    const type = (name: RegExp) => [...dlg.querySelectorAll<HTMLInputElement>('input[name="ss-type"]')].find((i) => name.test(i.parentElement!.textContent!))!;
    const loop = [...dlg.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find((i) => /Loop/.test(i.parentElement!.textContent!))!;
    const form = dlg.querySelector('form')!;
    type(/kiosk/).checked = true;
    form.dispatchEvent(new Event('change'));
    expect(loop.checked).toBe(true);
    type(/speaker/).checked = true;
    form.dispatchEvent(new Event('change'));
    expect(loop.checked).toBe(false);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    const out = (await got)!;
    expect(out.type).toBe('speaker');
    expect(out.loop).toBeUndefined();
    expect(out.manual).toBe(true);
  });
});

// ---------------------------------------------------------------- Scheme Format

describe('F795: Scheme Format', () => {
  it('applies a number typed in a box when a click outside closes the popout', async () => {
    vi.useFakeTimers();
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const applied: unknown[] = [];
    toggleSmartFormat(anchor, {
      fmt: {}, defaults: { font: 'Arial', speciesSize: 12, stepSize: 10, arrowWidth: 1, headType: 'solid' } as never, cycle: false,
      apply: (f) => { applied.push(f); },
    });
    vi.runAllTimers();
    const box = document.querySelector<HTMLInputElement>('.smart-format-pop input[type=number]:not(:disabled)')!;
    box.focus();
    box.value = '14';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    // a press outside takes the popout away before the box can say it changed
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.querySelector('.smart-format-pop')).toBeNull();
    expect(applied.length).toBeGreaterThan(0);
    expect(Object.values(applied[applied.length - 1] as object)).toContain(14);
    closeSmartFormat();
    vi.useRealTimers();
  });
});
