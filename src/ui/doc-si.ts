// Document mode's link to an SI project (References ▸ Compounds and SI): link a manuscript to its
// SI, put in the SI's compound IDs and its labels and pages ("Table S1", "S6") as SI fields that
// follow the SI, turn compound numbers typed in bold into SI fields, bring them up to date, and
// check the manuscript against the SI. The SI itself (compiling it, its pages) comes from the app
// (SiAccess); the document side is si/manuscript.ts.

import type { DocFile } from '../document/doc-file';
import type { DocObject, DocText, SiLink } from '../document/document';
import type { TextLayout } from '../text/layout';
import type { TextEditing } from '../text/editing';
import type { RunStyle } from '../richtext';
import { COMPOUND } from '../document/document';
import { checkAgainstSi, mentionCounts, compoundNumbers, isCompoundNumber, linkNumber, linkTypedIds, manuscriptIds, nextLetter, numberKey, renumberClashes, renumberPlan, siField, updateSiFields, useSiValue, type SiFinding, type SiView } from '../si/manuscript';
import { ask, askChoice } from './ask';

/** What the app gives documents of SI projects. */
export interface SiAccess {
  /** The SI projects open in tabs. */
  open(): SiLink[];
  /** Pick another SI project's folder (the desktop app); null when cancelled or not possible here. */
  pick(): Promise<SiLink | null>;
  /** The SI as compiled now (its compounds, labels, pages and data); null when it can't be read (with why, flashed). */
  view(link: SiLink): Promise<SiView | null>;
  /** Show a compound's page in its SI project's tab (opening the project when it isn't open). */
  openCompound(link: SiLink, key: string): void;
  /** Show the SI project's tab. */
  openProject(link: SiLink): void;
  /** Give SI compounds these IDs (as Manual IDs), all of them or none; how many were changed, or null when the SI can't be changed (read-only, or with why, shown). */
  renumber(link: SiLink, ids: { key: string; to: string }[]): Promise<number | null>;
  /** Read the SI project again from its folder when it isn't open in a tab (it may have been changed in Chem SI Assistant). */
  reread?(link: SiLink): Promise<void>;
}

export interface DocSiHost {
  file(): DocFile | null;
  /** Where typing goes now (the table cell typed into, or the body). */
  ed(): TextEditing;
  insertObject(o: DocObject, kind?: string, look?: Partial<RunStyle>): number;
  flash(msg: string, ms?: number): void;
  focus(): void;
  si(): SiAccess | null;
  /** Show the side panel, where the Linked SI panel is. */
  reveal?(): void;
}

const short = (s: string, n = 48): string => (s.length > n ? s.slice(0, n - 2).trimEnd() + '…' : s);

export class DocSiUI {
  /** The last check's findings (for Use SI Value). */
  findings: SiFinding[] = [];

  constructor(private host: DocSiHost) {}

  private get f(): DocFile | null { return this.host.file(); }

  /** The linked SI, as compiled now; with a message when there is none (unless `quiet`). `fresh`: read again from its folder first, when it isn't open in a tab. */
  private async view(fresh = false, quiet = false): Promise<{ link: SiLink; view: SiView } | null> {
    const f = this.f, si = this.host.si();
    const link = f?.t.siLink;
    if (!f || !si) { if (!quiet) this.host.flash('SI projects open in the desktop app.'); return null; }
    if (!link) { if (!quiet) this.host.flash('Link this document to its SI project first: References ▸ Linked SI.', 6000); return null; }
    if (fresh) await si.reread?.(link).catch(() => {});
    const view = await si.view(link);
    return view ? { link, view } : null;
  }

