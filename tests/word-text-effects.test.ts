// @vitest-environment jsdom
//
// Word's character effects that are kept from a file but weren't drawn: hollow letters, emboss
// and engrave, emphasis marks, a character border, the Word 2010 glow and text outline, and the
// shadow, on screen and in pictures and PDFs (office sampler F-V-03: W-CHR-61 to 64, 70, 71, 75, 76).

import { describe, it, expect } from 'vitest';
import { unzlibSync } from 'fflate';
import { wordLook } from '../src/text/word-look';
import { layoutText } from '../src/text/layout';
import { drawLayout } from '../src/text/draw';
import { VectorContext, outlineOfPrevious } from '../src/render/vector';
import { itemsToSvg } from '../src/render/svg';
import { writePdf } from '../src/io/pdf';
import type { TextRun } from '../src/model';

const measure = (t: string, size: number) => [...t].length * size * 0.5;
const wrx = (slots: Record<string, string>) => JSON.stringify(slots);
const GLOW = '<w14:glow w14:rad="63500"><w14:srgbClr w14:val="F2A541"><w14:alpha w14:val="60000"/></w14:srgbClr></w14:glow>';

/** A run drawn as a picture: the recorded items. */
function drawn(run: TextRun) {
  const lay = layoutText({ runs: [run], justify: 'left' }, 10, measure);
  const v = new VectorContext();
  drawLayout(v as unknown as CanvasRenderingContext2D, lay, 0, 20);
  return v.items;
}

describe("Word's character effects", () => {
  it('reads them from what the run keeps of the file', () => {
    expect(wordLook({ wrx: wrx({ a: '<w:outline/><w:emboss w:val="0"/><w:imprint/>', e: '<w:bdr w:val="single" w:sz="8" w:space="0" w:color="1B7F79"/>', g: '<w:em w:val="dot"/>' }) })).toEqual({
      hollow: true, imprint: true, em: 'dot', border: { color: '#1b7f79', w: 1 },
    });
    expect(wordLook({ wfx: GLOW })).toEqual({ glow: { color: '#f2a541', r: 5, alpha: 0.4 } });
    expect(wordLook({ wrx: wrx({ e: '<w:bdr w:val="none"/>', g: '<w:em w:val="none"/>' }) })).toBeUndefined();
    expect(wordLook({})).toBeUndefined();
  });

  it('draws hollow letters as their outline, nothing inside', () => {
    const items = drawn({ text: 'Hollow', size: 10, color: '#1b7f79', wrx: wrx({ a: '<w:outline/>' }) });
    const texts = items.filter((i) => i.kind === 'text') as { text: string; stroke?: number; color: string }[];
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ text: 'Hollow', color: '#1b7f79' });
    expect(texts[0].stroke).toBeGreaterThan(0);
  });

  it('draws raised and pressed-in letters with a grey copy beside them', () => {
    for (const [slot, sign] of [['<w:emboss/>', 1], ['<w:imprint/>', -1]] as const) {
      const texts = drawn({ text: 'Raised', size: 10, wrx: wrx({ a: slot }) }).filter((i) => i.kind === 'text') as { x: number; color: string }[];
      expect(texts).toHaveLength(2);
      expect(texts[0].color).toBe('#9a9a9a');
      expect(Math.sign(texts[0].x - texts[1].x)).toBe(sign);
    }
  });

  it('draws a box round bordered text, and a mark at each character with emphasis marks', () => {
    const boxed = drawn({ text: 'Box', size: 10, wrx: wrx({ e: '<w:bdr w:val="single" w:sz="4" w:space="0" w:color="1B7F79"/>' }) });
    expect(boxed.some((i) => i.kind === 'path' && i.stroke?.color === '#1b7f79')).toBe(true);
    const dots = drawn({ text: 'a b', size: 10, wrx: wrx({ g: '<w:em w:val="dot"/>' }) }).filter((i) => i.kind === 'path' && i.fill);
    // (two letters, no mark at the space)
    expect(dots).toHaveLength(2);
  });

  it('draws Word 2010\'s text outline and the shadow in a picture, and makes the outline a PDF\'s stroked text', async () => {
    const outlined = drawn({ text: 'Out', size: 10, outline: '#c8553d', noFill: true });
    const t = outlined.filter((i) => i.kind === 'text') as { stroke?: number; color: string }[];
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ color: '#c8553d' });
    expect(itemsToSvg(outlined, { x: 0, y: 0, w: 100, h: 40 })).toContain('fill="none"');
    // (a picture has no shadows: a see-through copy below and to the right)
    const shadowed = drawn({ text: 'Shadow', size: 10, shadow: true }).filter((i) => i.kind === 'text') as { x: number; color: string }[];
    expect(shadowed).toHaveLength(2);
    expect(shadowed[0].x).toBeGreaterThan(shadowed[1].x);
    // (opaque grey: PDF, EPS and EMF text take no transparency) (review)
    expect(shadowed[0].color).toBe('#999999');
    const pdf = await writePdf([{ w: 100, h: 40, items: outlined }], { image: async () => null });
    const s = Array.from(pdf, (c) => String.fromCharCode(c)).join('');
    const streams: string[] = [];
    for (let i = s.indexOf('stream\n'); i >= 0; i = s.indexOf('stream\n', i + 7)) {
      const end = s.indexOf('\nendstream', i);
      try { streams.push(Array.from(unzlibSync(Uint8Array.from(s.slice(i + 7, end), (c) => c.charCodeAt(0))), (c) => String.fromCharCode(c)).join('')); } catch { /* not packed */ }
      i = end;
    }
    expect(streams.join('\n')).toMatch(/RG [\d.]+ w 1 j 1 Tr/);
  });

  it("leaves out, where outlines can't be drawn (EMF, EPS), an outline over its own letters, but not one on its own (review)", () => {
    const both = drawn({ text: 'Both', size: 10, color: '#ffffff', outline: '#000000' });
    const i = both.findIndex((x) => x.kind === 'text' && x.stroke);
    expect(i).toBeGreaterThan(0);
    expect(outlineOfPrevious(both, i)).toBe(true);
    const alone = drawn({ text: 'Alone', size: 10, outline: '#000000', noFill: true });
    expect(outlineOfPrevious(alone, alone.findIndex((x) => x.kind === 'text' && x.stroke))).toBe(false);
  });
});
