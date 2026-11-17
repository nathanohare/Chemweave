// An X-ray structure section's page in an SI project (SPEC §13v): its CIF and the compound it
// shows, the structure as it prints (turned and styled in Chemweave's crystal structure window,
// its view saved back as SI Assistant stores it), the figure caption, and the crystal data table
// (printed or not, its width, its caption, each row's value typed over or left out). The ribbon's
// Crystal Structure tab chooses the CIF, opens the window, and copies or saves the picture.

import type { Json, SiProject, SiSection } from '../si/project';
import type { CifBlock } from '../chem/cif';
import type { CrystalSpec } from '../design/xray';
import { SiRichBox } from './si-rich';
import { addInfo } from './info-tip';
import { marksHtml, marksPlain } from '../chem/crystal';

export interface SiXrayHost {
  project: SiProject;
  section: SiSection;
  flash(msg: string, ms?: number): void;
  pickFiles(label: string, exts: string[]): Promise<{ name: string; bytes: Uint8Array }[]>;
  label(ref: string): string;
  mentionable(): { id: string; label: string; text: string }[];
  /** The project's compounds for the "Shows" list: id and how it is listed. */
  compounds(): { id: string; label: string }[];
  /** A compound's ID as shown now ("2a"), or '??'. */
  idOf(id: string): string;
  /** The page is drawn again after a change of file, block or compound. */
  redraw(): void;
  /** Put text on the clipboard as plain text and HTML (the crystal data table). */
  copyRich(text: string, html: string): Promise<void>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const dict = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
/** Most of the text's width the page shows the drawing at (points), as the compiled SI does. */
const PAGE_W = 460;

export class SiXrayPage {
  readonly el = el('div', 'si-xray');
  readonly boxes: SiRichBox[] = [];
  private block: CifBlock | null = null;
  private drawn: { spec: CrystalSpec; w: number; h: number } | null = null;

  constructor(private host: SiXrayHost) {
    void this.build();
  }

  private get s(): SiSection { return this.host.section; }
  private get data(): Json { return this.s.data; }

  private async save(change: Json, redraw = false): Promise<void> {
    for (const [k, v] of Object.entries(change)) { if (v === undefined) delete this.data[k]; else this.data[k] = v; }
    try { await this.host.project.saveSection(this.s); } catch (e) { this.host.flash(`The change could not be saved: ${e instanceof Error ? e.message : String(e)}`, 8000); }
    if (redraw) this.host.redraw();
  }