  /** References ▸ Linked SI: link to an open SI project or another one, open it, bring fields up to date, or unlink. */
  async linkMenu(): Promise<void> {
    const f = this.f, si = this.host.si();
    if (!f || !si) { this.host.flash('SI projects open in the desktop app.'); return; }
    const cur = f.t.siLink;
    const open = si.open();
    const options = [
      ...(cur ? [{ value: 'keep', label: `${short(cur.title || cur.path)} (linked now)` }] : []),
      ...open.filter((l) => l.path !== cur?.path).map((l) => ({ value: 'open:' + l.path, label: short(l.title || l.path) })),
      { value: 'other', label: 'Other SI Project…' },
      ...(cur ? [{ value: 'unlink', label: 'Unlink (SI fields keep their text)' }] : []),
    ];
    const got = await ask('Linked SI', [
      { name: 'which', label: 'SI project', value: options[0].value, options },
      { name: 'typed', label: 'Make bold compound numbers Compound Numbers', value: 'true', type: 'checkbox', help: 'Compound numbers typed in bold (2a, 3) become Compound Number fields, numbered by first mention, and those that are the SI’s compounds are linked to them. A number typed out of order changes; you are told which. Numbers after Table, Figure or entry are left alone.' },
    ], { ok: cur ? 'OK' : 'Link', note: 'The manuscript’s compound numbers lead: Renumber SI gives the SI’s compounds the manuscript’s IDs. Labels (Table S1) and pages (S6) come from the SI and follow it. Ctrl+click a compound number to open it in the SI.' });
    this.host.focus();
    if (!got || this.f !== f) return;
    let link: SiLink | null = cur ?? null;
    if (got.which === 'unlink') {
      f.ed.update({ ...f.t, siLink: undefined } as DocText, 'Unlink SI');
      this.host.flash('Unlinked from the SI. SI fields keep the text they show.');
      return;
    }
    if (got.which === 'other') link = await si.pick();
    else if (got.which.startsWith('open:')) link = open.find((l) => 'open:' + l.path === got.which) ?? null;
    if (!link) return;
    if (link.path !== cur?.path || link.title !== cur?.title) f.ed.update({ ...f.t, siLink: link } as DocText, 'Link SI');
    if (!cur) this.host.reveal?.();
    await this.update(got.typed === 'true', true);
  }

  /**
   * Bring the SI fields up to date from the SI (and, with `typed`, make bold compound numbers
   * Compound Number fields, after showing which). `quiet`: the document was only shown again, so
   * nothing is said unless something points at what the SI no longer has.
   */
  async update(typed = false, say = false, quiet = false): Promise<void> {
    const f = this.f;
    const got = await this.view(say, quiet);
    if (!got || this.f !== f || !f) return;
    let t = f.t, made = 0, changed: { from: string; to: string }[] = [];
    if (typed) {
      const r = linkTypedIds(t, got.view);
      if (r.made) {
        // what will become compound numbers, shown first: a bold number that isn't a compound can be left out by cancelling
        const shown = [...new Set(r.typed)];
        const pick = await askChoice('Make Compound Numbers',
          `${r.made} bold number${r.made === 1 ? '' : 's'} will become Compound Number fields:\n\n${short(shown.join(', '), 600)}${r.changed.length ? `\n\nNumbered by first mention, these change: ${r.changed.map((x) => `${x.from} → ${x.to}`).join(', ')}` : ''}`,
          [{ value: 'yes', label: 'Make Compound Numbers', primary: true }, { value: 'no', label: 'Leave as Typed' }], 'no',
          'Numbers after Table, Figure or entry, amounts (1.5 equiv, 3 h), headings and the reference list are left alone. If a number listed here is not a compound, choose Leave as Typed, take its bold off and try again. Undo puts everything back.');
        this.host.focus();
        if (this.f !== f) return;
        // (the document may have been typed into meanwhile: worked out again from it as it is now)
        if (pick === 'yes') ({ t, made, changed } = linkTypedIds(f.t, got.view)); else t = f.t;
      }
    }
    const up = updateSiFields(t, got.view);
    if (up.t !== f.t) f.ed.update(up.t, made ? 'Make compound numbers' : 'Update from SI');
    if (!say && !up.missing.length) return;
    const parts = [made ? `${made} compound number${made === 1 ? '' : 's'} made` : '', changed.length ? `renumbered by first mention: ${changed.map((x) => `${x.from}→${x.to}`).join(', ')}` : '', up.changed ? `${up.changed} SI label${up.changed === 1 ? '' : 's'} updated` : '', up.missing.length ? `${up.missing.length} point${up.missing.length === 1 ? 's' : ''} at something no longer in the SI` : ''].filter(Boolean);
    this.host.flash(`Linked to “${short(got.link.title, 40)}”${parts.length ? ': ' + parts.join('; ') : ': up to date'}.`, 8000);
  }

