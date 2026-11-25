// @vitest-environment jsdom
//
// The Spectrum window's pointer, wheel and key handling: drag a range to zoom (Esc drops it), double-
// click for everything, the wheel for peak height only, Shift+drag and the ppm scale to move along,
// the left edge, the arrow keys and the top bar's buttons; the view per nucleus; the trace drawn just
// above the axis with the tallest peak at three quarters of the height.
//
// The spectrum is the ethyl acetate sample of Settings ▸ NMR Prediction (Fulmer, G. R. et al.,
// Organometallics 2010, 29, 2176–2179, doi:10.1021/om100106e, Table 1: in CDCl₃, CH₂ 4.12 q, CH₃CO
// 2.05 s, CH₃ 1.26 t, J = 7 Hz), drawn by the window itself.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoRange, sampleSpectrumData, spectrumSvg, SpectrumWindow, type SpectrumData } from '../src/ui/nmr-spectrum';
import { ppmAt } from '../src/ui/nmr-view';

class RO { observe() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

// drawing waits for the next frame: the frames are run by hand, so each test sees what was drawn
let frames: FrameRequestCallback[] = [];
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => frames.push(cb);
const flush = () => { const f = frames; frames = []; for (const cb of f) cb(0); };

// jsdom has no PointerEvent: a mouse event carrying the pointer's fields
function ptr(type: string, x: number, o: { y?: number; id?: number; shift?: boolean; touch?: boolean } = {}): MouseEvent {
  const e = new MouseEvent(type, { clientX: x, clientY: o.y ?? 50, button: 0, bubbles: true, cancelable: true, shiftKey: !!o.shift });
  Object.defineProperty(e, 'pointerId', { value: o.id ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: o.touch ? 'touch' : 'mouse' });
  return e;
}

function setup(first: SpectrumData = sampleSpectrumData(400, false)) {
  document.body.innerHTML = '';
  let data: SpectrumData | null = first;
  const host = {
    data: () => data, hover: vi.fn(), copyPicture: vi.fn(async () => {}), putOnCanvas: vi.fn(), flash: vi.fn(), closed: vi.fn(),
    solvent: { ids: ['CDCl3', 'C6D6'], label: (s: string) => s.replace('3', '₃').replace('6', '₆'), get: () => 'CDCl3', set: vi.fn() },
    checkData: vi.fn(), openSettings: vi.fn(),
  };
  const win = new SpectrumWindow(host);
  win.open(null);
  flush();
  const plot = win.el.querySelector<HTMLElement>('.nmr-spec-plot')!;
  // jsdom lays nothing out: the plot is drawn 200 px wide from x = 0
  const full = autoRange(first);
  const drag = (x0: number, x1: number, o: { shift?: boolean; on?: Element } = {}) => {
    (o.on ?? plot).dispatchEvent(ptr('pointerdown', x0, o));
    plot.dispatchEvent(ptr('pointermove', (x0 + x1) / 2, o));
    plot.dispatchEvent(ptr('pointermove', x1, o));
    plot.dispatchEvent(ptr('pointerup', x1, o));
    flush();
  };
  return { win, host, plot, full, drag, setData: (d: SpectrumData | null) => { data = d; win.refresh(); flush(); } };
}

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });

describe('zooming to a range', () => {
  it('shades the range while dragging and zooms to it on release, y fitted again', () => {
    const { win, plot, full } = setup();
    plot.dispatchEvent(ptr('pointerdown', 40));
    plot.dispatchEvent(ptr('pointermove', 100));
    flush();
    expect(plot.querySelector('svg .sp-band')).not.toBeNull();
    plot.dispatchEvent(ptr('pointerup', 100));
    flush();
    expect(plot.querySelector('svg .sp-band')).toBeNull();
    const r = win.shownView.range!;
    expect(r.hi).toBeCloseTo(ppmAt(40, 200, full), 9);
    expect(r.lo).toBeCloseTo(ppmAt(100, 200, full), 9);
    expect(win.shownView.y).toBe(1);
  });

  it('treats a short drag as a click, and Esc while dragging drops the range without closing', () => {
    const { win, plot, drag } = setup();
    drag(50, 52);
    expect(win.shownView.range).toBeNull();
    plot.dispatchEvent(ptr('pointerdown', 40));
    plot.dispatchEvent(ptr('pointermove', 120));
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flush();
    expect(plot.querySelector('svg .sp-band')).toBeNull();
    plot.dispatchEvent(ptr('pointerup', 120));
    expect(win.shownView.range).toBeNull();
    expect(win.visible).toBe(true);
  });

  it('shows everything again on double-click, Reset View and 0, height reset too', () => {
    const { win, plot, drag } = setup();
    for (const reset of [
      () => plot.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
      () => win.el.querySelector<HTMLButtonElement>('.nmr-fit')!.click(),
      () => plot.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true })),
    ]) {
      drag(40, 100);
      win.el.querySelector<HTMLButtonElement>('.nmr-yin')!.click();
      expect(win.shownView.range).not.toBeNull();
      reset();
      expect(win.shownView).toEqual({ range: null, y: 1 });
    }
  });

  it('resets on a double tap', () => {
    const { win, plot, drag } = setup();
    drag(40, 100);
    for (let i = 0; i < 2; i++) { plot.dispatchEvent(ptr('pointerdown', 80, { touch: true })); plot.dispatchEvent(ptr('pointerup', 80, { touch: true })); }
    expect(win.shownView.range).toBeNull();
  });
});

describe('the peak height', () => {
  it('changes with the wheel and a pinch, never the ppm range, and keeps the page from scrolling or zooming', () => {
    const { win, plot, drag } = setup();
    drag(40, 100);
    const r = win.shownView.range;
    const up = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    plot.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(win.shownView.y).toBeGreaterThan(1);
    expect(win.shownView.range).toEqual(r);
    const y = win.shownView.y;
    const pinch = new WheelEvent('wheel', { deltaY: 10, ctrlKey: true, bubbles: true, cancelable: true });
    plot.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(win.shownView.y).toBeLessThan(y);
  });

  it('changes with + and −, the Up and Down arrows and a drag on the left edge', () => {
    const { win, plot, drag } = setup();
    win.el.querySelector<HTMLButtonElement>('.nmr-yin')!.click();
    expect(win.shownView.y).toBeCloseTo(1.25, 9);
    win.el.querySelector<HTMLButtonElement>('.nmr-yout')!.click();
    expect(win.shownView.y).toBeCloseTo(1, 9);
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(win.shownView.y).toBeCloseTo(1.25, 9);
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(win.shownView.y).toBeCloseTo(1, 9);
    const edge = plot.querySelector('.nmr-yzone')!;
    edge.dispatchEvent(ptr('pointerdown', 5, { y: 100 }));
    plot.dispatchEvent(ptr('pointermove', 5, { y: 40 }));
    plot.dispatchEvent(ptr('pointerup', 5, { y: 40 }));
    expect(win.shownView.y).toBeGreaterThan(1.5);
    expect(win.shownView.range).toBeNull();
  });
});

describe('moving along', () => {
  it('moves with Shift+drag, the ppm scale and the arrows, stopping at the ends', () => {
    const { win, plot, drag, full } = setup();
    drag(80, 120);
    const r0 = win.shownView.range!, span = r0.hi - r0.lo;
    drag(100, 120, { shift: true });
    const r1 = win.shownView.range!;
    expect(r1.hi - r1.lo).toBeCloseTo(span, 9);
    expect(r1.hi).toBeCloseTo(r0.hi + (20 / 200) * span, 9);
    drag(100, 80, { on: plot.querySelector('.nmr-xzone')! });
    expect(win.shownView.range!.hi).toBeCloseTo(r0.hi, 9);
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(win.shownView.range!.hi).toBeCloseTo(r0.hi + span / 10, 9);
    drag(0, 199, { shift: true });
    drag(0, 199, { shift: true });
    expect(win.shownView.range!.hi).toBeCloseTo(full.hi, 9);
  });

  it('does nothing when the whole spectrum shows', () => {
    const { win, drag } = setup();
    drag(100, 150, { shift: true });
    expect(win.shownView.range).toBeNull();
  });
});

