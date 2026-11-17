// The zoom controls at the right of the status bar outside the drawing modes (Document,
// Spreadsheet): the same slider, percent and fit button as Presentation's, so zoom is in one
// place and one shape in every mode.
import { pctToSlider, sliderToPct } from './zoom-slider';

export interface StatusZoomHost {
  /** The zoom now, in percent. */
  get(): number;
  set(pct: number): void;
  /** What the fit button does (Page Width, 100%), and its name. */
  fit: { label: string; run(): void; icon: string };
  /** Give the keyboard back to the page after a click. */
  refocus(): void;
  /** Lowest and highest zoom the mode takes, in percent. */
  min: number;
  max: number;
}

export interface StatusZoom { el: HTMLElement; show(): void }

const ICON = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/** Arrows out to the left and right edges of a page: fit the width. */
export const FIT_WIDTH_ICON = ICON('<rect x="4.5" y="2.5" width="7" height="11" rx=".6"/><path d="M1 8h2.5M15 8h-2.5M2.2 6.6L.9 8l1.3 1.4M13.8 6.6L15.1 8l-1.3 1.4"/>');
/** 1:1 in a frame: actual size. */
export const ACTUAL_ICON = ICON('<rect x="1.5" y="3.5" width="13" height="9" rx=".8"/><path d="M5 6.2v3.8M11 6.2v3.8" stroke-linecap="round"/><circle cx="8" cy="7" r=".5" fill="currentColor" stroke="none"/><circle cx="8" cy="9.4" r=".5" fill="currentColor" stroke="none"/>');

export function statusZoom(host: StatusZoomHost): StatusZoom {
  const el = document.createElement('span');
  el.className = 'sb-zoom-set';
  const group = document.createElement('span');
  group.className = 'sb-zoom';
  const btn = (text: string, title: string, run: () => void, html = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    if (html) b.innerHTML = text; else b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { run(); show(); host.refocus(); });
    return b;
  };
  const clamp = (p: number) => Math.min(host.max, Math.max(host.min, p));
  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'sb-zoom-range';
  range.min = '0'; range.max = '100'; range.step = '1'; range.value = '50';
  range.title = 'Zoom';
  range.setAttribute('aria-label', 'Zoom');
  range.addEventListener('input', () => { host.set(clamp(sliderToPct(Number(range.value)))); show(true); });
  range.addEventListener('change', () => host.refocus());
  const pct = btn('100%', 'Zoom to 100%', () => host.set(100));
  pct.className = 'sb-zoom-pct';
  const fit = btn(host.fit.icon, host.fit.label, () => host.fit.run(), true);
  fit.className = 'sb-fit';
  group.append(btn('−', 'Zoom Out', () => host.set(clamp(host.get() * 0.8))), range, btn('+', 'Zoom In', () => host.set(clamp(host.get() * 1.25))));
  el.append(group, pct, fit);
  function show(dragging = false): void {
    const now = Math.round(host.get());
    const text = `${now}%`;
    if (pct.textContent !== text) pct.textContent = text;
    // (not while it is being dragged: it would fight the hand)
    if (!dragging && document.activeElement !== range) range.value = String(Math.round(pctToSlider(now)));
  }
  return { el, show };
}
