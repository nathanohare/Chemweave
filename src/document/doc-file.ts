// An open document: its text with the editing (caret, selection, Undo) and its layout on pages.
// The workspace keeps one for each document tab, so switching tabs keeps each document's
// Undo history and place.

import type { Measure, TextFrame } from '../text/layout';
import { TextEditing, type ChangeKind } from '../text/editing';
import { documentMeasure } from '../text/font-measure';
import { cellMargins } from './table-styles';
import { DocLayouter, boxTextTop, movedLayout, type DocLayout } from './doc-layout';
import { reviewAuthor, revisionDate, type ReviewView } from './revisions';
import { setPart } from '../table';
import { FigurePictures } from './figures';
import { BOX_PAD, newDocument, nextObjectId, noteStyle, runStyleOf, styleOf, type DocObject, type DocText, type HfKey } from './document';
import { bodyAsZones, hfKeyFor, plainLook, zonesAsBody } from './hf-bodies';
import { changeSection, sectionsOf } from './sections';
import { allowedEdit } from './protect';
import type { ParaStyle, TextRun } from '../model';
import { fitParas, paraCount, storedParas } from '../text/paragraphs';
import { PRINT_VIEW, continuous, hiddenParas, outlineLevel, screenText, type ScreenView } from './doc-views';
import * as rt from '../richtext';

let screenMeasure: Measure = (t, s) => t.length * s * 0.5;

/** How fonts without published widths are measured (the app sets this to the screen's fonts). */
export function setScreenMeasure(m: Measure): void {
  screenMeasure = m;
}

/** Text widths for documents: published widths for Times New Roman, Arial and Courier New, the screen's for other fonts. */
export const docMeasure: Measure = documentMeasure((t, s, f, st) => screenMeasure(t, s, f, st));

/** Pictures of every document's drawings (shared, so a drawing pasted into two documents is drawn once). */
export const figures = new FigurePictures();

/** Indent added by Tab outside a list, as Word's Increase Indent (half an inch). */
const INDENT = 36;

/** Each paragraph's page number as last laid out, by document (for the contents' page numbers in Word files). */
export const paragraphPages = new WeakMap<DocText, string[]>();

/**
 * A text box, note or table cell being typed into: its own editing, the object it makes of the
 * box's text, and the step of the document's Undo its changes went into (once recorded).
 */
interface Box {
  id: number;
  cell?: { r: number; c: number };
  /** A header or footer being typed into on its page (Word's header and footer editing): `id` is -1. */
  hf?: HfPlace;
  ed: TextEditing;
  recorded: boolean;
  /** The document with the box's text as `x` (null when the box has gone). */
  made: (x: { runs: TextRun[]; paras: ParaStyle[] }) => DocText | null;
  /** The box's text as the session started. */
  start: unknown;
  step?: object;
  /** A header or footer: the document before it was typed into. */
  before?: DocText;
}

/** A header or footer on a page: its page, header or footer, which of the section's, and the section it belongs to (a section linked to the one before shows that one's). */
export interface HfPlace { page: number; kind: 'header' | 'footer'; key: HfKey; section: number }

export class DocFile {
  readonly ed: TextEditing;
  readonly layouter: DocLayouter;
  /** Changes made (for the unsaved mark). */
  edits = 0;
  /** Called after every change to the text or the selection. */
  listener: (kind: ChangeKind) => void = () => {};
  /** Called when a change is turned away because the document is protected (Review > Restrict Editing). */
  onRefused: () => void = () => {};
  private memo: { frame: TextFrame; view: ScreenView; lay: DocLayout } | null = null;
  /** Print Layout's pages while another view shows (for printing, PDFs and the contents' page numbers). */
  private printer: { layouter: DocLayouter; memo: { t: DocText; lay: DocLayout } | null } | null = null;
  /** How the document is shown (View > Views): Print Layout unless another view is chosen. */
  private shown: ScreenView = PRINT_VIEW;
  /**
   * The text box or table cell being typed into, if any: its own editing, whose changes go back
   * into the document.
   */
  box: Box | null = null;

