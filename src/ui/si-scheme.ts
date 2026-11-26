// A scheme page of an SI project (SI Assistant's scheme editor, SPEC §13n.4), edited in Chemweave:
// the scheme as it prints (drawn by Chemweave's scheme layout, as the compiled SI draws it), and
// under it the scheme to edit, laid out as it prints: the starting materials, then each step's
// arrow with its conditions above and below it (formatted text, with structures in them) and its
// products. A box's structure is drawn with the drawing tools (double-click it); its ID and yield
// are typed under it. The ribbon's Scheme tab adds, moves and removes boxes and steps, marks a box
// as a compound (a page with an ID and data), puts a structure in the conditions and opens the
// scheme's Layout.

import type { Contents, TextRun } from '../model';
import type { Pasted } from '../io/clipboard';
import type { Json, SiCompound, SiProject, SiScheme } from '../si/project';
import { fieldKeys, valuesOf, compoundName } from '../si/project';
import { parseMarkup, MENTION, STRUCT } from '../si/markup';
import { partText } from '../si/fields';
import { newId } from '../si/ids';
import { siDrawingStyle } from '../si/drawing-style';
import { drawScheme, SCHEME_DEFAULTS, type DrawBox, type DrawStep, type SchemeLayout } from '../si/scheme-draw';
import * as E from '../si/scheme-edit';
import { journalOf } from '../si/journal';
import { SiRichBox } from './si-rich';
import { addInfo } from './info-tip';
import { ask, askChoice, type Field } from './ask';

export interface SiSchemeHost {
  project: SiProject;
  scheme: SiScheme;
  flash(msg: string, ms?: number): void;
  label(ref: string): string;
  mentionable(): { id: string; label: string; text: string }[];
  contentsOf(mol: string): Contents | null;
  molfileOf(c: Contents): { molblock: string | null; problem?: string };
  pictureOf(mol: string): string | null;
  /** A drawing as SVG markup (its size in points). */
  drawingSvg(c: Contents): string | null;
  editStructure(contents: Contents | null, title: string, done: (c: Contents | null) => void): void;
  readClipboard(): Promise<Pasted>;
  idOf(c: SiCompound): string;
  /** A box or step was picked: the Scheme tab shows what it can do. */
  chosen(page: SiSchemePage): void;
  /** Run `f` as one named step of Undo ("Undo Move Box"), after the saves on their way have landed. */
  step?<T>(label: string, f: () => Promise<T>): Promise<T>;
  /** The tree and the page are drawn again (the scheme's compounds changed). */
  redraw(): void;
  openCompound(id: string): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** The text width the scheme is laid out in (points), as the compiled SI's. */
const TEXT_W = 6.5 * 72;
const PX = 96 / 72;

/** A drawing's SVG markup, sized `scale` times its own size in points, as screen pixels. */
function sized(svg: string, scale: number): string {
  return svg.replace(/<svg\b([^>]*)>/, (whole, attrs: string) => {
    const w = /\swidth="([\d.]+)(pt|px)?"/.exec(attrs), h = /\sheight="([\d.]+)(pt|px)?"/.exec(attrs);
    if (!w || !h) return whole;
    const f = (w[2] === 'px' ? 1 : PX) * scale;
    return whole.replace(w[0], ` width="${(+w[1] * f).toFixed(1)}px"`).replace(h[0], ` height="${(+h[1] * f).toFixed(1)}px"`);
  });
}

export type SchemePick = { kind: 'box'; id: string; where: string } | { kind: 'step'; id: string; which: 'top' | 'bottom' } | null;

export class SiSchemePage {
  readonly el = el('div', 'si-scheme-page');
  readonly boxes: SiRichBox[] = [];
  picked: SchemePick = null;
  private preview = el('div', 'si-scheme-preview');
  private strip = el('div', 'si-scheme-strip');
  private conds = new Map<string, SiRichBox>();
  /** Structures in the conditions as pictures, by id (filled before the strip is drawn). */
  private inlinePics = new Map<string, string>();

