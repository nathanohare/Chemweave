// @vitest-environment jsdom
//
// Review batch 23 (vector pictures): the recording context's scale(), and SVG pictures that are
// flipped or named in a font with an apostrophe. Every drawing here is built in the test.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Deck, WIDE } from '../src/deck/deck';
import { recordSlide } from '../src/deck/slide-view';
import { VectorContext, type Item, type ImageItem } from '../src/render/vector';
import { itemsToSvg } from '../src/render/svg';

const BOX = { x1: 0, y1: 0, x2: 200, y2: 100 };
const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

describe('the recording context scales what it records (F210)', () => {
  it('records a canvas slide, which draws its keyframe scaled into the view, without throwing', () => {
    // a keyframe twice the slide's width: the slide's own things are drawn at twice their size
    const page = { size: WIDE, master: Deck.blank(new Doc()).master, layout: 'blank' as const, index: 0, view: { x1: 960, y1: 0, x2: 960 + 2 * WIDE.w, y2: 2 * WIDE.h }, title: 'Keyframe' };
    let items: Item[] = [];
    expect(() => { items = recordSlide(page, new Doc()); }).not.toThrow();
    const title = items.find((it) => it.kind === 'text' && it.text === 'Keyframe');
    expect(title?.kind).toBe('text');
    // the master's title size, doubled with the view
    if (title?.kind === 'text') expect(title.size).toBeCloseTo(2 * page.master.titleSize);
  });

  it('scales points, line widths, text and pictures by the scale', () => {
    const ctx = new VectorContext();
    ctx.translate(10, 20);
    ctx.scale(2, 3);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(5, 5); ctx.stroke();
    ctx.font = '10px Arial';
    ctx.fillText('A', 1, 1);
    ctx.picture({ src: PIXEL, x1: 0, y1: 0, x2: 10, y2: 10 });
    const [line, text, pic] = ctx.items;
    expect(line.kind === 'path' && line.segs).toEqual([{ k: 'M', x: 10, y: 20 }, { k: 'L', x: 20, y: 35 }]);
    // a stroke grows with the square root of how much the area grows (2 × 3)
    expect(line.kind === 'path' && line.stroke?.width).toBeCloseTo(1.5 * Math.sqrt(6));
    expect(text.kind === 'text' && [text.x, text.y, text.size]).toEqual([12, 23, 30]);
    if (text.kind === 'text') {
      const plain = new VectorContext();
      plain.font = '10px Arial';
      plain.fillText('A', 0, 0);
      const w = (plain.items[0] as Extract<Item, { kind: 'text' }>).widths[0];
      expect(text.widths[0]).toBeCloseTo(2 * w);
    }
    expect(pic.kind === 'image' && [pic.x, pic.y, pic.w, pic.h]).toEqual([10, 20, 20, 30]);
  });
});

describe('SVG pictures (F209, F914)', () => {
  const picture = (extra: Partial<ImageItem>): Item => ({ kind: 'image', src: PIXEL, x: 20, y: 10, w: 40, h: 20, ...extra });

  it('flips a flipped picture about its middle, also when it is not turned', () => {
    const svg = itemsToSvg([picture({ flipH: true })], BOX);
    // SVG 1.1 §7.6: a transform list applies right to left, so the picture is mirrored about x = 40
    expect(svg).toContain('<g transform="translate(40 20) scale(-1 1) translate(-40 -20)">');
    const both = itemsToSvg([picture({ rot: 30, flipV: true })], BOX);
    expect(both).toContain('<g transform="rotate(30 40 20) translate(40 20) scale(1 -1) translate(-40 -20)">');
  });

  it('keeps a font name with an apostrophe inside its quotes', () => {
    const text: Item = { kind: 'text', text: 'Hi', x: 0, y: 50, size: 12, family: "O'Brien Sans", bold: false, italic: false, color: '#000000', widths: [6, 6] };
    const svg = itemsToSvg([text], BOX);
    // CSS 2.1 §4.3.7: a single quote inside a single-quoted string is written \'
    expect(svg).toContain(`font-family="'O\\'Brien Sans', Arial, Helvetica, sans-serif"`);
    const el = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('text')!;
    expect(el.getAttribute('font-family')).toBe("'O\\'Brien Sans', Arial, Helvetica, sans-serif");
  });
});
