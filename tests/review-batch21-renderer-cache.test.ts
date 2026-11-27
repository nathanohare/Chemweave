// @vitest-environment jsdom
//
// Code review of 2026-11-26, batch 21 (drawing, kept work): a blurred shape shadow is worked out
// once, not for every tile it crosses (F207); a highlight's effects are found without working its
// pieces or its glow's steps out again (F909); and a rounded box's dots are worked out once, not for every tile (F910).

import { describe, it, expect, vi } from 'vitest';

const counts = { shadow: 0, dots: 0 };
vi.mock('../src/render/highlight-fx', async (orig) => {
  const m = await orig<typeof import('../src/render/highlight-fx')>();
  return { ...m, shapeShadow: (...a: Parameters<typeof m.shapeShadow>) => { counts.shadow++; return m.shapeShadow(...a); } };
});
vi.mock('../src/render/fills', async (orig) => {
  const m = await orig<typeof import('../src/render/fills')>();
  return { ...m, dotCentres: (...a: Parameters<typeof m.dotCentres>) => { counts.dots++; return m.dotCentres(...a); } };
});

import { Renderer } from '../src/render/renderer';
import { Doc, type Shape } from '../src/model';
import { VecPath } from '../src/render/vector';

const noCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;
/** A pretend canvas that does nothing. */
const quiet = () => new Proxy({ lineJoin: 'miter' } as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 0 }) : () => undefined),
  set: (t, k, v) => { t[k] = v; return true; },
}) as unknown as CanvasRenderingContext2D;
type Priv = Record<string, (...a: unknown[]) => unknown>;
const renderer = () => { const r = new Renderer(noCanvas, noCanvas); r.makePath = () => new VecPath() as unknown as Path2D; return r; };

describe('work kept between tiles', () => {
  it('works a blurred shape shadow out once for the tiles it crosses (F207)', () => {
    const r = renderer();
    const s = { id: 1, kind: 'geo', geo: 'rect', x1: 0, y1: 0, x2: 300, y2: 200, filled: true, shadow: true, shadowBlur: 6 } as Shape;
    counts.shadow = 0;
    for (let tile = 0; tile < 4; tile++) (r as unknown as Priv).drawShape(quiet(), s, 1);
    expect(counts.shadow).toBe(1);
    // a changed shape (shapes are replaced when changed) is worked out again
    (r as unknown as Priv).drawShape(quiet(), { ...s, shadowBlur: 3 }, 1);
    expect(counts.shadow).toBe(2);
  });

  it('works a rounded box\'s dots out once for the tiles it crosses (F910)', () => {
    const r = renderer();
    const s = { id: 2, kind: 'rect', rounded: true, x1: 0, y1: 0, x2: 200, y2: 120, pattern: 'dots' } as Shape;
    counts.dots = 0;
    for (let tile = 0; tile < 4; tile++) (r as unknown as Priv).drawShape(quiet(), s, 1);
    expect(counts.dots).toBe(1);
  });

  it('finds a highlight\'s effects again without working out its pieces (F909)', () => {
    const doc = new Doc();
    doc.edit('Highlight', () => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(14.4, 0);
      const bond = doc.addBond(a.id, b.id);
      doc.updateBond(bond.id, { highlight: '#ffcc00', hl: { glow: true } });
    });
    const r = renderer();
    const p = r as unknown as Priv;
    const g = [...(p.wholeHighlights(doc) as Map<string, unknown>).values()][0];
    let pieces = 0;
    const real = p.highlightPieces.bind(r);
    p.highlightPieces = (...a: unknown[]) => { pieces++; return real(...a); };
    const first = p.highlightFx(doc, g);
    const n = pieces;
    expect(p.highlightFx(doc, g)).toBe(first);
    expect(pieces).toBe(n);
    // and the glow's steps, painted in one tile and then the next, are worked out once
    const layer = (first as { fx: { body: unknown } }).fx.body;
    expect(layer).toBeDefined();
    p.fxScratch = () => quiet();
    const tile = () => Object.assign(quiet(), { canvas: { width: 256, height: 256 }, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
    p.paintFxLayer(tile(), doc, g, first, layer, true);
    const once = pieces;
    expect(once).toBeGreaterThan(n);
    p.paintFxLayer(tile(), doc, g, first, layer, true);
    expect(pieces).toBe(once);
  });
});