  constructor(t: DocText = newDocument()) {
    this.layouter = new DocLayouter({ measure: docMeasure, drawingSize: (c, s) => figures.size(c, s) });
    this.ed = new TextEditing(t, runStyleOf(styleOf(t, t.paras[0])), docMeasure, t.styles.Normal?.size ?? 11);
    this.ed.anchor = this.ed.focus = 0;
    this.ed.layoutWith = (frame) => this.layoutOf(frame).text;
    this.ed.emptyParaStyle = (p) => runStyleOf(styleOf(this.t, this.t.paras[p]));
    // Review > Track Changes: edits to the text are marked with who made them and when
    this.ed.track = () => (this.t.track ? { author: reviewAuthor() || 'Author', date: revisionDate() } : null);
    this.ed.indentStep = INDENT;
    // Review > Restrict Editing: only the changes the protection allows
    this.ed.guard = (before, after) => allowedEdit(before as DocText, after as DocText);
    this.ed.refused = () => this.onRefused();
    this.ed.onChange = (kind) => {
      if (kind === 'text') this.edits++;
      this.listener(kind);
    };
  }

  /** How tracked changes show (Review > Display for Review), on the screen and when printed. */
  get review(): ReviewView {
    return this.layouter.review;
  }
  set review(v: ReviewView) {
    this.layouter.review = v;
    if (this.printer) { this.printer.layouter.review = v; this.printer.memo = null; }
    this.memo = null;
    this.ed.relayout();
  }

  /** Where typing and the text buttons go: the text box being typed into, or the document. */
  get textEd(): TextEditing {
    return this.box?.ed ?? this.ed;
  }

  /**
   * Start typing into a text box. Its text is edited on its own (its caret and selection, laid
   * out where the box is on its page), and each change goes back into the document, all of
   * one session as one step of the document's Undo.
   */
  editBox(id: number): TextEditing | null {
    const o = this.t.objects[id];
    if (o?.kind === 'note') return this.editNote(id);
    if (o?.kind !== 'textbox') return null;
    if (this.box?.id === id) return this.box.ed;
    const N = styleOf(this.t, {});
    const ed = new TextEditing({ runs: o.runs, paras: o.paras ?? [], justify: 'left', wrap: o.w - 2 * BOX_PAD.x }, runStyleOf(N), docMeasure, N.size);
    ed.anchor = ed.focus = ed.text.length;
    ed.layoutWith = (frame) => {
      const cur = this.t.objects[id];
      const lay = this.layouter.boxText(this.t, frame.runs, frame.paras, cur?.kind === 'textbox' ? cur.w : o.w);
      const at = this.layout().objects.find((x) => x.id === id);
      // the same top as the painter: a shape's text sits in its middle (boxTextTop)
      return at ? movedLayout(lay, at.x + BOX_PAD.x, boxTextTop(cur?.kind === 'textbox' ? cur : o, at, lay)) : lay;
    };
    // tracked like the document's own text, and protected with it
    ed.track = this.ed.track;
    const made = this.withObject(id, (cur, x) => (cur?.kind === 'textbox' ? { ...cur, runs: x.runs, paras: storedParas(x.paras) } : null));
    this.guardBox(ed, made);
    const box: Box = { id, ed, recorded: false, made, start: ed.t };
    ed.onChange = (kind) => {
      if (kind === 'text') {
        const t = made(ed.t);
        if (t) this.record(box, t, 'Edit text box');
        ed.relayout();
      }
      this.listener(kind);
    };
    this.box = box;
    return ed;
  }

