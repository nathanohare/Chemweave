// A figure in an SI project's Custom section (SPEC §13k.5): a picture in the section's images/
// folder, listed in section.json's "figures" with its label and printed width, and placed in the
// text as a `!figure{f-…} Caption` paragraph. Shown under the text with its picture at about
// printed size and its label; the ribbon's Figure tab changes its picture (a file, the
// clipboard, the drawing tools or a compound), its width, or removes it.

import { EDIT_KEY, pictureEditOf } from '../si/picture-edit';
import type { Json } from '../si/project';
import { SiPictures, type SiPictureHost } from './si-picture';
import { addInfo } from './info-tip';
import { scrollToItem } from './motion';

export interface SiFigureHost extends SiPictureHost {
  /** The figure was picked, or changed: the ribbon's Figure tab shows its state. */
  chosen(f: SiFigureEditor): void;
  /** Take the figure out of the text (its picture stays in images/). */
  remove(f: SiFigureEditor): Promise<void>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class SiFigureEditor {
  readonly el: HTMLElement;
  private pic = el('div', 'si-fig-pic');
  private title = el('span');
  private labelBox = el('input', 'si-label-input');
  private urls: string[] = [];
  private pics: SiPictures;

  constructor(private host: SiFigureHost, readonly id: string, title: string) {
    this.pics = new SiPictures(host);
    this.el = el('div', 'si-card si-figure-card');
    this.el.tabIndex = 0;
    this.el.dataset.figure = id;
    const h = el('h3', 'si-sub');
    h.append(this.title);
    this.title.textContent = title;
    addInfo(h, 'The figure as it prints, about its printed size; its caption is the line under it in the text. Double-click it to draw it again; click it for the Figure tab on the ribbon to change the picture or set its width.');
    const lab = el('label', 'si-part');
    this.labelBox.placeholder = 'Automatic';
    this.labelBox.addEventListener('change', () => void this.save({ label: this.labelBox.value.trim() }));
    lab.append('Label', this.labelBox);
    lab.title = 'The figure’s label, typed over the automatic one (Figure S1, S2…)';
    this.el.append(h, this.pic, lab);
    this.el.addEventListener('focusin', () => this.host.chosen(this));
    this.el.addEventListener('mousedown', () => this.host.chosen(this));
    this.el.addEventListener('dblclick', () => void this.command('draw-structure'));
    this.paint();
  }

  private get entry(): Json {
    const s = this.host.section;
    const figs = s.data.figures && typeof s.data.figures === 'object' && !Array.isArray(s.data.figures) ? (s.data.figures as Json) : {};
    const e = figs[this.id];
    return e && typeof e === 'object' && !Array.isArray(e) ? (e as Json) : {};
  }

  /** The figure's file and printed width in cm (0: its own size). */
  get state(): { file: string; width: number; edited: boolean } {
    const e = this.entry;
    const file = typeof e.file === 'string' ? e.file : '';
    const was = pictureEditOf(e);
    return { file, width: Math.max(0, Number(e.width ?? e.width_cm ?? 0) || 0), edited: !!was && file !== was.original };
  }

  /** The figure's label as the compiled SI gives it; `auto`: the numbered one it gets without a typed label (the Label box's placeholder). */
  setTitle(label: string, auto = ''): void {
    if (label) this.title.textContent = label;
    this.labelBox.placeholder = auto ? `${auto} (automatic)` : 'Automatic';
  }

  /** Done when every save of this figure so far has been written. */
  settled(): Promise<void> {
    // (a label typed and not left yet)
    if (!this.gone && this.labelBox.value.trim() !== String(this.entry.label ?? '')) void this.save({ label: this.labelBox.value.trim() });
    return this.pending;
  }
  /** The figure's saves, one after another (never rejected). */
  private pending: Promise<void> = Promise.resolve();

  /** The editor is leaving the page: its picture's object URL is given back. */
  dispose(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    // (frozen: a picture still being read makes no URL for a list nobody keeps)
    Object.freeze(this.urls);
    this.urls = [];
    this.gone = true;
  }
  private gone = false;

  focus(): void { scrollToItem(this.el); this.el.focus(); }

  /** Its picture changed outside the editor (Crop, Rotate): painted again. */
  refresh(): void { this.paint(); }

  private paint(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    Object.freeze(this.urls);
    this.urls = [];
    if (this.gone) return;
    const st = this.state;
    this.labelBox.value = String(this.entry.label ?? '');
    this.pic.replaceChildren(st.file ? this.pics.preview(st.file, this.urls, { w: 620, h: 420 }, st.width) : el('p', 'muted si-note', 'No picture yet: double-click to draw one, or use the Figure tab’s Change Picture or Paste Picture.'));
  }

  /** Change the figure's entry in section.json (a value of undefined takes it out). */
  private save(change: Json): Promise<void> {
    this.pending = this.pending.then(() => this.saveNow(change)).then(() => {}, () => {});
    return this.pending;
  }

  private async saveNow(change: Json): Promise<void> {
    const s = this.host.section;
    const figs = (s.data.figures && typeof s.data.figures === 'object' && !Array.isArray(s.data.figures) ? s.data.figures : (s.data.figures = {})) as Json;
    const e = { ...this.entry };
    for (const [k, v] of Object.entries(change)) { if (v === undefined || v === '' || v === 0) delete e[k]; else e[k] = v; }
    // (a picture's file is kept even when emptied: the figure needs one)
    if (!e.file && typeof this.entry.file === 'string') e.file = this.entry.file;
    figs[this.id] = e;
    try { await this.host.project.saveSection(s); } catch (err) { this.host.flash(`The figure could not be saved: ${err instanceof Error ? err.message : String(err)}`); }
    this.paint();
    this.host.chosen(this);
  }

  setWidth(cm: number): Promise<void> { return this.save({ width: cm > 0 ? Math.round(cm * 100) / 100 : undefined }); }

  async command(cmd: string): Promise<void> {
    let rel: string | null = null;
    if (cmd === 'picture') rel = await this.pics.fromFile('Picture for the figure');
    else if (cmd === 'paste-picture') rel = await this.pics.fromClipboard();
    // (a cropped or turned picture is drawn again from its original: the new drawing replaces both)
    else if (cmd === 'draw-structure') rel = await this.pics.draw(pictureEditOf(this.entry)?.original ?? this.state.file, 'Figure');
    else if (cmd === 'compound') rel = (await this.pics.fromCompound())?.rel ?? null;
    else if (cmd === 'remove-figure') { await this.host.remove(this); return; }
    // (a new picture: the old one's crop and rotation go with it)
    if (rel) await this.save({ file: rel, [EDIT_KEY]: undefined });
  }
}
