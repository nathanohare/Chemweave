// Scroll bars along the bottom and right of the drawing, so the endless drawing area has a sense
// of where you are: the bars cover everything drawn (with room around it) and the part on
// screen. Drag a thumb to move across, click the track to move a screenful, or use the wheel as
// before. They sit over the drawing's edges and can be switched off (View > Scroll Bars). They are
// a thin line until in use: while the view moves or the pointer is near them (scrollbar-fade.ts).

import type { Rect } from '../geom';
import { InUse, nearBar } from './scrollbar-fade';

/**
 * What scrolls: a drawing's extent, or a slide held `tight` (Presentation): the view stops a band
 * of `tight` screen pixels past the slide's edges, and a slide narrower or shorter than the window
 * stays in the middle that way, as in PowerPoint.
 */
export type ScrollContent = Rect & { tight?: number };

export interface ScrollView {
  view: { ox: number; oy: number; scale: number };
  width: number;
  height: number;
}

/** The thumb's start and length along a track `track` px long, for a range and the part on screen (both in points). */
export function thumbFor(range: [number, number], seen: [number, number], track: number, min = 24): { start: number; size: number } {
  const span = Math.max(1e-6, range[1] - range[0]);
  const size = Math.min(track, Math.max(min, ((seen[1] - seen[0]) / span) * track));
  const room = track - size;
  const along = span - (seen[1] - seen[0]);
  const start = along > 1e-6 ? ((seen[0] - range[0]) / along) * room : 0;
  return { start: Math.max(0, Math.min(room, start)), size };
}

/** The room left round the drawing at the scroll bars' ends, and where the wheel stops: a quarter of the window. */
export const EDGE_ROOM = 0.25;

/** What the bars cover: the drawing (with a quarter of a screen of room round it) and the part on screen. */
export function scrollRange(content: ScrollContent | null, seen: Rect, scale = 1): Rect {
  const w = seen.x2 - seen.x1, h = seen.y2 - seen.y1;
  // a slide: just its band of room (the thumb then fills the bar when the slide fits)
  const mx = content?.tight !== undefined ? content.tight / scale : w * EDGE_ROOM;
  const my = content?.tight !== undefined ? content.tight / scale : h * EDGE_ROOM;
  // with nothing drawn, a screen either way, so there is somewhere to go
  const c = content
    ? { x1: content.x1 - mx, y1: content.y1 - my, x2: content.x2 + mx, y2: content.y2 + my }
    : { x1: seen.x1 - w, y1: seen.y1 - h, x2: seen.x2 + w, y2: seen.y2 + h };
  return { x1: Math.min(c.x1, seen.x1), y1: Math.min(c.y1, seen.y1), x2: Math.max(c.x2, seen.x2), y2: Math.max(c.y2, seen.y2) };
}

/**
 * Where the left (or top) of what is on screen may go along one axis, given where it is now:
 * between `lo` and `hi`. A view already past an end (after a zoom or a drag) may come back but
 * not go further out. Points.
 */
export function clampPan(now: number, want: number, lo: number, hi: number): number {
  return Math.min(Math.max(want, Math.min(now, lo)), Math.max(now, hi));
}

/**
 * The ends for one axis: a drawing bigger than the window scrolls until its edge (with room) shows;
 * a smaller one stays on screen. A tight slide (room `band`, points) scrolls to its edges and that
 * band past them; one that fits stays centered.
 */