  constructor(private host: SiSchemeHost) {
    // a scheme made as one pasted picture opens as an editor scheme with its compounds as the first step's products (written with the next change)
    const k = host.scheme;
    if (k.data.mode !== 'editor') {
      const d = E.editorData(k);
      if (!d.starting.length && !d.steps.length) {
        d.starting.push({ id: newId('b') });
        d.steps.push({ id: newId('st'), top: '', bottom: '', products: k.children.map((c) => ({ id: newId('b'), compound: c.id })) });
      }
      k.data.mode = 'editor';
    }
    this.build();
  }

  private get p(): SiProject { return this.host.project; }
  private get k(): SiScheme { return this.host.scheme; }
  get layout(): SchemeLayout { return E.layoutOf(this.p, this.k); }

  private build(): void {
    const head = el('div', 'si-card');
    const h = el('h3', 'si-sub', 'Scheme');
    addInfo(h, 'The scheme as it prints, drawn as the compiled SI draws it (Scheme ▸ Layout sets its text size, arrows, structures in the conditions and how it fits the page). Edit it below: double-click a box to draw its structure; type the conditions above and under each arrow. The Scheme tab on the ribbon adds and removes boxes and steps and marks a box as a compound.');
    const name = el('input', 'si-scheme-name');
    name.value = str(this.k.data.name);
    name.setAttribute('aria-label', 'Scheme name');
    name.title = 'The scheme’s name (in the tree; printed as “Scheme S1. Name” when its Layout shows a label)';
    name.addEventListener('change', () => void this.act('Rename Scheme', async () => { this.k.data.name = name.value.trim() || 'Scheme'; await this.p.saveScheme(this.k); }, true));
    const top = el('div', 'si-scheme-head');
    top.append(h, name);
    head.append(top, this.preview);
    const edit = el('div', 'si-card');
    const h2 = el('h3', 'si-sub', 'Edit');
    addInfo(h2, 'Double-click a box to draw its structure. Click a box, then use the Scheme tab: Paste Structure, Add Starting Material or Product, Move Left or Right, Remove, Mark as Compound. Click in the conditions to type them (Home ▸ Font formats them; Insert Structure puts a structure in them, printed at the Layout’s size).');
    edit.append(h2, this.strip);
    this.el.append(head, edit);
    void this.paint();
  }

  /** Draw the strip and the preview again. */
  async paint(): Promise<void> {
    for (const b of this.boxes) b.commit();
    this.boxes.length = 0;
    this.conds.clear();
    const d = E.editorData(this.k);
    // pictures of the structures in the conditions
    this.inlinePics.clear();
    for (const sid of Object.keys(d.inline)) {
      const mol = await E.inlineMol(this.p, this.k, sid);
      const svg = mol ? this.host.pictureOf(mol) : null;
      if (svg) this.inlinePics.set(sid, sized(svg, this.layout.cond_structure_pct / 100 * 0.75));
    }
    const parts: HTMLElement[] = [];
    const side = async (boxes: Json[], where: string): Promise<void> => {
      for (let i = 0; i < boxes.length; i++) {
        if (i) parts.push(el('div', 'si-scheme-plus', '+'));
        parts.push(await this.boxEl(boxes[i], where));
      }
    };
    await side(d.starting, E.START);
    if (!d.starting.length) parts.push(this.emptySlot(E.START));
    for (const st of d.steps) {
      parts.push(this.stepEl(st));
      await side(st.products, st.id);
      if (!st.products.length) parts.push(this.emptySlot(st.id));
    }
    this.strip.replaceChildren(...parts);
    this.mark();
    await this.drawPreview();
    this.host.chosen(this);
  }

  private emptySlot(where: string): HTMLElement {
    const b = el('button', 'si-scheme-empty', where === E.START ? '+ Starting material' : '+ Product');
    b.type = 'button';
    b.addEventListener('click', () => void this.act('Add Structure', () => E.addBox(this.p, this.k, where).then(() => {})));
    return b;
  }

