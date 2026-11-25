// @vitest-environment jsdom
//
// A group's name in PowerPoint's Selection Pane is kept when the deck is saved (not replaced by
// "Group N"); PowerPoint's own names aren't taken for names given; grouping and ungrouping here
// take the name off.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Doc, type Shape } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type DeckData, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { groupSelection, ungroupSelection } from '../src/editor/groups';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
const SLIDE2 = 'ppt/slides/slide2.xml';
const box = (x: number, extra: Partial<Shape> = {}) => ({ kind: 'geo', geo: 'rect', x1: x, y1: 50, x2: x + 80, y2: 100, color: '#000000', ...extra }) as Omit<Shape, 'id'>;

/** A deck with one slide of two grouped boxes (with these group names on them) and a box on its own. */
async function deck(names: [string | undefined, string | undefined]): Promise<Record<string, Uint8Array>> {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.addSlide('blank');
  host.edit('x', () => {
    host.addShape(box(50, { grp: 1, ...(names[0] ? { grpName: names[0] } : {}) }));
    host.addShape(box(150, { grp: 1, ...(names[1] ? { grpName: names[1] } : {}) }));
    host.addShape(box(300));
  });
  const data: DeckData = { size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ id: i + 1, layout: s.layout, doc: d.docOf(i), notes: s.notes })) };
  return unzipSync(await writePptx(data, opts));
}
const groupNames = (x: string) => [...x.matchAll(/<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="([^"]*)"/g)].map((m) => m[1]);
const shapesOf = (bytes: Uint8Array) => [...readPptx(bytes).slides[1].contents.shapes.values()];

describe("a group's name", () => {
  it('is written, escaped, and read back on each member', async () => {
    const p = await deck(['Scheme & "1"', 'Scheme & "1"']);
    expect(groupNames(strFromU8(p[SLIDE2]))).toEqual(['Scheme &amp; &quot;1&quot;']);
    const s = shapesOf(zipSync(p));
    expect(s.filter((x) => x.grp !== undefined).map((x) => x.grpName)).toEqual(['Scheme & "1"', 'Scheme & "1"']);
    expect(s.find((x) => x.grp === undefined)?.grpName).toBeUndefined();
  });

  it("is PowerPoint's own where it has none, or its members' differ", async () => {
    expect(groupNames(strFromU8((await deck([undefined, undefined]))[SLIDE2]))).toEqual([expect.stringMatching(/^Group \d+$/)]);
    expect(groupNames(strFromU8((await deck(['A', 'B']))[SLIDE2]))).toEqual([expect.stringMatching(/^Group \d+$/)]);
  });

  it('is read from a group renamed in PowerPoint, not from PowerPoint\'s own', async () => {
    const p = await deck([undefined, undefined]);
    const renamed = (to: string) => shapesOf(zipSync({ ...p, [SLIDE2]: new Uint8Array(strToU8(strFromU8(p[SLIDE2]).replace(/(<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name=")[^"]*"/, `$1${to}"`))) }));
    expect(renamed('Mechanism').filter((x) => x.grp !== undefined).map((x) => x.grpName)).toEqual(['Mechanism', 'Mechanism']);
    expect(renamed('Group 12').some((x) => x.grpName !== undefined)).toBe(false);
  });

  it("gives way to PowerPoint's own when the group was named there after a save here", async () => {
    const p = await deck(['Old', 'Old']);
    const x = strFromU8(p[SLIDE2]).replace('name="Old"', 'name="Group 12"');
    const s = shapesOf(zipSync({ ...p, [SLIDE2]: new Uint8Array(strToU8(x)) }));
    expect(s.filter((y) => y.grp !== undefined)).toHaveLength(2);
    expect(s.some((y) => y.grpName !== undefined)).toBe(false);
  });

  it('leaves a freeform curve in a named group a ChemDraw curve, also after ungrouping (CDXML)', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: -10 }, { x: 20, y: -10 }, { x: 30, y: 0 }];
    const bx = { x1: 0, y1: -10, x2: 30, y2: 0 };
    const q = (v: number) => Math.round(v * 10000);
    const geo = 'pen:' + pts.map((pt) => `${q((pt.x - bx.x1) / 30)},${q((pt.y - bx.y1) / 10)}`).join(',');
    const doc = new Doc();
    doc.edit('x', () => {
      doc.addShape({ kind: 'geo', geo, ...bx, grp: 1, grpName: 'Scheme' } as never);
      doc.addShape({ kind: 'rect', x1: 50, y1: 0, x2: 90, y2: 20, grp: 1, grpName: 'Scheme' } as never);
    });
    const xml = writeCdxml(doc);
    expect(xml).toContain('<curve');
    const back = readCdxml(xml).doc;
    expect([...back.shapes.values()].map((s) => s.grpName)).toEqual(['Scheme', 'Scheme']);
    const all = new Set([...back.shapes.keys()]);
    back.edit('ungroup', () => { ungroupSelection(back, { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: all } as never); });
    const again = readCdxml(writeCdxml(back)).doc;
    expect(again.shapes.size).toBe(2);
    expect([...again.shapes.values()].every((s) => s.grp === undefined && s.grpName === undefined)).toBe(true);
  });

  it('is taken off by ungrouping, and by grouping again', () => {
    const doc = new Doc();
    let a = 0, b = 0, c = 0;
    doc.edit('x', () => {
      a = doc.addShape(box(50, { grp: 1, grpName: 'Old' })).id;
      b = doc.addShape(box(150, { grp: 1, grpName: 'Old' })).id;
      c = doc.addShape(box(300)).id;
    });
    const sel = (ids: number[]) => ({ atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set(ids) });
    doc.edit('group', () => { groupSelection(doc, sel([a, c]) as never); });
    expect([a, b, c].map((id) => doc.shapes.get(id)!.grpName)).toEqual([undefined, undefined, undefined]);
    doc.edit('name', () => { for (const id of [a, b, c]) doc.updateShape(id, { grpName: 'New' }); });
    doc.edit('ungroup', () => { ungroupSelection(doc, sel([a]) as never); });
    expect([a, b, c].map((id) => doc.shapes.get(id)!.grpName)).toEqual([undefined, undefined, undefined]);
  });
});
