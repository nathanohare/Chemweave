// @vitest-environment jsdom
//
// Code review batch 13 (presentations), the parts that go to files and between windows: animation
// times and paths read from PowerPoint, canvas slides split into slides and put back, the steps
// of a scheme, the deck sent to the audience window, a slide's own reference look, and a theme's
// title slide.

import { describe, it, expect, vi } from 'vitest';
import { Doc, type TableData } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import * as animation from '../src/deck/animation';
import { newAnim, pathPoints, type Anim } from '../src/deck/animation';
import { canvasTag, syncCamera, clampZoom, ZOOM_MAX, type CanvasData } from '../src/deck/canvas';
import { keyframeDoc, hiddenAt, splitCanvas } from '../src/deck/canvas-export';
import { stepAnims, type StepPiece } from '../src/deck/auto-steps';
import { deckData, deckFromData } from '../src/deck/show-link';
import { cleanSlideRefs, slideRefsTag } from '../src/deck/slide-refs';
import { blankRef } from '../src/document/references';
import { parseThemes } from '../src/deck/templates';

// A call counter on the one lookup hiddenAt does for each animation (see F849 below).
const lookups = vi.hoisted(() => ({ partOf: 0 }));
vi.mock('../src/deck/animation', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/deck/animation')>();
  return { ...real, partOf: ((...a: Parameters<typeof real.partOf>) => { lookups.partOf++; return real.partOf(...a); }) as typeof real.partOf };
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
const size = { w: 960, h: 540 };

async function roundTrip(anims: (ids: number[]) => Anim[]) {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.setLayout('blank');
  const ids: number[] = [];
  host.edit('Things', () => {
    ids.push(host.addShape({ kind: 'rect', x1: 100, y1: 100, x2: 200, y2: 180 }).id);
    ids.push(host.addShape({ kind: 'rect', x1: 300, y1: 100, x2: 400, y2: 180 }).id);
    ids.push(host.addShape({ kind: 'rect', x1: 500, y1: 100, x2: 600, y2: 180 }).id);
  });
  const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes, anims: anims(ids) })) }, opts);
  return readPptx(bytes).slides[0].anims!;
}

describe('F188: how long an animation takes, read from PowerPoint', () => {
  // ECMA-376 Part 1, PresentationML animation (p:cTn, its dur in milliseconds): the behaviour that
  // takes time carries the duration. The seconds written here are read back as the same seconds.
  it('keeps the length of an entrance, an exit and a wipe through PowerPoint', async () => {
    const got = await roundTrip(([a, b, c]) => [
      { ...newAnim({ kind: 'shape', id: a }, 'fade'), dur: 0.8 },
      { ...newAnim({ kind: 'shape', id: b }, 'fade', true), dur: 2 },
      { ...newAnim({ kind: 'shape', id: c }, 'wipe', true), dur: 1.5, from: 'left' },
    ]);
    expect(got.map((x) => x.exit ?? false)).toEqual([false, true, true]);
    expect(got[0].dur).toBeCloseTo(0.8);
    expect(got[1].dur).toBeCloseTo(2);
    expect(got[2].dur).toBeCloseTo(1.5);
  });
});

describe('F843: a motion path with a number after Z', () => {
  // ECMA-376 Part 1, PresentationML animation (p:animMotion path): SVG-like commands M, L, C, Z, E.
  it('is read to its end', () => {
    const pts = pathPoints('M 0 0 L 0.1 0.1 Z 0.2 E');
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }, { x: 0, y: 0 }]);
  });
});