  private async boxEl(box: Json, where: string): Promise<HTMLElement> {
    const id = str(box.id);
    const c = E.boxCompound(this.k, box);
    const wrap = el('div', 'si-scheme-box');
    wrap.tabIndex = 0;
    wrap.dataset.box = id;
    const pic = el('div', 'si-scheme-pic');
    const mol = await E.boxMol(this.p, this.k, box);
    const svg = mol ? this.host.pictureOf(mol) : null;
    if (svg) pic.innerHTML = sized(svg, 0.9);
    else pic.append(el('span', 'muted', str(box.picture) ? 'Pasted picture (draw it to replace)' : 'Double-click to draw'));
    pic.title = 'Double-click to draw the structure';
    pic.addEventListener('dblclick', () => void this.command('draw'));
    const idRow = el('div', 'si-scheme-id');
    if (c) {
      const link = el('button', 'si-scheme-cpd', this.host.idOf(c));
      link.type = 'button';
      link.title = `${compoundName(c) || 'Compound'}: its ID and data page (click to open it)`;
      link.addEventListener('click', () => this.host.openCompound(c.id));
      idRow.append(link);
    } else {
      const lab = el('input', 'si-scheme-label');
      lab.value = str(box.label).startsWith('@{') ? this.host.label(MENTION + str(box.label).slice(2, -1)) : str(box.label);
      lab.readOnly = str(box.label).startsWith('@{');
      lab.placeholder = 'ID';
      lab.setAttribute('aria-label', 'ID label');
      lab.title = 'The ID printed under the structure (bold). Mark as Compound gives it an ID from the ID table and a data page instead.';
      lab.addEventListener('change', () => void this.act('Edit Label', () => E.setBoxValues(this.p, this.k, id, { label: lab.value })));
      idRow.append(lab);
    }
    const yl = el('input', 'si-scheme-yield');
    const auto = c && fieldKeys(c).includes('yield') ? partText((valuesOf(c).yield as Json | undefined)?.percent) : '';
    yl.value = 'yield' in box ? str(box.yield) : '';
    yl.placeholder = auto ? `auto: ${auto}%` : 'yield';
    yl.setAttribute('aria-label', 'Yield');
    yl.title = c ? 'The yield printed under it: empty uses the compound’s Yield field; type to print something else' : 'The yield printed under it (empty: none)';
    yl.addEventListener('change', () => void this.act('Edit Yield', () => E.setBoxValues(this.p, this.k, id, { yield: yl.value.trim() ? yl.value : c ? null : '' })));
    idRow.append(yl);
    wrap.append(pic, idRow);
    const pick = (): void => { this.picked = { kind: 'box', id, where }; this.mark(); this.host.chosen(this); };
    wrap.addEventListener('mousedown', pick);
    wrap.addEventListener('focusin', pick);
    return wrap;
  }

  private stepEl(st: E.Step): HTMLElement {
    const wrap = el('div', 'si-scheme-step');
    wrap.dataset.step = st.id;
    const box = (which: 'top' | 'bottom'): HTMLElement => {
      const rb = new SiRichBox(st[which], {
        label: (ref) => (ref.startsWith(STRUCT) ? '[structure]' : this.host.label(ref)),
        mentionable: () => this.host.mentionable(),
        picture: (ref) => this.inlinePics.get(ref.slice(STRUCT.length)) ?? null,
        changed: (t) => void this.act('Edit Conditions', () => E.setConditions(this.p, this.k, st.id, which, t), false, true),
      }, true, which === 'top' ? 'Conditions above' : 'Conditions below');
      rb.el.classList.add('si-scheme-cond', `si-cond-${which}`);
      const align = st[`${which}_align`] || this.layout[`${which}_align`];
      rb.el.style.textAlign = align;
      rb.el.addEventListener('focus', () => { this.picked = { kind: 'step', id: st.id, which }; this.mark(); this.host.chosen(this); });
      this.boxes.push(rb);
      this.conds.set(`${st.id}:${which}`, rb);
      return rb.el;
    };
    const arrow = el('div', 'si-scheme-arrow');
    arrow.innerHTML = '<svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path d="M0 5H94" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke"/><path d="M92 1.5L100 5L92 8.5Z" fill="currentColor"/></svg>';
    wrap.append(box('top'), arrow, box('bottom'));
    return wrap;
  }

