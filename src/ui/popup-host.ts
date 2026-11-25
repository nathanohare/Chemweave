// Where a pop-up (a drop-down list, a right-click menu) goes so it shows over everything. A window
// opened with showModal() sits in the browser's top layer, above every z-index on the page, and
// makes the rest of the page inert: a pop-up added to the page itself is drawn under the window,
// greyed by its backdrop, and can't be clicked. So a pop-up opened from inside a window goes inside
// that window, and one opened while a modal window is up goes inside the topmost one.

/** The element a pop-up opened from `from` (or at a point, with no element) should be added to. */
export function popupHost(from?: Element | null): HTMLElement {
  const own = from?.closest<HTMLDialogElement>('dialog[open]');
  if (own) return own;
  const modal = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].reverse().find(isModal);
  return modal ?? document.body;
}

function isModal(d: HTMLDialogElement): boolean {
  try { return d.matches(':modal'); } catch { return false; }
}
