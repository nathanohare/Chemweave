// Clicking outside a modal window (on the dimmed program around it) closes it, as pressing Esc
// does. If something in the window was changed, it first asks whether to discard the changes or
// keep working. Every window opened with showModal() gets this (src/ui/modal-guard.ts).
//
// What counts as a change errs towards asking, so work is never lost without a question:
//   - a field (box, list, tick box, text) whose value differs from when the person first went to
//     it, or a field they changed that the window has since taken away (a row rebuilt or deleted);
//   - a press of a button in the window (Add, Delete, a style, a color), except Cancel and Close,
//     an "i", a tab, or a button that only opens or folds a section;
//   - dragging on a drawing or a 3D view in the window, or dropping something on it;
//   - markDialogChanged(), for a window whose changes come some other way.
// A search box in a window (Find a Command, Find in Files) is not a change.
//
// A window chooses otherwise with data-outside-click:
//   "keep"   an outside click does nothing: a window showing work in progress (a download, SI
//            Compile, an import), where the click can't sensibly mean Cancel;
//   "cancel" close without the question: the window asks about its changes itself (Settings), or
//            keeps them when closed (Send Feedback keeps its draft).

import { askChoice } from './ask';

interface Watch {
  /** Each field's value when the person first went to it (focus, a press, a key). */
  base: Map<Element, string>;
  /** The fields the person changed (typed in, picked from, ticked). */
  touched: Set<Element>;
  /** A change made some other way (a button, a drag, a window's own markDialogChanged). */
  changed: boolean;
  /** The press started outside the window, on its backdrop, with no pop-up open. */
  downOutside: boolean;
  /** A press inside the window that may become a drag. */
  pressed: boolean;
  /** The discard question is up. */
  asking: boolean;
}

const watches = new WeakMap<HTMLDialogElement, Watch>();

const FIELD = 'input, select, textarea, [contenteditable=""], [contenteditable="true"]';
/** Pop-ups that close on a click outside them: that click closes the pop-up, not the window too. */
const POPUP = '.combo-list:not([hidden]), .context-menu, .popup-menu, .colour-pop, .mo-name-pop';
/** Buttons that change nothing: Cancel and Close, an "i", a tab, opening or folding a section, the window buttons. */
const NOT_A_CHANGE = '.modal-title-strip, .info-icon, [role="tab"], [aria-expanded], [data-no-change], [value="cancel"], [data-act="cancel"], .sw-close';
const NOT_A_CHANGE_NAME = /^(cancel|close|×|✕|help)$/i;

// Whether a pop-up was open when the press began. Pop-ups close themselves from a capturing
// listener on the page, before the window hears of the press, so it is read here, on the window
// object, which hears every press first.
let popupAtPress = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { popupAtPress = !!document.querySelector(POPUP); }, true);
}

/** A field that counts: not a search box. */
function fieldOf(el: Element | null): Element | null {
  const f = el?.closest?.(FIELD) ?? null;
  return f instanceof HTMLInputElement && f.type === 'search' ? null : f;
}

/** A field's value, as text to compare. */
function valueOf(el: Element): string {
  if (el instanceof HTMLInputElement) return el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : el.value;
  if (el instanceof HTMLSelectElement) return [...el.options].filter((o) => o.selected).map((o) => o.value).join('\n');
  if (el instanceof HTMLTextAreaElement) return el.value;
  return (el as HTMLElement).innerHTML;
}

function noteField(w: Watch, f: Element | null): void {
  if (f && !w.base.has(f)) w.base.set(f, valueOf(f));
}

function note(w: Watch, el: Element | null): void {
  const f = fieldOf(el);
  noteField(w, f);
  // (a label that ticks a box: its box)
  noteField(w, fieldOf(el?.closest?.('label')?.control ?? null));
  // a radio button changes its group's others too
  if (f instanceof HTMLInputElement && f.type === 'radio' && f.name && f.form) {
    for (const r of f.form.querySelectorAll<HTMLInputElement>('input[type="radio"]')) if (r.name === f.name) noteField(w, r);
  }
}

/** Say that something in a window was changed in a way its fields don't show (so an outside click asks first). */
export function markDialogChanged(d: HTMLDialogElement, changed = true): void {
  const w = watches.get(d);
  if (w) w.changed = changed;
}

/** Whether anything in the window was changed since it opened. */
export function dialogChanged(d: HTMLDialogElement): boolean {
  const w = watches.get(d);
  if (!w) return false;
  if (w.changed) return true;
  for (const [el, v] of w.base) {
    const here = el.isConnected && d.contains(el);
    // (a field changed and then taken away, as when a window rebuilds its rows, was still a change)
    if (here ? valueOf(el) !== v : w.touched.has(el)) return true;
  }
  return false;
}

