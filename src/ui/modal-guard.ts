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
// It works by wrapping HTMLDialogElement.showModal once, at start-up, so no window can miss it.

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
/** A max-height this code set on a window (so it can take it back off). */
const fitted = new WeakSet<HTMLDialogElement>();

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
  // (a window taken off the page while open is no longer modal)
  for (let i = open.length - 1; i >= 0; i--) if (!open[i].isConnected || !open[i].open) closed(open[i]);
  for (const d of open) fit(d);
}

/** Keep a modal window's height within its room, so its own buttons stay on the screen. */
function fit(d: HTMLDialogElement): void {
  if (fitted.has(d)) { d.style.removeProperty('max-height'); fitted.delete(d); }
  if (d.style.maxHeight) return;     // (a window that sets its own height keeps it)
  const r = dialogRoom();
  const room = (window.innerHeight || 0) - r.top - r.bottom - 2 * EDGE;
  if (room <= 0) return;
  const cap = parseFloat(getComputedStyle(d).maxHeight);
  if (!Number.isFinite(cap) || cap > room) {
    d.style.maxHeight = `${Math.floor(room)}px`;
    fitted.add(d);
  }
}

function addStrip(d: HTMLDialogElement): void {
  if (!makeStrip || strips.has(d)) return;
  const strip = makeStrip();
  strip.classList.add('modal-title-strip');
  d.append(strip);
  strips.set(d, strip);
}

function closed(d: HTMLDialogElement): void {
  const i = open.indexOf(d);
  if (i >= 0) open.splice(i, 1);
  strips.get(d)?.remove();
  strips.delete(d);
  if (fitted.has(d)) { d.style.removeProperty('max-height'); fitted.delete(d); }
}

/** The modal window on top (null: none). */
export function topModal(): HTMLDialogElement | null {
  for (let i = open.length - 1; i >= 0; i--) if (open[i].open && open[i].isConnected) return open[i];
  return null;
}

/** Whether `d` was opened with showModal() and is still open. */
export function isOpenModal(d: HTMLDialogElement): boolean {
  return open.includes(d) && d.open;
}

let installed = false;

/** Wrap showModal so every modal window gets the title strip and its room. Once, at start-up. */
export function installModalGuard(): void {
  if (installed || typeof HTMLDialogElement === 'undefined') return;
  const proto = HTMLDialogElement.prototype;
  const own = proto.showModal;
  if (typeof own !== 'function') return;
  installed = true;
  proto.showModal = function (this: HTMLDialogElement): void {
    own.call(this);
    if (!open.includes(this)) {
      open.push(this);
      this.addEventListener('close', () => closed(this), { once: true });
    }
    addStrip(this);
    layout();
  };
  window.addEventListener('resize', layout);
  layout();
}

// (installed as soon as this module loads: src/main.ts imports it before anything else)
installModalGuard();
