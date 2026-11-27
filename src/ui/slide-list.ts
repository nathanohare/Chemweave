// The slide list down the left of Slides mode, as in PowerPoint: a small picture of each
// slide. Click to edit a slide, Ctrl+click or Shift+click to pick several, drag to reorder,
// and Delete, Ctrl+D or Enter in the list to delete, duplicate or add slides. Ctrl+C, Ctrl+X
// and Ctrl+V copy, cut and paste whole slides (into this deck or another), and right-click
// opens the slide commands. Hidden slides (Hide Slide) are greyed, their numbers struck through.
//
// In a deck with sections each section has a heading: click its arrow to fold it, drag it to
// move the section with all its slides, double-click its name to rename it, right-click for the
// section commands. Slide Sorter is the same list in a grid of larger pictures (`grid`), where
// double-clicking a slide opens it in Normal view.
//
// A canvas slide's entry opens (its arrow) to a picture of each of its keyframes, in the order the
// show plays them: click one to go to it, drag one to play it at another place, Delete or
// right-click to take it away.

import { clockText } from '../deck/show-link';
import { EASE_OUT, fadeContent, motionMs, moving } from './motion';
import type { Deck } from '../deck/deck';
import { paintSlide } from '../deck/slide-view';
import { MASTER_PAGE } from '../deck/master-view';

export interface SlideListHooks {
  /** Edit slide i. */
  go(i: number): void;
  /** The slide list's own keys (Delete, Ctrl+D, Enter) and buttons. */
  remove(indices: number[]): void;
  duplicate(indices: number[]): void;
  add(): void;
  /** Ctrl+C, Ctrl+X and Ctrl+V on whole slides. */
  copy(indices: number[]): void;
  cut(indices: number[]): void;
  paste(): void;
  /** Right-click in the list (on a slide, or below the slides). */
  menu(x: number, y: number): void;
  /** Right-click on a section's heading. */
  sectionMenu?(x: number, y: number, section: number): void;
  /** Double-click a section's name. */
  renameSection?(section: number): void;
  /** Slide Sorter: double-click a slide (or Enter) to open it. */
  open?(i: number): void;
  /** The keyframes of the canvas slide being edited (Normal view's list only). */
  keyframe?: {
    /** The keyframe picked. */
    picked(): number;
    /** Go to keyframe k (on the slide being edited). */
    go(k: number): void;
    /** Play keyframe `from` at place `to` instead. */
    move(from: number, to: number): void;
    remove(k: number): void;
    menu(x: number, y: number): void;
  };
}

const SLIDES_TYPE = 'application/x-chem-illustrator-slides';
const SECTION_TYPE = 'application/x-chem-illustrator-section';
const KEYFRAME_TYPE = 'application/x-chem-illustrator-keyframe';

export interface SlideListOptions {
  /** Slide Sorter: rows of larger pictures. */
  grid?: boolean;
  /** Width of each picture, in pixels. */
  thumbW?: number;
}

/** A number for each object, to tell whether it is the same one (a drawing, a master) as when a picture was drawn. */
const ids = new WeakMap<object, number>();
let lastId = 0;
/**
 * JSON.stringify's replacer for a stamp: a long text (a picture background's data URL) stands for
 * itself by its length, its ends and a sample of the characters between, not whole (a stamp is
 * made for every slide on every rebuild).
 */
function shortLong(_k: string, v: unknown): unknown {
  if (typeof v !== 'string' || v.length <= 200) return v;
  let mid = 0;
  for (let k = 64; k < v.length - 64; k += 997) mid = (mid * 31 + v.charCodeAt(k)) | 0;
  return `${v.length}:${v.slice(0, 64)}:${mid}:${v.slice(-64)}`;
}

function identity(o: object): number {
  let n = ids.get(o);
  if (n === undefined) { n = ++lastId; ids.set(o, n); }
  return n;
}

/** Copy one painted picture onto another canvas; false when the browser has no canvas to copy with. */
function copyPicture(from: HTMLCanvasElement, to: HTMLCanvasElement): boolean {
  if (!from.width || !from.height) return false;
  const ctx = to.getContext('2d');
  if (!ctx) return false;
  to.width = from.width;
  to.height = from.height;
  ctx.drawImage(from, 0, 0);
  return true;
}