export function panEnds(c1: number, c2: number, screen: number, band?: number): [number, number] {
  if (band !== undefined) {
    if (c2 - c1 + 2 * band <= screen) { const mid = (c1 + c2) / 2 - screen / 2; return [mid, mid]; }
    return [c1 - band, c2 + band - screen];
  }
  const m = screen * EDGE_ROOM;
  const a = c1 - m, b = c2 + m - screen;
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * Keep the view's offsets (ox, oy) inside the drawing's edges after a scroll that started at
 * `from`, so scrolling stops at the edge (with a quarter of a screen of room) rather than going
 * on for ever. Nothing drawn, nothing to stop at.
 */
export function stopAtEdge(r: ScrollView, content: ScrollContent | null, from: { ox: number; oy: number }): void {
  if (!content || !r.width || !r.height) return;
  // a slide is held inside its ends whatever the view was before
  if (content.tight !== undefined) { keepInSlide(r, content); return; }
  const s = r.view.scale;
  const w = r.width / s, h = r.height / s;
  const x = clampPan(-from.ox / s, -r.view.ox / s, ...panEnds(content.x1, content.x2, w));
  const y = clampPan(-from.oy / s, -r.view.oy / s, ...panEnds(content.y1, content.y2, h));
  r.view.ox = -x * s;
  r.view.oy = -y * s;
}

/**
 * Hold the view on a tight slide (after a scroll, a zoom or a resize): its edges no further in
 * than the band past them, and centered along a way it fits. Nothing to hold for other content.
 */
export function keepInSlide(r: ScrollView, content: ScrollContent | null): void {
  if (!content || content.tight === undefined || !r.width || !r.height) return;
  const s = r.view.scale, band = content.tight / s;
  const [x1, x2] = panEnds(content.x1, content.x2, r.width / s, band);
  const [y1, y2] = panEnds(content.y1, content.y2, r.height / s, band);
  const x = Math.min(Math.max(-r.view.ox / s, x1), x2), y = Math.min(Math.max(-r.view.oy / s, y1), y2);
  r.view.ox = -x * s;
  r.view.oy = -y * s;
}

/**
 * Scroll between slides (Settings ▸ Navigation): the wheel turned on past a slide's top or bottom
 * edge goes to the slide after or before it. A notch of the wheel (or a swipe on a touchpad, which
 * sends many small steps) goes one slide; the steps that follow straight after are let go, so one
 * swipe doesn't run through the deck.
 */
export class SlideFlip {
  private sum = 0;
  private last = -Infinity;
  private until = -Infinity;
  /** How far past the edge (pixels) goes to the next slide, how long after a turn the wheel is let go, and the pause that starts afresh (ms). */
  constructor(private step = 60, private rest = 350, private gap = 400) {}

  /** The wheel moved `dy` pixels past the edge at `now` (ms): 1 next slide, -1 the one before, 0 not yet. */
  push(dy: number, now: number): -1 | 0 | 1 {
    if (now - this.last > this.gap || Math.sign(dy) !== Math.sign(this.sum)) this.sum = 0;
    this.last = now;
    // just after a turn: let the wheel go (a touchpad swipe's small steps keep it let go until they stop)
    if (now < this.until) { if (Math.abs(dy) < this.step) this.until = now + this.rest; return 0; }
    this.sum += dy;
    if (Math.abs(this.sum) < this.step) return 0;
    const dir = this.sum > 0 ? 1 : -1;
    this.sum = 0;
    this.until = now + this.rest;
    return dir;
  }

  /** The wheel moved within the slide: past-the-edge steps start afresh. */
  reset(): void { this.sum = 0; }
}

export class Scrollbars {
  private h: HTMLDivElement;
  private v: HTMLDivElement;
  private hThumb: HTMLDivElement;
  private vThumb: HTMLDivElement;
  private key = '';
  /** Kept still while a thumb is dragged, so the thumb stays under the pointer. */
  private frozen: Rect | null = null;
  private range: Rect = { x1: 0, y1: 0, x2: 1, y2: 1 };
  shown = true;
  /** The view last drawn, to tell a scroll (the bars grow) from the drawing changing. */
  private viewKey = '';
  private inside = false;
  private dragging = false;
  private use: InUse;

  constructor(host: HTMLElement, private r: ScrollView, private content: () => ScrollContent | null, private moved: () => void) {
    const make = (axis: 'h' | 'v') => {
      const bar = document.createElement('div');
      bar.className = `scrollbar scrollbar-${axis}`;
      bar.setAttribute('aria-hidden', 'true');
      const thumb = document.createElement('div');
      thumb.className = 'scroll-thumb';
      bar.append(thumb);
      host.append(bar);
      return [bar, thumb] as const;
    };
    [this.h, this.hThumb] = make('h');
    [this.v, this.vThumb] = make('v');
    this.drag(this.hThumb, 'h');
    this.drag(this.vThumb, 'v');
    this.page(this.h, 'h');
    this.page(this.v, 'v');
    this.use = new InUse((on) => { this.h.classList.toggle('sb-full', on); this.v.classList.toggle('sb-full', on); });
    // (the drawing's box, measured when the pointer comes in and when it changes size, not on every move)
    let box: DOMRect | null = null;
    new ResizeObserver(() => { box = null; }).observe(host);
    host.addEventListener('pointermove', (e) => {
      this.inside = true;
      if (e.pointerType === 'touch') return;
      if (this.dragging) { this.use.poke(); return; }
      if (e.buttons) return;
      box ??= host.getBoundingClientRect();
      if (nearBar(box, e.clientX, e.clientY, !this.v.hidden, !this.h.hidden)) this.use.poke();
    }, { passive: true });
    host.addEventListener('pointerenter', () => { this.inside = true; box = null; }, { passive: true });
    host.addEventListener('pointerleave', () => { this.inside = false; if (!this.dragging) this.use.off(); }, { passive: true });
  }

  /** Called every frame: redraws the bars when the view, the window or the drawing changed. */
  update(version: number): void {
    const { ox, oy, scale } = this.r.view;
    const key = `${ox}|${oy}|${scale}|${this.r.width}|${this.r.height}|${version}|${this.shown}`;
    if (key === this.key) return;
    this.key = key;
    // the view moved (a scroll, a pan, a zoom) with the pointer over the drawing: the bars grow for a while
    const viewKey = `${ox}|${oy}|${scale}`;
    if (viewKey !== this.viewKey) { if (this.viewKey && this.inside) this.use.poke(); this.viewKey = viewKey; }
    this.h.hidden = this.v.hidden = !this.shown;
    if (!this.shown || !this.r.width || !this.r.height) return;
    const seen = this.seen();
    const range = this.frozen ?? scrollRange(this.content(), seen, this.r.view.scale);
    this.range = range;
    // nothing to scroll to that way (the whole slide or drawing is in view): no bar (UI audit U21)
    const eps = 0.5 / this.r.view.scale;
    this.h.hidden = range.x1 >= seen.x1 - eps && range.x2 <= seen.x2 + eps;
    this.v.hidden = range.y1 >= seen.y1 - eps && range.y2 <= seen.y2 + eps;
    const ht = thumbFor([range.x1, range.x2], [seen.x1, seen.x2], this.h.clientWidth);
    const vt = thumbFor([range.y1, range.y2], [seen.y1, seen.y2], this.v.clientHeight);
    this.hThumb.style.transform = `translateX(${ht.start}px)`;
    this.hThumb.style.width = `${ht.size}px`;
    this.vThumb.style.transform = `translateY(${vt.start}px)`;
    this.vThumb.style.height = `${vt.size}px`;
  }

  private seen(): Rect {
    const { ox, oy, scale } = this.r.view;
    return { x1: -ox / scale, y1: -oy / scale, x2: (this.r.width - ox) / scale, y2: (this.r.height - oy) / scale };
  }

  private drag(thumb: HTMLElement, axis: 'h' | 'v'): void {
    thumb.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      thumb.setPointerCapture(e.pointerId);
      this.frozen = this.range;
      this.dragging = true;
      this.use.poke();
      thumb.classList.add('dragging');
      let last = axis === 'h' ? e.clientX : e.clientY;
      const move = (ev: PointerEvent) => {
        const now = axis === 'h' ? ev.clientX : ev.clientY;
        const bar = axis === 'h' ? this.h : this.v;
        const track = axis === 'h' ? bar.clientWidth : bar.clientHeight;
        const thumbLen = axis === 'h' ? thumb.offsetWidth : thumb.offsetHeight;
        const seen = this.seen();
        const span = axis === 'h' ? this.range.x2 - this.range.x1 - (seen.x2 - seen.x1) : this.range.y2 - this.range.y1 - (seen.y2 - seen.y1);
        const room = Math.max(1, track - thumbLen);
        // points of drawing per pixel of thumb travel
        const k = Math.max(0, span) / room;
        this.scrollBy(axis, (now - last) * k);
        last = now;
      };
      const up = () => {
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
        thumb.removeEventListener('pointercancel', up);
        thumb.classList.remove('dragging');
        this.dragging = false;
        if (this.inside) this.use.poke(); else this.use.off();
        this.frozen = null;
        this.key = '';
        this.moved();
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
      thumb.addEventListener('pointercancel', up);
    });
  }

  /** A click on the track moves most of a screenful toward the click. */
  private page(bar: HTMLElement, axis: 'h' | 'v'): void {
    bar.addEventListener('pointerdown', (e) => {
      if (e.target !== bar || e.button !== 0) return;
      e.preventDefault();
      const thumb = axis === 'h' ? this.hThumb : this.vThumb;
      const t = thumb.getBoundingClientRect();
      const before = axis === 'h' ? e.clientX < t.left : e.clientY < t.top;
      const seen = this.seen();
      const screen = axis === 'h' ? seen.x2 - seen.x1 : seen.y2 - seen.y1;
      this.scrollBy(axis, (before ? -1 : 1) * 0.9 * screen);
    });
  }

  /** Move what is on screen by `d` points along an axis. */
  private scrollBy(axis: 'h' | 'v', d: number): void {
    if (!d) return;
    const from = { ox: this.r.view.ox, oy: this.r.view.oy };
    if (axis === 'h') this.r.view.ox -= d * this.r.view.scale;
    else this.r.view.oy -= d * this.r.view.scale;
    stopAtEdge(this.r, this.content(), from);
    this.moved();
  }
}
