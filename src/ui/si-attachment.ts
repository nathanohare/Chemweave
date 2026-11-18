// An Attachment section's page in the SI Project tab: a whole PDF or picture printed as a section
// of its own (a crystal report, a page of HPLC traces). Its file (a copy kept in the section's
// folder; the one it replaces goes to the Trash), the heading printed over it ('' = none) and the
// caption under it, as SI Assistant keeps them in section.json ("file", "heading", "caption"). The
// preview shows the pages as they print: a PDF's pages fill the text width, a picture prints at
// its own size, shrunk to fit.

import type { SiProject, SiSection } from '../si/project';
import { addInfo } from './info-tip';

export interface SiAttachmentHost {
  project: SiProject;
  section: SiSection;
  flash(text: string, ms?: number): void;
  pickFiles(label: string, exts: string[]): Promise<{ name: string; bytes: Uint8Array }[]>;
  pdfPages(bytes: Uint8Array): Promise<{ src: string; w: number; h: number }[] | null>;
  /** The page is drawn again (after a new file). */
  redraw(): void;
}

export const ATTACHMENT_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'svg', 'gif', 'bmp', 'tif', 'tiff'];
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', gif: 'image/gif', bmp: 'image/bmp' };
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class SiAttachmentPage {
  readonly el = el('div', 'si-card si-attach');
  private urls: string[] = [];

  constructor(private host: SiAttachmentHost) {
    void this.draw();
  }

  private get s(): SiSection { return this.host.section; }

  /** Attachment ▸ Choose File (or a file dropped or pasted on the page). */
  async choose(): Promise<void> {
    const [f] = await this.host.pickFiles('The file to print as this section (PDF or picture)', ATTACHMENT_EXTS);
    if (f) await this.use(f.name, f.bytes);
  }

  /** Use a file: copied into the section's folder; the one it replaces goes to the Trash. */
  async use(name: string, bytes: Uint8Array): Promise<void> {
    const ext = (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase();
    if (!ATTACHMENT_EXTS.includes(ext)) { this.host.flash(`${name} is not a PDF or a picture, so it can't be printed as a section.`, 6000); return; }
    try {
      const kept = await this.host.project.attachSectionFile(this.s, name, bytes);
      this.host.flash(`${kept} is this section's file now (a copy is kept in the project folder).`);
    } catch (e) {
      this.host.flash(`The file could not be used: ${e instanceof Error ? e.message : String(e)}`, 8000);
    }
    this.host.redraw();
  }

  /** Attachment ▸ Remove File: the file goes to the Trash (Home ▸ Trash puts it back). */
  async remove(): Promise<void> {
    const p = this.host.project;
    const file = str(this.s.data.file);
    if (!file) return;
    try {
      await p.trashFiles([`${this.s.folder}/${file}`], 'file', file, { section_id: this.s.id, section_name: this.s.name });
      this.s.data.file = null;
      await p.saveSection(this.s);
      this.host.flash(`${file} went to the Trash.`);
    } catch (e) {
      this.host.flash(`The file could not be removed: ${e instanceof Error ? e.message : String(e)}`, 8000);
    }
    this.host.redraw();
  }

  private async save(key: 'heading' | 'caption', value: string): Promise<void> {
    if (this.host.project.readOnly) return;
    this.s.data[key] = value;
    try { await this.host.project.saveSection(this.s); } catch (e) { this.host.flash(`Could not save: ${e instanceof Error ? e.message : String(e)}`, 6000); }
  }

  dispose(): void { for (const u of this.urls) URL.revokeObjectURL(u); this.urls = []; }

  private async draw(): Promise<void> {
    const p = this.host.project;
    const file = str(this.s.data.file);
    const h = el('h3', 'si-sub', 'Attachment');
    addInfo(h, 'A whole PDF or picture printed as a section of its own. A PDF’s pages fill the text width; a picture prints at its own size, shrunk to fit the page. The heading prints over it (leave it empty for none) and the caption under it. Attachment ▸ Choose File picks the file (a copy is kept in the project folder; the one it replaces goes to the Trash); a file can also be dropped on the preview.');
    const rows = el('div', 'si-attach-fields');
    const field = (key: 'heading' | 'caption', label: string, placeholder: string): void => {
      const lab = el('label', 'si-attach-row');
      const input = el('input');
      input.value = str(this.s.data[key]);
      input.placeholder = placeholder;
      input.readOnly = p.readOnly;
      input.addEventListener('change', () => void this.save(key, input.value));
      lab.append(el('span', 'si-attach-name', label), input);
      rows.append(lab);
    };
    field('heading', 'Heading', 'None (e.g. HPLC traces)');
    field('caption', 'Caption', 'None');
    const fileRow = el('div', 'si-attach-file');
    fileRow.append(el('span', 'si-attach-name', 'File'), el('span', file ? '' : 'muted', file || 'No file yet: Attachment ▸ Choose File.'));
    const stage = el('div', 'si-attach-stage');
    stage.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); stage.classList.add('drop'); } });
    stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
    stage.addEventListener('drop', (e) => {
      stage.classList.remove('drop');
      const f = e.dataTransfer?.files[0];
      if (!f || p.readOnly) return;
      e.preventDefault();
      void f.arrayBuffer().then((b) => this.use(f.name, new Uint8Array(b)));
    });
    this.el.replaceChildren(h, rows, fileRow, stage);
    if (!file) { stage.append(el('p', 'muted si-note', 'Drop a PDF or picture here, or choose one with Attachment ▸ Choose File.')); return; }
    const bytes = await p.readSectionFile(this.s, file).catch(() => null);
    if (!bytes) { stage.append(el('p', 'muted si-note', `${file} can’t be read just now (it may be open in another program, or not downloaded by OneDrive).`)); return; }
    const ext = (/\.([^.]+)$/.exec(file)?.[1] ?? '').toLowerCase();
    let pages: { src: string }[] | null = null;
    if (ext === 'pdf') pages = await this.host.pdfPages(bytes).catch(() => null);
    else if (MIME[ext]) {
      const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] }));
      this.urls.push(u);
      pages = [{ src: u }];
    }
    if (!pages?.length) { stage.append(el('p', 'muted si-note', ext === 'tif' || ext === 'tiff' ? 'TIFF pictures print, but can’t be shown here.' : `${file} could not be shown.`)); return; }
    pages.forEach((pg, i) => {
      const paper = el('div', 'si-attach-paper');
      const img = el('img');
      img.src = pg.src;
      img.alt = `Page ${i + 1} of ${file}`;
      if (ext !== 'pdf') img.classList.add('natural');
      paper.append(img);
      stage.append(paper);
    });
    if (pages.length > 1) fileRow.append(el('span', 'muted', `· ${pages.length} pages`));
  }
}
