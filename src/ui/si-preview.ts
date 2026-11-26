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

import { BRUSH, IBEAM } from '../editor/cursors';
import { paraAt } from '../text/paragraphs';
import { DocView, HIDE_SPACE_CURSOR, SHOW_SPACE_CURSOR, type TextMarks } from './doc-view';
import { DocFind } from './doc-find';
import { DocComments } from './doc-comments';
import type { ThreadActions } from './comment-cards';
import { DocFile } from '../document/doc-file';
import type { DocText } from '../document/document';
import * as rt from '../richtext';
import type { TextRun } from '../model';
import type { CompiledSi, SiStructureRef } from '../si/compile-doc';
import { blockAt, editableSrc, fieldOfSrc, pageToFollow, parseSrc, readingLine, spanAt, type SourceBlock, type SourceSpan } from '../si/source-map';
import { applyPrintedChange, applyToRaw, customIdOf, customSrc, editKind, locateEdit, isCustomSrc, markupSrc, printedOf, shiftSpans } from '../si/preview-edit';
import { customAnchor, newCustomId, type CustomText, type PlacedCustom } from '../si/custom-text';
import { siPreviewPrefs } from './mode-prefs';
import { addFormat, blockSrc, clearFormats, LOOK_KEYS, markupFormat, markupOnly, printedFor, type FormatLook, type ParaLook, type PreviewFormat, type RunFormatLook } from '../si/preview-format';

/** The SI accent (the bar beside the page chosen, a field's text). */
const CRIMSON = '#b4234f';
const CRIMSON_TINT = 'rgba(180, 35, 79, 0.16)';
const LOCKED = '#5f6570';
const CUSTOM = '#c27a00';

/** Said when typing, pasting or cutting while a structure or figure is selected. */
const PICKED_TYPING = 'Click in the text to type there: a structure or figure is selected.';

/** What a flag's card asks for (flag-threads.ts): its anchor, and the change. */
export type FlagChange = { what: 'reply'; text: string } | { what: 'edit'; reply: number | null; text: string } | { what: 'remove-reply'; reply: number } | { what: 'resolve'; done: boolean } | { what: 'delete' };

export interface SiPreviewHost {
  flash(message: string, ms?: number): void;
  /** A change from a flag's card beside the preview (one step of Undo). */
  flag?(anchor: string, change: FlagChange): Promise<void>;
  /** Who can be @mentioned in a flag's notes. */
  people?(): readonly string[];
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
  /** Formatting done here: fields' new formatted text, and the change to the formatting file (preview-format.ts); one step of Undo. */
  writeFormat(fields: { src: string; text: string; /** The stored text it was made from: if the field has changed since, nothing is written. */ from: string }[], change: ((items: PreviewFormat[]) => PreviewFormat[]) | null, owner: unknown, what?: 'Format' | 'Replace'): Promise<void>;
  undo(redo: boolean): void;
  /** Compile again (after a write that failed: the stored text is shown again). */
  refresh(): void;
  /** A compound's structure or a figure picked in the preview, by its placement key (si/placement.ts; null: none now): its Picture Format tab shows. */
  structureChosen(key: string | null): void;
  /** Right-click on a compound's structure or a figure (picked first): its menu at the pointer. */
  structureMenu(key: string, x: number, y: number): void;
  /** Double-click on a compound's structure: the drawing tools open on it. */
  editStructure(key: string): void;
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
  /** Pages whose margins hold what is shown (the spectra's): the white space between them is never hidden. */
  keepSpace?: boolean;
  /** The flags and comments shown as cards beside the pages: each comment's anchor and its card's label, by comment id. */
  flags?: { anchors: Map<number, string>; labels: Map<number, string> };
}

const ctrlKeyOf = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey || e.altKey;

/** Waiting this long after the last key before a field is written (a burst of typing is one step of Undo). */
const WRITE_AFTER = 700;
/** Synchronous Scrolling: waiting this long after the person stops scrolling before the page it rests on is followed. */
const SCROLL_SETTLE = 450;
/** Where in the window the page being read is taken to be (a third of the way down), and how far either side of it the page chosen still counts as read (hysteresis). */
const READ_AT = 0.3;
const READ_BAND = 0.12;

/** How many characters from a paragraph's start keep its own look (Home ▸ Paragraph with the caret in it). */
const PARA_ANCHOR = 24;

export class SiPreview {
  readonly view: DocView;
  private file: DocFile | null = null;
  private readonly ta: HTMLTextAreaElement;
  private key = '';
  private editable = false;
  /** The spectra's pages shown: their white space is never hidden. */
  private keepSpace = false;
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
  /** A write of the preview's own ended while typing still waited to be written (bumpWritten). */
  private bumpPending = false;
  /** The edit the last write that stored something was made at. */
  private realGen = 0;
  /** The text typed over selections (not yet written), in the preview's text. */
  private typedOver: { start: number; end: number }[] = [];
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
    // the flags and comments, as cards beside the pages (as Word's comments)
    this.comments = new DocComments(host, this.view, {
      file: () => this.file,
      focus: () => this.ta.focus({ preventScroll: true }),
      flash: (m, ms) => this.api.flash(m, ms),
      askName: async () => true,
      actions: (id) => this.flagActions(id),
      // (a flag's card has a red edge; a comment's is a comment's)
      card: (id) => { const label = this.flagCards.labels.get(id); return { label, cls: label?.startsWith('Flag') ? 'si-flag-card' : '', people: this.api.people?.() ?? [], rich: false }; },
      // (the pane beside the SI page is too narrow for a column of cards beside readable pages)
      narrow: () => host.clientWidth < 900,
    });
    this.view.onMove = () => this.comments.place();
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