describe('F189: a fly-over after a move that starts by itself', () => {
  const doc = new Doc();
  const master = Deck.blank(new Doc()).master;
  it('moves on from the slide before it, after the move\'s own delay, and the slide on the way moves on at once', () => {
    const keys = [{ id: 1, x: 0, y: 0, zoom: 1 }, { id: 2, x: 5000, y: 3000, zoom: 1 }];
    const moves = syncCamera([], keys).map((a) => ({ ...a, move: 'fly' as const, start: 'after' as const, delay: 2 }));
    const out = splitCanvas({ id: 7, layout: 'blank', doc, notes: '', anims: moves, canvas: { keys } }, master, size);
    expect(out.map((s) => !!s.part?.via)).toEqual([false, true, false]);
    // the first keyframe's slide waits the delay; the fly-over's slide passes at once
    expect(out[0].transition?.advanceAfter).toBeCloseTo(2);
    expect(out[1].transition?.advanceAfter).toBeCloseTo(0.01);
  });
});

describe('F848: a table on a canvas slide shown through a keyframe smaller than the canvas', () => {
  it('scales the table\'s columns, text and lines, and an arrow\'s shaft spacing, with the window', () => {
    const src = new Doc();
    const table: TableData = {
      cols: [100, 60], head: 1, lines: 'grid', lineW: 1, size: 12,
      rows: [[{ runs: [{ text: 'Entry', size: 10 }] }, { runs: [{ text: 'Yield' }] }], [{ runs: [{ text: '1' }] }, { runs: [{ text: '92%', size: 8 }], fig: { w: 40, h: 20 } }]],
    };
    src.edit('make', () => {
      src.addShape({ kind: 'table', x1: 10, y1: 10, x2: 170, y2: 80, table } as never);
      src.addArrow({
        headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5,
        tail: { x: 10, y: 100 }, head: { x: 100, y: 100 }, shaftSpacing: 3, boldWidth: 4, hashSpacing: 2,
      } as never);
    });
    // a window half the width of the slide: everything is twice as big
    const out = keyframeDoc(src, { x1: 0, y1: 0, x2: 480, y2: 270 }, size);
    const t = [...out.shapes.values()].find((s) => s.kind === 'table')!.table!;
    expect(t.cols).toEqual([200, 120]);
    expect(t.rows[0][0].runs[0].size).toBe(20);
    expect(t.rows[1][1].runs[0].size).toBe(16);
    expect(t.rows[1][1].fig).toEqual({ w: 80, h: 40 });
    expect(t.size).toBe(24);
    expect(t.lineW).toBe(2);
    const r = [...out.arrows.values()][0];
    expect([r.shaftSpacing, r.boldWidth, r.hashSpacing]).toEqual([6, 8, 4]);
  });
});

describe('F849: finding the part each animation moves', () => {
  it('finds each animation\'s part once, however many keyframes there are, and still hides what is not in yet', () => {
    const doc = new Doc();
    const n = 60;
    const ids: number[] = [];
    doc.bulk(() => { for (let i = 0; i < n; i++) ids.push(doc.addShape({ kind: 'rect', x1: i * 10, y1: 0, x2: i * 10 + 8, y2: 8 }).id); });
    const parts = animation.slideParts(doc);
    // one entrance for each shape, one to a keyframe
    const segs: Anim[][] = ids.map((id) => [newAnim({ kind: 'shape', id }, 'fade')]);
    lookups.partOf = 0;
    const hidden = segs.map((_, j) => hiddenAt(parts, segs, j).length);
    // at keyframe j its own shape and those already in are showing; the rest are not in yet
    expect(hidden.slice(0, 4)).toEqual([n - 1, n - 2, n - 3, n - 4].map((x) => x));
    expect(hidden[n - 1]).toBe(0);
    // (finding a part scans them all: once for each animation, not for each animation at each keyframe)
    expect(lookups.partOf).toBeLessThanOrEqual(2 * n);
  });
});

