// @vitest-environment jsdom
//
// Chemweave's own tags in a PowerPoint file are written the same way on a second save: text box
// positions as the reader takes them (no float noise), the tag objects' fields in one order and
// no chart id that a read renews (office sampler F-P-001; the sid numbers are still to do).

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc } from '../src/model';
import { defaultMaster } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return new Uint8Array(); } };

async function saveDoc(doc: Doc): Promise<Uint8Array> {
  return writePptx({ size: { w: 960, h: 540 }, master: defaultMaster(), slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
}

async function again(bytes: Uint8Array): Promise<Uint8Array> {
  const back = readPptx(bytes);
  const doc = new Doc();
  doc.restoreContents(back.slides[0].contents);
  return writePptx({ size: back.size, master: back.master, slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
}

/** The slide's tag parts' text, sid numbers left out. */
const tags = (bytes: Uint8Array) => Object.entries(unzipSync(bytes)).filter(([n]) => /^ppt\/tags\/tag\d+\.xml$/.test(n)).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
  .map(([, b]) => strFromU8(b).replace(/&quot;sid&quot;:\d+/g, 'sid'));

describe('Chemweave\'s tags on a second save (F-P-001)', () => {
  it('writes a text box\'s place and a shape\'s fields the same way', async () => {
    const doc = new Doc();
    doc.style = { ...defaultMaster().drawing } as Doc['style'];
    doc.edit('make', () => {
      doc.addShape({ kind: 'rect', x1: 40.1, y1: 60.3, x2: 200.7, y2: 120.9, color: '#336699', filled: true });
      doc.addCaption({ x: 73.2, y: 75.10000000000001, runs: [{ text: 'P-MST-09 caption' }] });
      doc.addCaption({ x: 31.2, y: 206.1025, runs: [{ text: 'turned' }], rot: 30 });
    });
    // (as read from a file, its text boxes with their frames; a place with float noise, as arithmetic leaves it)
    const read = new Doc();
    read.restoreContents(readPptx(await saveDoc(doc)).slides[0].contents);
    read.edit('nudge', () => { for (const c of [...read.captions.values()]) read.updateCaption(c.id, { y: c.y + 1e-13 }); });
    const once = await saveDoc(read);
    const twice = await again(once);
    const thrice = await again(twice);
    expect(tags(twice)).toEqual(tags(once));
    expect(tags(thrice)).toEqual(tags(twice));
    // (no float noise in a place)
    expect(tags(once).join('')).not.toMatch(/\d\.\d*0000000\d/);
  });
});
