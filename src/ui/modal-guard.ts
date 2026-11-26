// What every window opened with showModal() does, whichever part of the program opens it.
//
// A modal window makes the rest of the page inert. In the desktop app with the title bar in the
// menu row (src/ui/title-bar.ts), the window's own buttons (Minimize, Maximize, Close) and the
// strip that moves the window are part of the page, so a modal window used to block them: with
// the bottom of the program off the screen and a window's buttons below the screen's edge, there
// was no way to close the window or move the program back. So:
//   - each modal window gets its own copy of the title strip at the very top (inside the window,
//     so it isn't inert), with the window buttons and the strip that moves the program;
//   - a modal window is placed below the title strip and inside the part of the program that is on
//     the screen, so its heading and its buttons can always be reached.
//
//   - clicking outside a modal window closes it, asking first if something in it was changed
//     (src/ui/outside-click.ts).
//
// It works by wrapping HTMLDialogElement.showModal once, at start-up, so no window can miss it.

import { watchOutsideClick } from './outside-click';

/** Makes a title strip for a modal window (the desktop app with its own title bar sets it). */
type StripMaker = () => HTMLElement;

let makeStrip: StripMaker | null = null;
/** Height of the title strip, in CSS pixels (0: none). */
let titleHeight = 0;
/** How much of the program is off the screen at each edge, in CSS pixels. */
let offScreen = { top: 0, right: 0, bottom: 0, left: 0 };

/** The modal windows open now (showModal'd and not yet closed), oldest first. */
const open: HTMLDialogElement[] = [];
/** The title strip each modal window was given. */
const strips = new WeakMap<HTMLDialogElement, HTMLElement>();
/** The size limits this code set on a window (so it can take them back off). */
const fitted = new WeakMap<HTMLDialogElement, { maxHeight?: string; maxWidth?: string }>();

/** The smallest height kept for windows, however little of the program is on the screen. */
const MIN_ROOM = 160;
/** Space kept between a window and the edge of the room it has. */
const EDGE = 8;

/** Give modal windows a title strip (null: none, the system's title bar is shown). */
export function setModalTitleStrip(make: StripMaker | null, height = 0): void {
  makeStrip = make;
  titleHeight = make ? Math.max(0, height) : 0;
  for (const d of open) {
    strips.get(d)?.remove();
    strips.delete(d);
    addStrip(d);
  }
  layout();
}

/** Say how much of the program is off the screen at each edge (CSS pixels; null: all of it is on). */
export function setOffScreen(edges: { top: number; right: number; bottom: number; left: number } | null): void {
  const e = edges ?? { top: 0, right: 0, bottom: 0, left: 0 };
  offScreen = { top: Math.max(0, e.top), right: Math.max(0, e.right), bottom: Math.max(0, e.bottom), left: Math.max(0, e.left) };
  layout();
}

/** The room modal windows are placed in: insets from the edges of the page, in CSS pixels. */
export function dialogRoom(): { top: number; right: number; bottom: number; left: number } {
  const h = window.innerHeight || 0, w = window.innerWidth || 0;
  let top = Math.max(titleHeight, offScreen.top);
  let bottom = offScreen.bottom;
  // (when nearly all of the program is off the screen, keep a usable height: the heading first)
  if (h && h - top - bottom < MIN_ROOM) {
    bottom = Math.max(0, h - top - MIN_ROOM);
    if (h - top - bottom < MIN_ROOM) top = Math.max(0, h - MIN_ROOM);
  }
  let left = offScreen.left, right = offScreen.right;
  if (w && w - left - right < MIN_ROOM) { left = 0; right = 0; }
  return { top, right, bottom, left };
}

/** Put the room in the page's CSS variables and fit each open modal window into it. */
function layout(): void {
  const r = dialogRoom();
  const s = document.documentElement.style;
  s.setProperty('--dlg-top', `${r.top}px`);
  s.setProperty('--dlg-right', `${r.right}px`);
  s.setProperty('--dlg-bottom', `${r.bottom}px`);
  s.setProperty('--dlg-left', `${r.left}px`);
  s.setProperty('--title-h', `${titleHeight}px`);
  // (a window taken off the page, or moved into the Settings window's pages, is no longer modal)
  for (let i = open.length - 1; i >= 0; i--) if (!stillModal(open[i])) closed(open[i]);
  for (const d of open) fit(d);
}

/** Whether a window this code saw opened modal still is. */
function stillModal(d: HTMLDialogElement): boolean {
  if (!d.isConnected || !d.open || d.classList.contains('embedded')) return false;
  return !knowsModal() || d.matches(':modal');
}