export class SlideList {
  private deck: Deck | null = null;
  /** Picked slides (by index), for deleting, duplicating or moving several. */
  picked = new Set<number>();
  private anchor = 0;
  private list: HTMLDivElement;
  /** Each slide's item (by index); slides in folded sections have none. */
  private items: (HTMLDivElement | undefined)[] = [];
  private heads: { el: HTMLDivElement; section: number; start: number }[] = [];
  private dragFrom: number[] | null = null;
  private dragSection: number | null = null;
  private dropMark: HTMLDivElement;
  private thumbTimer = 0;
  /** Slides whose pictures are to be redrawn when the timer runs out (F839). */
  private thumbPending = new Set<number>();
  /** Slides still to be painted after a rebuild or a repaint of every picture (a few at a time). */
  private paintQueue: number[] = [];
  private paintTimer = 0;
  /** What each slide's picture shows (by slide id), so a rebuild paints only the slides that changed (F185). */
  private painted = new Map<number, { stamp: string; thumb: HTMLCanvasElement; keys: Map<number, HTMLCanvasElement> }>();
  /** The slide whose section was last opened for it (a folded section opens when its slide is gone to). */
  private openedFor: { deck: Deck | null; slide: object | null } = { deck: null, slide: null };
  private grid: boolean;
  thumbW: number;
  /** Canvas slides (by id) whose keyframes are folded away in the list. */
  private keysFolded = new Set<number>();
  /** Each canvas slide's keyframe pictures (by slide index), when open. */
  private keyLists = new Map<number, HTMLDivElement>();

