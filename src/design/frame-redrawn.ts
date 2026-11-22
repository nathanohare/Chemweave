// A frame whose texts were changed in another program in a way its settings can't follow is
// marked (Shape.editedOutside, see markEditedOutside in io/cdxml.ts) and shown as that program
// left it. An edit that draws it again from its settings (the Edit command, a resize by its
// frame, a TLC spot dragged, a style changed…) always goes ahead: it goes through one of the put…
// functions (putPlate, putEnergy, putDiagram, putNewman, putTorsion), inside the edit's own undo
// step, so one Undo brings back the other program's drawing exactly. Each put… function tells the
// app here, so it can say so (review F1d-R01).

import type { Doc, Shape } from '../model';

let listener: ((doc: Doc, s: Shape) => void) | null = null;

/** Called when a marked frame is first drawn again from its settings, with its drawing and the frame as it was. */
export function onFrameRedrawn(f: ((doc: Doc, s: Shape) => void) | null): void { listener = f; }

/** Frame `old` (as it was) is being drawn again from its settings in `doc`: told, when it was marked. */
export function frameRedrawn(doc: Doc, old: Shape | undefined): void {
  if (old?.editedOutside) listener?.(doc, old);
}
