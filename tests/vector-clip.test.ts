// @vitest-environment jsdom
//
// Cutting off what is drawn outside a rectangle in the vector pictures (PDF, printing's SVG, EPS,
// EMF): a Word table row of exact height cuts off the text that doesn't fit in it (as Word does),
// which the screen does with the canvas's clip(). Export ▸ PDF of a document with such a row
// failed with "clip is not a function" (F-W-027).

import { describe, it, expect } from 'vitest';
import { unzlibSync, zipSync, strToU8 } from 'fflate';
import { VectorContext, itemBounds, type Item } from '../src/render/vector';
import { writePdf } from '../src/io/pdf';
import { itemsToSvg } from '../src/render/svg';
import { itemsToEps } from '../src/render/eps';
import { itemsToEmf } from '../src/render/emf';
import { readDocx } from '../src/io/docx';
import { DocLayouter } from '../src/document/doc-layout';
import { recordPages, placeItems } from '../src/document/doc-paint';
import { paintMapBox } from '../src/render/map-box';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
/** Every page's drawing of a PDF written by writePdf (its content streams, unpacked). */
const contents = (pdf: Uint8Array): string[] => {
  const s = latin1(pdf);
  return [...s.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => {
    try { return latin1(unzlibSync(Uint8Array.from(m[1], (c) => c.charCodeAt(0)))); } catch { return ''; }
  }).filter((c) => c.startsWith('1 0 0 -1 0 '));
};

/** A few items drawn with a clip, as doc-paint draws a cell of a row of exact height. */
function recorded(): Item[] {
  const v = new VectorContext();
  const ctx = v as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 5, 5);
  ctx.save();
  ctx.beginPath();
  ctx.rect(10, 20, 100, 30);
  ctx.clip();
  ctx.font = '10px Arial';
  ctx.fillText('cut off', 12, 60);
  ctx.restore();
  ctx.fillText('not cut', 0, 100);
  return v.items;
}

describe('clip in a vector picture (F-W-027)', () => {
  it('records the rectangle on what is drawn until restore()', () => {
    const items = recorded();
    expect(items.map((i) => i.clip)).toEqual([undefined, { x1: 10, y1: 20, x2: 110, y2: 50 }, undefined]);
  });

  it('cuts to where two rectangles overlap, moved as the drawing is', () => {
    const v = new VectorContext();
    const ctx = v as unknown as CanvasRenderingContext2D;
    ctx.translate(5, 5);
    ctx.beginPath(); ctx.rect(0, 0, 50, 50); ctx.clip();
    ctx.beginPath(); ctx.rect(20, -10, 100, 40); ctx.clip();
    ctx.fillRect(0, 0, 1, 1);
    expect(v.items[0].clip).toEqual({ x1: 25, y1: 5, x2: 55, y2: 35 });
    // two that don't overlap leave nothing showing
    ctx.beginPath(); ctx.rect(200, 200, 5, 5); ctx.clip();
    ctx.fillRect(0, 0, 1, 1);
    const c = v.items[1].clip!;
    expect(c.x2 - c.x1).toBe(0);
    expect(c.y2 - c.y1).toBe(0);
  });

  it('refuses a clip to anything but a rectangle, rather than draw it uncut', () => {
    const ctx = new VectorContext() as unknown as CanvasRenderingContext2D;
    ctx.beginPath();
    ctx.arc(10, 10, 5, 0, Math.PI * 2);
    expect(() => ctx.clip()).toThrow(/rectangle/);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(10, 10); ctx.lineTo(0, 10); ctx.closePath();
    expect(() => ctx.clip()).toThrow(/rectangle/);
  });

  it('counts only the part inside the rectangle in the bounds', () => {
    expect(itemBounds([{ kind: 'path', segs: [{ k: 'M', x: 0, y: 0 }, { k: 'L', x: 100, y: 100 }], fill: '#000', clip: { x1: 10, y1: 20, x2: 30, y2: 40 } }]))
      .toEqual({ x1: 10, y1: 20, x2: 30, y2: 40 });
  });

  it('moves the rectangle with a picture placed on a page', () => {
    const items = placeItems({ box: { x1: 0, y1: 0, x2: 100, y2: 50 }, items: recorded() }, { x: 200, y: 300, w: 200, h: 100 });
    expect(items[1].clip).toEqual({ x1: 220, y1: 340, x2: 420, y2: 400 });
  });

  it('cuts in every vector format: PDF, SVG, EPS and EMF', async () => {
    const items = recorded();
    const pdf = contents(await writePdf([{ w: 200, h: 200, items }], { image: async () => null }))[0];
    // the text inside its own q … Q, cut by the rectangle; the text after it not
    expect(pdf).toMatch(/q\n10 20 100 30 re W n\n[^Q]*\(cut off\) Tj ET\nQ/);
    expect(pdf).not.toMatch(/re W n\n[^Q]*\(not cut\)/);

    const svg = itemsToSvg(items, { x1: 0, y1: 0, x2: 200, y2: 200 });
    const id = /<clipPath id="([^"]+)"><rect x="10" y="20" width="100" height="30"\/><\/clipPath>/.exec(svg)![1];
    expect(svg).toMatch(new RegExp(`<g clip-path="url\\(#${id}\\)">\\n<text[^>]*>cut off</text>\\n</g>`));
    expect(svg).toMatch(/\n<text[^>]*>not cut<\/text>/);

    const eps = await itemsToEps(items, { x1: 0, y1: 0, x2: 200, y2: 200 }, async () => null);
    expect(eps).toMatch(/gsave 10 20 100 30 rectclip\n[\s\S]*?\(cut off\) show\ngrestore\ngrestore/);

    // EMF: [MS-EMF] 2.3.2.3 EMR_INTERSECTCLIPRECT (type 30) with the rectangle in its logical
    // units (hundredths of a point), then 2.3.2.4 EMR_EXTSELECTCLIPRGN (type 75), RGN_COPY with
    // no region, to put the clip back to none for what follows
    const emf = new DataView(itemsToEmf(items, { x1: 0, y1: 0, x2: 200, y2: 200 }).buffer);
    const recs: { type: number; vals: number[] }[] = [];
    for (let at = 0; at < emf.byteLength;) {
      const type = emf.getUint32(at, true), size = emf.getUint32(at + 4, true);
      recs.push({ type, vals: Array.from({ length: (size - 8) / 4 }, (_, i) => emf.getInt32(at + 8 + i * 4, true)) });
      at += size;
    }
    const cut = recs.findIndex((r) => r.type === 30);
    expect(recs[cut].vals).toEqual([1000, 2000, 11000, 5000]);
    const text = recs.map((r, i) => (r.type === 84 ? i : -1)).filter((i) => i >= 0);
    expect(text[0]).toBeGreaterThan(cut);
    const back = recs.findIndex((r) => r.type === 75);
    expect(recs[back].vals).toEqual([0, 5]);
    expect(back).toBeGreaterThan(text[0]);
    expect(back).toBeLessThan(text[1]);
  });
});

