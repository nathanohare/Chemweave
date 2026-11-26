// Split screen: two open tabs side by side (any two kinds). A tab dragged down out of the tab row
// into the window splits it, as Windows Snap does: a ghost of the split shows while the tab is held
// over the working area, on the half the pointer is over, and letting go there makes the split.
// The divider between the sides is dragged to share the width.
//
// The parts here are the ones with no window to look at: where a drop lands, what the split
// becomes, how far the divider may go and pictures of a side not being worked on.

export type Side = 'left' | 'right';

/** Two tabs side by side. */
export interface SplitPair<T> {
  left: T;
  right: T;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Neither side narrower than this share of the working area. */
export const MIN_SHARE = 0.2;

/** The right side's share of the width, kept between MIN_SHARE and 1 − MIN_SHARE (a number that isn't one: half). */
export function clampShare(share: number): number {
  if (!Number.isFinite(share)) return 0.5;
  return Math.min(1 - MIN_SHARE, Math.max(MIN_SHARE, share));
}

/** The right side's share for the divider dragged to x (in the same units as the box). */
export function shareAt(x: number, box: Box): number {
  const w = box.right - box.left;
  if (!(w > 0)) return 0.5;
  return clampShare((box.right - x) / w);
}

/**
 * Where a tab held at (x, y) would go: the half of the working area it is over, or null when it is
 * outside it (no ghost; letting go does nothing). `divider` is where the split would divide, as the
 * left side's share (the current split's, or a half).
 */
export function dropSide(x: number, y: number, box: Box, divider = 0.5): Side | null {
  if (!(x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) return null;
  return x < box.left + (box.right - box.left) * divider ? 'left' : 'right';
}

/**
 * The split after `dragged` is let go on `side`. `showing` is the tab being worked on and
 * `current` the split it is in (null when it is in none). The dragged tab goes on the side it was
 * dropped on; the other side keeps what was there: the tab showing, or the split's other tab when
 * the drop replaces the tab showing. Null when nothing would change or the tab would be beside
 * itself.
 */
export function splitAfterDrop<T>(dragged: T, side: Side, showing: T, current: SplitPair<T> | null): SplitPair<T> | null {
  const other: Side = side === 'left' ? 'right' : 'left';
  const pair = (onSide: T, onOther: T) => (side === 'left' ? { left: onSide, right: onOther } : { left: onOther, right: onSide });
  if (current && (current.left === showing || current.right === showing)) {
    if (current[side] === dragged) return null;
    // dropped on the other side from where it is: the two change places
    if (current[other] === dragged) return pair(dragged, current[side]);
    // a third tab: it takes the place of the one on the side it was dropped on
    return pair(dragged, current[other]);
  }
  if (dragged === showing) return null;
  return pair(dragged, showing);
}

/** The tab beside t in the split, or null when t is in none. */
export function besideIn<T>(pair: SplitPair<T> | null, t: T): T | null {
  if (!pair) return null;
  return pair.left === t ? pair.right : pair.right === t ? pair.left : null;
}

/**
 * Both sides stay live (a drawing beside a document or sheet: they don't use the drawing area, so
 * the drawing can be worked on at the same time). Any other pair shows the side not being worked
 * on as a picture until it is clicked.
 */
export function bothLive(a: string, b: string): boolean {
  const words = (m: string) => m === 'document' || m === 'sheet';
  return (a === 'drawing' && words(b)) || (b === 'drawing' && words(a));
}

/** What Insert puts the selected structures into, for a split of a canvas beside another kind (none for other pairs). */
export function insertLabel(target: string): string | null {
  switch (target) {
    case 'document': return 'Insert into Document';
    case 'sheet': return 'Insert into Cell';
    case 'slides': return 'Insert into Slide';
    case 'design': return 'Insert into Design';
    default: return null;
  }
}

/**
 * A picture of what an element shows, from the canvases in it (the drawing, slide, pages and
 * cells are all drawn on canvases), over its background color. Null when it shows no canvas.
 */
export function pictureOf(el: HTMLElement, keep: (c: HTMLCanvasElement) => boolean = () => true): HTMLCanvasElement | null {
  const box = el.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return null;
  const canvases = [...el.querySelectorAll('canvas')].filter((c) => {
    if (c.width < 1 || c.height < 1 || !keep(c)) return false;
    const r = c.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom
      && getComputedStyle(c).visibility !== 'hidden';
  });
  if (!canvases.length) return null;
  const dpr = window.devicePixelRatio || 1;
  const out = document.createElement('canvas');
  out.width = Math.round(box.width * dpr);
  out.height = Math.round(box.height * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  const bg = getComputedStyle(el).backgroundColor;
  if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  for (const c of canvases) {
    const r = c.getBoundingClientRect();
    const f = getComputedStyle(c).filter;
    // (Reading Mode's dark page filter, where the browser can draw with one)
    if ('filter' in ctx) ctx.filter = f && f !== 'none' ? f : 'none';
    // (a browser that can't: the picture takes the page's filter where it shows instead)
    else if (f && f !== 'none') out.dataset.cssFilter = '1';
    try {
      ctx.drawImage(c, (r.left - box.left) * dpr, (r.top - box.top) * dpr, r.width * dpr, r.height * dpr);
    } catch { /* a canvas that can't be read is left out */ }
  }
  if ('filter' in ctx) ctx.filter = 'none';
  out.dataset.w = String(box.width);
  out.dataset.h = String(box.height);
  return out;
}

/**
 * Where a picture of size (w, h) goes in a box (bw, bh): at most actual size, scaled down to fit,
 * centered across and from the top (a page or sheet reads from its top).
 */
export function fitPicture(w: number, h: number, bw: number, bh: number): { x: number; y: number; w: number; h: number } {
  if (!(w > 0 && h > 0 && bw > 0 && bh > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const k = Math.min(1, bw / w, bh / h);
  const sw = w * k, sh = h * k;
  return { x: (bw - sw) / 2, y: 0, w: sw, h: sh };
}