  /**
   * Start typing into a footnote or endnote, as editBox does for a text box: its text laid out
   * where the note is (at the foot of its page, or after the text), every change going back into it.
   */
  editNote(id: number): TextEditing | null {
    const o = this.t.objects[id];
    if (o?.kind !== 'note') return null;
    if (this.box?.id === id) return this.box.ed;
    const st = noteStyle(this.t);
    const ed = new TextEditing({ runs: o.runs, paras: o.paras ?? [], justify: 'left', wrap: 100 }, runStyleOf(st), docMeasure, st.size);
    ed.anchor = ed.focus = ed.text.length;
    ed.layoutWith = (frame) => {
      const lay = this.layout();
      const at = lay.notes.get(id);
      const nl = this.layouter.noteText(this.t, frame.runs, frame.paras, lay.fields.get(id) ?? '', at?.w ?? lay.textW, lay.fields);
      return at ? movedLayout(nl, at.x, at.y - nl.box.y1) : nl;
    };
    // tracked like the document's own text, and protected with it
    ed.track = this.ed.track;
    const made = this.withObject(id, (cur, x) => (cur?.kind === 'note' ? { ...cur, runs: x.runs, paras: storedParas(x.paras) } : null));
    this.guardBox(ed, made);
    const box: Box = { id, ed, recorded: false, made, start: ed.t };
    ed.onChange = (kind) => {
      if (kind === 'text') {
        const t = made(ed.t);
        const cur = this.t.objects[id];
        if (t) this.record(box, t, cur?.kind === 'note' && cur.end ? 'Edit endnote' : 'Edit footnote');
        ed.relayout();
      }
      this.listener(kind);
    };
    this.box = box;
    return ed;
  }

  /**
   * Start typing into a cell of a table in the text, as editBox does for a text box: the cell's
   * text laid out where the cell is, every change going back into the table.
   */
  editCell(id: number, r: number, c: number): TextEditing | null {
    const o = this.t.objects[id];
    if (o?.kind !== 'table') return null;
    const cell = o.table.rows[r]?.[c];
    if (!cell) return null;
    if (this.box?.id === id && this.box.cell?.r === r && this.box.cell.c === c) return this.box.ed;
    const N = styleOf(this.t, {});
    const ed = new TextEditing({ runs: cell.runs, paras: cell.paras ?? [], justify: 'left', wrap: 100 }, runStyleOf(N), docMeasure, N.size);
    ed.anchor = ed.focus = ed.text.length;
    ed.layoutWith = (frame) => {
      const cur = this.t.objects[id];
      const lay = this.layout();
      const tb = lay.tables.get(id);
      const tab = cur?.kind === 'table' ? cur.table : o.table;
      const cl = this.layouter.cellNow(tab, r, c, frame.runs, frame.paras) ?? tb?.cells[r]?.[c];
      const at = tb?.rows[r];
      if (!cl) return this.layouter.boxText(this.t, frame.runs, frame.paras, 100);
      const m = cellMargins(tab, r, c);
      return at && tb ? movedLayout(cl, at.x + tb.xs[c] + m.left, at.y + m.top + (tb.drop[r]?.[c] ?? 0) - cl.box.y1) : cl;
    };
    // tracked like the document's own text, and protected with it
    ed.track = this.ed.track;
    const made = this.withObject(id, (cur, x) => (cur?.kind === 'table' && cur.table.rows[r]?.[c] ? { ...cur, table: setPart(cur.table, { r, c }, { runs: x.runs, paras: storedParas(x.paras) }) } : null));
    this.guardBox(ed, made);
    const box: Box = { id, cell: { r, c }, ed, recorded: false, made, start: ed.t };
    ed.onChange = (kind) => {
      if (kind === 'text') {
        const t = made(ed.t);
        if (t) this.record(box, t, 'Edit table');
        ed.relayout();
      }
      this.listener(kind);
    };
    this.box = box;
    return ed;
  }

  /** Make a change the protection would turn away (stopping it, once its password is given). */
  unprotected(f: () => void): void {
    const g = this.ed.guard;
    this.ed.guard = null;
    try { f(); } finally { this.ed.guard = g; }
  }

  /** The document with an object changed by the text typed into it (`change` gives the object, or null when it has gone). */
  private withObject(id: number, change: (cur: DocObject | undefined, x: { runs: TextRun[]; paras: ParaStyle[] }) => DocObject | null): Box['made'] {
    return (x) => {
      const o = change(this.t.objects[id], x);
      return o ? { ...this.t, objects: { ...this.t.objects, [id]: o } } as DocText : null;
    };
  }

  /** A text box's, note's, cell's or header's changes are let through when the document with them would be. */
  private guardBox(ed: TextEditing, made: Box['made']): void {
    ed.guard = (_before, after) => {
      if (!this.t.protect) return true;
      const t = made(after as { runs: TextRun[]; paras: ParaStyle[] });
      return !!t && allowedEdit(this.t, t);
    };
    ed.refused = () => this.onRefused();
  }

