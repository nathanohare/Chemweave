// Home ▸ Paragraph's Bullet Library and Multilevel List choices (Word's), for Document mode's
// ribbon and the SI Project's: each list's options made from the bullet library and the list
// schemes (text/paragraphs.ts), so both ribbons offer the same ones.

import { BULLET_LIBRARY, LIST_SCHEMES } from '../text/paragraphs';

/** The bullet library's names, in BULLET_LIBRARY's order. */
export const BULLET_NAMES = ['Round', 'Hollow', 'Square', 'Diamond', 'Arrow', 'Check Mark', 'Dash', 'Star'];

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The Bullet Library's options: 'default' (the levels' own bullets), then each bullet by its place in the library. */
export function bulletOptionsHtml(): string {
  return '<option value="" hidden>▾</option><option value="default">Default (• – • –)</option>'
    + BULLET_LIBRARY.map((b, i) => `<option value="${i}">${esc(b)}  ${BULLET_NAMES[i] ?? ''}</option>`).join('');
}

/** The Multilevel List's options: 'default' (1. a. i.), then each other scheme by its id. */
export function multilevelOptionsHtml(): string {
  return '<option value="" hidden>▾</option>' + LIST_SCHEMES.map((s) => `<option value="${s.id || 'default'}">${esc(s.name)}</option>`).join('');
}

/** Fill the lists marked data-list-picker="bullets" or "multilevel" under `root`. */
export function fillListPickers(root: ParentNode): void {
  for (const sel of root.querySelectorAll<HTMLSelectElement>('select[data-list-picker]')) {
    sel.innerHTML = sel.dataset.listPicker === 'bullets' ? bulletOptionsHtml() : multilevelOptionsHtml();
  }
}