  private async build(): Promise<void> {
    const p = this.host.project;
    const fig = el('div', 'si-card');
    const h = el('h3', 'si-sub', 'X-ray structure');
    addInfo(h, 'The structure as it prints, with its figure caption. Crystal Structure ▸ Edit Structure (or double-click it) turns it, changes its style, labels and what is shown; Choose CIF uses another file (the one it replaces goes to the Trash).');
    fig.append(h);
    this.el.append(fig);
    // the file, the structure in it, the compound it shows
    const row = el('div', 'si-parts');
    const file = str(this.data.file);
    const fileBit = el('span', 'si-part');
    fileBit.append(el('span', 'muted', 'CIF'), el('b', '', file || 'none chosen yet'));
    const blockSel = el('select');
    blockSel.setAttribute('aria-label', 'Structure in the file');
    const blockBit = el('label', 'si-part');
    blockBit.append('Structure', blockSel);
    blockBit.hidden = true;
    const cpd = el('select');
    cpd.add(new Option('(none)', ''));
    for (const c of this.host.compounds()) cpd.add(new Option(c.label, c.id));
    cpd.value = str(this.data.compound);
    cpd.addEventListener('change', () => void this.save({ compound: cpd.value }, true));
    const cpdBit = el('label', 'si-part');
    cpdBit.title = 'The compound the structure shows: its ID is in the automatic captions, and follows renumbering';
    cpdBit.append('Shows', cpd);
    row.append(fileBit, blockBit, cpdBit);
    fig.append(row);
    if (!file) { fig.append(el('p', 'muted si-note', 'No CIF file yet: Crystal Structure ▸ Choose CIF on the ribbon.')); return; }
    const pic = el('div', 'si-xray-pic');
    pic.title = 'Double-click to turn it or change its look (Crystal Structure ▸ Edit Structure)';
    pic.addEventListener('dblclick', () => void this.command('edit'));
    fig.append(pic);
    const capRow = el('div', 'si-xray-caprow');
    const auto = el('input');
    auto.type = 'checkbox';
    const autoLab = el('label', 'si-part');
    autoLab.append(auto, 'Automatic caption');
    autoLab.title = 'Made from how it is drawn and the CCDC number; untick to type your own (it starts from the automatic one)';
    capRow.append(autoLab);
    fig.append(capRow);
    const capBox = el('div');
    fig.append(capBox);

    const [{ xrayBlock, xrayDrawing, xrayAutoCaption, xrayCompound, xrayTableCaption }, { crystalSvg }, { crystalTable }, { readCif }] = await Promise.all([import('../si/xray'), import('../design/xray'), import('../chem/crystal'), import('../chem/cif')]);
    const cif = await p.folder.readText(`${this.s.folder}/${file}`);
    if (cif === null) { pic.replaceWith(el('p', 'muted si-note', `${file} is no longer in the project.`)); return; }
    const blocks = readCif(cif).filter((b) => b.rows('_atom_site_label').length);
    if (blocks.length > 1) {
      blocks.forEach((b, i) => blockSel.add(new Option(b.name || `(structure ${i + 1})`, b.name)));
      blockSel.value = str(this.data.block) || blocks[0].name;
      blockSel.addEventListener('change', () => void this.save({ block: blockSel.value, view: {} }, true));
      blockBit.hidden = false;
    }
    const { block, error } = xrayBlock(cif, str(this.data.block));
    this.block = block;
    const got = block ? xrayDrawing(block, dict(this.data.view), PAGE_W) : { error };
    if ('error' in got) { pic.replaceWith(el('p', 'muted si-note', `It can’t be drawn: ${got.error}.`)); return; }
    this.drawn = got;
    const img = el('img');
    img.alt = `Crystal structure ${this.s.name}`;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(crystalSvg(got.spec, got.w, got.h));
    img.style.width = `${got.w * (96 / 72)}px`;
    pic.append(img);

    // the figure caption: automatic, or typed
    const ref = xrayCompound(this.data, (id) => p.compounds.some((c) => c.id === id));
    const typedValues = dict(this.data.table_values);
    const cifRows = crystalTable(block!, true);
    const ccdcRow = cifRows.find(([k]) => k === 'ccdc');
    const ccdc = (str(typedValues.ccdc).trim() || ccdcRow?.[2]) ?? '';
    const autoText = xrayAutoCaption(got.spec.view, ref, ccdc);
    const showCaption = (): void => {
      const typed = str(this.data.caption).trim();
      auto.checked = !typed;
      capBox.replaceChildren();
      if (!typed) { capBox.append(el('p', 'si-xray-caption muted', this.mentionsShown(autoText))); return; }
      const box = new SiRichBox(typed, { label: this.host.label, mentionable: this.host.mentionable, changed: (v) => void this.save({ caption: v.trim() || undefined }) }, false, 'The figure caption');
      this.boxes.push(box);
      capBox.append(box.el);
    };
    auto.addEventListener('change', () => void this.save({ caption: auto.checked ? '' : autoText }).then(showCaption));
    showCaption();

    // the crystal data table
    const tc = el('div', 'si-card');
    const th = el('h3', 'si-sub', 'Crystal data table');
    addInfo(th, 'Printed under the figure with its own label (Table S…). Type over a value to change it (shown in bold; empty it to go back to the CIF’s); untick a row to leave it out. A row with no value is not printed.');
    tc.append(th);
    const opts = el('div', 'si-parts');
    const print = el('input');
    print.type = 'checkbox';
    print.checked = this.data.table !== false;
    print.addEventListener('change', () => void this.save({ table: print.checked }));
    const printLab = el('label', 'si-part');
    printLab.append(print, 'Print the table');
    // its width: as its contents need (the default), the text's width, or a share of it
    const widthSel = el('select');
    widthSel.setAttribute('aria-label', 'Table width');
    for (const [v, l] of [['fit', 'Fit to contents'], ['full', 'Full text width'], ['pct', 'Percent of text width']]) widthSel.add(new Option(l, v));
    const pct = el('input', 'si-num');
    pct.type = 'number';
    pct.min = '20';
    pct.max = '100';
    pct.step = '5';
    pct.setAttribute('aria-label', 'Percent of the text width');
    const w = Number(this.data.table_width) || 0;
    widthSel.value = !w ? 'fit' : w >= 100 ? 'full' : 'pct';
    pct.value = w && w < 100 ? String(w) : '70';
    pct.hidden = widthSel.value !== 'pct';
    const saveWidth = (): void => {
      pct.hidden = widthSel.value !== 'pct';
      const n = Math.max(20, Math.min(100, Number(pct.value) || 70));
      void this.save({ table_width: widthSel.value === 'fit' ? undefined : widthSel.value === 'full' ? 100 : n });
    };
    widthSel.addEventListener('change', saveWidth);
    pct.addEventListener('change', saveWidth);
    const widthLab = el('label', 'si-part');
    widthLab.title = 'How wide the table prints';
    widthLab.append('Width', widthSel, pct);
    opts.append(printLab, widthLab);
    tc.append(opts);
    // its caption
    const tcapAuto = el('input');
    tcapAuto.type = 'checkbox';
    const tcapLab = el('label', 'si-part');
    tcapLab.append(tcapAuto, 'Automatic caption');
    const tcapBox = el('div');
    const tAutoText = xrayTableCaption({}, ref);
    const showTableCaption = (): void => {
      const typed = str(this.data.table_caption).trim();
      tcapAuto.checked = !typed;
      tcapBox.replaceChildren();
      if (!typed) { tcapBox.append(el('p', 'si-xray-caption muted', this.mentionsShown(tAutoText))); return; }
      const box = new SiRichBox(typed, { label: this.host.label, mentionable: this.host.mentionable, changed: (v) => void this.save({ table_caption: v.trim() || undefined }) }, false, 'The table caption');
      this.boxes.push(box);
      tcapBox.append(box.el);
    };
    tcapAuto.addEventListener('change', () => void this.save({ table_caption: tcapAuto.checked ? '' : tAutoText }).then(showTableCaption));
    showTableCaption();
    tc.append(tcapLab, tcapBox);
    // its rows
    const grid = el('div', 'si-xray-rows');
    const hidden = new Set(Array.isArray(this.data.table_hidden) ? (this.data.table_hidden as unknown[]).map(String) : []);
    for (const [key, label, cifValue] of cifRows) {
      const r = el('div', 'si-xray-row');
      const tick = el('input');
      tick.type = 'checkbox';
      tick.checked = !hidden.has(key);
      tick.title = 'Print this row';
      tick.addEventListener('change', () => {
        const now = new Set(Array.isArray(this.data.table_hidden) ? (this.data.table_hidden as unknown[]).map(String) : []);
        if (tick.checked) now.delete(key); else now.add(key);
        void this.save({ table_hidden: now.size ? [...now] : undefined });
      });
      const name = el('span', 'si-xray-label');
      name.innerHTML = marksHtml(label);
      const value = el('input', 'si-xray-value');
      value.value = str(typedValues[key]);
      value.placeholder = cifValue ? marksPlain(cifValue) : '(none in the CIF: type it)';
      value.classList.toggle('si-typed', !!value.value);
      value.setAttribute('aria-label', marksPlain(label));
      value.addEventListener('change', () => {
        const typed = { ...dict(this.data.table_values) };
        const v = value.value.trim();
        // (typing the CIF's own value back stores nothing)
        if (v && v !== cifValue && v !== marksPlain(cifValue)) typed[key] = v; else delete typed[key];
        value.classList.toggle('si-typed', key in typed);
        void this.save({ table_values: typed });
      });
      r.append(tick, name, value);
      grid.append(r);
    }
    tc.append(grid);
    this.el.append(tc);
  }

