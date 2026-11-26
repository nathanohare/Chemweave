// The SI Project tab's Live Preview: the whole SI as it compiles, beside the SI page, where it
// can be read and typed into as in Word.
//
//   - The page chosen in the list is in view, everything else washed out lightly, a crimson bar
//     beside it; clicking text in the preview chooses its page in the list.
//   - Hovering a field on the SI page lights up the text it makes here, and hovering text here
//     lights up its field (source-map.ts says where each stretch came from).
//   - Typing into a field's text changes the field (one step of Undo, the project's); text the
//     program makes ("calcd for …") can't be typed into: a click goes to its field. Text typed
//     where no field is is the person's own (custom-text.ts), kept in its place and flagged.

import { DocView, HIDE_SPACE_CURSOR, SHOW_SPACE_CURSOR, type TextMarks } from './doc-view';
import { DocFile } from '../document/doc-file';
import type { DocText } from '../document/document';
import * as rt from '../richtext';
import type { TextRun } from '../model';
import type { CompiledSi, SiStructureRef } from '../si/compile-doc';
import { blockAt, editableSrc, fieldOfSrc, pageToFollow, readingLine, spanAt, type SourceBlock, type SourceSpan } from '../si/source-map';
import { applyToRaw, customIdOf, customSrc, editKind, locateEdit, isCustomSrc, markupSrc, printedOf } from '../si/preview-edit';
import { customAnchor, newCustomId, type CustomText, type PlacedCustom } from '../si/custom-text';
import { siPreviewPrefs } from './mode-prefs';

/** The SI accent (the bar beside the page chosen, a field's text). */
const CRIMSON = '#b4234f';
const CRIMSON_TINT = 'rgba(180, 35, 79, 0.16)';
const LOCKED = '#5f6570';
const CUSTOM = '#c27a00';

/** Said when typing, pasting or cutting while a structure or figure is selected. */
const PICKED_TYPING = 'Click in the text to type there: a structure or figure is selected.';

export interface SiPreviewHost {
  flash(message: string, ms?: number): void;
  /** Choose a page of the list (text clicked in the preview). */
  pick(node: string): void;
  /** Light up (or stop lighting up) the field a stretch of the preview came from. */
  hoverSource(src: string | null): void;
  /** Go to the field (or setting) that makes some text. */
  goToSource(src: string): void;
  /** The field's name, as the SI page shows it ("HRMS"). */
  labelOf(src: string): string;
  /** A field's stored value, in the project the text shown was compiled from (`owner`). */
  read(src: string, owner: unknown): Promise<string | null>;
  /** Write a field's new stored value: one step of Undo. */
  write(src: string, text: string, owner: unknown): Promise<void>;
  /** Save the person's own text (all of it). */
  writeCustom(change: (items: CustomText[]) => CustomText[], owner: unknown): Promise<void>;
  undo(redo: boolean): void;
  /** Compile again (after a write that failed: the stored text is shown again). */
  refresh(): void;
  /** A compound's structure or a figure picked in the preview, by its placement key (si/placement.ts; null: none now): its Picture Format tab shows. */
  structureChosen(key: string | null): void;
  /** Right-click on a compound's structure or a figure (picked first): its menu at the pointer. */
  structureMenu(key: string, x: number, y: number): void;
}

/** What is being shown: the whole SI (which can be typed into), or the Spectra section's pages. */
export interface ShownSi {
  compiled: Pick<CompiledSi, 'doc' | 'sources' | 'blocks' | 'custom'> & { structures?: SiStructureRef[] };
  key: string;
  editable: boolean;
  /** Why it can't be typed into (said when someone tries). */
  why?: string;
  /** What it was compiled from (the project): what is typed is written there, whatever shows by then. */
  owner: unknown;
  /** `generation` when the compile started: older than the typing since, it isn't shown (the typing would go). */
  gen?: number;
}

const ctrlKeyOf = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey || e.altKey;

/** Waiting this long after the last key before a field is written (a burst of typing is one step of Undo). */
const WRITE_AFTER = 700;
/** Synchronous Scrolling: waiting this long after the person stops scrolling before the page it rests on is followed. */
const SCROLL_SETTLE = 450;
/** Where in the window the page being read is taken to be (a third of the way down), and how far either side of it the page chosen still counts as read (hysteresis). */
const READ_AT = 0.3;
const READ_BAND = 0.12;

export class SiPreview {
  readonly view: DocView;
  private file: DocFile | null = null;
  private readonly ta: HTMLTextAreaElement;
  private key = '';
  private editable = false;
  private why = '';
  private owner: unknown = null;
  /** The text as compiled, and where its stretches came from then. */
  private base = { text: '', spans: [] as SourceSpan[] };
  /** Where the stretches are now (moved by what was typed since). */
  private spans: SourceSpan[] = [];
  private blocks: SourceBlock[] = [];
  private custom: PlacedCustom[] = [];
  /** Fields and custom text typed into and not written yet. */
  private dirty = new Set<string>();
  /** A field written since the text was compiled: its printed text and stored value then (the next write starts from them). */
  private written = new Map<string, { printed: string; raw: string }>();
  /** Custom text started here, not saved yet. */
  private fresh = new Map<string, Omit<CustomText, 'text'>>();
  private writeTimer = 0;
  private writing: Promise<void> = Promise.resolve();
  /** A newer compile that came while typing: shown once the typing is written. */
  private waiting: ShownSi | null = null;
  /** Edits let through so far, and how many of them were written (or on their way, in the project's queue). */
  private editGen = 0;
  private writtenGen = 0;
  /** Fields being written now: a compile that comes waits. */
  private busy = false;
  /** Custom text taken out to nothing (and so out of the file): put back where it was if typed again. */
  private gone = new Map<string, CustomText>();
  /** The page chosen in the list. */
  private focusNode: string | null = null;
  /** The field lit up from the SI page (a source, or a field: "c:<id>|yield"). */
  private litFromPage: string | null = null;
  /** The stretch under the pointer. */
  private hovered: SourceSpan | null = null;
  /** The last edit's kind, from the guard to the change it lets through. */
  private allowed: ReturnType<typeof editKind> | null = null;
  private caretOn = true;
  private blink = 0;
  private drag: { from: number } | null = null;
  /** The compounds' structures and the figures in the text shown, and the one picked, by its placement key (it stays picked through a compile). */
  private structures: SiStructureRef[] = [];
  private pickedStructure: string | null = null;
  private downAt: { x: number; y: number; src: string | null } | null = null;

