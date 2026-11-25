// @vitest-environment jsdom
//
// A link on a picture (a click on it goes to a web page, a file or a slide) is kept when the deck is
// saved, as PowerPoint writes it on the picture's cNvPr.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import { Doc, type Shape } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type DeckData, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
const SLIDE2 = 'ppt/slides/slide2.xml';

/** A deck of a blank slide, a slide with pictures linked as given, and a third slide (a link's target). */
async function deckWith(links: string[]): Promise<{ parts: Record<string, Uint8Array>; third: number }> {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.addSlide('blank');
  host.edit('x', () => {
    links.forEach((link, i) => host.addShape({ kind: 'picture', x1: 100 + i * 150, y1: 100, x2: 200 + i * 150, y2: 200, src: DOT, px: { w: 1, h: 1 }, link } as Omit<Shape, 'id'>));
  });
  d.addSlide('blank');
  const data: DeckData = { size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ id: s.id ?? i + 1, layout: s.layout, doc: d.docOf(i), notes: s.notes })) };
  return { parts: unzipSync(await writePptx(data, opts)), third: data.slides[2].id };
}
const picsOf = (bytes: Uint8Array) => [...readPptx(bytes).slides[1].contents.shapes.values()].filter((s) => s.kind === 'picture');

describe("a picture's link", () => {
  it('is written on its cNvPr, by a relationship, and read back', async () => {
    const { parts } = await deckWith(['https://example.com/a?x=1&y=2', '#next']);
    const x = strFromU8(parts[SLIDE2]);
    expect(x).toMatch(/<p:pic><p:nvPicPr><p:cNvPr [^>]*><a:hlinkClick r:id="rId\d+"\/><\/p:cNvPr>/);
    expect(x).toContain('action="ppaction://hlinkshowjump?jump=nextslide"');
    const rels = strFromU8(parts['ppt/slides/_rels/slide2.xml.rels']);
    expect(rels).toContain('Target="https://example.com/a?x=1&amp;y=2" TargetMode="External"');
    expect(picsOf(zipSync(parts)).map((p) => p.link).sort()).toEqual(['#next', 'https://example.com/a?x=1&y=2']);
  });

  it('to a slide goes to that slide; a picture without one has none', async () => {
    // (the third slide's id: the deck's slides are numbered 1, 2, 3 here)
    const { parts } = await deckWith(['#slide=3', '']);
    const x = strFromU8(parts[SLIDE2]);
    expect(x).toContain('action="ppaction://hlinksldjump"');
    expect(strFromU8(parts['ppt/slides/_rels/slide2.xml.rels'])).toMatch(/Target="slide3\.xml"/);
    expect(x.match(/hlinkClick/g)).toHaveLength(1);
    const links = picsOf(zipSync(parts)).map((p) => p.link);
    expect(links).toContain(undefined);
    expect(links.filter(Boolean)).toHaveLength(1);
  });
});
