// Home ▸ Paragraph's Bullet Library and Multilevel List choices (Word's), for Document mode's
// ribbon and the SI Project's: each list's options made from the bullet library and the list
// schemes (text/paragraphs.ts), so both ribbons offer the same ones.

import { BULLET_LIBRARY, BULLET_NAMES, LIST_SCHEMES } from '../text/paragraphs';

/** A list's choices as [value, label]: Bullet Library's 'default' then each bullet by its place in the library; Multilevel List's 'default' (1. a. i.) then each other scheme by its id. */
export function listPickerOptions(kind: 'bullets' | 'multilevel'): [string, string][] {
  if (kind === 'bullets') return [['default', 'Default (• – • –)'], ...BULLET_LIBRARY.map((b, i): [string, string] => [String(i), `${b}  ${BULLET_NAMES[i] ?? ''}`])];
  return LIST_SCHEMES.map((s): [string, string] => [s.id || 'default', s.name]);
}

/** Fill the lists marked data-list-picker="bullets" or "multilevel" under `root` (a hidden ▾ first, shown while nothing is chosen). */
export function fillListPickers(root: ParentNode): void {
  for (const sel of root.querySelectorAll<HTMLSelectElement>('select[data-list-picker]')) {
    const none = new Option('▾', '');
    none.hidden = true;
    sel.replaceChildren(none, ...listPickerOptions(sel.dataset.listPicker === 'bullets' ? 'bullets' : 'multilevel').map(([v, label]) => new Option(label, v)));
  }
}
