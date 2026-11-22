// @vitest-environment jsdom
// Convert to Figure: the picture swapped for an empty figure of its size, the picture kept with
// it (style, look, tracing), the picture's look put on what is drawn, and tracing's pixels.
import { describe, expect, it } from 'vitest';
import { figureFor, isConvertedFigure, keptPicture, restyle, styleForLook, withLook, drawingStyleOf } from '../src/ui/doc-make-editable';
import { tracePixels, TINTS } from '../src/ui/trace';
import { ACS_1996 } from '../src/style';
import { structureDoc } from '../src/sheet/structure-doc';
import { freeRing, placeRing, sprout } from '../src/chem/chemgeom';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, traceOf, TRACE_START, type DocObject, type DocText } from '../src/document/document';
import type { PictureLook } from '../src/recognise/editable';
import * as rt from '../src/richtext';

type Picture = Extract<DocObject, { kind: 'picture' }>;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const picture: Picture = { kind: 'picture', src: PNG, w: 229.5, h: 276, scale: 0.6, alt: 'manzamine A', float: { wrap: 'square', x: 12, y: 4 }, look: { frame: 0.5 } };
const look: PictureLook = { bondLength: 17, lineWidth: 1, labelSize: 11 };

/** A small structure drawn in the document's style (no settings of its own). */
function drawn() {
  const doc = structureDoc({ atoms: [], bonds: [], captions: [], arrows: [], shapes: [] }, ACS_1996);
  doc.bulk(() => {
    const ring = placeRing(doc, freeRing({ x: 0, y: 0 }, 6, ACS_1996.bondLength), { aromatic: true });
    sprout(doc, ring[0], 1, 'solid', 7);
  });
  return doc.contents();
}