  /** A change typed into a text box, note, cell or header goes back into the document: the session's first as a step of Undo, the rest added to it. */
  private record(box: Box, t: DocText, label: string): void {
    const was = this.t;
    this.ed.update(t, box.recorded ? null : label);
    if (box.recorded || this.t === was) return;
    box.recorded = true;
    box.step = this.ed.lastStep;
  }

  /**
   * Start typing into the header or footer of a page, on the page (Word's double-click on a
   * header): its text edited on its own, laid out where it is drawn, every change going back
   * into the section it belongs to (the one before, for a section linked to it), all of it one
   * step of Undo. A plain header (left, centre and right text) becomes Word's paragraphs to type
   * into, and plain text again when it is done if it still is (endBox).
   */
  editHf(page: number, kind: 'header' | 'footer'): TextEditing | null {
    if (continuous(this.shown.kind)) return null;
    const pg = this.layout().pages[page];
    if (!pg) return null;
    const secs = sectionsOf(this.t);
    let section = pg.section;
    while (section > 0 && secs[section].linked) section--;
    const key = hfKeyFor(pg.hf, kind, !!pg.starts, pg.n ?? page + 1);
    if (this.box?.hf && this.box.hf.page === page && this.box.hf.key === key && this.box.hf.kind === kind) return this.box.ed;
    if (this.box) this.endBox();
    const sec = sectionsOf(this.t)[section];
    const textW = Math.max(36, sec.page.w - sec.page.left - sec.page.right);
    const before = this.t;
    let body = sec.hf.bodies?.[key];
    const plain = !body;
    if (!body) {
      // plain text: as Word's paragraphs (its page number a PAGE field), the session's first step
      const objects = { ...before.objects };
      let next = nextObjectId(before);
      body = zonesAsBody(before, sec.hf, key, textW, () => { const id = next++; objects[id] = { kind: 'field', code: 'page' }; return id; });
      this.ed.update(changeSection({ ...before, objects }, section, { hf: { ...sec.hf, bodies: { ...sec.hf.bodies, [key]: body } } }), kind === 'header' ? 'Edit header' : 'Edit footer');
      // refused (a protected document): no step was made, so there is nothing to type into
      if (this.t === before) return null;
    }
    const look = plainLook(this.t);
    const ed = new TextEditing({ runs: body.runs, paras: body.paras ?? [], justify: 'left', wrap: textW }, look, docMeasure, look.size ?? 10);
    ed.anchor = ed.focus = ed.text.length;
    // laid out as the page shows it (the document's own layout of it, so the caret is where the text is drawn)
    ed.layoutWith = () => this.layout().hfs.find((h) => h.page === page && h.kind === kind)?.whole
      ?? { lines: [], boxWidth: textW, box: { x1: 0, y1: 0, x2: 0, y2: 0 }, length: 0, measure: docMeasure };
    // (Word can track changes in headers; here they go in as typed)
    const made: Box['made'] = (x) => {
      const cur = sectionsOf(this.t)[section]?.hf;
      if (!cur) return null;
      return changeSection(this.t, section, { hf: { ...cur, bodies: { ...cur.bodies, [key]: { runs: rt.normalizeRuns(x.runs), paras: storedParas(x.paras) } } } });
    };
    this.guardBox(ed, made);
    const box: Box = { id: -1, hf: { page, kind, key, section }, ed, recorded: plain, made, start: ed.t, before, ...(plain ? { step: this.ed.lastStep } : {}) };
    ed.onChange = (k) => {
      if (k === 'text') {
        const t = made(ed.t);
        if (t) this.record(box, t, kind === 'header' ? 'Edit header' : 'Edit footer');
        ed.relayout();
      }
      this.listener(k);
    };
    this.box = box;
    return ed;
  }

  /**
   * Stop typing into the text box. When everything typed into it was undone there, its step of
   * the document's Undo changes nothing and goes (Undo then takes back the step before), and
   * Redo brings back what the box could still redo. A header or footer goes back to plain text
   * when that is all it is.
   */
  endBox(forUndo = false): void {
    const b = this.box;
    this.box = null;
    if (!b) return;
    if (b.hf) { this.endHf(b, b.hf, forUndo); return; }
    if (!b.recorded) return;
    const runs = this.t.runs;
    const ahead = b.ed.redoneText;
    const t = ahead && b.made(ahead as { runs: TextRun[]; paras: ParaStyle[] });
    // the box's text is the very text it started with: everything typed was undone
    this.ed.dropStep(b.step, (before) => b.ed.t === b.start && (before as DocText).runs === runs, t || undefined);
  }