  /** Show which box or step is picked. */
  private mark(): void {
    const p = this.picked;
    for (const b of this.strip.querySelectorAll<HTMLElement>('.si-scheme-box')) b.classList.toggle('on', p?.kind === 'box' && b.dataset.box === p.id);
    for (const s of this.strip.querySelectorAll<HTMLElement>('.si-scheme-step')) s.classList.toggle('on', p?.kind === 'step' && s.dataset.step === p.id);
  }

  // ---------------------------------------------------------------- the preview

  private runs(markup: string, bold = false): TextRun[] {
    const out: TextRun[] = [];
    parseMarkup(markup).filter((x) => x.runs.length).forEach((para, i) => {
      if (i) out.push({ text: '\n' });
      for (const r of para.runs) {
        if (r.ref?.startsWith(STRUCT)) continue;
        const text = r.ref ? (r.ref.startsWith(MENTION) ? this.host.label(r.ref) : '') : r.text;
        if (!text) continue;
        const t: TextRun = { text };
        if (bold || r.bold) t.bold = true;
        if (r.italic) t.italic = true;
        if (r.underline) t.underline = true;
        if (r.valign === 'sub') t.sub = true;
        if (r.valign === 'super') t.sup = true;
        out.push(t);
      }
    });
    return out;
  }

  /** The scheme drawn as the compiled SI draws it; `lay` instead of its Layout (the Layout window's preview). */
  async drawPreview(lay: SchemeLayout = this.layout, into: HTMLElement = this.preview): Promise<void> {
    const d = E.editorData(this.k);
    const box = async (b: Json): Promise<DrawBox | null> => {
      const mol = await E.boxMol(this.p, this.k, b);
      const contents = mol ? this.host.contentsOf(mol) : null;
      if (!contents) return null;
      const c = E.boxCompound(this.k, b);
      let label = this.runs(str(b.label), true);
      if (!label.length && c) label = [{ text: this.host.idOf(c), bold: true }];
      let yieldText = '';
      if ('yield' in b) yieldText = str(b.yield).trim();
      else if (c && fieldKeys(c).includes('yield')) { const pct = partText((valuesOf(c).yield as Json | undefined)?.percent).trim(); if (pct) yieldText = `${pct}%`; }
      return { contents, label, yieldText, dx: Number(b.label_dx) || 0, dy: Number(b.label_dy) || 0 };
    };
    const structures = async (markup: string): Promise<Contents[]> => {
      const out: Contents[] = [];
      for (const sid of E.inlineIds(markup)) { const m = await E.inlineMol(this.p, this.k, sid); const c = m ? this.host.contentsOf(m) : null; if (c) out.push(c); }
      return out;
    };
    const starting = (await Promise.all(d.starting.map(box))).filter((x): x is DrawBox => !!x);
    const steps: DrawStep[] = [];
    const align = (v: unknown) => (v === 'left' || v === 'center' || v === 'right' ? v : undefined);
    for (const st of d.steps) {
      steps.push({
        top: this.runs(st.top), bottom: this.runs(st.bottom), topAlign: align(st.top_align), bottomAlign: align(st.bottom_align),
        products: (await Promise.all(st.products.map(box))).filter((x): x is DrawBox => !!x),
        topStructures: await structures(st.top), bottomStructures: await structures(st.bottom),
      });
    }
    const got = drawScheme(starting, steps, lay, TEXT_W, siDrawingStyle(this.p.settings));
    const svg = got ? this.host.drawingSvg(got.contents) : null;
    into.replaceChildren();
    if (!svg || !got) { into.append(el('p', 'muted si-note', 'Nothing to print yet: draw the structures below.')); return; }
    const page = el('div', 'si-scheme-paper');
    page.style.width = `${Math.round(TEXT_W * PX)}px`;
    page.innerHTML = sized(svg, got.scale);
    into.append(page);
    const notes: string[] = [];
    if (got.rows > 1) notes.push(`${got.rows} rows`);
    if (got.scale < (lay.scale_pct / 100) - 1e-6) notes.push(`shrunk to ${Math.round(got.scale * 100)} % to fit the page`);
    if (got.textPt < 6) notes.push(`its conditions print at only ${got.textPt.toFixed(1)} pt`);
    if (notes.length) into.append(el('p', 'muted si-note', `As it prints: ${notes.join(', ')}.`));
  }

