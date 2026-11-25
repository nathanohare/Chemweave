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

const pic = (link: string, i: number) => ({ kind: 'picture', x1: 100 + i * 150, y1: 100, x2: 200 + i * 150, y2: 200, src: DOT, px: { w: 1, h: 1 }, link }) as Omit<Shape, 'id'>;

/** A deck of a blank slide, a slide with pictures linked as given, and a third slide (a link's target); and, if given, pictures on the master linked so. */
async function deckWith(links: string[], onMaster: string[] = []): Promise<{ parts: Record<string, Uint8Array>; third: number; data: DeckData }> {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.addSlide('blank');
  host.edit('x', () => { links.forEach((link, i) => host.addShape(pic(link, i))); });
  d.addSlide('blank');
  const m = new Doc();
  m.edit('x', () => { onMaster.forEach((link, i) => m.addShape(pic(link, i))); });
  const master = onMaster.length ? { ...d.master, items: m.contents() } : d.master;
  const data: DeckData = { size: d.size, master, slides: d.slides.map((s, i) => ({ id: s.id ?? i + 1, layout: s.layout, doc: d.docOf(i), notes: s.notes })) };
  return { parts: unzipSync(await writePptx(data, opts)), third: data.slides[2].id, data };
}
/** The third slide's id in these decks (slides numbered 1, 2, 3). */
const third0 = 3;
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

  it('to a slide, on the master, goes to the slide part itself (no part that isn\'t there)', async () => {
    const { parts } = await deckWith([], [`#slide=${third0}`]);
    const rels = Object.keys(parts).filter((k) => /slideMasters\/_rels\//.test(k)).map((k) => strFromU8(parts[k])).join('');
    const target = /Type="[^"]*\/slide" Target="([^"]+)"/.exec(rels)?.[1];
    expect(target).toBe('../slides/slide3.xml');
  });

  it('is the same on a second save, and one link on two pictures is one relationship', async () => {
    const { parts, data } = await deckWith(['https://example.com/x', 'https://example.com/x']);
    const rels = strFromU8(parts['ppt/slides/_rels/slide2.xml.rels']);
    expect(rels.match(/Target="https:\/\/example\.com\/x"/g)).toHaveLength(1);
    const read = readPptx(zipSync(parts));
    const doc2 = new Doc();
    doc2.restoreContents(read.slides[1].contents);
    const again = unzipSync(await writePptx({ ...data, slides: [data.slides[0], { ...data.slides[1], doc: doc2 }, data.slides[2]] }, opts));
    const links = (x: string) => x.match(/<a:hlinkClick [^>]*\/>/g);
    expect(links(strFromU8(again[SLIDE2]))).toEqual(links(strFromU8(parts[SLIDE2])));
  });

  it('to a slide goes to that slide; a picture without one has none', async () => {
    // (the third slide's id: the deck's slides are numbered 1, 2, 3 here)
    const { parts } = await deckWith([`#slide=${third0}`, '']);
    const x = strFromU8(parts[SLIDE2]);
    expect(x).toContain('action="ppaction://hlinksldjump"');
    expect(strFromU8(parts['ppt/slides/_rels/slide2.xml.rels'])).toMatch(/Target="slide3\.xml"/);
    expect(x.match(/hlinkClick/g)).toHaveLength(1);
    const links = picsOf(zipSync(parts)).map((p) => p.link);
    expect(links).toContain(undefined);
    expect(links.filter(Boolean)).toHaveLength(1);
  });
});
