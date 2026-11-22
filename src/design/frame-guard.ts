// One guard for every redraw of a frame's drawing from its settings (review F1c-R04).
//
// A frame whose texts were changed in another program in a way its settings can't follow is
// marked (Shape.editedOutside, see markEditedOutside in io/cdxml.ts): its drawing is shown as that
// program left it. Anything that would draw it again from its settings (the Edit command, a resize
// by its frame, a TLC spot dragged, a look or style changed, a torsion barrier dragged…) goes
// through one of the put… functions (putPlate, putEnergy, putDiagram, putNewman, putTorsion), and
// each of them asks here first. Unless the user has agreed, the drawing is left as it is, the redraw
// is kept, and the app is told, so it can ask once whether to redraw (redrawHeld) or leave it.

import type { Shape } from '../model';

const approved = new Set<number>();
const held = new Map<number, () => void>();
let listener: ((ids: number[]) => void) | null = null;
let told = false;

/** Called (once a change is over) with the frames whose redraw is waiting for the user. */
export function onRedrawHeld(f: ((ids: number[]) => void) | null): void { listener = f; }

/**
 * May frame `s` be drawn again from its settings now? Yes unless it is marked as changed in
 * another program and the user hasn't agreed; then `redo` (the same redraw) is kept for later.
 */
export function mayRedraw(s: Shape | undefined, redo: () => void): boolean {
  if (!s?.editedOutside || approved.has(s.id)) return true;
  held.set(s.id, redo);
  if (listener && !told) {
    told = true;
    queueMicrotask(() => { told = false; const ids = [...held.keys()]; if (ids.length) listener?.(ids); });
  }
  return false;
}

/** Run `f` with frame `id` allowed to be redrawn (the user has agreed). */
export function withRedraw<T>(id: number | null | undefined, f: () => T): T {
  if (id === null || id === undefined || approved.has(id)) return f();
  approved.add(id);
  try { return f(); } finally { approved.delete(id); }
}

/** Run the async `f` (an Edit command's window and its redraw) with frame `id` allowed to be redrawn. */
export async function withRedrawAsync(id: number, f: () => Promise<void>): Promise<void> {
  if (approved.has(id)) { await f(); return; }
  approved.add(id);
  try { await f(); } finally { approved.delete(id); }
}

/** The kept redraw of frame `id`, run now (inside an edit): the user agreed. False when there was none. */
export function redrawHeld(id: number): boolean {
  const f = held.get(id);
  held.delete(id);
  if (!f) return false;
  withRedraw(id, f);
  return true;
}

/** Forget the kept redraw of frame `id` (the user chose to leave the drawing as it is). */
export function dropHeld(id: number): void { held.delete(id); }

/** Frames with a kept redraw. */
export function heldRedraws(): number[] { return [...held.keys()]; }
