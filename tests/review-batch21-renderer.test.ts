// @vitest-environment jsdom
//
// Code review of 2026-11-26, batch 21 (drawing): what a tile draws and how. A tall shape's
// reflection is drawn in the tiles it reaches (F206); a shape with no fill keeps its outline under
// soft edges (F208) and a picture fill fades with them (F911); tiles sit on whole screen pixels at
// any browser zoom (F902); long labels are drawn in the tiles they reach (F903); one renderer
// drawing two drawings keeps their shapes apart (F904); a curved arrow bent more than half round is
// drawn where it bulges (F905); a lone CH3+'s charge is picked up where it is drawn (F906); arrows
// keep their own corners whatever was drawn before (F907); and a short arrow's head stays on it (F908).

import { describe, it, expect, vi } from 'vitest';
import { Renderer } from '../src/render/renderer';
import { Doc, type Arrow, type Shape } from '../src/model';
import { VecPath } from '../src/render/vector';

const noCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;

type Call = { name: string; args: unknown[]; lineJoin: unknown };
/** A pretend canvas that does nothing but note each call (with the corners it would draw) and keep what is set on it. */
function recorder(extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const state: Record<string | symbol, unknown> = { lineJoin: 'miter', lineWidth: 1, globalAlpha: 1, ...extra };
  const ctx = new Proxy(state, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 0 });
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return (...args: unknown[]) => { calls.push({ name: String(k), args, lineJoin: t.lineJoin }); };
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

type Priv = Record<string, (...a: unknown[]) => unknown>;
const priv = (r: Renderer) => r as unknown as Priv;

const arrow = (extra: Partial<Arrow> = {}): Arrow => ({
  id: 1, tail: { x: 0, y: 0 }, head: { x: 40, y: 0 }, sweep: 0, headStyle: 'full', tailStyle: 'none', headType: 'solid',
  line: 'solid', noGo: false, equilibrium: false, headLength: 10, headWidth: 3, ...extra,
});

describe('what a tile draws', () => {
  it('draws a tall shape whose reflection reaches the tile, well below its box (F206)', () => {
    const doc = new Doc();
    let s!: Shape;
    doc.edit('Shape', () => { s = doc.addShape({ kind: 'geo', geo: 'rect', x1: 0, y1: 0, x2: 100, y2: 250, filled: true, reflection: { size: 0.9, opacity: 0.5, dist: 0 } }); });
    const r = new Renderer(noCanvas, noCanvas);
    const drawn: Shape[] = [];
    priv(r).drawShape = (_c: unknown, sh: unknown) => { drawn.push(sh as Shape); };
    // a tile area 150 below the shape's box, inside its reflection (225 deep)
    priv(r).drawShapeList(recorder().ctx, doc, [s], { x1: 0, y1: 400, x2: 100, y2: 450 });
    expect(drawn).toEqual([s]);
  });

  it('draws atoms whose long labels reach into the tile (F903)', () => {
    const doc = new Doc();
    doc.edit('Atom', () => { doc.addAtom(0, 0, 6, { label: 'CH2CH2CH2CH2CH2CH2CH2CH3' }); });
    const r = new Renderer(noCanvas, noCanvas);
    // 24 letters at the 10 pt label size: well over the 84 pt reached before
    expect(priv(r).pad(doc) as number).toBeGreaterThan(24 * 10 * 0.6);
  });

  it('keeps two drawings at the same version apart (F904)', () => {
    const make = (x: number) => {
      const d = new Doc();
      d.edit('Shape', () => { d.addShape({ kind: 'rect', x1: x, y1: 0, x2: x + 10, y2: 10 }); });
      return d;
    };
    const a = make(0), b = make(500);
    expect(a.version).toBe(b.version);
    const r = new Renderer(noCanvas, noCanvas);
    expect((priv(r).sortedShapes(a) as Shape[])[0].x1).toBe(0);
    expect((priv(r).sortedShapes(b) as Shape[])[0].x1).toBe(500);
  });

  it('draws a curved arrow bent 300° in a tile its bulge reaches past its chord (F905)', () => {
    const doc = new Doc();
    const r = new Renderer(noCanvas, noCanvas);
    let n = 0;
    r.drawArrow = () => { n++; };
    const a = arrow({ head: { x: 20, y: 0 }, sweep: (300 * Math.PI) / 180 });
    // the arc's circle: radius 20 about a point 17.3 off the chord's middle; it bulges to about 37 from the chord
    for (const vis of [{ x1: 0, y1: 25, x2: 20, y2: 40 }, { x1: 0, y1: -40, x2: 20, y2: -25 }]) priv(r).drawArrowList(recorder().ctx, doc, [a], vis);
    expect(n).toBeGreaterThan(0);
  });

  it('puts each tile on whole screen pixels at 110% (F902)', () => {
    const { ctx, calls } = recorder();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
    try {
      const doc = new Doc();
      doc.edit('Atom', () => { doc.addAtom(10, 10); });
      const r = new Renderer(document.createElement('canvas'), document.createElement('canvas'));
      r.makePath = () => new VecPath() as unknown as Path2D;
      r.resize(800, 600, 1.1);
      r.view.scale = 1;
      r.view.ox = 3.3; r.view.oy = 7.7;
      r.renderScene(doc);
      const tiles = calls.filter((c) => c.name === 'drawImage' && c.args.length === 5 && c.args[0] instanceof HTMLCanvasElement);
      expect(tiles.length).toBeGreaterThan(2);
      for (const t of tiles) {
        const [, x, y, w] = t.args as number[];
        for (const v of [x * 1.1, y * 1.1, w * 1.1]) expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6);
      }
    } finally { getContext.mockRestore(); }
  });
});

