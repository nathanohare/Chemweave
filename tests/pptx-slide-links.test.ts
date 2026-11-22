// @vitest-environment jsdom
//
// A slide's objects that name each other across the parts a slide is saved in (deck/split-slide.ts:
// texts, plain shapes, connectors, drawings), kept through PowerPoint: the slide's links tag
// names them by the ids saved on each part, and they are found again on reading
// (pptx-read.ts restoreLinks) only when everything they name came back (standing rule R3). Also a
// plain shape's own settings (name, hidden) in its tag, with PowerPoint's own look winning where
// it was changed there, and a video's settings PowerPoint keeps nowhere of its own. Slides are
// built here in code; the PNG is a bare signature and header written by hand to the PNG
// specification (W3C, 2003), enough for its size to be read.

import { describe, it, expect } from 'vitest';
import { Doc, type Arrow, type Contents } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const PNG_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
const opts: PptxOptions = { async picture(d) { const b = d.bounds(); return b ? { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: b } : null; }, async svgToPng() { return PNG; } };
const ARROW: Omit<Arrow, 'id'> = { tail: { x: 0, y: 200 }, head: { x: 80, y: 200 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 };

async function trip(d: Doc): Promise<Contents> {
  const deck = Deck.design(new Doc(), { w: 720, h: 405 });
  const slide = new Doc();
  slide.restoreContents(d.contents());
  const back = readPptx(await writePptx({ size: deck.size, master: deck.master, slides: [{ layout: 'blank', doc: slide, notes: '' }] }, opts));
  return back.slides[0].contents;
}

describe('links between a slide\'s parts (R3)', () => {
  it('keep a frame\'s members and a reagent arrow\'s step through PowerPoint', async () => {
    const d = new Doc();
    d.bulk(() => {
      const box = d.addShape({ kind: 'rect', x1: 300, y1: 100, x2: 360, y2: 140 });
      const c = d.addCaption({ x: 300, y: 60, runs: [{ text: 'a note' }], justify: 'left' });
      const main = d.addArrow({ ...ARROW });
      d.addArrow({ ...ARROW, tail: { x: 0, y: 260 }, head: { x: 80, y: 260 }, reagentFor: main.id });
      d.addShape({ kind: 'rect', x1: 280, y1: 40, x2: 380, y2: 160, frame: { atoms: [], captions: [c.id], arrows: [], shapes: [box.id], padX: 4, padY: 4, fit: false } });
    });
    const back = await trip(d);
    const frame = back.shapes.find((s) => s.frame)?.frame;
    const box = back.shapes.find((s) => !s.frame && s.kind === 'rect');
    expect(frame?.shapes).toEqual([box!.id]);
    expect(frame?.captions).toEqual([back.captions[0].id]);
    const feeder = back.arrows.find((r) => r.reagentFor !== undefined);
    expect(back.arrows.map((r) => r.id)).toContain(feeder?.reagentFor);
    expect(feeder?.reagentFor).not.toBe(feeder?.id);
  });
});

describe('a plain shape\'s own settings (R3)', () => {
  it('come back with its name and hidden', async () => {
    const d = new Doc();
    d.bulk(() => d.addShape({ kind: 'rect', x1: 10, y1: 10, x2: 90, y2: 50, name: 'Box 1', hidden: true }));
    const s = (await trip(d)).shapes[0];
    expect([s.name, s.hidden]).toEqual(['Box 1', true]);
  });
});

describe('a video\'s settings PowerPoint keeps nowhere of its own (R3)', () => {
  it('come back with its length and Rewind after Playing', async () => {
    const d = new Doc();
    d.bulk(() => d.addShape({ kind: 'picture', x1: 0, y1: 0, x2: 160, y2: 90, src: PNG_URL, video: { src: 'data:video/mp4;base64,AAAA', length: 12.5, rewind: true } }));
    const v = (await trip(d)).shapes.find((s) => s.video)?.video;
    expect([v?.length, v?.rewind]).toEqual([12.5, true]);
  });
});

describe('a slide\'s own Footer switch on a master with no footer text (R3)', () => {
  for (const footer of [true, false]) {
    it(`comes back ${footer ? 'on' : 'off'}`, async () => {
      const deck = Deck.design(new Doc(), { w: 720, h: 405 });
      expect(deck.master.footer.trim()).toBe('');
      const back = readPptx(await writePptx({ size: deck.size, master: deck.master, slides: [{ layout: 'blank', doc: new Doc(), notes: '', hf: { footer } }] }, opts));
      expect(back.slides[0].hf?.footer).toBe(footer);
    });
  }
});
