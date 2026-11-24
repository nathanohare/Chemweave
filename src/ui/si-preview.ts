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

import { DocView, type TextMarks } from './doc-view';
import { DocFile } from '../document/doc-file';
import type { DocText } from '../document/document';
import * as rt from '../richtext';
import type { TextRun } from '../model';
import type { CompiledSi } from '../si/compile-doc';
import { blockAt, editableSrc, fieldOfSrc, spanAt, type SourceBlock, type SourceSpan } from '../si/source-map';
import { applyToRaw, customIdOf, customSrc, editKind, isCustomSrc, markupSrc, printedOf } from '../si/preview-edit';
import { customAnchor, newCustomId, type CustomText, type PlacedCustom } from '../si/custom-text';
import { siPreviewPrefs } from './mode-prefs';

/** The SI accent (the bar beside the page chosen, a field's text). */
const CRIMSON = '#b4234f';
const CRIMSON_TINT = 'rgba(180, 35, 79, 0.16)';
const LOCKED = '#5f6570';
const CUSTOM = '#c27a00';

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
}

/** What is being shown: the whole SI (which can be typed into), or the Spectra section's pages. */
export interface ShownSi {
  compiled: Pick<CompiledSi, 'doc' | 'sources' | 'blocks' | 'custom'>;
  key: string;
  editable: boolean;
  /** Why it can't be typed into (said when someone tries). */
  why?: string;
  /** What it was compiled from (the project): what is typed is written there, whatever shows by then. */
  owner: unknown;
}

