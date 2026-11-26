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

export interface SiTableHost extends SiPictureHost {
  label(ref: string): string;
  mentionable(): { id: string; label: string; text: string }[];
  /** The cell picked, or the table changed: the ribbon's Table Layout tab shows this table's state. */
  selectionChanged(t: SiTableEditor): void;
  /** Delete the table and its caption (its file goes to the Trash). */
  remove(t: SiTableEditor): Promise<void>;
}

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
    this.el.append(this.grid, this.bottom());
    this.grid.addEventListener('paste', (e) => this.pasteEvent(e), true);
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
    }
  }

  /** What the ribbon shows for the selected cells: the header rows, and the picture's width (null: no picture). */
  get state(): { headRows: number; rows: number; width: number | null } {
    const cell = this.selected();
    return {
      headRows: this.t ? Math.max(0, Math.round(Number(this.t.header_rows ?? 1)) || 0) : 0,
      rows: this.t ? rowsOf(this.t).length : 0,
      width: cell?.image ? Math.max(0, Number(cell.image_width) || 0) : null,
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
        box.el.addEventListener('focus', () => { if (!this.shift) this.pick(s.r, s.c, false); });
        td.addEventListener('mousedown', (e) => { this.shift = e.shiftKey; if (e.shiftKey) { e.preventDefault(); this.pick(s.r, s.c, true); } });
        td.addEventListener('mouseup', () => { this.shift = false; });
        this.boxes.push(box);
        td.append(box.el);
        tr.append(td);
      }
      body.append(tr);
    });
    this.grid.replaceChildren(body);
    this.showSel();
  }
  private shift = false;

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

  private showSel(): void {
    const s = this.sel;
    for (const td of this.grid.querySelectorAll<HTMLElement>('td')) {
      const r = Number(td.dataset.r), c = Number(td.dataset.c);
      td.classList.toggle('si-tsel', s.rows * s.cols > 1 && r >= s.r && r < s.r + s.rows && c >= s.c && c < s.c + s.cols);
    }
    this.host.selectionChanged(this);
  }

  private selected(): Json | null { return this.t ? cellAt(this.t, this.sel.r, this.sel.c) : null; }

  // ------------------------------------------------------------------ changes

  private save(): Promise<void> {
    this.pending = this.pending.then(async () => {
      try { await this.host.project.writeTable(this.host.section, this.t!); } catch (e) { this.host.flash(`The table could not be saved: ${e instanceof Error ? e.message : String(e)}`); }
    }).then(() => {}, () => {});
    return this.pending;
  }

  /** Change the table, save it, and (`repaint`) show it again with the selection kept where it can be. */
  private async change(f: () => void, repaint = true): Promise<void> {
    if (!this.t) return;
    for (const b of this.boxes) b.commit();
    f();
    squareUp(this.t);
    await this.save();
    if (!repaint) return;
    const rows = rowsOf(this.t).length, n = colCount(this.t);
    const r = Math.min(this.sel.r, rows - 1), c = Math.min(this.sel.c, n - 1);
    this.paint();
    this.pick(r, c, false);
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