/** Whether a point (client coordinates) is outside the window's box. */
function outside(d: HTMLDialogElement, e: MouseEvent): boolean {
  const r = d.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

/** Close a window as Esc does: its own Cancel runs (a `cancel` event), and it closes unless that stops it. */
export function cancelDialog(d: HTMLDialogElement): void {
  if (d.dispatchEvent(new Event('cancel', { cancelable: true })) && d.open) d.close();
}

/** The window's name, for the question. */
function nameOf(d: HTMLDialogElement): string {
  // (the heading's own words: not its "i" or a close button)
  const h = [...(d.querySelector('h2')?.childNodes ?? [])].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
  return h || d.getAttribute('aria-label')?.trim() || 'this window';
}

async function outsideClick(d: HTMLDialogElement, w: Watch): Promise<void> {
  const how = d.dataset.outsideClick;
  if (how === 'keep' || w.asking) return;
  if (how !== 'cancel' && dialogChanged(d)) {
    w.asking = true;
    try {
      const a = await askChoice('Discard Changes?', `You changed something in ${nameOf(d)}. Discard your changes and close it, or keep working?`,
        [{ value: 'keep', label: 'Keep Working', primary: true }, { value: 'discard', label: 'Discard' }], 'keep');
      if (a !== 'discard') return;
    } finally { w.asking = false; }
  }
  if (d.open) cancelDialog(d);
}

/** Whether a press of this button may change something in its window. */
export function changingButton(b: HTMLElement): boolean {
  if (b.closest(NOT_A_CHANGE)) return false;
  if (b instanceof HTMLButtonElement && b.type === 'submit' && b.form) return false;     // (OK, Insert: the window is done)
  const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
  return !NOT_A_CHANGE_NAME.test(name);
}

/**
 * Watch a window being opened with showModal(): the changes made in it, and clicks outside it.
 * `fresh` (it was closed): start with no changes; a window opened again while still open keeps them.
 */
export function watchOutsideClick(d: HTMLDialogElement, fresh = true): void {
  const was = watches.get(d);
  if (was && !fresh) return;
  watches.set(d, { base: new Map(), touched: new Set(), changed: false, downOutside: false, pressed: false, asking: false });
  if (was) return;     // (the listeners are already on it from an earlier opening; they read the new state)
  const cur = () => watches.get(d)!;
  // (listened for before the window opens, so the field it puts the cursor in is noted too)
  for (const type of ['focusin', 'pointerdown', 'keydown'] as const) {
    d.addEventListener(type, (e) => note(cur(), e.target as Element), true);
  }
  // a field the person changed
  // (one the window's own code sends counts once the person has been to the field: a pick from
  // its drop-down list; before that it is the window setting itself up)
  const edited = (e: Event) => {
    const f = fieldOf(e.target as Element);
    if (!f) return;
    const w = cur();
    if (w.base.has(f)) w.touched.add(f);
    else if (e.isTrusted) { w.changed = true; w.touched.add(f); }     // (changed before it could be noted: count it)
  };
  d.addEventListener('input', edited, true);
  d.addEventListener('change', edited, true);
  // a button pressed, a drag on a drawing or a 3D view, something dropped
  d.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.('button, [role="button"]');
    if (e.isTrusted && b instanceof HTMLElement && d.contains(b) && changingButton(b)) cur().changed = true;
  }, true);
  d.addEventListener('pointerdown', (e) => { cur().pressed = e.isTrusted && !!(e.target as Element | null)?.closest?.('canvas, svg'); }, true);
  d.addEventListener('pointermove', (e) => { const w = cur(); if (w.pressed && e.buttons) w.changed = true; }, true);
  d.addEventListener('pointerup', () => { cur().pressed = false; }, true);
  d.addEventListener('drop', (e) => { if (e.isTrusted) cur().changed = true; }, true);
  // the click outside: pressed and let go on the backdrop (a click there has the window as its target)
  d.addEventListener('pointerdown', (e) => {
    cur().downOutside = e.button === 0 && e.target === d && outside(d, e) && !popupAtPress && !d.querySelector(POPUP);
  });
  d.addEventListener('click', (e) => {
    const w = cur();
    const go = w.downOutside && e.button === 0 && e.target === d && outside(d, e);
    w.downOutside = false;
    if (go) void outsideClick(d, w);
  });
}