  // ---------------------------------------------------------------- commands

  /** `f` as one named step of Undo: through the host when it offers that (after pending saves), else the project's own history. */
  private step<T>(label: string, f: () => Promise<T>): Promise<T> {
    const host = this.host as SiSchemeHost & { step?<R>(label: string, f: () => Promise<R>): Promise<R> };
    if (host.step) return host.step(label, f);
    const j = journalOf(this.p.folder);
    return j ? j.step(label, f) : f();
  }

  /** A change to the scheme, as one step of Undo called `label`. */
  private async act(label: string, f: () => Promise<unknown>, redraw = false, quiet = false): Promise<void> {
    try { await this.step(label, f); } catch (e) { this.host.flash(`The scheme could not be changed: ${e instanceof Error ? e.message : String(e)}`, 8000); }
    if (redraw) { this.host.redraw(); return; }
    if (quiet) await this.drawPreview(); else await this.paint();
    this.host.chosen(this);
  }

  /** What the selected box is: to grey out the Scheme tab's commands that don't apply. */
  get state(): { box: boolean; step: boolean; linked: boolean; canLeft: boolean; canRight: boolean; stepLeft: boolean; stepRight: boolean; align: string } {
    const p = this.picked;
    const f = p?.kind === 'box' ? E.findBox(this.k, p.id) : null;
    const stepId = p?.kind === 'step' ? p.id : f && f.where !== E.START ? f.where : '';
    const st = p?.kind === 'step' ? E.findStep(this.k, p.id) : null;
    const steps = E.editorData(this.k).steps, si = steps.findIndex((x) => x.id === stepId);
    return {
      stepLeft: si > 0, stepRight: si >= 0 && si < steps.length - 1,
      box: !!f, step: !!stepId, linked: !!(f && E.boxCompound(this.k, f.box)),
      canLeft: !!f && f.list.indexOf(f.box) > 0, canRight: !!f && f.list.indexOf(f.box) < f.list.length - 1,
      align: st && p?.kind === 'step' ? str(st[`${p.which}_align`]) : '',
    };
  }

  private pickedBox(): { box: Json; list: Json[]; where: string } | null {
    const p = this.picked;
    const f = p?.kind === 'box' ? E.findBox(this.k, p.id) : null;
    if (!f) this.host.flash('Click a box of the scheme first.');
    return f;
  }

  private pickedStep(): string {
    const p = this.picked;
    if (p?.kind === 'step') return p.id;
    if (p?.kind === 'box') { const f = E.findBox(this.k, p.id); if (f && f.where !== E.START) return f.where; }
    return '';
  }

