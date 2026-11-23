// An SI project's settings (Home ▸ Project Settings, File ▸ Project Settings): a window like
// Settings, with a page for each part. Everything is kept in the project's project.json as SI
// Assistant keeps it (journal style, HRMS tolerance, page header and footer, labels, the scheme
// defaults); what SI Assistant has no setting for (heading formats beyond its own, a drawing style
// of Chemweave's) goes in keys of Chemweave's own, which SI Assistant keeps without reading.

import { SettingsWindow, type SettingsPage } from './settings-window';
import { ask, type Field } from './ask';
import type { Json, SiProject } from '../si/project';
import type { DocStyle } from '../style';
import { COUNT_NAMES, ENDS, HEADING_PRESETS, headingExample, headingFormat, presetOf, storedFormat, storeHeadingFormat, type CountStyle, type HeadingFormat } from '../si/heading-format';
import { dateText, NUMBER_STYLES, pageSettings, storePageSettings } from '../si/page-setup';
import { siDrawingStyle, storeSiDrawingStyle } from '../si/drawing-style';
import { projectLayout, setProjectLayout } from '../si/scheme-edit';
import { readSchemeLayout, schemeLayoutFields } from './si-scheme';
import { askChoice } from './ask';
import { addInfo } from './info-tip';
import { DEFAULT_TOLERANCES, SOLVENT_NAMES, defaultImpurityTable, impurityRowFrom, impurityTolerances, projectImpurityTable, storeImpurityTable, storeImpurityTolerances, type ImpurityRow } from '../si/nmr';
import { DICTIONARY_FILE } from '../si/dictionary';
import { SALT_LABEL_KEY, saltLabelStyle } from '../si/checks';