  /**
   * Called a little after the person stops scrolling the preview (the wheel, the scrollbar, keys,
   * touch), never after it scrolls by itself (a page chosen, a compile shown): Synchronous Scrolling.
   */
  onScrollSettled: (() => void) | null = null;
  /** When the person last scrolled (wheel, keys, touch, or the scrolling that follows from them), and whether a button is held on the preview (dragging its scrollbar). */
  private userScrollAt = -Infinity;
  private pressed = false;
  /** The page at the reading line when the person first scrolled since `fromFor` was chosen (what a follow is measured from). */
  private from: string | null = null;
  private fromFor: string | null | undefined = undefined;
  /** The preview scrolled while a button was held (the scrollbar dragged, a selection dragged past the edge). */
  private movedWhilePressed = false;
  private settleTimer = 0;

  constructor(readonly host: HTMLElement, private readonly api: SiPreviewHost) {
    this.view = new DocView(host);
    this.view.overlay = () => this.overlay();
    // Page Width fills the pane, with no grey beside the pages, and is kept as the pane is resized
    this.view.padX = 0;
    this.view.fitSlack = 0;
    this.view.stickyFit = true;
    this.view.hideSpace = !siPreviewPrefs.whiteSpace;
    this.ta = document.createElement('textarea');
    // (not .doc-input: the file keys, Ctrl+S, work from here as from the SI page's boxes)
    this.ta.className = 'text-input si-preview-input';
    this.ta.setAttribute('aria-label', 'Live Preview text');
    this.ta.spellcheck = false;
    this.ta.autocomplete = 'off';
    this.ta.setAttribute('autocorrect', 'off');
    this.ta.setAttribute('autocapitalize', 'off');
    this.ta.wrap = 'off';
    host.append(this.ta);
    this.wire();
  }

  get focused(): boolean { return document.activeElement === this.ta; }

  /** The preview's own text box (where its typing goes). */
  get input(): HTMLElement { return this.ta; }

  /** The person's own text in the SI shown, and whether each piece is where it was put. */
  get customText(): readonly PlacedCustom[] { return this.custom; }

  /** The edits written so far (for a compile to say which typing it has). */
  get generation(): number { return this.writtenGen; }

  /**
   * Show a compile. Typing not yet written keeps the text it is in: the compile waits for it. A
   * compile started before the last typing was written is not shown (a newer one follows the
   * write), unless `force` (after a write failed: the stored text again).
   */
  show(s: ShownSi, force = false): void {
    if (this.dirty.size || this.fresh.size || this.busy || (this.file && this.file.ed.composing !== null)) { this.waiting = s; return; }
    if (!force && !this.failed && s.gen !== undefined && s.gen < this.editGen && this.file) return;
    this.failed = false;
    const same = s.key === this.key && !!this.file;
    if (!same || s.owner !== this.owner) { clearTimeout(this.settleTimer); this.fromFor = undefined; }
    const v = this.view;
    const top = v.scroller.scrollTop, left = v.scroller.scrollLeft;
    // the caret's place, as where in which field it was, to put it back there
    const keep = same && this.file ? this.placeOf(this.file.ed.focus) : null;
    const anchorKeep = same && this.file ? this.placeOf(this.file.ed.anchor) : null;
    const text = rt.plainText(s.compiled.doc.runs);
    this.file = new DocFile(s.compiled.doc as DocText);
    this.file.ed.guard = (before, after) => this.guard(rt.plainText(before.runs), rt.plainText(after.runs), before.runs, after.runs);
    this.file.ed.refused = () => {};
    this.file.listener = (kind) => this.changed(kind);
    this.key = s.key;
    this.editable = s.editable;
    this.why = s.why ?? 'This preview can’t be typed into.';
    this.owner = s.owner;
    this.base = { text, spans: s.compiled.sources };
    this.spans = s.compiled.sources.map((x) => ({ ...x }));
    this.blocks = s.compiled.blocks;
    this.custom = s.compiled.custom;
    this.structures = s.compiled.structures ?? [];
    // (a structure picked stays picked while it is still there)
    if (this.pickedStructure && !this.structures.some((x) => x.key === this.pickedStructure)) this.unpickStructure();
    this.written.clear();
    this.hovered = null;
    v.file = this.file;
    v.resize();
    if (same) { v.sizeSpace(); v.scroller.scrollTop = top; v.scroller.scrollLeft = left; }
    else { v.fitWidth(); v.scroller.scrollTop = 0; }
    if (keep !== null) {
      const f = this.whereIs(keep), a = anchorKeep !== null ? this.whereIs(anchorKeep) : f;
      this.file.ed.select(a, f);
    }
    if (!same && this.focusNode) this.revealNode(this.focusNode);
    v.redraw();
  }

  /** The number of the last page shown (for the spectra's pages to go on from). */
  lastPageNumber(): number | null {
    const lay = this.file?.layout();
    const last = lay?.pages[lay.pages.length - 1];
    return last?.n ?? null;
  }

  /** The page chosen in the list: brought into view (`reveal`) and the rest washed out. */
  setFocus(node: string | null, reveal: boolean): void {
    // (another page chosen: a follow on its way is dropped)
    if (node !== this.focusNode) clearTimeout(this.settleTimer);
    this.focusNode = node;
    if (node && reveal) this.revealNode(node);
    this.view.redraw();
  }

