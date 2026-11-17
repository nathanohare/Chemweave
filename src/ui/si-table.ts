// A table in an SI project's text, edited in the SI tab (SPEC §13k.5, as SI Assistant's table
// editor does it): cells with their formatting and mentions, rows and columns, merged cells,
// header rows, cell and column alignment, footnotes, the label, and pictures in cells. A cell's
// picture comes from a file, from the clipboard (a ChemDraw or Chemweave drawing is kept as a
// vector SVG with its CDXML beside it, so it can be drawn again), from the drawing tools
// (Draw Structure…) or from a compound of the project. Cells copied from Excel or Word paste in
// as cells. Every change is saved to the table's file at once.

import type { Contents, Doc } from '../model';
import type { Pasted } from '../io/clipboard';
import type { Json, SiProject, SiSection } from '../si/project';
import { blockAround, cellAt, colCount, deleteColumn, deleteRow, footnotesOf, insertColumn, insertRow, merge, ownerOf, pasteCells, pastedCells, rowsOf, setPicture, spans, split, squareUp, type Align, type Span } from '../si/tables';
import { SiRichBox } from './si-rich';
import { addInfo } from './info-tip';

export interface SiTableHost {
  project: SiProject;
  section: SiSection;
  flash(msg: string): void;
  label(ref: string): string;
  mentionable(): { id: string; label: string; text: string }[];
  pickFiles(label: string, exts: string[]): Promise<{ name: string; bytes: Uint8Array }[]>;
  editStructure(contents: Contents | null, title: string, done: (c: Contents | null) => void): void;
  /** A drawing as an SVG picture and as CDXML (to draw it again), or null when it is empty. */
  drawingFiles(d: Contents | Doc): { svg: string; cdxml: string } | null;
  /** A CDXML drawing (a cell picture's original) as a drawing. */
  contentsOfCdxml(text: string): Contents | null;
  /** What is on the clipboard: from a paste event, or read (the Paste button). */
  readClipboard(e?: ClipboardEvent): Promise<Pasted>;
  /** One of the project's compounds with a structure, picked; null when cancelled. */
  pickCompound(): Promise<{ id: string; mol: string } | null>;
  contentsOf(mol: string): Contents | null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };
const extOf = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** One table's editor: its toolbar, grid, label and footnotes. */
export class SiTableEditor {
  readonly el: HTMLElement;
  private t: Json | null = null;
  private sel: Span = { r: 0, c: 0, rows: 1, cols: 1 };
  private anchor: { r: number; c: number } = { r: 0, c: 0 };
  private boxes: SiRichBox[] = [];
  private urls: string[] = [];
  private grid = el('table', 'si-tgrid');
  private width = el('input', 'si-num');
  private headRows = el('input', 'si-num');
  private notes: HTMLElement = el('div');
  private noteBox: SiRichBox | null = null;
  private labelBox = el('input', 'si-label-input');
  private title = el('span');

  constructor(private host: SiTableHost, readonly id: string, title: string) {
    this.el = el('div', 'si-card si-table-card');
    this.el.dataset.table = id;
    const h = el('h3', 'si-sub');
    h.append(this.title);
    this.title.textContent = title;
    addInfo(h, 'The table as it prints, with its caption on the line under it in the text. Click a cell to type in it; Shift+click another to pick a block (to merge it, or align it). Ctrl+V in a cell pastes cells from Excel or Word, or a picture or ChemDraw drawing into the cell.');
    this.el.append(h);
  }

  /** Read the table and show it. */
  async load(): Promise<void> {
    const t = await this.host.project.readTable(this.host.section, this.id);
    if (!t) { this.el.append(el('p', 'muted si-note', `This table’s file (tables/${this.id}.json) is missing or could not be read.`)); return; }
    this.t = t;
    squareUp(t);
    this.el.append(this.toolbar(), this.pictureBar(), this.grid, this.bottom());
    this.grid.addEventListener('paste', (e) => this.pasteEvent(e), true);
    this.paint();
  }

