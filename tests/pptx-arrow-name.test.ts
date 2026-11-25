// @vitest-environment jsdom
//
// A line or connector's name in PowerPoint's Selection Pane is kept when the deck is saved (not
// replaced by "Straight Arrow Connector N"); PowerPoint's own names aren't taken for names given.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Doc, type Arrow } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type DeckData, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', png: PNG, box: { x1: 0, y1: 0, x2: 400, y2: 300 } }; }, async svgToPng() { return PNG; } };
const SLIDE2 = 'ppt/slides/slide2.xml';

/** A deck with one slide holding these arrows. */
async function deckWith(...arrows: Partial<Arrow>[]): Promise<Record<string, Uint8Array>> {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.addSlide('blank');
  host.edit('x', () => {
    for (const a of arrows) host.addArrow({ tail: { x: 100, y: 100 }, head: { x: 300, y: 100 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 10, headWidth: 4, ppt: true, ...a } as Omit<Arrow, 'id'>);
  });
  const data: DeckData = { size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ id: i + 1, layout: s.layout, doc: d.docOf(i), notes: s.notes })) };
  return unzipSync(await writePptx(data, opts));
}
const arrowsOf = (bytes: Uint8Array) => [...readPptx(bytes).slides[1].contents.arrows.values()];

describe("a connector's name", () => {
  it('is written and read back, escaped; one without a name gets PowerPoint\'s', async () => {
    const p = await deckWith({ name: 'Step 1 → 2 & "back"' }, {});
    const x = strFromU8(p[SLIDE2]);
    expect(x).toContain('name="Step 1 → 2 &amp; &quot;back&quot;"');
    expect(x).toMatch(/name="Straight Arrow Connector \d+"/);
    const names = arrowsOf(zipSync(p)).map((a) => a.name);
    expect(names).toContain('Step 1 → 2 & "back"');
    expect(names.filter((n) => n === undefined)).toHaveLength(1);
  });

  it('comes back on curved (stuck to shapes) and elbow connectors, and the same on a second save', async () => {
    // two boxes, a curved connector stuck to them (PowerPoint's curved connector, a p:sp here) and an elbow
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('blank');
    const line = { headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 10, headWidth: 4, ppt: true } as const;
    host.edit('x', () => {
      const a = host.addShape({ kind: 'geo', geo: 'rect', x1: 50, y1: 50, x2: 150, y2: 100, color: '#000000' } as never);
      const b = host.addShape({ kind: 'geo', geo: 'rect', x1: 350, y1: 50, x2: 450, y2: 100, color: '#000000' } as never);
      host.addArrow({ ...line, tail: { x: 150, y: 75 }, head: { x: 350, y: 75 }, sweep: 40, from: { shape: a.id, port: 1 }, to: { shape: b.id, port: 3 }, name: 'Curved' } as Omit<Arrow, 'id'>);
      host.addArrow({ ...line, tail: { x: 100, y: 200 }, head: { x: 300, y: 300 }, elbow: true, name: 'Bent' } as Omit<Arrow, 'id'>);
    });
    const data: DeckData = { size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ id: i + 1, layout: s.layout, doc: d.docOf(i), notes: s.notes })) };
    const p = unzipSync(await writePptx(data, opts));
    const x = strFromU8(p[SLIDE2]);
    expect(x).toMatch(/<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="Curved"\/>/);
    expect(x).toMatch(/<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="\d+" name="Bent"\/>/);
    const read = readPptx(zipSync(p));
    expect([...read.slides[1].contents.arrows.values()].map((r) => r.name).sort()).toEqual(['Bent', 'Curved']);
    // saved again from what was read: the same names, the same connectors' tags
    const doc2 = new Doc();
    doc2.restoreContents(read.slides[1].contents);
    const again = unzipSync(await writePptx({ ...data, slides: [data.slides[0], { ...data.slides[1], doc: doc2 }] }, opts));
    const names = (s: string) => [...s.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map((m) => m[1]);
    expect(names(strFromU8(again[SLIDE2]))).toEqual(names(x));
  });

  it('is the name PowerPoint gave it after a save here, not the one saved', async () => {
    const p = await deckWith({ name: 'Old' });
    const renamed = (to: string) => arrowsOf(zipSync({ ...p, [SLIDE2]: new Uint8Array(strToU8(strFromU8(p[SLIDE2]).replace('name="Old"', `name="${to}"`))) }))[0].name;
    expect(renamed('New')).toBe('New');
    // (renamed to one like PowerPoint's own: not the old one back from the tag)
    expect(renamed('Straight Arrow Connector 9')).toBeUndefined();
  });

  it("isn't the name of a drawing's picture its arrow is in", async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('blank');
    host.edit('x', () => {
      const a = host.addAtom(100, 100), b = host.addAtom(130, 100);
      host.addBond(a.id, b.id);
      host.addArrow({ tail: { x: 160, y: 100 }, head: { x: 240, y: 100 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 10, headWidth: 4 } as Omit<Arrow, 'id'>);
    });
    const data: DeckData = { size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ id: i + 1, layout: s.layout, doc: d.docOf(i), notes: s.notes })) };
    const p = unzipSync(await writePptx(data, opts));
    const x = strFromU8(p[SLIDE2]).replace(/name="Structure \d+"/, 'name="Scheme 1"');
    expect(x).toContain('name="Scheme 1"');
    expect(arrowsOf(zipSync({ ...p, [SLIDE2]: new Uint8Array(strToU8(x)) })).map((a) => a.name)).toEqual([undefined]);
  });

  it('is read from a connector named in PowerPoint (its tag gone), and not from PowerPoint\'s own', async () => {
    const p = await deckWith({}, {});
    // as another program saves it: no tags, one connector renamed in the Selection Pane
    let x = strFromU8(p[SLIDE2]).replace(/<p:custDataLst>.*?<\/p:custDataLst>/g, '');
    let k = 0;
    x = x.replace(/name="Straight Arrow Connector \d+"/g, (m) => (k++ === 0 ? 'name="Mechanism arrow"' : m));
    const names = arrowsOf(zipSync({ ...p, [SLIDE2]: new Uint8Array(strToU8(x)) })).map((a) => a.name);
    expect(names).toContain('Mechanism arrow');
    expect(names.filter((n) => n && /Straight Arrow Connector/.test(n))).toHaveLength(0);
  });
});
