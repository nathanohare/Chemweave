// The original picture beside a figure converted from it (Convert to Figure), or a structure made
// from it (Make Editable): a card in the comment column at the figure's height, the picture at
// the same size it had on the page, to copy from. Trace shows it faintly on the figure itself,
// where it was, to draw over; with Trace on, the card holds how strongly and in what color.
// Review ▸ Original Pictures shows them all, only the one being drawn in (the start), or none.
// The comments and these cards make room for each other in the column (DocComments.place).

import type { DocObject, FromPicture, TraceLook, TraceTint } from '../document/document';
import { traceOf } from '../document/document';
import { showableSrc } from '../render/images';
import { commandIcon } from './command-icons';
import type { ColumnCard } from './doc-comments';
import { TINTS } from './trace';

type Drawing = Extract<DocObject, { kind: 'drawing' }>;

export interface OriginalNotesHost {
  /** The structures in the document, by id. */
  objects(): Record<number, DocObject> | null;
  /** Where a structure is on the page (the document's points), and how many page points one of its drawing points is; null when it isn't laid out. */
  placeOf(id: number): { y: number; pageK: number } | null;
  /** The structure being drawn in place, if any. */
  drawingIn(): number | null;
  /** Review ▸ Original Pictures. */
  mode(): 'all' | 'editing' | 'none';
  /** Pixels to the document's point (the zoom). */
  zoom(): number;
  /** Whether the pages are on screen (Document mode showing). */
  showing(): boolean;
  setTrace(id: number, patch: Partial<TraceLook>): void;
  /** The ⋯ menu: Revert to Picture, Original Pictures. */
  more(id: number, x: number, y: number): void;
}

const TINT_NAMES: Record<TraceTint, string> = { original: 'The picture\'s own colors', gray: 'Gray', blue: 'Blue', red: 'Red' };

export class OriginalNotes {
  private notes = new Map<number, { el: HTMLElement; key: string }>();

  constructor(private h: OriginalNotesHost) {}

  /** The structures whose picture shows now. */
  private shownIds(): number[] {
    const objs = this.h.objects();
    const mode = this.h.mode();
    if (!objs || mode === 'none' || !this.h.showing()) return [];
    if (mode === 'editing') {
      const id = this.h.drawingIn();
      return id !== null && objs[id]?.kind === 'drawing' && (objs[id] as Drawing).fromPicture ? [id] : [];
    }
    return Object.entries(objs).filter(([, o]) => o.kind === 'drawing' && !!o.fromPicture).map(([k]) => Number(k));
  }

  /** The cards for the comment column now (made, changed or taken away to match the document). */
  cards(): ColumnCard[] {
    const objs = this.h.objects();
    const want = new Set(this.shownIds());
    for (const [id, n] of this.notes) if (!want.has(id)) { n.el.remove(); this.notes.delete(id); }
    const out: ColumnCard[] = [];
    for (const id of want) {
      const o = objs![id] as Drawing;
      const at = this.h.placeOf(id);
      const fp = o.fromPicture!;
      if (!at) { this.notes.get(id)?.el.remove(); this.notes.delete(id); continue; }
      // the picture as big as it was on the page
      const z = this.h.zoom();
      const w = Math.max(24, Math.round(fp.at.w * at.pageK * z)), hgt = Math.max(24, Math.round(fp.at.h * at.pageK * z));
      const t = traceOf(fp);
      const key = `${fp.picture.src.length}:${fp.picture.src.slice(-32)}|${w}x${hgt}|${t.on}|${t.opacity}|${t.tint}`;
      let n = this.notes.get(id);
      if (!n || n.key !== key) {
        const el = this.card(id, fp.picture, w, hgt, t);
        if (n) n.el.replaceWith(el); else document.body.append(el);
        n = { el, key };
        this.notes.set(id, n);
      }
      out.push({ el: n.el, y: at.y, width: w + 22 });
    }
    return out;
  }

  /** All taken away (leaving Document mode). */
  clear(): void {
    for (const n of this.notes.values()) n.el.remove();
    this.notes.clear();
  }

  private card(id: number, pic: FromPicture['picture'], w: number, h: number, t: TraceLook): HTMLElement {
    const el = document.createElement('div');
    el.className = 'op-note';
    el.setAttribute('role', 'complementary');
    el.setAttribute('aria-label', 'Original picture');
    const head = document.createElement('div');
    head.className = 'op-head';
    const title = document.createElement('b');
    title.textContent = 'Original picture';
    const gap = document.createElement('span');
    gap.className = 'op-gap';
    const trace = document.createElement('button');
    trace.type = 'button';
    trace.className = 'op-btn';
    trace.setAttribute('aria-pressed', String(t.on));
    trace.innerHTML = `${commandIcon('trace-original') ?? ''}<span>Trace</span>`;
    trace.title = 'Trace: show the picture faintly on the figure, exactly where it was, to draw over (only while the figure is drawn in; it never prints)';
    trace.addEventListener('click', () => this.h.setTrace(id, { on: !t.on }));
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'op-btn op-sq';
    more.textContent = '⋯';
    more.title = 'More: Revert to Picture, Original Pictures';
    more.setAttribute('aria-label', 'More');
    more.addEventListener('click', () => { const r = more.getBoundingClientRect(); this.h.more(id, r.left, r.bottom + 2); });
    head.append(title, gap, trace, more);

    // the picture as it was shown (its cropping taken off)
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.className = 'op-pic';
    const img = new Image();
    img.onload = () => {
      const g = c.getContext('2d');
      if (!g) return;
      const cr = pic.crop ?? { l: 0, t: 0, r: 0, b: 0 };
      const iw = img.naturalWidth, ih = img.naturalHeight;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, cr.l * iw, cr.t * ih, Math.max(1e-3, (1 - cr.l - cr.r) * iw), Math.max(1e-3, (1 - cr.t - cr.b) * ih), 0, 0, c.width, c.height);
    };
    const src = showableSrc(pic.src);
    if (src) img.src = src;
    el.append(head, c);

    if (t.on) {
      // how the tracing looks: how strongly, and in what color
      const row = document.createElement('label');
      row.className = 'op-row';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '10';
      range.max = '80';
      range.step = '5';
      range.value = String(Math.round(t.opacity * 100));
      const pct = document.createElement('span');
      pct.className = 'op-pct';
      pct.textContent = `${range.value}%`;
      range.addEventListener('input', () => { pct.textContent = `${range.value}%`; });
      range.addEventListener('change', () => this.h.setTrace(id, { opacity: Number(range.value) / 100 }));
      row.append('Opacity ', range, pct);
      const tints = document.createElement('div');
      tints.className = 'op-row';
      tints.append('Tint ');
      for (const k of Object.keys(TINTS) as TraceTint[]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'op-swatch';
        const rgb = TINTS[k];
        b.style.background = rgb ? `rgb(${rgb.join(',')})` : 'linear-gradient(135deg, #000 50%, #c33 50%)';
        b.title = TINT_NAMES[k];
        b.setAttribute('aria-label', TINT_NAMES[k]);
        b.setAttribute('aria-pressed', String(t.tint === k));
        b.addEventListener('click', () => this.h.setTrace(id, { tint: k }));
        tints.append(b);
      }
      el.append(row, tints);
    }
    return el;
  }
}
