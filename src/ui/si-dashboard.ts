// The dashboards on the SI Project tab (src/si/dashboard.ts works out what they show): a Data
// section's grid, one row per compound and one column per field, and the project's Dashboard
// page, its progress by section, the required data still missing and the warnings by kind above
// a grid of every compound. A cell opens its compound at that field.

import { CELL_ALPHA, STATE_ICONS, STATUS_KEYS, STATUS_NAMES, DEFAULT_STATUS_COLORS, FILTERS, cellIcons, cellStatus, cellTip, fieldLabel, filterOf, isCompact, percent, sectionPath, shownColumns, summaryText, type Cell, type ProjectSummary, type Row, type Scope, type Status } from '../si/dashboard';
import type { SiCompound, SiProject, SiSection } from '../si/project';
import { addInfo } from './info-tip';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** '#rrggbb' at this strength (of 255) as a CSS color ('' when there is no color). */
export function tint(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '';
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${(alpha / 255).toFixed(3)})`;
}

export interface GridOptions {
  project: SiProject;
  scope: Scope;
  rows: Row[];
  colors: Record<Status, string>;
  /** The project's grid: a Section column. */
  showSection: boolean;
  /** A compound's structure as an SVG (null: none, or not read yet). */
  picture(c: SiCompound): string | null;
  /** Open a compound at a field ('' for the top of its page). */
  open(c: SiCompound, key: string): void;
}

function paint(td: HTMLElement, status: Status, colors: Record<Status, string>): void {
  const bg = tint(colors[status], CELL_ALPHA[status]);
  if (bg) td.style.background = bg;
  td.dataset.status = status;
}

/** A grid of compounds (filtered as the scope's view says), or a line saying there are none. */
export function dashboardGrid(o: GridOptions): HTMLElement {
  const filter = filterOf(o.scope);
  const rows = o.rows.filter((r) => filter === 'all' || (filter === 'incomplete' ? r.missing.length : filter === 'flagged' ? r.flags : r.warnings));
  if (!o.rows.length) return el('p', 'muted si-note', o.showSection ? 'No compounds yet: Insert ▸ Compound adds one to a Data section.' : 'No compounds in this section yet: Insert ▸ Compound adds one.');
  if (!rows.length) return el('p', 'muted si-note', `No compounds to show with “${FILTERS[filter]}”: Show ▸ All Compounds on the Dashboard tab shows them all.`);
  const compact = isCompact(o.scope);
  const columns = shownColumns(o.scope);
  const wrap = el('div', 'si-dash-wrap');
  const table = el('table', 'si-dash' + (compact ? ' compact' : ''));
  const head = el('tr');
  const th = (text: string, tip = ''): void => { const h = el('th', '', text); if (tip) h.title = tip; head.append(h); };
  if (!compact) th('Structure');
  th('ID');
  th('Name');
  if (o.showSection) th('Section');
  for (const k of columns) th(fieldLabel(o.scope, k));
  th('Done', 'Required fields filled in');
  table.append(el('thead'));
  table.tHead!.append(head);
  const body = el('tbody');
  const sectionNames = new Map<string, string>();
  const sectionOf = (c: SiCompound): string => {
    if (!sectionNames.has(c.sectionId)) {
      let name = '';
      try { name = sectionPath(o.project, o.project.section(c.sectionId)); } catch { /* gone */ }
      sectionNames.set(c.sectionId, name);
    }
    return sectionNames.get(c.sectionId)!;
  };
  for (const r of rows) {
    const tr = el('tr');
    const cellTd = (cell: Cell | undefined, key: string, cls = '', withText = true): HTMLTableCellElement => {
      const td = el('td', 'si-dc' + (cls ? ' ' + cls : ''));
      if (!cell) return td;
      paint(td, cellStatus(cell), o.colors);
      td.title = cellTip(cell);
      const marks = (cell.flag ? '⚑' : '') + (cell.warnings.length ? '⚠' : '');
      if (withText && !compact && cell.summary) {
        td.append(el('span', 'si-dc-t', cell.summary));
        if (marks) td.append(el('span', 'si-dc-ic', marks));
      } else td.append(el('span', 'si-dc-ic', cellIcons(cell)));
      td.tabIndex = 0;
      td.dataset.key = key;
      return td;
    };
    if (!compact) {
      const td = cellTd(r.cells.get('structure'), 'structure', 'si-dc-pic', false);
      const pic = o.picture(r.compound);
      if (pic) { td.replaceChildren(); td.insertAdjacentHTML('beforeend', pic); }
      tr.append(td);
    }
    const id = el('td', 'si-dc si-dc-id');
    id.append(el('b', 'si-cid', r.id));
    id.tabIndex = 0;
    id.dataset.key = '';
    if (r.idWarnings.length) { paint(id, 'warning', o.colors); id.title = r.idWarnings.map((w) => `⚠ ${w}`).join('\n'); id.append(el('span', 'si-dc-ic', ' ⚠')); }
    tr.append(id);
    const name = cellTd(r.cells.get('name'), 'name', 'si-dc-name', false);
    name.replaceChildren(document.createTextNode(r.name || 'unnamed compound'));
    if (!r.name) name.classList.add('muted');
    tr.append(name);
    if (o.showSection) tr.append(el('td', 'si-dc-sec', sectionOf(r.compound)));
    for (const k of columns) tr.append(cellTd(r.cells.get(k), k.includes(':') ? k.slice(0, k.indexOf(':')) : k));
    const done = el('td', 'si-dc-done', `${r.filled}/${r.total}`);
    done.title = r.missing.length ? `Still to fill in: ${r.missing.join(', ')}` : 'Every required field is filled in';
    if (!r.missing.length) paint(done, 'filled', o.colors);
    tr.append(done);
    const go = (e: Event): void => {
      const td = (e.target as HTMLElement).closest<HTMLElement>('td[data-key]');
      if (td) o.open(r.compound, td.dataset.key!);
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
    body.append(tr);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

/** A Data section's dashboard card: its summary line over its grid. */
export function sectionDashboard(o: GridOptions, waiting: boolean): HTMLElement {
  const card = el('div', 'si-card si-dash-card');
  const head = el('div', 'si-card-head');
  const h = el('h3', 'si-sub', 'Dashboard');
  addInfo(h, 'Every compound of the section and how far along its data is. ✔ filled · ○ empty · ✖ empty but required · — field not used · ⚑ flagged · ⚠ a warning. Click a cell to open the compound at that field. The Dashboard tab on the ribbon picks the columns, filters the rows and sets the colors; Chem SI Assistant shows the same choices.');
  head.append(h, el('span', 'muted si-dash-sum', summaryText(o.rows)));
  card.append(head, dashboardGrid(o));
  if (waiting) card.append(el('p', 'muted si-note', 'Still reading some structures…'));
  return card;
}

function bar(pct: number): HTMLElement {
  const b = el('span', 'si-bar');
  const f = el('span', 'si-bar-fill');
  f.style.width = `${pct}%`;
  b.append(f);
  b.setAttribute('role', 'progressbar');
  b.setAttribute('aria-valuenow', String(pct));
  b.setAttribute('aria-valuemin', '0');
  b.setAttribute('aria-valuemax', '100');
  return b;
}

export interface SummaryOptions {
  summary: ProjectSummary;
  openSection(s: SiSection): void;
  openWarnings(): void;
}

/** The project's progress at a glance: overall, by Data section, what is missing and the warnings by kind. */
export function projectSummaryCard(o: SummaryOptions): HTMLElement {
  const s = o.summary;
  const card = el('div', 'si-card si-dash-summary');
  const h = el('h2', 'si-title', 'Dashboard');
  addInfo(h, 'How far along the project is: compounds with every required field filled in, required fields filled in, by Data section, what is still missing and the warnings by kind. Percentages round down, so 100% shows only when nothing is left.');
  card.append(h);
  const fieldsPct = percent(s.filled, s.required);
  const top = el('div', 'si-dash-top');
  top.append(bar(percent(s.complete, s.compounds)), el('span', '', `${s.complete} / ${s.compounds} compounds complete (${percent(s.complete, s.compounds)}%) · ${s.filled} / ${s.required} required fields filled in (${fieldsPct}%) · ${s.flags} flag${s.flags === 1 ? '' : 's'}`));
  card.append(top);
  if (s.sections.length) {
    const t = el('table', 'si-dash-secs');
    const hr = el('tr');
    for (const x of ['Data section', 'Compounds', 'Complete', 'Required fields', '']) hr.append(el('th', '', x));
    t.append(hr);
    for (const sec of s.sections) {
      const tr = el('tr');
      const name = el('td');
      const a = el('button', 'si-link', sec.path);
      a.type = 'button';
      a.title = 'Open this section';
      a.addEventListener('click', () => o.openSection(sec.section));
      name.append(a);
      const pct = percent(sec.filled, sec.required);
      const b = el('td');
      b.append(bar(pct));
      tr.append(name, el('td', 'num', String(sec.compounds)), el('td', 'num', `${sec.complete}`), el('td', 'num', `${sec.filled} / ${sec.required} (${pct}%)`), b);
      t.append(tr);
    }
    card.append(t);
  }
  const cols = el('div', 'si-dash-cols');
  const list = (title: string, items: [string, number][], none: string, unit: (n: number) => string, more?: () => void): HTMLElement => {
    const box = el('div', 'si-dash-list');
    const hh = el('h3', 'si-sub', title);
    box.append(hh);
    if (!items.length) box.append(el('p', 'muted si-note', none));
    const ul = el('ul');
    for (const [what, n] of items) { const li = el('li'); li.append(el('span', '', what), el('span', 'muted', unit(n))); ul.append(li); }
    if (items.length) box.append(ul);
    if (more && items.length) {
      const b = el('button', 'si-link', 'Open the Warnings page');
      b.type = 'button';
      b.addEventListener('click', more);
      box.append(b);
    }
    return box;
  };
  const cpds = (n: number): string => `${n} compound${n === 1 ? '' : 's'}`;
  cols.append(
    list('Required data still missing', s.missing, 'Nothing: every required field is filled in.', cpds),
    list('Warnings by kind', s.warnings, 'No warnings to look at.', (n) => String(n), o.openWarnings),
  );
  card.append(cols);
  return card;
}

/** The Status Colors window's table: each status's color, or none (read back with `read`). */
export function statusColorsBody(colors: Record<Status, string>): { el: HTMLElement; read(): Record<Status, string> } {
  const box = el('div', 'si-dash-colors');
  const inputs = new Map<Status, { pick: HTMLInputElement; none: HTMLInputElement; ic: HTMLElement }>();
  const icons: Record<Status, string> = { ...STATE_ICONS, flagged: '⚑', warning: '⚠' };
  for (const k of STATUS_KEYS) {
    const row = el('label', 'si-dash-color');
    const ic = el('span', 'si-dash-swatch', icons[k]);
    const pick = el('input');
    pick.type = 'color';
    pick.value = colors[k] || DEFAULT_STATUS_COLORS[k] || '#ffffff';
    const none = el('input');
    none.type = 'checkbox';
    none.checked = !colors[k];
    const show = (): void => { ic.style.background = none.checked ? '' : tint(pick.value, CELL_ALPHA[k]); pick.disabled = none.checked; };
    pick.addEventListener('input', show);
    none.addEventListener('change', show);
    const noneLabel = el('span', 'si-dash-none');
    noneLabel.append(none, document.createTextNode(' No color'));
    row.append(ic, el('span', 'si-dash-cname', STATUS_NAMES[k]), pick, noneLabel);
    box.append(row);
    inputs.set(k, { pick, none, ic });
    show();
  }
  const reset = el('button', 'si-link', 'Reset to Standard Colors');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    for (const [k, x] of inputs) { x.none.checked = !DEFAULT_STATUS_COLORS[k]; x.pick.value = DEFAULT_STATUS_COLORS[k] || '#ffffff'; x.pick.dispatchEvent(new Event('input')); }
  });
  box.append(reset);
  return {
    el: box,
    read: () => Object.fromEntries([...inputs].map(([k, x]) => [k, x.none.checked ? '' : x.pick.value.toLowerCase()])) as Record<Status, string>,
  };
}
