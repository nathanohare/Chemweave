// The file's own keys (Save, Save As, Open, New, Print, Close, the next and previous tab) work
// from any text box, as in Office: the speaker notes, Outline View, a Smart Scheme row, a comment,
// the Find box, text typed on the drawing. Not in a window (the keys wait until it is closed), and
// not in a document's text or a sheet's cells, whose own keys already send them (Excel ignores
// Ctrl+S while a cell is being typed in).

/** The commands the file keys run from a text box. */
export const FIELD_FILE_KEYS: ReadonlySet<string> = new Set(['save', 'save-as', 'open', 'new', 'new-slides', 'print', 'close-tab', 'next-tab', 'prev-tab', 'autosave']);

/** Places whose text boxes keep the file keys to themselves (or send them on their own). */
const NOT_FROM = 'dialog, .menu, .menu-wrap, #sheet-pane, .doc-input';

/** Is this a box being typed in (not a check box, button or slider)? */
export function isTypingField(t: EventTarget | null): t is HTMLElement {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  // (isContentEditable, or the attribute where the page can't work it out)
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.getAttribute?.('contenteditable') === 'true') return true;
  return el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes((el as HTMLInputElement).type);
}

/**
 * The file command a key pressed in a text box runs (`lookup` gives the action set for a chord
 * among the app's commands, such as "command save"), or null when the box keeps the key.
 */
export function fieldFileCommand(target: EventTarget | null, chord: string | null, lookup: (chord: string) => string | undefined | null): string | null {
  if (!chord || !/^(Ctrl|Meta|Cmd)\+/.test(chord) || !isTypingField(target) || target.closest(NOT_FROM)) return null;
  const act = lookup(chord);
  const name = act?.startsWith('command ') ? act.slice(8) : null;
  return name && FIELD_FILE_KEYS.has(name) ? name : null;
}