  /**
   * References ▸ SI Compound: a compound number for one of the SI's compounds. One the manuscript
   * has numbered already is mentioned again; else it gets a new number (by first mention) or the
   * next letter of a number (2d after 2a–2c), and the number learns which SI compound it is.
   */
  async insertCompound(): Promise<void> {
    const f = this.f;
    const got = await this.view();
    if (!got || !f || this.f !== f) return;
    const compounds = got.view.targets.filter((x) => x.kind === 'compound');
    if (!compounds.length) { this.host.flash('The SI has no compounds yet.'); return; }
    const have = manuscriptIds(f.t, got.view);
    const pick = await ask('SI Compound', [{
      name: 'key', label: 'Compound', value: compounds[0].key,
      options: compounds.map((c) => ({ value: c.key, label: `${have.has(c.key) ? `${[...have.get(c.key)!].join(', ')} here` : `${c.label} in the SI`}  ${short(c.caption, 56)}` })),
    }], { ok: 'Next', note: 'The manuscript’s compound numbers lead. A compound numbered here already is mentioned again; a new one gets a number or the next letter of one. Renumber SI then gives the SI the manuscript’s IDs.' });
    this.host.focus();
    const target = compounds.find((c) => c.key === pick?.key);
    if (!target || this.f !== f) return;
    const nums = compoundNumbers(f.t);
    // numbered already: that number and its letter again
    for (const n of nums) {
      const letter = Object.entries(n.si).find(([, k]) => k === target.key)?.[0];
      if (letter === undefined) continue;
      this.mention(n.seq, letter, target.key, false);
      return;
    }
    const at = this.newNumberAt();
    const choice = await ask(`Number ${target.label}`, [{
      name: 'as', label: 'Number it', value: 'new',
      options: [{ value: 'new', label: `A new compound number (${at})` }, ...nums.map((n) => ({ value: String(n.seq), label: `A letter of ${n.number} (${n.number}${nextLetter(f.t, n.seq, got.view)})` }))],
    }], { ok: 'Insert', note: 'Numbers follow the order compounds are first mentioned in. A series (2a, 2b, 2c) is one number with letters.' });
    this.host.focus();
    if (!choice || this.f !== f) return;
    if (choice.as === 'new') {
      const ed = this.host.ed();
      const style = ed.typingStyle();
      this.host.insertObject({ kind: 'seq', name: COMPOUND, si: { '': target.key } }, 'Insert compound number', { bold: true });
      ed.setStyle({ bold: style.bold });
      return;
    }
    const seq = Number(choice.as);
    this.mention(seq, nextLetter(f.t, seq, got.view), target.key, true);
  }

  /** The number a new compound number at the caret would get. */
  private newNumberAt(): number {
    const f = this.f!;
    const shown = compoundNumbers(f.t);
    const at = f.ed.start;
    let before = 0;
    let pos = 0;
    for (const r of f.t.runs) {
      if (pos >= at) break;
      if (r.obj !== undefined && shown.some((n) => n.seq === r.obj)) before++;
      pos += r.text.length;
    }
    return before + 1;
  }

  /** A mention of compound number `seq` with `letters` after it (linking that letter to `key` when `link`). */
  private mention(seq: number, letters: string, key: string, link: boolean): void {
    const f = this.f!;
    if (link) f.ed.update(linkNumber(f.t, seq, letters, key), 'Link compound number');
    const ed = this.host.ed();
    const style = ed.typingStyle();
    this.host.insertObject({ kind: 'ref', target: seq }, 'Insert compound number', { bold: true });
    if (letters) { ed.setStyle({ bold: true }); ed.type(letters); }
    ed.setStyle({ bold: style.bold });
  }

