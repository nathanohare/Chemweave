// Scroll bars that keep out of the way (UI style guide S98): every scroll bar is a thin line while
// nothing is happening, and grows to its full width while it is in use: while the pane scrolls,
// or the pointer comes near the bar. A few seconds after the last of that, or as soon as the
// pointer leaves the pane, it is thin again.
//
// The page's own scroll bars (documents, spreadsheets, SI pages, panels, lists) take their look
// from app.css: the room a bar takes stays the same, so nothing moves when it grows, and the thumb
// is drawn thin or full inside it. This file marks the panes in use with `data-sb`; app.css draws
// the full bar only on a marked pane under the pointer. The Canvas's own bars (scrollbars.ts) use
// `inUse` and `nearBar` from here.

/** How long a bar stays full after the last scroll or the pointer near it (ms). */
export const SCROLLBAR_IDLE_MS = 2000;
/** How close (px) to a pane's right or bottom edge the pointer has to be to grow its bar. */
export const NEAR_BAR_PX = 40;

/** The pointer at (x, y) is near a bar along the right (`v`) or bottom (`h`) of `r`. */
export function nearBar(r: { left: number; top: number; right: number; bottom: number }, x: number, y: number, v: boolean, h: boolean, reach = NEAR_BAR_PX): boolean {
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
  return (v && x >= r.right - reach) || (h && y >= r.bottom - reach);
}

/** A bar in use: shown full until `idle` ms after the last `poke`, then thin again (`set` says which). */
export class InUse {
  private timer: ReturnType<typeof setTimeout> | null = null;
  on = false;
  constructor(private set: (on: boolean) => void, private idle = SCROLLBAR_IDLE_MS) {}

  /** Something happened: full now, thin `idle` ms after the last one. */
  poke(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.off(), this.idle);
    if (!this.on) { this.on = true; this.set(true); }
  }

  /** Thin now (the pointer left the pane). */
  off(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.on) { this.on = false; this.set(false); }
  }
}

/** Panes marked in use, each with its own timer. */
const marked = new WeakMap<Element, InUse>();

function mark(el: Element): void {
  let u = marked.get(el);
  if (!u) {
    u = new InUse((on) => { if (on) el.setAttribute('data-sb', ''); else el.removeAttribute('data-sb'); });
    marked.set(el, u);
  }
  u.poke();
}

/** The element lets its content scroll along x and y (read when needed: a pane's overflow can change with its class). */
function scrollWays(el: Element): { x: boolean; y: boolean } {
  const cs = getComputedStyle(el);
  const can = (o: string) => o === 'auto' || o === 'scroll' || o === 'overlay';
  return { x: can(cs.overflowX), y: can(cs.overflowY) };
}

/** The system draws scroll bars over the page, taking no room (macOS): they already fade by themselves. */
export function overlayScrollbars(doc: Document = document): boolean {
  const probe = doc.createElement('div');
  probe.style.cssText = 'position:absolute;top:-200px;left:-200px;width:100px;height:100px;overflow:scroll;visibility:hidden';
  doc.body.append(probe);
  const none = probe.offsetWidth - probe.clientWidth === 0;
  probe.remove();
  return none;
}

let installed = false;

/** Watch the page's scroll bars: mark a pane while it scrolls or the pointer is near its bar. */
export function installScrollbarFade(doc: Document = document): void {
  if (installed) return;
  installed = true;
  // (measured before the page's own look applies, which would give every bar room)
  if (overlayScrollbars(doc)) return;
  doc.documentElement.classList.add('sb-fade');
  // a pane scrolling (the wheel, the keyboard, a drag of its thumb, a jump to an item)
  doc.addEventListener('scroll', (e) => {
    const t = e.target;
    if (t instanceof Element) mark(t);
    else if (t === doc && doc.scrollingElement) mark(doc.scrollingElement);
  }, { capture: true, passive: true });
  // the pointer near a pane's bar: checked at most once a frame, on the panes round the pointer
  let at: { x: number; y: number; t: EventTarget | null } | null = null;
  let queued = false;
  const check = () => {
    queued = false;
    const p = at;
    if (!p) return;
    for (let el = p.t instanceof Element ? p.t : null, depth = 0; el && depth < 40; el = el.parentElement, depth++) {
      // (sizes first, which cost nothing once laid out; the style only for a pane with more to show)
      const tall = el.scrollHeight > el.clientHeight + 1, wide = el.scrollWidth > el.clientWidth + 1;
      if (!tall && !wide) continue;
      const w = scrollWays(el);
      const v = w.y && tall, h = w.x && wide;
      if ((v || h) && nearBar(el.getBoundingClientRect(), p.x, p.y, v, h)) mark(el);
    }
  };
  doc.addEventListener('pointermove', (e) => {
    // (not while a button is held: drawing, dragging or selecting; a thumb being dragged stays full by itself)
    if (e.pointerType === 'touch' || e.buttons) return;
    at = { x: e.clientX, y: e.clientY, t: e.target };
    if (!queued) { queued = true; requestAnimationFrame(check); }
  }, { capture: true, passive: true });
}
