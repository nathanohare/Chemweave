// The Smart Scheme pane: the species of the selected Smart Scheme in order, beside it on the page,
// like SmartArt's text pane. It works both ways: typing in a row changes the drawing, and a change
// on the drawing shows in the rows. Rows drag to put the species in another order; × takes one
// out and + Add Species puts one on the end. The pictures along the top lay the scheme out again
// (in a line, in rows, as a snake, down the page or round a cycle). ‹ folds it to a tab.

import type { Doc } from '../model';
import type { Rect } from '../geom';
import type { Measure } from '../editor/arrange';
import { canRemoveSlot, loopMiddles, readSmart, slotName, smartIsFree, smartLayoutOf, stepHolder, stepNamesNow, stepPartKind, SMART_LAYOUTS, type LoopJoin, type SmartData, type SmartLayout, type SmartLink, type SmartRead, type StepPart, type TextPart } from '../chem/smart-scheme';
import { askLoop, askBranch } from './smart-loop-pop';
import type { TextRun } from '../model';
import { RichField } from './rich-field';
import { SYMBOLS } from './symbol-list';
import { dropTarget, type BoxPlace } from './toolboxes';
import { PIN_ICON, PINNED_ICON } from './float-box';
import { formatDefaults, type SmartFormat } from '../chem/smart-format';
import { toggleSmartFormat } from './smart-format-pop';
import { popupMenu } from './popup-menu';

export interface SmartPaneHooks {
  doc(): Doc;
  measure(): Measure;
  /** The Smart Scheme selected (its frame), or null. */
  selected(): number | null;
  /** Where a box on the page is on the screen (CSS pixels, the window's coordinates). */
  screenRect(r: Rect): Rect;
  /** Where the drawing shows on the screen (the pane keeps inside it). */
  area(): Rect;
  slotRuns(id: number, k: number, parts: TextPart[]): void;
  stepRuns(id: number, k: number, part: StepPart, parts: TextPart[]): void;
  /** Make species k a dashed box to draw or paste its structure in. */
  toStructure(id: number, k: number): void;
  /** Make species k's dashed box a text label again. */
  toText(id: number, k: number): void;
  /** Make what joins or leaves at step k (above or below its arrow) a dashed box for a structure. */
  stepToStructure(id: number, k: number, part: 'above' | 'below'): void;
  /** Make a step's dashed reagent box text again. */
  stepToText(id: number, k: number, part: 'above' | 'below'): void;
  /** Select a dashed species box on the page (a paste then goes into it). */
  selectHolder(shape: number): void;
  /** Make the list a toolbox at this place (a dock, or floating where it was dropped); null: float it beside the scheme again. */
  dock(where: Partial<BoxPlace> | null): void;
  /** The drawing area (its edges dock toolboxes), on the screen. */
  work(): DOMRect;
  /** Add a species after slot `after` (in a cycle of several loops: on step `link`). */
  add(id: number, after: number, link?: number): void;
  remove(id: number, k: number): void;
  move(id: number, from: number, to: number): void;
  arrange(id: number, patch: Partial<SmartData>): void;
  /** Add a loop of `count` new species to a cycle, joined as `join` says. */
  addLoop(id: number, join: LoopJoin, count: number): void;
  /** Take loop `loop` (not the first) out of a cycle. */
  removeLoop(id: number, loop: number): void;
  /** Add a species off the cycle at slot `k`: coming in, going out, or in equilibrium with it. */
  addBranch(id: number, k: number, dir: 'in' | 'out' | 'both'): void;
  /** Write the middle of loop `loop` (the catalyst's name). */
  loopMiddle(id: number, loop: number, parts: TextPart[]): void;
  /** Write every step name the cycle knows short (OA) or in full (oxidative addition). */
  stepNames(id: number, how: 'short' | 'full'): void;
  /** Give the scheme its own font, text sizes, arrows and spacing (undefined: the drawing style's). */
  format(id: number, fmt: SmartFormat | undefined): void;
  /** Clean Up Cycle: the cycle's species onto one ellipse, its arrows along it. */
  cleanUpCycle(id: number): void;
  ungroup(id: number): void;
}

export const SMART_LAYOUT_ICONS: Record<SmartLayout, string> = {
  line: '<rect x="2" y="9" width="5" height="5"/><rect x="11" y="9" width="5" height="5"/><rect x="20" y="9" width="5" height="5"/><path d="M7.5 11.5h3M16.5 11.5h3" fill="none"/>',
  rows: '<rect x="3" y="4" width="5" height="5"/><rect x="12" y="4" width="5" height="5"/><rect x="3" y="14" width="5" height="5"/><rect x="12" y="14" width="5" height="5"/><path d="M8.5 6.5h3M8.5 16.5h3" fill="none"/>',
  snake: '<rect x="3" y="4" width="5" height="5"/><rect x="14" y="4" width="5" height="5"/><rect x="14" y="14" width="5" height="5"/><rect x="3" y="14" width="5" height="5"/><path d="M8.5 6.5h5M16.5 9.5v4M13.5 16.5h-5" fill="none"/>',
  down: '<rect x="11" y="1.5" width="5" height="5"/><rect x="11" y="9.5" width="5" height="5"/><rect x="11" y="17.5" width="5" height="5"/><path d="M13.5 6.5v3M13.5 14.5v3" fill="none"/>',
  cycle: '<rect x="11" y="1.5" width="5" height="5"/><rect x="19.5" y="9.5" width="5" height="5"/><rect x="11" y="17.5" width="5" height="5"/><rect x="2.5" y="9.5" width="5" height="5"/><circle cx="13.5" cy="12" r="7.5" fill="none" stroke-dasharray="2 2"/>',
};

