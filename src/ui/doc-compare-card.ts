// Compare with Original (Make Editable, Document mode): a card beside a structure made from a
// picture, with the picture and the structure side by side at the same size, how the picture was
// read, and Revert to Picture, Edit Structure and Keep. It follows the structure as the page
// scrolls, and goes when another thing is picked.

import type { Contents } from '../model';
import type { DocStyle } from '../style';
import type { FromPicture } from '../document/document';
import { figures } from '../document/doc-file';
import { infoIcon } from './info-tip';

export interface CompareCardHost {
  /** Where the structure is on screen (client pixels); null when it isn't shown. */
  where(): DOMRect | null;
  revert(): void;
  edit(): void;
  /** The card closed (Keep, Escape, or closed from outside). */
  closed(): void;
}

/** Largest size of each side of the card, in CSS pixels. */
const PANE_W = 230, PANE_H = 150;

/** How the picture was read, said briefly: who read it and how sure it was. */
export function readSummary(fp: FromPicture, problems: string[]): string {
  const parts = fp.parts ?? [];
  const sure = parts.flatMap((p) => ('graph' in p ? [p.graph.confidence] : []));
  const how = parts.some((p) => 'molblock' in p) ? 'Read by the AI model' : 'Read on this computer';
  const pct = sure.length ? ` · ${Math.round(Math.min(...sure) * 100)}% sure` : '';
  return `${how}${pct}${problems.length ? ': check it' : ''}`;
}

export class CompareCard {
  readonly el: HTMLElement;
  private raf = 0;

  constructor(readonly id: number, contents: Contents, fp: FromPicture, style: DocStyle, problems: string[], private host: CompareCardHost) {
    const el = (this.el = document.createElement('div'));
    el.className = 'compare-card';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Compare with Original');
    const head = document.createElement('div');
    head.className = 'cc-head';
    const title = document.createElement('b');
    title.textContent = 'Compare with Original';
    const status = document.createElement('span');
    status.className = 'cc-status';
    status.textContent = readSummary(fp, problems);
    const about = 'The picture and the structure made from it, side by side at the same size. Look for atoms, bonds or labels that differ. '
      + 'Keep closes this; Compare with Original opens it again.'
      + (problems.length ? ` Why to check it: ${problems.join(' ')}` : '');
    head.append(title, infoIcon(about), status);
    // both sides at one scale: the picture's area in the structure's points, fitted to a side
    const s = Math.min(PANE_W / fp.at.w, PANE_H / fp.at.h, 3);
    const w = Math.max(1, Math.round(fp.at.w * s)), h = Math.max(1, Math.round(fp.at.h * s));
    const panes = document.createElement('div');
    panes.className = 'cc-panes';
    panes.append(this.pane('Original picture', w, h, (c) => drawPicture(c, fp)), this.pane('Editable structure', w, h, (c) => drawStructure(c, contents, style, fp, s)));
    const buttons = document.createElement('div');
    buttons.className = 'cc-buttons';
    const button = (label: string, title: string, go: () => void, primary = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      if (primary) b.className = 'primary';
      b.addEventListener('click', go);
      return b;
    };
    buttons.append(
      button('Revert to Picture', 'Put the picture back as it was', () => { this.close(); this.host.revert(); }),
      button('Edit Structure', 'Open the structure in the drawing tools to fix it', () => { this.close(); this.host.edit(); }),
      button('Keep', 'Keep the structure and close this', () => this.close(), true),
    );
    el.append(head, panes, buttons);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } });
    document.body.append(el);
    this.follow();
  }

  private pane(caption: string, w: number, h: number, draw: (c: HTMLCanvasElement) => void): HTMLElement {
    const fig = document.createElement('figure');
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    draw(c);
    const cap = document.createElement('figcaption');
    cap.textContent = caption;
    fig.append(c, cap);
    return fig;
  }

  /** Beside the structure (right, else left, else under it), kept on screen; hidden while the structure isn't shown. */
  private follow = (): void => {
    if (!this.el.isConnected) return;
    const r = this.host.where();
    if (!r) this.el.style.visibility = 'hidden';
    else {
      this.el.style.visibility = '';
      const cw = this.el.offsetWidth, ch = this.el.offsetHeight, gap = 12, m = 8;
      const W = window.innerWidth, H = window.innerHeight;
      let left: number, top: number;
      if (r.right + gap + cw <= W - m) { left = r.right + gap; top = r.top; }
      else if (r.left - gap - cw >= m) { left = r.left - gap - cw; top = r.top; }
      else { left = r.left; top = r.bottom + gap; }
      left = Math.max(m, Math.min(left, W - cw - m));
      top = Math.max(m, Math.min(top, H - ch - m));
      this.el.style.left = `${Math.round(left)}px`;
      this.el.style.top = `${Math.round(top)}px`;
    }
    this.raf = requestAnimationFrame(this.follow);
  };

  close(): void {
    if (!this.el.isConnected) return;
    cancelAnimationFrame(this.raf);
    this.el.remove();
    this.host.closed();
  }
}

/** The picture as it was shown (its cropping taken off), filling the side. */
function drawPicture(c: HTMLCanvasElement, fp: FromPicture): void {
  const img = new Image();
  img.onload = () => {
    const g = c.getContext('2d');
    if (!g) return;
    const cr = fp.picture.crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const iw = img.naturalWidth, ih = img.naturalHeight;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, cr.l * iw, cr.t * ih, Math.max(1e-3, (1 - cr.l - cr.r) * iw), Math.max(1e-3, (1 - cr.t - cr.b) * ih), 0, 0, c.width, c.height);
  };
  img.src = fp.picture.src;
}

/** The structure where the picture lay over it (fp.at), at `s` CSS pixels to its point. */
function drawStructure(c: HTMLCanvasElement, contents: Contents, style: DocStyle, fp: FromPicture, s: number): void {
  const g = c.getContext('2d');
  if (!g) return;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  const k = (s * c.width) / Math.max(1, parseFloat(c.style.width));
  const box = figures.record(contents, style).pic?.box;
  const bmp = box && figures.bitmap(contents, style, k, true);
  if (!box || !bmp) return;
  g.drawImage(bmp, (box.x1 - fp.at.x) * k, (box.y1 - fp.at.y) * k, (box.x2 - box.x1) * k, (box.y2 - box.y1) * k);
}
