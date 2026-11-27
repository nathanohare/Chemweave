// @vitest-environment jsdom
// Code review batch 13, the slide show: F195 (a custom show that plays a slide twice), F194 (a
// sound that plays across slides), F864 (a Fade over a part's own see-through), F866 (Morph
// with Show Without Animation), F867 (a timed slide after a keyframe fly), F861 (a link on a
// shape not yet in), F862 (text laid out once for the pointer), F865 (Morph paints each part on its own).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const painted = vi.hoisted(() => ({ screens: 0, parts: [] as { shapes: number[]; x1?: number }[] }));
const layouts = vi.hoisted(() => ({ n: 0, lines: [] as { para: number; y: number; ascent: number; descent: number; x1: number; x2: number }[] }));
vi.mock('../src/deck/slide-view', async (orig) => ({
  ...(await orig<typeof import('../src/deck/slide-view')>()),
  paintSlide: (c: HTMLCanvasElement, w: number, h: number, dpr: number, p: { size: { w: number; h: number } }) => {
    painted.screens++;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const k = Math.min(w / p.size.w, h / p.size.h);
    return { x: (w - p.size.w * k) / 2, y: (h - p.size.h * k) / 2, k };
  },
  drawDrawing: (_ctx: unknown, doc: { shapes: Map<number, { x1: number }> }) => { painted.parts.push({ shapes: [...doc.shapes.keys()], x1: [...doc.shapes.values()][0]?.x1 }); },
  drawCanvasUnder: () => undefined,
  drawScreen: () => undefined,
  drawKeyTitle: () => undefined,
}));
vi.mock('../src/text/layout', async (orig) => ({
  ...(await orig<typeof import('../src/text/layout')>()),
  layoutText: () => { layouts.n++; return { box: { x1: 0, y1: 0, x2: 200, y2: layouts.lines.length ? 20 * layouts.lines.length : 30 }, lines: layouts.lines } as never; },
}));
// partStates never reports an Appear as running (it takes no time), so what the player does with one is asked of it through this
const forced = vi.hoisted(() => ({ running: false }));
vi.mock('../src/deck/animation', async (orig) => {
  const real = await orig<typeof import('../src/deck/animation')>();
  return {
    ...real,
    partStates: ((...a: Parameters<typeof real.partStates>) => {
      const states = real.partStates(...a);
      if (forced.running) for (const k of states.keys()) states.set(k, { visible: true, running: { anim: a[1][0], p: 0.5 } });
      return states;
    }) as typeof real.partStates,
  };
});
vi.mock('../src/links', async (orig) => ({
  ...(await orig<typeof import('../src/links')>()),
  linkAtPoint: () => ({ link: 'https://example.org/' }),
}));

import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { Player, SlideFrames } from '../src/deck/playback';
import { newAnim } from '../src/deck/animation';
import { cameraAnim } from '../src/deck/canvas';