  /**
   * A header or footer typed into: plain text again if that is all it is; one left as it was
   * (everything typed undone) as it was, with no step of Undo. `forUndo`: stopped by Undo, a plain
   * one never typed into is left to Redo as it was opened, so Redo opens it again.
   */
  private endHf(b: Box, at: HfPlace, forUndo = false): void {
    if (b.recorded && b.before && b.ed.t === b.start && this.ed.lastStep === b.step) {
      // (what was typed and undone there can still be brought back by Redo, as in Word)
      const ahead = b.ed.redoneText;
      const t = ahead ? b.made(ahead as { runs: TextRun[]; paras: ParaStyle[] }) : forUndo ? this.t : null;
      this.ed.update(b.before, null);
      this.ed.dropStep(b.step, () => true, t || undefined);
      return;
    }
    if (!b.recorded) return;
    const sec = sectionsOf(this.t)[at.section];
    const body = sec?.hf.bodies?.[at.key];
    if (!body) return;
    const plain = bodyAsZones(body, this.t, sec.hf, at.key, Math.max(36, sec.page.w - sec.page.left - sec.page.right));
    if (plain) this.ed.update(changeSection(this.t, at.section, { hf: plain }), null);
  }

  get t(): DocText {
    return this.ed.t as DocText;
  }

  /** The pages as they are now (with any text an input method is putting together). */
  layout(): DocLayout {
    this.ed.layout();
    return this.memo!.lay;
  }

  /** Lay out again from scratch (fonts finished loading). */
  relayout(): void {
    this.layouter.clear();
    this.printer?.layouter.clear();
    if (this.printer) this.printer.memo = null;
    this.memo = null;
    this.ed.relayout();
  }

  /** The view the document is shown in (View > Views). */
  get view(): ScreenView {
    return this.shown;
  }

  /** Show the document in another view, or the same view changed (Outline's folds, Web Layout's width). */
  set view(v: ScreenView) {
    if (v === this.shown) return;
    this.shown = v;
    this.ed.relayout();
  }

  /** The pages as they print, whatever view shows (printing, PDFs, the contents' page numbers in Word files). */
  printLayout(): DocLayout {
    if (!continuous(this.shown.kind)) return this.layout();
    this.printer ??= { layouter: new DocLayouter({ measure: docMeasure, drawingSize: (c, s) => figures.size(c, s) }), memo: null };
    this.printer.layouter.review = this.layouter.review;
    const t = this.t;
    if (this.printer.memo?.t !== t) {
      const lay = this.printer.layouter.layout(t);
      this.printer.memo = { t, lay };
      paragraphPages.set(t, lay.paraTops.map((pt) => lay.pages[pt.page]?.number ?? ''));
    }
    return this.printer.memo.lay;
  }

  private layoutOf(frame: TextFrame): DocLayout {
    const v = this.shown;
    if (this.memo?.frame !== frame || this.memo.view !== v) {
      const t = frame as DocText;
      let lay: DocLayout;
      if (!continuous(v.kind)) {
        lay = this.layouter.layout(t);
        paragraphPages.set(t, lay.paraTops.map((pt) => lay.pages[pt.page]?.number ?? ''));
      } else if (v.kind === 'outline' && v.outline) {
        const hidden = hiddenParas(t, v.outline);
        let firstLine: Set<number> | undefined;
        if (v.outline.firstLine) {
          firstLine = new Set();
          fitParas(t.paras, paraCount(rt.plainText(t.runs))).forEach((ps, p) => { if (!outlineLevel(t, ps)) firstLine!.add(p); });
        }
        lay = this.layouter.layout(screenText(t, v), { hidden, firstLine, notesAtEnd: true });
      } else lay = this.layouter.layout(screenText(t, v), { notesAtEnd: true });
      this.memo = { frame, view: v, lay };
    }
    return this.memo.lay;
  }
}