  /** A field of the SI page hovered or chosen: its text lit up here (and brought into view, `reveal`). */
  lightField(src: string | null, reveal = false): void {
    this.litFromPage = src;
    if (src && reveal) {
      const s = this.spans.find((x) => this.isOf(x.src, src));
      if (s) { const r = this.view.rangeRects(s.start, s.end)[0]; if (r) this.view.reveal(r, 48); }
    }
    this.view.redraw();
  }

  /** Synchronous Scrolling from the SI page: the page chosen brought to the top (the preview scrolling by itself). */
  revealFocus(): void {
    if (!this.focusNode) return;
    this.selfScroll(() => this.revealNode(this.focusNode!));
  }

  /**
   * Synchronous Scrolling from the SI page: the preview scrolled so a field's text (on the page
   * chosen) is `at` (0 to 1) of the way down the window. False when the field has no text shown.
   */
  alignSource(src: string, at: number): boolean {
    const b = this.focusNode ? this.block(this.focusNode) : null;
    const s = this.spans.find((x) => this.isOf(x.src, src) && (!b || (x.start >= b.start && x.start < b.end)));
    if (!s) return false;
    const r = this.view.rangeRects(s.start, Math.min(s.end, s.start + 1))[0];
    if (!r) return false;
    const sc = this.view.scroller;
    this.selfScroll(() => {
      const box = sc.getBoundingClientRect();
      const now = this.view.toScreen(r.x1, r.y1).y + box.top;
      sc.scrollTop += now - (box.top + sc.clientHeight * at);
    });
    return true;
  }

  /** The preview scrolled by itself (nothing to follow for Synchronous Scrolling). */
  private selfScroll(f: () => void): void {
    this.userScrollAt = -Infinity;
    clearTimeout(this.settleTimer);
    f();
  }

  /** The page chosen now (as the preview last showed it). */
  get focusedNode(): string | null { return this.focusNode; }

  /** The characters at the reading line and a little above and below it (Synchronous Scrolling), or null. */
  private readingPlaces(): { mid: number; edges: number[] } | null {
    if (!this.file || !this.blocks.length) return null;
    const sc = this.view.scroller;
    const r = sc.getBoundingClientRect();
    if (r.height <= 0) return null;
    const k = readingLine(sc.scrollTop, sc.scrollHeight - sc.clientHeight, sc.clientHeight, READ_AT);
    const at = (f: number): number | null => {
      const p = this.view.toDoc(r.left + r.width / 2, r.top + r.height * Math.max(0, Math.min(1, f)));
      return this.file!.ed.offsetAt(p.x, p.y);
    };
    const mid = at(k);
    if (mid === null) return null;
    const edges = [at(k - READ_BAND), at(k + READ_BAND)].filter((x): x is number => x !== null);
    return { mid, edges };
  }

  /**
   * The page of the list the preview has been scrolled to, for Synchronous Scrolling (null: stay
   * on the page chosen). See pageToFollow: the page at the reading line, once the scrolling has
   * clearly left the page it started on.
   */
  nodeToFollow(): string | null {
    const at = this.readingPlaces();
    if (!at) return null;
    const from = this.fromFor === this.focusNode ? this.from : null;
    return pageToFollow(this.blocks, at.mid, at.edges, this.focusNode, from);
  }

  /** A page followed: what the next scrolling is measured from (before the compile shows it chosen). */
  followed(node: string): void {
    this.focusNode = node;
    this.from = node;
    this.fromFor = node;
    this.view.redraw();
  }

  /** The person is scrolling (or about to: called before the scroll happens). The first time since a page was chosen, the page at the reading line is noted. */
  private userScrolled(): void {
    this.userScrollAt = performance.now();
    if (this.fromFor !== this.focusNode && this.onScrollSettled) {
      const at = this.readingPlaces();
      this.from = at ? blockAt(this.blocks, at.mid)?.node ?? null : null;
      this.fromFor = this.focusNode;
    }
  }

  /**
   * The preview scrolled. Scrolling the person started (and what goes on from it: a fling, a
   * smooth scroll's tail, close after one another) waits for them to stop; the preview scrolling
   * by itself (a page chosen, a compile shown, a zoom) is left alone, and leaves a wait alone.
   */
  private scrolled(): void {
    if (!this.onScrollSettled) return;
    const now = performance.now();
    if (!this.pressed && now - this.userScrollAt > 300) return;
    this.userScrollAt = now;
    clearTimeout(this.settleTimer);
    // (held: waits for the button to be let go)
    if (this.pressed) { this.movedWhilePressed = true; return; }
    this.settleTimer = window.setTimeout(() => this.onScrollSettled?.(), SCROLL_SETTLE);
  }

  /** Preferences ▸ SI Live Preview changed: drawn again in the look chosen (the white space between pages hidden or shown). */
  applyPrefs(): void {
    if (this.view.hideSpace !== !siPreviewPrefs.whiteSpace) this.setHideSpace(!siPreviewPrefs.whiteSpace);
    this.view.redraw();
  }

  /**
   * Hide white space (a double-click between pages, as in Word): each page's top and bottom
   * margins hidden, or shown again, keeping the text under the pointer where it is. Remembered
   * with the settings (Preferences ▸ SI Live Preview).
   */
  private setHideSpace(hide: boolean, clientY?: number): void {
    const v = this.view;
    if (v.hideSpace !== hide) {
      const r = v.scroller.getBoundingClientRect();
      const y = clientY ?? r.top + v.scroller.clientHeight / 2;
      const d = v.toDoc(r.left + v.scroller.clientWidth / 2, y);
      // (the preview scrolling by itself: Synchronous Scrolling follows no page for it)
      this.userScrollAt = -Infinity;
      clearTimeout(this.settleTimer);
      v.hideSpace = hide;
      v.sizeSpace();
      // the same text under the pointer (the preview scrolling by itself: no page followed)
      const s = v.toScreen(d.x, d.y);
      v.scroller.scrollTop += s.y - (y - r.top);
      v.paint();
      v.onMove();
      this.placeInput();
    }
    if (siPreviewPrefs.whiteSpace === hide) { siPreviewPrefs.whiteSpace = !hide; siPreviewPrefs.save?.(); }
  }

