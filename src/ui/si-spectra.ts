// A compound's spectra page (under the Spectra section in the tree, SPEC §13k.12): its spectra
// listed (each page of a PDF on its own), the one picked drawn as it prints (its header line, the
// spectrum, auto-cropped when that is on, at the size of its place on the page, and the structure
// box on it), and that spectrum's own settings beside it. The box is dragged anywhere on the
// spectrum and resized by its corners; its parts move together, and Alt-drag moves the ID and
// caption on their own. Each setting shows whether it follows the Spectra section's (its name in
// plain type) or is the spectrum's own (in bold, with × to follow the section's again).
//
// Saved as SI Assistant saves them, on the spectrum's entry in compound.json: a dragged place
// always for its page ("pages"), the rest for the page or, for a PDF of several pages, every page
// of the file ("layout"), as the ribbon's Spectrum tab says. The order the files print in is kept
// in "spectra_order" (the ribbon's Move Up, Move Down and Automatic Order).

import type { Json, SiCompound, SiProject, SiSection } from '../si/project';
import type { Contents } from '../model';
import {
  attachmentDir, captionText, clean, effective, headerParts, HEADER_PT, idSizeOf, POSITION_KEYS, SCALE_RANGE, sectionDefaults, shownSize, slotSize,
  spectrumItems, structureBoxAt, structureBoxSize, structureSize, BOX_PAD, DEFAULTS, type Crop, type SpectrumLayout,
} from '../si/spectra';
import { dataUrl, imageSize, pictureMime } from '../render/images';
import { addInfo } from './info-tip';

export interface SiSpectraHost {
  project: SiProject;
  compound: SiCompound;
  section: SiSection | null;
  flash(msg: string, ms?: number): void;
  /** The compound's ID as shown now ("2a"). */
  idOf(c: SiCompound): string;
  contentsOf(mol: string): Contents | null;
  /** A drawing's own size in points. */
  sizeOf(c: Contents): { w: number; h: number } | null;
  /** A structure as SVG markup, in the project's style. */
  pictureOf(mol: string): string | null;
  /** The pages of a PDF as pictures (null when it can't be read). */
  pdfPages(bytes: Uint8Array): Promise<{ src: string; w: number; h: number }[] | null>;
  /** The part of a picture that isn't blank margin (auto-crop). */
  contentBox(src: string): Promise<Crop | null>;
  /** Save a change (and say so when it can't be saved). */
  act(f: () => Promise<unknown>): Promise<void>;
  /** What can be done now changed (the Spectrum tab's buttons). */
  chosen(x: SiSpectraPage): void;
  /** Open the Spectra section's page. */
  openSection(): void;
}

interface Entry { key: string; item: Json; file: string; page: number; pages: number; src: string | null; aspect: number; crop: Crop | null; problem?: string }

const PT_PX = 1.1;            // the preview: pixels to a point at 100 %
const PAGE_BODY = { w: 6.5 * 72, h: 9 * 72 - 40 };
/** The spectrum last shown for each compound (its page opens on it again). */
const lastShown = new Map<string, string>();
type Pages = { src: string; w: number; h: number }[];
/**
 * Pages of spectrum files drawn lately, for each project open (forgotten with it), by the file's
 * path and its bytes' length and fingerprint: a file replaced under the same name (a corrected
 * spectrum added after the old one went to the Trash, or one SI Assistant wrote) is drawn again.
 * A file that couldn't be read isn't kept, so it is read again next time. At most PAGES_KEPT files.
 */
const pagesRead = new WeakMap<SiProject, Map<string, { key: string; pages: Pages }>>();
const PAGES_KEPT = 40;

/** A quick fingerprint of a file's bytes (FNV-1a) with its length. */
function bytesKey(b: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return `${b.length}:${(h >>> 0).toString(16)}`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);