  /** References ▸ Renumber SI: the SI's compounds given the manuscript's IDs (as Manual IDs). */
  async renumberSi(): Promise<void> {
    const f = this.f, si = this.host.si();
    const got = await this.view(true);
    if (!got || !f || !si || this.f !== f) return;
    const plan = renumberPlan(f.t, got.view);
    const clash = [...manuscriptIds(f.t, got.view)].filter(([, ids]) => ids.size > 1);
    if (!plan.length) { this.host.flash(clash.length ? `Nothing to change, but ${clash.length} SI compound${clash.length === 1 ? ' has' : 's have'} two IDs here: see Check Against SI.` : 'The SI’s IDs already match the manuscript.', 6000); return; }
    // IDs two SI compounds would share afterwards (a compound the manuscript doesn't mention keeps its ID): said first, never stopped
    const twice = renumberClashes(plan, got.view);
    const warn = twice.length
      ? `\n\n⚠ ${twice.length === 1 ? 'One ID' : `${twice.length} IDs`} would then be used twice in the SI:\n${twice.slice(0, 12).map((x) => `${x.id}: ${x.compounds.map((c) => (c.renumbered ? `${c.was || 'ID?'} (renumbered)` : `${c.was}${c.caption ? ' ' + short(c.caption, 30) : ''} (not renumbered)`)).join(' and ')}`).join('\n')}${twice.length > 12 ? '\n…' : ''}\nMention the other compounds in the manuscript, or give them other IDs in the SI afterwards.`
      : '';
    const sure = await askChoice('Renumber SI', `Give ${plan.length} SI compound${plan.length === 1 ? '' : 's'} the manuscript’s ID${plan.length === 1 ? '' : 's'}?\n\n${plan.map((x) => `${x.from || 'ID?'} → ${x.to}`).join('\n')}${warn}`,
      [{ value: 'yes', label: twice.length ? 'Renumber SI Anyway' : 'Renumber SI', primary: true }, { value: 'no', label: 'Cancel' }], 'no',
      'Each becomes the compound’s Manual ID in the SI project. The ID table is left as it is; clear a Manual ID on the compound’s page to go back to it.');
    this.host.focus();
    if (sure !== 'yes') return;
    const n = await si.renumber(got.link, plan);
    if (n !== null) { this.host.flash(`${n} SI compound${n === 1 ? '' : 's'} renumbered.`, 5000); await this.update(); }
  }

  /** References ▸ SI Reference: a table's, figure's or scheme's label in the SI, or the SI page it or a compound is on. */
  async insertReference(): Promise<void> {
    const got = await this.view();
    if (!got) return;
    const targets = got.view.targets;
    const labelled = targets.filter((x) => x.kind !== 'compound');
    const options = [
      ...labelled.map((x) => ({ value: x.key, label: `${x.label}${x.caption ? '. ' + short(x.caption, 50) : ''}` })),
      ...targets.filter((x) => x.kind === 'compound').map((x) => ({ value: x.key, label: `Compound ${x.label}  ${short(x.caption, 50)}` })),
    ];
    if (!options.length) { this.host.flash('The SI has nothing to refer to yet.'); return; }
    const pick = await ask('SI Reference', [
      { name: 'key', label: 'Refer to', value: options[0].value, options },
      { name: 'what', label: 'Insert', value: 'label', options: [{ value: 'label', label: 'Its label (Table S1)' }, { value: 'page', label: 'Its SI page (S6)' }, { value: 'both', label: 'Label and page (Table S1, page S6)' }] },
    ], { ok: 'Insert', note: 'Labels and pages come from the SI as compiled now, and follow it when it changes. A compound’s label is its ID.' });
    this.host.focus();
    const target = targets.find((x) => x.key === pick?.key);
    if (!target || !pick) return;
    if (pick.what === 'page' && !got.view.pages.has(target.key)) { this.host.flash(`${target.label} isn’t printed in the SI yet, so it has no page.`); return; }
    if (pick.what === 'page') { this.host.insertObject(siField('page', target, got.view), 'Insert SI reference'); return; }
    this.host.insertObject(siField(target.kind === 'compound' ? 'id' : 'label', target, got.view), 'Insert SI reference', target.kind === 'compound' ? { bold: true } : {});
    if (pick.what === 'both' && got.view.pages.has(target.key)) {
      this.host.ed().type(', page ');
      this.host.insertObject(siField('page', target, got.view), 'Insert SI reference');
    }
  }

  /** References ▸ Check Against SI: the findings, with the SI's value offered for a table's. */
  async check(): Promise<SiFinding[] | null> {
    const f = this.f;
    const got = await this.view(true);
    if (!got || !f || this.f !== f) return null;
    this.findings = checkAgainstSi(f.t, got.view);
    return this.findings;
  }

