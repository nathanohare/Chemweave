// Synchronous Scrolling on the SI page: scrolling past the end of a compound's page (or above its
// start) meets a soft barrier. Pushing on through it opens the next (or previous) page of the SI;
// a flick that only reaches the edge, or the tail of a fling, never does. Each page stays its own:
// the pages are never run together into one long scroll.

/** How much scrolling (in pixels of wheel or touch) past the edge opens the next page. */
export const BARRIER_PUSH = 240;
/** Scrolling that comes within this long of reaching the edge doesn't count (a fling arriving there). */
export const BARRIER_ARRIVE_MS = 180;
/** The push let go of, in pixels a second (a slow trickle, such as a fling's tail, never gets through). */
export const BARRIER_DECAY = 250;
/** Wheel events closer together than this are one stream (a trackpad's, or a fling's tail). */
export const BARRIER_STREAM_MS = 50;
/** A scroll smaller than this, the same size as the one just before it in a stream, is taken as a fling's tail. */
export const BARRIER_SMALL = 40;
/** After a page is opened, the barrier stays shut until the scrolling has stopped this long (one push opens one page: a spin that goes on never runs through several). */
export const BARRIER_REARM_MS = 350;

export interface BarrierState {
  /** The way being pushed: 1 down (the next page), -1 up (the one before), 0 none. */
  dir: 1 | -1 | 0;
  /** How far through the barrier, in pixels. */
  push: number;
  /** When the edge was reached (scrolling that way), and when the push was last worked out. */
  arrived: number;
  at: number;
  /** Shut: a page was just opened, and the scrolling hasn't stopped since. */
  shut: boolean;
  /** The last scroll's size and time (a stream dying away, as a fling's tail, doesn't push). */
  lastAbs: number;
  lastAt: number;
}

export const freshBarrier = (): BarrierState => ({ dir: 0, push: 0, arrived: 0, at: 0, shut: false, lastAbs: 0, lastAt: -Infinity });

/** What a scroll at the page's edge did: how far through the barrier (0 to 1), and whether it got through. */
export interface BarrierStep { progress: number; through: boolean; /** shut since the last page opened (the hint isn't shown) */ shut?: boolean }

/**
 * One scroll (`dy` pixels, + down) of the SI page. `atEdge`: the page can't scroll further that way
 * (`dy`'s way), `canGo`: there is a page that way. Returns null when the barrier isn't met (the
 * page scrolls as usual, or there is no page beyond): the state is left reset.
 */
export function pushBarrier(s: BarrierState, dy: number, now: number, atEdge: boolean, canGo: boolean): BarrierStep | null {
  const dir: 1 | -1 | 0 = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  // (a stream of scrolls getting smaller: a fling dying away, which never pushes through)
  const abs = Math.abs(dy);
  // (equal small scrolls in a stream too: a device that rounds its fling's steps to whole pixels; a
  // mouse wheel's notches are large, and count however fast they come)
  const stream = now - s.lastAt < BARRIER_STREAM_MS;
  const dying = stream && (abs < s.lastAbs || (abs === s.lastAbs && abs < BARRIER_SMALL));
  if (s.shut && now - s.lastAt >= BARRIER_REARM_MS) s.shut = false;
  s.lastAbs = abs;
  s.lastAt = now;
  if (!dir || !atEdge || !canGo) { s.dir = 0; s.push = 0; return null; }
  if (s.shut) return { progress: 0, through: false, shut: true };
  if (s.dir !== dir) { s.dir = dir; s.push = 0; s.arrived = now; s.at = now; }
  // (let go of slowly: only a steady push gets through)
  s.push = Math.max(0, s.push - ((now - s.at) / 1000) * BARRIER_DECAY);
  s.at = now;
  if (now - s.arrived < BARRIER_ARRIVE_MS) return { progress: s.push / BARRIER_PUSH, through: false };
  if (!dying) s.push += abs;
  if (s.push < BARRIER_PUSH) return { progress: s.push / BARRIER_PUSH, through: false };
  // through: the next page opens, and the barrier is shut for a moment
  s.dir = 0;
  s.push = 0;
  s.shut = true;
  return { progress: 1, through: true };
}

/** The page before or after `current` in the SI's order (`order` as keys), or null at either end (or when `current` isn't one). */
export function neighbourPage<T>(order: readonly T[], key: (x: T) => string, current: string, dir: 1 | -1): T | null {
  const i = order.findIndex((x) => key(x) === current);
  if (i < 0) return null;
  return order[i + dir] ?? null;
}

/** A wheel's scroll in pixels (lines and pages turned to pixels, as browsers scroll them). */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * Math.max(1, pageHeight) : deltaY;
}