  /** The flags' and comments' cards beside the pages. */
  readonly comments: DocComments;
  private flagCards: { anchors: Map<number, string>; labels: Map<number, string> } = { anchors: new Map(), labels: new Map() };

  /** What a flag's card does: each through the SI page's flag (one step of Undo); null for none. */
  private flagActions(id: number): ThreadActions | null {
    const anchor = this.flagCards.anchors.get(id);
    const change = this.api.flag;
    if (!anchor || !change) return null;
    const run = (c: FlagChange): void => { void change.call(this.api, anchor, c).catch((e: unknown) => this.api.flash(e instanceof Error ? e.message : String(e), 8000)); };
    return {
      edit: (text, reply) => run({ what: 'edit', reply: reply ?? null, text }),
      reply: (text) => run({ what: 'reply', text }),
      removeReply: (i) => run({ what: 'remove-reply', reply: i }),
      resolve: (done) => run({ what: 'resolve', done }),
      remove: () => run({ what: 'delete' }),
      focus: () => this.comments.goTo(id),
    };
  }

  /** The anchor of the flag whose card is looked at (null: none). */
  get activeFlag(): string | null { return this.comments.active !== null ? this.flagCards.anchors.get(this.comments.active) ?? null : null; }

  /** Show the card of a flag (its anchor), as after adding it. */
  showFlag(anchor: string): void {
    for (const [id, a] of this.flagCards.anchors) if (a === anchor) { this.comments.shown = true; this.comments.goTo(id); return; }
  }

  /**
   * Where a comment at the caret goes (Review ▸ New Comment): the compound field whose text it
   * is in; else the nearest heading of the SI page above it, a section's or a compound's (its
   * name); null on the cover page and General Information, which have none.
   */
  commentTarget(): { compound: string; field: string } | { section: string } | null {
    const ed = this.file?.ed;
    if (!ed) return null;
    const at = Math.min(ed.start, Math.max(0, (this.base?.text.length ?? 1) - 1));
    const span = spanAt(this.spans, at);
    const ps = span ? parseSrc(span.src) : null;
    if (ps?.owner === 'c' && ps.id) return { compound: ps.id, field: ps.field };
    if (ps?.owner === 's' && ps.id) return { section: ps.id };
    if (ps?.owner === 'g' && ps.id) return { section: ps.id.split('/')[0] };
    const b = blockAt(this.blocks.filter((x) => /^(compound|section):/.test(x.node)), at);
    if (!b) return null;
    const [kind, id] = [b.node.slice(0, b.node.indexOf(':')), b.node.slice(b.node.indexOf(':') + 1)];
    return kind === 'compound' ? { compound: id, field: 'name' } : { section: id };
  }

  get focused(): boolean { return document.activeElement === this.ta; }

  /** The preview's own text box (where its typing goes). */
  get input(): HTMLElement { return this.ta; }

  /** The person's own text in the SI shown, and whether each piece is where it was put. */
  get customText(): readonly PlacedCustom[] { return this.custom; }

  /** The edits written so far (for a compile to say which typing it has). */
  get generation(): number { return this.writtenGen; }

  /** The newest edit the text shown has (a compile with it shown). */
  private shownGen = 0;
  private shownWaiters: (() => void)[] = [];

  /**
   * Whether the text shown is the stored text: typing written, and the compile after the last
   * write (typing, formatting, Replace) shown. Commands that read the shown text (Replace, a
   * toggle, Increase Indent) wait for it, so they never act on words already changed; false
   * (said) when it doesn't come in time.
   */
  async ready(): Promise<boolean> {
    if (this.dirty.size || this.fresh.size) await this.writeNow();
    if (this.shownGen >= this.editGen || !this.file) return true;
    const ok = await new Promise<boolean>((done) => {
      const t = window.setTimeout(() => { this.shownWaiters = this.shownWaiters.filter((x) => x !== go); done(false); }, 20000);
      const go = (): void => { clearTimeout(t); done(true); };
      this.shownWaiters.push(go);
    });
    if (!ok) this.api.flash('The Live Preview is still updating. Try again in a moment.');
    return ok && !!this.file;
  }