  /** Write what was typed now (before Undo, before leaving the project). */
  async flush(): Promise<void> {
    clearTimeout(this.writeTimer);
    await this.writeNow();
  }

  // ---------------------------------------------------------------- places

  private block(node: string): SourceBlock | null {
    // (a page's own block: the first, outermost when a page is printed once)
    return this.blocks.find((b) => b.node === node) ?? null;
  }

  private revealNode(node: string): void {
    const b = this.block(node);
    if (!b) return;
    const r = this.view.rangeRects(b.start, Math.min(b.end, b.start + 1))[0];
    if (r) this.view.revealTop(r, 24);
  }

  /** Does a stretch's source belong to `lit` (a source, or a whole field "c:<id>|yield")? */
  private isOf(src: string, lit: string): boolean {
    return src === lit || fieldOfSrc(src) === lit;
  }

  /** A place in the text as its source and how far into that source's printed text. */
  private placeOf(at: number): { src: string; offset: number } | { at: number } {
    const s = spanAt(this.spans, at) ?? this.spans.find((x) => x.end === at) ?? null;
    if (!s || !this.file) return { at };
    const { at: into } = printedOf(this.file.ed.text, this.spans, s.src);
    return { src: s.src, offset: into(at) };
  }

  /** Where a kept place is in the text now. */
  private whereIs(p: { src: string; offset: number } | { at: number }): number {
    if ('at' in p) return Math.min(p.at, this.file?.ed.text.length ?? 0);
    const mine = this.spans.filter((s) => s.src === p.src).sort((a, b) => a.start - b.start);
    let left = p.offset;
    for (let i = 0; i < mine.length; i++) {
      const len = mine[i].end - mine[i].start;
      if (left <= len) return mine[i].start + left;
      left -= len + (i < mine.length - 1 && this.file?.ed.text.slice(mine[i].end, mine[i + 1].start).includes('\n') ? 1 : 0);
    }
    return mine.length ? mine[mine.length - 1].end : 0;
  }

  // ---------------------------------------------------------------- what is drawn over the text

  private overlay(): ReturnType<DocView['overlay']> {
    const f = this.file;
    const ed = f?.ed;
    const marks: TextMarks = { tints: [], brackets: [], flagged: [] };
    if (this.focusNode && siPreviewPrefs.dim) {
      const b = this.block(this.focusNode);
      if (b) marks.focus = { start: b.start, end: b.end, bar: CRIMSON };
    } else if (this.focusNode) {
      // (not washed out: the bar alone marks the page)
      const b = this.block(this.focusNode);
      if (b) marks.focus = { start: b.start, end: b.end, bar: CRIMSON, wash: false };
    }
    // the person's own text, flagged as text no field holds
    for (const s of this.spans) if (isCustomSrc(s.src)) marks.flagged!.push({ start: s.start, end: s.end, color: CUSTOM, look: siPreviewPrefs.custom });
    // a field lit up: from the SI page, or the text under the pointer
    const lit = this.litFromPage ?? (this.hovered && !isCustomSrc(this.hovered.src) ? this.hovered.src : null);
    if (lit) {
      const locked = !this.litFromPage && !editableSrc(lit);
      const label = this.api.labelOf(lit);
      const mine = this.spans.filter((s) => (this.litFromPage ? this.isOf(s.src, lit) : s.src === lit));
      mine.forEach((s, i) => {
        if (locked) marks.brackets!.push({ start: s.start, end: s.end, color: LOCKED, boxed: true, dashed: true, ...(i ? {} : { label: `Locked: made from ${label}. Click to go to the field` }) });
        else if (siPreviewPrefs.link === 'bracket') marks.brackets!.push({ start: s.start, end: s.end, color: CRIMSON, ...(i ? {} : { label }) });
        else {
          marks.tints!.push({ start: s.start, end: s.end, color: CRIMSON_TINT });
          if (!i) marks.brackets!.push({ start: s.start, end: s.end, color: CRIMSON, label, tagOnly: true });
        }
      });
    }
    const focused = this.focused;
    const picked = this.pickedObj();
    // (a structure picked: no caret beside it, only its handles)
    const showCaret = !!ed && focused && this.caretOn && picked === null && (ed.collapsed || ed.composing !== null);
    return {
      selection: ed && !ed.collapsed && !ed.composing && picked === null ? [ed.start, ed.end] : null,
      caret: showCaret ? ed!.caret() : null,
      squiggles: [], picked, found: [], framed: null,
      marks,
    };
  }

  // ---------------------------------------------------------------- typing

  /**
   * Whether a change of the text may be made: into a field's own text, or the person's own;
   * never into the words the program makes, nor a change of formatting (the SI page sets it).
   */
  private guard(before: string, after: string, beforeRuns: readonly TextRun[], afterRuns: readonly TextRun[]): boolean {
    this.allowed = null;
    if (!this.editable) { this.api.flash(this.why); return false; }
    if (before === after) {
      // (the same text in another look: formatting, which the SI page's fields keep)
      if (JSON.stringify(beforeRuns) !== JSON.stringify(afterRuns)) this.api.flash('Change formatting on the SI page: the Live Preview takes typing only.');
      return before === after && JSON.stringify(beforeRuns) === JSON.stringify(afterRuns);
    }
    // (where: the editor's selection before the change settles a change that could be in more than one place)
    const ed = this.file?.ed;
    const { start, end, typed } = locateEdit(before, after, ed?.start ?? 0, ed?.end ?? 0);
    const k = editKind(this.spans, start, end, typed, before);
    if (k.kind === 'locked') {
      const why = !k.src ? 'Chemweave writes this (a heading, a number, the layout): it can’t be changed here.'
        : typed.includes('\n') && editableSrc(k.src) ? `${this.api.labelOf(k.src)} holds one paragraph.` : `This is made from ${this.api.labelOf(k.src)}: change it there (click it to go to the field).`;
      this.api.flash(why);
      return false;
    }
    if (k.kind === 'across') { this.api.flash('Change one field at a time: the selection runs into the next one.'); return false; }
    this.allowed = k;
    this.pendingEdit = { start, end, typed };
    return true;
  }

