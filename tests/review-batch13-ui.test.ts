// @vitest-environment jsdom
//
// Code review batch 13 (presentations), the smaller findings: the rulers and guides, the Slide
// Size window, the Font group of the Slides ribbon, times and notes, the narration recorder, a
// tiled background picture, Slide Master text, items on the master and ChemDraw objects of text.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// A picture the background code is given (a loaded one), so a tiled background has something to tile.
const loaded = vi.hoisted(() => ({ img: { naturalWidth: 4, naturalHeight: 2 } }));
vi.mock('../src/render/images', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/render/images')>();
  return { ...real, imageFor: (src: string) => (src === 'tile.png' ? (loaded.img as unknown as HTMLImageElement) : real.imageFor(src)) };
});

import { Doc, type Caption } from '../src/model';
import { Deck, textStyles } from '../src/deck/deck';
import { rulerLabel, guidePoint } from '../src/ui/slide-guides';
import { pickSlideSize } from '../src/ui/slide-size-dialog';
import { SlideTextRibbon, type SlideTextHooks, type TextLook } from '../src/ui/slide-text-ribbon';
import { mediaTime } from '../src/deck/media';
import { Recorder } from '../src/deck/narration';
import { bulletEdits, NOTE_BULLET } from '../src/deck/notes-look';
import { paintBackground, type Background } from '../src/deck/background';
import { drawSlidePage } from '../src/deck/slide-view';
import { splitSlide } from '../src/deck/split-slide';

describe('F836: numbers on a ruler', () => {
  it('writes eighths of an inch as they are', () => {
    expect(rulerLabel(2.25)).toBe('2.25');
    expect(rulerLabel(1.375)).toBe('1.375');
    expect(rulerLabel(3)).toBe('3');
    expect(rulerLabel(0.5)).toBe('0.5');
  });
});

describe('F837: a guide typed into Grid and Guides', () => {
  it('is read in the units and from the origin the window showed', () => {
    const size = { w: 960, h: 540 };
    // 1 in = 72 pt (the point is 1/72 in); 1 cm = 72 / 2.54 pt
    expect(guidePoint('1', 'x', { units: 'in', from: 'corner' }, size)).toBe(72);
    expect(guidePoint('1', 'x', { units: 'in', from: 'centre' }, size)).toBe(480 + 72);
    expect(guidePoint('-1', 'y', { units: 'in', from: 'centre' }, size)).toBe(270 - 72);
    expect(guidePoint('2.54', 'x', { units: 'cm', from: 'corner' }, size)).toBeCloseTo(72, 9);
    expect(guidePoint('', 'x', { units: 'in', from: 'corner' }, size)).toBeNull();
    expect(guidePoint('abc', 'x', { units: 'in', from: 'corner' }, size)).toBeNull();
  });
});