/** The settings that can be a spectrum's own, with how they are shown. */
type Kind = 'tick' | 'choice' | 'num' | 'color';
const SETTINGS: { key: keyof SpectrumLayout; label: string; kind: Kind; group: string; options?: [string, string][]; k?: number; min?: number; max?: number; unit?: string; tip: string }[] = [
  { key: 'per_page', label: 'Per page', kind: 'choice', group: 'Page', options: [['1', '1'], ['2', '2'], ['4', '4']], tip: 'Spectra on its page (a spectrum that needs another number starts a new page).' },
  { key: 'orientation', label: 'Orientation', kind: 'choice', group: 'Page', options: [['portrait', 'Portrait'], ['landscape', 'Landscape']], tip: 'Its page portrait or landscape.' },
  { key: 'header_line', label: 'Header line', kind: 'tick', group: 'Page', tip: 'The line above the spectrum.' },
  { key: 'auto_crop', label: 'Auto-crop', kind: 'tick', group: 'Page', tip: 'Cut the white margins round the spectrum and scale it to fill its place.' },
  { key: 'spectrum_frame', label: 'Frame', kind: 'tick', group: 'Page', tip: 'A frame round the spectrum.' },
  { key: 'struct_box', label: 'Show', kind: 'tick', group: 'Structure and ID', tip: 'The compound’s structure and ID on a box over the spectrum.' },
  { key: 'corner', label: 'Corner', kind: 'choice', group: 'Structure and ID', options: [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']], tip: 'The corner the box goes in, until it is dragged somewhere of its own.' },
  { key: 'struct_scale', label: 'Structure', kind: 'num', group: 'Structure and ID', k: 100, min: 25, max: 400, unit: '%', tip: '100 % is the structure’s own size, no larger than 1.5 × 1.1 in; the box’s corners resize it too.' },
  { key: 'id_size', label: 'ID size', kind: 'num', group: 'Structure and ID', k: 1, min: 0, max: 24, unit: 'pt', tip: 'The ID’s size in points; 0 is the text size.' },
  { key: 'id_bold', label: 'Bold ID', kind: 'tick', group: 'Structure and ID', tip: 'The ID in bold.' },
  { key: 'caption', label: 'Caption', kind: 'tick', group: 'Structure and ID', tip: 'A caption under the structure, such as “¹H NMR (CDCl₃, 500 MHz)”.' },
  { key: 'struct_bg', label: 'Background', kind: 'color', group: 'Structure and ID', tip: 'The box’s background, so the structure reads over the spectrum.' },
  { key: 'struct_frame', label: 'Box frame', kind: 'tick', group: 'Structure and ID', tip: 'A frame round the box.' },
];

export class SiSpectraPage {
  readonly el = el('div', 'si-card si-spectra-page');
  private entries: Entry[] = [];
  private index = 0;
  /** File (true) or page (false) settings, for a PDF of several pages. */
  private wholeFile = false;
  private list = el('div', 'si-spectra-list');
  private stage = el('div', 'si-spectra-stage');
  private settings = el('div', 'si-spectra-settings');
  private structure: { svg: string; own: { w: number; h: number } | null } | null = null;

  constructor(private host: SiSpectraHost) {
    const c = host.compound;
    const h = el('h2', 'si-title');
    h.append(el('b', 'si-cid', host.idOf(c)), document.createTextNode(' Spectra'));
    addInfo(h, 'This compound’s spectra as they print in the Spectra section. Pick one on the left; drag the structure box anywhere on the spectrum and resize it by its corners (its parts move together; Alt-drag moves the ID and caption on their own). Its settings below win over the Spectra section’s; a setting in bold is this spectrum’s own (× follows the section again). The Spectrum tab on the ribbon changes the order and says whether settings are for this page or the whole file.');
    const body = el('div', 'si-spectra-body');
    const right = el('div', 'si-spectra-right');
    right.append(this.stage, this.settings);
    body.append(this.list, right);
    this.el.append(h, body);
    this.list.append(el('p', 'muted si-note', 'Reading the spectra…'));
    void this.load();
  }

  private get p(): SiProject { return this.host.project; }
  private get defaults(): SpectrumLayout { return sectionDefaults(this.host.section, this.p.settings); }
  get current(): Entry | null { return this.entries[this.index] ?? null; }
  private get several(): boolean { return (this.current?.pages ?? 1) > 1; }
  get scope(): 'page' | 'file' { return this.several && this.wholeFile ? 'file' : 'page'; }

  /** What the ribbon needs: the file's place in the order, and the scope. */
  get state(): { up: boolean; down: boolean; manual: boolean; several: boolean; scope: 'page' | 'file'; own: boolean; moved: boolean } {
    const files = this.files();
    const at = this.fileIndex();
    const own = Object.keys(this.own()).length > 0;
    const page = this.pageOwn();
    return { up: at > 0, down: at >= 0 && at < files.length - 1, manual: Array.isArray(this.host.compound.data.spectra_order), several: this.several, scope: this.scope, own, moved: POSITION_KEYS.some((k) => k in page) };
  }

  // ------------------------------------------------------------------ reading

  private async load(): Promise<void> {
    const c = this.host.compound;
    const out: Entry[] = [];
    for (const [key, item] of spectrumItems(c)) {
      const file = String(item.file ?? '');
      if (!file) continue;
      const path = `${c.folder}/${attachmentDir(c, key)}/${file}`;
      let kept = pagesRead.get(this.p);
      if (!kept) pagesRead.set(this.p, (kept = new Map()));
      const bytes = await this.p.folder.readBytes(path).catch(() => null);
      const bkey = bytes ? bytesKey(bytes) : '';
      let pages: Pages | null = null;
      const hit = kept.get(path);
      if (bytes && hit?.key === bkey) {
        pages = hit.pages;
        kept.delete(path);
        kept.set(path, hit);   // (the most lately used last)
      } else if (bytes) {
        if (/\.pdf$/i.test(file)) pages = await this.host.pdfPages(bytes).catch(() => null);
        else {
          const mime = pictureMime(file, bytes);
          const px = mime ? imageSize(bytes, mime) : null;
          pages = mime && px && px.w > 0 ? [{ src: dataUrl(bytes, mime), w: px.w, h: px.h }] : null;
        }
        kept.delete(path);
        if (pages) {
          kept.set(path, { key: bkey, pages });
          while (kept.size > PAGES_KEPT) kept.delete(kept.keys().next().value!);
        }
      }
      if (!pages?.length) { out.push({ key, item, file, page: 1, pages: 1, src: null, aspect: 1.3, crop: null, problem: pages === null ? 'This file is missing or can’t be read as a picture or PDF.' : 'This PDF has no pages.' }); continue; }
      pages.forEach((pg, i) => out.push({ key, item, file, page: i + 1, pages: pages!.length, src: pg.src, aspect: pg.h / pg.w, crop: null }));
    }
    this.entries = out;
    const last = lastShown.get(c.id);
    const found = out.findIndex((e) => `${e.key}/${e.file}/${e.page}` === last);
    this.index = found >= 0 ? found : 0;
    const mol = this.p.hasStructure(c) ? await this.p.readStructure(c).catch(() => '') : '';
    const contents = mol ? this.host.contentsOf(mol) : null;
    const svg = mol ? this.host.pictureOf(mol) : null;
    this.structure = svg ? { svg, own: contents ? this.host.sizeOf(contents) : null } : null;
    this.render();
  }

  // ------------------------------------------------------------------ the spectrum's settings

  private pageOwn(e = this.current): Json {
    if (!e) return {};
    const pages = e.item.pages;
    return isObj(pages) ? clean(pages[String(e.page)], true) as Json : {};
  }
  private fileOwn(e = this.current): Json { return e ? clean(e.item.layout, false, true) as Json : {}; }
  /** This scope's own settings. */
  own(): Json { return this.scope === 'file' ? this.fileOwn() : this.pageOwn(); }
  /** What this scope would have without its own: the section's, and the file's when changing a page. */
  private inherited(): SpectrumLayout { return this.scope === 'file' ? this.defaults : { ...this.defaults, ...(this.fileOwn() as Partial<SpectrumLayout>) }; }
  private effective(e = this.current): SpectrumLayout { return e ? effective(this.defaults, e.item, String(e.page)) : this.defaults; }

  /** Keep a scope's own settings on the spectrum's entry (an empty one taken off), and save the compound. */
  private async write(own: Json, scope = this.scope): Promise<void> {
    const e = this.current;
    if (!e) return;
    const item = e.item;
    if (scope === 'file') {
      if (Object.keys(own).length) item.layout = own; else delete item.layout;
    } else {
      const pages: Json = isObj(item.pages) ? { ...item.pages } : {};
      if (Object.keys(own).length) pages[String(e.page)] = own; else delete pages[String(e.page)];
      if (Object.keys(pages).length) item.pages = pages; else delete item.pages;
    }
    await this.host.act(() => this.p.saveCompound(this.host.compound));
    this.render();
  }

  /** A setting changed: the scope's own when it differs from what it would follow. */
  private async set(key: keyof SpectrumLayout, value: unknown): Promise<void> {
    const own = { ...this.own() };
    if (same((this.inherited() as unknown as Json)[key], value)) delete own[key]; else own[key] = value;
    await this.write(own);
  }

  /** Follow the section (and the file) again: one setting, or every one of this scope (with a dragged place). */
  async reset(key?: string): Promise<void> {
    const own = { ...this.own() };
    if (key) delete own[key];
    else for (const k of Object.keys(own)) if (!(POSITION_KEYS as readonly string[]).includes(k)) delete own[k];
    await this.write(own);
  }

  /** Put the box back in its corner and the ID and caption under the structure. */
  async resetPlace(): Promise<void> {
    const page = { ...this.pageOwn() };
    for (const k of POSITION_KEYS) delete page[k];
    await this.write(page, 'page');
  }

  // ------------------------------------------------------------------ order

  private files(): [string, string][] {
    const seen = new Set<string>();
    const out: [string, string][] = [];
    for (const e of this.entries) { const k = `${e.key}\u0000${e.file}`; if (!seen.has(k)) { seen.add(k); out.push([e.key, e.file]); } }
    return out;
  }
  private fileIndex(): number { const e = this.current; return e ? this.files().findIndex(([k, f]) => k === e.key && f === e.file) : -1; }

  async move(step: number): Promise<void> {
    const files = this.files();
    const at = this.fileIndex();
    const to = at + step;
    if (at < 0 || to < 0 || to >= files.length) return;
    [files[at], files[to]] = [files[to], files[at]];
    this.host.compound.data.spectra_order = files.map(([k, f]) => [k, f]);
    this.remember();
    await this.host.act(() => this.p.saveCompound(this.host.compound));
    await this.load();
  }

  async automaticOrder(): Promise<void> {
    delete this.host.compound.data.spectra_order;
    this.remember();
    await this.host.act(() => this.p.saveCompound(this.host.compound));
    await this.load();
  }

  setScope(file: boolean): void { this.wholeFile = file; this.render(); }

  /** The ribbon's Spectrum tab. */
  async command(cmd: string): Promise<void> {
    if (this.p.readOnly && cmd !== 'section') { this.host.flash('This SI project is open read-only.'); return; }
    switch (cmd) {
      case 'up': await this.move(-1); return;
      case 'down': await this.move(1); return;
      case 'auto': await this.automaticOrder(); return;
      case 'scope-page': this.setScope(false); return;
      case 'scope-file': this.setScope(true); return;
      case 'reset': await this.reset(); return;
      case 'reset-place': await this.resetPlace(); return;
      case 'section': this.host.openSection(); return;
    }
  }

  private remember(): void { const e = this.current; if (e) lastShown.set(this.host.compound.id, `${e.key}/${e.file}/${e.page}`); }

  // ------------------------------------------------------------------ drawing

  private render(): void {
    this.renderList();
    this.renderStage();
    this.renderSettings();
    this.host.chosen(this);
  }

  private renderList(): void {
    this.list.replaceChildren();
    if (!this.entries.length) { this.list.append(el('p', 'muted si-note', 'No spectra yet: add them in the compound’s Spectra field.')); return; }
    this.entries.forEach((e, i) => {
      const b = el('button', 'si-spectra-item');
      b.type = 'button';
      const type = String(e.item.type || e.file);
      b.append(el('span', 'si-spectra-type', type), el('span', 'si-spectra-file', e.pages > 1 ? `${e.file} · page ${e.page}` : e.file));
      const has = Object.keys(this.pageOwn(e)).length + Object.keys(this.fileOwn(e)).length > 0;
      if (has) { const m = el('span', 'si-spectra-own', '•'); m.title = 'Has settings of its own'; b.append(m); }
      b.classList.toggle('on', i === this.index);
      b.setAttribute('aria-pressed', String(i === this.index));
      b.addEventListener('click', () => { this.index = i; this.remember(); this.render(); });
      this.list.append(b);
    });
  }

  /** The spectrum's place on the page (points), the spectrum in it, and the box on it. */
  private geometry(e: Entry, eff: SpectrumLayout) {
    const landscape = eff.orientation === 'landscape';
    const body = landscape ? { w: PAGE_BODY.h + 40, h: PAGE_BODY.w } : PAGE_BODY;
    const slot = slotSize(body.w, body.h, eff.per_page, landscape);
    const headH = eff.header_line ? HEADER_PT * 1.25 + 2 * 3.6 + 3 : 0;
    const crop = eff.auto_crop ? e.crop : null;
    const shown = shownSize({ w: slot.w, h: Math.max(10, slot.h - headH) }, e.aspect, crop);
    const spec = { x: (slot.w - shown.w) / 2, y: headH, w: shown.w, h: shown.h };
    const size = structureSize(this.structure?.own ?? null, eff.struct_scale);
    const id = this.host.idOf(this.host.compound);
    const idSize = idSizeOf(eff);
    const caption = eff.caption ? captionText(this.host.compound, e.item) : '';
    const box = structureBoxSize(size, id, idSize, caption, eff.caption_size);
    const at = structureBoxAt(eff, spec, box);
    return { slot, headH, spec, size, id, idSize, caption, box: { ...box, ...at }, crop };
  }

  private renderStage(): void {
    const e = this.current;
    this.stage.replaceChildren();
    if (!e) return;
    if (e.problem) { this.stage.append(el('p', 'muted si-note', e.problem)); return; }
    const eff = this.effective(e);
    // auto-crop: find the spectrum's margins once
    if (eff.auto_crop && e.src && e.crop === null) {
      void this.host.contentBox(e.src).then((c) => { if (c) { e.crop = c; if (this.current === e) this.renderStage(); } }).catch(() => {});
    }
    const g = this.geometry(e, eff);
    const k = Math.min(PT_PX, 520 / g.slot.h);
    const paper = el('div', 'si-spectra-paper');
    paper.style.width = `${g.slot.w * k}px`;
    paper.style.height = `${g.slot.h * k}px`;
    if (eff.header_line) {
      const head = el('div', 'si-spectra-head', headerParts(this.host.compound, e.item, g.id, e.page).join(''));
      head.style.fontSize = `${HEADER_PT * k}px`;
      paper.append(head);
    }
    // the spectrum (the part shown when cropped)
    const view = el('div', 'si-spectra-view');
    Object.assign(view.style, { left: `${g.spec.x * k}px`, top: `${g.spec.y * k}px`, width: `${g.spec.w * k}px`, height: `${g.spec.h * k}px` });
    if (eff.spectrum_frame) view.style.outline = `${Math.max(1, eff.spectrum_frame_width * k)}px solid ${eff.spectrum_frame_color}`;
    const img = el('img');
    img.src = e.src!;
    img.alt = '';
    img.draggable = false;
    const [l, t, r, b] = g.crop ?? [0, 0, 1, 1];
    const iw = (g.spec.w * k) / (r - l), ih = (g.spec.h * k) / (b - t);
    Object.assign(img.style, { width: `${iw}px`, height: `${ih}px`, left: `${-l * iw}px`, top: `${-t * ih}px` });
    view.append(img);
    paper.append(view);
    if (eff.struct_box) paper.append(this.boxEl(eff, g, k));
    this.stage.append(paper);
  }

  /** The structure box, dragged and resized here. */
  private boxEl(eff: SpectrumLayout, g: ReturnType<SiSpectraPage['geometry']>, k: number): HTMLElement {
    const box = el('div', 'si-spectra-box');
    const place = (bx: number, by: number, w: number, h: number) => Object.assign(box.style, { left: `${bx * k}px`, top: `${by * k}px`, width: `${w * k}px`, height: `${h * k}px` });
    place(g.box.x, g.box.y, g.box.w, g.box.h);
    box.style.background = eff.struct_bg;
    if (eff.struct_frame) box.style.outline = `${Math.max(1, eff.struct_frame_width * k)}px solid ${eff.struct_frame_color}`;
    box.title = 'Drag to move the structure, ID and caption together; Alt-drag the ID to move it on its own; drag a corner to resize';
    const pic = el('div', 'si-spectra-struct');
    Object.assign(pic.style, { left: `${(g.box.w - g.size.w) / 2 * k}px`, top: `${BOX_PAD * k}px`, width: `${g.size.w * k}px`, height: `${g.size.h * k}px` });
    if (this.structure) pic.innerHTML = this.structure.svg.replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1').replace('<svg', '<svg width="100%" height="100%"');
    else pic.append(el('span', 'muted', 'No structure'));
    const label = el('div', 'si-spectra-label');
    const dx = eff.label_dx ?? 0, dy = eff.label_dy ?? 0;
    Object.assign(label.style, { left: `${dx * k}px`, top: `${(BOX_PAD + g.size.h + dy) * k}px`, width: `${g.box.w * k}px` });
    const idEl = el('div', '', g.id);
    idEl.style.fontSize = `${g.idSize * k}px`;
    idEl.style.fontWeight = eff.id_bold ? '700' : '400';
    label.append(idEl);
    if (g.caption) { const cap = el('div', '', g.caption); cap.style.fontSize = `${eff.caption_size * k}px`; label.append(cap); }
    box.append(pic, label);
    for (const corner of ['nw', 'ne', 'sw', 'se']) { const hd = el('span', `si-spectra-handle ${corner}`); hd.dataset.corner = corner; box.append(hd); }
    if (this.p.readOnly) return box;

    // moving and resizing
    box.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      box.setPointerCapture(ev.pointerId);
      const x0 = ev.clientX, y0 = ev.clientY;
      const corner = (ev.target as HTMLElement).dataset.corner;
      const labelOnly = !corner && ev.altKey && label.contains(ev.target as Node);
      let moved = false;
      let result: Json = {};
      // resizing keeps the box's centre when it was dragged somewhere of its own, else its corner
      const dragged = eff.x !== undefined && eff.y !== undefined;
      const anchor = dragged ? { x: g.box.x + g.box.w / 2, y: g.box.y + g.box.h / 2 }
        : { x: eff.corner.endsWith('right') ? g.box.x + g.box.w : g.box.x, y: eff.corner.startsWith('bottom') ? g.box.y + g.box.h : g.box.y };
      const rect = (box.offsetParent as HTMLElement).getBoundingClientRect();
      const ptAt = (cx: number, cy: number) => ({ x: (cx - rect.left) / k, y: (cy - rect.top) / k });
      const startDist = Math.max(4, Math.hypot(ptAt(x0, y0).x - anchor.x, ptAt(x0, y0).y - anchor.y));
      const move = (m: PointerEvent): void => {
        const ddx = (m.clientX - x0) / k, ddy = (m.clientY - y0) / k;
        if (!moved && Math.hypot(ddx, ddy) * k < 3) return;
        moved = true;
        if (corner) {
          const now = ptAt(m.clientX, m.clientY);
          const scale = Math.round(Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], eff.struct_scale * Math.hypot(now.x - anchor.x, now.y - anchor.y) / startDist)) * 100) / 100;
          result = { struct_scale: scale };
          const sw = g.size.w * scale / eff.struct_scale, sh = g.size.h * scale / eff.struct_scale;
          pic.style.width = `${sw * k}px`; pic.style.height = `${sh * k}px`;
        } else if (labelOnly) {
          result = { label_dx: Math.round((dx + ddx) * 10) / 10, label_dy: Math.round((dy + ddy) * 10) / 10 };
          label.style.left = `${(dx + ddx) * k}px`;
          label.style.top = `${(BOX_PAD + g.size.h + dy + ddy) * k}px`;
        } else {
          const cx = g.box.x + g.box.w / 2 + ddx, cy = g.box.y + g.box.h / 2 + ddy;
          const x = Math.round(Math.min(1, Math.max(0, (cx - g.spec.x) / g.spec.w)) * 10000) / 10000;
          const y = Math.round(Math.min(1, Math.max(0, (cy - g.spec.y) / g.spec.h)) * 10000) / 10000;
          result = { x, y };
          place(g.spec.x + x * g.spec.w - g.box.w / 2, g.spec.y + y * g.spec.h - g.box.h / 2, g.box.w, g.box.h);
        }
      };
      const up = (): void => {
        box.removeEventListener('pointermove', move);
        box.removeEventListener('pointerup', up);
        box.removeEventListener('pointercancel', up);
        if (!moved) return;
        if ('struct_scale' in result) void this.resized(Number(result.struct_scale));
        else void this.write({ ...this.pageOwn(), ...result }, 'page');
      };
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', up);
      box.addEventListener('pointercancel', up);
    });
    return box;
  }

  /** Resized by a corner: as typing the structure size (a page with a size of its own keeps it there, so the box keeps its new size). */
  private async resized(scale: number): Promise<void> {
    if (this.scope === 'file' && 'struct_scale' in this.pageOwn()) await this.write({ ...this.pageOwn(), struct_scale: scale }, 'page');
    else await this.set('struct_scale', scale);
  }

  private renderSettings(): void {
    const e = this.current;
    this.settings.replaceChildren();
    if (!e) return;
    const own = this.own();
    const shown = { ...this.inherited(), ...(own as Partial<SpectrumLayout>) } as unknown as Json;
    const ro = this.p.readOnly;
    const groups = new Map<string, HTMLElement>();
    const scopeNote = this.several ? (this.scope === 'file' ? `Settings for every page of ${e.file}` : `Settings for page ${e.page} of ${e.file}`) : 'Settings for this spectrum';
    const h = el('h3', 'si-sub', scopeNote);
    addInfo(h, 'A setting in bold is this spectrum’s own; × makes it follow the Spectra section’s again. The Spectrum tab on the ribbon switches between this page and every page of a PDF, and puts everything back to the section’s.');
    this.settings.append(h);
    for (const s of SETTINGS) {
      let row = groups.get(s.group);
      if (!row) { row = el('div', 'si-parts si-spectra-row'); row.append(el('span', 'si-spectra-group', s.group)); groups.set(s.group, row); this.settings.append(row); }
      const cell = el('label', 'si-part');
      cell.title = s.tip;
      const isOwn = s.key in own;
      cell.classList.toggle('si-own', isOwn);
      const name = el('span', 'si-plabel', s.label);
      let input: HTMLInputElement | HTMLSelectElement;
      const v = shown[s.key];
      if (s.kind === 'choice') {
        const sel = el('select');
        for (const [val, t] of s.options!) { const o = el('option', '', t); o.value = val; sel.append(o); }
        sel.value = String(v);
        sel.addEventListener('change', () => void this.set(s.key, s.key === 'per_page' ? Number(sel.value) : sel.value));
        input = sel;
        cell.append(name, sel);
      } else if (s.kind === 'tick') {
        const box = el('input');
        box.type = 'checkbox';
        box.checked = !!v;
        box.addEventListener('change', () => void this.set(s.key, box.checked));
        input = box;
        cell.append(box, name);
      } else if (s.kind === 'num') {
        const box = el('input', 'si-num');
        box.type = 'number';
        box.min = String(s.min);
        box.max = String(s.max);
        box.value = String(Math.round(Number(v) * s.k! * 100) / 100);
        box.addEventListener('change', () => { const n = Number(box.value); if (Number.isFinite(n)) void this.set(s.key, clean({ [s.key]: n / s.k! })[s.key] ?? DEFAULTS[s.key]); });
        input = box;
        cell.append(name, box, el('span', 'si-plabel', s.unit ?? ''));
      } else {
        const box = el('input');
        box.type = 'color';
        box.value = String(v);
        box.addEventListener('change', () => void this.set(s.key, box.value.toLowerCase()));
        input = box;
        cell.append(name, box);
      }
      input.disabled = ro;
      if (isOwn && !ro) {
        const x = el('button', 'si-spectra-reset', '×');
        x.type = 'button';
        x.title = `${s.label}: follow the Spectra section’s again`;
        x.addEventListener('click', (ev) => { ev.preventDefault(); void this.reset(s.key); });
        cell.append(x);
      }
      row.append(cell);
    }
    // the header line and caption typed for this spectrum (its file)
    const texts = el('div', 'si-parts si-spectra-row');
    texts.append(el('span', 'si-spectra-group', 'Text'));
    const text = (label: string, key: 'title' | 'struct_caption', auto: string, tip: string): void => {
      const cell = el('label', 'si-part si-spectra-text');
      cell.title = tip;
      const box = el('input');
      box.value = String(e.item[key] ?? '');
      box.placeholder = auto;
      box.disabled = ro;
      box.addEventListener('change', () => void (async () => {
        const v = box.value.trim();
        if (v) e.item[key] = v; else delete e.item[key];
        await this.host.act(() => this.p.saveCompound(this.host.compound));
        this.render();
      })());
      cell.append(el('span', 'si-plabel', label), box);
      texts.append(cell);
    };
    const id = this.host.idOf(this.host.compound);
    text('Header', 'title', headerParts(this.host.compound, { ...e.item, title: '' }, id, 1).join(''), 'The line above the spectrum; empty: made from its type and peak report.');
    text('Caption', 'struct_caption', captionText(this.host.compound, { ...e.item, struct_caption: '' }) || 'none', 'The caption under the structure (when Caption is on); empty: made from the peak report.');
    this.settings.append(texts);
  }
}