  constructor(private el: HTMLElement, private hooks: SlideListHooks, opts: SlideListOptions = {}) {
    this.grid = !!opts.grid;
    this.thumbW = opts.thumbW ?? 168;
    this.list = document.createElement('div');
    this.list.className = this.grid ? 'sl-list sl-grid' : 'sl-list';
    this.list.tabIndex = 0;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', this.grid ? 'Slide Sorter' : 'Slides');
    this.list.setAttribute('aria-multiselectable', 'true');
    this.dropMark = document.createElement('div');
    this.dropMark.className = 'sl-drop';
    this.dropMark.hidden = true;
    if (this.grid) el.replaceChildren(this.list);
    else {
      const add = document.createElement('button');
      add.className = 'sl-add';
      add.type = 'button';
      add.textContent = '+ New Slide';
      add.addEventListener('click', () => hooks.add());
      el.replaceChildren(this.list, add);
    }
    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const head = (e.target as HTMLElement).closest<HTMLElement>('.sl-sec');
      if (head && hooks.sectionMenu) { this.list.focus(); hooks.sectionMenu(e.clientX, e.clientY, Number(head.dataset.section)); return; }
      // a right-click on a slide that isn't picked picks it alone, as a click would
      const item = (e.target as HTMLElement).closest<HTMLElement>('.sl-item');
      const i = item ? Number(item.dataset.i) : -1;
      if (i >= 0 && !this.picked.has(i)) this.onClick(new MouseEvent('click'), i);
      this.list.focus();
      hooks.menu(e.clientX, e.clientY);
    });
    this.list.addEventListener('dragover', (e) => this.onDragOver(e));
    this.list.addEventListener('drop', (e) => this.onDrop(e));
    this.list.addEventListener('dragleave', (e) => {
      if (!this.list.contains(e.relatedTarget as Node)) this.dropMark.hidden = true;
    });
  }

  /** Show this deck's slides (or none). */
  show(deck: Deck | null): void {
    this.deck = deck;
    this.painted.clear();
    this.picked = new Set(deck ? [deck.index] : []);
    this.anchor = deck?.index ?? 0;
    this.rebuild();
  }

  /** The slides were added, removed, reordered or switched. */
  rebuild(): void {
    const deck = this.deck;
    if (!deck) { this.list.replaceChildren(); this.items = []; this.heads = []; return; }
    const add = this.el.querySelector<HTMLButtonElement>('.sl-add');
    if (add) add.textContent = deck.inMasterView ? '+ Insert Layout' : '+ New Slide';
    this.list.setAttribute('aria-label', deck.inMasterView ? 'Slide Master and layouts' : this.grid ? 'Slide Sorter' : 'Slides');
    // keep picked slides that still exist, and always the one being edited
    this.picked = new Set([...this.picked].filter((i) => i < deck.slides.length));
    if (!this.picked.has(deck.index)) this.picked = new Set([deck.index]);
    // going to a slide that sits in a folded section opens the section, but only then: the
    // section holding the slide being edited can be folded like any other (F838)
    // (the slide itself is remembered, not its number: deleting a slide before it moves its number)
    if (this.openedFor.deck !== deck || this.openedFor.slide !== deck.slides[deck.index]) {
      this.openedFor = { deck, slide: deck.slides[deck.index] ?? null };
      const curSec = deck.slides[deck.index]?.section;
      if (curSec !== undefined) deck.folded.delete(curSec);
    }
    const kids: HTMLElement[] = [];
    this.items = [];
    this.heads = [];
    this.keyLists.clear();
    const spans = deck.sections.length ? deck.sectionSpans() : [{ section: null, start: 0, count: deck.slides.length }];
    for (const sp of spans) {
      const folded = !!sp.section && deck.folded.has(sp.section.id);
      if (sp.section) {
        const head = this.heading(sp.section.id, sp.section.name, sp.count, folded, sp.start);
        kids.push(head);
      }
      if (folded) continue;
      for (let i = sp.start; i < sp.start + sp.count; i++) {
        const item = this.item(deck, i);
        this.items[i] = item;
        kids.push(item);
        const keys = this.keyList(deck, i);
        if (keys) kids.push(keys);
      }
    }
    // where each slide was, to move the rest smoothly when slides are reordered, and fade in the ones added
    const before = this.shownDeck === deck ? this.shownAt : null;
    const was = new Map<string, DOMRect>();
    if (before && moving()) for (const [id, el] of before) if (el.isConnected) was.set(id, el.getBoundingClientRect());
    this.list.replaceChildren(...kids, this.dropMark);
    this.mark();
    this.paintAll(false);
    this.items[deck.index]?.scrollIntoView({ block: 'nearest' });
    const now = new Map<string, HTMLElement>();
    deck.slides.forEach((sl, i) => { if (this.items[i]) now.set(String(sl.id), this.items[i]); });
    if (before && was.size) {
      const sameSlides = now.size === before.size && [...now.keys()].every((id) => before.has(id));
      for (const [id, el] of now) {
        const a = was.get(id);
        if (!a) { fadeContent(el); continue; }
        if (!sameSlides) continue;
        const b = el.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
        if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: motionMs('std'), easing: EASE_OUT });
      }
    }
    this.shownDeck = deck;
    this.shownAt = now;
  }

  /** The deck last listed and each of its slides' items (by slide id), for the moves above. */
  private shownDeck: Deck | null = null;
  private shownAt = new Map<string, HTMLElement>();

  private heading(id: number, name: string, count: number, folded: boolean, start: number): HTMLDivElement {
    const head = document.createElement('div');
    head.className = folded ? 'sl-sec folded' : 'sl-sec';
    head.dataset.section = String(id);
    head.draggable = true;
    head.setAttribute('role', 'group');
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'sl-sec-fold';
    fold.textContent = folded ? '▸' : '▾';
    fold.title = folded ? 'Show this section\'s slides' : 'Collapse Section';
    fold.setAttribute('aria-expanded', String(!folded));
    fold.addEventListener('click', (e) => { e.stopPropagation(); this.deck?.fold(id, !folded); });
    const label = document.createElement('span');
    label.className = 'sl-sec-name';
    label.textContent = name;
    label.title = 'Double-click to rename; drag to move the section with its slides; right-click for more';
    label.addEventListener('dblclick', (e) => { e.stopPropagation(); this.hooks.renameSection?.(id); });
    const n = document.createElement('span');
    n.className = 'sl-sec-count';
    n.textContent = `(${count})`;
    head.append(fold, label, n);
    // a click on the heading picks the section's slides, as in PowerPoint
    head.addEventListener('click', () => {
      const deck = this.deck;
      if (!deck || !count) return;
      this.picked = new Set(Array.from({ length: count }, (_, k) => start + k));
      this.anchor = start;
      // (going to the section's first slide is picking the section, not opening it: a folded one stays folded)
      if (!this.picked.has(deck.index)) { this.openedFor = { deck, slide: deck.slides[start] ?? null }; this.hooks.go(start); }
      this.mark();
      this.list.focus();
    });
    head.addEventListener('dragstart', (e) => {
      this.dragSection = id;
      this.dragFrom = null;
      e.dataTransfer?.setData(SECTION_TYPE, String(id));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    head.addEventListener('dragend', () => { this.dragSection = null; this.dropMark.hidden = true; });
    this.heads.push({ el: head, section: id, start });
    return head;
  }

  private item(deck: Deck, i: number): HTMLDivElement {
    const s = deck.slides[i];
    const item = document.createElement('div');
    item.className = s.hidden ? 'sl-item is-hidden' : 'sl-item';
    // Slide Master view: the master, with its layouts under it (each with how many slides use it)
    const master = deck.inMasterView;
    item.draggable = !master;
    item.setAttribute('role', 'option');
    item.dataset.i = String(i);
    const num = document.createElement('span');
    num.className = 'sl-num';
    num.textContent = master ? (s.layout === MASTER_PAGE ? '1' : '') : String(i + 1);
    if (master) {
      const def = deck.pageLayout(i);
      item.classList.add(def ? 'sl-layout' : 'sl-master');
      item.title = def ? `${def.name} Layout: used by ${deck.layoutUses(def.id)} slide${deck.layoutUses(def.id) === 1 ? '' : 's'}` : 'Slide Master: every layout starts from it';
      item.setAttribute('aria-label', def ? `${def.name} Layout` : 'Slide Master');
      if (def) {
        const n = document.createElement('span');
        n.className = 'sl-uses';
        n.textContent = String(deck.layoutUses(def.id));
        item.append(n);
      }
    }
    if (s.hidden) num.title = 'Hidden: the slide show skips it (Hide Slide to show it again)';
    const canvas = document.createElement('canvas');
    canvas.className = 'sl-thumb';
    const tw = this.wOf(i);
    const h = Math.round((tw * deck.size.h) / deck.size.w);
    canvas.style.width = `${tw}px`;
    canvas.style.height = `${h}px`;
    item.append(num, canvas);
    if (s.canvas && this.hooks.keyframe && !this.grid) {
      const open = !this.keysFolded.has(s.id);
      const fold = document.createElement('button');
      fold.type = 'button';
      fold.className = 'sl-keys-fold';
      fold.textContent = open ? '▾' : '▸';
      fold.title = open ? 'Collapse this canvas slide\'s keyframes' : 'Show this canvas slide\'s keyframes';
      fold.setAttribute('aria-expanded', String(open));
      fold.addEventListener('click', (e) => {
        e.stopPropagation();
        if (open) this.keysFolded.add(s.id); else this.keysFolded.delete(s.id);
        this.rebuild();
      });
      item.classList.add('is-canvas');
      item.append(fold);
    }
    if (s.notes.trim()) {
      const n = document.createElement('span');
      n.className = 'sl-has-notes';
      n.title = 'This slide has speaker notes';
      n.textContent = '✎';
      item.append(n);
    }
    // a rehearsed time (and recorded narration), under the number, as PowerPoint's Slide Sorter shows them
    const t = s.transition?.advanceAfter;
    const narrated = deck.narrated(i);
    if (t !== undefined || narrated) {
      const n = document.createElement('span');
      n.className = 'sl-time';
      n.textContent = `${t !== undefined ? clockText(t) : ''}${narrated ? (t !== undefined ? ' 🎙' : '🎙') : ''}`;
      n.title = [t !== undefined ? `Advances automatically after ${clockText(t)} (Rehearse Timings, or Transitions ▸ After)` : '', narrated ? 'Has recorded narration (Slide Show ▸ Record)' : ''].filter(Boolean).join('. ');
      item.append(n);
    }
    item.addEventListener('click', (e) => this.onClick(e, i));
    if (this.hooks.open) item.addEventListener('dblclick', () => this.hooks.open!(i));
    item.addEventListener('dragstart', (e) => this.onDragStart(e, i));
    item.addEventListener('dragend', () => { this.dragFrom = null; this.dropMark.hidden = true; });
    return item;
  }

  /** A canvas slide's keyframe pictures under its entry (none when folded, or not a canvas slide). */
  private keyList(deck: Deck, i: number): HTMLDivElement | null {
    const s = deck.slides[i], kf = this.hooks.keyframe;
    if (!s.canvas || !kf || this.grid || this.keysFolded.has(s.id)) return null;
    const list = document.createElement('div');
    list.className = 'sl-keys';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', `Keyframes of slide ${i + 1}`);
    const w = this.keyW(), h = Math.round((w * deck.size.h) / deck.size.w);
    // go to the slide first, then to its keyframe
    const go = (k: number) => { if (deck.index !== i) this.hooks.go(i); kf.go(k); };
    s.canvas.keys.forEach((_, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sl-key';
      b.dataset.k = String(k);
      b.draggable = true;
      b.title = `Keyframe ${k + 1}: click to go to it, drag to play it at another place, right-click for more`;
      const n = document.createElement('span');
      n.className = 'sl-key-num';
      n.textContent = String(k + 1);
      const c = document.createElement('canvas');
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      b.append(n, c);
      b.addEventListener('click', (e) => { e.stopPropagation(); go(k); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); go(k); kf.menu(e.clientX, e.clientY); });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        e.preventDefault();
        e.stopPropagation();
        go(k);
        kf.remove(k);
      });
      b.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer?.setData(KEYFRAME_TYPE, `${s.id}:${k}`);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      b.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes(KEYFRAME_TYPE)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
      });
      b.addEventListener('drop', (e) => {
        const [sid, from] = (e.dataTransfer?.getData(KEYFRAME_TYPE) ?? '').split(':').map(Number);
        if (sid !== s.id || !Number.isFinite(from)) return;
        e.preventDefault();
        e.stopPropagation();
        if (deck.index !== i) this.hooks.go(i);
        if (from !== k) kf.move(from, k);
      });
      list.append(b);
    });
    this.keyLists.set(i, list);
    return list;
  }

  /** Width of slide i's picture: a layout's is indented under the master in Slide Master view. */
  private wOf(i: number): number {
    const d = this.deck;
    return d?.inMasterView && d.pageLayout(i) && !this.grid ? Math.max(48, this.thumbW - 16) : this.thumbW;
  }

  /** Width of a keyframe's picture, in pixels. */
  private keyW(): number {
    return Math.max(48, Math.round(this.thumbW * 0.72));
  }

  /** The keyframe picked on the slide being edited is marked in its list. */
  markKeyframe(): void {
    const deck = this.deck;
    const k = this.hooks.keyframe?.picked() ?? -1;
    for (const [i, list] of this.keyLists) {
      for (const b of list.querySelectorAll<HTMLElement>('.sl-key')) b.classList.toggle('current', i === deck?.index && Number(b.dataset.k) === k);
    }
  }

  /** Another slide is being edited: only the marks move (the pictures stay as they are). */
  switched(): void {
    const deck = this.deck;
    if (!deck) return;
    if (!this.items[deck.index]) { this.rebuild(); return; }
    // the slide gone to has its picture in the list: its section is as open or folded as it is
    this.openedFor = { deck, slide: deck.slides[deck.index] ?? null };
    if (!this.picked.has(deck.index)) this.picked = new Set([deck.index]);
    this.mark();
    this.items[deck.index]?.scrollIntoView({ block: 'nearest' });
  }

  private mark(): void {
    const deck = this.deck;
    this.items.forEach((it, i) => {
      if (!it) return;
      it.classList.toggle('current', i === deck?.index);
      it.classList.toggle('picked', this.picked.has(i));
      it.setAttribute('aria-selected', String(this.picked.has(i)));
    });
    this.markKeyframe();
  }

  /** The list got wider or narrower: the pictures take the new width at once, and are painted sharp again with `paint`. */
  setThumbW(w: number, paint = false): void {
    this.thumbW = w;
    const deck = this.deck;
    if (!deck) return;
    this.items.forEach((it, i) => {
      const c = it?.querySelector('canvas');
      const tw = this.wOf(i), h = Math.round((tw * deck.size.h) / deck.size.w);
      if (c) { c.style.width = `${tw}px`; c.style.height = `${h}px`; }
    });
    if (paint) this.refreshAll();
  }

  /**
   * Redraw one slide's picture (soon, for the slide being edited, so typing stays quick). Slides
   * edited within the wait are all redrawn when it is over, not just the last one (F839).
   */
  refresh(i = this.deck?.index ?? 0, soon = true): void {
    if (!soon) { this.paint(i, true); return; }
    this.thumbPending.add(i);
    clearTimeout(this.thumbTimer);
    this.thumbTimer = window.setTimeout(() => {
      const list = [...this.thumbPending];
      this.thumbPending.clear();
      for (const k of list) this.paint(k, true);
    }, 250);
  }

  /**
   * Redraw every slide's picture (after the master changed, or a picture loaded). Asking again
   * before they are drawn starts the one run over, so a picture loading after another does not
   * draw every slide once for each (F186).
   */
  refreshAll(): void {
    if (!this.deck) return;
    this.paintAll(true);
  }

  /** Paint the slides again: the one being edited at once, the others a few at a time so the list stays quick. */
  private paintAll(force: boolean): void {
    const deck = this.deck;
    if (!deck) return;
    if (force) this.painted.clear();
    const ids = new Set(deck.slides.map((s) => s.id));
    for (const id of [...this.painted.keys()]) if (!ids.has(id)) this.painted.delete(id);
    const rest: number[] = [];
    for (let i = 0; i < deck.slides.length; i++) if (i !== deck.index) rest.push(i);
    this.paintQueue = rest;
    if (!force) {
      this.paint(deck.index);
      this.runQueue();
      return;
    }
    // every picture is out of date: they are drawn from the next frame on, once however often this is asked for
    this.paintQueue.unshift(deck.index);
    if (this.paintTimer) this.cancelFrame(this.paintTimer);
    this.paintTimer = this.nextFrame(() => { this.paintTimer = 0; this.runQueue(); });
  }

  private runQueue(): void {
    if (this.paintTimer) { this.cancelFrame(this.paintTimer); this.paintTimer = 0; }
    const t0 = performance.now();
    while (this.paintQueue.length) {
      this.paint(this.paintQueue.shift()!);
      // a slide that is only copied from its last picture takes no time; a painted one takes its share of the frame
      if (performance.now() - t0 > 8) break;
    }
    if (this.paintQueue.length) this.paintTimer = this.nextFrame(() => { this.paintTimer = 0; this.runQueue(); });
  }

  private nextFrame(f: () => void): number {
    return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : window.setTimeout(f, 16);
  }

  private cancelFrame(id: number): void {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id);
  }

  /** Everything that decides how slide i's picture looks, as text: the same text, the same picture. */
  private stampOf(i: number): string {
    const deck = this.deck!;
    const page = deck.page(i);
    const doc = deck.docOf(i);
    const { size: _size, master, ...rest } = page;
    return [identity(doc), doc.version, identity(master), deck.size.w, deck.size.h, this.wOf(i), this.keyW(), window.devicePixelRatio || 1, JSON.stringify(rest, shortLong), deck.slides[i].layout].join('|');
  }

  private paint(i: number, force = false): void {
    const deck = this.deck;
    const item = this.items[i];
    if (!deck || !item || !deck.slides[i]) return;
    const canvas = item.querySelector('canvas')!;
    const tw = this.wOf(i), h = Math.round((tw * deck.size.h) / deck.size.w);
    const dpr = window.devicePixelRatio || 1;
    const id = deck.slides[i].id;
    const stamp = this.stampOf(i);
    const was = this.painted.get(id);
    const keys = this.keyLists.get(i);
    const keyCanvases = new Map<number, HTMLCanvasElement>();
    if (keys) for (const c of keys.querySelectorAll('canvas')) keyCanvases.set(Number((c.parentElement as HTMLElement).dataset.k), c);
    // the same slide looking the same as when it was last drawn (a rebuild moved or folded the list): copy its picture
    if (!force && was && was.stamp === stamp && (was.thumb === canvas || copyPicture(was.thumb, canvas)) && [...keyCanvases].every(([k, c]) => {
      const old = was.keys.get(k);
      return !!old && (old === c || copyPicture(old, c));
    })) {
      this.painted.set(id, { stamp, thumb: canvas, keys: keyCanvases });
      return;
    }
    paintSlide(canvas, tw, h, dpr, deck.page(i), deck.docOf(i));
    if (keys) {
      const w = this.keyW(), kh = Math.round((w * deck.size.h) / deck.size.w);
      for (const [k, c] of keyCanvases) {
        c.style.width = `${w}px`;
        c.style.height = `${kh}px`;
        paintSlide(c, w, kh, dpr, deck.page(i, k), deck.docOf(i));
      }
    }
    this.painted.set(id, { stamp, thumb: canvas, keys: keyCanvases });
  }

  // ---------------------------------------------------------------- picking

  private onClick(e: MouseEvent, i: number): void {
    const deck = this.deck;
    if (!deck) return;
    if (e.shiftKey) {
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      this.picked = new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (e.ctrlKey || e.metaKey) {
      if (this.picked.has(i) && this.picked.size > 1) this.picked.delete(i);
      else this.picked.add(i);
      this.anchor = i;
    } else {
      this.picked = new Set([i]);
      this.anchor = i;
    }
    if (i !== deck.index && this.picked.has(i)) this.hooks.go(i);
    this.mark();
    this.list.focus();
  }

  /** The picked slides, in order (the slide being edited when nothing else is picked). */
  pickedList(): number[] {
    const deck = this.deck;
    if (!deck) return [];
    const list = [...this.picked].filter((i) => i < deck.slides.length).sort((a, b) => a - b);
    return list.length ? list : [deck.index];
  }

  private onKey(e: KeyboardEvent): void {
    const deck = this.deck;
    if (!deck) return;
    const go = (i: number) => {
      i = Math.max(0, Math.min(deck.slides.length - 1, i));
      this.picked = new Set([i]);
      this.anchor = i;
      this.hooks.go(i);
      this.mark();
      this.items[i]?.scrollIntoView({ block: 'nearest' });
    };
    // the next slide that shows (slides in folded sections are passed over)
    const step = (d: 1 | -1) => {
      let i = deck.index + d;
      while (i >= 0 && i < deck.slides.length && !this.items[i]) i += d;
      if (i >= 0 && i < deck.slides.length) go(i);
    };
    // in the grid, up and down go a row at a time
    const perRow = this.grid ? Math.max(1, Math.floor(this.list.clientWidth / (this.thumbW + 40))) : 1;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === 'ArrowDown' && perRow === 1)) step(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === 'ArrowUp' && perRow === 1)) step(-1);
    else if (e.key === 'ArrowDown') go(deck.index + perRow);
    else if (e.key === 'ArrowUp') go(deck.index - perRow);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(deck.slides.length - 1);
    else if (e.key === 'Delete' || e.key === 'Backspace') this.hooks.remove(this.pickedList());
    else if (ctrl && e.key.toLowerCase() === 'd') this.hooks.duplicate(this.pickedList());
    else if (ctrl && e.key.toLowerCase() === 'c') this.hooks.copy(this.pickedList());
    else if (ctrl && e.key.toLowerCase() === 'x') this.hooks.cut(this.pickedList());
    else if (ctrl && e.key.toLowerCase() === 'v') this.hooks.paste();
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = (this.items[deck.index] ?? this.list).getBoundingClientRect();
      this.hooks.menu(r.left + 24, r.top + 24);
    }
    else if (e.key === 'Enter' && this.hooks.open) this.hooks.open(deck.index);
    else if (e.key === 'Enter') this.hooks.add();
    else if (ctrl && e.key.toLowerCase() === 'a') { this.picked = new Set(deck.slides.map((_, i) => i)); this.mark(); }
    else return;
    // these keys are the list's, not the drawing's
    e.preventDefault();
    e.stopPropagation();
  }

  /** True when keys should go to the slide list (it has the focus). */
  get focused(): boolean {
    return this.el.contains(document.activeElement);
  }

  /** Put the keyboard focus in the list. */
  focus(): void {
    this.list.focus();
  }

  // ---------------------------------------------------------------- dragging to reorder

  private onDragStart(e: DragEvent, i: number): void {
    if (!this.picked.has(i)) { this.picked = new Set([i]); this.anchor = i; this.mark(); }
    this.dragFrom = this.pickedList();
    this.dragSection = null;
    e.dataTransfer?.setData(SLIDES_TYPE, this.dragFrom.join(','));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  /**
   * Where a drop at this point goes: before slide `at` (counted in the full list), or onto a
   * section's heading (its slides then go at the start of that section).
   */
  private dropAt(x: number, y: number): { at: number; section?: number; mark: { x: number; y: number; vertical: boolean } } {
    const deck = this.deck!;
    const lr = this.list.getBoundingClientRect();
    const local = (px: number, py: number) => ({ x: px - lr.left + this.list.scrollLeft, y: py - lr.top + this.list.scrollTop });
    for (const h of this.heads) {
      const r = h.el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return { at: h.start, section: h.section, mark: { ...local(r.left, r.bottom + 2), vertical: false } };
    }
    // the nearest slide showing, and which side of it
    let best: { i: number; r: DOMRect; d: number } | null = null;
    this.items.forEach((it, i) => {
      if (!it) return;
      const r = it.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (!best || d < best.d) best = { i, r, d };
    });
    if (!best) return { at: deck.slides.length, mark: { ...local(lr.left, lr.top), vertical: false } };
    const { i, r } = best as { i: number; r: DOMRect };
    if (this.grid) {
      const after = x > r.left + r.width / 2;
      return { at: after ? i + 1 : i, mark: { ...local(after ? r.right + 6 : r.left - 6, r.top), vertical: true } };
    }
    const after = y > r.top + r.height / 2;
    return { at: after ? i + 1 : i, mark: { ...local(r.left, after ? r.bottom + 4 : r.top - 4), vertical: false } };
  }

  private onDragOver(e: DragEvent): void {
    if (!this.dragFrom && this.dragSection === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const d = this.dropAt(e.clientX, e.clientY);
    const m = this.dropMark;
    m.classList.toggle('vertical', d.mark.vertical);
    if (d.mark.vertical) {
      m.style.left = `${d.mark.x}px`;
      m.style.top = `${d.mark.y}px`;
      m.style.height = `${Math.round((this.thumbW * (this.deck?.size.h ?? 9)) / (this.deck?.size.w ?? 16))}px`;
    } else {
      m.style.left = '';
      m.style.height = '';
      m.style.top = `${d.mark.y}px`;
    }
    m.hidden = false;
  }

  private onDrop(e: DragEvent): void {
    const deck = this.deck;
    const from = this.dragFrom;
    const sec = this.dragSection;
    this.dropMark.hidden = true;
    if (!deck || (!from && sec === null)) return;
    e.preventDefault();
    const d = this.dropAt(e.clientX, e.clientY);
    this.dragFrom = null;
    this.dragSection = null;
    if (sec !== null) {
      // let go over its own heading: it stays where it is (F187)
      if (d.section === sec) return;
      // a section dropped: it goes before the section the drop point is in (or after the last)
      const spans = deck.sectionSpans().filter((x) => x.section.id !== sec);
      let to = spans.length;
      if (d.section !== undefined) to = spans.findIndex((x) => x.section.id === d.section);
      else {
        const k = spans.findIndex((x) => d.at <= x.start);
        if (k >= 0) to = k;
      }
      deck.moveSection(sec, Math.max(0, to));
      return;
    }
    // the position among the slides that stay put
    const to = d.at - from!.filter((i) => i < d.at).length;
    const slides = from!.map((i) => deck.slides[i]);
    deck.move(from!, to, d.section);
    // the moved slides stay picked, in their new places
    const moved = new Set(slides.map((s) => deck.slides.indexOf(s)));
    if (moved.has(deck.index)) { this.picked = moved; this.mark(); }
  }
}