  /** Mentions in stored text as the compounds' IDs (for a caption shown as text). */
  private mentionsShown(text: string): string {
    return text.replace(/@\{(c-[^}]*)\}/g, (_m, id: string) => this.host.idOf(id)).replace(/\*\*/g, '');
  }

  /** The ribbon's Crystal Structure commands. */
  async command(cmd: string): Promise<void> {
    if (cmd === 'choose-cif') return this.chooseCif();
    if (cmd === 'copy-table') return this.copyTable();
    if (!this.drawn) { this.host.flash(str(this.data.file) ? 'The structure can’t be drawn, so there is nothing to show.' : 'Choose the CIF file first (Crystal Structure ▸ Choose CIF).'); return; }
    if (cmd === 'edit') return this.edit();
    const { crystalSvg, crystalItems } = await import('../design/xray');
    const { spec, w, h } = this.drawn;
    const svg = crystalSvg(spec, w, h);
    if (cmd === 'copy-svg') {
      const { copySvg } = await import('../io/clipboard');
      this.host.flash(await copySvg(svg).catch((e: unknown) => `Could not copy: ${String(e)}`));
    } else if (cmd === 'copy-picture') {
      const { copyPictureItems } = await import('../io/clipboard');
      const canvas = await svgCanvas(svg, w, h, 300);
      this.host.flash(await copyPictureItems(crystalItems(spec, w, h), { x1: 0, y1: 0, x2: w, y2: h }, canvas, 300).catch((e: unknown) => `Could not copy: ${String(e)}`));
    } else if (cmd === 'save-picture') {
      const { saveFileDialog, writeFile, SVG, PICTURE } = await import('../io/files');
      const got = await saveFileDialog(`${this.s.name || 'crystal structure'}.svg`, [SVG, PICTURE]).catch(() => null);
      if (!got) return;
      if (/\.png$/i.test(got.name)) {
        const canvas = await svgCanvas(svg, w, h, 300);
        const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
        if (!blob) { this.host.flash('The picture could not be made.'); return; }
        await writeFile(got.ref, got.name, new Uint8Array(await blob.arrayBuffer()), PICTURE);
      } else await writeFile(got.ref, got.name, svg, SVG);
      this.host.flash(`Saved ${got.name}.`);
    }
  }