describe('Convert to Figure', () => {
  it('puts an empty figure of the picture\'s size where the picture was, wrapped and framed as it was', () => {
    const f = figureFor(picture, { w: 137.7, h: 165.6 }, 'match', look);
    expect(f.frame).toEqual({ x: 0, y: 0, w: 137.7, h: 165.6 });
    expect(f.contents.atoms).toHaveLength(0);
    expect(f.float).toEqual(picture.float);
    expect(f.float).not.toBe(picture.float);
    expect(f.look).toEqual(picture.look);
    expect(f.alt).toBe('manzamine A');
    // the picture kept whole, lying over the whole figure
    expect(f.fromPicture?.picture).toBe(picture);
    expect(f.fromPicture?.at).toEqual({ x: 0, y: 0, w: 137.7, h: 165.6 });
    expect(f.fromPicture?.style).toBe('match');
    expect(f.fromPicture?.look).toEqual(look);
    expect(isConvertedFigure(f)).toBe(true);
    expect(keptPicture(f)).toBe(picture);
    expect(keptPicture(picture)).toBe(picture);
    // a structure read from a picture (with readings) is not a hand-drawn figure
    expect(isConvertedFigure({ ...f, fromPicture: { ...f.fromPicture!, parts: [{ molblock: 'x' }] } })).toBe(false);
  });

  it('draws in the picture\'s look: the document\'s style sized to its bond length', () => {
    const s = styleForLook(ACS_1996, look);
    const k = 17 / ACS_1996.bondLength;
    expect(s.bondLength).toBe(17);
    expect(s.lineWidth).toBe(1);
    expect(s.labelSize).toBe(11);
    expect(s.boldWidth).toBeCloseTo(ACS_1996.boldWidth * k, 2);
    expect(s.hashSpacing).toBeCloseTo(ACS_1996.hashSpacing * k, 2);
    // no line or label measured: the document's, scaled with the bond
    const t = styleForLook(ACS_1996, { bondLength: 17, lineWidth: null, labelSize: null });
    expect(t.lineWidth).toBeCloseTo(ACS_1996.lineWidth * k, 2);
    expect(t.labelSize).toBeCloseTo(ACS_1996.labelSize * k, 2);
    expect(drawingStyleOf(figureFor(picture, { w: 10, h: 10 }, 'default', look).fromPicture, ACS_1996)).toBe(ACS_1996);
    expect(drawingStyleOf(figureFor(picture, { w: 10, h: 10 }, 'match', look).fromPicture, ACS_1996).bondLength).toBe(17);
  });

  it('keeps the picture\'s look on what was drawn, as a structure read from it keeps it', () => {
    const c = drawn();
    const m = withLook(c, look, ACS_1996);
    for (const b of m.bonds) {
      expect(b.s).toBeCloseTo(1 / ACS_1996.lineWidth, 2);
      expect(b.bondLength).toBe(17);
    }
    for (const a of m.atoms) expect(a.s).toBeCloseTo(11 / ACS_1996.labelSize, 2);
    // what already has its own settings is left as it is (unless the style is changed)
    const own = { ...m, bonds: m.bonds.map((b, i) => (i === 0 ? { ...b, s: 3 } : b)) };
    expect(withLook(own, look, ACS_1996).bonds[0].s).toBe(3);
    expect(withLook(own, look, ACS_1996, true).bonds[0].s).toBeCloseTo(1 / ACS_1996.lineWidth, 2);
    // the document's style: the settings taken off again
    const plain = withLook(m, null, ACS_1996, true);
    for (const b of plain.bonds) expect([b.s, b.bondLength, b.boldWidth]).toEqual([undefined, undefined, undefined]);
    for (const a of plain.atoms) expect(a.s).toBeUndefined();
  });

  it('changes a figure\'s style over what was drawn in it, without reading the picture', async () => {
    const f = { ...figureFor(picture, { w: 137.7, h: 165.6 }, 'match', look), contents: withLook(drawn(), look, ACS_1996) };
    const d = await restyle(f, 'default', ACS_1996);
    expect(d?.fromPicture?.style).toBe('default');
    expect(d?.frame).toEqual(f.frame);
    expect(d?.contents.bonds.every((b) => b.s === undefined)).toBe(true);
    const back = await restyle(d!, 'match', ACS_1996);
    expect(back?.contents.bonds.every((b) => b.bondLength === 17)).toBe(true);
    // nothing measured: no picture style to go to
    const none = figureFor(picture, { w: 10, h: 10 }, 'default', null);
    expect(await restyle(none, 'match', ACS_1996)).toBeNull();
  });

  it('keeps the figure, its picture and tracing in a Word file', async () => {
    const f = figureFor(picture, { w: 137.7, h: 165.6 }, 'match', look);
    f.fromPicture!.trace = { on: true, opacity: 0.6, tint: 'blue' };
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    const N = paraFromStyle(d.styles.Normal, {});
    const t: DocText = { ...d, runs: rt.normalizeRuns([{ ...n, text: 'Before\n' }, objectRun(1, n), { ...n, text: '\nAfter' }]), paras: [N, N, N], objects: { 1: f } };
    const deps: DocxDeps = { async picture() { return { png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), w: 100, h: 60 }; } };
    const { doc } = await readDocx(await writeDocx(t, deps));
    const o = Object.values(doc.objects).find((x) => x.kind === 'drawing');
    if (o?.kind !== 'drawing') throw new Error('no figure');
    expect(o.frame).toEqual(f.frame);
    expect(o.fromPicture?.trace).toEqual({ on: true, opacity: 0.6, tint: 'blue' });
    expect(o.fromPicture?.style).toBe('match');
    expect(o.fromPicture?.look).toEqual(look);
    expect(o.fromPicture?.picture.src).toBe(PNG);
    expect(isConvertedFigure(o)).toBe(true);
  });
});

describe('Tracing', () => {
  it('starts off, at 35% in gray', () => {
    expect(TRACE_START).toEqual({ on: false, opacity: 0.35, tint: 'gray' });
    expect(traceOf({ picture, at: { x: 0, y: 0, w: 1, h: 1 }, style: 'match' })).toEqual(TRACE_START);
    expect(traceOf({ picture, at: { x: 0, y: 0, w: 1, h: 1 }, style: 'match', trace: { on: true, opacity: 0.5, tint: 'red' } }).tint).toBe('red');
  });

  it('takes the paper out and draws the ink faintly in the tint', () => {
    // white paper, black ink, gray anti-aliasing, red ink
    const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 220, 0, 0, 255]);
    const gray = px.slice();
    tracePixels(gray, 'gray', 0.4);
    expect(gray[3]).toBe(0);
    expect([...gray.slice(4, 8)]).toEqual([...TINTS.gray!, Math.round(255 * 0.4)]);
    expect(gray[11]).toBeCloseTo(255 * 0.4 * (1 - 128 / 255), -0.5);
    // the picture's own colors: black stays black, red stays red (not washed out by its alpha)
    const own = px.slice();
    tracePixels(own, 'original', 1);
    expect([...own.slice(4, 7)]).toEqual([0, 0, 0]);
    expect(own[12]).toBeGreaterThan(200);
    expect(own[13]).toBeLessThan(30);
    expect(own[3]).toBe(0);
    // see-through ink stays see-through
    const clear = new Uint8ClampedArray([0, 0, 0, 0]);
    tracePixels(clear, 'blue', 0.8);
    expect(clear[3]).toBe(0);
  });
});
