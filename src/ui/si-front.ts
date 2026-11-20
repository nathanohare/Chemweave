// An SI project's front matter (SPEC §13k.4), on the project's own page: the cover page (its
// heading, the title, authors with their affiliations and who is corresponding, the
// affiliations, the space between them and an extra text), the table of contents (its title and
// how much it lists) and the General Information text with its heading. Kept in project.json
// and front/*.txt as SI Assistant keeps them.

import type { Json, SiProject } from '../si/project';
import { COVER_HEADINGS, COVER_SPACINGS, coverSpacing } from '../si/compile-doc';
import { SiRichBox } from './si-rich';
import { addInfo } from './info-tip';

export interface SiFrontHost {
  project: SiProject;
  flash(msg: string, ms?: number): void;
  label(ref: string): string;
  mentionable(): { id: string; label: string; text: string }[];
  /** Saved: the tab's name follows the title. */
  titleChanged(): void;
  /** Draw the page again (an author or affiliation added, moved or taken off). */
  redraw(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const dict = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const rows = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const TOC_DEPTHS: [string, string][] = [['sections', 'Sections only'], ['subsections', 'Sections and sub-sections'], ['procedures', 'Sections, sub-sections and general procedures'], ['compounds', 'Sections, sub-sections, general procedures and every compound']];

export class SiFrontPage {
  readonly el = el('div', 'si-front');
  readonly boxes: SiRichBox[] = [];

  constructor(private host: SiFrontHost) { this.build(); }

  private get p(): SiProject { return this.host.project; }
  private get s(): Json { return this.p.settings; }

  /** The page's saves, one after another (never rejected). */
  private pending: Promise<void> = Promise.resolve();
  private flushers: (() => void)[] = [];
  private track(f: () => Promise<unknown>): Promise<void> {
    this.pending = this.pending.then(f).then(() => {}, () => {});
    return this.pending;
  }

  /** What is typed in a box that still has the keys is saved; done when every save of this page has been written. */
  settled(): Promise<void> {
    for (const f of this.flushers) f();
    return this.pending;
  }

  private save(redraw = false): Promise<void> {
    return this.track(async () => {
      try { await this.p.saveSettings(); } catch (e) { this.host.flash(`The change could not be saved: ${e instanceof Error ? e.message : String(e)}`, 8000); }
      if (redraw) this.host.redraw();
    });
  }

  /** A text box saved as you leave it. */
  private input(value: string, placeholder: string, label: string, save: (v: string) => void, cls = ''): HTMLInputElement {
    const i = el('input', cls);
    i.value = value;
    i.placeholder = placeholder;
    i.setAttribute('aria-label', label);
    let last = i.value;
    const flush = (): void => { if (i.value === last) return; last = i.value; save(i.value.trim()); };
    i.addEventListener('change', flush);
    this.flushers.push(flush);
    return i;
  }

  private mini(text: string, title: string, act: () => void, disabled = false): HTMLButtonElement {
    const b = el('button', 'si-mini', text);
    b.type = 'button';
    b.title = title;
    b.disabled = disabled;
    b.addEventListener('click', act);
    return b;
  }

  private build(): void {
    const p = this.p;
    // ---- the cover page
    const cover = el('div', 'si-card');
    const ch = el('h3', 'si-sub', 'Cover page');
    addInfo(ch, 'The first page of the compiled SI: its heading, the title, the authors (with their affiliations’ letters, and * for the corresponding authors, whose emails print under the affiliations), the affiliations and an extra text. Insert ▸ Author and Affiliation add them.');
    cover.append(ch);
    const grid = el('div', 'si-front-grid');
    const coverSet = dict(this.s.cover);
    const auto = COVER_HEADINGS[str(this.s.journal_style)] ?? 'Supporting Information';
    grid.append(el('span', 'si-front-lab', 'Heading'), this.input(str(coverSet.heading), auto, 'Cover heading', (v) => {
      const c = { ...dict(this.s.cover) };
      if (v && v !== auto) c.heading = v; else delete c.heading;
      if (Object.keys(c).length) this.s.cover = c; else delete this.s.cover;
      void this.save();
    }));
    grid.append(el('span', 'si-front-lab', 'Title'), this.input(str(this.s.title), 'The title of the paper', 'Title', (v) => { this.s.title = v; void this.save().then(() => this.host.titleChanged()); }, 'si-front-title'));
    const spacing = el('select');
    for (const [l, v] of Object.entries(COVER_SPACINGS)) spacing.add(new Option(l, String(v)));
    const k = coverSpacing(this.s);
    if (!Object.values(COVER_SPACINGS).includes(k)) spacing.add(new Option(`${k}×`, String(k)));
    spacing.value = String(k);
    spacing.setAttribute('aria-label', 'Spacing');
    spacing.addEventListener('change', () => {
      const c = { ...dict(this.s.cover) };
      const n = Number(spacing.value);
      if (n === 1) delete c.spacing; else c.spacing = n;
      if (Object.keys(c).length) this.s.cover = c; else delete this.s.cover;
      void this.save();
    });
    const spLab = el('span', 'si-front-lab', 'Spacing');
    spLab.title = 'The space between the heading, title, authors, affiliations and emails';
    grid.append(spLab, spacing);
    cover.append(grid);

    // authors
    const authors = rows(this.s.authors);
    const aHead = el('div', 'si-front-head', 'Authors');
    cover.append(aHead);
    const aList = el('div', 'si-front-list');
    if (!authors.length) aList.append(el('p', 'muted si-note', 'No authors yet: Insert ▸ Author.'));
    authors.forEach((a, i) => {
      const r = el('div', 'si-front-author');
      const name = this.input(str(a.name), 'Name', `Author ${i + 1}`, (v) => { a.name = v; void this.save(); }, 'si-front-name');
      const affs = this.input((Array.isArray(a.affiliations) ? a.affiliations : []).map(String).join(', '), 'a, b', `Author ${i + 1}'s affiliations`, (v) => { a.affiliations = v.split(/[\s,;]+/).filter(Boolean); void this.save(); }, 'si-front-marks');
      affs.title = 'The letters of the author’s affiliations (as in the list below), printed after the name';
      const corr = el('input');
      corr.type = 'checkbox';
      corr.checked = !!a.corresponding;
      const corrLab = el('label', 'si-part');
      corrLab.title = 'Corresponding author: * after the name, the email printed on the cover';
      corrLab.append(corr, 'Corresponding');
      const email = this.input(str(a.email), 'Email', `Author ${i + 1}'s email`, (v) => { a.email = v; void this.save(); }, 'si-front-email');
      email.hidden = !corr.checked;
      corr.addEventListener('change', () => { a.corresponding = corr.checked; email.hidden = !corr.checked; void this.save(); });
      const up = this.mini('▲', 'Move up', () => { authors.splice(i - 1, 0, ...authors.splice(i, 1)); this.s.authors = authors; void this.save(true); }, i === 0);
      const rm = this.mini('✕', 'Take this author off', () => { authors.splice(i, 1); this.s.authors = authors; void this.save(true); });
      r.append(name, affs, corrLab, email, el('span', 'si-fill'), up, rm);
      aList.append(r);
    });
    cover.append(aList);

    // affiliations
    const affs = rows(this.s.affiliations);
    cover.append(el('div', 'si-front-head', 'Affiliations'));
    const fList = el('div', 'si-front-list');
    if (!affs.length) fList.append(el('p', 'muted si-note', 'No affiliations yet: Insert ▸ Affiliation.'));
    affs.forEach((f, i) => {
      const r = el('div', 'si-front-aff');
      const mark = this.input(str(f.marker), 'a', `Affiliation ${i + 1}'s letter`, (v) => { f.marker = v; void this.save(); }, 'si-front-mark');
      const text = this.input(str(f.text), 'Department, university, city, country', `Affiliation ${i + 1}`, (v) => { f.text = v; void this.save(); }, 'si-front-afftext');
      const up = this.mini('▲', 'Move up', () => { affs.splice(i - 1, 0, ...affs.splice(i, 1)); this.s.affiliations = affs; void this.save(true); }, i === 0);
      const rm = this.mini('✕', 'Take this affiliation off', () => { affs.splice(i, 1); this.s.affiliations = affs; void this.save(true); });
      r.append(mark, text, up, rm);
      fList.append(r);
    });
    cover.append(fList);

    // the cover's extra text
    const extraHead = el('div', 'si-front-head', 'Extra text');
    addInfo(extraHead, 'Printed under the emails on the cover page (a note, a list of contents…).');
    cover.append(extraHead);
    const extra = new SiRichBox('', { label: this.host.label, mentionable: this.host.mentionable, changed: (v) => void this.track(() => p.writeFrontText('cover', v).catch((e: unknown) => this.host.flash(`Not saved: ${String(e)}`))) }, true, 'Anything else for the cover page (optional)');
    this.boxes.push(extra);
    void p.readFrontText('cover').then((t) => extra.set(t));
    cover.append(extra.el);
    this.el.append(cover);

    // ---- the table of contents
    const toc = el('div', 'si-card');
    const th = el('h3', 'si-sub', 'Table of contents');
    addInfo(th, 'On the page after the cover, with page numbers (S1, S2…).');
    toc.append(th);
    const tg = el('div', 'si-front-grid');
    const tocSet = dict(this.s.toc);
    const setToc = (k: string, v: unknown): void => { this.s.toc = { ...dict(this.s.toc), [k]: v }; void this.save(); };
    tg.append(el('span', 'si-front-lab', 'Title'), this.input(typeof tocSet.title === 'string' ? tocSet.title : 'Table of Contents', 'No title', 'Contents title', (v) => setToc('title', v)));
    const depth = el('select');
    for (const [v, l] of TOC_DEPTHS) depth.add(new Option(l, v));
    depth.value = TOC_DEPTHS.some(([v]) => v === tocSet.depth) ? str(tocSet.depth) : this.s.list_compounds_in_toc ? 'compounds' : 'procedures';
    depth.setAttribute('aria-label', 'What it lists');
    depth.addEventListener('change', () => setToc('depth', depth.value));
    tg.append(el('span', 'si-front-lab', 'Lists'), depth);
    toc.append(tg);
    this.el.append(toc);

    // ---- General Information
    const gi = el('div', 'si-card');
    const gh = el('h3', 'si-sub', 'General Information');
    addInfo(gh, 'Printed after the contents, before the first section: materials, instruments and methods. Mention compounds with @ and cite references as in other texts. Leave the heading empty to print the text without one.');
    gi.append(gh);
    const gg = el('div', 'si-front-grid');
    const info = dict(this.s.general_information);
    gg.append(el('span', 'si-front-lab', 'Heading'), this.input(info.heading === undefined ? 'General Information' : str(info.heading), 'No heading', 'General Information heading', (v) => {
      const g = { ...dict(this.s.general_information) };
      if (v === 'General Information') delete g.heading; else g.heading = v;
      if (Object.keys(g).length) this.s.general_information = g; else delete this.s.general_information;
      void this.save();
    }));
    gi.append(gg);
    const text = new SiRichBox('', { label: this.host.label, mentionable: this.host.mentionable, changed: (v) => void this.track(() => p.writeFrontText('general', v).catch((e: unknown) => this.host.flash(`Not saved: ${String(e)}`))) }, true, 'Materials, instruments and general methods…');
    this.boxes.push(text);
    void p.readFrontText('general').then((t) => text.set(t));
    gi.append(text.el);
    this.el.append(gi);
  }

  /** Insert ▸ Author or Affiliation: a new row at the end, its first box ready to type in. */
  add(what: 'author' | 'affiliation'): void {
    if (what === 'author') {
      const list = rows(this.s.authors);
      const firstAff = str(rows(this.s.affiliations)[0]?.marker);
      list.push({ name: '', affiliations: firstAff ? [firstAff] : [], corresponding: false, email: '' });
      this.s.authors = list;
    } else {
      const list = rows(this.s.affiliations);
      const used = new Set(list.map((a) => str(a.marker)));
      const marker = [...'abcdefghijklmnopqrstuvwxyz'].find((m) => !used.has(m)) ?? '';
      list.push({ marker, text: '' });
      this.s.affiliations = list;
    }
    void this.save(true).then(() => {
      const sel = what === 'author' ? '.si-front-author:last-child .si-front-name' : '.si-front-aff:last-child .si-front-afftext';
      document.querySelector<HTMLInputElement>(`#si-pane ${sel}`)?.focus();
    });
  }
}