let folded = false;

/** Chemical interpretation of what is typed in the rows (remembered between uses). */
let chemOn = (() => { try { return localStorage.getItem('smartPaneChem') !== 'off'; } catch { return true; } })();


/** Caption runs as the pieces a row shows. */
const runParts = (runs: TextRun[]): TextPart[] => runs.map((r) => ({ text: r.text, ...(r.sub ? { sub: true } : r.sup ? { sup: true } : {}), ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}), ...(r.underline ? { underline: true } : {}) }));

/** The first text box of a step's conditions above or below its arrow (or its name inside a cycle), as pieces. */
function stepParts(doc: Doc, l: SmartLink, part: StepPart): TextPart[] {
  const it = l[part].find((x) => x.caption !== undefined);
  const c = it ? doc.captions.get(it.caption!) : undefined;
  return c ? runParts(c.runs) : [];
}

const HEXAGON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 L13.6 4.75 L13.6 11.25 L8 14.5 L2.4 11.25 L2.4 4.75 Z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

export class SmartPane {
  private el: HTMLDivElement;
  private shown: number | null = null;
  /** What the rows were drawn from, so they are drawn again only when the scheme changes. */
  private drawnFor = '';
  private dragFrom: number | null = null;
  /** The row last typed in (the formatting bar works on it), by its key. */
  private active: RichField | null = null;
  private activeKey = '';
  private fields = new Map<string, RichField>();
  /** The scheme's make-up when the rows were drawn (its members and layout), and what each row stands for. */
  private drawnShape = '';
  private rowOf = new Map<string, string>();
  private bar: HTMLDivElement | null = null;
  private symbols = false;
  /** Docked: the toolbox body it shows in (it is then there whether or not a scheme is selected). */
  private host: HTMLElement | null = null;

  get isDocked(): boolean { return this.host !== null; }

  /** Show the list in a toolbox's body instead of beside the scheme. */
  dockInto(body: HTMLElement): void {
    this.host = body;
    body.append(this.el);
    this.el.classList.add('docked');
    this.el.style.left = this.el.style.top = '';
    this.shown = null;
    this.drawnFor = '';
    this.refresh();
  }

  /** Back to floating beside the selected scheme. */
  float(): void {
    this.host = null;
    this.el.classList.remove('docked');
    document.body.append(this.el);
    this.shown = null;
    this.drawnFor = '';
    this.el.hidden = true;
    this.refresh();
  }

  /** Docked with no scheme selected: what the list is for. */
  private showEmpty(): void {
    if (this.drawnFor === 'empty') return;
    this.shown = null;
    this.drawnFor = 'empty';
    this.el.hidden = false;
    const p = document.createElement('p');
    p.className = 'sp-note sp-empty';
    p.textContent = 'Select a Smart Scheme to list its species and steps here.';
    // its title, to drag the docked list to another edge
    const head = document.createElement('div');
    head.className = 'sp-head';
    const title = Object.assign(document.createElement('span'), { className: 'sp-title', textContent: 'Smart Scheme' });
    head.append(title);
    head.title = 'Drag to another edge of the drawing to dock this list there, or off the edge to float it';
    this.wireDrag(head);
    this.el.replaceChildren(head, p);
    this.el.classList.add('sp-none');
  }

  constructor(private hooks: SmartPaneHooks) {
    this.el = document.createElement('div');
    this.el.className = 'smart-pane';
    this.el.hidden = true;
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Smart Scheme species');
    // keys typed here are the pane's, not the drawing's shortcuts
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.append(this.el);
  }

  /** The selection or the drawing changed: show the pane for the selected scheme, with its rows up to date. */
  refresh(): void {
    // its toolbox was put away: back beside the scheme
    if (this.host && !this.host.isConnected) { this.float(); return; }
    const id = this.hooks.selected();
    if (id === null) { this.hide(); return; }
    const doc = this.hooks.doc();
    const key = `${id} ${doc.version} ${folded}`;
    // a row being typed in is left alone until it is finished
    const typing = document.activeElement as HTMLElement | null;
    if (this.shown === id && typing && this.el.contains(typing) && (typing.tagName === 'INPUT' || typing.isContentEditable)) {
      // ... unless the scheme gained or lost species or steps meanwhile (the + buttons on the page
      // leave the caret where it is): what is typed is finished, and the rows drawn again with the
      // caret back in the same row
      if (this.shapeOf(id) !== this.drawnShape && key !== this.drawnFor) this.redrawTyping(id);
      this.place();
      return;
    }
    if (this.shown !== id || key !== this.drawnFor) this.render(id);
    this.place();
  }

  /** What a scheme is made of (its members and layout): the rows change only when this does. */
  private shapeOf(id: number): string {
    const s = this.hooks.doc().shapes.get(id);
    const f = s?.frame;
    return f ? `${f.atoms.length} ${f.captions.length} ${f.arrows.length} ${f.shapes.length} ${s?.smart?.layout ?? ''}` : '';
  }