  private pendingEdit: { start: number; end: number; typed: string } | null = null;

  /** A change let through: the stretches moved along, its field or custom text to write. */
  private changed(kind: string): void {
    if (kind === 'text' && this.pendingEdit && this.allowed) {
      const { start, end, typed } = this.pendingEdit;
      const delta = typed.length - (end - start);
      let src: string;
      if (this.allowed.kind === 'custom') {
        if (!typed) { this.pendingEdit = null; this.allowed = null; return; }
        // new text of the person's own, typed where no field is
        const id = newCustomId();
        src = customSrc(id);
        this.fresh.set(id, { id, ...customAnchor(this.file!.ed.text, this.spans, this.blocks, start) });
        this.shift(start, end, delta, null);
        this.spans.push({ start, end: start + typed.length, src });
        this.spans.sort((a, b) => a.start - b.start || a.end - b.end);
      } else if (this.allowed.kind === 'field') {
        src = this.allowed.src;
        this.shift(start, end, delta, src);
      } else return;
      this.dirty.add(src);
      this.editGen++;
      this.pendingEdit = null;
      this.allowed = null;
      clearTimeout(this.writeTimer);
      this.writeTimer = window.setTimeout(() => void this.writeNow(), WRITE_AFTER);
    }
    this.caretOn = true;
    this.placeInput();
    this.view.redraw();
  }

  /** The stretches after an edit of [start, end) by `delta` characters: the one edited (`into`) grows or shrinks. */
  private shift(start: number, end: number, delta: number, into: string | null): void {
    const out: SourceSpan[] = [];
    for (const s of this.spans) {
      if (s.end <= start && !(into && s.src === into && s.end === start && !this.spans.some((x) => x.src === into && x.start <= start && start < x.end))) { out.push(s); continue; }
      if (s.start >= end && !(into && s.src === into && s.start === end && s.end > end && start === end && !this.spans.some((x) => x.src === into && x.end === start))) {
        out.push({ ...s, start: s.start + delta, end: s.end + delta });
        continue;
      }
      // the stretch edited (or one the edit reaches into)
      if (into && s.src === into) out.push({ ...s, end: Math.max(s.start, s.end + delta) });
      else if (s.start >= start) out.push({ ...s, start: s.start + delta, end: s.end + delta });
      else out.push({ ...s, end: Math.max(s.start, s.end + (s.end >= end ? delta : 0)) });
    }
    this.spans = out.filter((s) => s.end > s.start || isCustomSrc(s.src));
    // (the pages' stretches and the custom text's places move along too: the wash and new custom text's places use them)
    const put = end - start + delta;
    const move = (x: number, edge: 'start' | 'end'): number => (x < start || (x === start && (edge === 'start' || end > start)) ? x : x >= end ? x + delta : edge === 'start' ? start : start + put);
    this.blocks = this.blocks.map((b) => ({ ...b, start: move(b.start, 'start'), end: move(b.end, 'end') }));
    this.custom = this.custom.map((c) => ({ ...c, start: move(c.start, 'start'), end: move(c.end, 'end') }));
  }

  /** Write the fields and custom text typed into. */
  private writeNow(): Promise<void> {
    const job = this.writing.then(() => this.writeDirty());
    this.writing = job.catch(() => {});
    return job;
  }

  private async writeDirty(): Promise<void> {
    if (!this.file || (!this.dirty.size && !this.fresh.size)) return;
    // (the text and its stretches as they are now: keys typed while this writes move the live ones)
    const text = this.file.ed.text;
    const spans = this.spans.map((x) => ({ ...x }));
    const gen = this.editGen;
    const owner = this.owner;
    const srcs = [...this.dirty];
    this.dirty.clear();
    this.busy = true;
    try { await this.writeEach(text, spans, srcs, owner); } finally { this.busy = false; }
    this.writtenGen = Math.max(this.writtenGen, gen);
    this.showWaiting();
  }

  /** A compile that came while typing or writing, shown now (when nothing waits to be written). */
  private showWaiting(): void {
    const w = this.waiting;
    if (!w || this.dirty.size || this.fresh.size || this.busy || this.file?.ed.composing != null) return;
    this.waiting = null;
    this.show(w);
  }

  /** A write failed since the last compile shown: the next shows the stored text, whenever it was started. */
  private failed = false;