describe('a Word table row of exact height in Export ▸ PDF (F-W-027)', () => {
  // ECMA-376 Part 1, §17.4.80 trHeight: hRule="exact" makes the row exactly w:val tall (720
  // twentieths of a point, 36 pt), whatever its text needs
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const cell = (body: string) => `<w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr>${body}</w:tc>`;
  const body = `<w:tbl><w:tblPr><w:tblW w:w="5760" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>` +
    `<w:tr><w:trPr><w:trHeight w:val="720" w:hRule="exact"/></w:trPr>${cell(p('first') + p('second') + p('third') + p('fourth'))}${cell(p('x'))}</w:tr>` +
    `<w:tr>${cell(p('below'))}${cell(p('y'))}</w:tr></w:tbl><w:p/>`;
  const file = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`),
  });

  it('writes the PDF, the row\'s text cut off at the row as on screen', async () => {
    const { doc } = await readDocx(file);
    const lay = new DocLayouter({ measure: (s: string, size: number) => s.length * size * 0.5, drawingSize: () => ({ w: 10, h: 10 }) }).layout(doc);
    const pages = recordPages(doc, lay, () => null);
    const texts = pages[0].items.filter((i) => i.kind === 'text') as Extract<Item, { kind: 'text' }>[];
    const first = texts.find((t) => t.text === 'first')!, below = texts.find((t) => t.text === 'below')!;
    // 36 pt tall, from the row's top
    expect(first.clip!.y2 - first.clip!.y1).toBeCloseTo(36);
    expect(texts.find((t) => t.text === 'fourth')!.clip).toEqual(first.clip);
    expect(below.clip).toBeUndefined();
    const pdf = contents(await writePdf(pages, { image: async () => null }));
    expect(pdf).toHaveLength(1);
    expect(pdf[0]).toMatch(/re W n\n[^Q]*\(first\) Tj/);
  });
});

describe('clip in a vector picture: the review\'s cases', () => {
  it('refuses two sides and a diagonal home (a triangle) as much as any other shape', () => {
    const ctx = new VectorContext() as unknown as CanvasRenderingContext2D;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.lineTo(10, 10); ctx.closePath();
    expect(() => ctx.clip()).toThrow(/rectangle/);
  });

  it('draws a rounded, patterned atom-map box in a vector picture (its pattern cut to the box\'s rectangle)', () => {
    const v = new VectorContext();
    const own = { fill: '#ffffff', pattern: 'lines', patternColor: '#ff0000', border: '#000000', borderWidth: 1, text: '#000000', bold: false, shadow: false, rounded: true } as const;
    expect(() => paintMapBox(v as unknown as CanvasRenderingContext2D, { x1: 0, y1: 0, x2: 20, y2: 10 }, 1, 1, 'own' as Parameters<typeof paintMapBox>[4], own)).not.toThrow();
    expect(v.items.some((i) => i.clip && i.clip.x2 === 20 && i.clip.y2 === 10)).toBe(true);
  });

  it('changes the EMF clip from one rectangle to the next (put back to none, then cut again)', () => {
    const v = new VectorContext();
    const ctx = v as unknown as CanvasRenderingContext2D;
    for (const x of [0, 50]) {
      ctx.save(); ctx.beginPath(); ctx.rect(x, 0, 10, 10); ctx.clip();
      ctx.fillRect(x, 0, 20, 20);
      ctx.restore();
    }
    const emf = new DataView(itemsToEmf(v.items, { x1: 0, y1: 0, x2: 100, y2: 100 }).buffer);
    const types: number[] = [];
    for (let at = 0; at < emf.byteLength; at += emf.getUint32(at + 4, true)) types.push(emf.getUint32(at, true));
    const clips = types.filter((t) => t === 30 || t === 75);
    expect(clips).toEqual([30, 75, 30]);
  });

  it('cuts a filled shape in a PDF too, inside its own q … Q', async () => {
    const v = new VectorContext();
    const ctx = v as unknown as CanvasRenderingContext2D;
    ctx.beginPath(); ctx.rect(0, 0, 10, 10); ctx.clip();
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 50, 50);
    const pdf = contents(await writePdf([{ w: 100, h: 100, items: v.items }], { image: async () => null }))[0];
    expect(pdf).toMatch(/q\n0 0 10 10 re W n\n0 1 0 rg\n[^Q]*\nf\nQ/);
  });
});
