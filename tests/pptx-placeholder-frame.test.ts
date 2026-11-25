// @vitest-environment jsdom
//
// A PowerPoint placeholder's own frame (F-P-002): a title placed by hand at 100, 300, 500 × 80 pt
// and anchored at the bottom was saved where its text starts (107.2, 355.4, 485.6 × 80 pt) with no
// insets and anchored at the top. Its xfrm and bodyPr (ECMA-376 Part 1, §20.1.7.6 xfrm, §21.1.2.1.1
// bodyPr) are now kept, as a text box's are, while it isn't resized here.

import { describe, it, expect } from 'vitest';
import { keptFrame, frameNow } from '../src/io/pptx-keep';
import type { Caption } from '../src/model';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const EMU = 12700;
const emu = (pt: number) => Math.round(pt * EMU);
const XF = `<a:xfrm><a:off x="${100 * EMU}" y="${300 * EMU}"/><a:ext cx="${500 * EMU}" cy="${80 * EMU}"/></a:xfrm>`;
const BP = '<a:bodyPr anchor="b"><a:noAutofit/></a:bodyPr>';

function placeholder(): Element {
  const xml = `<p:sp xmlns:p="${P}" xmlns:a="${A}"><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr>${XF}</p:spPr><p:txBody>${BP}<a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>`;
  return new DOMParser().parseFromString(xml, 'application/xml').documentElement;
}

// the caption as read: its text starts inside the insets, moved down by the bottom anchor
const read: Caption = { id: 1, x: 107.2, y: 355.4, runs: [{ text: 'Title' }], ph: 'title', wrap: 485.6, boxH: 80 } as Caption;

describe('a placeholder\'s own frame (F-P-002)', () => {
  it('is kept as the file had it while the placeholder is unchanged', () => {
    const c = { ...read, pbox: keptFrame(placeholder(), read)! };
    const f = frameNow(c, emu)!;
    expect(f.xfrm).toBe(XF);
    expect(f.bodyPr).toBe(BP);
  });

  it('moves with the placeholder, keeping its size and anchoring', () => {
    const c = { ...read, pbox: keptFrame(placeholder(), read)!, x: read.x + 10, y: read.y + 20 };
    const f = frameNow(c, emu)!;
    expect(f.xfrm).toBe(`<a:xfrm><a:off x="${110 * EMU}" y="${320 * EMU}"/><a:ext cx="${500 * EMU}" cy="${80 * EMU}"/></a:xfrm>`);
    expect(f.bodyPr).toBe(BP);
  });
});