export interface SiSettingsHost {
  /** Change the project's settings and save them (says so when it can't). */
  save(change: () => void | Promise<void>): Promise<void>;
  /** Choose a drawing style (the Drawing Style window), starting from `current`; null when cancelled. */
  chooseDrawingStyle(current: DocStyle, note: string): Promise<DocStyle | null>;
  /** The project's dictionary.txt was changed (the text boxes are checked again). */
  dictionaryChanged(): void;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const LABEL_KINDS = ['figure', 'table', 'scheme'] as const;
const LABEL_STYLES: Record<string, string> = { '1': '1, 2, 3', I: 'I, II, III', i: 'i, ii, iii', a: 'a, b, c' };

/** The window, for a project. */
export function siSettingsWindow(p: SiProject, host: SiSettingsHost, page?: string): void {
  const pages: SettingsPage[] = [
    { id: 'output', title: 'Output', words: 'journal style acs wiley rsc hrms tolerance ppm salt ion counter-ion adduct 31p 11b phosphorus boron nmr reports', open: () => output(p, host) },
    { id: 'headings', title: 'Headings', words: 'heading numbers outline decimal 1.1 roman letters numbering', open: () => headings(p, host) },
    { id: 'page', title: 'Page', words: 'header footer page numbers prefix roman cover title authors date', open: () => pageSetup(p, host) },
    { id: 'labels', title: 'Labels', words: 'figure table scheme label word prefix numbering fig.', open: () => labels(p, host) },
    { id: 'structures', title: 'Structures', words: 'drawing style bond length line width font labels acs 1996 arrows', open: () => structures(p, host) },
    { id: 'schemes', title: 'Schemes', words: 'scheme layout conditions arrow yields ids gap fit wrap shrink', open: () => schemes(p, host) },
    { id: 'impurities', title: 'NMR Impurities', words: 'nmr impurity impurities solvent residual peaks shifts singlet tolerance fulmer water grease check', open: () => impurities(p, host) },
    { id: 'dictionary', title: 'Dictionary', words: 'dictionary spelling words leave as written formula formatting check dictionary.txt', open: () => dictionary(p, host) },
  ];
  new SettingsWindow(pages, null, { title: p.readOnly ? 'Project Settings (read-only)' : 'Project Settings', noDefault: true }).open(page);
}

async function output(p: SiProject, host: SiSettingsHost): Promise<void> {
  const s = p.settings;
  const got = await ask('Output', [
    { name: 'style', label: 'Journal style', value: str(s.journal_style) || 'ACS', options: ['ACS', 'Wiley', 'RSC'].map((x) => ({ value: x, label: x })), help: 'Its paper size, heading numbers, page number place and figure word, unless set otherwise on the other pages.' },
    { name: 'ppm', label: 'HRMS tolerance', value: String(s.hrms_tolerance_ppm ?? 5), unit: 'ppm', type: 'number', min: 0.01, max: 1000, help: 'How far a found mass may be from the calculated one before it is flagged.' },
    { name: 'salt', label: 'HRMS ion for salts', value: saltLabelStyle(s), options: [{ value: 'piece', label: '[M]⁺: M is the charged piece' }, { value: 'whole', label: '[M−Br]⁺: M is the whole salt' }], help: 'How the HRMS ion of a salt is printed when its charged piece is M and the adduct is [M]⁺ or [M]⁻: as [M]⁺, or for M = the whole salt with its counter-ions taken off, as [M−Br]⁺, [M−OTf]⁺, [M−2Br]²⁺ or [M−Na]⁻. The calculated m/z is the same either way. A compound’s Printed as box wins.' },
    { name: 'h1', label: 'NMR reports added for you', value: '', type: 'heading', help: '¹⁹F NMR reports are always added for compounds containing F.' },
    { name: 'p31', label: 'A ³¹P NMR report when the structure contains P', value: String(!!s.auto_nmr_31P), type: 'checkbox' },
    { name: 'b11', label: 'An ¹¹B NMR report when the structure contains B', value: String(!!s.auto_nmr_11B), type: 'checkbox' },
  ], { ok: 'Save', note: 'The title, authors, cover page, contents and General Information are on the project’s page (its name at the top of the list). Spectra pages are set on the Spectra section’s page.' });
  if (!got || p.readOnly) return;
  await host.save(() => {
    s.journal_style = got.style;
    const ppm = Number(got.ppm);
    if (Number.isFinite(ppm) && ppm > 0 && ppm !== Number(s.hrms_tolerance_ppm ?? 5)) s.hrms_tolerance_ppm = ppm;
    // (written either way: Chemweave's default is [M−Br]⁺, SI Assistant's [M]⁺)
    s[SALT_LABEL_KEY] = got.salt === 'piece' ? 'piece' : 'whole';
    s.auto_nmr_31P = got.p31 === 'true';
    s.auto_nmr_11B = got.b11 === 'true';
  });
}

async function headings(p: SiProject, host: SiSettingsHost): Promise<void> {
  const s = p.settings;
  const preset = presetOf(s);
  const own = storedFormat(s) ?? headingFormat(s) ?? { levels: ['1', 'A', 'a', 'i'], chain: false, end: '.', text: true };
  const level = (i: number): CountStyle => own.levels[Math.min(i, own.levels.length - 1)];
  const counts = Object.entries(COUNT_NAMES).map(([value, label]) => ({ value, label }));
  const fields: Field[] = [
    { name: 'preset', label: 'Heading numbers', value: preset, options: HEADING_PRESETS.map((x) => ({ value: x.id, label: x.label })), help: 'How the compiled SI numbers its headings. As the journal style does: Wiley 1., 1.1.; RSC 1, 1.1; ACS none. Compound titles and general procedures are never numbered. SI Assistant shows the nearest of its own (outline or 1.1.1) for a format it doesn’t have.' },
    { name: 'h1', label: 'Custom format', value: '', type: 'heading', help: 'Used when Heading numbers is “Custom…”. The last level’s count is used for any deeper level.' },
    ...[0, 1, 2, 3].map((i): Field => ({ name: `l${i}`, label: `Level ${i + 1}`, value: level(i), options: counts })),
    { name: 'chain', label: 'Show the numbers of the headings above (1.2.3)', value: String(own.chain), type: 'checkbox', help: 'On: 1.2.3 (or A.1.2). Off: only the heading’s own number, as in an outline.' },
    { name: 'end', label: 'After the number', value: own.end in ENDS ? own.end : '.', options: Object.entries(ENDS).map(([value, label]) => ({ value, label })) },
    { name: 'text', label: 'Also number headings typed in texts', value: String(own.text), type: 'checkbox', help: 'Headings typed in a section’s text, and the General Information heading.' },
  ];
  const formatOf = (v: Record<string, string>): HeadingFormat => ({ levels: [0, 1, 2, 3].map((i) => v[`l${i}`] as CountStyle), chain: v.chain === 'true', end: v.end ?? '.', text: v.text === 'true' });
  const shown = (v: Record<string, string>): HeadingFormat | null => {
    if (v.preset === 'custom') return formatOf(v);
    const scratch: Json = { journal_style: s.journal_style };
    storeHeadingFormat(scratch, v.preset);
    return headingFormat(scratch);
  };
  const got = await ask('Headings', fields, {
    ok: 'Save',
    preview: { title: 'Headings will read', draw: (v) => { const d = document.createElement('p'); d.className = 'si-heading-example'; d.textContent = headingExample(shown(v)); return d; } },
  });
  if (!got || p.readOnly) return;
  await host.save(() => storeHeadingFormat(s, got.preset, formatOf(got)));
}

async function pageSetup(p: SiProject, host: SiSettingsHost): Promise<void> {
  const s = p.settings;
  const v = pageSettings(s);
  // (G5-37: the fields go in from an Insert drop-down, as Word's Insert Page Number; they can still be typed)
  const inserts = { label: 'Insert', items: [{ text: '{page}', label: 'Page Number' }, { text: '{pages}', label: 'Number of Pages' }, { text: '{title}', label: 'Title' }, { text: '{authors}', label: 'Authors' }, { text: '{date}', label: 'Date' }] };
  const zone = (which: 'header' | 'footer', i: number): Field => ({ name: `${which}${i}`, label: ['Left', 'Center', 'Right'][i], value: (which === 'header' ? v.header : v.footer)[i], placeholder: i === 1 && which === 'footer' ? '{page}' : '', inserts });
  const fields: Field[] = [
    { name: 'h1', label: 'Header', value: '', type: 'heading', help: 'Type text, and choose from Insert to add the page number, the number of pages, the title, the authors or the date (they show as {page}, {pages}, {title}, {authors} and {date}).' },
    zone('header', 0), zone('header', 1), zone('header', 2),
    { name: 'h2', label: 'Footer', value: '', type: 'heading', help: 'The journal style’s own puts the page number in the center (Wiley: on the right); a footer left as the style’s keeps following the style.' },
    zone('footer', 0), zone('footer', 1), zone('footer', 2),
    { name: 'h3', label: 'Page numbers', value: '', type: 'heading' },
    { name: 'prefix', label: 'Before the number', value: v.number_prefix, placeholder: 'S', help: 'S makes S1, S2, S3 (as SIs are usually numbered); leave empty for 1, 2, 3.' },
    { name: 'style', label: 'Numbers', value: v.number_style, options: Object.entries(NUMBER_STYLES).map(([value, label]) => ({ value, label })) },
    { name: 'size', label: 'Size', value: String(v.number_size), type: 'number', unit: 'pt (0: as the text)', min: 0, max: 72 },
    { name: 'bold', label: 'Bold', value: String(v.number_bold), type: 'checkbox' },
    { name: 'cover', label: 'Header, footer and number on the cover page', value: String(v.number_on_cover), type: 'checkbox', help: 'Off: the cover page has none (its number still counts). With no cover page printed, the first page has them.' },
  ];
  const fill = (text: string, prefix: string, style: string): string => {
    const num = (n: number): string => prefix + (style === 'i' ? ['i', 'ii'][n - 1] ?? String(n) : style === 'I' ? ['I', 'II'][n - 1] ?? String(n) : String(n));
    const authors = (Array.isArray(s.authors) ? s.authors : []).filter(isObj).map((a) => str(a.name).trim()).filter(Boolean).join(', ');
    return text.replace(/\{page\}/g, num(2)).replace(/\{pages\}/g, prefix + (style === '1' ? '24' : style === 'i' ? 'xxiv' : 'XXIV')).replace(/\{title\}/g, str(s.title)).replace(/\{authors\}/g, authors).replace(/\{date\}/g, dateText());
  };
  const preview = (x: Record<string, string>): Node => {
    const page = document.createElement('div');
    page.className = 'si-page-example';
    const line = (which: 'header' | 'footer') => {
      const row = document.createElement('div');
      row.className = `si-page-${which}`;
      for (let i = 0; i < 3; i++) {
        const cell = document.createElement('span');
        cell.textContent = fill(x[`${which}${i}`] ?? '', x.prefix ?? '', x.style ?? '1');
        if (x.bold === 'true' && /\{page/.test(x[`${which}${i}`] ?? '')) cell.style.fontWeight = '700';
        row.append(cell);
      }
      return row;
    };
    const body = document.createElement('div');
    body.className = 'si-page-body';
    page.append(line('header'), body, line('footer'));
    return page;
  };
  const got = await ask('Page', fields, { ok: 'Save', preview: { title: 'Page 2 will read', draw: preview } });
  if (!got || p.readOnly) return;
  const size = Number(got.size);
  await host.save(() => storePageSettings(s, {
    header: [got.header0, got.header1, got.header2], footer: [got.footer0, got.footer1, got.footer2],
    number_prefix: got.prefix.trim(), number_style: got.style === 'i' || got.style === 'I' ? got.style : '1',
    number_size: Number.isFinite(size) && size > 0 ? size : 0, number_bold: got.bold === 'true', number_on_cover: got.cover === 'true',
  }));
}

/** The label rules as SI Assistant reads them (core/labels.py): a figure's word follows the journal style unless changed. */
function labelDefaults(journal: string): Record<string, { word: string; prefix: string; style: string }> {
  return {
    figure: { word: journal === 'RSC' ? 'Fig.' : 'Figure', prefix: 'S', style: '1' },
    table: { word: 'Table', prefix: 'S', style: '1' },
    scheme: { word: 'Scheme', prefix: 'S', style: '1' },
  };
}

async function labels(p: SiProject, host: SiSettingsHost): Promise<void> {
  const s = p.settings;
  const defs = labelDefaults(str(s.journal_style) || 'ACS');
  const raw = isObj(s.labels) ? s.labels : {};
  const rule = (kind: string) => {
    const stored = isObj(raw[kind]) ? raw[kind] as Json : {};
    return { word: typeof stored.word === 'string' ? stored.word.trim() : defs[kind].word, prefix: typeof stored.prefix === 'string' ? stored.prefix.trim() : defs[kind].prefix, style: str(stored.style) in LABEL_STYLES ? str(stored.style) : defs[kind].style };
  };
  const styles = Object.entries(LABEL_STYLES).map(([value, label]) => ({ value, label }));
  const fields: Field[] = LABEL_KINDS.flatMap((kind): Field[] => {
    const r = rule(kind);
    const name = kind[0].toUpperCase() + kind.slice(1) + 's';
    return [
      { name: `h-${kind}`, label: name, value: '', type: 'heading' },
      { name: `${kind}-word`, label: 'Word', value: r.word, placeholder: defs[kind].word },
      { name: `${kind}-prefix`, label: 'Before the number', value: r.prefix, placeholder: 'S' },
      { name: `${kind}-style`, label: 'Numbers', value: r.style, options: styles },
    ];
  });
  const example = (v: Record<string, string>): Node => {
    const d = document.createElement('p');
    d.className = 'si-heading-example';
    d.textContent = LABEL_KINDS.map((k) => { const style = v[`${k}-style`]; const n = style === 'I' ? 'II' : style === 'i' ? 'ii' : style === 'a' ? 'b' : '2'; return `${(v[`${k}-word`] ?? '').trim()} ${(v[`${k}-prefix`] ?? '').trim()}${n}`.trim(); }).join(' · ');
    return d;
  };
  const got = await ask('Labels', fields, { ok: 'Save', note: 'Figures, tables and schemes are numbered in the order they print. Any one label can still be typed over where it is.', preview: { title: 'The second of each will read', draw: example } });
  if (!got || p.readOnly) return;
  await host.save(() => {
    // only what differs from the defaults, as SI Assistant stores it
    const out: Json = {};
    for (const kind of LABEL_KINDS) {
      const changed: Json = {};
      const now = { word: got[`${kind}-word`].trim(), prefix: got[`${kind}-prefix`].trim(), style: got[`${kind}-style`] };
      for (const k of ['word', 'prefix', 'style'] as const) if (now[k] !== defs[kind][k]) changed[k] = now[k];
      if (Object.keys(changed).length) out[kind] = changed;
    }
    if (Object.keys(out).length) s.labels = out; else delete s.labels;
  });
}

async function structures(p: SiProject, host: SiSettingsHost): Promise<void> {
  const got = await host.chooseDrawingStyle(siDrawingStyle(p.settings), 'How this project’s structures and schemes are drawn, in its pages and the compiled SI. A project starts in ACS Document 1996, as SI Assistant draws it; the bond length, line width and label size are also kept for SI Assistant.');
  if (!got || p.readOnly) return;
  await host.save(() => storeSiDrawingStyle(p.settings, got));
}

async function schemes(p: SiProject, host: SiSettingsHost): Promise<void> {
  const now = projectLayout(p);
  const got = await ask('Schemes', schemeLayoutFields(now), { ok: 'Save', note: 'How every scheme page is laid out unless its own Layout (Scheme ▸ Layout) says otherwise.' });
  if (!got || p.readOnly) return;
  await host.save(() => setProjectLayout(p, { ...now, ...readSchemeLayout(got) }));
}

// ---------------------------------------------------------------- NMR impurities

const NUCLEUS_LABEL: Record<string, string> = { '1H': '¹H', '13C': '¹³C' };

/** The solvent and impurity shifts behind the impurity-peak check, as SI Assistant's Project settings ▸ NMR impurities edits them. */
async function impurities(p: SiProject, host: SiSettingsHost): Promise<void> {
  const s = p.settings;
  const [tolH, tolC] = impurityTolerances(s);
  const body = document.createElement('div');
  body.className = 'si-imp';
  const bar = document.createElement('div');
  bar.className = 'si-imp-bar';
  const show = document.createElement('select');
  show.setAttribute('aria-label', 'Show the rows of');
  const showLabel = document.createElement('label');
  showLabel.append('Show ', show);
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Add Row';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset to Built-in Table';
  bar.append(showLabel, add, reset);
  const wrap = document.createElement('div');
  wrap.className = 'si-imp-wrap';
  const table = document.createElement('table');
  table.className = 'si-imp-table';
  const head = table.createTHead().insertRow();
  for (const h of ['Use', 'Solvent', 'Nucleus', 'δ (ppm)', 'What it is', '']) {
    const th = head.appendChild(document.createElement('th'));
    th.textContent = h;
    if (h === 'Solvent') addInfo(th, 'Solvents are recognized however the NMR report writes them (CD₃OD, MeOD or methanol-d₄; DMSO-d₆ or (CD₃)₂SO; CDCl₃ or chloroform-d).');
    if (h === 'δ (ppm)') addInfo(th, 'Rows without a number in δ are left out.');
  }
  const tbody = table.createTBody();
  wrap.append(table);
  const solvents = document.createElement('datalist');
  solvents.id = `si-imp-solvents-${Math.random().toString(36).slice(2, 8)}`;
  for (const name of Object.keys(SOLVENT_NAMES)) solvents.append(new Option(name));
  body.append(bar, wrap, solvents);

  const row = (r: Partial<ImpurityRow>): void => {
    const tr = tbody.insertRow();
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = r.on !== false;
    on.setAttribute('aria-label', 'Use this row');
    const solvent = document.createElement('input');
    solvent.value = String(r.solvent ?? '');
    solvent.setAttribute('list', solvents.id);
    solvent.setAttribute('aria-label', 'Solvent');
    const nucleus = document.createElement('select');
    for (const n of ['1H', '13C']) nucleus.add(new Option(NUCLEUS_LABEL[n], n, false, n === (r.nucleus ?? '1H')));
    if (r.nucleus && !NUCLEUS_LABEL[r.nucleus]) nucleus.add(new Option(r.nucleus, r.nucleus, false, true));
    nucleus.setAttribute('aria-label', 'Nucleus');
    const shift = document.createElement('input');
    shift.value = r.shift === undefined || r.shift === '' ? '' : String(r.shift);
    shift.inputMode = 'decimal';
    shift.className = 'si-imp-shift';
    shift.setAttribute('aria-label', 'Shift in ppm');
    const what = document.createElement('input');
    what.value = String(r.what ?? '');
    what.setAttribute('aria-label', 'What it is');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'si-imp-del';
    del.textContent = '×';
    del.title = 'Remove this row';
    del.addEventListener('click', () => { tr.remove(); choices(); });
    for (const [el, cell] of [[on, 'use'], [solvent, ''], [nucleus, ''], [shift, ''], [what, 'what'], [del, '']] as const) {
      const td = tr.insertCell();
      if (cell) td.className = `si-imp-${cell}`;
      td.append(el);
    }
    solvent.addEventListener('change', choices);
  };
  const rows = (): HTMLTableRowElement[] => [...tbody.rows];
  const cells = (tr: HTMLTableRowElement): [boolean, string, string, string, string] => {
    const [on, solvent, nucleus, shift, what] = [...tr.cells].map((c) => c.firstElementChild as HTMLInputElement);
    return [on.checked, solvent.value, nucleus.value, shift.value, what.value];
  };
  const filter = (): void => {
    const want = show.value;
    for (const tr of rows()) { const sv = cells(tr)[1].trim(); tr.hidden = !!want && !!sv && sv !== want; }
  };
  function choices(): void {
    const now = show.value;
    const names = [...new Set(rows().map((tr) => cells(tr)[1].trim()).filter(Boolean))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    show.replaceChildren(new Option('All solvents', ''), ...names.map((n) => new Option(n, n)));
    show.value = names.includes(now) ? now : '';
    filter();
  }
  const load = (list: ImpurityRow[]): void => { tbody.replaceChildren(); for (const r of list) row(r); choices(); };
  show.addEventListener('change', filter);
  add.addEventListener('click', () => { row({ solvent: show.value, nucleus: '1H', shift: '', what: '', on: true }); const last = rows().at(-1); last?.scrollIntoView({ block: 'nearest' }); (last?.cells[1].firstElementChild as HTMLElement | null)?.focus(); });
  reset.addEventListener('click', () => void askChoice('Reset to Built-in Table', 'Replace this table with the built-in one? Your changes to it are lost (when you save).', [{ value: 'keep', label: 'Cancel' }, { value: 'reset', label: 'Reset', primary: true }], 'keep').then((go) => {
    if (go !== 'reset') return;
    load(defaultImpurityTable());
    for (const [name, v] of [['tolH', DEFAULT_TOLERANCES[0]], ['tolC', DEFAULT_TOLERANCES[1]]] as const) {
      const el = body.closest('form')?.querySelector<HTMLInputElement>(`[data-field="${name}"] input`);
      if (el) el.value = String(v);
    }
  }));
  load(projectImpurityTable(s));
  if (p.readOnly) for (const el of body.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) if (el !== show) el.disabled = true;

  const got = await ask('NMR Impurities', [
    { name: 'tolH', label: 'Match ¹H within', value: tolH.toFixed(3), unit: 'ppm', type: 'number', min: 0, max: 1, help: `Default ${DEFAULT_TOLERANCES[0].toFixed(3)} ppm.` },
    { name: 'tolC', label: 'Match ¹³C within', value: tolC.toFixed(3), unit: 'ppm', type: 'number', min: 0, max: 1, help: `Default ${DEFAULT_TOLERANCES[1].toFixed(3)} ppm.` },
  ], { ok: 'Save', body, note: 'A ¹H peak reported as a singlet, or any ¹³C peak, at one of these shifts (in the same solvent) gets a “check it isn’t a solvent or impurity peak” warning. The built-in values are from Fulmer et al., Organometallics 2010, 29, 2176. Uncheck a row to stop checking it; edit, add or remove rows. Changes apply to this project only, and SI Assistant uses them too.' });
  if (!got || p.readOnly) return;
  const table2 = rows().map((tr) => impurityRowFrom(...cells(tr))).filter((r): r is ImpurityRow => !!r);
  await host.save(() => {
    storeImpurityTable(s, table2);
    const h = Number(got.tolH), c = Number(got.tolC);
    storeImpurityTolerances(s, Number.isFinite(h) && h >= 0 ? h : tolH, Number.isFinite(c) && c >= 0 ? c : tolC);
  });
}

// ---------------------------------------------------------------- dictionary

/** The project's dictionary.txt: words spelled right in its text, and printed as written (not formatted as chemistry). */
async function dictionary(p: SiProject, host: SiSettingsHost): Promise<void> {
  const text = (await p.folder.readText(DICTIONARY_FILE).catch(() => null)) ?? '';
  const got = await ask('Dictionary', [
    { name: 'words', label: 'Words, one per line', value: text, type: 'textarea', placeholder: 'e.g. CDK2' },
  ], { ok: 'Save', note: `The project's own words (${DICTIONARY_FILE} in the project folder, shared with co-authors and Chem SI Assistant). They are never underlined, and are printed as written: “CDK2” is not subscripted. Lines starting with # are comments. Right-click an underlined word ▸ Add to This Project’s Dictionary adds one.` });
  if (!got || p.readOnly) return;
  const next = got.words.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (next === text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')) return;
  await host.save(async () => { await p.folder.writeText(DICTIONARY_FILE, next ? next + '\n' : ''); });
  host.dictionaryChanged();
}