describe('the view kept', () => {
  it('per nucleus, and started again for new shifts', () => {
    const h = sampleSpectrumData(400, false);
    const c: SpectrumData = { nuc: '13C', sticks: [{ shift: 170.9, n: 1, row: 0 }, { shift: 60.4, n: 1, row: 1 }, { shift: 21.0, n: 1, row: 2 }, { shift: 14.2, n: 1, row: 3 }] };
    const { win, drag, setData } = setup(h);
    drag(40, 100);
    const r = win.shownView.range;
    setData(c);
    expect(win.shownView.range).toBeNull();
    setData(h);
    expect(win.shownView.range).toEqual(r);
    // another field keeps the view (the shifts are the same) …
    setData(sampleSpectrumData(600, false));
    expect(win.shownView.range).toEqual(r);
    // … a new prediction with other shifts starts again
    const moved = sampleSpectrumData(400, false);
    moved.spec!.groups[0] = { ...moved.spec!.groups[0], shift: 4.2 };
    setData(moved);
    expect(win.shownView.range).toBeNull();
  });
});

describe('the top bar', () => {
  it('has the solvent, Check Data…, the settings gear and the view buttons, in that order', () => {
    const { win, host } = setup();
    const bar = win.el.querySelector('.nmr-spec-bar')!;
    const names = [...bar.querySelectorAll('select, button')].slice(0, 6).map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Solvent', 'Check Data…', 'NMR Settings', 'Decrease Intensity', 'Increase Intensity', 'Reset View']);
    expect([...bar.querySelectorAll('.nmr-prev, .nmr-next')].map((b) => b.getAttribute('aria-label'))).toEqual(['Previous Signal', 'Next Signal']);
    for (const b of bar.querySelectorAll('button')) expect(b.title).not.toBe('');
    bar.querySelector<HTMLButtonElement>('.nmr-spec-check')!.click();
    bar.querySelector<HTMLButtonElement>('.nmr-spec-gear')!.click();
    const sel = bar.querySelector<HTMLSelectElement>('.nmr-spec-solvent')!;
    sel.value = 'C6D6';
    sel.dispatchEvent(new Event('change'));
    expect(host.checkData).toHaveBeenCalledOnce();
    expect(host.openSettings).toHaveBeenCalledOnce();
    expect(host.solvent.set).toHaveBeenCalledWith('C6D6');
  });
});