  private async writeEach(text: string, spans: SourceSpan[], srcs: string[], owner: unknown): Promise<void> {
    const customs: { id: string; text: string }[] = [];
    let failed = false;
    for (const src of srcs) {
      if (isCustomSrc(src)) {
        customs.push({ id: customIdOf(src), text: spans.filter((s) => s.src === src).map((s) => text.slice(s.start, s.end)).join('') });
        continue;
      }
      const before = this.written.get(src) ?? { printed: printedOf(this.base.text, this.base.spans, src).printed, raw: (await this.api.read(src, owner)) ?? '' };
      const now = printedOf(text, spans, src).printed;
      let pre = 0;
      while (pre < before.printed.length && pre < now.length && before.printed[pre] === now[pre]) pre++;
      let suf = 0;
      while (suf < before.printed.length - pre && suf < now.length - pre && before.printed[before.printed.length - 1 - suf] === now[now.length - 1 - suf]) suf++;
      const next = applyToRaw(before.raw, before.printed, pre, before.printed.length - suf, now.slice(pre, now.length - suf), markupSrc(src));
      if (next === null) {
        this.api.flash(`That change touches words Chemweave writes, so it wasn’t saved to ${this.api.labelOf(src)}. Change it on the SI page.`, 8000);
        failed = true;
        continue;
      }
      if (next === before.raw) continue;
      try {
        await this.api.write(src, next, owner);
        this.written.set(src, { printed: now, raw: next });
      } catch (e) {
        failed = true;
        this.api.flash(`Could not save the change: ${e instanceof Error ? e.message : String(e)}`, 8000);
      }
    }
    if (customs.length) {
      // (the places of the new pieces written now; one typed since waits for its own write)
      const fresh = new Map([...this.fresh].filter(([id]) => customs.some((c) => c.id === id)));
      for (const id of fresh.keys()) this.fresh.delete(id);
      await this.api.writeCustom((items) => {
        let out = [...items];
        for (const c of customs) {
          const old = out.find((x) => x.id === c.id);
          if (old && c.text) out = out.map((x) => (x.id === c.id ? { ...x, text: c.text } : x));
          else if (old) { this.gone.set(c.id, old); out = out.filter((x) => x.id !== c.id); }
          else {
            // (new, or taken out to nothing and typed again: where it was put)
            const at = fresh.get(c.id) ?? this.gone.get(c.id);
            if (at && c.text) { out.push({ ...at, id: c.id, text: c.text }); this.gone.delete(c.id); }
          }
        }
        return out;
      }, owner).catch((e) => { failed = true; this.api.flash(`Could not save your text: ${e instanceof Error ? e.message : String(e)}`, 8000); });
    }
    // (after a failure: the stored text again, from the compile waiting or a new one)
    if (failed) {
      this.failed = true;
      if (!this.waiting) this.api.refresh();
    }
  }

  // ---------------------------------------------------------------- keys, pointer

