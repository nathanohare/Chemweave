// @vitest-environment jsdom
//
// The slide size as the file had it (A4 isn't a whole number of points) is written back exactly
// while the deck is still that size; a size changed here is written from its points.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type DeckData, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
const P = 'ppt/presentation.xml';

async function saved(size?: { w: number; h: number }): Promise<Record<string, Uint8Array>> {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  const data: DeckData = { size: size ?? d.size, master: d.master, slides: d.slides.map((s, i) => ({ id: i + 1, layout: s.layout, doc: d.docOf(i), notes: s.notes })) };
  return unzipSync(await writePptx(data, opts));
}
const sldSz = (x: string) => /<p:sldSz [^>]*\/>/.exec(x)?.[0] ?? '';

describe('the slide size', () => {
  it('is written back exactly as the file had it (A4); one changed here is written from its points', async () => {
    const p = await saved();
    const a4 = strFromU8(p[P]).replace(/<p:sldSz [^>]*\/>/, '<p:sldSz cx="10692000" cy="7560000" type="A4"/>');
    const read = readPptx(zipSync({ ...p, [P]: new Uint8Array(strToU8(a4)) }));
    expect(read.size).toMatchObject({ w: 842, h: 595, type: 'A4', emu: { cx: 10692000, cy: 7560000 } });
    const back = strFromU8((await saved(read.size))[P]);
    expect(sldSz(back)).toBe('<p:sldSz cx="10692000" cy="7560000" type="A4"/>');
    // (changed to letter here, keeping what it had from the file: written from points)
    expect(sldSz(strFromU8((await saved({ ...read.size, w: 792, h: 612 }))[P]))).toContain('cx="10058400" cy="7772400"');
    // (a size of whole points keeps nothing more)
    const whole = readPptx(zipSync(await saved({ w: 960, h: 540 })));
    expect(whole.size.emu).toBeUndefined();
  });

  const readSize = async (sz: string) => {
    const p = await saved();
    return readPptx(zipSync({ ...p, [P]: new Uint8Array(strToU8(strFromU8(p[P]).replace(/<p:sldSz [^>]*\/>/, sz))) })).size;
  };

  it('keeps one side exact, without taking it for 4:3', async () => {
    const s = await readSize('<p:sldSz cx="9144100" cy="6858000"/>');
    expect(s).toMatchObject({ w: 720, h: 540, emu: { cx: 9144100, cy: 6858000 } });
    expect(sldSz(strFromU8((await saved(s))[P]))).toBe('<p:sldSz cx="9144100" cy="6858000"/>');
    // (a stale one, with one side changed here: written from points)
    expect(sldSz(strFromU8((await saved({ ...s, h: 600 }))[P]))).toContain(`cx="${720 * 12700}" cy="${600 * 12700}"`);
  });

  it("isn't kept when it isn't a plain size PowerPoint has", async () => {
    for (const bad of ['<p:sldSz cx="0x9144100" cy="6858000"/>', '<p:sldSz cx="10692000.5" cy="7560000"/>', '<p:sldSz cx="99999999999" cy="7560000"/>', '<p:sldSz cx="10692000"/>']) {
      expect((await readSize(bad)).emu).toBeUndefined();
    }
    // (nor written, when what it has isn't one)
    expect(sldSz(strFromU8((await saved({ w: 842, h: 595, emu: { cx: 10692000.5, cy: 7560000 } } as never))[P]))).toContain(`cx="${842 * 12700}"`);
  });
});
