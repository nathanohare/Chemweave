// Make Editable window (Document mode: right-click ▸ Make Editable…, or ▾ ▸ Compare…): the
// picture is read first, then the structure is shown as it will be made, in the style chosen
// (switching style redraws it from the same reading), with how sure the reader was. Make
// Editable puts it in the picture's place; Cancel leaves the picture as it is.

import type { DocStyle } from '../style';
import type { StyleChoice } from '../recognise/editable';
import type { Made } from './doc-make-editable';
import { foldIntoInfo, infoIcon } from './info-tip';
import { showDialog } from './dialog-host';
import { comparePanes, readSummary } from './doc-compare-card';

export interface MakeEditableWindow {
  /** The picture being read; resolves to a maker of the structure in a style, or null when it couldn't be read (a message was given). */
  reading: Promise<((choice: StyleChoice) => Made) | null>;
  style: DocStyle;
  initial: StyleChoice;
  /** Make Editable pressed: the structure made, whether to keep the picture with it, and the style. */
  apply(made: Made, keepPicture: boolean, choice: StyleChoice): void;
}

export function openMakeEditableWindow(o: MakeEditableWindow): void {
  const d = document.createElement('dialog');
  d.className = 'ask make-editable-dialog';
  d.setAttribute('aria-label', 'Make Editable');
  const form = document.createElement('form');
  form.method = 'dialog';
  const h = document.createElement('h2');
  h.textContent = 'Make Editable';
  const about = document.createElement('p');
  about.textContent = 'The picture is read as a structure and drawn in its place. This shows the picture and the structure as it will be made side by side: check it before you go ahead. The picture is kept with it unless you clear Keep original picture, so you can compare with it or put it back later.';
  const preview = document.createElement('div');
  preview.className = 'me-preview';
  const wait = document.createElement('span');
  wait.className = 'muted';
  wait.textContent = 'Reading the picture…';
  preview.append(wait);
  const status = document.createElement('p');
  status.className = 'me-status muted';
  status.setAttribute('role', 'status');

  const row = document.createElement('label');
  row.className = 'me-row';
  const styleText = document.createElement('span');
  styleText.textContent = 'Style';
  const styleInfo = infoIcon('Match original style draws it with the picture\'s own bond length, line width and label size (a journal style\'s exact numbers when they match one). Use default style draws it in the document\'s drawing style, like your other structures.');
  const select = document.createElement('select');
  for (const [v, t] of [['match', 'Match original style'], ['default', 'Use default style']] as const) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = t;
    select.append(opt);
  }
  select.value = o.initial;
  select.disabled = true;
  row.append(styleText, styleInfo, select);

  const keepRow = document.createElement('label');
  keepRow.className = 'me-check';
  const keep = document.createElement('input');
  keep.type = 'checkbox';
  keep.checked = true;
  keepRow.append(keep, document.createTextNode(' Keep original picture (to compare or revert)'));

  const buttons = document.createElement('p');
  buttons.className = 'ask-buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.className = 'primary';
  ok.textContent = 'Make Editable';
  ok.disabled = true;
  buttons.append(cancel, ok);

  form.append(h, about, preview, status, row, keepRow, buttons);
  d.append(form);
  foldIntoInfo(about, h);

  let make: ((choice: StyleChoice) => Made) | null = null;
  let made: Made | null = null;
  let closed = false;
  const close = () => { closed = true; if (d.open) d.close(); d.remove(); };
  const show = () => {
    if (!make) return;
    made = make(select.value as StyleChoice);
    const fp = made.drawing.fromPicture;
    if (!fp) return;
    preview.replaceChildren(comparePanes(made.drawing.contents, fp, o.style));
    status.textContent = fp ? readSummary(fp, made.problems) + (made.problems.length ? ` (${made.problems.join(' ')})` : '') : '';
    status.classList.toggle('warn', made.problems.length > 0);
  };
  select.addEventListener('change', show);
  cancel.addEventListener('click', close);
  d.addEventListener('cancel', () => { closed = true; d.remove(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!made) return;
    const m = made;
    close();
    o.apply(m, keep.checked, select.value as StyleChoice);
  });
  showDialog(d);
  void o.reading.then((got) => {
    if (closed) return;
    if (!got) { close(); return; }
    make = got;
    select.disabled = false;
    ok.disabled = false;
    show();
    ok.focus();
  });
}
