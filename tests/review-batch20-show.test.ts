// @vitest-environment jsdom
//
// Review batch 20, the slide show and presenter view:
//  F172 the wheel is one step for a notch or a swipe, not one for every wheel event;
//  F762 a rehearsal's last slide is timed to the move past it, not to the end screen being left;
//  F763 a show stopped while the microphone opens leaves no rehearsal behind;
//  F764 a slide visited twice has its last visit's time, and the run's total is of those times;
//  F765 a rehearsal started while the last one's recordings finish keeps its own state;
//  F766 at a kiosk a number then Enter doesn't jump;
//  F767 with no screen known for this window the audience gets a window, not the whole screen;
//  F790 a link out of a zoomed section forgets the zoom's way back;
//  F791 to F793 the laser goes when the mouse leaves, its listeners go when the ink is removed, a stroke stays on its slide.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/deck/slide-view', () => ({ paintSlide: () => ({ x: 0, y: 0, k: 1 }), drawDrawing: () => undefined }));
const asked = vi.hoisted(() => ({ titles: [] as string[] }));
vi.mock('../src/ui/ask', () => ({ ask: async (title: string) => { asked.titles.push(title); return {}; } }));
const mic = vi.hoisted(() => ({ open: null as null | ((ok: boolean) => void), closed: 0, finishNever: false }));
vi.mock('../src/deck/narration', () => ({
  Recorder: class {
    open() { return new Promise<boolean>((r) => { mic.open = r; }); }
    start() {}
    pause() {}
    finish() { return mic.finishNever ? new Promise<Blob | null>(() => undefined) : Promise.resolve(null); }
    close() { mic.closed++; }
  },
}));
const tauri = vi.hoisted(() => ({ made: [] as { label: string; opts: Record<string, unknown> }[], monitors: [] as unknown[], current: null as unknown }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => tauri.monitors.length > 0 }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    static getByLabel() { return Promise.resolve(null); }
    constructor(label: string, opts: Record<string, unknown>) { tauri.made.push({ label, opts }); }
  },
}));
vi.mock('@tauri-apps/api/window', () => ({ availableMonitors: async () => tauri.monitors, currentMonitor: async () => tauri.current, getCurrentWindow: () => ({ isFullscreen: async () => false, setFullscreen: async () => undefined }) }));

import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { Presenter } from '../src/ui/present';
import { openAudience } from '../src/ui/presenter-view';
import { ShowActions } from '../src/ui/show-actions';
import { ShowInk } from '../src/ui/show-ink';