  async command(cmd: string, arg = ''): Promise<void> {
    const p = this.p, k = this.k;
    if (p.readOnly) { this.host.flash('This SI project is open read-only.'); return; }
    const box = (): Json | null => this.pickedBox()?.box ?? null;
    switch (cmd) {
      case 'draw': {
        const b = box();
        if (!b) return;
        const mol = await E.boxMol(p, k, b);
        const c = E.boxCompound(k, b);
        this.host.editStructure(mol ? this.host.contentsOf(mol) : null, c ? `${this.host.idOf(c)} ${compoundName(c)}`.trim() : str(b.label) || 'Scheme structure', (got) => {
          if (!got) return;
          if (!got.atoms.length) { this.host.flash('Nothing was drawn, so the structure is as it was.'); return; }
          const m = this.host.molfileOf(got);
          if (!m.molblock) { this.host.flash(m.problem ?? 'The drawing could not be read as a structure.'); return; }
          void this.act('Draw Structure', () => E.setBoxStructure(p, k, str(b.id), m.molblock!), !!c);
        });
        return;
      }
      case 'paste': {
        const b = box();
        if (!b) return;
        let got: Pasted;
        try { got = await this.host.readClipboard(); } catch (e) { this.host.flash(`The clipboard could not be read: ${e instanceof Error ? e.message : String(e)}`); return; }
        if (got.kind !== 'drawing') { this.host.flash('The clipboard has no structure. Copy one in ChemDraw or Chemweave first.'); return; }
        const m = this.host.molfileOf(got.doc.contents());
        if (!m.molblock) { this.host.flash(m.problem ?? 'The copied drawing could not be read as one structure.'); return; }
        await this.act('Paste Structure', () => E.setBoxStructure(p, k, str(b.id), m.molblock!), !!E.boxCompound(k, b));
        return;
      }
      case 'add-start': {
        const f = this.picked?.kind === 'box' ? E.findBox(k, this.picked.id) : null;
        const at = f && f.where === E.START ? f.list.indexOf(f.box) + 1 : undefined;
        await this.act('Add Starting Material', async () => { const b = await E.addBox(p, k, E.START, at); this.picked = { kind: 'box', id: str(b.id), where: E.START }; });
        return;
      }
      case 'add-product': {
        let where = this.pickedStep();
        const d = E.editorData(k);
        if (!where) where = d.steps[d.steps.length - 1]?.id ?? '';
        if (!where) { this.host.flash('Add a step first: a product follows a step’s arrow.'); return; }
        const f = this.picked?.kind === 'box' ? E.findBox(k, this.picked.id) : null;
        const at = f && f.where === where ? f.list.indexOf(f.box) + 1 : undefined;
        await this.act('Add Product', async () => { const b = await E.addBox(p, k, where, at); this.picked = { kind: 'box', id: str(b.id), where }; });
        return;
      }
      case 'add-step': {
        const d = E.editorData(k);
        const cur = this.pickedStep();
        const at = cur ? d.steps.findIndex((s) => s.id === cur) + 1 : undefined;
        await this.act('Add Step', async () => { const st = await E.addStep(p, k, at); this.picked = { kind: 'box', id: str(st.products[0].id), where: st.id }; });
        return;
      }
      case 'move-left': case 'move-right': {
        const b = box();
        if (b) await this.act('Move Structure', () => E.moveBox(p, k, str(b.id), cmd === 'move-left' ? -1 : 1), !!E.boxCompound(k, b));
        return;
      }
      case 'step-left': case 'step-right': {
        const st = this.pickedStep();
        if (!st) { this.host.flash('Click a step’s conditions or one of its products first.'); return; }
        await this.act('Move Step', () => E.moveStep(p, k, st, cmd === 'step-left' ? -1 : 1), true);
        return;
      }
      case 'remove': {
        const b = box();
        if (!b) return;
        const c = E.boxCompound(k, b);
        const go = await askChoice('Remove Structure', c ? `The box goes; ${this.host.idOf(c)}’s compound page stays a compound of this scheme page (delete it from the tree if it isn’t needed).` : 'The box goes; its structure goes to the project’s Trash, so it can be put back.', [{ value: 'go', label: 'Remove', primary: true }, { value: 'no', label: 'Cancel' }], 'no');
        if (go !== 'go') return;
        this.picked = null;
        await this.act('Remove Structure', () => E.removeBox(p, k, str(b.id)), !!c);
        return;
      }
      case 'remove-step': {
        const st = this.pickedStep();
        if (!st) { this.host.flash('Click a step’s conditions or one of its products first.'); return; }
        const go = await askChoice('Remove Step', 'The arrow, its conditions and its products go; the products’ structures go to the project’s Trash. Compound pages they showed stay compounds of this scheme page.', [{ value: 'go', label: 'Remove', primary: true }, { value: 'no', label: 'Cancel' }], 'no');
        if (go !== 'go') return;
        this.picked = null;
        await this.act('Remove Step', () => E.removeStep(p, k, st), true);
        return;
      }
      case 'mark-compound': {
        const b = box();
        if (!b) return;
        if (E.boxCompound(k, b)) { this.host.flash('This box is already a compound.'); return; }
        await this.act('Mark as Compound', () => E.markAsCompound(p, k, str(b.id)), true);
        return;
      }
      case 'show-compound': {
        const b = box();
        if (!b) return;
        const shown = new Set(E.allBoxes(k).map(([x]) => str(x.compound)));
        const free = k.children.filter((c) => !shown.has(c.id));
        if (!free.length) { this.host.flash('Every compound of this scheme page is already shown by a box. Mark as Compound makes a new one.'); return; }
        const got = await ask('Show Compound', [{ name: 'c', label: 'Compound', value: free[0].id, options: free.map((c) => ({ value: c.id, label: `${this.host.idOf(c)} ${compoundName(c) || 'unnamed compound'}` })) }], { ok: 'Show', note: 'The box shows the compound’s structure and ID (a compound with no structure takes the box’s).' });
        if (got) await this.act('Show Compound', () => E.linkCompound(p, k, str(b.id), got.c), true);
        return;
      }
      case 'unlink': {
        const b = box();
        if (b && E.boxCompound(k, b)) await this.act('Unlink Compound', () => E.unlinkBox(p, k, str(b.id)), true);
        return;
      }
      case 'open-compound': {
        const b = box();
        const c = b ? E.boxCompound(k, b) : null;
        if (c) this.host.openCompound(c.id); else if (b) this.host.flash('This box isn’t a compound: Mark as Compound gives it a page.');
        return;
      }
      case 'insert-structure': {
        let target = this.picked?.kind === 'step' ? this.conds.get(`${this.picked.id}:${this.picked.which}`) : undefined;
        if (!target) { const st = this.pickedStep(); target = st ? this.conds.get(`${st}:top`) : undefined; }
        if (!target) { this.host.flash('Click in the conditions above or under an arrow first.'); return; }
        const into = target;
        this.host.editStructure(null, 'Structure in the conditions', (got) => {
          if (!got || !got.atoms.length) return;
          const m = this.host.molfileOf(got);
          if (!m.molblock) { this.host.flash(m.problem ?? 'The drawing could not be read as a structure.'); return; }
          void (async () => {
            const sid = await this.step('Insert Structure', () => E.addInlineStructure(p, k, m.molblock!));
            const svg = this.host.pictureOf(m.molblock!);
            if (svg) this.inlinePics.set(sid, sized(svg, this.layout.cond_structure_pct / 100 * 0.75));
            into.insertRef(STRUCT + sid);
          })().catch((e) => this.host.flash(`The structure could not be added: ${e instanceof Error ? e.message : String(e)}`));
        });
        return;
      }
      case 'align': {
        const pk = this.picked;
        if (pk?.kind !== 'step') { this.host.flash('Click in the conditions above or under an arrow first.'); return; }
        await this.act('Align Conditions', () => E.setConditionsAlign(p, k, pk.id, pk.which, (arg as '' | 'left' | 'center' | 'right')));
        this.conds.get(`${pk.id}:${pk.which}`)?.el.focus();
        return;
      }
      case 'layout': await this.layoutWindow(); return;
    }
  }