  /** A finding's value replaced by the SI's (a yield in a table). */
  useSiValue(x: SiFinding): boolean {
    const f = this.f;
    if (!f) return false;
    const t = useSiValue(f.t, x);
    if (!t) return false;
    f.ed.update(t, 'Use SI value');
    return true;
  }

  /** The check shown in a window (until the panel it belongs in is built): problems, then notes. */
  async showCheck(): Promise<void> {
    const found = await this.check();
    if (!found) return;
    const problems = found.filter((x) => x.level === 'problem');
    const notes = found.filter((x) => x.level === 'note');
    const fixable = problems.filter((x) => x.at);
    const line = (x: SiFinding): string => `${x.where ? x.where + ': ' : ''}${x.message}`;
    if (!found.length) { this.host.flash('The manuscript agrees with the SI.', 5000); return; }
    const pick = await askChoice('Check Against SI',
      `${problems.length} problem${problems.length === 1 ? '' : 's'}, ${notes.length} note${notes.length === 1 ? '' : 's'}.\n\n${[...problems, ...notes].map((x) => (x.level === 'problem' ? '⚠ ' : '• ') + line(x)).join('\n')}`,
      fixable.length ? [{ value: 'fix', label: `Use SI Values (${fixable.length})`, primary: true }, { value: 'close', label: 'Close' }] : [{ value: 'close', label: 'Close', primary: true }], 'close',
      'Compounds the manuscript gives values for must be in the SI, with the same yield, ee and dr. Values in sentences are notes only.');
    this.host.focus();
    if (pick === 'fix') { let n = 0; for (const x of fixable) if (this.useSiValue(x)) n++; this.host.flash(`${n} value${n === 1 ? '' : 's'} replaced by the SI’s.`); }
  }

  /** The SI field, or compound number linked to an SI compound, under a point (its object id), from the laid-out text. */
  static fieldAt(lay: TextLayout, t: DocText, x: number, y: number): number | null {
    if (!t.siLink) return null;
    for (const l of lay.lines) {
      if (y < l.y - l.ascent || y > l.y + l.descent) continue;
      for (const g of l.pieces) {
        if (g.obj === undefined || x < g.x || x > g.x + g.w) continue;
        if (t.objects[g.obj]?.kind === 'si') return g.obj;
        return isCompoundNumber(t, g.obj) && numberKey(t, g.obj) ? g.obj : null;
      }
    }
    return null;
  }

  /** Ctrl+click on an SI field or a linked compound number: its compound's page (or the project) in the SI. */
  follow(id: number): void {
    const f = this.f, si = this.host.si();
    const o = f?.t.objects[id];
    const link = f?.t.siLink;
    if (!f || !o) return;
    if (!si || !link) { this.host.flash('This document isn’t linked to its SI project (References ▸ Linked SI).'); return; }
    const num = o.kind !== 'si' ? numberKey(f.t, id) : null;
    if (num) si.openCompound(link, num.key);
    else if (o.kind === 'si' && o.what === 'id') si.openCompound(link, o.key);
    else si.openProject(link);
  }

  /** The tooltip of an SI field or a linked compound number. */
  tip(id: number): string {
    const f = this.f;
    const o = f?.t.objects[id];
    if (!f || !o) return '';
    const num = o.kind !== 'si' ? numberKey(f.t, id) : null;
    if (num) return `Compound ${num.id}, linked to the SI. Ctrl+click to open it in the SI.`;
    if (o.kind !== 'si') return '';
    const what = o.what === 'id' ? `Compound ${o.text} in the SI` : o.what === 'page' ? `Page ${o.text} of the SI` : `${o.text} in the SI`;
    return `${what}. Ctrl+click to open it in the SI.`;
  }
}

// ---------------------------------------------------------------- the Linked SI panel (layout A)

/** One row of the panel: an SI compound the manuscript mentions, or a compound the SI doesn't have. */
/** A yield as printed, with its % sign. */
const pc = (v: string, what: string): string => (what === 'yield' && /^\d+(\.\d+)?$/.test(v.trim()) ? v.trim() + '%' : v);