describe('soft edges (F208, F911)', () => {
  it('keeps the outline of a shape with no fill', () => {
    const r = new Renderer(noCanvas, noCanvas);
    r.makePath = () => new VecPath() as unknown as Path2D;
    const s = { id: 1, kind: 'geo', geo: 'ellipse', x1: 0, y1: 0, x2: 80, y2: 50, filled: false, softEdge: 5 } as Shape;
    const { ctx, calls } = recorder();
    priv(r).drawShape(ctx, s, 1);
    expect(calls.some((c) => c.name === 'stroke')).toBe(true);
  });

  it('fades a picture fill, and keeps its outline where it can\'t be faded (a copy\'s picture)', () => {
    const r = new Renderer(noCanvas, noCanvas);
    r.makePath = () => new VecPath() as unknown as Path2D;
    const s = { id: 1, kind: 'geo', geo: 'rect', x1: 0, y1: 0, x2: 80, y2: 50, filled: false, softEdge: 5, picFill: { src: 'data:image/png;base64,AA' } } as Shape;
    let pics = 0;
    const paint = priv(r).paintPicFill.bind(r);
    priv(r).paintPicFill = (...a: unknown[]) => { pics++; return paint(...a); };
    priv(r).drawShape(recorder().ctx, s, 1);
    // the picture drawn in each ring of the fade
    expect(pics).toBeGreaterThan(1);
    const copy = recorder({ picture: () => undefined });
    priv(r).drawShape(copy.ctx, s, 1);
    expect(copy.calls.some((c) => c.name === 'stroke')).toBe(true);
  });
});

describe('arrows', () => {
  it('draws an open head with its own sharp corner, after something drawn with round ones (F907)', () => {
    const r = new Renderer(noCanvas, noCanvas);
    const { ctx, calls } = recorder({ lineJoin: 'round' });
    r.drawArrow(ctx, arrow({ headType: 'angle' }), 1);
    const strokes = calls.filter((c) => c.name === 'stroke');
    expect(strokes.length).toBeGreaterThan(0);
    for (const s of strokes) expect(s.lineJoin).toBe('miter');
  });

  it('keeps a short arrow\'s head from reaching back past its tail (F908)', () => {
    const r = new Renderer(noCanvas, noCanvas);
    const { ctx, calls } = recorder();
    // 8 long, with a 10 long head
    r.drawArrow(ctx, arrow({ head: { x: 8, y: 0 } }), 1);
    const xs = calls.filter((c) => c.name === 'moveTo' || c.name === 'lineTo').map((c) => c.args[0] as number);
    expect(xs.length).toBeGreaterThan(2);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe('a carbon\'s charge (F906)', () => {
  it('is picked up on the sign in a lone CH3+\'s label', () => {
    const doc = new Doc();
    let id = 0;
    doc.edit('Atom', () => { id = doc.addAtom(0, 0, 6, { charge: 1 }).id; });
    const r = new Renderer(noCanvas, noCanvas);
    const a = doc.atoms.get(id)!;
    const info = r.atomInfo(doc, a);
    expect(info.layout).not.toBeNull();
    expect(r.chargeBox(doc, a)).toEqual(info.boxes[info.charge!.index]);
  });
});