const noop = () => undefined;
const ctx = new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop), set: () => true });
(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx;
let now = 0;
beforeEach(() => {
  now = 1000;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  (globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 16) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
  asked.titles = []; mic.closed = 0; mic.finishNever = false; mic.open = null;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });
/** Let `s` seconds go by (the clock the rehearsal reads, and the timers). */
const wait = (s: number) => { now += s * 1000; vi.advanceTimersByTime(s * 1000); };

function deckOf(n: number): Deck {
  const d = Deck.blank(new Doc());
  d.attach();
  for (let i = 1; i < n; i++) d.addSlide();
  return d;
}
type Priv = {
  wheelSlide(e: unknown): void; onKey(e: unknown): void; closeSlide(): void; elapsed(): number; next(): void;
  rehearse: { times: Map<number, number>; before: number } | null;
};
const priv = (p: Presenter) => p as unknown as Priv;
const proto = Presenter.prototype as unknown as Priv;

describe('F172: the wheel in the slide show', () => {
  const wheel = (deltaY: number, target: Element = document.body, deltaMode = 0) => ({ deltaY, deltaMode, target, preventDefault: vi.fn() });
  const fake = () => ({ wheelSum: 0, wheelAt: -Infinity, wheelLockUntil: -Infinity, next: vi.fn(), prev: vi.fn() });

  it('goes on one slide for a whole trackpad swipe of small turns', () => {
    const f = fake();
    for (let i = 0; i < 40; i++) { proto.wheelSlide.call(f, wheel(8)); now += 8; }
    expect(f.next).toHaveBeenCalledTimes(1);
    expect(f.prev).not.toHaveBeenCalled();
  });

  it('goes on one slide, not many, in a running show', async () => {
    const p = new Presenter();
    await p.start(deckOf(6), 0, { windowed: true });
    const root = document.querySelector('.present')!;
    for (let i = 0; i < 40; i++) { root.dispatchEvent(new WheelEvent('wheel', { deltaY: 8, bubbles: true, cancelable: true })); now += 8; }
    expect((p as unknown as { player: { i: number } }).player.i).toBe(1);
    p.stop();
  });

  it('goes on one slide for each notch of a mouse wheel, and back for the other way', () => {
    const f = fake();
    proto.wheelSlide.call(f, wheel(100)); now += 400;
    proto.wheelSlide.call(f, wheel(100)); now += 400;
    proto.wheelSlide.call(f, wheel(-100));
    expect(f.next).toHaveBeenCalledTimes(2);
    expect(f.prev).toHaveBeenCalledTimes(1);
  });

  it('leaves the notes and the bars alone to scroll', () => {
    const notes = document.createElement('div');
    notes.className = 'rehearse-notes';
    const f = fake();
    const e = wheel(300, notes);
    proto.wheelSlide.call(f, e);
    expect(f.next).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

describe('F766: a kiosk', () => {
  const press = (f: object, key: string) => proto.onKey.call(f, { key, preventDefault: noop, stopPropagation: noop, metaKey: false, ctrlKey: false, altKey: false, code: '' });
  const fake = (kiosk: boolean) => ({ root: {}, opts: { kiosk }, grid: null, menu: null, ink: null, typed: '', go: vi.fn(), next: vi.fn(), stop: vi.fn(), player: { lookBack: () => false } });

  it('does not jump to a slide for a number then Enter', () => {
    const f = fake(true);
    for (const k of ['5', 'Enter']) press(f, k);
    expect(f.go).not.toHaveBeenCalled();
    expect(f.next).not.toHaveBeenCalled();
  });

  it('still ends on Esc', () => {
    const f = fake(true);
    press(f, 'Escape');
    expect(f.stop).toHaveBeenCalled();
  });

  it('jumps in a show that is not at a kiosk', () => {
    const f = fake(false);
    for (const k of ['5', 'Enter']) press(f, k);
    expect(f.go).toHaveBeenCalledWith(4);
  });
});

describe('F764: a slide visited twice in a rehearsal', () => {
  it('has the time of its last visit, and the run\'s total is the sum of the slides\' times', () => {
    const r = { i: 1, t0: now, paused: null, times: new Map([[1, 10], [2, 4]]), before: 14, rec: null, pending: [], recordings: new Map() };
    const f = { rehearse: r, elapsed: proto.elapsed };
    now += 5000;
    proto.closeSlide.call(f);
    expect(r.times.get(1)).toBe(5);
    expect(r.before).toBe(9);
  });
});

describe('rehearsals', () => {
  async function rehearsal(deck: Deck, record = false) {
    const p = new Presenter();
    p.onRehearsed = vi.fn();
    const started = p.start(deck, 0, { windowed: true, rehearse: true, record });
    return { p, started };
  }

  it('F762: times the last slide to the move past it, not to leaving the end screen', async () => {
    const { p, started } = await rehearsal(deckOf(1));
    await started;
    wait(5);
    priv(p).next();
    wait(30);
    p.stop();
    await vi.advanceTimersByTimeAsync(10);
    const kept = (p.onRehearsed as ReturnType<typeof vi.fn>).mock.calls[0][0] as { times: Map<number, number>; total: number };
    expect(kept.times.get(0)).toBeCloseTo(5, 0);
    expect(kept.total).toBeCloseTo(5, 0);
  });

  it('F763: a show stopped while the microphone opens leaves no rehearsal behind', async () => {
    const { p, started } = await rehearsal(deckOf(2), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mic.open).not.toBeNull();
    p.stop();
    mic.open!(true);
    await started;
    expect(priv(p).rehearse).toBeNull();
    expect(mic.closed).toBe(1);
    expect(document.querySelector('.rehearse-bar')).toBeNull();
    // a show after it is no rehearsal: no Keep Timings, and no clock left running
    const q = new Presenter();
    await q.start(deckOf(2), 0, { windowed: true });
    q.stop();
    await vi.advanceTimersByTimeAsync(10);
    expect(asked.titles).toEqual([]);
  });

  it('F765: a rehearsal started while the last one\'s recordings finish is not wiped out by it', async () => {
    mic.finishNever = true;
    const { p, started } = await rehearsal(deckOf(2), true);
    await vi.advanceTimersByTimeAsync(0);
    mic.open!(true);
    await started;
    wait(2);
    priv(p).next();
    p.stop();
    // (its recording never says it has finished: the end waits up to 5 seconds)
    const again = p.start(deckOf(2), 0, { windowed: true, rehearse: true });
    await again;
    const second = priv(p).rehearse;
    expect(second).not.toBeNull();
    wait(6);
    await vi.advanceTimersByTimeAsync(10);
    expect(priv(p).rehearse).toBe(second);
  });
});

describe('F767: the audience window', () => {
  const monitor = (name: string, x: number) => ({ name, position: { x, y: 0, toLogical: () => ({ x, y: 0 }) }, size: { toLogical: () => ({ width: 1920, height: 1080 }) }, scaleFactor: 1 });
  beforeEach(() => { tauri.made = []; });

  it('is a window, not the whole screen, when this window\'s screen is not known', async () => {
    tauri.monitors = [monitor('Only', 0)];
    tauri.current = null;
    const got = await openAudience();
    expect(got.where).toBe('window');
    expect(tauri.made[0].opts.fullscreen).toBeUndefined();
  });

  it('is full screen on the other screen when there is one', async () => {
    tauri.monitors = [monitor('A', 0), monitor('B', 1920)];
    tauri.current = tauri.monitors[0];
    const got = await openAudience();
    expect(got.where).toBe('other-screen');
    expect(tauri.made[0].opts).toMatchObject({ fullscreen: true, x: 1920 });
  });
});

describe('F790: a zoom that comes back', () => {
  function actions(n: number) {
    const deck = { slides: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) };
    const player = { i: 1, zoom: vi.fn(), beforeNextSlide: undefined as undefined | (() => boolean), first: 0, last: n - 1 };
    const hooks = { go: (i: number) => { player.i = i; }, next: noop, prev: noop, end: noop, open: noop, zoomed: noop };
    const a = new ShowActions(deck as never, player as never, document.createElement('canvas'), hooks as never);
    return { a, player };
  }
  const rect = { x1: 0, y1: 0, x2: 10, y2: 10 };

  it('is forgotten by a link to a slide outside the section zoomed into', () => {
    const { a, player } = actions(10);
    // slide 2 zooms to slide 5 (the section goes to slide 7) and comes back
    a.follow('#slide=5', { back: true, to: '#slide=7', rect });
    player.i = 4;
    a.follow('#slide=10');
    expect(player.i).toBe(9);
    // the next click goes on from slide 10: no zoom back out
    expect(player.beforeNextSlide!()).toBe(false);
    expect(player.zoom).toHaveBeenCalledTimes(1);
  });

  it('is kept by a link to a slide inside the section', () => {
    const { a, player } = actions(10);
    a.follow('#slide=5', { back: true, to: '#slide=7', rect });
    a.follow('#slide=6');
    player.i = 6;
    expect(player.beforeNextSlide!()).toBe(true);
    expect(player.zoom).toHaveBeenLastCalledWith(1, rect, true);
  });

  it('is forgotten by Last Slide', () => {
    const { a, player } = actions(10);
    a.follow('#slide=5', { back: true, to: '#slide=7', rect });
    a.follow('#last');
    expect(player.beforeNextSlide!()).toBe(false);
  });
});

describe('F791 to F793: ink in the show', () => {
  function ink() {
    const root = document.createElement('div');
    const canvas = document.createElement('canvas');
    root.append(canvas);
    document.body.append(root);
    let slide = 1;
    const lasers: unknown[] = [];
    const changed: number[] = [];
    const i = new ShowInk(root, canvas, { slide: () => slide, place: () => ({ x: 0, y: 0, k: 1 }), laser: (p) => { lasers.push(p); }, changed: (n) => { changed.push(n); } }, false);
    const at = (type: string, x = 5, y = 5) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 });
    return { root, canvas, i, lasers, changed, at, go: (n: number) => { slide = n; } };
  }

  it('F791: the laser goes when the mouse leaves the slide', () => {
    const t = ink();
    t.i.use('laser');
    t.root.dispatchEvent(t.at('pointermove'));
    expect(t.lasers).toHaveLength(1);
    t.root.dispatchEvent(new MouseEvent('pointerleave'));
    expect(t.lasers[t.lasers.length - 1]).toBeNull();
  });

  it('F792: nothing follows the mouse once the ink is removed', () => {
    const t = ink();
    t.i.use('laser');
    t.i.remove();
    t.root.dispatchEvent(t.at('pointermove'));
    t.root.dispatchEvent(new MouseEvent('pointerleave'));
    expect(t.lasers).toEqual([]);
  });

  it('F793: a stroke stays on the slide it began on when the slide changes before it ends', () => {
    const t = ink();
    t.i.use('pen');
    const overlay = t.root.querySelector('.show-ink')!;
    overlay.dispatchEvent(t.at('pointerdown', 5, 5));
    overlay.dispatchEvent(t.at('pointermove', 30, 30));
    t.go(2);
    overlay.dispatchEvent(t.at('pointerup', 40, 40));
    expect([...t.i.all().keys()]).toEqual([1]);
    expect(t.changed).toEqual([1]);
  });
});