  private wire(): void {
    const ta = this.ta, v = this.view;
    ta.addEventListener('keydown', (e) => this.onKey(e));
    ta.addEventListener('beforeinput', (e) => this.beforeInput(e));
    ta.addEventListener('compositionstart', () => this.file?.ed.compositionStart());
    ta.addEventListener('compositionupdate', (e) => this.file?.ed.compositionUpdate(e.data ?? ''));
    ta.addEventListener('compositionend', (e) => { this.file?.ed.compositionEnd(e.data ?? ''); this.syncInput(); this.showWaiting(); });
    ta.addEventListener('copy', (e) => this.copy(e, false));
    ta.addEventListener('cut', (e) => { if (this.pickedStructure) { e.preventDefault(); this.api.flash(PICKED_TYPING); return; } this.copy(e, true); });
    ta.addEventListener('paste', (e) => {
      e.preventDefault();
      if (this.pickedStructure) { this.api.flash(PICKED_TYPING); return; }
      this.offAnchor();
      const t = e.clipboardData?.getData('text/plain') ?? '';
      if (t) this.file?.ed.pastePlain(t);
    });
    ta.addEventListener('focus', () => { this.startBlink(); v.redraw(); });
    ta.addEventListener('blur', () => { clearInterval(this.blink); v.redraw(); void this.flush(); });
    const scroller = v.scroller;
    // (Synchronous Scrolling: scrolling the person does, told from the preview scrolling itself)
    scroller.addEventListener('wheel', (e) => {
      // (Ctrl+wheel zooms; a button let go of where the preview didn't hear it)
      if (e.ctrlKey || e.metaKey) return;
      if (this.pressed && !(e.buttons & 1)) release();
      this.userScrolled();
    }, { passive: true });
    scroller.addEventListener('touchstart', () => this.userScrolled(), { passive: true });
    scroller.addEventListener('touchmove', () => this.userScrolled(), { passive: true });
    scroller.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.pressed = true;
      this.movedWhilePressed = false;
      this.userScrolled();
    });
    const release = (): void => {
      if (!this.pressed) return;
      this.pressed = false;
      // (let go after scrolling with it held: the wait starts from now; a plain click chooses its own page)
      if (!this.movedWhilePressed) return;
      this.movedWhilePressed = false;
      this.userScrolled();
      this.scrolled();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    scroller.addEventListener('scroll', () => this.scrolled(), { passive: true });
    scroller.addEventListener('pointerdown', (e) => this.down(e));
    scroller.addEventListener('pointermove', (e) => this.move(e));
    scroller.addEventListener('pointerup', (e) => this.up(e));
    scroller.addEventListener('pointerleave', () => { if (this.hovered) { this.hovered = null; this.api.hoverSource(null); v.redraw(); } scroller.style.cursor = ''; });
    scroller.addEventListener('dblclick', (e) => {
      // between pages: the white space hidden, or shown again (Word's double-click)
      const space = this.view.spaceAt(e.clientX, e.clientY);
      if (space) { e.preventDefault(); this.setHideSpace(space === 'hide', e.clientY); return; }
      if (this.structureUnder(e)) return;
      const at = this.offsetAt(e);
      if (at !== null) this.file?.ed.selectWord(at);
    });
    scroller.addEventListener('contextmenu', (e) => this.contextMenu(e));
  }

  private startBlink(): void {
    clearInterval(this.blink);
    this.caretOn = true;
    this.blink = window.setInterval(() => { this.caretOn = !this.caretOn; this.view.redraw(); }, 530);
  }

  /** The place in the text at a pointer, or null off the pages. */
  private offsetAt(e: PointerEvent | MouseEvent): number | null {
    if (!this.file) return null;
    const p = this.view.toDoc(e.clientX, e.clientY);
    return this.file.ed.offsetAt(p.x, p.y);
  }

  /**
   * The stretch whose characters are under a pointer (not just nearest to it). A paragraph's lines
   * count as meeting (the gaps between them shared out), so moving between them never loses it.
   */
  private spanUnder(e: PointerEvent | MouseEvent): SourceSpan | null {
    const at = this.offsetAt(e);
    if (at === null) return null;
    const p = this.view.toDoc(e.clientX, e.clientY);
    for (const o of [at, at - 1]) {
      if (o < 0) continue;
      const r = this.view.rangeRects(o, o + 1, true)[0];
      if (r && p.x >= r.x1 - 1 && p.x <= r.x2 + 1 && p.y >= r.y1 && p.y <= r.y2) return spanAt(this.spans, o);
    }
    return null;
  }

  // ---------------------------------------------------------------- structures

  /** The object showing the picked structure or figure (null: none picked). */
  private pickedObj(): number | null {
    return this.pickedStructure ? this.structures.find((x) => x.key === this.pickedStructure)?.obj ?? null : null;
  }

  /** The structure or figure under a pointer (its box on the page), or null. */
  private structureUnder(e: PointerEvent | MouseEvent): SiStructureRef | null {
    if (!this.file || !this.structures.length) return null;
    const p = this.view.toDoc(e.clientX, e.clientY);
    const lay = this.file.layout();
    // (front first: the last placed is drawn over the others)
    for (const o of [...lay.objects].reverse()) {
      if (p.x < o.x || p.x > o.x + o.w || p.y < o.y || p.y > o.y + o.h) continue;
      const ref = this.structures.find((x) => x.obj === o.id);
      // (one behind the text: a click on the text over it goes to the text)
      if (ref && o.wrap === 'behind' && this.spanUnder(e)) continue;
      if (ref) return ref;
    }
    return null;
  }

  /** Pick a compound's structure or a figure: its page chosen in the list, its handles shown, its Picture Format tab. */
  private pickStructure(ref: SiStructureRef): void {
    this.pickedStructure = ref.key;
    const at = this.objectOffset(ref.obj);
    const b = at === null ? null : blockAt(this.blocks, at);
    if (b && b.node !== this.focusNode) this.api.pick(b.node);
    this.api.structureChosen(ref.key);
    this.view.redraw();
  }

  /**
   * The caret off a floating structure's place at the start of a paragraph (that character is no
   * field's: typing before it would be text of the preview's own), to just after it.
   */
  private offAnchor(): void {
    const ed = this.file?.ed;
    if (!ed || !ed.collapsed || !this.structures.length) return;
    const at = ed.start;
    if (at > 0 && ed.text[at - 1] !== '\n') return;
    let i = 0;
    for (const r of this.file!.t.runs) {
      if (i === at) { if (r.obj !== undefined && this.structures.some((x) => x.obj === r.obj)) ed.setCaret(at + 1); return; }
      i += r.text.length;
      if (i > at) return;
    }
  }

  /** Where the picked structure or figure is in the text (the caret goes on from there when it is let go by the arrows). */
  private pickedAt(): number | null {
    const id = this.pickedObj();
    return id === null ? null : this.objectOffset(id);
  }

  /** Let go of the structure picked (another figure was picked on the SI page). */
  letGo(): void { this.unpickStructure(); }

  private unpickStructure(): void {
    if (!this.pickedStructure) return;
    this.pickedStructure = null;
    this.api.structureChosen(null);
    this.view.redraw();
  }

  /** Where an object's character is in the text. */
  private objectOffset(id: number): number | null {
    let at = 0;
    for (const r of this.file?.t.runs ?? []) { if (r.obj === id) return at; at += r.text.length; }
    return null;
  }

  /** Right-click: on a structure, it is picked and its menu shows. */
  private contextMenu(e: MouseEvent): void {
    const ref = this.structureUnder(e);
    if (!ref) return;
    e.preventDefault();
    this.ta.focus({ preventScroll: true });
    this.pickStructure(ref);
    this.api.structureMenu(ref.key, e.clientX, e.clientY);
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 || !this.file) return;
    // a structure clicked: picked (no caret goes beside it)
    const ref = this.structureUnder(e);
    if (ref) {
      e.preventDefault();
      this.ta.focus({ preventScroll: true });
      this.pickStructure(ref);
      return;
    }
    // between pages: nothing happens on a click there (a double-click hides or shows the white space)
    if (this.view.spaceAt(e.clientX, e.clientY)) { e.preventDefault(); return; }
    const at = this.offsetAt(e);
    if (at === null) return;
    e.preventDefault();
    this.unpickStructure();
    this.ta.focus({ preventScroll: true });
    this.file.ed.setCaret(at, e.shiftKey);
    this.drag = { from: at };
    const s = this.spanUnder(e);
    this.downAt = { x: e.clientX, y: e.clientY, src: s?.src ?? null };
    this.view.scroller.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent): void {
    if (this.drag && this.file && e.buttons & 1) {
      const at = this.offsetAt(e);
      if (at !== null) this.file.ed.setCaret(at, true);
      return;
    }
    const sc = this.view.scroller;
    const space = this.view.spaceAt(e.clientX, e.clientY);
    const tip = space === 'hide' ? 'Double-click to hide white space' : space === 'show' ? 'Double-click to show white space' : '';
    if (sc.title !== tip) sc.title = tip;
    if (space) {
      sc.style.cursor = space === 'hide' ? HIDE_SPACE_CURSOR : SHOW_SPACE_CURSOR;
      if (this.hovered) { this.hovered = null; this.api.hoverSource(null); this.view.redraw(); }
      return;
    }
    const s = this.spanUnder(e);
    const same = (s?.src ?? null) === (this.hovered?.src ?? null);
    this.hovered = s;
    this.view.scroller.style.cursor = this.structureUnder(e) ? 'default' : s && this.editable && !editableSrc(s.src) && !isCustomSrc(s.src) ? 'pointer' : s ? 'text' : '';
    if (!same) { this.api.hoverSource(s && !isCustomSrc(s.src) ? s.src : null); this.view.redraw(); }
  }

  private up(e: PointerEvent): void {
    const d = this.downAt;
    this.drag = null;
    this.downAt = null;
    if (!d || !this.file) return;
    const still = Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4;
    if (!still) return;
    const at = this.file.ed.focus;
    // a click: its page chosen in the list; on words the program makes, its field
    const b = blockAt(this.blocks, at);
    if (b && b.node !== this.focusNode) this.api.pick(b.node);
    if (d.src && this.editable && !editableSrc(d.src) && !isCustomSrc(d.src)) this.api.goToSource(d.src);
  }

  private onKey(e: KeyboardEvent): void {
    const ed = this.file?.ed;
    if (!ed) return;
    // Page Up, Page Down: the preview scrolls a window's height (the caret stays)
    if ((e.key === 'PageUp' || e.key === 'PageDown') && !ctrlKeyOf(e)) {
      e.preventDefault();
      e.stopPropagation();
      this.userScrolled();
      const sc = this.view.scroller;
      sc.scrollTop += (e.key === 'PageDown' ? 1 : -1) * sc.clientHeight * 0.9;
      return;
    }
    if (e.isComposing || e.keyCode === 229) { e.stopPropagation(); return; }
    // (keys the preview takes go no further; the rest go on to the SI pane's and the app's: Ctrl+Shift+L, Ctrl+S, F7)
    const run = (f: () => void): void => { e.preventDefault(); e.stopPropagation(); f(); };
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const word = /mac/i.test(navigator.platform) ? e.altKey : e.ctrlKey;
    const moves: Record<string, Parameters<typeof ed.move>[0]> = { ArrowLeft: word ? 'wordLeft' : 'left', ArrowRight: word ? 'wordRight' : 'right', ArrowUp: 'up', ArrowDown: 'down', Home: e.ctrlKey ? 'textStart' : 'lineStart', End: e.ctrlKey ? 'textEnd' : 'lineEnd' };
    // a structure or figure picked: Escape lets it go, the arrows go on from it; it can't be deleted
    // or typed over here (its page has it), and nothing is typed, pasted or cut at the caret hidden meanwhile
    if (this.pickedStructure && !e.altKey) {
      const k = e.key.toLowerCase();
      if (e.key === 'Escape' && !ctrl) return run(() => this.unpickStructure());
      if (e.key === 'Delete' || e.key === 'Backspace') return run(() => this.api.flash(this.pickedStructure?.startsWith('f:') ? 'A figure is changed or deleted on its page (click it there for Picture Format); here you can change where it goes (Picture Format).' : 'A compound’s structure is changed on its page (Home ▸ Edit Structure); here you can change where it goes (Picture Format).'));
      if (e.key === 'Enter' || (ctrl && (k === 'v' || k === 'x'))) return run(() => this.api.flash(PICKED_TYPING));
      if (moves[e.key]) return run(() => { const at = this.pickedAt(); this.unpickStructure(); if (at !== null) ed.setCaret(at); ed.move(moves[e.key], shift); });
      if (ctrl && k === 'a') this.unpickStructure();
    }
    if (moves[e.key] && !e.altKey) return run(() => { this.unpickStructure(); ed.move(moves[e.key], shift); });
    if (!ctrl && !e.altKey) {
      switch (e.key) {
        case 'Enter': return run(() => { this.offAnchor(); ed.enter(shift); });
        case 'Backspace': return run(() => ed.backspace(false));
        case 'Delete': return run(() => ed.deleteForward(false));
        case 'Tab': return;
        case 'Escape': return run(() => this.ta.blur());
      }
    }
    if (ctrl && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !shift) return run(() => void this.flush().then(() => this.api.undo(false)));
      if (k === 'y' || (k === 'z' && shift)) return run(() => void this.flush().then(() => this.api.undo(true)));
      if (k === 'a') return run(() => ed.selectAll());
      if (k === 'backspace') return run(() => ed.backspace(true));
      if (k === 'delete') return run(() => ed.deleteForward(true));
      if (k === 'b' || k === 'i' || k === 'u') return run(() => this.api.flash('Change formatting on the SI page: the Live Preview takes typing only.'));
      if (k === 'c' || k === 'x' || k === 'v') { e.stopPropagation(); return; }
    }
  }

  private beforeInput(e: InputEvent): void {
    const ed = this.file?.ed;
    if (!ed || e.isComposing) return;
    const t = e.inputType;
    if (t === 'insertCompositionText') return;
    e.preventDefault();
    // (nothing typed over a structure picked: click in the text to type)
    if (this.pickedStructure) { this.api.flash(PICKED_TYPING); return; }
    this.offAnchor();
    if ((t === 'insertText' || t === 'insertReplacementText') && e.data) ed.type(e.data);
    else if (t === 'insertLineBreak' || t === 'insertParagraph') ed.enter(t === 'insertLineBreak');
    else if (t === 'deleteContentBackward') ed.backspace();
    else if (t === 'deleteContentForward') ed.deleteForward();
  }

  private copy(e: ClipboardEvent, cut: boolean): void {
    const ed = this.file?.ed;
    if (!ed || ed.collapsed) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', ed.text.slice(ed.start, ed.end));
    if (cut) ed.replace(ed.start, ed.end, []);
  }

  /** Keep the hidden text field at the caret (for input methods) holding the selection (for the system's copy). */
  private placeInput(): void {
    const ed = this.file?.ed;
    if (!ed || ed.composing !== null) return;
    this.syncInput();
    const c = ed.caret();
    // (toScreen is from the view's top left, where the pane's host starts)
    const s = this.view.toScreen(c.x, c.y1);
    this.ta.style.left = `${Math.max(0, s.x)}px`;
    this.ta.style.top = `${Math.max(0, s.y)}px`;
    this.ta.style.height = `${Math.max(8, (c.y2 - c.y1) * this.view.zoom)}px`;
  }

  private syncInput(): void {
    const ed = this.file?.ed;
    if (!ed || ed.composing !== null) return;
    const sel = ed.collapsed ? '' : ed.text.slice(ed.start, ed.end);
    if (this.ta.value !== sel) this.ta.value = sel;
    this.ta.setSelectionRange(0, sel.length);
  }
}