/** A finding in a few words, for a row of the panel. */
function shortFinding(x: SiFinding): string {
  if (x.what === 'yield' || x.what === 'ee' || x.what === 'dr') return `${x.what === 'yield' ? '' : x.what + ' '}${x.manuscript} here, ${pc(x.si, x.what)} in SI`;
  if (x.what === 'id') return `${x.si} in the SI`;
  return x.message;
}

interface PanelRow { key: string; id: string; name: string; state: 'ok' | 'note' | 'warn' | 'missing'; text: string; findings: SiFinding[] }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const button = (label: string, title: string, run: () => void, primary = false): HTMLButtonElement => {
  const b = el('button', primary ? 'msi-btn primary' : 'msi-btn', label);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', run);
  return b;
};

/**
 * The side panel's Linked SI section: the SI project, how the manuscript agrees with it, each
 * compound the manuscript mentions (agrees, differs, not in the SI), and for the one picked, what
 * differs with the fixes (Use SI Value, Renumber SI, Open in SI).
 */
export class DocSiPanel {
  private picked = '';
  private seq = 0;
  private timer = 0;
  private pictures = new Map<string, string>();

  constructor(private sec: HTMLElement, private body: HTMLElement, private ui: DocSiUI, private host: DocSiHost & { picture(link: SiLink, key: string): Promise<string | null> }) {}

  /** Show the panel for the document now shown (hidden when it isn't linked). Soon after `soon` ms, to let typing finish. */
  refresh(soon = 0): void {
    clearTimeout(this.timer);
    if (soon) { this.timer = window.setTimeout(() => void this.draw(), soon); return; }
    void this.draw();
  }

