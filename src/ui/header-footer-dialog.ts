// Insert > Slides > Header & Footer (also Date & Time and Slide Number): the date (today's, kept up to
// date in the form picked, or fixed text), slide number and footer on the slides, for the slides
// picked (Apply) or every slide (Apply to All), and the header, footer, date and page numbers of
// notes pages and handouts. Saved as PowerPoint's own date, number and footer placeholders.

import { DATE_FORMATS, dateText, defaultNotesHF, showsDate, showsFooter, showsNumber, type DateFormat, type LayoutId, type Master, type Deck, type NotesHF, type SlideHF } from '../deck/deck';
import { showDialog } from './dialog-host';
import { addInfo } from './info-tip';

export interface HeaderFooterResult {
  master: Master;
  /** What the slides show (for the slides picked, or every slide). */
  show: { number: boolean; footer: boolean; date: boolean };
  /**
   * Apply (the slides picked), Apply to All (every slide), or, from the Notes and Handouts tab, 'notes':
   * only the notes pages and handouts change; the master's slide number, date and footer and each
   * slide's own settings stay as they were.
   */
  scope: 'picked' | 'all' | 'notes';
}

/** Show the window for a deck with this master; `slide` is the slide being edited (its layout and own say). */
export function editHeaderFooter(m: Master, slide: { layout: LayoutId; hf?: SlideHF }, picked: number, tab: 'slide' | 'notes' = 'slide'): Promise<HeaderFooterResult | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask hf-dialog';
    const form = document.createElement('form');
    form.method = 'dialog';
    d.append(form);
    const h = document.createElement('h2');
    h.textContent = 'Header and Footer';
    addInfo(h, `Apply changes ${picked > 1 ? `the ${picked} selected slides` : 'the slide being edited'}; Apply to All changes every slide. Notes and Handouts sets printed notes pages and handouts (File ▸ Print), and PowerPoint's notes and handout masters.`);
    const tabs = document.createElement('div');
    tabs.className = 'hf-tabs';
    tabs.setAttribute('role', 'tablist');
    const pages = { slide: document.createElement('div'), notes: document.createElement('div') };
    const tabBtn = (id: 'slide' | 'notes', label: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.textContent = label;
      b.addEventListener('click', () => show(id));
      tabs.append(b);
      return b;
    };
    const tabBtns = { slide: tabBtn('slide', 'Slide'), notes: tabBtn('notes', 'Notes and Handouts') };
    let showing: 'slide' | 'notes' = tab;
    const show = (id: 'slide' | 'notes') => {
      showing = id;
      for (const k of ['slide', 'notes'] as const) {
        pages[k].hidden = k !== id;
        tabBtns[k].setAttribute('aria-selected', String(k === id));
      }
      apply.hidden = id !== 'slide';
    };

    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => { const x = document.createElement(tag); if (cls) x.className = cls; return x; };
    const check = (label: string, on: boolean, title = '') => {
      const l = el('label', 'hf-check');
      const i = el('input');
      i.type = 'checkbox';
      i.checked = on;
      l.append(i, ` ${label}`);
      if (title) l.title = title;
      return { l, i };
    };
    const textBox = (v: string, placeholder = '') => { const i = el('input'); i.type = 'text'; i.value = v; i.placeholder = placeholder; return i; };
    /** Today's date, kept up to date in a form, or fixed text: the radio buttons and boxes. */
    const dateBlock = (name: string, on: boolean, fmt: DateFormat | undefined, fixed: string | undefined) => {
      const box = el('div', 'hf-block');
      const c = check('Date and time', on, 'The date (and time) at the bottom left');
      const auto = el('label', 'hf-radio');
      const ra = el('input');
      ra.type = 'radio'; ra.name = name; ra.checked = !fixed?.trim();
      const sel = el('select');
      for (const f of DATE_FORMATS) sel.add(new Option(exampleOf(f.id), f.id));
      sel.value = fmt ?? 'datetime1';
      auto.append(ra, ' Update automatically ', sel);
      auto.title = 'Today\'s date when the slides are shown or printed (PowerPoint keeps it up to date too)';
      const fix = el('label', 'hf-radio');
      const rf = el('input');
      rf.type = 'radio'; rf.name = name; rf.checked = !!fixed?.trim();
      const ft = textBox(fixed ?? '', 'e.g. Group meeting, 22 October 2026');
      fix.append(rf, ' Fixed ', ft);
      fix.title = 'This text stays as it is';
      const sync = () => { for (const x of [ra, rf, sel, ft]) x.disabled = !c.i.checked; };
      c.i.addEventListener('change', sync);
      ft.addEventListener('input', () => { if (ft.value) rf.checked = true; });
      sync();
      box.append(c.l, auto, fix);
      return { box, on: c.i, fixed: () => (rf.checked ? ft.value : ''), format: () => sel.value as DateFormat };
    };

    // ---- the slides
    const sd = dateBlock('hf-date', showsDate(m, slide.layout, slide.hf), m.dateFormat, m.dateFixed);
    const num = check('Slide number', showsNumber(m, slide.layout, slide.hf), 'The slide\'s number at the bottom right');
    const foot = check('Footer', showsFooter(m, slide.layout, slide.hf), 'Text at the bottom in the middle');
    const footText = textBox(m.footer, 'e.g. Smith group · Auburn University');
    footText.addEventListener('input', () => { if (footText.value.trim()) foot.i.checked = true; });
    const footRow = el('div', 'hf-block');
    footRow.append(foot.l, footText);
    const offTitle = check('Don\'t show on title slide', !m.numberTitleSlides, 'Title Slide layouts show none of the three');
    // a preview of where each goes, as PowerPoint shows one: a slide with the date bottom left,
    // the footer in the middle and the number bottom right
    const slidePic = previewBox('hf-preview hf-slide', 'Where they go on a slide');
    const fields = el('div', 'hf-fields');
    fields.append(sd.box, num.l, footRow, offTitle.l);
    pages.slide.append(fields, slidePic.box);

    // ---- notes pages and handouts
    const n0 = m.notesHF ?? defaultNotesHF();
    const nd = dateBlock('hf-ndate', n0.date, n0.dateFormat, n0.dateFixed);
    const hdr = check('Header', !!n0.header.trim(), 'Text at the top left of each notes page and handout');
    const hdrText = textBox(n0.header);
    hdrText.addEventListener('input', () => { if (hdrText.value.trim()) hdr.i.checked = true; });
    const hdrRow = el('div', 'hf-block');
    hdrRow.append(hdr.l, hdrText);
    const page = check('Page number', n0.pageNumbers, 'The page\'s number at the bottom right');
    const nfoot = check('Footer', !!n0.footer.trim(), 'Text at the bottom left');
    const nfootText = textBox(n0.footer);
    nfootText.addEventListener('input', () => { if (nfootText.value.trim()) nfoot.i.checked = true; });
    const nfootRow = el('div', 'hf-block');
    nfootRow.append(nfoot.l, nfootText);
    const notesPic = previewBox('hf-preview hf-notes', 'Where they go on a notes page');
    const nfields = el('div', 'hf-fields');
    nfields.append(nd.box, hdrRow, page.l, nfootRow);
    pages.notes.append(nfields, notesPic.box);
    pages.slide.classList.add('hf-page');
    pages.notes.classList.add('hf-page');
    const note = () => {
      slidePic.set({
        bl: sd.on.checked ? sd.fixed() || dateText({ dateFormat: sd.format() }) : '',
        bc: foot.i.checked ? footText.value.trim() : '',
        br: num.i.checked ? '1' : '',
      });
      notesPic.set({
        tl: hdr.i.checked ? hdrText.value.trim() : '',
        tr: nd.on.checked ? nd.fixed() || dateText({ dateFormat: nd.format() }) : '',
        bl: nfoot.i.checked ? nfootText.value.trim() : '',
        br: page.i.checked ? '1' : '',
      });
    };
    form.addEventListener('input', note);
    form.addEventListener('change', note);

    const buttons = el('p', 'ask-buttons');
    const cancel = el('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const apply = el('button');
    apply.type = 'button';
    apply.textContent = 'Apply';
    apply.title = picked > 1 ? `Only the ${picked} selected slides` : 'Only the slide being edited';
    const all = el('button', 'primary');
    all.type = 'submit';
    all.textContent = 'Apply to All';
    buttons.append(cancel, apply, all);
    form.append(h, tabs, pages.slide, pages.notes, buttons);
    show(tab);
    note();

    let finished = false;
    const done = (v: HeaderFooterResult | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    const result = (scope: 'picked' | 'all'): HeaderFooterResult => {
      const notes: NotesHF = {
        header: hdr.i.checked ? hdrText.value : '', footer: nfoot.i.checked ? nfootText.value : '',
        date: nd.on.checked, dateFormat: nd.format(), ...(nd.fixed().trim() ? { dateFixed: nd.fixed().trim() } : {}), pageNumbers: page.i.checked,
      };
      // confirming on the Notes and Handouts tab changes only the notes pages and handouts: the slide
      // boxes on the other tab were filled from the current slide and were never looked at
      if (showing === 'notes') {
        return { master: { ...m, notesHF: notes }, show: { number: showsNumber(m, slide.layout, slide.hf), footer: showsFooter(m, slide.layout, slide.hf), date: showsDate(m, slide.layout, slide.hf) }, scope: 'notes' };
      }
      const off = offTitle.i.checked;
      const fixed = sd.fixed().trim();
      const master: Master = {
        ...m,
        footer: footText.value,
        dateFormat: sd.format(),
        numberTitleSlides: !off,
        notesHF: notes,
      };
      if (fixed) master.dateFixed = fixed; else delete master.dateFixed;
      if (off) master.footerOffTitle = true; else delete master.footerOffTitle;
      // with the footer unticked everywhere, its text is kept for later
      return { master, show: { number: num.i.checked, footer: foot.i.checked && !!footText.value.trim(), date: sd.on.checked }, scope };
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); done(result('all')); });
    apply.addEventListener('click', () => done(result('picked')));
    cancel.addEventListener('click', () => done(null));
    d.addEventListener('close', () => done(null));
    showDialog(d);
  });
}

