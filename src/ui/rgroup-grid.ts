// Chemistry ▸ Polymers and R-Groups ▸ R-Group Table…'s compounds (retrospective audit G5-10): a small grid, one row per
// compound and one column per R group, with an optional number of its own, in place of typed
// lines. Cells pasted from Excel (tabs and new lines) fill the grid from the cell pasted into.

import { addInfo } from './info-tip';

export interface RGroupRow { number?: string; values: string[] }

export interface RGroupGrid {
  el: HTMLElement;
  /** The rows with any group filled in, in order. */
  read(): RGroupRow[];
  /** Show the numbers the rows will get (after the compound number prefix changes). */
  refresh(): void;
}

export function rGroupGrid(labels: readonly string[], start: readonly RGroupRow[], numberHint: (i: number) => string): RGroupGrid {
  const wrap = document.createElement('div');
  wrap.className = 'rg-grid-wrap';
  const head = document.createElement('h3');
  head.className = 'rg-grid-title';
  head.textContent = 'Compounds';
  addInfo(head, 'One row per compound. Type each group as you would label an atom (Me, Ph, OMe, CO₂Et, Cl, H), or paste cells from Excel. No. gives a compound its own number; leave it empty to number them in order.');
  const table = document.createElement('table');
  table.className = 'rg-grid';
  const hr = table.createTHead().insertRow();
  for (const t of ['No.', ...labels, '']) { const th = document.createElement('th'); th.textContent = t; hr.append(th); }
  const body = table.createTBody();
  const cellInput = (value: string, label: string) => {
    const i = document.createElement('input');
    i.type = 'text';
    i.value = value;
    i.spellcheck = false;
    i.setAttribute('aria-label', label);
    return i;
  };
  const renumber = () => [...body.rows].forEach((tr, i) => {
    const no = tr.cells[0].querySelector('input')!;
    no.placeholder = numberHint(i);
    no.setAttribute('aria-label', `Compound ${i + 1} number`);
    [...tr.querySelectorAll<HTMLInputElement>('td.rg-val input')].forEach((x, k) => x.setAttribute('aria-label', `Compound ${i + 1} ${labels[k]}`));
  });
  const addRow = (r: RGroupRow = { values: [] }, at = body.rows.length): HTMLTableRowElement => {
    const tr = body.insertRow(at);
    tr.insertCell().append(cellInput(r.number ?? '', ''));
    labels.forEach((l, k) => { const td = tr.insertCell(); td.className = 'rg-val'; td.append(cellInput(r.values[k] ?? '', l)); });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'plate-x';
    del.textContent = '×';
    del.title = 'Delete compound';
    del.setAttribute('aria-label', 'Delete compound');
    del.addEventListener('click', () => { tr.remove(); if (!body.rows.length) addRow(); renumber(); });
    tr.insertCell().append(del);
    return tr;
  };
  for (const r of start) addRow(r);
  while (body.rows.length < 2) addRow();
  renumber();
  // paste a block of cells: fill across and down from the cell pasted into, adding rows as needed
  table.addEventListener('paste', (e) => {
    const t = e.target as HTMLElement;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!(t instanceof HTMLInputElement) || !/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const td = t.closest('td')!, tr = td.parentElement as HTMLTableRowElement;
    const col0 = td.cellIndex, row0 = tr.sectionRowIndex;
    let lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l.trim() || i < a.length - 1).map((l) => l.split('\t').map((c) => c.trim()));
    // a first line that repeats the R labels is their header, not a compound
    if (lines.length > 1 && lines[0].length === labels.length && lines[0].every((c, k) => c === labels[k])) lines = lines.slice(1);
    lines.forEach((cells, i) => {
      const row = body.rows[row0 + i] ?? addRow();
      cells.forEach((c, k) => { const box = row.cells[col0 + k]?.querySelector('input'); if (box) box.value = c; });
    });
    renumber();
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'plate-add';
  add.textContent = '+ Compound';
  add.addEventListener('click', () => { const tr = addRow(); renumber(); tr.querySelector<HTMLInputElement>('td.rg-val input')?.focus(); });
  const scroll = document.createElement('div');
  scroll.className = 'rg-grid-scroll';
  scroll.append(table);
  wrap.append(head, scroll, add);
  return {
    el: wrap,
    read: () => [...body.rows].map((tr) => {
      const n = tr.cells[0].querySelector('input')!.value.trim();
      const values = [...tr.querySelectorAll<HTMLInputElement>('td.rg-val input')].map((x) => x.value.trim());
      return { ...(n ? { number: n } : {}), values };
    }).filter((r) => r.values.some((v) => v)),
    refresh: renumber,
  };
}
