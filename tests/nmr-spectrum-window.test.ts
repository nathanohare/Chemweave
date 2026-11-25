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
  const plot = win.el.querySelector<HTMLElement>('.nmr-spec-plot')!;
  // jsdom lays nothing out: the plot is drawn 200 px wide from x = 0
  const full = autoRange(first);
  const drag = (x0: number, x1: number, o: { shift?: boolean; on?: Element } = {}) => {
    (o.on ?? plot).dispatchEvent(ptr('pointerdown', x0, o));
    plot.dispatchEvent(ptr('pointermove', (x0 + x1) / 2, o));
    plot.dispatchEvent(ptr('pointermove', x1, o));
    plot.dispatchEvent(ptr('pointerup', x1, o));
  };
  return { win, host, plot, full, drag, setData: (d: SpectrumData | null) => { data = d; win.refresh(); } };
}

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });

describe('zooming to a range', () => {
  it('shades the range while dragging and zooms to it on release, y fitted again', () => {
    const { win, plot, full } = setup();
    plot.dispatchEvent(ptr('pointerdown', 40));
    plot.dispatchEvent(ptr('pointermove', 100));
    expect(plot.querySelector('svg .sp-band')).not.toBeNull();
    plot.dispatchEvent(ptr('pointerup', 100));
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
    void drag;
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
    expect(names).toEqual(['Solvent', 'Check Data…', 'NMR Settings', 'Decrease intensity', 'Increase intensity', 'Reset View']);
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