describe('F845 and F846: the keyframes of a scheme built step by step', () => {
  const piece = (kind: StepPiece['kind'], step: number, x2: number): StepPiece => ({ kind, step, sel: { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() }, from: 'left', box: { x1: 0, y1: 0, x2, y2: 50 } });
  const camera = (keys: CanvasData['keys']) => ({ data: { keys }, size });

  it('frames a very wide scheme as wide as the canvas allows (the zoom it is read back with)', () => {
    const { canvas } = stepAnims(new Doc(), [piece('first', 0, 100), piece('arrow', 1, 200000)], { effect: 'wipe', product: 'after', first: false, camera: true }, [], camera([{ id: 1, x: 0, y: 0, zoom: 1 }]));
    const z = canvas!.keys[0].zoom;
    expect(z).toBeLessThanOrEqual(ZOOM_MAX);
    expect(z).toBe(clampZoom(z));
  });

  it('keeps the first keyframe\'s title, tint and spotlight', () => {
    const first = { id: 4, x: 0, y: 0, zoom: 1, title: 'Route', tint: '#ffeecc', spot: { x1: 1, y1: 2, x2: 30, y2: 40 } };
    const { canvas } = stepAnims(new Doc(), [piece('first', 0, 100), piece('arrow', 1, 200)], { effect: 'wipe', product: 'after', first: false, camera: true }, [], camera([first]));
    expect(canvas!.keys[0]).toMatchObject({ id: 4, title: 'Route', tint: '#ffeecc', spot: { x1: 1, y1: 2, x2: 30, y2: 40 } });
  });
});

describe('F850: a canvas slide\'s moves when an animation of a deleted object is not saved', () => {
  const keys = [{ id: 1, x: 0, y: 0, zoom: 1 }, { id: 2, x: 960, y: 0, zoom: 1 }];
  it('counts only the animations that are written', () => {
    const gone = newAnim({ kind: 'shape', id: 9999 }, 'fade');
    const move = syncCamera([], keys)[0];
    const tag = JSON.parse(canvasTag({ keys }, [gone, move], (a) => a !== gone)) as { moves: unknown[][] };
    expect(tag.moves[0][0]).toBe(0);
    expect(JSON.parse(canvasTag({ keys }, [gone, move])).moves[0][0]).toBe(1);
  });
});

describe('F196: the deck sent to the audience window', () => {
  it('keeps the references, each slide\'s own and its look, and whether its items are its own', () => {
    const d = Deck.blank(new Doc());
    d.attach();
    d.addSlide('title-content');
    const ref = { ...blankRef('article', 'r-a'), authors: ['Smith, John'], title: 'A title', journal: 'J. Am. Chem. Soc.', year: '2020', volume: '142', pages: '1234' };
    d.settings.refs = { list: [ref] };
    d.slides[1].refs = ['r-a'];
    d.slides[1].refLook = { form: 'full' };
    d.slides[1].ownItems = true;
    const back = deckFromData(JSON.parse(JSON.stringify(deckData(d))));
    expect(back.settings.refs?.list.map((r) => r.id)).toEqual(['r-a']);
    expect(back.slides[1].refs).toEqual(['r-a']);
    expect(back.slides[1].refLook).toEqual({ form: 'full' });
    expect(back.slides[1].ownItems).toBe(true);
    expect(back.page(1).refs).toBeTruthy();
  });
});

describe('F197: a slide\'s own reference look read from a file', () => {
  it('keeps a value that is the default when the presentation\'s look differs', () => {
    // 'short' is the default form; a slide saying so is still saying so over a deck that shows full lines
    expect(cleanSlideRefs({ refLook: { form: 'short' } }).refLook).toEqual({ form: 'short' });
  });

  it('keeps "no color" over the presentation\'s color through the file', () => {
    const tag = slideRefsTag({ refs: ['a'], refLook: { form: 'full', color: undefined } })!;
    const back = cleanSlideRefs(JSON.parse(tag)).refLook!;
    expect(back.form).toBe('full');
    expect('color' in back).toBe(true);
    expect(back.color).toBeUndefined();
  });
});

describe('F870: your own theme\'s title slide footer color', () => {
  it('is kept when themes are read from the settings file', () => {
    const [t] = parseThemes([{ id: 'mine-1', name: 'Mine', titleSlide: { background: '#112233', titleColor: '#ffffff', textColor: '#cccccc', footerColor: '#abcdef' } }]);
    expect(t.titleSlide?.footerColor).toBe('#abcdef');
  });
});