  private async chooseCif(): Promise<void> {
    const [f] = await this.host.pickFiles('The structure’s CIF file', ['cif']);
    if (!f) return;
    try {
      const name = await this.host.project.attachSectionFile(this.s, f.name, f.bytes);
      this.host.flash(`${name} is the structure’s CIF now (a copy is kept in the project folder).`);
    } catch (e) {
      this.host.flash(`The CIF could not be used: ${e instanceof Error ? e.message : String(e)}`, 8000);
    }
    this.host.redraw();
  }

  /** The crystal data table as printed (rows left out stay out), for Word or Excel. */
  private async copyTable(): Promise<void> {
    if (!this.block) { this.host.flash('Choose the CIF file first (Crystal Structure ▸ Choose CIF).'); return; }
    const { xrayTableRows } = await import('../si/xray');
    const rows = xrayTableRows(this.data, this.block);
    await this.host.copyRich(rows.map(([, l, v]) => `${marksPlain(l)}\t${marksPlain(v)}`).join('\n'), `<table>${rows.map(([, l, v]) => `<tr><td>${marksHtml(l)}</td><td>${marksHtml(v)}</td></tr>`).join('')}</table>`);
    this.host.flash('Copied the crystal data table: paste it into Word, Excel or a document here.');
  }

  /** Chemweave's crystal structure window on this structure; its view is saved back, at the size chosen there. */
  private async edit(): Promise<void> {
    if (!this.drawn || !this.block) return;
    const [{ askCrystal }, { newPlate }, { fittingZoom }, { storedView }, { crystalTable }, { readCif }] = await Promise.all([import('./crystal-dialog'), import('../design/plates'), import('../design/xray'), import('../si/xray'), import('../chem/crystal'), import('../chem/cif')]);
    let picked: { name: string; text: string; bytes: Uint8Array } | null = null;
    const { spec, w, h } = this.drawn;
    const editing = { ...newPlate('crystal', 14.4), w, h, crystal: { ...structuredClone(spec), table: crystalTable(this.block).map(([, l, v]) => [l, v] as [string, string]) } };
    const got = await askCrystal(editing, 14.4, {
      pickFile: async () => {
        const [f] = await this.host.pickFiles('The structure’s CIF file', ['cif']);
        if (!f) return null;
        picked = { name: f.name, text: new TextDecoder().decode(f.bytes), bytes: f.bytes };
        return { name: f.name, text: picked.text };
      },
      copy: (text, html) => this.host.copyRich(text, html),
    });
    if (!got?.crystal) return;
    const c = got.crystal;
    if (picked) {
      const file = picked as { name: string; text: string; bytes: Uint8Array };
      try { await this.host.project.attachSectionFile(this.s, file.name, file.bytes); } catch (e) { this.host.flash(`The CIF could not be used: ${e instanceof Error ? e.message : String(e)}`, 8000); return; }
      const first = readCif(file.text).filter((b) => b.rows('_atom_site_label').length)[0]?.name ?? '';
      if (c.name !== first) this.data.block = c.name;
    } else if (c.name && c.name !== (this.block.name ?? '')) this.data.block = c.name;
    await this.save({ view: storedView(c.view, fittingZoom(c, c.view, got.w, got.h)) }, true);
  }
}

/** An SVG drawn on a canvas at `dpi` (for a bitmap copy of the picture). */
async function svgCanvas(svg: string, w: number, h: number, dpi: number): Promise<HTMLCanvasElement> {
  const k = dpi / 72;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