describe('F840: the Slide Size window', () => {
  beforeEach(() => {
    // (jsdom has no modal dialogs)
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    document.body.innerHTML = '';
  });

  it('keeps the width as it is when only the height is typed (13.33 in shown is not 960 pt)', async () => {
    const got = pickSlideSize({ w: 960, h: 540 });
    const dlg = document.querySelector('dialog')!;
    const [w, h] = [...dlg.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(w.value).toBe('13.33');
    h.value = '6';
    h.dispatchEvent(new Event('change'));
    dlg.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const r = await got;
    expect(r!.size).toEqual({ w: 960, h: 432 });
  });
});

describe('F841 and F842: the Font group of the Slides ribbon', () => {
  let root = document.createElement('div');
  const fresh = () => {
    root = document.createElement('div');
    root.innerHTML = '<input data-tx="font"><input data-tx="size"><input type="color" data-tx="colour">'
    + '<select data-tx="line"><option value="1">1</option></select><select data-tx="spacing"><option value="0">0</option></select>'
    + '<select data-tx="dir"><option value="horz">h</option></select><select data-tx="cols"><option value="1">1</option></select><select data-tx="fit"><option value="grow">g</option></select>';
    document.body.append(root);
  };
  const q = (k: string) => root.querySelector<HTMLInputElement>(`[data-tx="${k}"]`)!;

  function ribbon(look: TextLook) {
    fresh();
    const formats: unknown[] = [];
    let ribbonRef: SlideTextRibbon | null = null;
    const hooks: SlideTextHooks = {
      format: (f) => { formats.push(f); return true; },
      look: () => look,
      // the keyboard goes back to the text: the box loses it, and a box whose text changed says so
      refocus: () => { const el = document.activeElement as HTMLElement | null; if (el && root.contains(el)) { el.blur(); el.dispatchEvent(new Event('change')); } },
      nothing: () => undefined, say: () => undefined, box: () => true, boxLook: () => null,
    };
    ribbonRef = new SlideTextRibbon(root, hooks);
    return { formats, ribbon: ribbonRef };
  }

  it('says black when the text of the template is white (no color of its own would show white)', () => {
    const white = ribbon({ style: {}, align: 'left', line: 1, defaultSize: 18, defaultColor: '#ffffff' });
    const c = q('colour');
    c.value = '#000000';
    c.dispatchEvent(new Event('change'));
    expect(white.formats.at(-1)).toEqual({ kind: 'style', patch: { color: '#000000' } });
    // and the box shows the color the text has
    white.ribbon.refresh();
    expect(c.value).toBe('#ffffff');
  });

  it('leaves black as "no color of its own" where the text is black anyway', () => {
    const black = ribbon({ style: {}, align: 'left', line: 1, defaultSize: 18 });
    const c = q('colour');
    c.value = '#000000';
    c.dispatchEvent(new Event('change'));
    expect(black.formats.at(-1)).toEqual({ kind: 'style', patch: { color: undefined } });
  });

  it('does not apply a size typed and then given up with Esc', () => {
    const r = ribbon({ style: {}, align: 'left', line: 1, defaultSize: 18 });
    const size = q('size');
    r.ribbon.refresh();
    expect(size.value).toBe('18');
    const before = r.formats.length;
    size.focus();
    size.value = '99';
    size.dispatchEvent(new Event('input'));
    size.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(size.value).toBe('18');
    expect(r.formats.length).toBe(before);
    // typed again and entered, it applies
    size.focus();
    size.value = '24';
    size.dispatchEvent(new Event('input'));
    size.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(r.formats.at(-1)).toEqual({ kind: 'style', patch: { size: 24 } });
  });
});

describe('F857: a length as a clock with tenths', () => {
  it('carries a rounded-up tenth into the seconds, and the seconds into the minutes', () => {
    expect(mediaTime(59.96)).toBe('1:00.0');
    expect(mediaTime(9.97)).toBe('0:10.0');
    expect(mediaTime(119.98)).toBe('2:00.0');
    expect(mediaTime(75.25)).toBe('1:15.3');
  });
});

describe('F858: a narration recorder the browser has stopped by itself', () => {
  it('still gives what it caught', async () => {
    let made: FakeRecorder | null = null;
    let stops = 0;
    class FakeRecorder {
      state: 'inactive' | 'recording' | 'paused' = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor() { made = this; }
      start() { this.state = 'recording'; }
      stop() { stops++; this.state = 'inactive'; }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } });
    const r = new Recorder();
    expect(await r.open()).toBe(true);
    r.start();
    // the microphone was unplugged: the browser stopped it, with the data
    made!.state = 'inactive';
    made!.ondataavailable?.({ data: new Blob(['said']) });
    made!.onstop?.();
    const got = await r.finish();
    expect(got).toBeInstanceOf(Blob);
    expect(stops).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe('F859 and F860: bullets in the notes', () => {
  const apply = (t: string, s: number, e: number) => bulletEdits(t, s, e).reduce((x, d) => x.slice(0, d.at) + d.insert + x.slice(d.at + d.remove), t);

  it('leaves a line alone when the selection ends where it starts', () => {
    // "ab\n" selected: the line after it has none of the selection
    expect(apply('ab\ncd', 0, 3)).toBe(`${NOTE_BULLET}ab\ncd`);
  });

  it('bullets the first line when the caret is at the very start of an empty one', () => {
    expect(apply('\nab', 0, 0)).toBe(`${NOTE_BULLET}\nab`);
  });
});

describe('F847: a tiled background picture with mirrored tiles', () => {
  it('makes the mirrored tile once, however many times the slide is drawn', () => {
    const ctx = new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as CanvasRenderingContext2D;
    (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx;
    const bg: Background = { kind: 'picture', src: 'tile.png', px: { w: 4, h: 2 }, fit: 'tile', transparency: 0, tile: { sx: 1, sy: 1, tx: 0, ty: 0, align: 'tl', mirror: 'x' } };
    const create = document.createElement.bind(document);
    let canvases = 0;
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string, o?: ElementCreationOptions) => { if (tag === 'canvas') canvases++; return create(tag, o); }) as typeof document.createElement);
    for (let i = 0; i < 5; i++) paintBackground(ctx, bg, 960, 540);
    spy.mockRestore();
    expect(canvases).toBe(1);
  });
});

const ph = (doc: Doc, kind: Caption['ph']) => [...doc.captions.values()].find((c) => c.ph === kind)!;

describe('F856: bold body text on the slide master', () => {
  it('is the master\'s body text, on the layouts and after closing the master view', () => {
    const d = Deck.blank(new Doc());
    d.attach();
    d.addSlide('title-content');
    d.openMasterView();
    d.go(0);
    const b = ph(d.host, 'body');
    d.host.edit('Format', () => d.host.updateCaption(b.id, { runs: b.runs.map((r) => ({ ...r, bold: true })) }));
    d.closeMasterView();
    expect(d.master.phFmt?.body?.bold).toBe(true);
    expect(textStyles(d.master, 'title-content').body.bold).toBe(true);
    // and the title's bold stays the master's title bold
    expect(d.master.phFmt?.title?.bold).toBeUndefined();
  });
});

describe('F868: what is drawn on the master follows the master\'s drawing style', () => {
  it('is drawn with the line width the master has now', () => {
    const items = new Doc();
    items.edit('Arrow', () => { items.addArrow({ headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5, tail: { x: 100, y: 100 }, head: { x: 300, y: 100 } } as never); });
    const d = Deck.blank(new Doc());
    d.attach();
    d.setLayout('blank');
    const widths: number[] = [];
    const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: (_, k, v) => { if (k === 'lineWidth') widths.push(v as number); return true; } }) as unknown as CanvasRenderingContext2D;
    const page = d.page(0);
    const was = { ...page, master: { ...page.master, items: items.contents(), drawing: { ...page.master.drawing, lineWidth: 1 } } };
    drawSlidePage(ctx, was);
    const first = Math.max(...widths);
    widths.length = 0;
    // the same items under a master with a heavier line
    drawSlidePage(ctx, { ...was, master: { ...was.master, drawing: { ...was.master.drawing, lineWidth: 6 } } });
    expect(Math.max(...widths)).toBeGreaterThan(first);
  });
});

describe('F869: slides\' drawings in reading order', () => {
  it('puts a ChemDraw object that is only text where its text is', () => {
    const doc = new Doc();
    doc.edit('make', () => {
      const a = doc.addAtom(100, 400), b = doc.addAtom(130, 400);
      doc.addBond(a.id, b.id);
      doc.addCaption({ x: 500, y: 50, runs: [{ text: 'Scheme 1' }], ole: { id: 7, prog: 'ChemDraw.Document.6.0' } } as never);
    });
    const { drawings } = splitSlide(doc);
    expect(drawings).toHaveLength(2);
    expect(drawings[0].captions.size).toBe(1);
    expect(drawings[1].atoms.size).toBe(2);
  });
});