/**
 * Put what the window returned into the deck, as one step of Undo. Apply to All changes every slide;
 * Apply changes the slides picked (`picked`); from the Notes and Handouts tab only the notes pages
 * and handouts change, so no slide's own setting and none of the master's slide number, date or
 * footer is touched.
 */
export function applyHeaderFooter(d: Pick<Deck, 'setHeaderFooter'>, got: HeaderFooterResult, picked: number[]): void {
  d.setHeaderFooter(got.master, got.show, got.scope === 'all' ? undefined : got.scope === 'picked' ? picked : []);
}

type Spot = 'tl' | 'tr' | 'bl' | 'bc' | 'br';

/** A small page (a slide, or a notes page) with the header, footer, date and number at their places; empty places show nothing. */
export function previewBox(className: string, label: string): { box: HTMLElement; set(spots: Partial<Record<Spot, string>>): void } {
  const box = document.createElement('div');
  box.className = className;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', label);
  const body = document.createElement('div');
  body.className = 'hf-body';
  box.append(body);
  const spots = new Map<Spot, HTMLElement>();
  for (const k of ['tl', 'tr', 'bl', 'bc', 'br'] as const) {
    const s = document.createElement('span');
    s.className = `hf-spot hf-${k}`;
    spots.set(k, s);
    box.append(s);
  }
  return {
    box,
    set(v) {
      for (const [k, s] of spots) {
        const t = v[k] ?? '';
        s.textContent = t;
        s.hidden = !t;
      }
      box.setAttribute('aria-label', `${label}: ${Object.entries(v).filter(([, t]) => t).map(([k, t]) => `${({ tl: 'top left', tr: 'top right', bl: 'bottom left', bc: 'bottom middle', br: 'bottom right' } as Record<string, string>)[k]} ${t}`).join(', ') || 'none'}`);
    },
  };
}

/** Today in a date field's form, as the list shows it. */
function exampleOf(f: DateFormat): string {
  return dateText({ dateFormat: f });
}
