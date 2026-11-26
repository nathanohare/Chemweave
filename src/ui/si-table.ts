// A table in an SI project's text, edited in the SI tab (SPEC §13k.5, as SI Assistant's table
// editor does it): cells with their formatting and mentions, rows and columns, merged cells,
// header rows, cell and column alignment, footnotes, the label, and pictures in cells. A cell's
// picture comes from a file, from the clipboard (a ChemDraw or Chemweave drawing is kept as a
// vector SVG with its CDXML beside it, so it can be drawn again), from the drawing tools
// (Draw Structure…) or from a compound of the project. Cells copied from Excel or Word paste in
// as cells. Every change is saved to the table's file at once.

import type { Json } from '../si/project';
import { blockAround, cellAt, colCount, deleteColumn, deleteRow, footnotesOf, insertColumn, insertRow, merge, ownerOf, pasteCells, pastedCells, rowsOf, setPicture, spans, split, squareUp, type Align, type Span } from '../si/tables';
import { SiRichBox } from './si-rich';
import { SiPictures, type SiPictureHost } from './si-picture';
import { addInfo } from './info-tip';
import { scrollToItem } from './motion';
import type { BorderLine, TableData } from '../model';
import { cellMargins, resolveTable, paintEdge, type CellBlock, type Edge, type ResolvedTable } from '../document/table-styles';
import { nearestSide, shadeCells, valignCells } from '../table';
import { autoFitContents, autoFitWindow, columnWidthsCm, distributeColumns, setColumnWidthCm, siTableData, storeTableData } from '../si/table-format';

export interface SiTableHost extends SiPictureHost {
  label(ref: string): string;
  mentionable(): { id: string; label: string; text: string }[];
  /** The cell picked, or the table changed: the ribbon's Table Layout tab shows this table's state. */
  selectionChanged(t: SiTableEditor): void;
  /** Delete the table and its caption (its file goes to the Trash). */
  remove(t: SiTableEditor): Promise<void>;
  /** The width of the text, in points (what AutoFit to Window and Distribute Columns fit in). */
  textWidth(): number;
  /** The pen while Border Painter is on (a click on a cell's edge gives it the line), else null. */
  painter(): BorderLine | null;
  stopPainting(): void;
  /** A change to the table's file as one named step of Undo. */
  step(label: string, f: () => Promise<void>): Promise<void>;
}

/** CSS pixels in a point. */
const PX = 96 / 72;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** One table's editor: its toolbar, grid, label and footnotes. */
export class SiTableEditor {
  readonly el: HTMLElement;
  private t: Json | null = null;
  private sel: Span = { r: 0, c: 0, rows: 1, cols: 1 };
  private anchor: { r: number; c: number } = { r: 0, c: 0 };
  private boxes: SiRichBox[] = [];
  private urls: string[] = [];
  private grid = el('table', 'si-tgrid');
  private notes: HTMLElement = el('div');
  private noteBox: SiRichBox | null = null;
  private labelBox = el('input', 'si-label-input');
  private title = el('span');
  private pics: SiPictures;

  constructor(private host: SiTableHost, readonly id: string, title: string) {
    this.pics = new SiPictures(host);
    this.el = el('div', 'si-card si-table-card');
    this.el.dataset.table = id;
    const h = el('h3', 'si-sub');
    h.append(this.title);
    this.title.textContent = title;
    addInfo(h, 'The table as it prints, with its caption on the line under it in the text. Click a cell to type in it; Shift+click another to select a block. The Table Layout tab on the ribbon adds rows and columns, merges cells and puts pictures in them. Ctrl+V in a cell pastes cells from Excel or Word, or a picture or ChemDraw drawing into the cell.');
    this.el.append(h);
  }