  private async draw(): Promise<void> {
    const f = this.host.file(), si = this.host.si();
    const link = f?.t.siLink;
    if (!f || !si || !link) { this.sec.hidden = true; return; }
    this.sec.hidden = false;
    const seq = ++this.seq;
    const view = await si.view(link);
    if (seq !== this.seq || this.host.file() !== f) return;
    if (!view) { this.body.replaceChildren(el('p', 'muted', `The SI project “${short(link.title || link.path)}” can’t be read here. Open it (File ▸ Open SI Project…) and it links again.`)); return; }
    const t = f.t;
    const findings = checkAgainstSi(t, view);
    this.ui.findings = findings;
    const counts = mentionCountsOf(t, view);
    const ids = manuscriptIds(t, view);
    const rows: PanelRow[] = [];
    for (const c of view.targets.filter((x) => x.kind === 'compound')) {
      if (!ids.has(c.key)) continue;
      const all = findings.filter((x) => x.key === c.key);
      const mine = all.filter((x) => x.level === 'problem');
      const first = mine[0] ?? all[0];
      const id = [...ids.get(c.key)!].join(', ');
      rows.push({ key: c.key, id, name: c.caption, state: mine.length ? 'warn' : all.length ? 'note' : 'ok', text: first ? shortFinding(first) : `mentioned ${counts.get(c.key) ?? 0}×`, findings: all });
    }
    for (const x of findings.filter((y) => !y.key && y.what === 'compound')) rows.push({ key: '', id: x.id, name: '', state: x.level === 'problem' ? 'missing' : 'note', text: x.level === 'problem' ? 'Has values; not in the SI' : 'Not in the SI', findings: [x] });
    rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const unmentioned = view.targets.filter((x) => x.kind === 'compound' && !ids.has(x.key)).map((x) => x.label);
    const plan = renumberPlan(t, view);

    // the project
    const head = el('div', 'msi-proj');
    const who = el('div', 'msi-proj-name');
    who.append(el('b', '', short(view.title, 60)), el('div', 'muted', `SI project · ${view.targets.filter((x) => x.kind === 'compound').length} compounds${view.pages.size ? ` · ${new Set(view.pages.values()).size} pages` : ''}`));
    head.append(who, button('Open', 'Show the SI project', () => si.openProject(link)));
    // the summary
    const ok = rows.filter((r) => r.state === 'ok').length, warn = rows.filter((r) => r.state === 'warn').length, miss = rows.filter((r) => r.state === 'missing').length, notes = rows.filter((r) => r.state === 'note').length;
    const sum = el('div', 'msi-sum');
    sum.append(el('span', 'msi-chip ok', `✓ ${ok} agree`));
    if (warn) sum.append(el('span', 'msi-chip warn', `⚠ ${warn} differ${warn === 1 ? 's' : ''}`));
    if (miss) sum.append(el('span', 'msi-chip bad', `⚠ ${miss} not in SI`));
    if (notes) sum.append(el('span', 'msi-chip note', `${notes} note${notes === 1 ? '' : 's'}`));
    // the compounds
    const list = el('div', 'msi-list');
    const pickOf = (r: PanelRow): string => r.key || r.id;
    if (!this.picked || !rows.some((r) => pickOf(r) === this.picked)) {
      const first = rows.find((r) => r.state === 'warn' || r.state === 'missing') ?? rows.find((r) => r.state === 'note');
      this.picked = first ? pickOf(first) : '';
    }
    for (const r of rows) {
      const row = el('div', `msi-row ${r.state}${r.key ? '' : ' nokey'}${pickOf(r) === this.picked ? ' sel' : ''}`);
      row.title = `${r.id}${r.name ? ' · ' + r.name : ''}${r.key ? '\nDouble-click to open it in the SI' : ''}`;
      const pic = el('span', 'msi-pic');
      if (r.key) void this.picture(link, r.key, pic); else pic.textContent = '?';
      const st = el('span', `msi-st ${r.state}`, r.state === 'ok' ? '✓' : r.state === 'note' ? '•' : '⚠');
      row.append(pic, el('b', 'msi-id', r.id), el('span', 'msi-text', r.text), st);
      row.addEventListener('click', () => { this.picked = pickOf(r); this.refresh(); });
      row.addEventListener('dblclick', () => { if (r.key) si.openCompound(link, r.key); });
      list.append(row);
    }
    if (!rows.length) list.append(el('p', 'muted msi-empty', 'No compound numbers yet. References ▸ SI Compound puts in a compound of the SI; Linked SI turns bold numbers typed into compound numbers.'));
    // what differs for the compound picked, with its fixes
    const fix = el('div', 'msi-fix');
    const cur = rows.find((r) => (r.key || r.id) === this.picked);
    if (cur && cur.state !== 'ok') {
      for (const x of cur.findings) {
        const box = el('div', 'msi-finding');
        box.append(el('div', 'muted', `${cur.id}${x.where ? ' · ' + x.where : ''}`), el('div', '', x.message));
        const btns = el('div', 'msi-btns');
        if (x.at) btns.append(button(`Use ${x.si}${x.what === 'yield' ? '%' : ''} Here`, 'Put the SI’s value in the manuscript', () => { if (this.ui.useSiValue(x)) this.refresh(); }));
        if (x.what === 'id') btns.append(button('Renumber SI', 'Give the SI’s compounds the manuscript’s IDs', () => void this.ui.renumberSi().then(() => this.refresh())));
        if (x.key) btns.append(button('Open in SI', 'Show the compound’s page in the SI', () => si.openCompound(link, x.key)));
        if (btns.childElementCount) box.append(btns);
        fix.append(box);
      }
    }
    // the rest
    const foot = el('div', 'msi-foot');
    foot.append(el('div', 'muted', unmentioned.length ? `SI compounds not mentioned: ${unmentioned.join(', ')}` : 'Every SI compound is mentioned.'));
    const fb = el('div', 'msi-btns');
    fb.append(button('SI Compound…', 'Put in a compound number for one of the SI’s compounds', () => void this.ui.insertCompound()));
    if (plan.length) fb.append(button(`Renumber SI (${plan.length})`, 'Give the SI’s compounds the manuscript’s IDs (as Manual IDs)', () => void this.ui.renumberSi().then(() => this.refresh()), true));
    foot.append(fb);
    this.body.replaceChildren(head, sum, list, ...(fix.childElementCount ? [fix] : []), foot);
  }

  private async picture(link: SiLink, key: string, into: HTMLElement): Promise<void> {
    const k = link.path + '|' + key;
    let svg = this.pictures.get(k);
    if (svg === undefined) {
      svg = (await this.host.picture(link, key).catch(() => null)) ?? '';
      this.pictures.set(k, svg);
    }
    if (svg) into.innerHTML = svg;
  }

  /** The SI changed: structures may have too. */
  forget(): void { this.pictures.clear(); }
}

const mentionCountsOf = (t: DocText, view: SiView): Map<string, number> => mentionCounts(t, view);