describe('the drawing', () => {
  const ys = (svg: string) => [...(/class="nmr-spec[^]*?<path d="([^"]+)" class="sp-line"/.exec(svg)?.[1] ?? '').matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
  it('puts the tallest peak at three quarters of the height and the baseline above the axis', () => {
    const d = sampleSpectrumData(400, false);
    // no labels: 4 px at the top, the axis 15 px from the bottom, the baseline 4 px above it
    const svg = spectrumSvg(d, { w: 400, h: 200, hi: 10, lo: -0.5, labels: false, hotRow: null, yZoom: 1 });
    const y = ys(svg), base = 200 - 15 - 4, height = 200 - 4 - 15 - 4;
    expect(Math.max(...y)).toBeCloseTo(base, 1);
    expect(Math.max(...y)).toBeLessThan(200 - 15);
    expect(Math.min(...y)).toBeCloseTo(base - 0.75 * height, 0);
    // twice the intensity: the tallest peak (the 2.05 singlet) runs off the top, clipped there
    expect(Math.min(...ys(spectrumSvg(d, { w: 400, h: 200, hi: 10, lo: -0.5, labels: false, hotRow: null, yZoom: 2 })))).toBeCloseTo(base - height, 1);
  });
  it('fits the height to the tallest peak in the zoomed range', () => {
    const d = sampleSpectrumData(400, false);
    // around the 1.26 triplet only: its middle line reaches three quarters
    const svg = spectrumSvg(d, { w: 400, h: 200, hi: 1.5, lo: 1.0, labels: false, hotRow: null, yZoom: 1 });
    expect(Math.min(...ys(svg))).toBeCloseTo(181 - 0.75 * 177, 0);
  });
  it('carries the trace color', () => {
    const d = sampleSpectrumData(400, false);
    expect(spectrumSvg(d, { w: 200, h: 100, hi: 5, lo: 0, labels: false, hotRow: null })).toContain('data-trace="blue"');
    localStorage.setItem('ci-nmr-trace', 'maroon');
    expect(spectrumSvg(d, { w: 200, h: 100, hi: 5, lo: 0, labels: false, hotRow: null })).toContain('data-trace="maroon"');
  });
});

/** The y values of the predicted trace (or the measured one) in an SVG. */
const pathYs = (svg: string, cls = 'sp-line') => [...(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector(`path.${cls}`)?.getAttribute('d') ?? '').matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));

describe('after a zoom', () => {
  // the window in jsdom is 200 × 120 px; with the default labels (one line) the band at the top is
  // 18 px, the axis 15 px from the bottom and the baseline 4 px above it: base 101, height 83
  const base = 101, height = 83;

  it('fits the height again to the range now showing when it moves', () => {
    const { win, plot, drag } = setup();
    // zoom to about 4.3–3.3 ppm (the quartet), then move half a width at a time toward low ppm: the
    // 2.05 singlet, four times as tall as the quartet's lines, is drawn at 3/4 of the height, not cut off flat
    drag(Math.round(((10 - 4.3) / 10.5) * 200), Math.round(((10 - 3.3) / 10.5) * 200));
    for (let i = 0; i < 4; i++) drag(150, 50, { shift: true });
    const r = win.shownView.range!;
    expect(r.hi).toBeGreaterThan(2.05);
    expect(r.lo).toBeLessThan(2.05);
    const y = pathYs(plot.querySelector('svg')!.outerHTML);
    expect(Math.min(...y)).toBeCloseTo(base - 0.75 * height, 0);
  });

  it('says so when no peak is in the range', () => {
    const { plot, drag } = setup();
    drag(Math.round(((10 - 9) / 10.5) * 200), Math.round(((10 - 8) / 10.5) * 200));
    expect(plot.querySelector('.sp-empty')?.textContent).toBe('No peaks in this range. Double-click to show everything.');
    plot.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flush();
    expect(plot.querySelector('.sp-empty')).toBeNull();
  });

  it('finds the row under the pointer and highlights its peaks', () => {
    const { win, host, plot, drag } = setup();
    drag(Math.round(((10 - 4.4) / 10.5) * 200), Math.round(((10 - 3.8) / 10.5) * 200));
    const r = win.shownView.range!;
    plot.dispatchEvent(ptr('pointermove', ((r.hi - 4.12) / (r.hi - r.lo)) * 200));
    flush();
    expect(host.hover).toHaveBeenLastCalledWith(0);
    expect(plot.querySelector('svg .sp-hot')).not.toBeNull();
    plot.dispatchEvent(ptr('pointermove', ((r.hi - 3.9) / (r.hi - r.lo)) * 200));
    expect(host.hover).toHaveBeenLastCalledWith(null);
  });

  it('keeps the view inside the spectrum when a measured list goes away', () => {
    const wide = sampleSpectrumData(400, false);
    wide.measured = { links: [], marks: [{ ppm: 12, text: 'extra 1H', sev: 'bad' }] };
    const { win, drag, setData } = setup(wide);
    drag(0, 20);
    expect(win.shownView.range!.hi).toBeGreaterThan(10.5);
    setData(sampleSpectrumData(400, false));
    const r = win.shownView.range!, full = autoRange(sampleSpectrumData(400, false));
    expect(r.hi).toBeLessThanOrEqual(full.hi);
    expect(r.lo).toBeGreaterThanOrEqual(full.lo);
  });
});

describe('the left edge and the keys', () => {
  it('still zooms to a range from the left edge when dragged sideways, so the highest ppm is reachable', () => {
    const { win, plot, full } = setup();
    const edge = plot.querySelector('.nmr-yzone')!;
    expect(edge.getAttribute('aria-label')).toBeTruthy();
    expect(plot.querySelector('.nmr-xzone')!.getAttribute('aria-label')).toBeTruthy();
    edge.dispatchEvent(ptr('pointerdown', 0, { y: 60 }));
    plot.dispatchEvent(ptr('pointermove', 30, { y: 61 }));
    plot.dispatchEvent(ptr('pointerup', 60, { y: 61 }));
    const r = win.shownView.range!;
    expect(r.hi).toBeCloseTo(full.hi, 9);
    expect(r.lo).toBeCloseTo(ppmAt(60, 200, full), 9);
    expect(win.shownView.y).toBe(1);
  });

  it('leaves Ctrl, Cmd and Alt keys to the browser, and keeps the plain ones from it', () => {
    const { win, plot, drag } = setup();
    drag(40, 100);
    const r = win.shownView.range;
    const key = (k: string, o: KeyboardEventInit = {}) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }); plot.dispatchEvent(e); return e; };
    for (const e of [key('-', { ctrlKey: true }), key('-', { metaKey: true }), key('0', { ctrlKey: true }), key('=', { metaKey: true }), key('ArrowLeft', { altKey: true }), key('ArrowRight', { altKey: true })]) expect(e.defaultPrevented).toBe(false);
    expect(win.shownView).toEqual({ range: r, y: 1 });
    expect(key('-').defaultPrevented).toBe(true);
    expect(win.shownView.y).toBeCloseTo(0.8, 9);
    expect(key('+').defaultPrevented).toBe(true);
    expect(key('0').defaultPrevented).toBe(true);
    expect(win.shownView).toEqual({ range: null, y: 1 });
  });

  it('keeps the page from scrolling under the wheel even with nothing shown', () => {
    const { plot, setData } = setup();
    setData(null);
    const e = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    plot.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('draws a burst of pointer moves once, on the next frame', () => {
    const { plot } = setup();
    frames = [];
    for (let x = 10; x < 60; x += 5) plot.dispatchEvent(ptr('pointermove', x));
    expect(frames.length).toBe(1);
    flush();
    expect(plot.querySelector('svg .sp-cursor')).not.toBeNull();
  });
});

describe('a measured list against the prediction', () => {
  // the sample with its list pasted back (Settings ▸ NMR Prediction's preview): 200 × 200 px, no
  // labels, so the band at the top is 4 px and the axis 15 px from the bottom; the line between the
  // two traces is at 4 + 181 / 2 = 94.5 px
  const d = sampleSpectrumData(400, true), mid = 94.5;
  const draw = (compare: 'inverted' | 'stacked' | 'overlay') => spectrumSvg(d, { w: 400, h: 200, hi: 5, lo: 0.5, labels: false, hotRow: null, overlay: true, compare, yZoom: 1 });

  it('inverted: measured above the line, predicted hanging below, each 4 px clear of it, tallest at 3/4', () => {
    const svg = draw('inverted'), m = pathYs(svg, 'sp-meas'), p = pathYs(svg);
    expect(Math.max(...m)).toBeCloseTo(mid - 4, 1);
    expect(Math.min(...m)).toBeCloseTo(mid - 4 - 0.75 * (mid - 4 - 4), 0);
    expect(Math.min(...p)).toBeCloseTo(mid + 4, 1);
    expect(Math.max(...p)).toBeCloseTo(mid + 4 + 0.75 * (200 - 15 - 8 - mid), 0);
  });

  it('stacked: both upright, the predicted baseline 4 px above the axis', () => {
    const svg = draw('stacked'), m = pathYs(svg, 'sp-meas'), p = pathYs(svg);
    expect(Math.max(...m)).toBeCloseTo(mid - 4, 1);
    expect(Math.max(...p)).toBeCloseTo(200 - 15 - 4, 1);
    expect(Math.min(...p)).toBeCloseTo(181 - 0.75 * (200 - 15 - 8 - mid), 0);
    expect(svg).toContain(`y="${mid + 4 + 10}" class="sp-tick">Predicted`);
  });

  it('overlay: both on one baseline 4 px above the axis, the same height', () => {
    const svg = draw('overlay'), m = pathYs(svg, 'sp-meas'), p = pathYs(svg);
    expect(Math.max(...m)).toBeCloseTo(181, 1);
    expect(Math.max(...p)).toBeCloseTo(181, 1);
    expect(Math.min(...p)).toBeCloseTo(181 - 0.75 * 177, 0);
    expect(Math.min(...m)).toBeCloseTo(181 - 0.75 * 177, 0);
  });
});