  /**
   * Show a compile. Typing not yet written keeps the text it is in: the compile waits for it. A
   * compile started before the last typing was written is not shown (a newer one follows the
   * write), unless `force` (after a write failed: the stored text again).
   */
  show(s: ShownSi, force = false): void {
    if (this.dirty.size || this.fresh.size || this.busy || (this.file && this.file.ed.composing !== null)) { this.waiting = s; return; }
    if (!force && !this.failed && s.gen !== undefined && s.gen < this.editGen && this.file) return;
    this.failed = false;
    this.shownGen = force || s.gen === undefined ? this.editGen : Math.max(this.shownGen, s.gen);
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
    this.keepSpace = !!s.keepSpace;
    v.hideSpace = !this.keepSpace && !siPreviewPrefs.whiteSpace;
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
    if (same) { v.sizeSpace(); v.scroller.scrollTop = top; v.scroller.scrollLeft = left; v.refit(); }
    else { v.fitWidth(); v.scroller.scrollTop = 0; }
    if (keep !== null) {
      const f = this.whereIs(keep), a = anchorKeep !== null ? this.whereIs(anchorKeep) : f;
      this.file.ed.select(a, f);
    }
    if (!same && this.focusNode) this.revealNode(this.focusNode);
    // (the card looked at stays the same flag's: the comments are numbered again by each compile)
    const looked = this.activeFlag;
    this.flagCards = s.flags ?? { anchors: new Map(), labels: new Map() };
    this.comments.active = null;
    if (looked) for (const [id, a] of this.flagCards.anchors) if (a === looked) this.comments.active = id;
    this.findAgain();
    v.redraw();
    this.comments.update();
    this.releaseShown();
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
      let d = this.view.toScreen(r.x1, r.y1).y - sc.clientHeight * at;
      // (never above the page's start, nor past its end, when the page fits: the page stays in view)
      if (b) {
        const top = this.view.rangeRects(b.start, Math.min(b.end, b.start + 1))[0];
        const end = this.view.rangeRects(Math.max(b.start, b.end - 1), b.end)[0];
        const lo = top ? this.view.toScreen(top.x1, top.y1).y - 24 : -Infinity;
        const hi = end ? this.view.toScreen(end.x1, end.y2).y + 24 - sc.clientHeight : Infinity;
        d = Math.max(lo, Math.min(Math.max(lo, hi), d));
      }
      sc.scrollTop += d;
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
    const hide = !this.keepSpace && !siPreviewPrefs.whiteSpace;
    if (this.view.hideSpace !== hide) this.setHideSpace(hide);
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
      // (a scrollbar that came or went: Page Width fitted again)
      v.refit();
      v.paint();
      v.onMove();
      this.placeInput();
    }
    if (!this.keepSpace && siPreviewPrefs.whiteSpace === hide) { siPreviewPrefs.whiteSpace = !hide; siPreviewPrefs.save?.(); }
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
      squiggles: [], picked, found: this.finder?.open ? this.finder.hits : [], framed: null,
      comments: this.comments.shading(),
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
    if (this.finder?.open) { if (kind === 'text') this.findAgain(); else this.finder.showCount(); }
    this.view.redraw();
  }

  /** The stretches after an edit of [start, end) by `delta` characters: the one edited (`into`) grows or shrinks. */
  private shift(start: number, end: number, delta: number, into: string | null): void {
    this.spans = shiftSpans(this.spans, start, end, delta, into);
    const put0 = end - start + delta;
    // (the selections typed over: the typed text's place, moved along by later edits)
    const at = (x: number): number => (x < start ? x : x >= end ? x + delta : start);
    this.typedOver = this.typedOver.map((r) => ({ start: at(r.start), end: Math.max(at(r.start), r.end >= end ? r.end + delta : r.end > start ? start + put0 : r.end) }));
    if (into && end > start && put0 > 0) this.typedOver.push({ start, end: start + put0 });
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
    const over = this.typedOver;
    this.typedOver = [];
    this.dirty.clear();
    this.busy = true;
    let wrote = true;
    try { wrote = await this.writeEach(text, spans, srcs, owner, over); } finally { this.busy = false; }
    this.writtenGen = Math.max(this.writtenGen, gen);
    if (this.bumpPending && !this.dirty.size && !this.fresh.size) { this.bumpPending = false; this.writtenGen = this.editGen; }
    // (nothing to write, as a letter typed and taken out again: no compile follows, and the text
    // shown is the stored text already, so commands waiting for it go ahead)
    if (wrote) this.realGen = gen;
    if (!wrote && gen === this.editGen && !this.dirty.size && !this.fresh.size) {
      // (unless an earlier write's compile isn't shown yet: it would be dropped as older, so ask for a new one)
      if (this.shownGen < this.realGen) this.api.refresh();
      else { this.shownGen = Math.max(this.shownGen, gen); this.releaseShown(); }
    }
    this.showWaiting();
  }

  /**
   * After a write of the preview's own (formatting, Replace) begun at edit `gen0`: one edit more,
   * and written, unless there was typing while it was saved (that isn't written yet: the
   * compile after this write doesn't have it, so it isn't shown until the typing is written too).
   */
  private bumpWritten(gen0: number): void {
    const typed = this.editGen !== gen0;
    this.editGen++;
    this.realGen = this.editGen;
    // (typing already written while this one saved: all written; typing still to write: its write says so)
    if (!typed || (!this.dirty.size && !this.fresh.size && !this.busy)) this.writtenGen = this.editGen;
    else this.bumpPending = true;
  }

  /** Commands waiting for the stored text to be shown (ready()) go ahead, once it is. */
  private releaseShown(): void {
    if (this.shownGen >= this.editGen && this.shownWaiters.length) { const w = this.shownWaiters; this.shownWaiters = []; for (const go of w) go(); }
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

  /** Whether anything was written (or a write failed). */
  private async writeEach(text: string, spans: SourceSpan[], srcs: string[], owner: unknown, over: readonly { start: number; end: number }[] = []): Promise<boolean> {
    const customs: { id: string; text: string }[] = [];
    let failed = false;
    let wrote = false;
    for (const src of srcs) {
      if (isCustomSrc(src)) {
        customs.push({ id: customIdOf(src), text: spans.filter((s) => s.src === src).map((s) => text.slice(s.start, s.end)).join('') });
        continue;
      }
      let before = this.written.get(src);
      if (!before) {
        // (a field that can't be read now: said, and the stored text shown again)
        let raw: string | null;
        try { raw = await this.api.read(src, owner); } catch (e) {
          failed = true;
          this.api.flash(`Could not save the change: ${e instanceof Error ? e.message : String(e)}`, 8000);
          continue;
        }
        before = { printed: printedOf(this.base.text, this.base.spans, src).printed, raw: raw ?? '' };
      }
      const mine = printedOf(text, spans, src);
      const now = mine.printed;
      const at = over.filter((r) => spans.some((x) => x.src === src && x.start <= r.start && r.end <= x.end)).map((r) => ({ start: mine.at(r.start), end: mine.at(r.start) + r.end - r.start }));
      // (each change on its own: two edits far apart in the field leave what is between them as stored)
      const next = applyPrintedChange(before.raw, before.printed, now, markupSrc(src), at);
      if (next === null) {
        this.api.flash(`That change touches words Chemweave writes, so it wasn’t saved to ${this.api.labelOf(src)}. Change it on the SI page.`, 8000);
        failed = true;
        continue;
      }
      if (next === before.raw) continue;
      try {
        wrote = true;
        await this.api.write(src, next, owner);
        this.written.set(src, { printed: now, raw: next });
      } catch (e) {
        failed = true;
        this.api.flash(`Could not save the change: ${e instanceof Error ? e.message : String(e)}`, 8000);
      }
    }
    if (customs.length) {
      wrote = true;
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
    return wrote || failed;
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
    scroller.addEventListener('pointerleave', () => { if (this.hovered) { this.hovered = null; this.api.hoverSource(null); v.redraw(); } scroller.style.cursor = ''; scroller.title = ''; });
    scroller.addEventListener('dblclick', (e) => {
      // between pages: the white space hidden, or shown again (Word's double-click)
      const space = this.spaceAt(e);
      if (space) { e.preventDefault(); this.setHideSpace(space === 'hide', e.clientY); this.hoverSpace(e); return; }
      const ref = this.structureUnder(e);
      if (ref) { e.preventDefault(); this.api.editStructure(ref.key); return; }
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
    if (this.spaceAt(e)) { e.preventDefault(); return; }
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
    if (this.hoverSpace(e)) {
      if (this.hovered) { this.hovered = null; this.api.hoverSource(null); this.view.redraw(); }
      return;
    }
    const s = this.spanUnder(e);
    const same = (s?.src ?? null) === (this.hovered?.src ?? null);
    this.hovered = s;
    this.view.scroller.style.cursor = this.brush && (s || this.view.onPage(e.clientX, e.clientY)) ? BRUSH : this.structureUnder(e) ? 'default' : s && this.editable && !editableSrc(s.src) && !isCustomSrc(s.src) ? 'pointer' : s || this.view.onPage(e.clientX, e.clientY) ? IBEAM : '';
    if (!same) { this.api.hoverSource(s && !isCustomSrc(s.src) ? s.src : null); this.view.redraw(); }
  }

  /** Between pages: what a double-click there does, as the pointer and its tooltip (null: not between pages). */
  private spaceAt(e: MouseEvent): 'hide' | 'show' | null {
    return this.keepSpace ? null : this.view.spaceAt(e.clientX, e.clientY);
  }

  /** The pointer and tooltip for between pages (or neither); whether the pointer is there. */
  private hoverSpace(e: MouseEvent): boolean {
    const sc = this.view.scroller;
    const space = this.spaceAt(e);
    const tip = space === 'hide' ? 'Double-click to hide white space' : space === 'show' ? 'Double-click to show white space' : '';
    if (sc.title !== tip) sc.title = tip;
    if (space) sc.style.cursor = space === 'hide' ? HIDE_SPACE_CURSOR : SHOW_SPACE_CURSOR;
    else if (sc.style.cursor === HIDE_SPACE_CURSOR || sc.style.cursor === SHOW_SPACE_CURSOR) sc.style.cursor = '';
    return !!space;
  }

  private up(e: PointerEvent): void {
    const d = this.downAt;
    this.drag = null;
    this.downAt = null;
    if (!d || !this.file) return;
    const still = Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4;
    if (this.brush) { this.paintHere(); return; }
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
    if (this.brush && e.key === 'Escape' && !ctrl) return run(() => this.stopPainting());
    if (this.pickedStructure && !e.altKey) {
      const k = e.key.toLowerCase();
      if (e.key === 'Escape' && !ctrl) return run(() => this.unpickStructure());
      if (e.key === 'Delete' || e.key === 'Backspace') return run(() => this.api.flash(this.pickedStructure?.startsWith('f:') ? 'A figure is changed or deleted on its page (click it there for Picture Format); here you can change where it goes (Picture Format).' : 'Double-click a compound’s structure to change it; here you can also change where it goes (Picture Format).'));
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
      if (k === 'f' && !shift) return run(() => this.showFind());
      if (k === 'backspace') return run(() => ed.backspace(true));
      if (k === 'delete') return run(() => ed.deleteForward(true));
      if (k === 'b' || k === 'i' || k === 'u') {
        const key = k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline';
        return run(() => void this.format({ [key]: !this.selectionHas(key) }));
      }
      if (k === ' ' && !shift) return run(() => void this.format('clear'));
      if ((k === '=' || k === '+') && !e.altKey) { const key = shift || k === '+' ? 'sup' : 'sub'; return run(() => void this.format({ [key]: !this.selectionHas(key) })); }
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

  // ---------------------------------------------------------------- the ribbon's commands

  /** Find (Ctrl+F) and Replace (Ctrl+H): Document mode's Find box over the preview; replacing writes the fields the words print from. */
  private finder: DocFind | null = null;

  showFind(replace = false): void {
    if (!this.file) return;
    if (!this.finder) {
      this.finder = new DocFind(this.host, {
        file: () => this.file,
        focus: () => this.ta.focus(),
        flash: (m, ms) => this.api.flash(m, ms),
        redraw: () => { this.placeInput(); this.view.redraw(); },
        found: () => this.foundShown(),
      }, { replace: (ranges, with_) => this.replaceAt(ranges, with_), ready: () => this.ready() });
    }
    this.finder.show(replace);
  }

  /** While the text changes under an open Find box: its places looked for again (nothing is moved into view). */
  private findAgain(): void {
    if (this.finder?.open) this.finder.refresh();
  }

  /** The place found and selected: in view, and its page chosen in the list. */
  private foundShown(): void {
    const ed = this.file?.ed;
    if (ed && !ed.collapsed && this.finder?.open) {
      const r = this.view.rangeRects(ed.start, ed.end)[0];
      if (r) this.view.reveal(r, 60);
      const b = blockAt(this.blocks, ed.start);
      if (b && b.node !== this.focusNode) this.api.pick(b.node);
    }
    this.placeInput();
    this.view.redraw();
  }

  /** Select All in the preview. */
  selectAll(): void {
    this.file?.ed.selectAll();
    this.ta.focus();
  }

  /** Copy or cut the selection (the ribbon's Copy and Cut): as Ctrl+C and Ctrl+X do. */
  copyOut(cut: boolean): boolean {
    const ed = this.file?.ed;
    if (!ed || ed.collapsed) return false;
    this.ta.focus();
    this.syncInput();
    return document.execCommand(cut ? 'cut' : 'copy');
  }

  /** Paste plain text at the caret (the ribbon's Paste), as Ctrl+V does. */
  pasteText(text: string): void {
    const ed = this.file?.ed;
    if (!ed) return;
    if (this.pickedStructure) { this.api.flash(PICKED_TYPING); return; }
    this.ta.focus();
    ed.pastePlain(text);
  }

  /** Show/Hide ¶ in the preview. */
  get showMarks(): boolean { return this.view.showMarks; }
  set showMarks(on: boolean) { this.view.showMarks = on; this.view.redraw(); }

  /** Multiple Pages: two pages in each row (or one). */
  get multiplePages(): boolean { return this.view.perRow > 1; }
  set multiplePages(on: boolean) {
    const v = this.view;
    const page = v.currentPage();
    v.perRow = on ? 2 : 1;
    v.sizeSpace();
    if (on) v.fitPages(); else v.fitWidth();
    v.scrollToPage(page);
    v.redraw();
  }

  /** The number of pages shown. */
  get pageCount(): number { return this.file?.layout().pages.length ?? 0; }

  /** The page whose printed number is `label` ("12", "iv"; an "S" before it is left out), from 0; -1 for none. */
  pageIndexOf(label: string): number {
    const pages = this.file?.layout().pages ?? [];
    const want = label.trim().replace(/^S(?=\d)/i, '').toLowerCase();
    if (!want) return -1;
    const i = pages.findIndex((p) => (p.num ?? (p.n !== undefined ? String(p.n) : '')).toLowerCase() === want);
    if (i >= 0) return i;
    // (pages without printed numbers: counted from the first)
    const n = Number(want);
    return pages.every((p) => p.n === undefined && !p.num) && Number.isInteger(n) && n >= 1 && n <= pages.length ? n - 1 : -1;
  }

  /** Go To the page at `index` (from 0). */
  goToPage(index: number): void {
    this.userScrolled();
    this.view.scrollToPage(index);
    this.view.redraw();
  }

  // ---------------------------------------------------------------- formatting (preview-format.ts)

  /** Format Painter: the look being copied, and whether it stays on after one use (double-click). */
  private brush: { look: RunFormatLook; keep: boolean } | null = null;
  /** Format Painter turned on or off (the ribbon button shows it). */
  onPainting: (on: boolean) => void = () => {};
  get painting(): boolean { return !!this.brush; }

  /**
   * Format Painter: copy the look of the selection (or of the words at the caret) to the words
   * clicked or dragged over next; `keep` (a double-click on the button) goes on until Esc.
   */
  startPainting(keep: boolean): void {
    if (!this.file) return;
    if (!this.editable) { this.api.flash(this.why); return; }
    const look: RunFormatLook = {};
    for (const k of LOOK_KEYS) {
      const v = this.selectionValue(k);
      // (on or off for each look, so the words painted match; a font, size or color only when it has one)
      // ('' for none: painted words lose a font, size, color or highlight the copied ones don't have)
      if (k === 'font' || k === 'size' || k === 'color' || k === 'highlight') (look as Record<string, unknown>)[k] = v === undefined ? '' : v;
      else (look as Record<string, unknown>)[k] = !!v;
    }
    this.brush = { look, keep };
    this.onPainting(true);
  }

  stopPainting(): void {
    if (!this.brush) return;
    this.brush = null;
    this.view.scroller.style.cursor = '';
    this.onPainting(false);
  }

  /** A click or drag with the brush: the words dragged over (or the word clicked) get its look. */
  private paintHere(): void {
    const b = this.brush, ed = this.file?.ed;
    if (!b || !ed) return;
    if (ed.collapsed) ed.selectWord(ed.start);
    if (!b.keep) this.stopPainting();
    if (ed.collapsed) return;
    // only what differs is changed: words already so get no piece of their own
    const patch: FormatLook = {};
    for (const [k, v] of Object.entries(b.look) as [keyof RunFormatLook, RunFormatLook[keyof RunFormatLook]][]) {
      const differs = typeof v === 'boolean' ? (v ? !this.selectionHas(k) : this.selectionAny(k)) : v === '' ? this.selectionAny(k) : this.selectionAny(k, v);
      if (differs) (patch as Record<string, unknown>)[k] = v;
    }
    // (one paint after another: a drag while the last is being written waits for it)
    if (Object.keys(patch).length) this.paints = this.paints.then(() => this.format(patch)).then(() => {}, () => {});
  }
  private paints: Promise<void> = Promise.resolve();

  /**
   * Replace (Home ▸ Editing): the found places [a, b) of the preview's text become `with_` in the
   * fields they print from, all in one step of Undo; places in words the program writes (an ID, a
   * heading, a label) are left, and said so.
   */
  async replaceAt(ranges: readonly [number, number][], with_: string): Promise<number> {
    if (!this.file || !ranges.length) return 0;
    if (!this.editable) { this.api.flash(this.why); return 0; }
    // (the places were found in the text shown: it must still be the stored text)
    if (this.dirty.size || this.fresh.size || this.shownGen < this.editGen) { this.api.flash('The Live Preview is still updating. Try again in a moment.'); return 0; }
    const f = this.file;
    const owner = this.owner, text = f.ed.text;
    const gen0 = this.editGen;
    const spansNow = this.spans.map((x) => ({ ...x }));
    const printedCache = new Map<string, ReturnType<typeof printedOf>>();
    const printedOfSrc = (src: string): ReturnType<typeof printedOf> => {
      let x = printedCache.get(src);
      if (!x) { x = printedOf(text, spansNow, src); printedCache.set(src, x); }
      return x;
    };
    // each place by the field it is in; a place across two fields, in a general procedure (every
    // compound using it would change), in text typed in the preview, or in words Chemweave writes, is left
    const bySrc = new Map<string, [number, number][]>();
    let left = 0;
    for (const [a, b] of ranges) {
      const sp = spansNow.find((x) => x.start <= a && x.end >= b);
      if (!sp || !editableSrc(sp.src) || isCustomSrc(sp.src) || parseSrc(sp.src)?.owner === 'g') { left++; continue; }
      const at = printedOfSrc(sp.src).at(a);
      const l = bySrc.get(sp.src);
      if (l) l.push([at, at + b - a]); else bySrc.set(sp.src, [[at, at + b - a]]);
    }
    const fields: { src: string; text: string; from: string }[] = [];
    let done = 0;
    for (const [src, places] of bySrc) {
      const raw = await this.api.read(src, owner);
      if (raw === null) { left += places.length; continue; }
      let printed = printedOfSrc(src).printed, out = raw;
      // (from the last place back, each against the printed text as it is by then)
      for (const [pa, pb] of [...places].sort((x, y) => y[0] - x[0])) {
        const next = applyToRaw(out, printed, pa, pb, with_, markupSrc(src));
        if (next === null) { left++; continue; }
        out = next;
        printed = printed.slice(0, pa) + with_ + printed.slice(pb);
        done++;
      }
      if (out !== raw) fields.push({ src, text: out, from: raw });
    }
    if (fields.length) {
      try {
        await this.api.writeFormat(fields, null, owner, 'Replace');
      } catch (err) {
        if (!(err instanceof Error && err.name === 'SaidAlready')) this.api.flash(`Could not replace: ${err instanceof Error ? err.message : String(err)}`, 8000);
        return 0;
      }
      // (the text shown was the stored text when this began, so the next write starts from the compile shown)
      for (const x of fields) this.written.delete(x.src);
      this.bumpWritten(gen0);
    }
    const what = (n: number) => (n === 1 ? 'one place' : `${n} places`);
    const why = 'in a general procedure, typed in the Live Preview, or written by Chemweave (an ID, a heading)';
    if (!done && left) this.api.flash(`Nothing replaced: ${left === 1 ? 'the place is' : 'the places are'} ${why}. Change ${left === 1 ? 'it' : 'them'} where ${left === 1 ? 'it comes' : 'they come'} from.`, 9000);
    else if (left) this.api.flash(`Replaced ${what(done)}. ${left === 1 ? 'One place was' : `${left} places were`} left: ${why}.`, 9000);
    else if (done > 1) this.api.flash(`Replaced ${what(done)}. Ctrl+Z restores them.`, 4000);
    return done;
  }

  /** The first selected paragraph's own `key` (its alignment, indent…), or undefined. */
  paraValue<K extends keyof ParaLook>(key: K): ParaLook[K] | undefined {
    const f = this.file;
    if (!f) return undefined;
    return f.t.paras?.[paraAt(f.ed.text, f.ed.start)]?.[key] as ParaLook[K] | undefined;
  }

  /** Home ▸ Paragraph on the paragraphs selected (the caret's, when nothing is): kept across compiles as Font's looks are. */
  async paraFormat(look: ParaLook, one = false): Promise<boolean> {
    const ed = this.file?.ed;
    if (!ed) return false;
    // (one paragraph only: the first selected, as for Page Break)
    if (one && !ed.collapsed) ed.setCaret(ed.start);
    if (ed.collapsed) {
      const t = ed.text, at = ed.start;
      const a = at === 0 ? 0 : t.lastIndexOf('\n', at - 1) + 1, nl = t.indexOf('\n', at), b = nl < 0 ? t.length : nl;
      if (b <= a) { this.api.flash('Click in a paragraph with words in it first.'); return false; }
      // (kept by the paragraph's first words only: typing later in it doesn't lose the look)
      ed.select(a, Math.min(b, a + PARA_ANCHOR));
      const done = await this.format(look);
      this.file?.ed.setCaret(Math.min(at, this.file.ed.text.length));
      if (!done) this.api.flash('This paragraph can’t take formatting of its own: it has no words of a field or of the SI’s own text (a picture alone, or an empty line).');
      return done;
    }
    return this.format(look);
  }

  /** Whether any character selected has `key` (with a value other than `but`, when given). */
  private selectionAny(key: keyof RunFormatLook, but?: unknown): boolean {
    const ed = this.file?.ed;
    if (!ed || ed.collapsed) return false;
    let at = 0;
    for (const run of this.file!.t.runs) {
      const end = at + run.text.length;
      if (end > ed.start && at < ed.end && run.text && (but === undefined ? !!run[key] : run[key] !== but)) return true;
      at = end;
      if (at >= ed.end) break;
    }
    return false;
  }

  /** The first selected character's `key` (its size, for Grow Font), or undefined. */
  selectionValue<K extends keyof TextRun>(key: K): TextRun[K] | undefined {
    const ed = this.file?.ed;
    if (!ed) return undefined;
    let at = 0;
    for (const run of this.file!.t.runs) {
      const end = at + run.text.length;
      if (end > ed.start && run.text) return run[key];
      at = end;
    }
    return undefined;
  }

  /** Whether every character selected has `key` (Bold pressed again takes it off). */
  selectionHas(key: keyof RunFormatLook): boolean {
    const ed = this.file?.ed;
    if (!ed || ed.collapsed) return false;
    let at = 0, any = false;
    for (const run of this.file!.t.runs) {
      const end = at + run.text.length;
      if (end > ed.start && at < ed.end && run.text) { any = true; if (!run[key]) return false; }
      at = end;
      if (at >= ed.end) break;
    }
    return any;
  }

  /**
   * Format the selection (`look`; 'clear': Clear All Formatting). Bold, italic, underline,
   * subscript and superscript on a field kept as formatted text go into the field (SI Assistant
   * shows them too); the rest, and any formatting on words the program writes, go in the
   * formatting file. Either way it is kept across compiles. False when there was nothing to do.
   */
  async format(look: FormatLook | 'clear'): Promise<boolean> {
    if (!this.file) return false;
    if (!this.editable) { this.api.flash(this.why); return false; }
    if (this.file.ed.collapsed) { this.api.flash('Select the words to format first.'); return false; }
    // (typing not yet written goes first: what is formatted is what is stored)
    if (this.dirty.size || this.fresh.size) await this.writeNow();
    const f = this.file;
    if (!f) return false;
    const owner = this.owner;
    const text = f.ed.text;
    const s = f.ed.start, e = f.ed.end;
    const gen0 = this.editGen;
    // (the text's sources as they are now: a compile shown while the field is read below doesn't move them)
    const spansNow = this.spans.map((x) => ({ ...x }));
    const blocksNow = this.blocks.map((x) => ({ ...x }));
    // the selection as stretches of the printed text of each source
    const parts = new Map<string, [number, number]>();
    const put = (src: string, a: number, b: number): void => {
      const was = parts.get(src);
      parts.set(src, was ? [Math.min(was[0], a), Math.max(was[1], b)] : [a, b]);
    };
    const printedCache = new Map<string, ReturnType<typeof printedOf>>();
    const printedOfSrc = (src: string): ReturnType<typeof printedOf> => {
      let x = printedCache.get(src);
      if (!x) { x = printedOf(text, spansNow, src); printedCache.set(src, x); }
      return x;
    };
    let pos = s;
    const spans = spansNow.filter((x) => x.end > s && x.start < e).sort((a, b) => a.start - b.start);
    const gap = (a: number, b: number): void => {
      for (let i = a; i < b;) {
        const k = blockAt(blocksNow, i);
        if (!k) { i++; continue; }
        const hi = Math.min(b, k.end);
        // (paragraph marks and the places of pictures alone aren't formatted)
        if (text.slice(i, hi).replace(/[\n\uFFFC]/g, '').trim()) put(blockSrc(k.node), i - k.start, Math.max(i + 1, hi) - k.start);
        i = Math.max(i + 1, hi);
      }
    };
    for (const sp of spans) {
      const lo = Math.max(s, sp.start), hi = Math.min(e, sp.end);
      if (lo > pos) gap(pos, lo);
      if (hi > lo) { const a = printedOfSrc(sp.src).at(lo); put(sp.src, a, a + hi - lo); }
      pos = Math.max(pos, hi);
    }
    if (pos < e) gap(pos, e);
    if (!parts.size) return false;
    const fields: { src: string; text: string; from: string }[] = [];
    const later: ((items: PreviewFormat[]) => PreviewFormat[])[] = [];
    const sideFile = (src: string, printed: string, a: number, b: number): void => {
      later.push((items) => (look === 'clear' ? clearFormats(items, src, printed, a, b) : addFormat(items, src, printed, a, b, look)));
    };
    // (every printed text worked out before the fields are read: nothing below depends on what shows by then)
    const printedNow = new Map<string, string>();
    for (const src of parts.keys()) printedNow.set(src, src.startsWith('b:') ? printedFor(text, spansNow, blocksNow, src) : printedOfSrc(src).printed);
    const offKeys = look === 'clear' ? [] : (Object.keys(look) as (keyof FormatLook)[]).filter((k) => look[k] === false);
    const onKeys = look === 'clear' ? [] : (Object.keys(look) as (keyof FormatLook)[]).filter((k) => look[k] !== false);
    for (const [src, [a, b]] of parts) {
      const printed = printedNow.get(src)!;
      const inField = markupSrc(src) && editableSrc(src) && (look === 'clear' || markupOnly(look));
      if (!inField) { sideFile(src, printed, a, b); continue; }
      const raw = await this.api.read(src, owner);
      if (raw === null) { sideFile(src, printed, a, b); continue; }
      const got = markupFormat(raw, printed, a, b, look === 'clear' ? 'clear' : look);
      if (got.raw !== null && got.raw !== raw) fields.push({ src, text: got.raw, from: raw });
      if (got.raw === null || look === 'clear' || offKeys.length) {
        // (taking a look off, and Clear All Formatting, also cover what the program put on: a title's bold, the 1 of ¹H)
        sideFile(src, printed, a, b);
        continue;
      }
      // (a look put back in the field: an earlier piece taking it off there goes; first, so the
      // pieces for the words the program writes, put in next, stay)
      if (onKeys.length) later.push((items) => clearFormats(items, src, printed, a, b, onKeys));
      for (const [ma, mb] of got.missed) sideFile(src, printed, ma, mb);
    }
    if (!fields.length && !later.length) return false;
    const change = later.length ? (items: PreviewFormat[]): PreviewFormat[] => later.reduce((acc, fn) => fn(acc), items) : null;
    try {
      await this.api.writeFormat(fields, change, owner);
    } catch (err) {
      if (!(err instanceof Error && err.name === 'SaidAlready')) this.api.flash(`Could not save the formatting: ${err instanceof Error ? err.message : String(err)}`, 8000);
      return false;
    }
    // (the fields' stored text has changed: typing next starts from it, and a compile started before
    // isn't shown; the printed text is as it was, as formatting doesn't change the words)
    for (const x of fields) this.written.set(x.src, { printed: printedNow.get(x.src)!, raw: x.text });
    if (fields.length) this.bumpWritten(gen0);
    // (the compile that follows the write shows it)
    return true;
  }

}