  /** Save what is being typed. */
  commit(): void {
    for (const b of this.boxes) b.commit();
    this.noteBox?.commit();
  }

  /** Mentions show their compounds' IDs (and tables' labels) as they are now. */
  relabel(): void {
    for (const b of this.boxes) b.relabel();
    this.noteBox?.relabel();
  }

  /** The table's label as the compiled SI gives it. */
  setTitle(label: string): void { if (label) this.title.textContent = label; }

  focus(): void {
    this.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.boxes[0]?.el.focus();
  }

  // ------------------------------------------------------------------ the parts

  private button(label: string, title: string, run: () => void | Promise<void>): HTMLButtonElement {
    const b = el('button', 'si-btn', label);
    b.type = 'button';
    b.title = title;
    // (the cell keeps its place: the button doesn't take the focus)
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => void run());
    return b;
  }

  private group(...kids: HTMLElement[]): HTMLElement {
    const g = el('span', 'si-tgroup');
    g.append(...kids);
    return g;
  }

  private toolbar(): HTMLElement {
    const bar = el('div', 'si-tbar');
    const r = () => this.sel;
    bar.append(
      this.group(
        this.button('Insert Above', 'Insert a row above the selected cells', () => this.change(() => insertRow(this.t!, r().r))),
        this.button('Insert Below', 'Insert a row below the selected cells', () => this.change(() => insertRow(this.t!, r().r + r().rows))),
        this.button('Insert Left', 'Insert a column to the left of the selected cells', () => this.change(() => insertColumn(this.t!, r().c))),
        this.button('Insert Right', 'Insert a column to the right of the selected cells', () => this.change(() => insertColumn(this.t!, r().c + r().cols))),
      ),
      this.group(
        this.button('Delete Rows', 'Delete the selected rows', () => this.change(() => { for (let i = r().rows - 1; i >= 0; i--) deleteRow(this.t!, r().r + i); })),
        this.button('Delete Columns', 'Delete the selected columns', () => this.change(() => { for (let i = r().cols - 1; i >= 0; i--) deleteColumn(this.t!, r().c + i); })),
      ),
      this.group(
        this.button('Merge Cells', 'Merge the selected cells into one (their texts joined; the first picture kept)', () => {
          if (this.sel.rows * this.sel.cols < 2) { this.host.flash('Shift+click a second cell to pick the cells to merge.'); return; }
          return this.change(() => merge(this.t!, this.sel));
        }),
        this.button('Split Cells', 'Split the selected merged cell back into single cells', () => this.change(() => split(this.t!, r().r, r().c))),
      ),
      this.group(
        this.button('Left', 'Align the selected cells’ text left (a whole column: the column)', () => this.align('left')),
        this.button('Center', 'Center the selected cells’ text (a whole column: the column)', () => this.align('center')),
        this.button('Right', 'Align the selected cells’ text right (a whole column: the column)', () => this.align('right')),
      ),
    );
    const head = el('label', 'si-part');
    this.headRows.type = 'number';
    this.headRows.min = '0';
    this.headRows.max = '9';
    this.headRows.addEventListener('change', () => void this.change(() => { this.t!.header_rows = Math.max(0, Math.min(rowsOf(this.t!).length, Math.round(Number(this.headRows.value) || 0))); }));
    head.append('Header rows', this.headRows);
    head.title = 'How many rows at the top are the header (a rule under them, repeated on a new page)';
    bar.append(head);
    return bar;
  }

  private pictureBar(): HTMLElement {
    const bar = el('div', 'si-tbar');
    const lead = el('span', 'si-tlead', 'Cell picture');
    bar.append(lead, this.group(
      this.button('Picture…', 'Put a picture file (PNG, JPG, SVG or PDF) in the selected cell, above its text', () => this.pictureFile()),
      this.button('Paste', 'Paste the copied picture or drawing (ChemDraw or Chemweave, kept as a vector picture you can draw again) into the selected cell', () => this.pasteButton()),
      this.button('Draw Structure…', 'Draw a structure or scheme for the selected cell with the drawing tools (its picture, drawn again when it has one made here)', () => this.drawStructure()),
      this.button('Compound…', 'Put a compound’s structure in the selected cell, with its ID under it', () => this.fromCompound()),
      this.button('Remove Picture', 'Take the picture out of the selected cell (its file stays in images/)', () => this.change(() => setPicture(this.t!, this.sel.r, this.sel.c, ''))),
    ));
    const w = el('label', 'si-part');
    this.width.type = 'number';
    this.width.min = '0';
    this.width.step = '0.1';
    this.width.placeholder = 'own';
    this.width.addEventListener('change', () => {
      const cell = this.selected();
      if (!cell?.image) { this.host.flash('The selected cell has no picture.'); return; }
      void this.change(() => setPicture(this.t!, this.sel.r, this.sel.c, String(cell.image), Math.max(0, Number(this.width.value) || 0)));
    });
    w.append('Width', this.width, 'cm');
    w.title = 'The picture’s printed width (empty: its own size, never wider than the text)';
    bar.append(w);
    return bar;
  }

  private bottom(): HTMLElement {
    const box = el('div', 'si-tbottom');
    const lab = el('label', 'si-part');
    this.labelBox.value = String(this.t!.label ?? '');
    this.labelBox.placeholder = 'Table S1 (automatic)';
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
    this.urls = [];
    this.boxes = [];
    const head = Math.max(0, Math.round(Number(t.header_rows ?? 1)) || 0);
    this.headRows.value = String(head);
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
    const box = el('div', 'si-tpic');
    const name = String(cell.image);
    const ext = extOf(name);
    if (!MIME[ext]) { box.textContent = `[${name.slice(name.lastIndexOf('/') + 1)}]`; return box; }
    void this.host.project.readSectionFile(this.host.section, name).then((bytes) => {
      if (!bytes) { box.textContent = `[missing: ${name.slice(name.lastIndexOf('/') + 1)}]`; box.classList.add('si-missing'); return; }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] }));
      this.urls.push(url);
      const img = el('img');
      img.src = url;
      img.alt = 'Cell picture';
      const w = Number(cell.image_width);
      // (about the printed size, at a third of it: the grid is a preview)
      if (w > 0) img.style.width = `${Math.round((w / 2.54) * 96 * 0.5)}px`;
      box.append(img);
    });
    return box;
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
    const cell = this.selected();
    this.width.value = cell?.image && Number(cell.image_width) > 0 ? String(cell.image_width) : '';
    this.width.disabled = !cell?.image;
  }

  private selected(): Json | null { return this.t ? cellAt(this.t, this.sel.r, this.sel.c) : null; }

  // ------------------------------------------------------------------ changes

  private async save(): Promise<void> {
    try { await this.host.project.writeTable(this.host.section, this.t!); } catch (e) { this.host.flash(`The table could not be saved: ${e instanceof Error ? e.message : String(e)}`); }
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

  /** Put a picture's files in images/ and in the selected cell. */
  private async place(name: string, bytes: Uint8Array, others: Record<string, Uint8Array> = {}): Promise<void> {
    const at = { ...this.sel };
    const rel = await this.host.project.addSectionPicture(this.host.section, name, bytes, others);
    const cell = cellAt(this.t!, at.r, at.c);
    const w = cell && Number(cell.image_width) > 0 ? Number(cell.image_width) : 0;
    this.sel = at;
    await this.change(() => setPicture(this.t!, at.r, at.c, rel, w));
  }

  private async pictureFile(): Promise<void> {
    const [f] = await this.host.pickFiles('Picture for the cell', ['png', 'jpg', 'jpeg', 'svg', 'pdf']);
    if (f) await this.place(f.name, f.bytes);
  }

  private async drawing(d: Contents | Doc, name: string): Promise<boolean> {
    const files = this.host.drawingFiles(d);
    if (!files) { this.host.flash('Nothing was drawn, so the cell is as it was.'); return false; }
    await this.place(name, enc(files.svg), { cdxml: enc(files.cdxml) });
    return true;
  }

  /** What was pasted, into the table: cells from Excel or Word, or a picture or drawing in the selected cell. */
  private async pasted(p: Pasted): Promise<boolean> {
    if (p.kind === 'drawing') return this.drawing(p.doc, 'pasted picture.svg');
    if (p.kind === 'table') { const at = { ...this.sel }; await this.change(() => pasteCells(this.t!, at.r, at.c, pastedCells(p.rows))); return true; }
    if (p.kind === 'picture') {
      if (p.mime === 'image/png' || p.mime === 'image/jpeg') { await this.place(`pasted picture.${p.mime === 'image/png' ? 'png' : 'jpg'}`, p.bytes); return true; }
      if (p.mime === 'image/svg+xml') { await this.place('pasted picture.svg', p.bytes); return true; }
      if (p.mime === 'image/x-emf') {
        // a metafile (ChemDraw, MestReNova): drawn as SVG, the metafile kept beside it as SI Assistant keeps originals
        const { emfToSvg } = await import('../render/emf-read');
        const svg = emfToSvg(p.bytes)?.svg;
        if (svg) { await this.place('pasted picture.svg', enc(svg), { emf: p.bytes }); return true; }
      }
      const png = await toPng(p.bytes, p.mime);
      if (png) { await this.place('pasted picture.png', png); return true; }
      this.host.flash('This picture could not be read.');
      return true;
    }
    return false;
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
    void this.host.readClipboard(e).then((p) => this.pasted(p)).then((done) => {
      if (!done && text) document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '));
    });
  }

  private async pasteButton(): Promise<void> {
    let p: Pasted;
    try { p = await this.host.readClipboard(); } catch (e) { this.host.flash(`The clipboard could not be read: ${e instanceof Error ? e.message : String(e)}`); return; }
    if (!(await this.pasted(p))) this.host.flash('The clipboard has no picture, drawing or cells. Copy a structure in ChemDraw or Chemweave, a picture, or cells in Excel or Word first.');
  }

  private drawStructure(): void {
    const cell = this.selected();
    const at = { ...this.sel };
    const image = typeof cell?.image === 'string' ? cell.image : '';
    const again = image ? image.replace(/\.[^./]+$/, '.cdxml') : '';
    void (again && again !== image ? this.host.project.readSectionFile(this.host.section, again) : Promise.resolve(null)).then((bytes) => {
      const contents = bytes ? this.host.contentsOfCdxml(new TextDecoder().decode(bytes)) : null;
      if (image && !contents) this.host.flash('This picture wasn’t drawn here, so you start a new drawing; it replaces the picture when you finish.');
      this.host.editStructure(contents, 'Table cell picture', (got) => {
        if (!got || !got.atoms.length && !got.arrows.length && !got.captions.length && !got.shapes.length) return;
        this.sel = at;
        void this.drawing(got, 'structure.svg');
      });
    });
  }

  private async fromCompound(): Promise<void> {
    const at = { ...this.sel };
    const got = await this.host.pickCompound();
    if (!got) return;
    const contents = this.host.contentsOf(got.mol);
    if (!contents) { this.host.flash('That compound’s structure could not be read.'); return; }
    this.sel = at;
    if (!(await this.drawing(contents, 'structure.svg'))) return;
    // its ID in bold under the structure, when the cell has no text yet
    const cell = cellAt(this.t!, at.r, at.c);
    if (cell && !String(cell.text ?? '').trim()) await this.change(() => { cell.text = `**@{${got.id}}**`; });
  }
}

/** A picture the browser can show (a bitmap) as PNG bytes. */
async function toPng(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