  /** Scheme ▸ Layout: every layout setting of this scheme, with the scheme drawn again as they change; or the project's defaults. */
  private async layoutWindow(): Promise<void> {
    const p = this.p, k = this.k;
    const now = this.layout;
    const fields: Field[] = [
      ...schemeLayoutFields(now),
      { name: 'scope', label: 'Use for', value: 'scheme', options: [{ value: 'scheme', label: 'This scheme' }, { value: 'project', label: 'Every scheme of the project (its defaults)' }] },
    ];
    const read = readSchemeLayout;
    const got = await ask('Scheme Layout', fields, { ok: 'Apply', preview: { title: 'As it prints', below: true, draw: (v) => { const box = el('div', 'si-scheme-preview'); void this.drawPreview({ ...now, ...read(v) }, box); return box; } } });
    if (!got) return;
    const values = { ...now, ...read(got) };
    await this.act('Scheme Layout', async () => {
      if (got.scope === 'project') {
        await E.setProjectLayout(p, values);
        // this scheme follows the project's defaults now
        await E.setSchemeLayout(p, k, values);
      } else await E.setSchemeLayout(p, k, values);
    });
  }

  /** Every conditions box saves what was typed. */
  commit(): void { for (const b of this.boxes) b.commit(); }
}

const ALIGN_OPTS = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];

