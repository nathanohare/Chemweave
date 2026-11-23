// An SI project's front matter (SPEC §13k.4), on the project's own page: the cover page (its
// heading, the title, authors with their affiliations and who is corresponding, the
// affiliations, the space between them and an extra text), the table of contents (its title and
// how much it lists) and the General Information text with its heading. Kept in project.json
// and front/*.txt as SI Assistant keeps them.

import type { Json, SiProject } from '../si/project';
import { COVER_HEADINGS } from '../si/compile-doc';
import { COVER_GAP_KEYS, COVER_GAP_LABELS, TOC_LIST_KEYS, TOC_LIST_LABELS, coverGaps, storeCoverGaps, storeTocLists, tocLists } from '../si/front-layout';
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

  /** A text box saved as it is typed in (0.7 s after the last key, so the live preview follows it) and as you leave it. */
  private input(value: string, placeholder: string, label: string, save: (v: string) => void, cls = ''): HTMLInputElement {
    const i = el('input', cls);
    i.value = value;
    i.placeholder = placeholder;
    i.setAttribute('aria-label', label);
    let last = i.value;
    let timer = 0;
    const flush = (): void => { clearTimeout(timer); timer = 0; if (i.value === last) return; last = i.value; save(i.value.trim()); };
    i.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(flush, 700); });
    i.addEventListener('change', flush);
    this.flushers.push(flush);
    return i;
  }

  /** A number box (points) saved as it is typed in and as you leave it; an empty or unreadable box is put back. */
  private number(value: number, label: string, save: (v: number) => void): HTMLInputElement {
    const i = el('input', 'si-front-num');
    i.type = 'number';
    i.min = '0';
    i.max = '400';
    i.step = '1';
    i.value = String(value);
    i.setAttribute('aria-label', `${label} (points)`);
    let last = i.value;
    let timer = 0;
    const flush = (): void => {
      clearTimeout(timer);
      timer = 0;
      if (i.value === last) return;
      const v = Number(i.value);
      if (i.value.trim() === '' || !Number.isFinite(v) || v < 0) { i.value = last; return; }
      last = i.value;
      save(Math.min(400, v));
    };
    i.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(flush, 700); });
    i.addEventListener('change', flush);
    this.flushers.push(flush);
    return i;
  }

  /** "+ Add Author" under a list (the same as Insert ▸ Author). */
  private addButton(text: string, title: string, act: () => void): HTMLButtonElement {
    const b = el('button', 'si-link si-front-add', `+ ${text}`);
    b.type = 'button';
    b.title = title;
    b.disabled = this.p.readOnly;
    b.addEventListener('click', act);
    return b;
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
    // the space above the heading and after each part, in points (SI Assistant gets the nearest single spacing)
    const gaps = el('div', 'si-front-gaps');
    const now = coverGaps(this.s);
    for (const g of COVER_GAP_KEYS) {
      const box = this.number(now[g], COVER_GAP_LABELS[g], (v) => { const all = coverGaps(this.s); all[g] = v; storeCoverGaps(this.s, all); void this.save(); });
      const lab = el('label', 'si-front-gap');
      lab.append(el('span', '', COVER_GAP_LABELS[g]), box, el('span', 'muted', 'pt'));
      gaps.append(lab);
    }
    const spLab = el('span', 'si-front-lab si-front-top', 'Spacing');
    addInfo(spLab, 'The space on the cover page, in points: above the heading (to start it further down the page), and after the heading, the title, the author line, the last affiliation and the email line. Chem SI Assistant keeps one spacing for all of them, so it gets the nearest one.');
    grid.append(spLab, gaps);
    cover.append(grid);

    // authors
    const authors = rows(this.s.authors);
    const aHead = el('div', 'si-front-head', 'Authors');
    cover.append(aHead);
    const aList = el('div', 'si-front-list');
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
    cover.append(aList, this.addButton('Add Author', 'A new author at the end of the list (Insert ▸ Author)', () => this.add('author')));

    // affiliations
    const affs = rows(this.s.affiliations);
    cover.append(el('div', 'si-front-head', 'Affiliations'));
    const fList = el('div', 'si-front-list');
    affs.forEach((f, i) => {
      const r = el('div', 'si-front-aff');
      const mark = this.input(str(f.marker), 'a', `Affiliation ${i + 1}'s letter`, (v) => { f.marker = v; void this.save(); }, 'si-front-mark');
      const text = this.input(str(f.text), 'Department, university, city, country', `Affiliation ${i + 1}`, (v) => { f.text = v; void this.save(); }, 'si-front-afftext');
      const up = this.mini('▲', 'Move up', () => { affs.splice(i - 1, 0, ...affs.splice(i, 1)); this.s.affiliations = affs; void this.save(true); }, i === 0);
      const rm = this.mini('✕', 'Take this affiliation off', () => { affs.splice(i, 1); this.s.affiliations = affs; void this.save(true); });
      r.append(mark, text, up, rm);
      fList.append(r);
    });
    cover.append(fList, this.addButton('Add Affiliation', 'A new affiliation at the end of the list, with the next letter (Insert ▸ Affiliation)', () => this.add('affiliation')));

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
    // a switch for each kind of heading (SI Assistant gets the nearest of its depths)
    const lists = el('div', 'si-front-lists');
    const on = tocLists(this.s);
    for (const k of TOC_LIST_KEYS) {
      const c = el('input');
      c.type = 'checkbox';
      c.checked = on[k];
      c.addEventListener('change', () => { const l = tocLists(this.s); l[k] = c.checked; storeTocLists(this.s, l); void this.save(); });
      const lab = el('label', 'si-part');
      lab.append(c, TOC_LIST_LABELS[k]);
      lists.append(lab);
    }
    const lLab = el('span', 'si-front-lab si-front-top', 'Lists');
    addInfo(lLab, 'The headings the table of contents lists, each kind on its own. Headings in section text are the headings typed in Custom sections and General Information. Chem SI Assistant keeps one depth (sections, sub-sections, general procedures or compounds), so it gets the nearest one.');
    tg.append(lLab, lists);
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