/** Waiting this long after the last key before a field is written (a burst of typing is one step of Undo). */
const WRITE_AFTER = 700;

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
  private downAt: { x: number; y: number; src: string | null } | null = null;

  constructor(readonly host: HTMLElement, private readonly api: SiPreviewHost) {
    this.view = new DocView(host);
    this.view.overlay = () => this.overlay();
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

  /** The person's own text in the SI shown, and whether each piece is where it was put. */
  get customText(): readonly PlacedCustom[] { return this.custom; }

  /** Show a compile. Typing not yet written keeps the text it is in: the compile waits for it. */
  show(s: ShownSi): void {
    if (this.dirty.size || this.fresh.size) { this.waiting = s; return; }
    const same = s.key === this.key && !!this.file;
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
    const showCaret = !!ed && focused && this.caretOn && (ed.collapsed || ed.composing !== null);
    return {
      selection: ed && !ed.collapsed && !ed.composing ? [ed.start, ed.end] : null,
      caret: showCaret ? ed!.caret() : null,
      squiggles: [], picked: null, found: [], framed: null,
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
    let pre = 0;
    while (pre < before.length && pre < after.length && before[pre] === after[pre]) pre++;
    let suf = 0;
    while (suf < before.length - pre && suf < after.length - pre && before[before.length - 1 - suf] === after[after.length - 1 - suf]) suf++;
    const start = pre, end = before.length - suf, typed = after.slice(pre, after.length - suf);
    const k = editKind(this.spans, start, end, typed, before);
    if (k.kind === 'locked') {
      const why = typed.includes('\n') && editableSrc(k.src) ? `${this.api.labelOf(k.src)} holds one paragraph.` : `This is made from ${this.api.labelOf(k.src)}: change it there (click it to go to the field).`;
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
  }

  /** Write the fields and custom text typed into. */
  private writeNow(): Promise<void> {
    const job = this.writing.then(() => this.writeDirty());
    this.writing = job.catch(() => {});
    return job;
  }

  private async writeDirty(): Promise<void> {
    if (!this.file || (!this.dirty.size && !this.fresh.size)) return;
    const text = this.file.ed.text;
    const owner = this.owner;
    const srcs = [...this.dirty];
    this.dirty.clear();
    const customs: { id: string; text: string }[] = [];
    let failed = false;
    for (const src of srcs) {
      if (isCustomSrc(src)) {
        customs.push({ id: customIdOf(src), text: this.spans.filter((s) => s.src === src).map((s) => text.slice(s.start, s.end)).join('') });
        continue;
      }
      const before = this.written.get(src) ?? { printed: printedOf(this.base.text, this.base.spans, src).printed, raw: (await this.api.read(src, owner)) ?? '' };
      const now = printedOf(text, this.spans, src).printed;
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
    if (customs.length || this.fresh.size) {
      const fresh = new Map(this.fresh);
      this.fresh.clear();
      await this.api.writeCustom((items) => {
        let out = [...items];
        for (const c of customs) {
          const old = out.find((x) => x.id === c.id);
          if (old) out = c.text ? out.map((x) => (x.id === c.id ? { ...x, text: c.text } : x)) : out.filter((x) => x.id !== c.id);
          else {
            const at = fresh.get(c.id);
            if (at && c.text) out.push({ ...at, text: c.text });
          }
        }
        return out;
      }, owner).catch((e) => { failed = true; this.api.flash(`Could not save your text: ${e instanceof Error ? e.message : String(e)}`, 8000); });
    }
    // a compile that came meanwhile (or, after a failure, the stored text again)
    const w = this.waiting;
    this.waiting = null;
    if (w && !this.dirty.size && !this.fresh.size) this.show(w);
    else if (failed && w) this.waiting = w;
  }

  // ---------------------------------------------------------------- keys, pointer

  private wire(): void {
    const ta = this.ta, v = this.view;
    ta.addEventListener('keydown', (e) => this.onKey(e));
    ta.addEventListener('beforeinput', (e) => this.beforeInput(e));
    ta.addEventListener('compositionstart', () => this.file?.ed.compositionStart());
    ta.addEventListener('compositionupdate', (e) => this.file?.ed.compositionUpdate(e.data ?? ''));
    ta.addEventListener('compositionend', (e) => { this.file?.ed.compositionEnd(e.data ?? ''); this.syncInput(); });
    ta.addEventListener('copy', (e) => this.copy(e, false));
    ta.addEventListener('cut', (e) => this.copy(e, true));
    ta.addEventListener('paste', (e) => {
      e.preventDefault();
      const t = e.clipboardData?.getData('text/plain') ?? '';
      if (t) this.file?.ed.pastePlain(t);
    });
    ta.addEventListener('focus', () => { this.startBlink(); v.redraw(); });
    ta.addEventListener('blur', () => { clearInterval(this.blink); v.redraw(); void this.flush(); });
    const scroller = v.scroller;
    scroller.addEventListener('pointerdown', (e) => this.down(e));
    scroller.addEventListener('pointermove', (e) => this.move(e));
    scroller.addEventListener('pointerup', (e) => this.up(e));
    scroller.addEventListener('pointerleave', () => { if (this.hovered) { this.hovered = null; this.api.hoverSource(null); v.redraw(); } scroller.style.cursor = ''; });
    scroller.addEventListener('dblclick', (e) => { const at = this.offsetAt(e); if (at !== null) this.file?.ed.selectWord(at); });
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

  /** The stretch whose characters are under a pointer (not just nearest to it). */
  private spanUnder(e: PointerEvent): SourceSpan | null {
    const at = this.offsetAt(e);
    if (at === null) return null;
    const p = this.view.toDoc(e.clientX, e.clientY);
    for (const o of [at, at - 1]) {
      if (o < 0) continue;
      const r = this.view.rangeRects(o, o + 1)[0];
      if (r && p.x >= r.x1 - 1 && p.x <= r.x2 + 1 && p.y >= r.y1 && p.y <= r.y2) return spanAt(this.spans, o);
    }
    return null;
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 || !this.file) return;
    const at = this.offsetAt(e);
    if (at === null) return;
    e.preventDefault();
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
    const s = this.spanUnder(e);
    const same = (s?.src ?? null) === (this.hovered?.src ?? null);
    this.hovered = s;
    this.view.scroller.style.cursor = s && this.editable && !editableSrc(s.src) && !isCustomSrc(s.src) ? 'pointer' : s ? 'text' : '';
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
    if (e.isComposing || e.keyCode === 229) { e.stopPropagation(); return; }
    // (keys the preview takes go no further; the rest go on to the SI pane's and the app's: Ctrl+Shift+L, Ctrl+S, F7)
    const run = (f: () => void): void => { e.preventDefault(); e.stopPropagation(); f(); };
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const word = /mac/i.test(navigator.platform) ? e.altKey : e.ctrlKey;
    const moves: Record<string, Parameters<typeof ed.move>[0]> = { ArrowLeft: word ? 'wordLeft' : 'left', ArrowRight: word ? 'wordRight' : 'right', ArrowUp: 'up', ArrowDown: 'down', Home: e.ctrlKey ? 'textStart' : 'lineStart', End: e.ctrlKey ? 'textEnd' : 'lineEnd' };
    if (moves[e.key] && !e.altKey) return run(() => ed.move(moves[e.key], shift));
    if (!ctrl && !e.altKey) {
      switch (e.key) {
        case 'Enter': return run(() => ed.enter(shift));
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