/** Scheme ▸ Layout's settings (and Project Settings ▸ Schemes'), filled from `now`. */
export function schemeLayoutFields(now: SchemeLayout): Field[] {
  return [
    { name: 'h1', label: 'Text', value: '', type: 'heading' },
    { name: 'cond_size_pt', label: 'Conditions text size', value: String(now.cond_size_pt), type: 'number', unit: 'pt', min: 5, max: 20, help: 'The conditions above and under the arrows; the IDs are 1 pt larger (bold).' },
    { name: 'top_align', label: 'Conditions above the arrow', value: now.top_align, options: ALIGN_OPTS },
    { name: 'bottom_align', label: 'Conditions under the arrow', value: now.bottom_align, options: ALIGN_OPTS },
    { name: 'cond_structure_pct', label: 'Structures in the conditions', value: String(now.cond_structure_pct), type: 'number', unit: '% of the scheme’s structures', min: 10, max: 300, help: 'Structures put in the conditions (Insert Structure) are drawn this much of the size of the scheme’s own structures, over the text above the arrow or under the text below it. Chemweave starts at 70 %.' },
    { name: 'h2', label: 'Arrows and spacing', value: '', type: 'heading', help: 'The arrows’ line width and heads, and the structures’ bonds and labels, follow the project’s drawing style (Project Settings ▸ Structures).' },
    { name: 'arrow_before_mm', label: 'Arrow before the text', value: String(now.arrow_before_mm), type: 'number', unit: 'mm', min: 0, max: 50 },
    { name: 'arrow_after_mm', label: 'Arrow after the text (head)', value: String(now.arrow_after_mm), type: 'number', unit: 'mm', min: 0, max: 50 },
    { name: 'arrow_min_mm', label: 'Shortest arrow', value: String(now.arrow_min_mm), type: 'number', unit: 'mm', min: 2, max: 150 },
    { name: 'gap_mm', label: 'Gap between structures, + and arrows', value: String(now.gap_mm), type: 'number', unit: 'mm', min: 0, max: 20 },
    { name: 'h3', label: 'IDs and yields', value: '', type: 'heading' },
    { name: 'align_ids', label: 'Line up the IDs of a row', value: String(now.align_ids), type: 'checkbox', help: 'Every ID of a row on one line, under its lowest structure; otherwise each ID sits right under its structure.' },
    { name: 'yields', label: 'Yields', value: now.yields, options: [{ value: 'product', label: 'Under each product' }, { value: 'conditions', label: 'Under the step’s conditions' }, { value: 'none', label: 'Not printed' }] },
    { name: 'h4', label: 'Page', value: '', type: 'heading' },
    { name: 'scale_pct', label: 'Size', value: String(now.scale_pct), type: 'number', unit: '%', min: 20, max: 300 },
    { name: 'fit', label: 'Too wide for the page', value: now.fit, options: [{ value: 'wrap', label: 'Start a new row at an arrow' }, { value: 'shrink', label: 'Shrink it to one line' }] },
    { name: 'show_label', label: 'Print “Scheme S1. Name” under it', value: String(now.show_label), type: 'checkbox', help: 'Numbered with the SI’s schemes and listed; off by default, as a data section’s scheme stands alone.' },
  ];
}

/** The layout values typed into those settings. */
export function readSchemeLayout(v: Record<string, string>): Partial<SchemeLayout> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SCHEME_DEFAULTS) as (keyof SchemeLayout)[]) {
    const x = v[key];
    if (x === undefined) continue;
    const def = SCHEME_DEFAULTS[key];
    out[key] = typeof def === 'boolean' ? x === 'true' : typeof def === 'number' ? Number(x) : x;
  }
  return out as Partial<SchemeLayout>;
}