let modalSelector: boolean | null = null;
/** Whether this browser knows :modal (older Safari engines and jsdom don't: trust showModal there). */
function knowsModal(): boolean {
  if (modalSelector === null) {
    try { modalSelector = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('selector(:modal)'); } catch { modalSelector = false; }
  }
  return modalSelector;
}

/** Set (or take back) a size limit this code puts on a window; one the window set itself stays. */
function limit(d: HTMLDialogElement, prop: 'maxHeight' | 'maxWidth', px: number | null): void {
  const mine = fitted.get(d) ?? {};
  if (mine[prop] !== undefined && d.style[prop] === mine[prop]) d.style[prop] = '';
  delete mine[prop];
  if (px !== null && !d.style[prop]) {
    d.style[prop] = `${Math.max(MIN_ROOM - 2 * EDGE, Math.floor(px))}px`;
    mine[prop] = d.style[prop];
  }
  fitted.set(d, mine);
}

/** Keep a modal window within its room, so its heading and its own buttons stay on the screen. */
function fit(d: HTMLDialogElement): void {
  limit(d, 'maxHeight', null);
  limit(d, 'maxWidth', null);
  const r = dialogRoom();
  const h = window.innerHeight || 0, w = window.innerWidth || 0;
  const roomH = h - r.top - r.bottom - 2 * EDGE, roomW = w - r.left - r.right - 2 * EDGE;
  const cs = getComputedStyle(d);
  const capH = parseFloat(cs.maxHeight), capW = parseFloat(cs.maxWidth);
  if (roomH > 0 && !(capH <= roomH)) limit(d, 'maxHeight', roomH);
  if (roomW > 0 && !(capW <= roomW)) limit(d, 'maxWidth', roomW);
  // a window placed lower by its own margin (Rotate in 3D, Arrange) still ends inside the room
  const box = d.getBoundingClientRect();
  const overH = box.bottom - (h - r.bottom - EDGE), overW = box.right - (w - r.right - EDGE);
  if (box.height > 0 && overH > 0.5) limit(d, 'maxHeight', box.height - overH);
  if (box.width > 0 && overW > 0.5) limit(d, 'maxWidth', box.width - overW);
}

/** Give a window the title strip, or put it back when the window has redrawn its contents. */
function addStrip(d: HTMLDialogElement): void {
  if (!makeStrip) return;
  let strip = strips.get(d);
  if (strip?.parentNode === d) return;
  if (!strip) {
    strip = makeStrip();
    strip.classList.add('modal-title-strip');
    strips.set(d, strip);
  }
  d.append(strip);
}

/** Watches each open modal window for redrawn contents (palette-ui, the assistant's log). */
const watchers = new WeakMap<HTMLDialogElement, MutationObserver>();

function closed(d: HTMLDialogElement): void {
  const i = open.indexOf(d);
  if (i >= 0) open.splice(i, 1);
  d.classList.remove('is-modal');
  watchers.get(d)?.disconnect();
  watchers.delete(d);
  strips.get(d)?.remove();
  strips.delete(d);
  limit(d, 'maxHeight', null);
  limit(d, 'maxWidth', null);
}

/** Windows that already have this code's close listener. */
const listened = new WeakSet<HTMLDialogElement>();
let installed = false;

/** Wrap showModal so every modal window gets the title strip and its room. Once, at start-up. */
export function installModalGuard(): void {
  if (installed || typeof HTMLDialogElement === 'undefined') return;
  const proto = HTMLDialogElement.prototype;
  const own = proto.showModal;
  if (typeof own !== 'function') return;
  installed = true;
  proto.showModal = function (this: HTMLDialogElement): void {
    // (watched before it opens, so the field it puts the cursor in is noted; opened again while
    // still open, it keeps its changes)
    watchOutsideClick(this, !this.open);
    own.call(this);
    const d = this;
    if (!listened.has(d)) {
      listened.add(d);
      // (the close event comes a moment later: a window closed and opened again at once is still open)
      d.addEventListener('close', () => { if (!d.open) closed(d); });
    }
    if (!open.includes(d)) open.push(d);
    d.classList.add('is-modal');
    addStrip(d);
    if (!watchers.has(d)) {
      const mo = new MutationObserver(() => { if (open.includes(d)) addStrip(d); });
      mo.observe(d, { childList: true });
      watchers.set(d, mo);
    }
    layout();
  };
  window.addEventListener('resize', layout);
  layout();
}

// (installed as soon as this module loads: src/main.ts imports it before anything else)
installModalGuard();