/** A canvas 2D context that remembers saves, restores and the see-through at each picture drawn. */
function recordingContext() {
  const state = { saves: 0, restores: 0, alphaAtDraw: [] as number[], globalAlpha: 1, stack: [] as number[] };
  const noop = () => undefined;
  const target: Record<string, unknown> = state;
  return {
    state,
    ctx: new Proxy(target, {
      get(t, k: string) {
        if (k === 'save') return () => { state.saves++; state.stack.push(state.globalAlpha); };
        if (k === 'restore') return () => { state.restores++; const a = state.stack.pop(); if (a !== undefined) state.globalAlpha = a; };
        if (k === 'drawImage') return () => { state.alphaAtDraw.push(state.globalAlpha); };
        if (k === 'globalAlpha') return state.globalAlpha;
        return k in t ? t[k] : noop;
      },
      set(t, k: string, v) { if (k === 'globalAlpha') state.globalAlpha = v as number; else t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D,
  };
}

const noopCtx = new Proxy({}, { get: () => () => undefined, set: () => true });
beforeEach(() => {
  painted.screens = 0; painted.parts.length = 0; layouts.n = 0;
  (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => noopCtx;
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==';

function deckOf(n: number): Deck {
  const d = Deck.blank(new Doc());
  d.attach();
  for (let i = 1; i < n; i++) d.addSlide('blank');
  d.go(0);
  return d;
}

describe('F195: a custom show that plays a slide more than once', () => {
  it('goes through the whole order, forward and back', () => {
    const d = deckOf(3);
    const p = new Player(document.createElement('canvas'), d);
    p.resize(960, 540, 1);
    p.order = [0, 1, 0, 2];
    p.show(0);
    const seen: number[] = [p.i];
    for (let k = 0; k < 3; k++) { p.next(); seen.push(p.i); }
    expect(seen).toEqual([0, 1, 0, 2]);
    expect(p.position).toBe(3);
    const back: number[] = [];
    for (let k = 0; k < 3; k++) { p.prev(); back.push(p.i); }
    expect(back).toEqual([0, 1, 0]);
    expect(p.position).toBe(0);
  });
});

describe('F194: a sound set to play across slides', () => {
  function setup() {
    // jsdom has no sound: a stand-in that plays and pauses
    const playing = new WeakSet<object>();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return !playing.has(this); } });
    HTMLMediaElement.prototype.play = function () { playing.add(this); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { playing.delete(this); };
    const host = document.createElement('div');
    document.body.append(host);
    const canvas = document.createElement('canvas');
    host.append(canvas);
    const d = deckOf(2);
    const doc = d.docOf(0);
    doc.edit('sound', () => doc.addShape({ kind: 'picture', x1: 10, y1: 10, x2: 40, y2: 40, src: DOT, px: { w: 1, h: 1 }, video: { src: 'data:audio/mpeg;base64,AAAA', audio: true, across: true } } as never));
    const p = new Player(canvas, d);
    p.resize(960, 540, 1);
    return { host, p };
  }
  it('goes on playing when the slide changes, and stops with the show', () => {
    const { host, p } = setup();
    p.show(0);
    expect(host.querySelectorAll('audio').length).toBe(1);
    p.next();
    vi.advanceTimersByTime(100);
    const kept = host.querySelectorAll('audio');
    expect(kept.length).toBe(1);
    expect(kept[0].paused).toBe(false);
    p.stop();
    expect(host.querySelectorAll('audio').length).toBe(0);
    host.remove();
  });
  it('is still the one sound when the show comes back to its slide', () => {
    const { host, p } = setup();
    p.show(0);
    const first = host.querySelector('audio')!;
    p.next();
    vi.advanceTimersByTime(100);
    p.prev();
    vi.advanceTimersByTime(100);
    const all = [...host.querySelectorAll('audio')];
    expect(all).toHaveLength(1);
    expect(all[0]).toBe(first);
    expect(first.paused).toBe(false);
    p.stop();
    host.remove();
  });
});

describe('F863: a part leaving by Disappear, drawn', () => {
  it('leaves no save without its restore', () => {
    const d = deckOf(1);
    const doc = d.docOf(0);
    const sh = doc.edit('s', () => doc.addShape({ kind: 'rect', x1: 100, y1: 100, x2: 200, y2: 160 } as never)) as { id: number };
    const f = new SlideFrames(d.page(0), doc, [newAnim({ kind: 'shape', id: sh.id }, 'appear', true)], 960, 540, 1, '#fff');
    const { ctx, state } = recordingContext();
    forced.running = true;
    try { f.draw(ctx, 0, 0.5); } finally { forced.running = false; }
    expect(state.saves).toBeGreaterThan(0);
    expect(state.saves).toBe(state.restores);
  });
});

describe('F864: a Fade, drawn', () => {
  function frames(effect: 'appear' | 'fade', exit: boolean): SlideFrames {
    const d = deckOf(1);
    const doc = d.docOf(0);
    const sh = doc.edit('s', () => doc.addShape({ kind: 'rect', x1: 100, y1: 100, x2: 200, y2: 160 } as never)) as { id: number };
    const anim = { ...newAnim({ kind: 'shape', id: sh.id }, effect, exit), dur: 1 };
    return new SlideFrames(d.page(0), doc, [anim], 960, 540, 1, '#fff');
  }
  it('a Fade multiplies the see-through the part already has', () => {
    const f = frames('fade', false);
    const { ctx, state } = recordingContext();
    state.globalAlpha = 0.5;
    f.draw(ctx, 0, 0.5);
    // the part is drawn last: half way in (0.5) of a part already at half
    expect(state.alphaAtDraw.at(-1)).toBeCloseTo(0.25, 6);
    expect(state.saves).toBe(state.restores);
  });
});

describe('F866: Morph with Show Without Animation', () => {
  it('keeps the first slide\'s parts that have an entrance animation', () => {
    const d = deckOf(2);
    const a = d.docOf(0);
    const sh = a.edit('s', () => a.addShape({ kind: 'rect', x1: 100, y1: 100, x2: 200, y2: 160 } as never)) as { id: number };
    d.slides[0].anims = [newAnim({ kind: 'shape', id: sh.id }, 'fade')];
    const b = d.docOf(1);
    b.edit('s', () => b.addShape({ kind: 'rect', x1: 300, y1: 100, x2: 400, y2: 160 } as never));
    d.slides[1].transition = { kind: 'morph', dur: 1 };
    const p = new Player(document.createElement('canvas'), d);
    p.noAnimation = true;
    p.resize(960, 540, 1);
    p.show(0);
    painted.parts.length = 0;
    p.next();
    vi.advanceTimersByTime(50);
    p.paint();
    // the shape of the first slide (x = 100) is one of the morph's pieces
    expect(painted.parts.some((x) => x.x1 === 100)).toBe(true);
  });
});

describe('F865: Morph paints each part on its own', () => {
  it('does not paint a whole screen for every part', () => {
    const d = deckOf(2);
    for (const i of [0, 1]) {
      const doc = d.docOf(i);
      doc.edit('s', () => { for (let k = 0; k < 6; k++) doc.addShape({ kind: 'rect', x1: 10 + k * 100, y1: 100, x2: 80 + k * 100, y2: 160 } as never); });
    }
    d.slides[1].transition = { kind: 'morph', dur: 1 };
    const p = new Player(document.createElement('canvas'), d);
    p.resize(960, 540, 1);
    p.show(0);
    painted.screens = 0;
    p.next();
    vi.advanceTimersByTime(50);
    p.paint();
    // the two slides' backgrounds, a few more for the slide itself: not 12 more for the parts
    expect(painted.screens).toBeLessThan(8);
    expect(painted.parts.length).toBeGreaterThanOrEqual(12);
  });
});

describe('F867: a timed slide after a keyframe fly', () => {
  it('goes on when the move ends', () => {
    const d = deckOf(1);
    d.addCanvasSlide();
    const c = d.slides[1].canvas!;
    d.setCanvas({ ...c, keys: [...c.keys, { id: 2, x: 2000, y: 0, zoom: 1 }] }, 'Add keyframe', 1);
    d.slides[1].anims = [cameraAnim(2)];
    d.slides[1].transition = { kind: 'none', dur: 0, advanceAfter: 1 };
    const p = new Player(document.createElement('canvas'), d);
    p.resize(1600, 900, 1);
    const past = vi.fn();
    p.onPastEnd = past;
    p.show(1);
    p.flyTo(1, true);
    expect(p.busy).toBe(true);
    // the slide's time runs out during the flight
    vi.advanceTimersByTime(60_000);
    expect(p.busy).toBe(false);
    expect(past).toHaveBeenCalled();
  });
});

describe('F861 and F862: the pointer in the show', () => {
  function textFrames(): { f: SlideFrames; d: Deck; id: number; cap: number } {
    const d = deckOf(1);
    const doc = d.docOf(0);
    const sh = doc.edit('s', () => doc.addShape({ kind: 'rect', x1: 100, y1: 100, x2: 300, y2: 200, link: 'https://example.org/' } as never)) as { id: number };
    const cap = doc.edit('t', () => doc.addCaption({ x: 400, y: 300, runs: [{ text: 'See this', link: 'https://example.org/' }] })) as { id: number };
    const anims = [newAnim({ kind: 'shape', id: sh.id }, 'appear')];
    return { f: new SlideFrames(d.page(0), doc, anims, 960, 540, 1, '#fff'), d, id: sh.id, cap: cap.id };
  }
  it('a link on a shape that has not come in yet is not clickable, and is once it has', () => {
    const { f } = textFrames();
    expect(f.shapeActionAt(150, 150, 0)).toBeNull();
    expect(f.shapeActionAt(150, 150, 1)?.link).toBe('https://example.org/');
  });
  it('a link on a shape that a trigger brings in is clickable once the trigger has played', () => {
    const d = deckOf(1);
    const doc = d.docOf(0);
    let link = 0, trig = 0;
    doc.edit('s', () => {
      link = doc.addShape({ kind: 'rect', x1: 100, y1: 100, x2: 300, y2: 200, link: 'https://example.org/' } as never).id;
      trig = doc.addShape({ kind: 'rect', x1: 500, y1: 100, x2: 600, y2: 200 } as never).id;
    });
    const anims = [{ ...newAnim({ kind: 'shape', id: link }, 'appear'), trigger: { kind: 'shape' as const, id: trig } }];
    const f = new SlideFrames(d.page(0), doc, anims, 960, 540, 1, '#fff');
    const key = [...f.triggers.keys()][0];
    expect(f.shapeActionAt(150, 150, 0)).toBeNull();
    expect(f.shapeActionAt(150, 150, 0, new Map([[key, { done: 1, t: -1 }]]))?.link).toBe('https://example.org/');
  });
  it('text that comes in a paragraph at a time is clickable only where its paragraphs are in', () => {
    layouts.lines = [0, 1, 2].map((k) => ({ para: k, y: 20 * k + 15, ascent: 15, descent: 5, x1: 0, x2: 100 }));
    try {
      const d = deckOf(1);
      const doc = d.docOf(0);
      const cap = doc.edit('t', () => doc.addCaption({ x: 400, y: 300, runs: [{ text: 'one\ntwo\nthree', link: 'https://example.org/' }] })) as { id: number };
      const anims = [{ ...newAnim({ kind: 'caption', id: cap.id }, 'appear'), byPara: true }];
      const f = new SlideFrames(d.page(0), doc, anims, 960, 540, 1, '#fff');
      // one click played: the first paragraph is in, the third is not
      expect(f.linkAt(410, 310, 1)).toBe('https://example.org/');
      expect(f.linkAt(410, 350, 1)).toBeNull();
      expect(f.linkAt(410, 350, 3)).toBe('https://example.org/');
    } finally { layouts.lines = []; }
  });
  it('lays each text out once, however often the pointer moves', () => {
    const { f } = textFrames();
    layouts.n = 0;
    for (let k = 0; k < 20; k++) f.linkAt(410, 305, 0);
    expect(layouts.n).toBe(1);
  });
});