  /** Read the table and show it. */
  async load(): Promise<void> {
    const t = await this.host.project.readTable(this.host.section, this.id);
    if (!t) { this.el.append(el('p', 'muted si-note', `This table’s file (tables/${this.id}.json) is missing or could not be read.`)); return; }
    this.t = t;
    squareUp(t);
    this.cache = null;
    this.el.append(this.grid, this.bottom());
    this.grid.addEventListener('paste', (e) => this.pasteEvent(e), true);
    this.grid.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.host.painter()) { e.preventDefault(); e.stopPropagation(); this.host.stopPainting(); } });
    this.paint();
  }

  /** Save what is being typed; done when every save of this table has been written. */
  commit(): Promise<void> {
    for (const b of this.boxes) b.commit();
    this.noteBox?.commit();
    // (a label typed and not left yet)
    if (this.t && !this.gone && this.labelBox.value.trim() !== String(this.t.label ?? '')) void this.change(() => { this.t!.label = this.labelBox.value.trim(); }, false);
    return this.pending;
  }

  /** Done when every save of this table so far has been written. */
  settled(): Promise<void> { return this.pending; }

  /** The editor is leaving the page: its pictures' object URLs are given back. */
  dispose(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    // (frozen: a picture still being read makes no URL for a list nobody keeps)
    Object.freeze(this.urls);
    this.urls = [];
    this.gone = true;
  }
  private gone = false;
  /** The table's saves, one after another, so an older one never lands on a newer (never rejected). */
  private pending: Promise<void> = Promise.resolve();

  /** Mentions show their compounds' IDs (and tables' labels) as they are now. */
  relabel(): void {
    for (const b of this.boxes) b.relabel();
    this.noteBox?.relabel();
  }

  /** The table's label as the compiled SI gives it; `auto`: the numbered one it gets without a typed label (the Label box's placeholder). */
  setTitle(label: string, auto = ''): void {
    if (label) this.title.textContent = label;
    this.autoLabel = auto;
    this.labelBox.placeholder = auto ? `${auto} (automatic)` : 'Automatic';
  }
  private autoLabel = '';

  focus(): void {
    scrollToItem(this.el);
    this.boxes[0]?.el.focus();
  }

  // ------------------------------------------------------------------ the parts

  /** The ribbon's Table Layout commands, for the selected cells. */
  async command(cmd: string): Promise<void> {
    if (cmd === 'del-table') { await this.host.remove(this); return; }
    if (!this.t) return;
    const r = this.sel;
    switch (cmd) {
      case 'row-above': return this.change(() => insertRow(this.t!, r.r));
      case 'row-below': return this.change(() => insertRow(this.t!, r.r + r.rows));
      case 'col-left': return this.change(() => insertColumn(this.t!, r.c));
      case 'col-right': return this.change(() => insertColumn(this.t!, r.c + r.cols));
      case 'del-rows': return this.change(() => { for (let i = r.rows - 1; i >= 0; i--) deleteRow(this.t!, r.r + i); });
      case 'del-cols': return this.change(() => { for (let i = r.cols - 1; i >= 0; i--) deleteColumn(this.t!, r.c + i); });
      case 'merge':
        if (r.rows * r.cols < 2) { this.host.flash('Shift+click a second cell to select the cells to merge.'); return; }
        return this.change(() => merge(this.t!, r));
      case 'split': return this.change(() => split(this.t!, r.r, r.c));
      case 'align-left': case 'align-center': case 'align-right': return this.align(cmd.slice(6) as Align);
      case 'picture': return this.pictureFile();
      case 'paste-picture': return this.pasteButton();
      case 'draw-structure': return this.drawStructure();
      case 'compound': return this.fromCompound();
      case 'remove-picture': return this.change(() => setPicture(this.t!, r.r, r.c, ''));
      case 'shade-none': return this.shade(undefined);
      case 'valign-top': case 'valign-center': case 'valign-bottom': {
        const v = cmd.slice(7) as 'top' | 'center' | 'bottom';
        return this.setData((t) => valignCells(t, (rr, cc) => this.inBlock(rr, cc), v), 'Cell Alignment');
      }
      case 'fit-contents': return this.change(() => autoFitContents(this.t!), true, 'AutoFit Contents');
      // (not a toggle, as in Word: AutoFit Contents or a typed width ends it)
      case 'fit-window': return this.change(() => autoFitWindow(this.t!), true, 'AutoFit Window');
      case 'distribute': return this.change(() => distributeColumns(this.t!, this.host.textWidth()), true, 'Distribute Columns');
      case 'select-table': {
        const n = rowsOf(this.t).length, m = colCount(this.t);
        this.anchor = { r: 0, c: 0 };
        this.sel = { r: 0, c: 0, rows: n, cols: m };
        this.showSel();
        return;
      }
    }
  }

  // ------------------------------------------------------------------ the look (Table Design, Cell Size)

  /** The table as a document's table (its cells' looks, no text), for the shared table commands; null before it is read. Made again after each change. */
  tableData(): TableData | null {
    if (!this.t) return null;
    const w = this.host.textWidth();
    if (!this.cache || this.cache.w !== w) this.cache = { w, td: siTableData(this.t, w), res: null };
    return this.cache.td;
  }

  /** Its lines and shading worked out (made again after each change). */
  private resolved(): ResolvedTable | null {
    const td = this.tableData();
    if (!td || !this.cache) return null;
    return (this.cache.res ??= resolveTable(td));
  }
  private cache: { w: number; td: TableData; res: ResolvedTable | null } | null = null;

  /** The selected cells, as rows and columns. */
  block(): CellBlock {
    const s = this.sel;
    return { r0: s.r, c0: s.c, r1: s.r + s.rows - 1, c1: s.c + s.cols - 1 };
  }

  /** The selected cell, in the table's rows and columns. */
  get at(): { r: number; c: number } { return { r: this.sel.r, c: this.sel.c }; }

  /** Only one cell (merged or not) is selected. */
  get oneCell(): boolean {
    if (!this.t) return false;
    const o = ownerOf(this.t, this.sel.r, this.sel.c);
    return !!o && o.rows === this.sel.rows && o.cols === this.sel.cols;
  }

  private inBlock(r: number, c: number): boolean {
    const b = this.block();
    return r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1;
  }

  /** Change the table as a document's table (borders, shading, alignment down, margins) and keep what changed: one step of Undo. */
  setData(f: (t: TableData) => TableData, label: string): Promise<void> {
    const td = this.tableData();
    if (!td) return Promise.resolve();
    const next = f(td);
    return this.change(() => storeTableData(this.t!, next), true, label);
  }

  /** Shade the selected cells with a color, or take their shading off. */
  shade(fill: string | undefined): Promise<void> {
    return this.setData((t) => shadeCells(t, (r, c) => this.inBlock(r, c), fill), fill ? 'Shading' : 'No Shading');
  }

  /** The selected cells' columns typed a width (cm), or (null) fitting their text again. */
  setColumnWidth(cm: number | null): Promise<void> {
    const s = this.sel;
    return this.change(() => { for (let c = s.c; c < s.c + s.cols; c++) setColumnWidthCm(this.t!, c, cm, this.host.textWidth()); }, true, 'Column Width');
  }

  /** What the ribbon shows for the selected cells: the header rows, and the picture's width (null: no picture). */
  get state(): { headRows: number; rows: number; width: number | null; colWidth: number | null; fill: string | null; valign: 'top' | 'center' | 'bottom' } {
    const cell = this.selected();
    const td = this.tableData();
    const own = td?.rows[this.sel.r]?.[this.sel.c];
    return {
      headRows: this.t ? Math.max(0, Math.round(Number(this.t.header_rows ?? 1)) || 0) : 0,
      rows: this.t ? rowsOf(this.t).length : 0,
      width: cell?.image ? Math.max(0, Number(cell.image_width) || 0) : null,
      colWidth: this.t ? columnWidthsCm(this.t, colCount(this.t))[this.sel.c] ?? null : null,
      fill: own?.fill ?? null,
      valign: own?.valign ?? 'top',
    };
  }

  setHeaderRows(n: number): Promise<void> {
    return this.change(() => { this.t!.header_rows = Math.max(0, Math.min(rowsOf(this.t!).length, Math.round(n) || 0)); });
  }

  /** The selected cell's picture width in cm (0: its own size). */
  setPictureWidth(cm: number): Promise<void> {
    const cell = this.selected();
    if (!cell?.image) { this.host.flash('The selected cell has no picture.'); return Promise.resolve(); }
    return this.change(() => setPicture(this.t!, this.sel.r, this.sel.c, String(cell.image), Math.max(0, cm || 0)));
  }

  private bottom(): HTMLElement {
    const box = el('div', 'si-tbottom');
    const lab = el('label', 'si-part');
    this.labelBox.value = String(this.t!.label ?? '');
    this.labelBox.placeholder = this.autoLabel ? `${this.autoLabel} (automatic)` : 'Automatic';
    this.labelBox.addEventListener('change', () => void this.change(() => { this.t!.label = this.labelBox.value.trim(); }, false));
    lab.append('Label', this.labelBox);
    lab.title = 'The table’s label, typed over the automatic one (Table S1, S2…)';
    const nh = el('div', 'si-sub', 'Footnotes');
    addInfo(nh, 'Printed under the table, one a line. Type a footnote mark as a superscript (Ctrl+Shift+=), as in the cells.');
    this.noteBox = new SiRichBox(footnotesOf(this.t!).join('\n'), {
      label: this.host.label,
      mentionable: this.host.mentionable,
      changed: (v) => void this.change(() => { this.t!.footnotes = v.split('\n').filter((x) => x.trim()); }, false),
    }, true, 'a) Isolated yield. b) Determined by ¹H NMR.');
    this.notes = el('div', 'si-tnotes');
    this.notes.append(nh, this.noteBox.el);
    box.append(lab, this.notes);
    return box;
  }

  // ------------------------------------------------------------------ the grid

  private paint(): void {
    const t = this.t!;
    for (const u of this.urls) URL.revokeObjectURL(u);
    Object.freeze(this.urls);
    this.urls = [];
    if (this.gone) return;
    this.boxes = [];
    const head = Math.max(0, Math.round(Number(t.header_rows ?? 1)) || 0);
    const rows = rowsOf(t);
    const cols = (t.columns as unknown[]) ?? [];
    const all = spans(t);
    const body = el('tbody');
    rows.forEach((_, r) => {
      const tr = el('tr');
      if (r < head) tr.className = 'si-thead';
      if (r === head - 1) tr.classList.add('si-thead-last');
      for (const s of all.filter((x) => x.r === r)) {
        const cell = cellAt(t, s.r, s.c)!;
        const td = el('td');
        if (s.rows > 1) td.rowSpan = s.rows;
        if (s.cols > 1) td.colSpan = s.cols;
        const align = ['left', 'center', 'right'].includes(String(cell.align)) ? String(cell.align) : String(cols[s.c] ?? 'center');
        td.style.textAlign = align;
        td.dataset.r = String(s.r);
        td.dataset.c = String(s.c);
        if (typeof cell.image === 'string' && cell.image) td.append(this.picture(cell));
        const box = new SiRichBox(typeof cell.text === 'string' ? cell.text : '', {
          label: this.host.label,
          mentionable: this.host.mentionable,
          changed: (v) => { const c = cellAt(this.t!, s.r, s.c); if (c) { c.text = v; void this.save(); } },
        }, true);
        box.el.addEventListener('focus', () => { if (!this.shift && !this.refocusing) this.pick(s.r, s.c, false); });
        td.addEventListener('mousedown', (e) => {
          // Border Painter: the edge of the cell nearest the click gets the pen's line (drag along several)
          if (this.host.painter() && e.button === 0) { e.preventDefault(); this.startPainting(); this.paintAt(td, s.r, s.c, e); return; }
          this.shift = e.shiftKey; if (e.shiftKey) { e.preventDefault(); this.pick(s.r, s.c, true); }
        });
        td.addEventListener('mousemove', (e) => { if (this.drag && e.buttons === 1) this.paintAt(td, s.r, s.c, e); });
        td.addEventListener('mouseup', () => { this.shift = false; });
        this.boxes.push(box);
        td.append(box.el);
        tr.append(td);
      }
      body.append(tr);
    });
    this.grid.replaceChildren(body);
    this.showLines();
    this.showSel();
  }

  /**
   * The table's lines as they print (the ACS rules and the cells' own borders), its shading, each
   * cell's alignment down and margins, and the columns' widths; the edges with no line show as
   * faint dashed lines, to see the cells. `td`: a look not kept yet (a Border Painter drag).
   */
  showLines(td: TableData | null = this.tableData()): void {
    if (!td) return;
    const res = td === this.cache?.td ? this.resolved()! : resolveTable(td);
    const css = (e: Edge | null | undefined): string => {
      if (!e) return '1px dashed var(--line)';
      const px = Math.max(1, Math.round(e.w * PX * 2) / 2);
      const color = e.color === '#000000' ? 'var(--text)' : e.color;
      return `${e.style === 'double' ? Math.max(3, px * 3) : px}px ${e.style === 'single' ? 'solid' : e.style} ${color}`;
    };
    for (const td0 of this.grid.querySelectorAll<HTMLElement>('td')) {
      const r = Number(td0.dataset.r), c = Number(td0.dataset.c);
      const cell = td.rows[r]?.[c];
      const rows = cell?.rowSpan ?? 1, cols = cell?.span ?? 1;
      td0.style.borderTop = css(res.h[r]?.[c]);
      td0.style.borderBottom = css(res.h[r + rows]?.[c]);
      td0.style.borderLeft = css(res.v[r]?.[c]);
      td0.style.borderRight = css(res.v[r]?.[c + cols]);
      td0.dataset.fill = res.fill[r]?.[c] ?? '';
      td0.style.verticalAlign = cell?.valign === 'center' ? 'middle' : cell?.valign ?? 'top';
      const m = cellMargins(td, r, c);
      td0.style.padding = `${m.top * PX}px ${m.right * PX}px ${m.bottom * PX}px ${m.left * PX}px`;
    }
    this.showSel(false);
    // the columns' widths, as shares of the text's width (the page here is as wide as the card):
    // every column with its width, or only those typed, the others fitting their text
    const textW = this.host.textWidth();
    const n = td.cols.length;
    const typed = this.t ? columnWidthsCm(this.t, n) : [];
    const fixed = !td.autofit;
    const total = td.cols.reduce((x, y) => x + y, 0);
    const some = typed.some((w) => w !== null);
    this.grid.style.width = fixed && total ? `${Math.min(100, Math.round((total / textW) * 1000) / 10)}%` : '';
    this.grid.style.tableLayout = fixed ? 'fixed' : '';
    let colgroup = this.grid.querySelector('colgroup');
    if (!fixed && !some) { colgroup?.remove(); return; }
    if (!colgroup) { colgroup = el('colgroup'); this.grid.prepend(colgroup); }
    colgroup.replaceChildren(...td.cols.map((w, k) => {
      const col = el('col');
      if (fixed) col.style.width = `${Math.round((w / total) * 1000) / 10}%`;
      else if (typed[k] !== null) col.style.width = `${Math.round(w * PX)}px`;
      return col;
    }));
  }
  private shift = false;
  /** A focus put back by the editor itself (it doesn't pick the cell again). */
  private refocusing = false;
  /** A Border Painter drag: the table with the edges painted so far (kept as one step of Undo when the button is let go). */
  private drag: { td: TableData; done: Set<string> } | null = null;

  private startPainting(): void {
    const td = this.tableData();
    if (!td) return;
    this.drag = { td, done: new Set() };
    document.addEventListener('mouseup', () => {
      const d = this.drag;
      this.drag = null;
      if (d?.done.size) void this.setData(() => d.td, 'Border Painter');
    }, { once: true });
  }

  private paintAt(td: HTMLElement, r: number, c: number, e: MouseEvent): void {
    const pen = this.host.painter();
    const d = this.drag;
    if (!pen || !d) return;
    const b = td.getBoundingClientRect();
    const side = nearestSide(e.clientX, e.clientY, b.left, b.top, b.right, b.bottom);
    const key = `${r}:${c}:${side}`;
    if (d.done.has(key)) return;
    d.done.add(key);
    d.td = paintEdge(d.td, r, c, side, pen);
    this.showLines(d.td);
  }

  /** The width of the text this table is set in, in points. */
  textWidth(): number { return this.host.textWidth(); }

  /** Border Painter is on (the crosshair over the cells) or off. */
  showPainting(on: boolean): void { this.grid.classList.toggle('si-painting', on); }

  /** Put the typing back in the selected cell (after a command from the ribbon), the cells selected staying selected. */
  refocus(): void {
    const box = this.grid.querySelector<HTMLElement>(`td[data-r="${this.sel.r}"][data-c="${this.sel.c}"] .si-rich`);
    if (!box) return;
    this.refocusing = true;
    try { box.focus({ preventScroll: true }); } finally { this.refocusing = false; }
  }

  private picture(cell: Json): HTMLElement {
    return this.pics.preview(String(cell.image), this.urls, undefined, Number(cell.image_width) || 0);
  }

  private pick(r: number, c: number, extend: boolean): void {
    if (!extend) this.anchor = { r, c };
    const a = this.anchor;
    const o = ownerOf(this.t!, r, c) ?? { r, c, rows: 1, cols: 1 };
    this.sel = extend ? blockAround(this.t!, a.r, a.c, o.r + o.rows - 1, o.c + o.cols - 1) : blockAround(this.t!, r, c, r, c);
    if (extend) this.sel = blockAround(this.t!, Math.min(a.r, o.r), Math.min(a.c, o.c), Math.max(a.r, o.r + o.rows - 1), Math.max(a.c, o.c + o.cols - 1));
    this.showSel();
  }

  private showSel(tell = true): void {
    const s = this.sel;
    for (const td of this.grid.querySelectorAll<HTMLElement>('td')) {
      const r = Number(td.dataset.r), c = Number(td.dataset.c);
      const inSel = s.rows * s.cols > 1 && r >= s.r && r < s.r + s.rows && c >= s.c && c < s.c + s.cols;
      td.classList.toggle('si-tsel', inSel);
      // (the cell's shading, under the selection's color while selected)
      td.style.background = inSel ? '' : td.dataset.fill ?? '';
    }
    if (tell) this.host.selectionChanged(this);
  }

  private selected(): Json | null { return this.t ? cellAt(this.t, this.sel.r, this.sel.c) : null; }

  // ------------------------------------------------------------------ changes

  private save(): Promise<void> {
    this.pending = this.pending.then(async () => {
      try { await this.host.project.writeTable(this.host.section, this.t!); } catch (e) { this.host.flash(`The table could not be saved: ${e instanceof Error ? e.message : String(e)}`); }
    }).then(() => {}, () => {});
    return this.pending;
  }

  /**
   * Change the table, save it, and (`repaint`) show it again with the selection kept where it can
   * be. With a `label` (a Table Design or Cell Size command) it is one step of Undo, named for it:
   * what was typed is saved first, as its own step, and a change the project refuses (it was read
   * again meanwhile) is said and leaves the table as it was.
   */
  private async change(f: () => void, repaint = true, label = ''): Promise<void> {
    if (!this.t) return;
    for (const b of this.boxes) b.commit();
    const apply = () => { f(); squareUp(this.t!); this.cache = null; };
    if (label) {
      await this.pending;
      try {
        await this.host.step(label, async () => { apply(); await this.save(); });
      } catch (e) {
        this.host.flash(e instanceof Error ? e.message : String(e));
        return;
      }
    } else {
      apply();
      await this.save();
    }
    if (!repaint || this.gone) return;
    const rows = rowsOf(this.t).length, n = colCount(this.t);
    const was = this.sel;
    const typing = this.grid.contains(document.activeElement) || document.activeElement === document.body;
    const r = Math.min(was.r, rows - 1), c = Math.min(was.c, n - 1);
    this.paint();
    this.pick(r, c, false);
    // (a block selected stays selected after a command that changes no rows or columns: Borders, Shading, Select Table…)
    if (label && was.r + was.rows <= rows && was.c + was.cols <= n && was.rows * was.cols > 1) {
      this.sel = blockAround(this.t, was.r, was.c, was.r + was.rows - 1, was.c + was.cols - 1);
      this.showSel();
    }
    // (the cells drawn again: the typing goes back to the cell it was in, not to the page)
    if (typing) this.refocus();
  }

  private align(a: Align): Promise<void> {
    return this.change(() => {
      const t = this.t!, s = this.sel;
      const whole = s.r === 0 && s.rows === rowsOf(t).length;
      for (const x of spans(t)) {
        if (x.r < s.r || x.r >= s.r + s.rows || x.c < s.c || x.c >= s.c + s.cols) continue;
        const cell = cellAt(t, x.r, x.c)!;
        if (whole) delete cell.align; else cell.align = a;
      }
      if (whole) for (let c = s.c; c < s.c + s.cols; c++) (t.columns as unknown[])[c] = a;
    });
  }

  // ------------------------------------------------------------------ pictures

  /** A picture (its path in images/) into the cell selected when it was asked for. */
  private async put(at: Span, rel: string | null): Promise<void> {
    if (!rel || !this.t) return;
    const cell = cellAt(this.t, at.r, at.c);
    const w = cell && Number(cell.image_width) > 0 ? Number(cell.image_width) : 0;
    this.sel = at;
    await this.change(() => setPicture(this.t!, at.r, at.c, rel, w));
  }

  private async pictureFile(): Promise<void> { const at = { ...this.sel }; await this.put(at, await this.pics.fromFile('Picture for the cell')); }

  private async pasteButton(): Promise<void> {
    const at = { ...this.sel };
    const p = await this.host.readClipboard().catch(() => null);
    if (p?.kind === 'table') { await this.change(() => pasteCells(this.t!, at.r, at.c, pastedCells(p.rows))); return; }
    await this.put(at, p ? await this.pics.fromPasted(p) : await this.pics.fromClipboard());
  }

  private pasteEvent(e: ClipboardEvent): void {
    const d = e.clipboardData;
    if (!d) return;
    const text = d.getData('text/plain');
    const files = [...d.files].some((f) => f.type.startsWith('image/'));
    // (plain text, one cell's worth, is typed into the cell as usual)
    const cells = /<table[\s>]/i.test(d.getData('text/html')) || /\t|\n.*\S/.test(text.trim());
    const drawing = /<CDXML|^\s*<\?xml/i.test(text);
    if (!files && !cells && !drawing) return;
    e.preventDefault();
    e.stopPropagation();
    const at = { ...this.sel };
    void this.host.readClipboard(e).then(async (p) => {
      if (p.kind === 'table') { await this.change(() => pasteCells(this.t!, at.r, at.c, pastedCells(p.rows))); return; }
      const rel = await this.pics.fromPasted(p);
      if (rel) await this.put(at, rel);
      else if (text) document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '));
    });
  }

  private async drawStructure(): Promise<void> {
    const at = { ...this.sel };
    const cell = this.selected();
    await this.put(at, await this.pics.draw(typeof cell?.image === 'string' ? cell.image : '', 'Table cell picture'));
  }

  private async fromCompound(): Promise<void> {
    const at = { ...this.sel };
    const got = await this.pics.fromCompound();
    if (!got) return;
    await this.put(at, got.rel);
    // its ID in bold under the structure, when the cell has no text yet
    const cell = cellAt(this.t!, at.r, at.c);
    if (cell && !String(cell.text ?? '').trim()) await this.change(() => { cell.text = `**@{${got.id}}**`; });
  }
}