  /** Draw the rows again while one is being typed in, keeping the caret in that row (found by what it stands for). */
  private redrawTyping(id: number): void {
    const key = this.activeKey, f = this.fields.get(key);
    const what = this.rowOf.get(key);
    this.render(id);
    const back = what === undefined ? undefined : [...this.rowOf].find(([, w]) => w === what)?.[0];
    const g = back === undefined ? undefined : this.fields.get(back);
    // (the row may have moved: what is typed goes on with the new row, so it lands on the right species)
    if (f && g) f.handOver(g);
    else f?.handOver(f);
    if (!g) return;
    g.el.focus();
    g.select(g.parts().reduce((n, p) => n + p.text.length, 0));
  }

  hide(): void {
    if (this.host) { this.showEmpty(); return; }
    if (this.shown === null) return;
    this.shown = null;
    this.drawnFor = '';
    this.el.hidden = true;
  }

  /** Keep it against the scheme's left edge (or its right, when there is no room on the left). */
  place(): void {
    if (this.shown === null || this.host) return;
    const s = this.hooks.doc().shapes.get(this.shown);
    if (!s) { this.hide(); return; }
    const r = this.hooks.screenRect({ x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) });
    const area = this.hooks.area();
    const w = this.el.offsetWidth || 300, h = this.el.offsetHeight || 200;
    let x = r.x1 - w - 10;
    if (x < area.x1 + 4) x = Math.min(r.x2 + 10, area.x2 - w - 4);
    x = Math.max(area.x1 + 4, x);
    const y = Math.max(area.y1 + 4, Math.min(r.y1, area.y2 - h - 4));
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
  }

  private render(id: number): void {
    const doc = this.hooks.doc(), m = this.hooks.measure();
    const s = doc.shapes.get(id);
    const read = readSmart(doc, m, id);
    if (!s?.smart || !read) { this.hide(); return; }
    this.el.classList.remove('sp-none');
    this.shown = id;
    this.drawnFor = `${id} ${doc.version} ${folded}`;
    this.drawnShape = this.shapeOf(id);
    this.rowOf.clear();
    this.el.hidden = false;
    this.el.classList.toggle('folded', folded && !this.host);
    this.el.replaceChildren();
    // (several loops are always a cycle, and never left as laid out by hand, whatever an older file says)
    const data: SmartData = { ...s.smart, layout: smartLayoutOf(s.smart, read), free: smartIsFree(s.smart, read) || undefined };
    const net = read.net;
    const btn = (label: string, title: string, cls: string, f: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.innerHTML = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => { e.preventDefault(); f(); });
      return b;
    };
    if (folded && !this.host) {
      this.el.append(btn('›', 'Show the species list', 'sp-unfold', () => { folded = false; this.render(id); this.place(); }));
      return;
    }
    // one compact row: the title (drag it to an edge of the drawing to dock the list), the layouts as small pictures, dock and fold
    const head = document.createElement('div');
    head.className = 'sp-head';
    // (docked too: its toolbox's own title bar is hidden while locked, and this is the one to drag)
    const title = document.createElement('span');
    title.className = 'sp-title';
    title.textContent = 'Smart Scheme';
    head.append(title);
    head.title = this.host ? 'Drag to another edge of the drawing to dock this list there, or off the edge to float it' : 'Drag to an edge of the drawing to dock this list there, like a toolbox';
    this.wireDrag(head);
    // how the list works, kept behind an "i" so it doesn't take room in the pane
    const info = document.createElement('span');
    info.className = 'sp-info';
    info.tabIndex = 0;
    info.setAttribute('role', 'img');
    info.innerHTML = '<svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="7" cy="7" r="5.9"/><path d="M7 6.2v3.9" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="4.1" r=".85" fill="currentColor" stroke="none"/></svg>';
    const help = data.layout === 'cycle'
      ? 'Each row is a species in the cycle; the T row below it is the arrow text to the next species (step name, what enters and leaves). Type in the rows, drag a row\'s handle to reorder, or drag a species on the page. Use + on the page to add a species. + Add at the bottom adds another loop (sharing a species or a stretch of them, turning with a step, or beside the cycle) or a species off the cycle; each loop then has its own heading here.'
      : 'Each row is a species in the scheme; the T row below it is the text above and below the arrow to the next species. Type in the rows, drag a row\'s handle to reorder, or drag a species on the page. Use + on the page to add a species.';
    info.title = help;
    info.setAttribute('aria-label', help);
    head.append(info);
    const lay = document.createElement('div');
    lay.className = 'sp-layouts';
    lay.setAttribute('role', 'radiogroup');
    lay.setAttribute('aria-label', 'Layout');
    for (const l of SMART_LAYOUTS) {
      const on = data.layout === l.id && !data.free;
      const b = btn(`<svg viewBox="0 0 27 24" width="20" height="18" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="1.2">${SMART_LAYOUT_ICONS[l.id]}</g></svg>`, `${l.name}: ${l.tip}`, 'sp-layout', () => this.hooks.arrange(id, { layout: l.id }));
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      if (net && l.id !== 'cycle') { b.disabled = true; b.title = `${l.name}: not for a cycle of several loops or with species off it`; }
      lay.append(b);
    }
    head.append(lay);
    const gear = btn('<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="2.1"/><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M3.5 12.5l1.3-1.3M11.2 4.8l1.3-1.3" stroke-linecap="round"/><circle cx="8" cy="8" r="4.6"/></svg>',
      'Scheme Format: its font, text sizes, arrows and spacing', 'sp-gear', () => toggleSmartFormat(gear, {
        fmt: this.hooks.doc().shapes.get(id)?.smart?.fmt ?? {},
        defaults: formatDefaults(this.hooks.doc()),
        cycle: (this.hooks.doc().shapes.get(id)?.smart?.layout ?? data.layout) === 'cycle',
        apply: (fmt) => this.hooks.format(id, fmt),
      }));
    gear.dataset.for = String(id);
    gear.setAttribute('aria-haspopup', 'dialog');
    if (data.fmt) gear.classList.add('on');
    const pin = btn(this.host ? PINNED_ICON : PIN_ICON, this.host ? 'Undock: float the list beside the scheme again' : 'Dock the list as a toolbox at the right (or drag its title to any edge)', 'sp-pin', () => this.hooks.dock(this.host ? null : { dock: 'right' }));
    pin.setAttribute('aria-pressed', String(!!this.host));
    head.append(pin);
    if (!this.host) head.append(btn('‹', 'Collapse the species list', 'sp-fold', () => { folded = true; this.render(id); this.place(); }));
    this.el.append(head);
    this.el.append(this.formatBar(btn, gear));
    if (data.free) {
      // laid out by hand: said behind the "i" (marked), not on a line of its own
      const why = read.chain ? 'Laid out by hand. Pick a layout to lay it out again.' : 'This scheme branches, so it keeps the layout it has. You can still retype its species and conditions.';
      info.title = `${why}\n\n${info.title}`;
      info.setAttribute('aria-label', info.title);
      info.classList.add('marked');
    }
    // the layout's own settings
    const opts = document.createElement('div');
    opts.className = 'sp-opts';
    if (data.layout === 'cycle' && !data.free) {
      const check = (label: string, on: boolean, f: (v: boolean) => void) => {
        const l = document.createElement('label');
        const i = document.createElement('input');
        i.type = 'checkbox';
        i.checked = on;
        i.addEventListener('change', () => f(i.checked));
        l.append(i, document.createTextNode(' ' + label));
        return l;
      };
      // what joins and leaves on small curved arrows into and out of the loop (else written outside it)
      opts.append(check('Counterclockwise', !!data.anticlockwise, (v) => this.hooks.arrange(id, { anticlockwise: v })), check('Arrows in and out', !!data.reagentArrows, (v) => this.hooks.arrange(id, { reagentArrows: v })));
      (opts.lastElementChild as HTMLElement).title = 'Draw what enters and leaves each step on small curved arrows into and out of the loop. Off: written outside the loop';
      // step names the cycle knows, short or in full
      const now = stepNamesNow(doc, read);
      if (now) {
        const l = document.createElement('label');
        const sel = document.createElement('select');
        sel.className = 'sp-names';
        sel.append(new Option('Short', 'short'), new Option('Full', 'full'));
        sel.value = now;
        sel.title = 'Step names: short (OA, TM, RE) or in full (oxidative addition)';
        sel.addEventListener('change', () => this.hooks.stepNames(id, sel.value as 'short' | 'full'));
        l.append(document.createTextNode('Step names '), sel);
        opts.append(l);
      }
    } else if ((data.layout === 'rows' || data.layout === 'snake') && !data.free) {
      const l = document.createElement('label');
      const i = document.createElement('input');
      i.type = 'number';
      i.min = '1';
      i.max = '12';
      i.value = String(data.perRow ?? 3);
      i.addEventListener('change', () => { const n = Math.round(Number(i.value)); if (n >= 1 && n <= 12) this.hooks.arrange(id, { perRow: n }); });
      l.append(document.createTextNode('Steps in each row '), i);
      opts.append(l);
    }
    if (opts.childElementCount) this.el.append(opts);

    // the species and the steps between them
    const cycle = data.layout === 'cycle';
    const list = document.createElement('ol');
    list.className = 'sp-list';
    this.fields.clear();
    const field = (key: string, value: TextPart[], placeholder: string, label: string, done: (v: TextPart[]) => void): HTMLDivElement => {
      const f = new RichField(value, { placeholder, label, chem: () => chemOn, looks: true, done, onState: (x) => { if (x === this.active) this.showState(); } });
      this.fields.set(key, f);
      f.el.dataset.key = key;
      f.el.addEventListener('focus', () => { this.active = f; this.activeKey = key; this.showState(); });
      f.el.addEventListener('blur', () => setTimeout(() => { if (!this.el.contains(document.activeElement)) this.showState(); this.refresh(); }, 0));
      if (key === this.activeKey && this.active) this.active = f;
      return f.el;
    };
    /** A species' row. `drag`: the rows it can change places with (its own loop's, or its branch's). */
    const slotRow = (k: number, drag: boolean): HTMLLIElement => {
      const slot = read.slots[k];
      const li = document.createElement('li');
      li.className = 'sp-slot';
      li.draggable = drag;
      li.dataset.k = String(k);
      const grip = document.createElement('span');
      grip.className = 'sp-grip';
      grip.textContent = '⋮⋮';
      grip.title = net ? 'Drag to put this species somewhere else in its loop' : 'Drag to put this species somewhere else in the scheme';
      if (!drag) grip.style.visibility = 'hidden';
      const num = document.createElement('span');
      num.className = 'sp-num';
      num.textContent = String(k + 1);
      let name: HTMLElement;
      if (slot.caption !== undefined) this.rowOf.set(`s${k}`, `c${slot.caption}`);
      if (slot.caption !== undefined) name = field(`s${k}`, runParts(doc.captions.get(slot.caption)?.runs ?? []), 'Species', `Species ${k + 1}`, (v) => this.hooks.slotRuns(id, k, v));
      else if (slot.holder !== undefined) {
        const h = slot.holder;
        name = btn(slotName(doc, slot), 'Select the box on the page: draw the structure in it, or paste one (Ctrl+V)', 'sp-holder', () => this.hooks.selectHolder(h));
      } else name = Object.assign(document.createElement('span'), { className: 'sp-fixed', textContent: slotName(doc, slot), title: 'A drawn structure: edit it on the page' });
      li.append(grip, num, name);
      if (slot.caption !== undefined) li.append(btn(HEXAGON, 'Make this species a structure (a box to draw or paste in)', 'sp-struct', () => this.hooks.toStructure(id, k)));
      else if (slot.holder !== undefined) {
        const b = btn(HEXAGON, 'Back to a text label', 'sp-struct', () => this.hooks.toText(id, k));
        b.setAttribute('aria-pressed', 'true');
        li.append(b);
      }
      if (canRemoveSlot(read, k)) li.append(btn('×', net ? `Remove species ${k + 1}` : `Remove species ${k + 1} and the step after it`, 'sp-x', () => this.hooks.remove(id, k)));
      li.addEventListener('dragstart', (e) => { this.dragFrom = k; e.dataTransfer?.setData('text/plain', String(k)); li.classList.add('dragging'); });
      li.addEventListener('dragend', () => { this.dragFrom = null; li.classList.remove('dragging'); });
      li.addEventListener('dragover', (e) => { if (this.dragFrom !== null && canDrop(this.dragFrom, k)) { e.preventDefault(); li.classList.add('drop'); } });
      li.addEventListener('dragleave', () => li.classList.remove('drop'));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drop');
        const from = this.dragFrom;
        this.dragFrom = null;
        if (from !== null && from !== k && canDrop(from, k)) this.hooks.move(id, from, k);
      });
      return li;
    };
    // in a cycle of several loops a species changes places only with others of its own loop (or branch)
    const runs = net ? [...net.loops.map((lp) => lp.own), ...net.tails.map((t) => t.slots)] : [];
    const canDrop = (from: number, to: number) => !net || runs.some((r) => r.includes(from) && r.includes(to));
    /** The row of a step (by its place in the scheme's steps): the text on its arrow. `straight`: not round a loop. */
    const stepRow = (k: number, round: boolean): HTMLLIElement | null => {
      const l = read.links[k];
      if (!l) return null;
      for (const p of ['inside', 'above', 'below'] as const) this.rowOf.set(`p${k}${p}`, `r${l.arrow.id}${p}`);
      const step = document.createElement('li');
      step.className = 'sp-step';
      const arrow = document.createElement('span');
      arrow.className = 'sp-arrow';
      // A "T" text mark: this row holds the words written on the arrow.
      arrow.innerHTML = '<svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2.5 2.75h9M7 2.75v8.5"/></svg>';
      arrow.title = `Text on the arrow from species ${l.from + 1} to species ${l.to + 1}`;
      arrow.setAttribute('aria-hidden', 'true');
      const part = (p: StepPart, ph: string, label: string): HTMLElement => {
        if (p === 'inside') return field(`p${k}${p}`, stepParts(doc, l, p), ph, `${label}, step ${k + 1}`, (v) => this.hooks.stepRuns(id, k, p, v));
        // text, or a structure: a dashed box to draw or paste it in, or the structure drawn
        const wrap = document.createElement('div');
        wrap.className = 'sp-part';
        const kind = stepPartKind(doc, l, p);
        const what = p === 'above' ? (round ? 'what joins the cycle' : 'the reagent above the arrow') : (round ? 'what leaves the cycle' : 'the reagent below the arrow');
        if (kind === 'text') {
          wrap.append(field(`p${k}${p}`, stepParts(doc, l, p), ph, `${label}, step ${k + 1}`, (v) => this.hooks.stepRuns(id, k, p, v)));
          wrap.append(btn(HEXAGON, `Make ${what} a structure (a box to draw or paste in)`, 'sp-struct sp-part-struct', () => this.hooks.stepToStructure(id, k, p)));
        } else if (kind === 'box') {
          const h = stepHolder(doc, l, p)!;
          wrap.append(btn('draw…', 'Select its box on the page: draw the structure in it, or paste one (Ctrl+V)', 'sp-holder', () => this.hooks.selectHolder(h)));
          const b = btn(HEXAGON, 'Back to text', 'sp-struct sp-part-struct', () => this.hooks.stepToText(id, k, p));
          b.setAttribute('aria-pressed', 'true');
          wrap.append(b);
        } else wrap.append(Object.assign(document.createElement('span'), { className: 'sp-fixed', textContent: 'structure', title: 'A drawn structure: edit it on the page (delete it there to type text instead)' }));
        return wrap;
      };
      const parts = round
        ? [part('inside', 'step name (OA)', 'Step name'), part('above', 'joins', 'What joins the cycle at this step, written outside its arrow'), part('below', 'leaves', 'What leaves the cycle at this step, written outside its arrow')]
        : [part('above', 'above the arrow', 'Above the arrow'), part('below', 'below the arrow', 'Below the arrow')];
      const box = document.createElement('div');
      box.className = 'sp-step-fields';
      box.append(...parts);
      step.append(arrow, box);
      return step;
    };
    const put = (...rows: (HTMLElement | null)[]) => { for (const r of rows) if (r) list.append(r); };
    if (!net) {
      read.slots.forEach((_, k) => {
        put(slotRow(k, read.chain));
        const at = read.links.findIndex((x) => x.from === k);
        if (at >= 0) put(stepRow(at, cycle));
      });
    } else this.netRows(id, read, { list, slotRow, stepRow, put, btn, field });
    this.el.append(list);
    const foot = document.createElement('div');
    foot.className = 'sp-foot';
    if (read.chain && !(cycle && read.closed)) foot.append(btn('+ Add Species', 'Add a species at the end, with an arrow to it', 'sp-add', () => this.hooks.add(id, read.slots.length - 1)));
    // a cycle takes more than species: another loop, or a species off the cycle
    if (cycle && !data.free && (net || (read.chain && read.closed))) {
      const add = btn('+ Add ▾', 'Add a species, a loop or an off-cycle species', 'sp-add sp-add-menu', () => this.addMenu(id, add, read));
      add.setAttribute('aria-haspopup', 'menu');
      foot.append(add);
    }
    const right = document.createElement('div');
    right.className = 'sp-foot-right';
    // a cycle drawn into a mess by hand: back onto one ellipse
    if (data.layout === 'cycle' && !data.free && read.closed && read.slots.length >= 3) right.append(btn('Clean Up', 'Clean Up Cycle: move the species onto one ellipse that fits where they are, with the arrows along it', 'sp-ungroup sp-cleanup', () => this.hooks.cleanUpCycle(id)));
    else if (net) right.append(btn('Clean Up', 'Clean Up Cycle: put every loop back on its circle, joined as they are', 'sp-ungroup sp-cleanup', () => this.hooks.cleanUpCycle(id)));
    right.append(btn('Ungroup', 'Make it ordinary structures, text and arrows again', 'sp-ungroup', () => this.hooks.ungroup(id)));
    foot.append(right);
    this.el.append(foot);
  }

  /**
   * The rows of a cycle of several loops: a heading for each loop (what is written in its middle,
   * add a species, take the loop out), its own species and steps under it, then the species off
   * the cycle. A loop joined at a species it shares starts with that species, to show where it leaves from.
   */
  private netRows(id: number, read: SmartRead, h: {
    list: HTMLElement;
    slotRow(k: number, drag: boolean): HTMLLIElement;
    stepRow(k: number, round: boolean): HTMLLIElement | null;
    put(...rows: (HTMLElement | null)[]): void;
    btn(label: string, title: string, cls: string, f: () => void): HTMLButtonElement;
    field(key: string, value: TextPart[], placeholder: string, label: string, done: (v: TextPart[]) => void): HTMLDivElement;
  }): void {
    const doc = this.hooks.doc(), net = read.net!;
    const middles = loopMiddles(doc, this.hooks.measure(), id, read);
    const heading = (text: string, tip: string): HTMLLIElement => {
      const li = document.createElement('li');
      li.className = 'sp-loop';
      const name = document.createElement('span');
      name.className = 'sp-loop-name';
      name.textContent = text;
      name.title = tip;
      li.append(name);
      return li;
    };
    const names = (ks: number[]) => ks.map((k) => k + 1).join(', ');
    net.loops.forEach((lp, i) => {
      const j = net.joins.find((x) => x.child === i);
      const how = !j ? 'The first loop' : j.kind === 'share' ? `Shares species ${j.node + 1} with loop ${j.parent + 1}` : j.kind === 'fused' ? `Shares species ${names(j.path)} with loop ${j.parent + 1}` : j.kind === 'mesh' ? `Turns with loop ${j.parent + 1} where two steps meet` : 'Beside the rest';
      const head = heading(`Loop ${i + 1}`, how);
      if (j && j.kind !== 'beside') {
        const tag = document.createElement('span');
        tag.className = 'sp-loop-how';
        tag.textContent = j.kind === 'mesh' ? `turns with loop ${j.parent + 1}` : `shares ${j.kind === 'share' ? j.node + 1 : `${j.path[0] + 1}–${j.path[j.path.length - 1] + 1}`}`;
        tag.title = how;
        head.append(tag);
      }
      const cap = middles[i] !== undefined ? doc.captions.get(middles[i]!) : undefined;
      const mid = h.field(`m${i}`, runParts(cap?.runs ?? []), 'middle', `Text in the middle of loop ${i + 1}`, (v) => this.hooks.loopMiddle(id, i, v));
      mid.classList.add('sp-loop-mid');
      mid.title = 'Written in the middle of the loop (the catalyst)';
      if (cap) this.rowOf.set(`m${i}`, `c${cap.id}`);
      head.append(mid);
      head.append(h.btn('+', `Add a species at the end of loop ${i + 1}`, 'sp-x sp-loop-add', () => this.hooks.add(id, lp.slots[lp.slots.length - 1], lp.links[lp.links.length - 1])));
      if (i > 0) head.append(h.btn('×', `Remove loop ${i + 1}`, 'sp-x', () => this.hooks.removeLoop(id, i)));
      h.put(head);
      // the species it shares with the loop it joins, where its own steps leave from
      const leaves = j?.kind === 'share' ? j.node : j?.kind === 'fused' ? j.path[j.path.length - 1] : undefined;
      if (leaves !== undefined) {
        const ref = document.createElement('li');
        ref.className = 'sp-slot sp-shared';
        const num = document.createElement('span');
        num.className = 'sp-num';
        num.textContent = String(leaves + 1);
        const name = Object.assign(document.createElement('span'), { className: 'sp-fixed', textContent: slotName(doc, read.slots[leaves]), title: `Species ${leaves + 1}, shared with loop ${j!.parent + 1}: change it there` });
        ref.append(num, name);
        h.put(ref, h.stepRow(lp.links[lp.slots.indexOf(leaves)], true));
      }
      for (const k of lp.own) h.put(h.slotRow(k, lp.own.length > 1), h.stepRow(lp.links[lp.slots.indexOf(k)], true));
    });
    if (net.tails.length) {
      h.put(heading('Off-Cycle', 'Species off the cycle: a precatalyst coming in, a resting state, a species going out'));
      for (const t of net.tails) t.slots.forEach((k, q) => {
        const row = h.slotRow(k, t.slots.length > 1);
        const l = read.links[t.links[q]];
        const tag = document.createElement('span');
        tag.className = 'sp-loop-how';
        const onto = l.from === k ? l.to : l.from;
        tag.textContent = l.arrow.equilibrium ? `⇌ ${onto + 1}` : l.from === k ? `→ ${onto + 1}` : `← ${onto + 1}`;
        tag.title = l.arrow.equilibrium ? `In equilibrium with species ${onto + 1}` : l.from === k ? `Leads to species ${onto + 1}` : `Comes from species ${onto + 1}`;
        row.insertBefore(tag, row.querySelector('.sp-struct, .sp-x'));
        h.put(row, h.stepRow(t.links[q], false));
      });
    }
  }

  /** What Add Loop and Add Off-Cycle Species offer for this cycle, starting at `at` (else where the caret is). */
  private loopAsk(read: SmartRead, at?: { slot?: number; step?: number }) {
    const doc = this.hooks.doc();
    const species = read.slots.map((sl, k) => ({ k, name: slotName(doc, sl) }));
    // what the caret is in (a species' row or a step's) is where the new thing goes
    const row = /^s(\d+)$/.exec(this.activeKey), stepRow = /^p(\d+)/.exec(this.activeKey);
    const step = at ? at.step : stepRow ? Number(stepRow[1]) : undefined;
    const slot = at?.slot ?? (step !== undefined ? read.links[step]?.from : row ? Number(row[1]) : undefined) ?? 0;
    const steps = read.links.map((l, k) => ({ k, from: l.from, to: l.to, name: stepParts(doc, l, 'inside').map((p) => p.text).join('') }));
    const loops = read.net ? read.net.loops.map((lp) => lp.slots) : [read.slots.map((_, i) => i)];
    // only steps round one loop (not ones two loops share, or a branch's) can have a loop turn with them
    const round = steps.filter((x) => loops.filter((lp) => lp.includes(x.from) && lp.includes(x.to)).length === 1 && !(read.net?.tails.some((t) => t.links.includes(x.k))));
    return { species, steps: round, loops, slot, step };
  }

  private openLoop(id: number, anchor: HTMLElement, read: SmartRead, at?: { slot?: number; step?: number }): void {
    void askLoop(anchor, this.loopAsk(read, at)).then((got) => { if (got) this.hooks.addLoop(id, got.join, got.count); });
  }

  private openBranch(id: number, anchor: HTMLElement, read: SmartRead, at?: { slot?: number; step?: number }): void {
    const { species, slot } = this.loopAsk(read, at);
    void askBranch(anchor, { species, slot }).then((got) => { if (got) this.hooks.addBranch(id, got.slot, got.dir); });
  }

  /**
   * Add Loop… or Add Off-Cycle Species… from a menu (a right-click on the cycle): the same
   * popout as the list's + Add opens, starting at the species or step that was clicked.
   * False when no cycle is showing.
   */
  ask(what: 'loop' | 'branch', at?: { slot?: number; step?: number }): boolean {
    const id = this.shown;
    if (id === null) return false;
    const read = readSmart(this.hooks.doc(), this.hooks.measure(), id);
    const data = this.hooks.doc().shapes.get(id)?.smart;
    if (!read || !data || smartLayoutOf(data, read) !== 'cycle' || smartIsFree(data, read) || !(read.net || (read.chain && read.closed))) return false;
    const anchor = this.el.querySelector<HTMLElement>('.sp-add-menu') ?? this.el;
    if (what === 'loop') this.openLoop(id, anchor, read, at); else this.openBranch(id, anchor, read, at);
    return true;
  }

  /** The cycle's + Add menu: a species, a loop, an off-cycle species. */
  private addMenu(id: number, anchor: HTMLElement, read: SmartRead): void {
    const { slot } = this.loopAsk(read);
    const r = anchor.getBoundingClientRect();
    popupMenu(r.left, r.bottom + 2, [
      // a species after the one the caret is in (a + on the page puts one on any step)
      ['Species', () => { const l = read.links.findIndex((x) => x.from === slot); this.hooks.add(id, slot, l >= 0 ? l : undefined); }],
      ['Loop…', () => this.openLoop(id, anchor, read)],
      ['Off-Cycle Species…', () => this.openBranch(id, anchor, read)],
    ]);
  }

  /** Dragging the title moves the list; let go at an edge of the drawing and it docks there, elsewhere it stays as a floating toolbox. */
  private wireDrag(head: HTMLElement): void {
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button') || e.button !== 0) return;
      e.preventDefault();
      // docked, the whole toolbox it sits in follows the pointer
      const box = this.host?.closest<HTMLElement>('.toolbox') ?? null;
      const r = (box ?? this.el).getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      let moved = false;
      head.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => {
        if (!moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < 4) return;
        moved = true;
        if (box) { box.style.transform = `translate(${Math.round(m.clientX - e.clientX)}px, ${Math.round(m.clientY - e.clientY)}px)`; box.style.zIndex = '50'; return; }
        this.el.style.left = `${Math.round(m.clientX - dx)}px`;
        this.el.style.top = `${Math.round(m.clientY - dy)}px`;
      };
      const up = (u: PointerEvent) => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        if (box) { box.style.transform = ''; box.style.zIndex = ''; }
        if (!moved) return;
        const w = this.hooks.work();
        const dock = dropTarget(u.clientX, u.clientY, { left: w.left, top: w.top, right: w.right, bottom: w.bottom });
        this.hooks.dock(dock === 'float' ? { dock, x: Math.round(u.clientX - dx), y: Math.round(u.clientY - dy) } : { dock });
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
  }

  /** Put the caret in the row of a species just added (all its text selected, to type over). */
  focusCaption(frame: number, caption: number): void {
    this.refresh();
    if (this.shown !== frame) return;
    const read = readSmart(this.hooks.doc(), this.hooks.measure(), frame);
    const k = read?.slots.findIndex((s) => s.caption === caption) ?? -1;
    this.fields.get(`s${k}`)?.focusAll();
  }

  /**
   * The formatting bar: subscript, superscript, chemical interpretation and symbols, for the row
   * being typed in. Its buttons keep the caret in the row.
   */
  private formatBar(btn: (label: string, title: string, cls: string, f: () => void) => HTMLButtonElement, gear: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    const bar = document.createElement('div');
    bar.className = 'sp-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Text formatting');
    const on = (f: (r: RichField) => void) => () => { const r = this.active; if (r && document.activeElement === r.el) f(r); };
    const sub = btn('X<sub>2</sub>', 'Subscript (Ctrl+=)', 'sp-fmt sp-sub', on((r) => r.toggle('sub')));
    const sup = btn('X<sup>2</sup>', 'Superscript (Ctrl+Shift+=)', 'sp-fmt sp-sup', on((r) => r.toggle('sup')));
    const chem = btn('Chem', 'Chemical interpretation: numbers in formulas become subscripts as you type (off: the text stays as typed)', 'sp-fmt sp-chem', () => {
      chemOn = !chemOn;
      try { localStorage.setItem('smartPaneChem', chemOn ? 'on' : 'off'); } catch { /* not kept */ }
      const r = this.active;
      if (r && document.activeElement === r.el) r.rechem();
      this.showState();
    });
    const gap = document.createElement('span');
    gap.className = 'sp-bar-gap';
    const sym = (c: string, name: string) => btn(c, `Insert ${name}`, 'sp-fmt sp-sym', on((r) => r.insert(c)));
    const more = btn('Ω ▾', 'Symbol… (Greek letters, arrows, charges and more)', 'sp-fmt sp-more', () => { this.symbols = !this.symbols; this.showState(); });
    bar.append(sub, sup, chem, gap, sym('‡', '‡ (transition state)'), sym('′', 'prime'), sym('°', 'degree sign'), sym('•', 'dot (radical)'), more, gear);
    const grid = document.createElement('div');
    grid.className = 'sp-symbols';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Symbols');
    for (const [c, name] of SYMBOLS) grid.append(sym(c, name));
    // pressing a button doesn't take the caret out of the row
    wrap.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
    wrap.append(bar, grid);
    this.bar = wrap;
    this.showState();
    return wrap;
  }

  /** The bar shows what is on where the caret is, and is usable only while a row is being typed in. */
  private showState(): void {
    const w = this.bar;
    if (!w) return;
    const r = this.active && document.activeElement === this.active.el ? this.active : null;
    for (const b of w.querySelectorAll<HTMLButtonElement>('.sp-sub, .sp-sup, .sp-sym')) b.disabled = !r;
    const press = (cls: string, v: boolean) => w.querySelector(cls)?.setAttribute('aria-pressed', String(v));
    press('.sp-sub', !!r?.state('sub'));
    press('.sp-sup', !!r?.state('sup'));
    press('.sp-chem', chemOn);
    press('.sp-more', this.symbols);
    w.querySelector<HTMLElement>('.sp-symbols')!.hidden = !this.symbols;
  }
}
